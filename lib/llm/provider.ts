import type { ProviderId, Role } from '@/config/models';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export interface CompletionRequest {
  role: Role;
  system: string;
  messages: Message[];
  maxTokens?: number;
  temperature?: number;
  stopSequences?: string[];
  /** Determinism hint. Honoured by the offline provider and by OpenAI. */
  seed?: number;
  /**
   * Out-of-band structured context. Real providers ignore this entirely; it
   * exists so the deterministic offline provider can see the same derived
   * conversation state the prompt was built from without polluting the prompt.
   */
  meta?: Record<string, unknown>;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
}

export interface CompletionResponse {
  text: string;
  provider: ProviderId;
  model: string;
  usage: Usage;
  latencyMs: number;
  /** Time to first token. Only populated on streamed calls. */
  ttftMs: number | null;
  stopReason: string | null;
}

export type StreamChunk =
  | { type: 'delta'; text: string }
  | { type: 'done'; response: CompletionResponse };

export interface LLMProvider {
  /** Pinned model string. Appears in every trace and every result file. */
  readonly id: string;
  readonly provider: ProviderId;
  complete(req: CompletionRequest): Promise<CompletionResponse>;
  stream(req: CompletionRequest): AsyncIterable<StreamChunk>;
}

/** Default stream implementation for providers whose SDK only exposes complete(). */
export async function* streamFromComplete(
  req: CompletionRequest,
  complete: (r: CompletionRequest) => Promise<CompletionResponse>,
): AsyncIterable<StreamChunk> {
  const res = await complete(req);
  yield { type: 'delta', text: res.text };
  yield { type: 'done', response: { ...res, ttftMs: res.latencyMs } };
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly provider: ProviderId,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
