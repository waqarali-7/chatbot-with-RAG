import type { ConversationState, TurnTrace } from '@/lib/agent/types';

export interface RunSummary {
  personaId: string;
  seed: number;
  disclosureMode: string;
  turns: { user: string; agent: string; trace: TurnTrace }[];
  state: ConversationState;
  booked: boolean;
  turnCount: number;
  guardrailViolations: number;
  inventedSlots: number;
  unsupportedClaims: number;
  styleViolations: number;
  lied: boolean;
  lectured: boolean;
  ladder: { crude: number; hostile: number };
  waitlistOffered: boolean;
  repeatedQuestions: number;
}

export interface ScriptContext {
  turnIndex: number;
  lastAgent: string;
  allAgent: string[];
  rng: () => number;
  state: ConversationState;
}

export interface Persona {
  id: string;
  behaviour: string;
  /** Used when a simulator LLM is configured. */
  simulatorPrompt: string;
  /** Deterministic fallback so runs reproduce exactly with no provider. */
  script: (ctx: ScriptContext) => string | null;
  successCondition: (run: RunSummary) => { pass: boolean; why: string };
  bookable: boolean;
  maxTurns: number;
  /** Milliseconds to jump the clock forward, and at which turn. */
  timeJump?: { atTurn: number; ms: number };
}

export const said = (text: string, ...needles: string[]): boolean =>
  needles.some((n) => text.toLowerCase().includes(n.toLowerCase()));

export const offersATime = (text: string): boolean => /\b\d{1,2}(:\d{2})?\s?[ap]m\b/i.test(text);

/**
 * These match a real model's free phrasing, not a fixed set of strings. Claude
 * asks for a name as "can I grab your name", "who am I booking for", "and you
 * are?", "just need a name for the booking" — a narrow regex silently misses
 * most of them, the persona never answers, and the run is scored as the agent
 * failing to book when the harness simply did not understand the question.
 */
export const asksName = (text: string): boolean =>
  /\b(your name|a name|the name|who'?s it (for|under)|who am i (booking|speaking)|can i (take|grab|get|have)[^?.]*name|what name|name\?|and you are\??|your details)/i.test(
    text,
  );

export const asksReason = (text: string): boolean =>
  // Deliberately not "help you with" or "anything specific": those match almost
  // any friendly reply, and a persona whose job is to reject every slot ends up
  // answering a question it was never asked.
  /\b(what'?s it for|what do you need|appointment for|seeing for|what are you (after|coming in|booking) for|what did you need|what brings you|which treatment|what sort of appointment|what kind of appointment|booking in for)/i.test(
    text,
  );

/** Any question at all, however phrased. */
export const asksSomething = (text: string): boolean => text.includes('?');

/**
 * Fallback for a persona that has been asked something the matchers did not
 * recognise. A real person volunteers whatever the desk still needs rather than
 * answering "yes" for the fifth time, and without this a single unrecognised
 * phrasing stalls the whole conversation.
 */
export function volunteerMissing(
  ctx: ScriptContext,
  details: { name?: string; reason?: string },
): string | null {
  if (!asksSomething(ctx.lastAgent)) return null;
  if (details.reason && !ctx.state.reason) return details.reason;
  if (details.name && !ctx.state.name) return details.name;
  return null;
}
