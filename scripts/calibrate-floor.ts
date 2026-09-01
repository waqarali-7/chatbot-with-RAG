/**
 * Calibrate the similarity floor for the offline lexical backend and record the
 * evidence behind it.
 *
 * A floor is a property of the retrieval space, not a universal constant. 0.35
 * is the spec floor for text-embedding-3-small cosine; BM25 squashed into [0,1)
 * sits on a different scale and needs its own.
 *
 * The rule: set the floor at the 5th percentile of top-1 scores over the
 * answerable golden rows. That bounds false abstention at roughly 0.05 by
 * construction, which is the threshold the floor is responsible for. It does
 * NOT bound confabulation, because three of the twelve unanswerable rows
 * deliberately retrieve a highly relevant chunk that does not contain the
 * answer. Nothing a floor can do separates those, which is why abstention is
 * enforced downstream by the claim-support check in lib/agent/guardrails.ts.
 */
import fs from 'node:fs';
import index from '../content/index.generated.json';
import { LocalLexicalBackend, type LocalIndex } from '../lib/rag/store';

const backend = new LocalLexicalBackend(index as unknown as LocalIndex, -1);
const rows = fs
  .readFileSync('evals/datasets/golden.jsonl', 'utf8')
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l) as { id: string; question: string; answerable: boolean });

const pct = (a: number[], q: number) =>
  [...a].sort((x, y) => x - y)[Math.max(0, Math.floor(a.length * q))];

const ans: number[] = [];
const un: { id: string; s: number }[] = [];
for (const r of rows) {
  const top = backend.scoreAll(r.question)[0];
  if (r.answerable) ans.push(top.similarity);
  else un.push({ id: r.id, s: top.similarity });
}

const floor = Math.floor(pct(ans, 0.05) * 100) / 100;
const wouldAbstain = un.filter((u) => u.s < floor);

console.log('answerable top-1 similarity');
console.log(`  p05 ${pct(ans, 0.05).toFixed(3)}  p10 ${pct(ans, 0.1).toFixed(3)}  p50 ${pct(ans, 0.5).toFixed(3)}`);
console.log('unanswerable top-1 similarity');
console.log(`  p50 ${pct(un.map((u) => u.s), 0.5).toFixed(3)}  p90 ${pct(un.map((u) => u.s), 0.9).toFixed(3)}  max ${Math.max(...un.map((u) => u.s)).toFixed(3)}`);
console.log(`\nfloor = p05(answerable) rounded down = ${floor.toFixed(2)}`);
console.log(`  answerable below floor (false abstention from the floor alone): ${ans.filter((s) => s < floor).length}/${ans.length}`);
console.log(`  unanswerable caught by the floor alone: ${wouldAbstain.length}/${un.length} (${wouldAbstain.map((u) => u.id).join(', ') || 'none'})`);
console.log(`  unanswerable that reach the model and must be caught downstream: ${un.length - wouldAbstain.length}`);
