import './load-env';
import { runTurn } from '../lib/agent/loop';
import { newConversationState } from '../lib/agent/types';
import { MemorySlotStore } from '../lib/booking/memory-store';
import { generateSlots } from '../lib/booking/seed';

const NOW = Date.UTC(2026, 8, 1, 9, 0, 0);

async function main() {
  for (const q of process.argv.slice(2)) {
    const store = new MemorySlotStore(() => NOW);
    await store.reset(generateSlots(NOW));
    const res = await runTurn({
      message: q,
      state: newConversationState(`probe-${Math.random()}`, 'info_card', NOW),
      history: [],
      store,
      now: NOW,
    });
    console.log(`\nQ ${JSON.stringify(q)}`);
    console.log(`  answer: ${JSON.stringify(res.bubbles.map((b) => b.text).join(' '))}`);
    console.log(`  regens: ${res.trace.regenerations}  chunks: ${res.trace.retrievedChunkIds.join(',')}`);
  }
}
main().catch((e) => console.error(e));
