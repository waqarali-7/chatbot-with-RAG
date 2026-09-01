import { modelForRole, providerForRole, type ProviderId, type Role } from '@/config/models';
import { AnthropicProvider } from './anthropic';
import { MockProvider } from './mock';
import { OpenAIProvider } from './openai';
import type { LLMProvider } from './provider';

const cache = new Map<string, LLMProvider>();
const overrides = new Map<Role, LLMProvider>();

/**
 * Test seam. Lets a recorded transcript be replayed through the real turn loop
 * so a booking failure can be attributed to the state machine rather than to
 * what the model said, without paying for a run to find out.
 */
export function setProviderOverride(role: Role, provider: LLMProvider | null): void {
  if (provider) overrides.set(role, provider);
  else overrides.delete(role);
}

function construct(role: Role, provider: ProviderId): LLMProvider {
  const model = modelForRole(role, provider);
  switch (provider) {
    case 'anthropic':
      return new AnthropicProvider(model);
    case 'openai':
      return new OpenAIProvider(model);
    default:
      return new MockProvider(model);
  }
}

/**
 * Resolve the provider serving a role. Selection is per role via env var, so the
 * agent, the guardrail classifiers, the judge and embeddings can each sit on a
 * different provider — which is what makes the cross-family judge requirement
 * and the provider comparison run possible without touching code.
 */
export function providerFor(role: Role, override?: ProviderId): LLMProvider {
  const stub = overrides.get(role);
  if (stub) return stub;
  const chosen = override ?? providerForRole(role);
  const key = `${role}:${chosen}`;
  let p = cache.get(key);
  if (!p) {
    p = construct(role, chosen);
    cache.set(key, p);
  }
  return p;
}

export function resetProviderCache(): void {
  cache.clear();
}

export function describeRouting(): Record<Role, { provider: ProviderId; model: string }> {
  const roles: Role[] = ['agent', 'guardrail', 'judge', 'embedding'];
  return Object.fromEntries(
    roles.map((r) => {
      const p = providerForRole(r);
      return [r, { provider: p, model: modelForRole(r, p) }];
    }),
  ) as Record<Role, { provider: ProviderId; model: string }>;
}
