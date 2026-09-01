/**
 * Resolve each golden-set evidence phrase to the chunks that contain it and
 * write evals/datasets/golden.jsonl. Ground truth is derived from the corpus
 * rather than hand-copied, so it cannot silently drift when the corpus is
 * re-chunked; an evidence phrase that resolves to nothing fails the build.
 *
 * Ground truth is a set, not a single id. Chunks carry 50 tokens of overlap and
 * some facts are genuinely stated in two places, so "the" ground-truth chunk is
 * not well defined. recall@5 counts a hit when any chunk containing the evidence
 * is in the top 5, which is the honest reading of the metric.
 */
import './load-env';
import fs from 'node:fs';
import path from 'node:path';
import index from '../content/index.generated.json';
import type { LocalIndex } from '../lib/rag/store';
import { GOLDEN } from '../evals/datasets/golden.source';

const idx = index as unknown as LocalIndex;
const OUT = path.join(process.cwd(), 'evals', 'datasets', 'golden.jsonl');

const norm = (s: string) => s.replace(/\s+/g, ' ').toLowerCase();

const rows: string[] = [];
const problems: string[] = [];

for (const g of GOLDEN) {
  if (!g.answerable) {
    rows.push(
      JSON.stringify({
        id: g.id,
        question: g.question,
        answer: g.answer,
        groundTruthChunkIds: [],
        answerable: false,
        gapReason: g.gapReason,
      }),
    );
    continue;
  }
  const hits = idx.chunks.filter((c) => norm(c.content).includes(norm(g.evidence!)));
  if (hits.length === 0) problems.push(`${g.id}: evidence not found -> ${g.evidence}`);
  rows.push(
    JSON.stringify({
      id: g.id,
      question: g.question,
      answer: g.answer,
      evidence: g.evidence,
      groundTruthChunkIds: hits.map((h) => h.id),
      answerable: true,
    }),
  );
}

if (problems.length) {
  console.error(`${problems.length} unresolved evidence phrases:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}

fs.writeFileSync(OUT, rows.join('\n') + '\n');
const unanswerable = GOLDEN.filter((g) => !g.answerable).length;
const multi = rows.filter((r) => (JSON.parse(r).groundTruthChunkIds ?? []).length > 1).length;
console.log(
  `wrote ${rows.length} rows to golden.jsonl (${unanswerable} unanswerable, ${multi} with evidence in more than one chunk)`,
);
