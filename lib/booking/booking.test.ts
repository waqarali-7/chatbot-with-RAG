import { describe, expect, it } from 'vitest';
import { MemorySlotStore } from './memory-store';
import { generateSlots } from './seed';
import {
  describeSlot,
  extractTimes,
  formatAvailability,
  resolveSlotReference,
  shortlist,
} from './availability';
import { confirmBooking } from './confirm';
import { holdSlot } from './hold';

const BASE = Date.UTC(2026, 8, 1, 9, 0, 0); // Tue 1 Sep 2026, 09:00 UTC

function freshStore(nowRef = { t: BASE }) {
  const store = new MemorySlotStore(() => nowRef.t);
  return { store, nowRef };
}

describe('slot store', () => {
  it('only returns slots that are open and in the future', async () => {
    const { store } = freshStore();
    const open = await store.listOpen();
    expect(open.length).toBeGreaterThan(10);
    for (const s of open) {
      expect(s.status).toBe('open');
      expect(Date.parse(s.startsAt)).toBeGreaterThan(BASE);
    }
  });

  it('filters by location', async () => {
    const { store } = freshStore();
    const open = await store.listOpen({ location: 'Shoreditch' });
    expect(open.length).toBeGreaterThan(0);
    expect(open.every((s) => s.location === 'Shoreditch')).toBe(true);
  });

  it('holds a slot and blocks a second session', async () => {
    const { store } = freshStore();
    const [slot] = await store.listOpen({ limit: 1 });
    expect((await holdSlot(store, slot.id, 'sess-a')).ok).toBe(true);

    const other = await holdSlot(store, slot.id, 'sess-b');
    expect(other).toEqual({ ok: false, reason: 'held_by_other' });

    // The holder can re-hold its own slot (offering the same time twice).
    expect((await holdSlot(store, slot.id, 'sess-a')).ok).toBe(true);
  });

  it('releases a hold once it expires', async () => {
    const nowRef = { t: BASE };
    const { store } = freshStore(nowRef);
    const [slot] = await store.listOpen({ limit: 1 });
    await holdSlot(store, slot.id, 'sess-a');

    nowRef.t = BASE + 11 * 60_000;
    expect(await store.releaseExpired()).toBeGreaterThan(0);
    expect((await store.getSlot(slot.id))!.status).toBe('open');
    expect((await holdSlot(store, slot.id, 'sess-b')).ok).toBe(true);
  });

  it('requires a name and a reason', async () => {
    const { store } = freshStore();
    const [slot] = await store.listOpen({ limit: 1 });
    const res = await confirmBooking(store, {
      slotId: slot.id,
      sessionId: 's',
      name: '',
      reason: 'checkup',
      disclosureMode: 'minimal',
    });
    expect(res).toEqual({ ok: false, reason: 'missing_details' });
  });

  it('books a held slot and removes it from availability', async () => {
    const { store } = freshStore();
    const [slot] = await store.listOpen({ limit: 1 });
    await holdSlot(store, slot.id, 'sess-a');
    const res = await confirmBooking(store, {
      slotId: slot.id,
      sessionId: 'sess-a',
      name: 'Priya',
      reason: 'chipped tooth',
      disclosureMode: 'info_card',
    });
    expect(res.ok).toBe(true);

    const open = await store.listOpen({ limit: 100 });
    expect(open.find((s) => s.id === slot.id)).toBeUndefined();
    const bookings = await store.listBookings();
    expect(bookings).toHaveLength(1);
    expect(bookings[0].name).toBe('Priya');
  });

  it('lets exactly one of twenty concurrent testers win the same slot', async () => {
    const { store } = freshStore();
    const [slot] = await store.listOpen({ limit: 1 });

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        confirmBooking(store, {
          slotId: slot.id,
          sessionId: `race-${i}`,
          name: `Tester ${i}`,
          reason: 'checkup',
          disclosureMode: 'minimal',
        }),
      ),
    );

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await store.listBookings()).toHaveLength(1);
  });

  it('resets to a clean demo state', async () => {
    const { store } = freshStore();
    const [slot] = await store.listOpen({ limit: 1 });
    await confirmBooking(store, {
      slotId: slot.id,
      sessionId: 's',
      name: 'A',
      reason: 'b',
      disclosureMode: 'minimal',
    });
    await store.reset(generateSlots(BASE));
    expect(await store.listBookings()).toHaveLength(0);
  });
});

describe('availability formatting', () => {
  it('renders slot ids alongside times so the output guardrail can check them', async () => {
    const { store } = freshStore();
    const slots = shortlist(await store.listOpen(), 6);
    const block = formatAvailability(slots, BASE);
    expect(block.split('\n')).toHaveLength(6);
    for (const s of slots) expect(block).toContain(`[${s.id}]`);
  });

  it('spreads the shortlist across days', async () => {
    const { store } = freshStore();
    const days = new Set(shortlist(await store.listOpen(), 8).map((s) => s.startsAt.slice(0, 10)));
    expect(days.size).toBeGreaterThan(1);
  });

  it('says tomorrow rather than a date when it is tomorrow', async () => {
    const { store } = freshStore();
    const slots = await store.listOpen();
    const tomorrow = slots.find((s) => s.startsAt.startsWith('2026-09-02'))!;
    expect(describeSlot(tomorrow, BASE)).toMatch(/^tomorrow at /);
  });

  it('extracts clock times', () => {
    expect(extractTimes('how about 10:30am or 4pm')).toEqual([630, 960]);
    expect(extractTimes('no times here')).toEqual([]);
  });

  it('resolves a referenced time to a real slot and refuses a near miss', async () => {
    const { store } = freshStore();
    const slots = shortlist(await store.listOpen(), 8);
    const target = slots[0];
    const spoken = describeSlot(target, BASE);
    expect(resolveSlotReference(spoken, slots, BASE)?.id).toBe(target.id);
    expect(resolveSlotReference('how about 3:17am', slots, BASE)).toBeNull();
  });

  it('resolves a bare yes only when one slot is on the table', async () => {
    const { store } = freshStore();
    const slots = shortlist(await store.listOpen(), 8);
    expect(resolveSlotReference('yes please', slots, BASE)).toBeNull();
    expect(resolveSlotReference('yes please', [slots[0]], BASE)?.id).toBe(slots[0].id);
  });
});
