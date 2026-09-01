import './load-env';
import { supabase } from '../lib/db/client';

async function main() {
  const db = supabase()!;
  const { data } = await db.from('doc_chunks').select('id,embedding').limit(1);
  const vec = JSON.parse((data as { embedding: string }[])[0].embedding) as number[];
  const { data: big } = await db.rpc('match_chunks', {
    query_embedding: vec, match_count: 100, similarity_floor: -100,
  });
  const n = ((big ?? []) as unknown[]).length;
  console.log(`match_count=100 floor=-100 -> ${n} rows of 27`);
  console.log(n >= 27 ? '  index is gone, exact scan working' : '  STILL INDEXED: the drop has not been applied');
}
main().catch((e) => console.error('FAILED:', e));
