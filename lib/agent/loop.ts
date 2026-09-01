import { modelForRole, providerForRole, type ProviderId } from '@/config/models';
import {
  describeSlot,
  extractTimes,
  getAvailability,
  resolveSlotReference,
  shortlist,
} from '@/lib/booking/availability';
import { confirmBooking } from '@/lib/booking/confirm';
import { holdSlot } from '@/lib/booking/hold';
import type { Slot, SlotStore } from '@/lib/booking/types';
import { providerFor } from '@/lib/llm/registry';
import type { LLMProvider } from '@/lib/llm/provider';
import { features } from '@/lib/rag/embed';
import { retrieve } from '@/lib/rag/retrieve';
import type { RetrievalResult } from '@/lib/rag/types';
import { seedFrom } from '@/lib/util/rand';
import {
  answersProbeHonestly,
  classifyInput,
  classifyOutput,
  describeOutputVerdict,
  HONEST_DISCLOSURE,
} from './guardrails';
import {
  describeViolations,
  mirrorRegister,
  repair,
  toBubbles,
  validateStyle,
} from './humanize';
import {
  ingestUserTurn,
  looksLikeSlotRejection,
  mentionsWaitlist,
  recordOutgoing,
  shouldMirrorTerse,
} from './state';
import { buildSystemPrompt, DEFAULT_PERSONA, type PersonaConfig } from './system-prompt';
import type {
  AgentAction,
  AgentTurnResult,
  ConversationState,
  Turn,
  TurnTrace,
} from './types';

export const SESSION_TURN_CAP = Number(process.env.SESSION_TURN_CAP ?? 30);

export interface RunTurnArgs {
  message: string;
  state: ConversationState;
  history: Turn[];
  store: SlotStore;
  persona?: PersonaConfig;
  now?: number;
  /** Override the provider serving the agent role, for the provider comparison run. */
  agentProviderOverride?: ProviderId;
}

const CLOSING_LINE =
  "We've covered a lot here, give the practice a ring on 020 7946 0812 and someone will pick it up.";

/**
 * One turn of the agent.
 *
 * Booking is done in code, not by the model. The model is never given the power
 * to hold or confirm a slot; the loop resolves what the visitor referred to,
 * takes the lock, and tells the model what happened. That is what makes
 * "invented slots: 0" a property of the system rather than a hope about the
 * prompt.
 */
export async function runTurn(args: RunTurnArgs): Promise<AgentTurnResult> {
  const now = args.now ?? Date.now();
  const persona = args.persona ?? DEFAULT_PERSONA;
  const started = Date.now();

  const agentProvider = providerFor('agent', args.agentProviderOverride);
  const guardProvider = providerFor('guardrail');

  // ---------------------------------------------------------- input guardrail
  const verdict = await classifyInput(args.message, guardProvider);
  let state = ingestUserTurn(args.state, args.message, verdict, now);

  // They said no to the time on the table. Let it go: keeping the hold means
  // the next move is "so what's your name" on a slot they have just turned
  // down, and the agent never gets to offering an alternative or the waitlist.
  if (state.heldSlotId && looksLikeSlotRejection(args.message) && !state.bookedSlotId) {
    await args.store.hold(state.heldSlotId, `${state.sessionId}-released`, 0);
    state = { ...state, heldSlotId: null };
  }

  // ------------------------------------------------------------- retrieval
  // A follow-up like "how much is that?" carries none of its own topic. Fold in
  // the previous message and what we already know the visit is for, or the
  // query retrieves nothing and the agent abstains on a question it can answer.
  const retrievalQuery = buildRetrievalQuery(args.message, args.history, state.reason);
  const retrieval: RetrievalResult = await retrieve(retrievalQuery);

  // ----------------------------------------------------------- availability
  const openSlots = await getAvailability(args.store, {
    location: state.location ?? undefined,
    fromISO: new Date(now).toISOString(),
    sessionId: state.sessionId,
  });
  // shortlist() re-picks a spread of times every turn, so a slot offered last
  // turn can silently drop out of the pool this turn. Then AVAILABILITY no
  // longer lists the time the visitor is replying to, "yes that's fine" cannot
  // resolve, and the agent re-offers instead of booking. Anything already put in
  // front of this visitor stays on the table for as long as it is still open.
  const stillOpen = new Set(openSlots.map((s) => s.id));
  const alreadyOffered = openSlots.filter(
    (s) => state.offeredSlotIds.includes(s.id) && stillOpen.has(s.id),
  );
  const offerPool = dedupeById([...alreadyOffered, ...shortlist(openSlots, 8)]).slice(0, 10);

  // ------------------------------------------------------------- booking
  const { state: afterBooking, situation, action: bookingAction } = await advanceBooking({
    state,
    message: args.message,
    store: args.store,
    offerPool,
    openSlots,
    now,
  });
  state = afterBooking;
  // The slot just booked has left the open pool, so it has to travel separately
  // or the confirmation names a different time than the one on the booking.
  const bookedSlot = state.bookedSlotId ? await args.store.getSlot(state.bookedSlotId) : null;

  // ------------------------------------------------------------ generation
  const terse = shouldMirrorTerse([...args.history, { role: 'user', content: args.message, at: now }]);
  const previousUser = args.message;

  let regenerations = 0;
  let text = '';
  let ttftMs: number | null = null;
  let generationMs = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let retryBecause: string | undefined;

  const capReached = state.turnIndex >= SESSION_TURN_CAP;

  if (state.handedOff && state.handoffAnnounced) {
    // The handoff line was already said on an earlier turn. Stay silent now.
    text = '';
  } else if (capReached) {
    text = CLOSING_LINE;
  } else {
    for (let attempt = 0; attempt < 3; attempt++) {
      const system = buildSystemPrompt({
        persona,
        state,
        retrieval,
        availability: offerPool,
        now,
        situation,
        terseRegister: terse,
        retryBecause,
      });

      const res = await generate(agentProvider, {
        system,
        history: args.history,
        message: args.message,
        state,
        retrieval,
        offerPool,
        bookedSlot,
        retrievalQuery,
        situation,
        terse,
        verdict,
        now,
      });
      text = res.text.trim().replace(/^["']|["']$/g, '');
      if (attempt === 0) ttftMs = res.ttftMs;
      generationMs += res.latencyMs;
      promptTokens += res.usage.promptTokens;
      completionTokens += res.usage.completionTokens;

      const supportSlots = bookedSlot ? [...offerPool, bookedSlot] : offerPool;
      const outputVerdict = classifyOutput(text, retrieval.chunks, supportSlots, supportSlots, state, now, situation, args.message);
      const styleReport = validateStyle(text, previousUser);
      if (outputVerdict.ok && styleReport.ok) break;

      regenerations++;
      retryBecause = [describeOutputVerdict(outputVerdict), describeViolations(styleReport)]
        .filter(Boolean)
        .join('; ');
      if (process.env.DEBUG_AGENT) {
        console.error(`[agent] rejected attempt ${attempt}: ${JSON.stringify(text)}\n  -> ${retryBecause}`);
      }

      if (attempt === 1) {
        // Second failure. Repair deterministically rather than looping.
        text = repair(text);
        const stillBad = classifyOutput(text, retrieval.chunks, supportSlots, supportSlots, state, now, situation, args.message);
        if (!stillBad.ok) {
          text = "Not sure on that one, I'll check and come back to you.";
        }
        break;
      }
    }
  }

  // Hard constraint, enforced in code: a sincere question about whether this is
  // a person is answered honestly, in every disclosure mode. If the generation
  // dodged it or a guardrail rewrote it away, substitute the honest line rather
  // than shipping an evasion.
  if (verdict.probe === 'sincere' && !answersProbeHonestly(text)) {
    text = HONEST_DISCLOSURE;
    regenerations++;
  }

  if (terse && text) text = mirrorRegister(text);

  // What the reply actually put in front of the visitor, and the soft holds it earns.
  const mentioned = slotsMentioned(text, offerPool, now);
  let action: AgentAction = bookingAction;
  if (mentioned.length && action.kind === 'reply') {
    action = { kind: 'offer', slotIds: mentioned.map((s) => s.id) };
  }
  // Hold every time the reply just said out loud, and make the last of them the
  // current one. Skipping this for a slot that was offered earlier leaves
  // heldSlotId pointing at a stale time, so a later bare "yes that's fine"
  // books the visitor into a slot they were not looking at. Re-holding a slot
  // this session already holds is a no-op that refreshes the timer.
  for (const slot of mentioned.slice(0, 2)) {
    const held = await holdSlot(args.store, slot.id, state.sessionId);
    if (!held.ok) continue;
    state = {
      ...state,
      offeredSlotIds: state.offeredSlotIds.includes(slot.id)
        ? state.offeredSlotIds
        : [...state.offeredSlotIds, slot.id],
      heldSlotId: slot.id,
    };
  }
  // One time on the table means a bare "yes" is unambiguous next turn.
  if (mentioned.length === 1) state = { ...state, heldSlotId: mentioned[0].id };
  if (mentionsWaitlist(text)) state = { ...state, waitlistOffered: true };
  if (state.handedOff && text) state = { ...state, handoffAnnounced: true };
  state = recordOutgoing(state, text);
  const asked = inferAsk(text);
  state = {
    ...state,
    askedFor: asked,
    asks: {
      name: state.asks.name + (asked === 'name' ? 1 : 0),
      reason: state.asks.reason + (asked === 'reason' ? 1 : 0),
    },
  };
  if (capReached) state = { ...state, closed: true };

  // --------------------------------------------------------------- delivery
  const bubbles = text ? toBubbles(text, seedFrom(state.sessionId, state.turnIndex)) : [];
  const deliveredDelayMs = bubbles.reduce((a, b) => a + b.delayMs, 0);

  const deliverySlots = bookedSlot ? [...offerPool, bookedSlot] : offerPool;
  const finalOutputVerdict = classifyOutput(text, retrieval.chunks, deliverySlots, deliverySlots, state, now, situation, args.message);
  const finalStyle = validateStyle(text, previousUser);

  const trace: TurnTrace = {
    sessionId: state.sessionId,
    turnIndex: state.turnIndex,
    at: new Date(now).toISOString(),
    disclosureMode: state.disclosureMode,
    input: args.message,
    retrievedChunkIds: retrieval.chunks.map((c) => c.id),
    retrievalSimilarities: retrieval.chunks.map((c) => Number(c.similarity.toFixed(4))),
    retrievalModel: retrieval.retrievalModel,
    retrievalFloor: retrieval.floor,
    retrievalEmpty: retrieval.empty,
    offeredSlotIds: mentioned.map((s) => s.id),
    provider: agentProvider.provider,
    model: agentProvider.id,
    promptTokens,
    completionTokens,
    ttftMs,
    generationMs,
    totalMs: Date.now() - started,
    deliveredDelayMs,
    output: text,
    bubbles: bubbles.map((b) => b.text),
    inputVerdict: verdict,
    outputVerdict: finalOutputVerdict,
    styleReport: finalStyle,
    regenerations,
    ladder: { crude: state.crudeTier, hostile: state.hostileTier },
    action: capReached ? { kind: 'closed', why: 'turn_cap' } : action,
  };

  return { bubbles, state, trace, offered: mentioned, context: retrieval.chunks };
}

interface GenerateArgs {
  system: string;
  history: Turn[];
  message: string;
  state: ConversationState;
  retrieval: RetrievalResult;
  offerPool: Slot[];
  bookedSlot: Slot | null;
  retrievalQuery: string;
  situation?: string;
  terse: boolean;
  verdict: Awaited<ReturnType<typeof classifyInput>>;
  now: number;
}

async function generate(provider: LLMProvider, a: GenerateArgs) {
  const messages = [
    ...a.history.slice(-12).map((t) => ({ role: t.role, content: t.content })),
    { role: 'user' as const, content: a.message },
  ];

  let ttftMs: number | null = null;
  let text = '';
  let latencyMs = 0;
  let usage = { promptTokens: 0, completionTokens: 0 };

  for await (const chunk of provider.stream({
    role: 'agent',
    system: a.system,
    messages,
    maxTokens: 160,
    temperature: 0.4,
    seed: seedFrom(a.state.sessionId, a.state.turnIndex),
    meta: {
      state: a.state,
      availability: a.offerPool,
      context: a.retrieval.chunks,
      bookedSlot: a.bookedSlot,
      retrievalEmpty: a.retrieval.empty,
      verdict: a.verdict,
      situation: a.situation,
      terse: a.terse,
      now: a.now,
      lastUser: a.message,
      retrievalQuery: a.retrievalQuery,
    },
  })) {
    if (chunk.type === 'done') {
      text = chunk.response.text;
      ttftMs = chunk.response.ttftMs;
      latencyMs = chunk.response.latencyMs;
      usage = chunk.response.usage;
    }
  }
  return { text, ttftMs, latencyMs, usage };
}

interface AdvanceArgs {
  state: ConversationState;
  message: string;
  store: SlotStore;
  offerPool: Slot[];
  openSlots: Slot[];
  now: number;
}

/**
 * Resolve what the visitor just referred to and move the booking on. Returns a
 * plain-language `situation` describing what changed, which is injected into the
 * prompt so the reply reflects something that actually happened rather than
 * something the model decided to claim.
 */
async function advanceBooking(a: AdvanceArgs): Promise<{
  state: ConversationState;
  situation?: string;
  action: AgentAction;
}> {
  let state = a.state;
  if (state.bookedSlotId) return { state, action: { kind: 'reply' } };
  if (state.handedOff) return { state, action: { kind: 'handoff', why: 'ladder' } };

  const onTable = a.offerPool.filter((s) => state.offeredSlotIds.includes(s.id));
  const held = state.heldSlotId ? await a.store.getSlot(state.heldSlotId) : null;
  const candidates = onTable.length ? onTable : held ? [held] : [];

  const referenced = resolveSlotReference(a.message, candidates, a.now);
  const namedATime = extractTimes(a.message).length > 0;
  if (namedATime && !referenced) {
    // They asked for a specific time that is not on the table. Substituting the
    // nearest held slot would book them into something they never agreed to.
    const wanted = a.message.match(/\b\d{1,2}(?::\d{2})?\s*[ap]m\b/i)?.[0] ?? 'that time';
    return {
      state: { ...state, slotRejections: state.slotRejections + 1 },
      situation: `UNAVAILABLE: ${wanted} isn't free. Say so plainly and offer a time from AVAILABILITY instead. Do not book anything.`,
      action: { kind: 'reply' },
    };
  }
  const target = referenced ?? (candidates.length === 1 ? candidates[0] : null);

  if (target) {
    const hold = await holdSlot(a.store, target.id, state.sessionId);
    // Landing on a time they are happy with ends the rejection streak; without
    // this a single "no, not that one" keeps the waitlist logic armed for the
    // rest of the conversation.
    if (hold.ok) state = { ...state, heldSlotId: target.id, slotRejections: 0 };
  }

  const chosen = target ?? held;
  if (!chosen) return { state, action: { kind: 'reply' } };

  // Confirm only once we have the two things a booking actually needs.
  if (state.name && state.reason) {
    const res = await confirmBooking(a.store, {
      slotId: chosen.id,
      sessionId: state.sessionId,
      name: state.name,
      reason: state.reason,
      disclosureMode: state.disclosureMode,
    });
    if (res.ok) {
      state = { ...state, bookedSlotId: chosen.id, bookingId: res.bookingId, heldSlotId: null };
      return {
        state,
        situation: `BOOKED: ${state.name}, ${state.reason}, ${describeSlot(chosen, a.now)} at ${chosen.location} with ${chosen.practitioner}. Confirm it back in one line and mention the email confirmation.`,
        action: { kind: 'booked', slotId: chosen.id, bookingId: res.bookingId },
      };
    }
    if (res.ok === false && res.reason === 'already_booked') {
      return {
        state: { ...state, heldSlotId: null, offeredSlotIds: state.offeredSlotIds.filter((id) => id !== chosen.id) },
        situation: `GONE: ${describeSlot(chosen, a.now)} was taken in the last few minutes. Say so plainly and offer another time from AVAILABILITY.`,
        action: { kind: 'reply' },
      };
    }
  }

  return {
    state,
    situation: `HELD: ${describeSlot(chosen, a.now)} is on hold for them. Get ${
      !state.name ? 'their name' : 'the reason for the visit'
    } and it's booked.`,
    action: { kind: 'held', slotId: chosen.id },
  };
}

const ANAPHORIC = /\b(that|it|this|those|these|the same|the other one)\b/i;

/**
 * Retrieval query for this turn.
 *
 * Only anaphoric or contentless messages are expanded. Expanding every short
 * message quietly destroys abstention: "do you do braces?" is short, and folding
 * in the previous turn drags unrelated chunks over the floor so the agent
 * answers a question the corpus cannot answer.
 */
export function buildRetrievalQuery(
  message: string,
  history: Turn[],
  reason: string | null,
): string {
  const contentWords = features(message).filter((f) => !f.includes('_') && !f.startsWith('~'));
  const needsContext = ANAPHORIC.test(message) || contentWords.length === 0;
  if (!needsContext) return message;
  const previousUser = [...history].reverse().find((t) => t.role === 'user')?.content ?? '';
  return [message, reason ?? '', previousUser].filter(Boolean).join(' ');
}

function dedupeById(slots: Slot[]): Slot[] {
  const seen = new Set<string>();
  return slots.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
}

/** Slots whose time the reply actually said out loud. */
function slotsMentioned(text: string, pool: Slot[], now: number): Slot[] {
  if (!text) return [];
  const times = extractTimes(text);
  if (!times.length) return [];
  const out: Slot[] = [];
  for (const t of times) {
    const hit = pool.find((s) => {
      const parts = new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'Europe/London',
      }).formatToParts(new Date(s.startsAt));
      const mins =
        Number(parts.find((p) => p.type === 'hour')?.value ?? 0) * 60 +
        Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
      const sameDay = text.toLowerCase().includes(describeSlot(s, now).split(' at ')[0]);
      return mins === t && (sameDay || times.length === 1);
    });
    if (hit && !out.some((s) => s.id === hit.id)) out.push(hit);
  }
  return out;
}

function inferAsk(text: string): ConversationState['askedFor'] {
  if (/\b(your name|whats your name|who'?s it for|can i take your name|name\?)/i.test(text)) return 'name';
  if (/\b(what'?s it for|what do you need|appointment for|seeing for)/i.test(text)) return 'reason';
  if (/\b(work|suit|any good|does that|which)\b.*\?/i.test(text)) return 'time';
  return null;
}
