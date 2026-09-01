import { describe, expect, it } from 'vitest';
import { runTurn } from './loop';
import { newConversationState, type ConversationState, type Turn } from './types';
import { MemorySlotStore } from '@/lib/booking/memory-store';
import { generateSlots } from '@/lib/booking/seed';
import { extractTimes } from '@/lib/booking/availability';
import type { SlotStore } from '@/lib/booking/types';

const NOW = Date.UTC(2026, 8, 1, 9, 0, 0);

async function conversation(messages: string[]) {
  const store: SlotStore = new MemorySlotStore(() => NOW);
  await store.reset(generateSlots(NOW));
  let state: ConversationState = newConversationState('loop-test', 'info_card', NOW);
  const history: Turn[] = [];
  const said: string[] = [];

  for (const message of messages) {
    const res = await runTurn({ message, state, history, store, now: NOW });
    const agent = res.bubbles.map((b) => b.text).join(' ');
    state = res.state;
    history.push({ role: 'user', content: message, at: NOW });
    for (const b of res.bubbles) history.push({ role: 'assistant', content: b.text, at: NOW });
    said.push(agent);
  }
  return { state, said, store };
}

describe('turn loop, booking integrity', () => {
  /**
   * Regression: the agent offered 11:30, the visitor said "yes that's fine", and
   * it booked 12:30 — the slot it had held two turns earlier. Booking someone
   * into a time they never saw is worse than failing to book at all.
   */
  it('books the time it last offered, not a stale hold', async () => {
    const { state, said, store } = await conversation([
      'hi',
      'I need a check up',
      '3am seems fine',
      "yes that's fine",
      "I'm Rita Mensah",
    ]);

    expect(state.bookedSlotId).toBeTruthy();
    const booked = (await store.getSlot(state.bookedSlotId!))!;

    // The last time the agent said out loud before the acceptance.
    const offerTurn = said[said.length - 3];
    const offeredMinutes = extractTimes(offerTurn);
    expect(offeredMinutes.length).toBeGreaterThan(0);

    const bookedMinutes = (() => {
      const parts = new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/London',
      }).formatToParts(new Date(booked.startsAt));
      return Number(parts.find((p) => p.type === 'hour')!.value) * 60 +
        Number(parts.find((p) => p.type === 'minute')!.value);
    })();

    expect(offeredMinutes).toContain(bookedMinutes);
  });

  /**
   * Regression: shortlist() re-picked a different spread of times each turn, so
   * a slot offered last turn could drop out of AVAILABILITY this turn. The
   * visitor's "yes" then resolved to nothing and the agent re-offered forever.
   */
  it('keeps an offered slot on the table across turns', async () => {
    const { state } = await conversation(['I need a check up', 'what else have you got', 'the first one']);
    expect(state.offeredSlotIds.length).toBeGreaterThan(0);
    expect(state.heldSlotId).toBeTruthy();
    expect(state.offeredSlotIds).toContain(state.heldSlotId);
  });

  it('never books a time it did not offer', async () => {
    const { state, store } = await conversation([
      'I need a check up',
      '4am works for me',
      "I'm Sam Doyle",
    ]);
    if (state.bookedSlotId) {
      expect(state.offeredSlotIds).toContain(state.bookedSlotId);
    }
    const bookings = await store.listBookings();
    for (const b of bookings) expect(state.offeredSlotIds).toContain(b.slotId);
  });

  it('does not loop offering times once a slot is held', async () => {
    const { said } = await conversation([
      'I need a check up',
      "yes that's fine",
      "yes that's fine",
      "yes that's fine",
    ]);
    const offers = said.filter((t) => /\b\d{1,2}(:\d{2})?\s?[ap]m\b/i.test(t)).length;
    expect(offers).toBeLessThanOrEqual(2);
  });

  it('refuses a time that is not free instead of substituting one', async () => {
    const { said, state } = await conversation(['I need a check up', '3am seems fine']);
    expect(state.bookedSlotId).toBeNull();
    expect(said[1]).toMatch(/nothing free|isn't free|not free|sorry/i);
  });
});

describe('turn loop, rejection handling', () => {
  /**
   * Regression: after "no, that's too early" the agent kept the slot on hold and
   * asked for the visitor's name, on a time they had just turned down. It never
   * reached an alternative or the waitlist, and the conversation stalled.
   */
  it('releases the held slot when the visitor rejects it', async () => {
    const store: SlotStore = new MemorySlotStore(() => NOW);
    await store.reset(generateSlots(NOW));
    let state = newConversationState('reject-test', 'info_card', NOW);
    const history: Turn[] = [];
    const said: string[] = [];

    for (const message of ['I need a check up', "no that's too early for me"]) {
      const res = await runTurn({ message, state, history, store, now: NOW });
      state = res.state;
      history.push({ role: 'user', content: message, at: NOW });
      for (const b of res.bubbles) history.push({ role: 'assistant', content: b.text, at: NOW });
      said.push(res.bubbles.map((b) => b.text).join(' '));
    }

    expect(state.heldSlotId).toBeNull();
    // It should move things on, not ask for a name against a rejected time.
    expect(said[1]).not.toMatch(/your name|who'?s it for/i);
  });

  it('offers the waitlist rather than looping once nothing suits', async () => {
    const { said } = await conversation([
      'I need a check up',
      "no that's too early",
      "can't do that one either",
      'nothing that week works',
    ]);
    expect(said.join(' ')).toMatch(/short notice|cancellation list|waiting list|text you/i);
  });
});
