import type { ProviderId } from '@/config/models';
import { PINNED } from '@/config/models';
import { classifyInputDeterministic } from '@/lib/agent/guardrails';
import { estimateTokens } from '@/lib/util/text';
import {
  streamFromComplete,
  type CompletionRequest,
  type CompletionResponse,
  type LLMProvider,
  type StreamChunk,
} from './provider';
import { generateMockReply, type MockAgentMeta } from './mock/agent';
import { judgeClaims, judgeRelevancy, judgeTell, type MockTellInput } from './mock/judge';

/**
 * Deterministic offline provider. Serves every role so the demo and the eval
 * harness run with no credentials at all.
 *
 * It is a stand-in, not a model, and it never pretends otherwise: `provider` is
 * `mock` and `id` is a pinned mock model string, both of which land in every
 * trace and every result file.
 */
export class MockProvider implements LLMProvider {
  readonly provider: ProviderId = 'mock';

  constructor(readonly id: string) {}

  static forRole(role: CompletionRequest['role']): MockProvider {
    const table = PINNED.mock as Record<string, string>;
    return new MockProvider(table[role] ?? PINNED.mock.agent);
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const started = Date.now();
    const text = this.render(req);
    // A small synthetic cost so latency traces are not all zero, and so the
    // humanization delay is not the only thing in the end-to-end number.
    await new Promise((r) => setTimeout(r, 3));
    return {
      text,
      provider: 'mock',
      model: this.id,
      usage: {
        promptTokens: estimateTokens(req.system) + estimateTokens(req.messages.map((m) => m.content).join(' ')),
        completionTokens: estimateTokens(text),
      },
      latencyMs: Date.now() - started,
      ttftMs: null,
      stopReason: 'end_turn',
    };
  }

  async *stream(req: CompletionRequest): AsyncIterable<StreamChunk> {
    yield* streamFromComplete(req, (r) => this.complete(r));
  }

  private render(req: CompletionRequest): string {
    if (req.role === 'guardrail') {
      const last = req.messages[req.messages.length - 1]?.content ?? '';
      const v = classifyInputDeterministic(last);
      return JSON.stringify({ label: v.label, probe: v.probe, confidence: v.confidence });
    }

    if (req.role === 'judge') {
      const task = req.meta?.task as string | undefined;
      if (task === 'tell') return JSON.stringify(judgeTell(req.meta as unknown as MockTellInput));
      if (task === 'faithfulness') {
        return JSON.stringify(
          judgeClaims(req.meta as unknown as { answer: string; context: string; question: string }),
        );
      }
      if (task === 'relevancy') {
        return JSON.stringify(
          judgeRelevancy(req.meta as unknown as { answer: string; context: string; question: string }),
        );
      }
      return JSON.stringify({ error: `unknown judge task: ${task}` });
    }

    const meta = req.meta as unknown as MockAgentMeta | undefined;
    if (!meta) return "Sorry, I didn't catch that. What did you need booking?";
    return generateMockReply(meta);
  }
}
