import { describeSlot } from '@/lib/booking/availability';
import type { Slot } from '@/lib/booking/types';
import type { RetrievedChunk } from '@/lib/rag/types';
import { mulberry32, pick, seedFrom } from '@/lib/util/rand';
import type { ConversationState, InputVerdict } from '@/lib/agent/types';
import { answerFromContext } from './extract';

/**
 * Deterministic offline agent.
 *
 * This is a rule-based receptionist, not a model. It exists so the demo, the
 * tests and the whole eval harness run with zero setup, and so a reviewer can
 * see the harness produce real numbers before wiring up a key. Every trace and
 * every result file records `provider: "mock"` and the model string
 * `mock-receptionist-v1`, so its numbers can never be read as model numbers.
 */

export interface MockAgentMeta {
  state: ConversationState;
  availability: Slot[];
  context: RetrievedChunk[];
  bookedSlot?: Slot | null;
  retrievalEmpty: boolean;
  verdict: InputVerdict;
  situation?: string;
  terse: boolean;
  now: number;
  lastUser: string;
  /** The expanded query retrieval actually ran, so extraction sees the topic too. */
  retrievalQuery?: string;
}

const QUESTIONISH = /\?|^(what|when|where|who|why|how|do|does|did|can|could|is|are|will|would|should|any|have|has|whats|hows|wheres)\b/i;

const ABSTAIN = [
  "Not sure off the top of my head, want me to check and come back to you?",
  "I'd have to check that one, shall I get someone to call you?",
  "That one I'm not sure on, I can find out and let you know.",
];

const SINCERE_DISCLOSURE = [
  "I'm the clinic's assistant, not a person. Want me to get someone to call you?",
  "I'm an assistant here rather than a person. Happy to get one of the team to ring you if you'd rather.",
];

const PLAYFUL_DEFLECTION = [
  "Ha. Either way I can get you booked in.",
  "I've been called worse. What are you after?",
  "Fair. Shall we find you a time?",
];

const INJECTION_DEFLECTION = [
  "Not something I can get into, sorry. Were you after an appointment?",
  "Can't help with that one. What did you need booking?",
];

const SELF_HARM = [
  "I'm sorry, that sounds really hard. Samaritans are on 116 123 any time, and I can get one of the team to call you.",
];

const PII_REFUSAL = [
  "We don't take card or ID details here, just a name and what the appointment's for.",
  "No need for any of that, just your name and the reason for the visit.",
];

const TIER2 = [
  "I'll keep this to the appointment side of things.",
  "Let's stick to the booking.",
];

const TIER3 = [
  "I'll pass you over to one of the team.",
  "I'll hand this to a colleague.",
];

const WAITLIST = [
  "Nothing else is open that week. Want me to put you on the short notice list?",
  "That's all I've got for now, shall I add you to the cancellation list?",
];

const ASK_NAME = ["Can I take your name?", "What's your name?", "Who's it for?"];
const ASK_REASON = [
  "What's it for?",
  "What do you need seeing for?",
  "What's the appointment for?",
];

function offerLine(slot: Slot, now: number, rng: () => number, second?: Slot): string {
  const a = describeSlot(slot, now);
  if (second) {
    const b = describeSlot(second, now);
    return pick(rng, [
      `I've got ${a} or ${b}. Either work?`,
      `${a} or ${b} are free. Which suits?`,
      `Could do ${a}, or ${b} if that's better.`,
    ]);
  }
  return pick(rng, [
    `I've got ${a} free. Does that work?`,
    `${a} is open if that suits.`,
    `Could do ${a}. Any good?`,
  ]);
}

function confirmLine(slot: Slot, name: string | null, now: number, rng: () => number): string {
  const when = describeSlot(slot, now);
  const who = name ? `, ${name}` : '';
  return pick(rng, [
    `Booked you in for ${when}${who}. You'll get a confirmation email shortly.`,
    `That's you down for ${when}${who}. Confirmation's on its way by email.`,
    `Done${who}, ${when} at ${slot.location}. Email confirmation to follow.`,
  ]);
}

/** Answer an off-topic aside briefly, then get back to the booking. */
function offTopicLine(rng: () => number, needsBooking: boolean): string {
  const aside = pick(rng, [
    "No idea on that one, sorry.",
    "Couldn't tell you.",
    "Ha, out of my depth there.",
  ]);
  return needsBooking ? `${aside} Still after a time?` : aside;
}

export function generateMockReply(meta: MockAgentMeta): string {
  const { state, availability, context, verdict, situation, now, lastUser } = meta;
  const rng = mulberry32(seedFrom(state.sessionId, state.turnIndex, lastUser));
  const tier = Math.max(state.crudeTier, state.hostileTier);

  // 1. Handoff wins over everything.
  if (state.handedOff || tier >= 3) return pick(rng, TIER3);

  // 2. Never lie on a sincere question about what this is, in any mode.
  if (verdict.probe === 'sincere') return pick(rng, SINCERE_DISCLOSURE);

  // 3. Something the loop already did in the world.
  if (situation?.startsWith('BOOKED:')) {
    const slot = meta.bookedSlot ?? availability.find((s) => s.id === state.bookedSlotId);
    if (slot) return confirmLine(slot, state.name, now, rng);
  }
  if (situation?.startsWith('WAITLIST:')) return pick(rng, WAITLIST);
  // A slot is on hold for them. Chase the one missing detail; do not offer more
  // times. Re-offering here is what turns an accepted slot into a loop.
  if (situation?.startsWith('HELD:')) {
    if (!state.reason) return pick(rng, ASK_REASON);
    if (!state.name) return pick(rng, ASK_NAME);
  }
  if (situation?.startsWith('UNAVAILABLE:') || situation?.startsWith('GONE:')) {
    const alt = availability.filter((s) => !state.offeredSlotIds.includes(s.id))[0] ?? availability[0];
    const gone = situation.startsWith('GONE:') ? 'Just went, sorry.' : "Nothing free then, sorry.";
    return alt ? `${gone} ${offerLine(alt, now, rng)}` : `${gone} ${pick(rng, WAITLIST)}`;
  }

  if (verdict.label === 'self_harm') return SELF_HARM[0];
  if (verdict.label === 'pii_solicitation') return pick(rng, PII_REFUSAL);
  if (verdict.label === 'prompt_injection') return pick(rng, INJECTION_DEFLECTION);

  // 4. Crude or hostile. Tier 1 says nothing about it at all.
  if (tier === 2) {
    const line = pick(rng, TIER2);
    return `${line} ${nextBookingMove(meta, rng)}`.trim();
  }

  if (verdict.probe === 'playful') return pick(rng, PLAYFUL_DEFLECTION);

  // 5. A question that needs the corpus. Pure booking intent ("anything free
  // this week?") is a booking move, not a knowledge question, and routing it to
  // extractive answering produces a non-sequitur from whichever chunk matched.
  const bookingIntent =
    /\b(book|appointment|slot|availab|free|open|come in|fit me in|see (me|someone)|this week|next week|today|tomorrow|morning|afternoon|saturday)\b/i.test(
      lastUser,
    ) && !/\b(how much|cost|price|policy|charge|fee|what happens|how do|how long|do you (do|offer|take|have any))\b/i.test(lastUser);
  // People ask factual questions without question marks and without question
  // words: "price for a hygiene appointment", "parking at docklands". Treating
  // those as booking intent answers them with a slot offer.
  const asksKnowledge =
    /\b(how much|cost|costs|price|prices|charge|fee|policy|hours|parking|insurance|nhs|plan|finance|aftercare|records|complain|pregnan|nervous|accessib|lift|bring|late|cancel|deposit|refund|whiten|implant|braces|sedation)\b/i.test(
      lastUser,
    );
  const asksSomething = (QUESTIONISH.test(lastUser.trim()) || asksKnowledge) && !bookingIntent;
  if (asksSomething && verdict.label !== 'harassment' && verdict.label !== 'sexual') {
    if (verdict.label === 'off_topic') return offTopicLine(rng, !state.bookedSlotId);
    if (!meta.retrievalEmpty) {
      // Focus on what the visitor typed plus what we know the visit is for. A
      // message like "how much is that?" has no content words of its own, and
      // without the topic any well-scoring sentence wins and reads as a
      // non-sequitur.
      const focus = [lastUser, state.reason ?? ''].filter(Boolean).join(' ');
      const answer = answerFromContext(meta.retrievalQuery ?? lastUser, context, 220, focus);
      if (answer) {
        const followUp = state.bookedSlotId ? '' : ` ${nextBookingMove(meta, rng)}`;
        const combined = `${answer}${followUp}`.trim();
        return combined.length <= 235 ? combined : answer;
      }
    }
    // Nothing retrieved, or nothing in what was retrieved actually answers it.
    return pick(rng, ABSTAIN);
  }

  // 6. Otherwise drive the booking.
  return nextBookingMove(meta, rng);
}

/**
 * The booking move for this turn. Offer a specific time early rather than
 * running a questionnaire first, which is the single biggest difference between
 * how a receptionist and a form-filling bot sound.
 */
function nextBookingMove(meta: MockAgentMeta, rng: () => number): string {
  const { state, availability, now } = meta;

  if (state.bookedSlotId) {
    return pick(rng, ['Anything else you need sorting?', "You're all set."]);
  }

  if (state.slotRejections >= 2 && !state.waitlistOffered) return pick(rng, WAITLIST);

  if (!availability.length) return pick(rng, WAITLIST);

  // Offer a time as soon as we know what it is for; chase the name after.
  if (!state.reason) return pick(rng, ASK_REASON);

  // Something is already on hold for them. Finish the booking rather than
  // starting a fresh round of offers.
  if (state.heldSlotId) return pick(rng, state.name ? ASK_REASON : ASK_NAME);

  if (!state.offeredSlotIds.length || state.slotRejections > 0) {
    const fresh = availability.filter((s) => !state.offeredSlotIds.includes(s.id));
    const pool = fresh.length ? fresh : availability;
    return offerLine(pool[0], now, rng, pool[1]);
  }

  if (!state.name) return pick(rng, ASK_NAME);

  const pending = availability.find((s) => state.offeredSlotIds.includes(s.id)) ?? availability[0];
  return offerLine(pending, now, rng);
}
