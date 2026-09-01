/** recall@k over the golden set, against the offline lexical backend. */
import fs from 'node:fs';
import index from '../content/index.generated.json';
import { LocalLexicalBackend, type LocalIndex } from '../lib/rag/store';

const backend = new LocalLexicalBackend(index as unknown as LocalIndex, -1);
const rows = fs
  .readFileSync('evals/datasets/golden.jsonl', 'utf8')
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l));

const answerable = rows.filter((r) => r.answerable);
const misses: string[] = [];
let hit5 = 0;
let hit1 = 0;
for (const r of answerable) {
  const ranked = backend.scoreAll(r.question);
  const rank = ranked.findIndex((c) => r.groundTruthChunkIds.includes(c.id));
  if (rank === 0) hit1++;
  if (rank >= 0 && rank < 5) hit5++;
  else misses.push(`${r.id} rank=${rank < 0 ? 'none' : rank + 1} "${r.question}" want ${r.groundTruthChunkIds.join('|')} got ${ranked.slice(0, 3).map((c) => c.id).join(',')}`);
}
console.log(`recall@1 ${(hit1 / answerable.length).toFixed(3)}   recall@5 ${(hit5 / answerable.length).toFixed(3)}  (n=${answerable.length})`);
if (misses.length) console.log('\nmisses:\n  ' + misses.join('\n  '));

const scores = { ans: [] as number[], un: [] as number[] };
for (const r of rows) {
  const top = backend.scoreAll(r.question)[0];
  (r.answerable ? scores.ans : scores.un).push(top.similarity);
}
const pct = (a: number[], q: number) => [...a].sort((x, y) => x - y)[Math.floor(a.length * q)];
console.log(`\nanswerable top-1 sim   p10 ${pct(scores.ans, 0.1).toFixed(3)}  p50 ${pct(scores.ans, 0.5).toFixed(3)}`);
console.log(`unanswerable top-1 sim p90 ${pct(scores.un, 0.9).toFixed(3)}  max ${Math.max(...scores.un).toFixed(3)}`);
console.log(`floor by documented rule (midpoint) = ${((pct(scores.ans, 0.1) + pct(scores.un, 0.9)) / 2).toFixed(3)}`);
