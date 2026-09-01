import { atomicClaims, isAbstention } from '@/lib/agent/guardrails';
import { features } from '@/lib/rag/embed';
import { countSentences, longestCommonRun, retrievalTokens } from '@/lib/util/text';

/**
 * Deterministic stand-in for the LLM judge.
 *
 * A judge is meant to catch what a regex cannot, so a heuristic judge is by
 * definition weaker than the real one. It is here so the harness runs end to
 * end offline; every result file records `judge.provider: "mock"` and the
 * scorecard says plainly that a mock-judged run is not a graded run.
 */

const ASSISTANT_REGISTER =
  /\b(happy to assist|how may i|is there anything else|feel free to|do not hesitate|thank you for reaching out|i can certainly|assist you today|how can i help you today|kindly|please be advised|at your earliest convenience|we appreciate your)\b/i;

const OVER_ACK =
  /\b(i'?ve noted|noted that down|i'?ve made a note|duly noted|recorded that|i'?ve popped that|thank you for (letting me know|confirming|providing))\b/i;

const FORMAL =
  /\b(regarding|furthermore|however|additionally|please note|should you|we would be|i would be delighted|it is recommended|in order to|prior to|at this time|we are able to|kindly|at your earliest convenience|please be advised|with regard to)\b/i;

const HEDGE_OR_QUESTION = /\?|(not sure|i'?ll check|let me check|find out)/i;

const SCHEDULING =
  /\b\d{1,2}(:\d{2})?\s?[ap]m\b|\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\b(booked you in|that'?s you down|short notice list|cancellation list|waiting list|confirmation|you'?ll get|on its way|to follow|all set|stick to the booking)\b/i;

/** A statement about when someone can come in, not a claim about the business. */
export function isSchedulingClaim(claim: string): boolean {
  return SCHEDULING.test(claim);
}

export interface TellFlags {
  recap: boolean;
  over_ack: boolean;
  assistant_register: boolean;
  over_explains: boolean;
  unnatural_formality: boolean;
  no_idk: boolean;
  derails_off_script: boolean;
}

export interface MockTellInput {
  turnId: string;
  userMessage: string;
  agentMessage: string;
  context: string;
  /** True when the corpus had nothing for this turn, so an assertion is a tell. */
  retrievalEmpty: boolean;
  offScript: boolean;
  /** What the loop actually did. A booking confirmation is not a corpus claim. */
  action?: string;
}

export function judgeTell(input: MockTellInput): {
  flags: TellFlags;
  evidence: Record<string, string | null>;
} {
  const a = input.agentMessage;
  const evidence: Record<string, string | null> = {};

  const run = longestCommonRun(input.userMessage, a);
  const recap = run.length >= 6;
  if (recap) evidence.recap = run.text;

  const ackHit = OVER_ACK.exec(a);
  if (ackHit) evidence.over_ack = ackHit[0];

  const regHit = ASSISTANT_REGISTER.exec(a);
  if (regHit) evidence.assistant_register = regHit[0];

  // Answering more than was asked. Length relative to the question is the
  // signal; a single 210-character sentence in reply to "how long" over-explains
  // just as clearly as two do.
  const overExplains = a.length > 200 && input.userMessage.length < 60;
  if (overExplains) evidence.over_explains = `${a.length} chars to a ${input.userMessage.length}-char message`;

  const formalHit = FORMAL.exec(a);
  const userCasual =
    input.userMessage === input.userMessage.toLowerCase() || input.userMessage.length < 25;
  const unnaturalFormality = Boolean(formalHit) && userCasual;
  if (unnaturalFormality) evidence.unnatural_formality = formalHit![0];

  // Asserting something when the corpus had nothing to assert from.
  //
  // Appointment times are not corpus facts: they come from a live availability
  // list the judge is not shown, and the invented-slot guardrail already checks
  // them against the slot store. Counting an offered time as an unsupported
  // assertion flags every successful booking turn as a tell.
  const bookingTurn = ['offer', 'held', 'booked', 'waitlist'].includes(input.action ?? '');
  const claims = atomicClaims(a).filter((c) => !isSchedulingClaim(c));
  const noIdk =
    input.retrievalEmpty && !bookingTurn && claims.length > 0 && !isAbstention(a);
  if (noIdk) evidence.no_idk = claims[0];

  // Losing the thread on a tangent: neither engaging with it nor asking anything.
  const shared = new Set(features(input.userMessage));
  const touches = retrievalTokens(a).some((t) => shared.has(t));
  const derails = input.offScript && !touches && !HEDGE_OR_QUESTION.test(a);
  if (derails) evidence.derails_off_script = a.slice(0, 60);

  return {
    flags: {
      recap,
      over_ack: Boolean(ackHit),
      assistant_register: Boolean(regHit),
      over_explains: overExplains,
      unnatural_formality: unnaturalFormality,
      no_idk: noIdk,
      derails_off_script: derails,
    },
    evidence,
  };
}

export interface MockClaimInput {
  answer: string;
  context: string;
  question: string;
}

/**
 * Per-claim faithfulness. A holistic 1-5 score hides exactly the partial
 * hallucination that matters, so each claim is checked on its own.
 */
export function judgeClaims(input: MockClaimInput): {
  claims: { claim: string; supported: boolean }[];
} {
  const support = new Set(retrievalTokens(input.context));
  return {
    // Faithfulness measures grounding in the retrieved documents. An offered
    // appointment time is not a document fact, it is live state read from the
    // slot store, and it is checked by the invented-slot guardrail instead.
    // Scoring it here marks every successful booking turn as a hallucination.
    claims: atomicClaims(input.answer)
      .filter((c) => !isSchedulingClaim(c))
      .map((claim) => {
        const tokens = retrievalTokens(claim).filter((t) => /\d/.test(t) || t.length >= 5);
        const missing = tokens.filter((t) => !support.has(t));
        return { claim, supported: missing.length < 2 };
      }),
  };
}

export function judgeRelevancy(input: MockClaimInput): {
  addresses: boolean;
  declines: boolean;
  reason: string;
} {
  if (isAbstention(input.answer)) {
    return { addresses: true, declines: true, reason: 'declines explicitly rather than answering' };
  }
  const q = new Set(features(input.question));
  const overlap = [...new Set(features(input.answer))].filter((f) => q.has(f)).length;
  return {
    addresses: overlap >= 2,
    declines: false,
    reason: `${overlap} shared content features with the question`,
  };
}
