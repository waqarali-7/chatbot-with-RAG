import './load-env';
import { supabase } from '../lib/db/client';
import { OpenAIEmbedder } from '../lib/rag/embed';

async function main() {
  const db = supabase()!;
  const { data, error } = await db.from('doc_chunks').select('id,doc,embed_model,embedding,content').limit(2);
  if (error) throw new Error(error.message);

  for (const row of data as Record<string, unknown>[]) {
    const emb = row.embedding;
    console.log(`chunk ${row.id}  model=${row.embed_model}`);
    console.log(`  embedding typeof=${typeof emb} isArray=${Array.isArray(emb)}`);
    if (typeof emb === 'string') {
      console.log(`  stored as STRING, length ${emb.length}, starts: ${emb.slice(0, 60)}`);
      const parsed = JSON.parse(emb);
      console.log(`  parses to array of ${parsed.length}, first 3: ${parsed.slice(0, 3)}`);
      const norm = Math.sqrt(parsed.reduce((a: number, b: number) => a + b * b, 0));
      console.log(`  L2 norm ${norm.toFixed(4)}`);
    } else if (Array.isArray(emb)) {
      console.log(`  array of ${emb.length}, first 3: ${(emb as number[]).slice(0, 3)}`);
    }
    console.log(`  content starts: ${String(row.content).slice(0, 70).replace(/\n/g, ' ')}\n`);
  }

  // Cosine computed locally, bypassing pgvector entirely.
  const embedder = new OpenAIEmbedder();
  const [q] = await embedder.embed(['how much is a crown']);
  const rows = data as Record<string, unknown>[];
  for (const row of rows) {
    const raw = row.embedding;
    const vec: number[] = typeof raw === 'string' ? JSON.parse(raw) : (raw as number[]);
    const dot = vec.reduce((a, v, i) => a + v * q[i], 0);
    console.log(`local cosine vs "${String(row.id)}": ${dot.toFixed(4)}`);
  }

  // Same query through the SQL function with no floor.
  const { data: m, error: e2 } = await db.rpc('match_chunks', {
    query_embedding: q,
    match_count: 3,
    similarity_floor: -1,
  });
  if (e2) throw new Error(e2.message);
  console.log('\nmatch_chunks says:', JSON.stringify(m, null, 0).slice(0, 300));
}
main().catch((e) => console.error('FAILED:', e));
