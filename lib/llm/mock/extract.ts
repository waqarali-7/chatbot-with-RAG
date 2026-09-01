import { features } from '@/lib/rag/embed';
import { localIndexData } from '@/lib/rag/retrieve';
import { stem } from '@/lib/rag/stem';
import type { RetrievedChunk } from '@/lib/rag/types';
import { retrievalTokens, splitSentences } from '@/lib/util/text';

/**
 * Extractive answering over the retrieved chunks. Used only by the offline
 * provider — with a real agent model this whole file is dead weight. It exists
 * so the demo answers real questions from the real corpus with no API key, and
 * so the RAG evals exercise the actual retrieval path rather than a stub.
 */

const TABLE_ROW = /^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$/;

interface Candidate {
  text: string;
  score: number;
  isTableRow: boolean;
}

function scoreOverlap(question: string, sentence: string): number {
  const q = new Set(features(question));
  const s = features(sentence);
  if (!s.length) return 0;
  let hits = 0;
  for (const f of new Set(s)) if (q.has(f)) hits += f.includes('_') ? 2 : 1;
  // Mild length normalisation so a long paragraph does not win on volume alone.
  return hits / Math.sqrt(s.length);
}

export function candidatesFrom(chunks: RetrievedChunk[]): { text: string; isTableRow: boolean }[] {
  const out: { text: string; isTableRow: boolean }[] = [];
  for (const c of chunks) {
    // Chunk content is prefixed with "doc > heading path\n\n". That prefix is
    // metadata, not prose, and offering it as an answer produces lines like
    // "05-locations > Locations, travel and parking > Clapham".
    const body = c.content.slice(c.content.indexOf('\n\n') + 2);
    for (const line of body.split('\n')) {
      const row = TABLE_ROW.exec(line.trim());
      if (row) {
        if (/^-+$/.test(row[1]) || /^\|?\s*-/.test(row[1]) || row[1].toLowerCase() === 'item') continue;
        out.push({ text: `${row[1]} is ${row[2]}`, isTableRow: true });
        continue;
      }
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('|')) continue;
      for (const s of splitSentences(line)) {
        if (isUsableSentence(s)) out.push({ text: s.trim(), isTableRow: false });
      }
    }
  }
  return out;
}

/**
 * A candidate has to be a whole sentence. Chunk overlap and table rows leave
 * fragments like "It does not offer" in the stream, and a fragment offered as an
 * answer is worse than an abstention.
 */
function isUsableSentence(s: string): boolean {
  const t = s.trim();
  if (t.length < 15) return false;
  if (!/[.!?]$/.test(t)) return false;
  if (!/^[A-Z"']/.test(t)) return false;
  if (t.split(/\s+/).length < 3) return false;
  return true;
}

/**
 * How many of the question's rarest terms the answering sentence must contain.
 *
 * Measured on the golden set: k=1 gives falseAbstention 0.42 but lets one
 * confabulation through (abstentionRate 0.92), and one confabulation is a failed
 * build. k=2 holds abstentionRate at 1.00 at the cost of abstaining more often.
 * The asymmetry is deliberate — an unnecessary "let me check" costs a follow-up,
 * a confident wrong answer costs the client's credibility.
 */
const KEY_TERMS = 2;
const ABSENT_TERM_MIN_LENGTH = 6;

/**
 * Relevance gate.
 *
 * Scoring alone answers the wrong question fluently: asked about sedation it
 * returns "It does not offer aesthetics", and asked about a hearing loop at
 * Shoreditch it returns the sentence about Docklands. Both score well and both
 * are confabulations.
 *
 * The gate: take the rarest content terms in the question by corpus document
 * frequency, and require them to appear in the answering sentence itself, not
 * merely in the chunk it came from. Rarity is what picks out the terms that
 * carry the question — "sedation", "shoreditch", "hygiene" — over the ones that
 * carry the grammar.
 *
 * A distinctive term the corpus has never seen at all means the topic is not
 * covered, and there is nothing to answer from.
 */
function keyTermsOf(question: string): { required: string[]; unknownTopic: boolean } {
  const df = localIndexData().bm25.df;
  const terms = [...new Set(features(question))].filter(
    (f) => !f.includes('_') && !f.startsWith('~'),
  );
  const scored = terms.map((t) => ({ t, df: df[t] ?? 0 }));
  const present = scored.filter((x) => x.df > 0).sort((a, b) => a.df - b.df);

  // A term is only evidence of an uncovered topic if its stem is absent too.
  // "having" does not appear in the corpus, but "have" does, and treating that
  // as an unknown topic abstains on questions the corpus answers plainly.
  const absent = scored.filter(
    (x) =>
      x.df === 0 &&
      x.t.length >= ABSENT_TERM_MIN_LENGTH &&
      !(df[`~${stem(x.t)}`] > 0) &&
      !(df[stem(x.t)] > 0),
  );

  return {
    required: present.slice(0, KEY_TERMS).map((x) => x.t),
    unknownTopic: absent.length > 0,
  };
}

const SITES = ['docklands', 'shoreditch', 'clapham'];

/**
 * A three-site practice must never answer a question about one site with a fact
 * about another. Parking exists at Docklands and a hearing loop is fitted at
 * Docklands; neither is an answer to the same question asked about Shoreditch.
 * This is the failure mode that reads most like confident nonsense to someone
 * who knows the business.
 */
function siteConstraintHolds(question: string, sentence: string): boolean {
  const asked = SITES.filter((s) => question.toLowerCase().includes(s));
  if (!asked.length) return true;
  const inSentence = SITES.filter((s) => sentence.toLowerCase().includes(s));
  if (!inSentence.length) return false;
  return asked.some((s) => inSentence.includes(s));
}

function coversKeyTerms(sentence: string, required: string[]): boolean {
  if (!required.length) return false;
  const have = new Set(retrievalTokens(sentence).flatMap((t) => [t, stem(t)]));
  return required.every((t) => have.has(t) || have.has(stem(t)));
}

function nearDuplicate(a: string, b: string): boolean {
  const A = new Set(features(a));
  const B = features(b);
  if (!B.length) return false;
  const shared = B.filter((f) => A.has(f)).length;
  return shared / B.length > 0.5;
}

/** Tidy a corpus sentence into something a receptionist would actually type. */
export function naturalise(sentence: string, isTableRow: boolean): string {
  let s = sentence.replace(/\s+/g, ' ').trim();
  if (isTableRow) {
    s = s
      .replace(/^([^|]+?) is (.+)$/, (_, item: string, price: string) => {
        const p = price.trim();
        if (p.toLowerCase() === 'free') return `${item.trim()} is free`;
        return `${item.trim()} is ${p}`;
      })
      .replace(/,\s*(\d+ minutes)/, ' ($1)');
    s = s.charAt(0).toUpperCase() + s.slice(1);
    return s.endsWith('.') ? s : `${s}.`;
  }
  s = s
    .replace(/^We ask for/, 'We need')
    .replace(/\bpatients?\b/gi, (m) => m)
    .replace(/^It is /, "It's ")
    .replace(/\bdo not\b/g, "don't")
    .replace(/\bcannot\b/g, "can't")
    .replace(/\bis not\b/g, "isn't")
    .replace(/\bare not\b/g, "aren't")
    .replace(/\bthere is\b/g, "there's")
    .replace(/\bthat is\b/g, "that's")
    .replace(/\bwe are\b/g, "we're")
    .replace(/\byou are\b/g, "you're")
    .replace(/\byou will\b/g, "you'll")
    .replace(/\bwe will\b/g, "we'll")
    .replace(/[—–]/g, ',');
  return s;
}

/**
 * Best extractive answer, or null when nothing in context is a good enough match.
 * Returning null is what produces an abstention rather than a weak answer.
 */
export function answerFromContext(
  question: string,
  chunks: RetrievedChunk[],
  maxChars = 220,
  /** The visitor's own words. The answer has to touch these, not just the expanded query. */
  focus = question,
): string | null {
  if (!chunks.length) return null;
  const { required, unknownTopic } = keyTermsOf(focus);
  // The question turns on a distinctive word the corpus has never used. There is
  // nothing here to answer it with, and the best-scoring sentence will be about
  // something else.
  if (unknownTopic) return null;

  // A price table row answers "how much", not "how many appointments". Without
  // this, a row scores well on the treatment name alone and answers the wrong
  // question with a real-looking number.
  const wantsPrice = /\b(how much|cost|costs|price|prices|charge|fee|pay|expensive|£)\b/i.test(focus);

  const scored: Candidate[] = candidatesFrom(chunks)
    .map((c) => ({ ...c, score: scoreOverlap(question, c.text) }))
    .filter((c) => coversKeyTerms(c.text, required))
    .filter((c) => siteConstraintHolds(focus, c.text))
    .filter((c) => wantsPrice || !c.isTableRow)
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  // Precision comes from the key-term gate above, so the score bar can stay low
  // enough not to abstain on questions the corpus does answer.
  if (!best || best.score < 0.35) return null;

  let out = naturalise(best.text, best.isTableRow);
  // A second sentence only if it is nearly as relevant and there is room.
  // Chunks overlap by 50 tokens, so the runner-up is often the same sentence
  // from the neighbouring chunk. Saying it twice is unmistakably a machine.
  const second = scored.find(
    (c, i) => i > 0 && !c.isTableRow && !nearDuplicate(c.text, best.text),
  );
  if (second && second.score > best.score * 0.8) {
    const extra = naturalise(second.text, false);
    if (out.length + extra.length + 1 <= maxChars) out = `${out} ${extra}`;
  }
  if (out.length > maxChars) {
    const sentences = splitSentences(out);
    out = sentences[0] ?? out.slice(0, maxChars);
    if (out.length > maxChars) out = `${out.slice(0, maxChars - 1).replace(/\s+\S*$/, '')}.`;
  }
  return out;
}
