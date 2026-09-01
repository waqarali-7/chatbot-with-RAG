import { retrieve } from '../lib/rag/retrieve';
import { answerFromContext, candidatesFrom } from '../lib/llm/mock/extract';
import { localIndexData } from '../lib/rag/retrieve';
import { features } from '../lib/rag/embed';

async function main() {
  const qs = process.argv.slice(2);
  const df = localIndexData().bm25.df;
  for (const q of qs) {
    const r = await retrieve(q);
    const terms = [...new Set(features(q))].filter((f) => !f.includes('_') && !f.startsWith('~'));
    console.log(`\nQ ${JSON.stringify(q)}  empty=${r.empty} top=${r.chunks[0]?.id ?? '-'} sim=${r.chunks[0]?.similarity.toFixed(3) ?? '-'}`);
    console.log(`  terms: ${terms.map((t) => `${t}(df=${df[t] ?? 0})`).join(' ')}`);
    console.log(`  answer: ${JSON.stringify(answerFromContext(q, r.chunks, 220, q))}`);
    const cands = candidatesFrom(r.chunks).slice(0, 40);
    const hits = cands.filter((c) => terms.some((t) => c.text.toLowerCase().includes(t)));
    console.log(`  candidates containing a term (${hits.length}/${cands.length}): ${hits.slice(0, 3).map((h) => JSON.stringify(h.text.slice(0, 80))).join(' ')}`);
  }
}
main();
