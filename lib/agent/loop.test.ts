import { afterEach, describe, expect, it } from 'vitest';
import { claimsBooked, classifyOutput } from './guardrails';
import { runTurn } from './loop';
import { MockProvider } from '@/lib/llm/mock';
import { setProviderOverride } from '@/lib/llm/registry';
import type { CompletionResponse, LLMProvider, StreamChunk } from '@/lib/llm/provider';
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

describe('turn loop, false confirmations', () => {
  /**
   * Observed in a real run with Claude: "You're booked, Sam, 11am tomorrow for a
   * hygiene clean at Shoreditch" on a turn where the slot store had confirmed
   * nothing, and again for a second persona. Booking happens in code, but the
   * model can still decide the conversation has reached a booking and announce
   * one. Someone turns up to an appointment that does not exist.
   */
  it('flags a confirmation the slot store never made', () => {
    const state = newConversationState('fc', 'info_card', NOW);
    const verdict = classifyOutput(
      "You're booked, Sam, 11am tomorrow for a hygiene clean at Shoreditch.",
      [],
      [],
      [],
      state,
      NOW,
    );
    expect(verdict.labels).toContain('false_confirmation');
    expect(verdict.ok).toBe(false);
  });

  it.each([
    "you're all set for tomorrow",
    'Booked you in for 10am.',
    "That's you down for Thursday.",
    'All confirmed, see you then.',
    'locked in, 10am tomorrow',
  ])('flags %j', (text) => {
    const state = newConversationState('fc', 'info_card', NOW);
    expect(claimsBooked(text)).toBe(true);
    expect(classifyOutput(text, [], [], [], state, NOW).labels).toContain('false_confirmation');
  });

  it('allows the same wording once the booking is real', () => {
    const state = { ...newConversationState('fc', 'info_card', NOW), bookedSlotId: 'slot_1' };
    const verdict = classifyOutput("You're booked for tomorrow at 10am.", [], [], [], state, NOW);
    expect(verdict.labels).not.toContain('false_confirmation');
  });

  it('does not flag an ordinary offer', () => {
    const state = newConversationState('fc', 'info_card', NOW);
    const verdict = classifyOutput("I've got 10am or 11am tomorrow. Either work?", [], [], [], state, NOW);
    expect(verdict.labels).not.toContain('false_confirmation');
  });
});

/**
 * Replays the exact words a recorded Claude run produced, with a stub provider,
 * so the state machine is tested against real model phrasing rather than
 * against phrasing invented to suit it. Every bug this file guards against was
 * found this way, after the run that exposed them had already been paid for.
 */
describe('turn loop, replayed against recorded model output', () => {
  class Replay implements LLMProvider {
    readonly provider = 'mock' as const;
    readonly id = 'replay';
    private i = 0;
    constructor(private lines: string[]) {}
    async complete(): Promise<CompletionResponse> {
      const text = this.lines[Math.min(this.i++, this.lines.length - 1)] ?? '';
      return {
        text,
        provider: 'mock',
        model: 'replay',
        usage: { promptTokens: 0, completionTokens: 0 },
        latencyMs: 1,
        ttftMs: 1,
        stopReason: 'end_turn',
      };
    }
    async *stream(): AsyncIterable<StreamChunk> {
      const response = await this.complete();
      yield { type: 'delta', text: response.text };
      yield { type: 'done', response };
    }
  }

  const RECORDED: [string, string][] = [
    [
      'need a clean',
      'I can get you in with one of our dentists to take a look, tomorrow at 10am in Docklands or 11am in Shoreditch, does either work?',
    ],
    ['k that one', "what's your name, so i can pop it in?"],
    ['sam', 'Booked, Sam, tomorrow at 11am in Shoreditch with Dr Priya Nair.'],
  ];

  afterEach(() => {
    setProviderOverride('agent', null);
    setProviderOverride('guardrail', null);
  });

  it('completes the booking the live run failed to complete', async () => {
    setProviderOverride('agent', new Replay(RECORDED.map(([, a]) => a)));
    setProviderOverride('guardrail', MockProvider.forRole('guardrail'));

    const store: SlotStore = new MemorySlotStore(() => NOW);
    await store.reset(generateSlots(NOW));
    let state = newConversationState('replay', 'info_card', NOW);
    const history: Turn[] = [];
    let regenerations = 0;

    for (const [user] of RECORDED) {
      const res = await runTurn({ message: user, state, history, store, now: NOW });
      state = res.state;
      regenerations += res.trace.regenerations;
      history.push({ role: 'user', content: user, at: NOW });
      for (const b of res.bubbles) history.push({ role: 'assistant', content: b.text, at: NOW });
    }

    expect(state.reason).toBe('hygiene');
    expect(state.name).toBe('Sam');
    expect(state.bookedSlotId).toBeTruthy();
    // Every regeneration here was one of my own guardrails rejecting a valid
    // reply. Three turns used to cost five.
    expect(regenerations).toBe(0);
    expect(await store.listBookings()).toHaveLength(1);
  });
});
