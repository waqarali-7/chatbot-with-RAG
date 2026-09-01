import type { AvailabilityQuery, Slot, SlotStore } from './types';

export const CLINIC_TZ = 'Europe/London';

const dayFmt = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: CLINIC_TZ,
});

const timeFmt = new Intl.DateTimeFormat('en-GB', {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZone: CLINIC_TZ,
});

export function formatTime(iso: string): string {
  return timeFmt
    .format(new Date(iso))
    .replace(/:00(?=\s?[ap]m)/i, '')
    .replace(/\s?([ap])m$/i, (_, p: string) => p.toLowerCase() + 'm');
}

export function formatDay(iso: string, nowMs = Date.now()): string {
  const d = new Date(iso);
  const dayKey = (t: number) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: CLINIC_TZ }).format(new Date(t));
  if (dayKey(d.getTime()) === dayKey(nowMs)) return 'today';
  if (dayKey(d.getTime()) === dayKey(nowMs + 86_400_000)) return 'tomorrow';
  return dayFmt.format(d);
}

/** "tomorrow at 10:30am" — the shape a receptionist actually says out loud. */
export function describeSlot(slot: Slot, nowMs = Date.now()): string {
  return `${formatDay(slot.startsAt, nowMs)} at ${formatTime(slot.startsAt)}`;
}

export function describeSlotFull(slot: Slot, nowMs = Date.now()): string {
  return `${describeSlot(slot, nowMs)}, ${slot.location}, ${slot.practitioner}`;
}

export async function getAvailability(
  store: SlotStore,
  q: AvailabilityQuery = {},
): Promise<Slot[]> {
  return store.listOpen({ limit: 200, ...q });
}

/**
 * Spread the shortlist across days rather than handing back the first eight
 * slots on one morning. An agent that only ever offers consecutive half-hours
 * reads like a calendar dump.
 */
export function shortlist(slots: Slot[], max = 8): Slot[] {
  // One slot per clock time. Two practitioners free at 10am is one 10am to
  // offer, and saying "10am or 10am" is an unmistakable tell.
  const seen = new Set<string>();
  const unique = slots.filter((s) => {
    const key = s.startsAt;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const byDay = new Map<string, Slot[]>();
  for (const s of unique) {
    const key = s.startsAt.slice(0, 10);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(s);
  }
  const out: Slot[] = [];
  let round = 0;
  while (out.length < max) {
    let added = false;
    for (const list of byDay.values()) {
      const s = list[round * 2];
      if (s) {
        out.push(s);
        added = true;
        if (out.length >= max) break;
      }
    }
    if (!added) break;
    round++;
  }
  return out.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/**
 * The AVAILABILITY block injected into the system prompt. Slot ids travel with
 * the lines so the output guardrail can check any time the agent mentions
 * against something that was genuinely on offer.
 */
export function formatAvailability(slots: Slot[], nowMs = Date.now()): string {
  if (!slots.length) return '(nothing open in the next two weeks)';
  return slots
    .map((s) => `- [${s.id}] ${describeSlot(s, nowMs)} | ${s.location} | ${s.practitioner} | ${s.service}`)
    .join('\n');
}

const TIME_RE = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/gi;

/** Every clock time mentioned in a message, normalised to minutes past midnight. */
export function extractTimes(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(TIME_RE)) {
    let h = parseInt(m[1], 10) % 12;
    if (m[3].toLowerCase() === 'pm') h += 12;
    out.push(h * 60 + (m[2] ? parseInt(m[2], 10) : 0));
  }
  return out;
}

function slotMinutes(slot: Slot): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: CLINIC_TZ,
  }).formatToParts(new Date(slot.startsAt));
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const mi = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h * 60 + mi;
}

/**
 * Resolve a time the user (or the agent) referred to back to a real slot.
 * Returns null rather than a best guess — a near miss here is exactly how an
 * agent ends up confirming a slot that does not exist.
 */
export function resolveSlotReference(
  text: string,
  candidates: Slot[],
  nowMs = Date.now(),
): Slot | null {
  const times = extractTimes(text);
  const lower = text.toLowerCase();
  const dayHint = /\btoday\b/.test(lower)
    ? 'today'
    : /\btomorrow\b/.test(lower)
      ? 'tomorrow'
      : null;

  const pool = candidates.filter((s) => {
    if (!dayHint) return true;
    return formatDay(s.startsAt, nowMs) === dayHint;
  });
  const search = pool.length ? pool : candidates;

  if (times.length) {
    const wanted = times[0];
    const hit = search.find((s) => slotMinutes(s) === wanted);
    if (hit) return hit;
    return null;
  }

  // Positional reference: "the first one", "the later one". People say this far
  // more often than they repeat the time back.
  if (/\b(first|earlier|sooner|earliest)\b/i.test(lower)) return search[0] ?? null;
  if (/\b(second|later|latest|other one|last one)\b/i.test(lower)) {
    return search[1] ?? search[search.length - 1] ?? null;
  }

  // A bare "yes" / "that works" resolves only if exactly one slot is on the table.
  if (search.length === 1) return search[0];
  return null;
}
