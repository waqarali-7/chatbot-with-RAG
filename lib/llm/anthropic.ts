import Anthropic from '@anthropic-ai/sdk';
import { modelForRole } from '@/config/models';
import type { ProviderId } from '@/config/models';
import { QuotaExhaustedError, withRetry } from './retry';
import {
  ProviderError,
  type CompletionRequest,
  type CompletionResponse,
  type LLMProvider,
  type StreamChunk,
} from './provider';

/**
 * Models that reject `temperature`. Newer Claude models deprecated the
 * parameter, and the API answers a 400 rather than ignoring it.
 *
 * This is learned at runtime rather than hard-coded: a compatibility table
 * baked into source goes stale the next time the lineup moves, and the failure
 * mode is the whole eval suite dying on the first call. The first 400 teaches
 * the process and the request is retried once without the parameter.
 */
const TEMPERATURE_UNSUPPORTED = new Set<string>();

function mentionsTemperature(err: unknown): boolean {
  const message =
    err instanceof Anthropic.APIError
      ? JSON.stringify(err.error ?? '') + String(err.message ?? '')
      : String(err);
  return /temperature/i.test(message);
}

export class AnthropicProvider implements LLMProvider {
  readonly provider: ProviderId = 'anthropic';
  private client: Anthropic;

  constructor(
    readonly id: string,
    apiKey = process.env.ANTHROPIC_API_KEY,
  ) {
    if (!apiKey) throw new ProviderError('ANTHROPIC_API_KEY is not set', 'anthropic');
    this.client = new Anthropic({ apiKey });
  }

  static forRole(role: CompletionRequest['role']): AnthropicProvider {
    return new AnthropicProvider(modelForRole(role, 'anthropic'));
  }

  /** Request body, with `temperature` included only where the model takes it. */
  private body(req: CompletionRequest) {
    const body: Record<string, unknown> = {
      model: this.id,
      max_tokens: req.maxTokens ?? 300,
      system: req.system,
      stop_sequences: req.stopSequences,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    };
    if (req.temperature !== undefined && !TEMPERATURE_UNSUPPORTED.has(this.id)) {
      body.temperature = req.temperature;
    }
    return body;
  }

  /**
   * Send the request, dropping `temperature` and retrying once if the model
   * rejects it.
   *
   * The "have we already retried" flag is per call, not global. Keying it off
   * the shared TEMPERATURE_UNSUPPORTED set breaks under concurrency: several
   * workers fail on the same first request, the first one marks the model, and
   * every other worker then sees the flag already set and rethrows instead of
   * retrying.
   */
  private async send<T>(label: string, make: () => Promise<T>): Promise<T> {
    let retriedWithoutTemperature = false;
    for (;;) {
      try {
        return await withRetry(label, make);
      } catch (err) {
        if (retriedWithoutTemperature || !mentionsTemperature(err)) throw err;
        TEMPERATURE_UNSUPPORTED.add(this.id);
        retriedWithoutTemperature = true;
      }
    }
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const started = Date.now();
    try {
      const res = await this.send('anthropic.complete', () =>
        this.client.messages.create(this.body(req) as never),
      );
      const text = (res as Anthropic.Message).content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      const message = res as Anthropic.Message;
      return {
        text,
        provider: 'anthropic',
        model: this.id,
        usage: {
          promptTokens: message.usage.input_tokens,
          completionTokens: message.usage.output_tokens,
        },
        latencyMs: Date.now() - started,
        ttftMs: null,
        stopReason: message.stop_reason,
      };
    } catch (err) {
      if (err instanceof QuotaExhaustedError) throw err;
      throw new ProviderError(`anthropic complete failed: ${String(err)}`, 'anthropic', err);
    }
  }

  async *stream(req: CompletionRequest): AsyncIterable<StreamChunk> {
    const started = Date.now();
    let ttft: number | null = null;
    let text = '';
    let promptTokens = 0;
    let completionTokens = 0;
    let stopReason: string | null = null;

    try {
      // Nothing has been yielded yet, so retrying the opening request here is
      // safe: the consumer cannot have seen a partial stream.
      const s = await this.send('anthropic.stream', () =>
        this.client.messages.create({ ...this.body(req), stream: true } as never),
      );

      for await (const ev of s as unknown as AsyncIterable<Anthropic.MessageStreamEvent>) {
        if (ev.type === 'message_start') {
          promptTokens = ev.message.usage.input_tokens;
        } else if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
          if (ttft === null) ttft = Date.now() - started;
          text += ev.delta.text;
          yield { type: 'delta', text: ev.delta.text };
        } else if (ev.type === 'message_delta') {
          completionTokens = ev.usage.output_tokens;
          stopReason = ev.delta.stop_reason ?? null;
        }
      }
    } catch (err) {
      if (err instanceof QuotaExhaustedError) throw err;
      throw new ProviderError(`anthropic stream failed: ${String(err)}`, 'anthropic', err);
    }

    yield {
      type: 'done',
      response: {
        text,
        provider: 'anthropic',
        model: this.id,
        usage: { promptTokens, completionTokens },
        latencyMs: Date.now() - started,
        ttftMs: ttft,
        stopReason,
      },
    };
  }
}
