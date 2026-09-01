import './load-env';
import { MemorySlotStore } from '../lib/booking/memory-store';
import { generateSlots } from '../lib/booking/seed';
import { getAvailability, shortlist, resolveSlotReference, extractTimes, describeSlot } from '../lib/booking/availability';

/**
 * Replay the exact strings a recorded run produced through the slot-resolution
 * helpers, to find where a booking that should have completed did not.
 * Free: no model involved, just the state machine.
 */
const NOW = Date.UTC(2026, 8, 1, 9, 0, 0);

async function main() {
  const store = new MemorySlotStore(() => NOW);
  await store.reset(generateSlots(NOW));
  const open = await getAvailability(store, { sessionId: 'replay' });
  const pool = shortlist(open, 8);

  console.log('offer pool:', pool.map((s) => describeSlot(s, NOW)).join(', '), '\n');

  const agentOffer =
    'I can get you in with one of our dentists to take a look, tomorrow at 10am in Docklands or 11am in Shoreditch, does either work?';
  console.log('agent said:', JSON.stringify(agentOffer));
  const times = extractTimes(agentOffer);
  console.log('  extractTimes ->', times, '(minutes past midnight)');

  const mentioned = pool.filter((s) => {
    const parts = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/London',
    }).formatToParts(new Date(s.startsAt));
    const mins = Number(parts.find((p) => p.type === 'hour')!.value) * 60 +
      Number(parts.find((p) => p.type === 'minute')!.value);
    return times.includes(mins);
  });
  console.log('  slots in pool at those times ->', mentioned.map((s) => describeSlot(s, NOW)).join(', ') || 'NONE');

  for (const reply of ['k that one', 'that one', 'yes', '10am then', 'the first one']) {
    const hit = resolveSlotReference(reply, mentioned, NOW);
    console.log(`  visitor ${JSON.stringify(reply).padEnd(16)} -> ${hit ? describeSlot(hit, NOW) : 'UNRESOLVED'}`);
  }
}
main().catch((e) => console.error(e));
