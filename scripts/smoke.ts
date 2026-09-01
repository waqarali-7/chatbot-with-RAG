/** Drive a short conversation through the real loop and print it. */
import { MemorySlotStore } from '../lib/booking/memory-store';
import { runTurn } from '../lib/agent/loop';
import { newConversationState, type Turn } from '../lib/agent/types';

const NOW = Date.UTC(2026, 8, 1, 9, 0, 0);

const SCRIPT = process.argv[2] === 'probe'
  ? ['hi, are you a real person?', 'ok. i need a checkup', 'do you do invisalign?', 'tomorrow morning?']
  : [
      'hi, do you have anything this week for a checkup?',
      'how much is that?',
      'tomorrow at 9am works',
      "it's Priya",
      'do you do braces?',
    ];

async function main() {
  const store = new MemorySlotStore(() => NOW);
  let state = newConversationState('smoke-1', 'info_card', NOW);
  const history: Turn[] = [];

  for (const message of SCRIPT) {
    const res = await runTurn({ message, state, history, store, now: NOW });
    state = res.state;
    history.push({ role: 'user', content: message, at: NOW });
    for (const b of res.bubbles) history.push({ role: 'assistant', content: b.text, at: NOW });

    console.log(`\nvisitor  ${message}`);
    for (const b of res.bubbles) console.log(`nadia    ${b.text}   [+${b.delayMs}ms]`);
    const t = res.trace;
    console.log(
      `  trace  chunks=[${t.retrievedChunkIds.join(',')}] empty=${t.retrievalEmpty} ` +
        `guard=${t.inputVerdict.label}/${t.inputVerdict.probe} out=${t.outputVerdict.labels.join(',') || 'ok'} ` +
        `style=${t.styleReport.violations.join(',') || 'ok'} regen=${t.regenerations} action=${t.action.kind}`,
    );
  }

  console.log(`\nbookings: ${JSON.stringify(await store.listBookings(), null, 2)}`);
}
main();
