import { features } from './embed';

/**
 * BM25 over the corpus, used by the offline retrieval backend.
 *
 * The first cut of this used TF-IDF cosine, which normalises by the full vector
 * norm and so systematically buries the longest chunks. With chunks spanning
 * 190 to 520 tokens that cost roughly seven points of recall@5, and every miss
 * was a long chunk. BM25's `b` term is the standard, non-corpus-specific fix.
 *
 * Scores are squashed to [0,1) so the similarity floor keeps the same shape as
 * the cosine floor on the pgvector path. The squash is monotonic, so it changes
 * the scale and not the ranking.
 */
export const K1 = 1.2;
export const B = 0.75;
export const SQUASH_K = 6;

export interface Bm25Index {
  /** feature -> document frequency */
  df: Record<string, number>;
  docCount: number;
  avgLen: number;
  /** per chunk: feature -> term frequency */
  tf: Record<string, number>[];
  lens: number[];
}

export function buildBm25(docs: string[]): Bm25Index {
  const tf: Record<string, number>[] = [];
  const lens: number[] = [];
  const df: Record<string, number> = {};

  for (const d of docs) {
    const fs = features(d);
    const counts: Record<string, number> = {};
    for (const f of fs) counts[f] = (counts[f] ?? 0) + 1;
    tf.push(counts);
    lens.push(fs.length);
    for (const f of Object.keys(counts)) df[f] = (df[f] ?? 0) + 1;
  }

  return {
    df,
    docCount: docs.length,
    avgLen: lens.reduce((a, b) => a + b, 0) / (lens.length || 1),
    tf,
    lens,
  };
}

function idf(index: Bm25Index, feature: string): number {
  const n = index.df[feature] ?? 0;
  return Math.log(1 + (index.docCount - n + 0.5) / (n + 0.5));
}

/** Raw BM25 score of one chunk against a query. */
export function bm25Score(index: Bm25Index, query: string, docIdx: number): number {
  const qf = new Set(features(query));
  const counts = index.tf[docIdx];
  const norm = K1 * (1 - B + (B * index.lens[docIdx]) / index.avgLen);
  let score = 0;
  for (const f of qf) {
    const tf = counts[f];
    if (!tf) continue;
    score += idf(index, f) * ((tf * (K1 + 1)) / (tf + norm));
  }
  return score;
}

/** Monotonic squash into [0,1) so a floor can be expressed on the same scale. */
export function squash(score: number): number {
  return score / (score + SQUASH_K);
}
