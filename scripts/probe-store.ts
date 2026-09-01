import './load-env';
import { slotStore } from '../lib/booking/store';
import { getAvailability, shortlist, describeSlot } from '../lib/booking/availability';

async function main() {
  const store = slotStore();
  console.log('store kind:', store.kind);

  const open = await getAvailability(store, { sessionId: 'probe-1' });
  console.log('open slots returned:', open.length);
  const pool = shortlist(open, 8);
  console.log('shortlist:', pool.map((s) => `${describeSlot(s)}[${s.id.slice(0, 8)}]`).join(' '));

  const target = pool[0];
  console.log('\nholding', target.id);
  const held = await store.hold(target.id, 'probe-1');
  console.log('hold result:', JSON.stringify(held));

  const after = await store.getSlot(target.id);
  console.log('slot after hold:', JSON.stringify({ status: after?.status, heldBy: after?.heldBy, heldUntil: after?.heldUntil }));

  const open2 = await getAvailability(store, { sessionId: 'probe-1' });
  console.log('own session still sees it:', open2.some((s) => s.id === target.id));
  const open3 = await getAvailability(store, { sessionId: 'other-session' });
  console.log('other session sees it:', open3.some((s) => s.id === target.id));

  console.log('\nconfirming');
  const res = await store.confirm(target.id, 'probe-1', 'Probe Tester', 'check up', 'info_card');
  console.log('confirm result:', JSON.stringify(res).slice(0, 200));
}
main().catch((e) => console.error('FAILED:', e));
