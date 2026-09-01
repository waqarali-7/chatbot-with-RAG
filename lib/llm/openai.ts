import OpenAI from 'openai';
import { modelForRole } from '@/config/models';
import type { ProviderId } from '@/config/models';
import { recordUsage } from './budget';
import { QuotaExhaustedError, withRetry } from './retry';
import {
  ProviderError,
  type CompletionRequest,
  type CompletionResponse,
  type LLMProvider,
  type StreamChunk,
} from './provider';

export class OpenAIProvider implements LLMProvider {
  readonly provider: ProviderId = 'openai';
  private client: OpenAI;

  constructor(
    readonly id: string,
    apiKey = process.env.OPENAI_API_KEY,
  ) {
    if (!apiKey) throw new ProviderError('OPENAI_API_KEY is not set', 'openai');
    this.client = new OpenAI({ apiKey });
  }

  static forRole(role: CompletionRequest['role']): OpenAIProvider {
    return new OpenAIProvider(modelForRole(role, 'openai'));
  }

  private messages(req: CompletionRequest): OpenAI.Chat.ChatCompletionMessageParam[] {
    return [
      { role: 'system', content: req.system },
      ...req.messages.map((m) => ({ role: m.role, content: m.content }) as const),
    ];
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const started = Date.now();
    try {
      const res = await withRetry('openai.complete', () => this.client.chat.completions.create({
        model: this.id,
        max_tokens: req.maxTokens ?? 300,
        temperature: req.temperature ?? 0,
        seed: req.seed,
        stop: req.stopSequences,
        messages: this.messages(req),
      }));
      recordUsage(this.id, res.usage?.prompt_tokens ?? 0, res.usage?.completion_tokens ?? 0);
      return {
        text: res.choices[0]?.message?.content ?? '',
        provider: 'openai',
        model: this.id,
        usage: {
          promptTokens: res.usage?.prompt_tokens ?? 0,
          completionTokens: res.usage?.completion_tokens ?? 0,
        },
        latencyMs: Date.now() - started,
        ttftMs: null,
        stopReason: res.choices[0]?.finish_reason ?? null,
      };
    } catch (err) {
      if (err instanceof QuotaExhaustedError) throw err;
      throw new ProviderError(`openai complete failed: ${String(err)}`, 'openai', err);
    }
  }

  async *stream(req: CompletionRequest): AsyncIterable<StreamChunk> {
    const started = Date.now();
    let ttft: number | null = null;
    let text = '';
    let stopReason: string | null = null;
    let promptTokens = 0;
    let completionTokens = 0;

    try {
      const s = await withRetry('openai.stream', () => this.client.chat.completions.create({
        model: this.id,
        max_tokens: req.maxTokens ?? 300,
        temperature: req.temperature ?? 0,
        seed: req.seed,
        stop: req.stopSequences,
        messages: this.messages(req),
        stream: true,
        stream_options: { include_usage: true },
      }));

      for await (const chunk of s) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          if (ttft === null) ttft = Date.now() - started;
          text += delta;
          yield { type: 'delta', text: delta };
        }
        if (chunk.choices[0]?.finish_reason) stopReason = chunk.choices[0].finish_reason;
        if (chunk.usage) {
          promptTokens = chunk.usage.prompt_tokens;
          completionTokens = chunk.usage.completion_tokens;
        }
      }
    } catch (err) {
      if (err instanceof QuotaExhaustedError) throw err;
      throw new ProviderError(`openai stream failed: ${String(err)}`, 'openai', err);
    }

    recordUsage(this.id, promptTokens, completionTokens);
    yield {
      type: 'done',
      response: {
        text,
        provider: 'openai',
        model: this.id,
        usage: { promptTokens, completionTokens },
        latencyMs: Date.now() - started,
        ttftMs: ttft,
        stopReason,
      },
    };
  }
}
