import type { ProviderId } from '@/config/models';
import type { Slot } from '@/lib/booking/types';
import type { RetrievedChunk } from '@/lib/rag/types';

export type DisclosureMode = 'minimal' | 'info_card' | 'explicit';

export const DISCLOSURE_MODES: DisclosureMode[] = ['minimal', 'info_card', 'explicit'];

export function disclosureModeFromEnv(): DisclosureMode {
  const raw = process.env.DISCLOSURE_MODE;
  return raw === 'minimal' || raw === 'info_card' || raw === 'explicit' ? raw : 'info_card';
}

export interface Turn {
  role: 'user' | 'assistant';
  content: string;
  at: number;
}

/** Where the escalation ladder currently sits. 0 means nothing has happened. */
export type LadderTier = 0 | 1 | 2 | 3;

export interface ConversationState {
  sessionId: string;
  disclosureMode: DisclosureMode;
  turnIndex: number;
  name: string | null;
  reason: string | null;
  location: string | null;
  /** Every slot id ever put in front of the visitor. The invented-slot check reads this. */
  offeredSlotIds: string[];
  heldSlotId: string | null;
  bookedSlotId: string | null;
  bookingId: string | null;
  crudeTier: LadderTier;
  hostileTier: LadderTier;
  /** Set once the ladder reaches tier 3. */
  handedOff: boolean;
  /** The handoff line has been said. Silence starts after it, not instead of it. */
  handoffAnnounced: boolean;
  closed: boolean;
  slotRejections: number;
  waitlistOffered: boolean;
  askedFor: 'name' | 'reason' | 'time' | null;
  /** How many times we have asked for each thing. Asking twice is a tell. */
  asks: { name: number; reason: number };
  probes: { playful: number; sincere: number };
  lastActiveAt: number;
  emojiTurns: number[];
}

export function newConversationState(
  sessionId: string,
  disclosureMode: DisclosureMode,
  now = Date.now(),
): ConversationState {
  return {
    sessionId,
    disclosureMode,
    turnIndex: 0,
    name: null,
    reason: null,
    location: null,
    offeredSlotIds: [],
    heldSlotId: null,
    bookedSlotId: null,
    bookingId: null,
    crudeTier: 0,
    hostileTier: 0,
    handedOff: false,
    handoffAnnounced: false,
    closed: false,
    slotRejections: 0,
    waitlistOffered: false,
    askedFor: null,
    asks: { name: 0, reason: 0 },
    probes: { playful: 0, sincere: 0 },
    lastActiveAt: now,
    emojiTurns: [],
  };
}

export type GuardLabel =
  | 'clean'
  | 'sexual'
  | 'harassment'
  | 'self_harm'
  | 'pii_solicitation'
  | 'prompt_injection'
  | 'off_topic';

export type OutputGuardLabel = GuardLabel | 'unsupported_claim' | 'invented_slot';

export interface InputVerdict {
  label: GuardLabel;
  /** A bot probe is classified separately because the response differs by mode. */
  probe: 'none' | 'playful' | 'sincere';
  confidence: number;
  evidence: string | null;
}

export interface OutputVerdict {
  labels: OutputGuardLabel[];
  unsupportedClaims: string[];
  inventedTimes: string[];
  ok: boolean;
}

export type StyleViolation =
  | 'over_length'
  | 'list_formatting'
  | 'em_dash'
  | 'banned_opener'
  | 'assistant_register'
  | 'question_stacking'
  | 'recap'
  | 'over_ack'
  | 'emoji_excess';

export interface StyleReport {
  violations: StyleViolation[];
  evidence: Partial<Record<StyleViolation, string>>;
  ok: boolean;
}

/** One outgoing bubble after message splitting, with its humanized delay. */
export interface Bubble {
  text: string;
  /** Milliseconds to wait, with the typing indicator up, before this bubble lands. */
  delayMs: number;
}

export interface TurnTrace {
  sessionId: string;
  turnIndex: number;
  at: string;
  disclosureMode: DisclosureMode;
  input: string;
  retrievedChunkIds: string[];
  retrievalSimilarities: number[];
  retrievalModel: string;
  retrievalFloor: number;
  retrievalEmpty: boolean;
  offeredSlotIds: string[];
  provider: ProviderId;
  model: string;
  promptTokens: number;
  completionTokens: number;
  ttftMs: number | null;
  generationMs: number;
  totalMs: number;
  deliveredDelayMs: number;
  output: string;
  bubbles: string[];
  inputVerdict: InputVerdict;
  outputVerdict: OutputVerdict;
  styleReport: StyleReport;
  regenerations: number;
  ladder: { crude: LadderTier; hostile: LadderTier };
  action: AgentAction;
}

export type AgentAction =
  | { kind: 'reply' }
  | { kind: 'offer'; slotIds: string[] }
  | { kind: 'held'; slotId: string }
  | { kind: 'booked'; slotId: string; bookingId: string }
  | { kind: 'waitlist' }
  | { kind: 'handoff'; why: 'ladder' | 'requested' }
  | { kind: 'closed'; why: 'turn_cap' };

export interface AgentTurnResult {
  bubbles: Bubble[];
  state: ConversationState;
  trace: TurnTrace;
  /** Availability actually shown this turn, for the UI and for the eval simulator. */
  offered: Slot[];
  context: RetrievedChunk[];
}
