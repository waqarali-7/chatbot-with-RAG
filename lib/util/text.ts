/** Shared text helpers used by the humanizer, the scorers and the RAG chunker. */

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Retrieval tokenizer. Hyphens are joined as well as split, so "X-rays" indexes
 * as "xrays" and matches a user who types it without the hyphen, and "£95"
 * keeps its number.
 */
export function retrievalTokens(s: string): string[] {
  const lower = s.toLowerCase();
  const joined = lower.replace(/([a-z])-([a-z])/g, '$1$2');
  const split = lower.replace(/-/g, ' ');
  const out = new Set<string>();
  for (const variant of [joined, split]) {
    for (const t of variant.replace(/[^a-z0-9'\s]/g, ' ').split(/\s+/)) {
      if (t) out.add(t);
    }
  }
  return [...out];
}

/** Rough token estimate. Good enough for chunk sizing and trace fields. */
export function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

const ABBREV = /\b(mr|mrs|ms|dr|st|approx|e\.g|i\.e|vs|no)\.$/i;

/**
 * Sentence split that does not fire on "Dr." or "9 a.m.". A naive /[.!?]/ split
 * miscounts those and makes the two-sentence cap reject valid replies.
 */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  let buf = '';
  const parts = text.split(/([.!?]+[)"']?\s+)/);
  for (let i = 0; i < parts.length; i += 2) {
    const body = parts[i] ?? '';
    const term = parts[i + 1] ?? '';
    buf += body + term;
    const trimmed = buf.trim();
    if (!term) continue;
    if (ABBREV.test(trimmed) || /\b[a-z]\.[a-z]\.$/i.test(trimmed)) continue;
    if (trimmed) out.push(trimmed);
    buf = '';
  }
  if (buf.trim()) out.push(buf.trim());
  return out.filter(Boolean);
}

export function countSentences(text: string): number {
  return splitSentences(text).length;
}

const EMOJI =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu;

export function countEmoji(text: string): number {
  return (text.match(EMOJI) ?? []).length;
}

/** Longest run of consecutive tokens shared between two strings. */
export function longestCommonRun(a: string, b: string): { length: number; text: string } {
  const A = tokenize(a);
  const B = tokenize(b);
  if (!A.length || !B.length) return { length: 0, text: '' };
  let best = 0;
  let bestEnd = 0;
  const prev = new Array<number>(B.length + 1).fill(0);
  const cur = new Array<number>(B.length + 1).fill(0);
  for (let i = 1; i <= A.length; i++) {
    for (let j = 1; j <= B.length; j++) {
      cur[j] = A[i - 1] === B[j - 1] ? prev[j - 1] + 1 : 0;
      if (cur[j] > best) {
        best = cur[j];
        bestEnd = i;
      }
    }
    prev.fill(0);
    for (let j = 0; j <= B.length; j++) prev[j] = cur[j];
    cur.fill(0);
  }
  return { length: best, text: A.slice(bestEnd - best, bestEnd).join(' ') };
}

export function truncateAtSentence(text: string, cap: number): string {
  const sentences = splitSentences(text);
  let out = '';
  for (const s of sentences) {
    const next = out ? `${out} ${s}` : s;
    if (next.length > cap) break;
    out = next;
  }
  if (!out) out = text.slice(0, cap).replace(/\s+\S*$/, '');
  return out.trim();
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
