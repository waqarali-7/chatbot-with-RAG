import { LOCATIONS } from '@/lib/booking/seed';
import { countEmoji, tokenize } from '@/lib/util/text';
import type { ConversationState, InputVerdict, LadderTier, Turn } from './types';

/**
 * `explicit: true` means the phrasing itself announces a name ("my name is"),
 * so the capture is trusted as written. The looser openers ("I'm", "this is")
 * also start a great many sentences that are not introductions, so a capture
 * from those is only trusted when it is capitalised, or when we just asked.
 * Without that, "this is useless" books an appointment for a Mr Useless.
 */
const NAME_PATTERNS: { re: RegExp; explicit: boolean }[] = [
  { re: /\bmy name(?:'s| is)\s+([A-Za-z][A-Za-z'-]{1,20}(?:\s+[A-Za-z][A-Za-z'-]{1,20})?)/i, explicit: true },
  { re: /\bname'?s\s+([A-Za-z][A-Za-z'-]{1,20})/i, explicit: true },
  { re: /(?:^|\s)(?:i'?m|i am)\s+([A-Za-z][A-Za-z'-]{1,20}(?:\s+[A-Za-z][A-Za-z'-]{1,20})?)/i, explicit: false },
  { re: /(?:^|\s)(?:it'?s|this is)\s+([A-Za-z][A-Za-z'-]{1,20}(?:\s+[A-Za-z][A-Za-z'-]{1,20})?)/i, explicit: false },
];

/**
 * Words that look like a name to a regex but never are. "I'm not sure" and
 * "it's fine" both match the introduction patterns, and a booking under the name
 * "Not" is worse than one more question.
 */
const NOT_NAMES = new Set(
  ('yes no nope not ok okay hi hello hey thanks thank cheers sure fine good great bad busy free sorry just still here there after about looking trying hoping wondering wanting interested keen ready new nervous late early back off out over under only really very much more less same next last another other any some none all both each every one two three morning afternoon evening night monday tuesday wednesday thursday friday saturday sunday today tomorrow yesterday week weekend january february march april may june july august september october november december docklands shoreditch clapham meridian nadia dentist hygienist patient appointment booking time slot price cost pain filling crown clean checkup check whitening '
   + 'useless stupid pathetic rubbish garbage worthless incompetent ridiculous awful terrible pointless hopeless annoying joke nonsense unbelievable outrageous disgusting insane crazy mad wrong right true false serious silly weird strange odd urgent important possible impossible difficult easy hard simple')
    .split(' '),
);

function plausibleName(raw: string): string | null {
  const cleaned = raw.trim().replace(/[^A-Za-z'\s-]/g, '');
  if (!cleaned) return null;
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (!parts.length || parts.length > 2) return null;
  if (parts.some((p) => NOT_NAMES.has(p.toLowerCase()) || p.length < 2)) return null;
  return parts.map((p) => p[0].toUpperCase() + p.slice(1).toLowerCase()).join(' ');
}

/**
 * Name extraction. When we asked for a name last turn a short bare reply is
 * taken at face value; otherwise it has to look like an introduction. Guessing
 * from any capitalised token produces bookings under names like "Tuesday".
 */
export function extractName(text: string, askedForName: boolean): string | null {
  for (const { re, explicit } of NAME_PATTERNS) {
    const m = re.exec(text);
    if (!m) continue;
    if (!explicit && !askedForName && !/^[A-Z]/.test(m[1])) continue;
    const n = plausibleName(m[1]);
    if (n) return n;
  }
  if (askedForName) {
    const bare = text.trim().replace(/^(it'?s|its)\s+/i, '');
    if (bare.split(/\s+/).length <= 2 && /^[A-Za-z][A-Za-z'\s-]{1,30}$/.test(bare)) {
      return plausibleName(bare);
    }
  }
  return null;
}

const REASON_KEYWORDS: [RegExp, string][] = [
  [/\b(check ?up|routine|examination|exam|inspection)\b/i, 'check up'],
  [/\b(new patient|register|registration|first (visit|appointment)|join)\b/i, 'new patient exam'],
  [/\b(clean(ing)?|hygien\w*|scale and polish|polish|tartar|plaque)\b/i, 'hygiene'],
  [/\b(whiten\w*|bleach\w*|brighter teeth)\b/i, 'whitening'],
  [/\b(filling|cavity|hole in|decay)\b/i, 'filling'],
  [/\b(crown|cap)\b/i, 'crown'],
  [/\b(veneer)\b/i, 'veneers'],
  [/\b(root canal|abscess\w*|nerve)\b/i, 'root canal'],
  [/\b(extract\w*|taken out|pull(ed)? out|wisdom)\b/i, 'extraction'],
  [/\b(chip(ped)?|crack(ed)?|broke(n)?|lost (a )?(filling|crown))\b/i, 'chipped or broken tooth'],
  [/\b(toothache|tooth ache|pain|hurts|sore|swollen|swelling|emergency|urgent)\b/i, 'pain'],
  [/\b(bleeding gums|gum(s)? (are )?bleed\w*|gum disease|periodont\w*)\b/i, 'gum problem'],
  [/\b(botox|anti[- ]?wrinkle|wrinkle)\b/i, 'anti-wrinkle'],
  [/\b(filler|lip(s)?|cheek|dermal)\b/i, 'dermal filler'],
  [/\b(peel|skin booster|skincare|facial)\b/i, 'aesthetics consult'],
  [/\b(night ?guard|grind\w*|clench\w*|bruxis\w*)\b/i, 'night guard'],
  [/\b(denture)\b/i, 'denture'],
  [/\b(consult(ation)?|advice|talk to someone|opinion)\b/i, 'consultation'],
  [/\b(sensitiv\w*|twinge|aches?|cold water|hot and cold)\b/i, 'sensitive tooth'],
  [/\b(check|look at|looked at|seen|sort out|sorted)\b/i, 'check up'],
];

export function extractReason(text: string): string | null {
  for (const [re, label] of REASON_KEYWORDS) if (re.test(text)) return label;
  return null;
}

export function extractLocation(text: string): string | null {
  const lower = text.toLowerCase();
  for (const loc of LOCATIONS) if (lower.includes(loc.toLowerCase())) return loc;
  if (/\bcanary wharf|south quay|e14\b/i.test(text)) return 'Docklands';
  if (/\bold street|shoreditch high|ec2a\b/i.test(text)) return 'Shoreditch';
  if (/\bsw4|voltaire\b/i.test(text)) return 'Clapham';
  return null;
}

const REJECTION = /\b(no(pe)?|can'?t|cannot|doesn'?t work|won'?t work|not (great|good|ideal)|too (early|late)|nothing (there|then)|another|something else|anything else|different|else\?)\b/i;

export function looksLikeSlotRejection(text: string): boolean {
  return REJECTION.test(text) && !/\b(yes|yeah|yep|perfect|works|fine|book|great)\b/i.test(text);
}

const ACCEPT = /\b(yes|yeah|yep|yup|sure|ok(ay)?|perfect|great|works|fine|book (it|me)|that'?s? (good|fine|great)|sounds good|go on then|please do|do it|lets do|let'?s do)\b/i;

export function looksLikeAcceptance(text: string): boolean {
  return ACCEPT.test(text) && !REJECTION.test(text);
}

/**
 * Register mirroring signal. If the last three visitor messages average under
 * 25 characters or are all lowercase, drop register to match. Answering "wat
 * time" with a full formal sentence is one of the clearest tells there is.
 */
export function shouldMirrorTerse(turns: Turn[]): boolean {
  const user = turns.filter((t) => t.role === 'user').slice(-3);
  if (user.length < 2) return false;
  const avg = user.reduce((a, t) => a + t.content.trim().length, 0) / user.length;
  const allLower = user.every((t) => t.content === t.content.toLowerCase() && /[a-z]/.test(t.content));
  return avg < 25 || allLower;
}

function bump(tier: LadderTier): LadderTier {
  return Math.min(3, tier + 1) as LadderTier;
}

/**
 * Escalation ladder. Tier 1 is silent: answer the useful part, or ask a booking
 * question, and say nothing at all about what was said. Tier 2 is one short
 * line. Tier 3 is a handoff and then silence.
 */
export function applyLadder(state: ConversationState, verdict: InputVerdict): ConversationState {
  const next = { ...state };
  if (verdict.label === 'sexual') next.crudeTier = bump(next.crudeTier);
  if (verdict.label === 'harassment') next.hostileTier = bump(next.hostileTier);
  if (next.crudeTier >= 3 || next.hostileTier >= 3) next.handedOff = true;
  return next;
}

export function ladderTier(state: ConversationState): LadderTier {
  return Math.max(state.crudeTier, state.hostileTier) as LadderTier;
}

/** Emoji budget: at most one per five outgoing messages. */
export function emojiAllowed(state: ConversationState): boolean {
  const recent = state.emojiTurns.filter((t) => t > state.turnIndex - 5);
  return recent.length === 0;
}

export function recordOutgoing(state: ConversationState, text: string): ConversationState {
  const next = { ...state };
  if (countEmoji(text) > 0) next.emojiTurns = [...next.emojiTurns, next.turnIndex];
  return next;
}

/**
 * Fold a visitor message into state. Extraction runs in code rather than being
 * left to the model, because the booking record has to be right even when the
 * model's phrasing drifts.
 */
export function ingestUserTurn(
  state: ConversationState,
  text: string,
  verdict: InputVerdict,
  now = Date.now(),
): ConversationState {
  let next = applyLadder(state, verdict);
  next.turnIndex = state.turnIndex + 1;
  next.lastActiveAt = now;

  // Nothing is extracted from an abusive turn: a booking was landing under the
  // name "Useless" because a hostile message arrived right after we had asked
  // for a name.
  //
  // Only abuse, though. Requiring label === 'clean' meant any classifier
  // misfire silently stopped the agent learning the visitor's name and reason,
  // and the booking then never completed. The live classifier labelled "need a
  // clean" as not-clean, extraction was skipped, and the conversation ran to
  // the turn cap with the agent insisting it had booked something. A false
  // positive on off_topic must not cost a booking.
  const cleanTurn = verdict.label !== 'sexual' && verdict.label !== 'harassment';

  const name = cleanTurn ? extractName(text, state.askedFor === 'name') : null;
  if (name && !next.name) next.name = name;

  const reason = cleanTurn ? extractReason(text) : null;
  if (reason && !next.reason) next.reason = reason;
  // We asked, they answered, and no keyword matched. Take what they said at
  // face value rather than asking a second time. Re-asking a question someone
  // has already answered is one of the most obvious tells there is, and a
  // receptionist would simply write down their words.
  if (cleanTurn && !next.reason && state.askedFor === 'reason' && state.asks.reason >= 1) {
    const free = text.trim().replace(/\s+/g, ' ');
    // "the first one works" is an answer about a time, not about why they are
    // coming in, and recording it as the reason puts nonsense in the diary.
    const aboutATime =
      looksLikeAcceptance(free) || looksLikeSlotRejection(free) || /\d{1,2}\s?[ap]m|\bfirst\b|\bsecond\b|\bthat one\b/i.test(free);
    if (free.length >= 3 && !aboutATime) next.reason = free.slice(0, 60);
  }
  // The name fallback stays narrow. A reason can be anything someone types; a
  // name cannot, and a booking under the wrong name is a real record in the
  // practice's diary.
  if (cleanTurn && !next.name && state.askedFor === 'name' && state.asks.name >= 2) {
    const free = text.trim().split(/[,.]/)[0].trim();
    const words = free.split(/\s+/);
    if (words.length <= 3 && free.length >= 2 && free.length <= 40 && /^[A-Za-z][A-Za-z'\s-]*$/.test(free)) {
      next.name = plausibleName(words.slice(0, 2).join(' ')) ?? next.name;
    }
  }

  const loc = extractLocation(text);
  if (loc) next.location = loc;

  if (verdict.probe === 'playful') next.probes = { ...next.probes, playful: next.probes.playful + 1 };
  if (verdict.probe === 'sincere') next.probes = { ...next.probes, sincere: next.probes.sincere + 1 };

  if (next.offeredSlotIds.length && looksLikeSlotRejection(text)) {
    next.slotRejections = next.slotRejections + 1;
  }
  return next;
}

/** Rough intent signal used to decide whether to surface availability this turn. */
export function wantsTimes(text: string): boolean {
  return /\b(when|time|slot|appointment|book|availab|free|open|fit me in|come in|see (me|someone)|sooner|earlier|later|this week|next week|today|tomorrow|morning|afternoon|evening|saturday|weekend)\b/i.test(
    text,
  );
}

export function mentionsWaitlist(text: string): boolean {
  return /\b(waiting list|wait list|waitlist|short.?notice|let me know|text me|cancellation list)\b/i.test(
    text,
  );
}

export function overlapTokens(a: string, b: string): number {
  const A = new Set(tokenize(a));
  return tokenize(b).filter((t) => A.has(t)).length;
}
