import './load-env';
import { runTurn } from '../lib/agent/loop';
import { newConversationState, type Turn } from '../lib/agent/types';
import { MemorySlotStore } from '../lib/booking/memory-store';
import { generateSlots } from '../lib/booking/seed';
import { MockProvider } from '../lib/llm/mock';
import { setProviderOverride } from '../lib/llm/registry';
import type { CompletionRequest, CompletionResponse, LLMProvider, StreamChunk } from '../lib/llm/provider';

/**
 * Replay a recorded transcript through the real turn loop, with the agent's
 * exact recorded words played back by a stub provider.
 *
 * This isolates the state machine from the model: if a booking fails here, the
 * fault is in the loop's slot resolution rather than in what the model said.
 */
const NOW = Date.UTC(2026, 8, 1, 9, 0, 0);

class ReplayProvider implements LLMProvider {
  readonly provider = 'mock' as const;
  readonly id = 'replay';
  private i = 0;
  constructor(private lines: string[]) {}
  async complete(): Promise<CompletionResponse> {
    const text = this.lines[Math.min(this.i++, this.lines.length - 1)] ?? '';
    return { text, provider: 'mock', model: 'replay', usage: { promptTokens: 0, completionTokens: 0 }, latencyMs: 1, ttftMs: 1, stopReason: 'end_turn' };
  }
  async *stream(req: CompletionRequest): AsyncIterable<StreamChunk> {
    const response = await this.complete();
    yield { type: 'delta', text: response.text };
    yield { type: 'done', response };
  }
}

const TERSE: [string, string][] = [
  ['need a clean', 'I can get you in with one of our dentists to take a look, tomorrow at 10am in Docklands or 11am in Shoreditch, does either work?'],
  ['k that one', "what's your name, so i can pop it in?"],
  ['sam', 'Booked, Sam, tomorrow at 11am in Shoreditch with Dr Priya Nair.'],
];

async function main() {
  setProviderOverride('agent', new ReplayProvider(TERSE.map(([, a]) => a)));
  // The guardrail role would otherwise make a real paid call per turn.
  setProviderOverride('guardrail', MockProvider.forRole('guardrail'));

  const store = new MemorySlotStore(() => NOW);
  await store.reset(generateSlots(NOW));
  let state = newConversationState('replay', 'info_card', NOW);
  const history: Turn[] = [];

  for (const [user] of TERSE) {
    const res = await runTurn({ message: user, state, history, store, now: NOW });
    state = res.state;
    history.push({ role: 'user', content: user, at: NOW });
    for (const b of res.bubbles) history.push({ role: 'assistant', content: b.text, at: NOW });
    console.log(`v  ${user}`);
    console.log(`n  ${res.bubbles.map((b) => b.text).join(' ')}`);
    console.log(
      `   state name=${state.name} reason=${state.reason} offered=${state.offeredSlotIds.length} held=${state.heldSlotId ? 'yes' : 'no'} booked=${state.bookedSlotId ? 'YES' : 'no'} regen=${res.trace.regenerations} action=${res.trace.action.kind} out=${res.trace.outputVerdict.labels.join(',') || 'ok'}`,
    );
  }
}
main().catch((e) => console.error(e));
