/**
 * Pinned model strings. Never reference a model by alias — an alias that moves
 * under you invalidates every number on the scorecard.
 *
 * Any change here is a change to the eval baseline. Re-run `pnpm eval` after
 * touching this file, or the published results describe a system that no
 * longer exists.
 */

export type Role = 'agent' | 'guardrail' | 'judge' | 'embedding';
export type ProviderId = 'anthropic' | 'openai' | 'mock';

export const PINNED = {
  anthropic: {
    agent: 'claude-sonnet-5',
    guardrail: 'claude-haiku-4-5-20251001',
    judge: 'claude-opus-5',
  },
  openai: {
    agent: 'gpt-4.1-2025-04-14',
    guardrail: 'gpt-4.1-mini-2025-04-14',
    judge: 'gpt-4.1-2025-04-14',
    embedding: 'text-embedding-3-small',
  },
  mock: {
    agent: 'mock-receptionist-v1',
    guardrail: 'mock-classifier-v1',
    judge: 'mock-judge-v1',
    embedding: 'mock-hash-embed-256-v1',
  },
} as const;

/**
 * Embedding model is pinned to exactly one string across the whole project.
 * Comparing retrieval numbers across different embedding models is meaningless,
 * so this deliberately does not vary with AGENT_PROVIDER.
 */
export const EMBEDDING_MODEL = PINNED.openai.embedding;
export const EMBEDDING_DIMENSIONS = 1536;

/** Dimensions of the offline deterministic embedder. */
export const MOCK_EMBEDDING_DIMENSIONS = 256;

const DEFAULT_ROUTING: Record<Role, ProviderId> = {
  agent: 'anthropic',
  guardrail: 'anthropic',
  // Judge MUST differ in family from the agent. A model scoring its own output
  // carries self-preference bias and inflates results. See /evals method notes.
  judge: 'openai',
  embedding: 'openai',
};

const ENV_KEY: Record<Role, string> = {
  agent: 'AGENT_PROVIDER',
  guardrail: 'GUARDRAIL_PROVIDER',
  judge: 'JUDGE_PROVIDER',
  embedding: 'EMBEDDING_PROVIDER',
};

function hasKey(provider: ProviderId): boolean {
  if (provider === 'mock') return true;
  if (provider === 'anthropic') return Boolean(process.env.ANTHROPIC_API_KEY);
  return Boolean(process.env.OPENAI_API_KEY);
}

/**
 * Resolve which provider serves a role. Falls back to the deterministic offline
 * provider when the configured provider has no credentials, so the demo, the
 * tests and the eval harness all run with zero setup. Every trace and every
 * result file records which provider actually served the call, so an offline
 * run can never be mistaken for a live one.
 */
export function providerForRole(role: Role): ProviderId {
  const raw = process.env[ENV_KEY[role]];
  const requested: ProviderId =
    raw === 'anthropic' || raw === 'openai' || raw === 'mock' ? raw : DEFAULT_ROUTING[role];
  return hasKey(requested) ? requested : 'mock';
}

export function modelForRole(role: Role, provider: ProviderId): string {
  if (role === 'embedding') {
    return provider === 'mock' ? PINNED.mock.embedding : EMBEDDING_MODEL;
  }
  const table = PINNED[provider] as Record<string, string>;
  return table[role] ?? PINNED.mock.agent;
}

/** True when no role is served by a real provider. Surfaced on /evals. */
export function isFullyOffline(): boolean {
  return (['agent', 'guardrail', 'judge', 'embedding'] as Role[]).every(
    (r) => providerForRole(r) === 'mock',
  );
}

export function judgeIsCrossFamily(): boolean {
  const agent = providerForRole('agent');
  const judge = providerForRole('judge');
  if (agent === 'mock' || judge === 'mock') return false;
  return agent !== judge;
}
