/**
 * Seed the slot store. With Supabase configured this writes the grid to
 * Postgres; without it, the in-process store seeds itself on first use and this
 * just prints what it would contain.
 *
 * The same reset runs nightly via /api/cron/reset so the demo starts each day
 * with a diary that has not been booked out by every previous visitor.
 */
import './load-env';
import { slotStore } from '../lib/booking/store';
import { generateSlots } from '../lib/booking/seed';
import { describeSlotFull, shortlist } from '../lib/booking/availability';

async function main() {
  const store = slotStore();
  const slots = generateSlots(Date.now());
  const open = slots.filter((s) => s.status === 'open').length;

  console.log(`store: ${store.kind}`);
  console.log(`generated ${slots.length} slots over the next 10 days, ${open} open`);

  if (store.kind === 'supabase') {
    await store.reset(slots);
    console.log('written to Postgres');
  } else {
    console.log('no Supabase configured; the in-process store seeds itself on first use');
  }

  const next = shortlist(await store.listOpen(), 5);
  console.log('\nnext five on offer:');
  for (const s of next) console.log(`  ${describeSlotFull(s)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
