import './load-env';
import fs from 'node:fs';
import { supabase } from '../lib/db/client';
import { OpenAIEmbedder } from '../lib/rag/embed';

/**
 * Measure the actual similarity distribution of the dense backend on the golden
 * set, with the floor disabled, and report what floor the documented rule gives.
 *
 * The spec's 0.35 was taken on faith. This is the measurement that says whether
 * it is right for this embedding model on this corpus.
 */
async function main() {
  const db = supabase()!;
  const embedder = new OpenAIEmbedder();
  const rows = fs
    .readFileSync('evals/datasets/golden.jsonl', 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as { id: string; question: string; answerable: boolean; groundTruthChunkIds: string[] });

  const vectors = await embedder.embed(rows.map((r) => r.question));

  const ans: number[] = [];
  const un: number[] = [];
  let hit5NoFloor = 0;
  let answerable = 0;
  const rankOf: number[] = [];

  for (const [i, r] of rows.entries()) {
    const { data, error } = await db.rpc('match_chunks', {
      query_embedding: vectors[i],
      match_count: 10,
      similarity_floor: -1,
    });
    if (error) throw new Error(error.message);
    const hits = data as { id: string; similarity: number }[];
    const top = hits[0]?.similarity ?? 0;
    if (r.answerable) {
      answerable++;
      ans.push(top);
      const rank = hits.findIndex((h) => r.groundTruthChunkIds.includes(h.id));
      rankOf.push(rank);
      if (rank >= 0 && rank < 5) hit5NoFloor++;
    } else {
      un.push(top);
    }
  }

  const pct = (a: number[], q: number) => [...a].sort((x, y) => x - y)[Math.max(0, Math.floor(a.length * q))];

  console.log(`\nrecall@5 with the floor disabled: ${(hit5NoFloor / answerable).toFixed(4)} (n=${answerable})`);
  console.log(`  misses at any rank: ${rankOf.filter((r) => r < 0).length}`);
  console.log('\nanswerable top-1 similarity');
  console.log(`  min ${Math.min(...ans).toFixed(3)}  p05 ${pct(ans, 0.05).toFixed(3)}  p10 ${pct(ans, 0.1).toFixed(3)}  p50 ${pct(ans, 0.5).toFixed(3)}  max ${Math.max(...ans).toFixed(3)}`);
  console.log('unanswerable top-1 similarity');
  console.log(`  min ${Math.min(...un).toFixed(3)}  p50 ${pct(un, 0.5).toFixed(3)}  p90 ${pct(un, 0.9).toFixed(3)}  max ${Math.max(...un).toFixed(3)}`);

  const floor = Math.floor(pct(ans, 0.05) * 100) / 100;
  console.log(`\nfloor by the documented rule, p05(answerable) rounded down = ${floor.toFixed(2)}`);
  console.log(`  current configured floor: 0.35`);
  console.log(`  answerable questions the 0.35 floor silences: ${ans.filter((s) => s < 0.35).length}/${ans.length}`);
  console.log(`  answerable questions a ${floor.toFixed(2)} floor silences: ${ans.filter((s) => s < floor).length}/${ans.length}`);
  console.log(`  unanswerable caught by ${floor.toFixed(2)} alone: ${un.filter((s) => s < floor).length}/${un.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
