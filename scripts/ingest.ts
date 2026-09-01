/**
 * Chunk the corpus and build both indexes:
 *   - the bundled offline lexical index, always written and committed, so the
 *     edge chat route can import it without filesystem access
 *   - the pgvector table, when Supabase and OpenAI embeddings are configured
 *
 * Run after any change to content/docs.
 */
import './load-env';
import fs from 'node:fs';
import path from 'node:path';
import { EMBEDDING_MODEL, providerForRole } from '../config/models';
import { supabase } from '../lib/db/client';
import { chunkMarkdown } from '../lib/rag/chunk';
import { buildBm25 } from '../lib/rag/bm25';
import { indexedText, LEXICAL_MODEL, OpenAIEmbedder } from '../lib/rag/embed';
import type { Chunk } from '../lib/rag/types';

const DOCS_DIR = path.join(process.cwd(), 'content', 'docs');
const OUT = path.join(process.cwd(), 'content', 'index.generated.json');

export function loadChunks(): Chunk[] {
  const files = fs.readdirSync(DOCS_DIR).filter((f) => f.endsWith('.md')).sort();
  const chunks: Chunk[] = [];
  for (const f of files) {
    const md = fs.readFileSync(path.join(DOCS_DIR, f), 'utf8');
    chunks.push(...chunkMarkdown(f.replace(/\.md$/, ''), md));
  }
  return chunks;
}

async function main() {
  const chunks = loadChunks();
  const tokens = chunks.map((c) => c.tokenCount).sort((a, b) => a - b);
  console.log(`corpus -> ${chunks.length} chunks`);
  console.log(
    `  tokens/chunk  min ${tokens[0]}  median ${tokens[Math.floor(tokens.length / 2)]}  max ${tokens[tokens.length - 1]}`,
  );

  const indexed = chunks.map((c) => indexedText(`${c.doc} > ${c.headingPath}`, c.content));
  const bm25 = buildBm25(indexed);
  console.log(`  vocabulary ${Object.keys(bm25.df).length} features, avg ${bm25.avgLen.toFixed(0)} features/chunk`);

  fs.writeFileSync(
    OUT,
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      model: LEXICAL_MODEL,
      bm25,
      chunks,
    }),
  );
  console.log(`wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);

  const db = supabase();
  if (!db || providerForRole('embedding') !== 'openai') {
    console.log('supabase or openai embeddings not configured; skipped pgvector ingest');
    return;
  }

  const real = new OpenAIEmbedder();
  const vectors = await real.embed(chunks.map((c) => c.content));
  await db.from('doc_chunks').delete().neq('id', '');
  for (let i = 0; i < chunks.length; i += 100) {
    const rows = chunks.slice(i, i + 100).map((c, j) => ({
      id: c.id,
      doc: c.doc,
      heading_path: c.headingPath,
      content: c.content,
      token_count: c.tokenCount,
      embedding: vectors[i + j],
      embed_model: EMBEDDING_MODEL,
    }));
    const { error } = await db.from('doc_chunks').insert(rows);
    if (error) throw new Error(error.message);
  }
  console.log(`ingested ${chunks.length} chunks into pgvector with ${EMBEDDING_MODEL}`);
}

if (process.argv[1]?.endsWith('ingest.ts')) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
