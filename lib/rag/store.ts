import type { SupabaseClient } from '@supabase/supabase-js';
import { bm25Score, squash, type Bm25Index } from './bm25';
import { floorFor, LEXICAL_MODEL, type DenseEmbedder } from './embed';
import type { Chunk, RetrievedChunk } from './types';

/**
 * A retrieval backend owns its own query encoding. Keeping embedding inside the
 * backend is what lets the offline lexical index and the pgvector index sit
 * behind one interface without pretending they share a similarity scale.
 */
export interface RetrievalBackend {
  readonly kind: 'pgvector' | 'local-lexical';
  readonly model: string;
  readonly floor: number;
  search(query: string, topK: number): Promise<RetrievedChunk[]>;
  count(): Promise<number>;
}

export interface LocalIndex {
  generatedAt: string;
  model: string;
  bm25: Bm25Index;
  chunks: Chunk[];
}

/**
 * Offline backend: BM25 over the corpus. Lexical, not semantic. It exists so the
 * demo, the tests and the whole eval harness run with zero setup, and every
 * result file it produces is labelled with this model string so its numbers can
 * never be read as dense-retrieval numbers.
 */
export class LocalLexicalBackend implements RetrievalBackend {
  readonly kind = 'local-lexical' as const;
  readonly model: string;
  readonly floor: number;

  constructor(
    private index: LocalIndex,
    floorOverride?: number,
  ) {
    this.model = index.model;
    this.floor = floorOverride ?? floorFor(index.model);
  }

  async search(query: string, topK: number): Promise<RetrievedChunk[]> {
    return this.scoreAll(query)
      .filter((c) => c.similarity >= this.floor)
      .slice(0, topK);
  }

  /** Unfiltered, ranked scores. Used by the floor calibration script. */
  scoreAll(query: string): RetrievedChunk[] {
    return this.index.chunks
      .map((c, i) => ({
        id: c.id,
        doc: c.doc,
        headingPath: c.headingPath,
        content: c.content,
        tokenCount: c.tokenCount,
        similarity: squash(bm25Score(this.index.bm25, query, i)),
      }))
      .sort((a, b) => b.similarity - a.similarity);
  }

  async count(): Promise<number> {
    return this.index.chunks.length;
  }
}

export class PgVectorBackend implements RetrievalBackend {
  readonly kind = 'pgvector' as const;
  readonly model: string;
  readonly floor: number;

  constructor(
    private db: SupabaseClient,
    private embedder: DenseEmbedder,
  ) {
    this.model = embedder.model;
    this.floor = floorFor(embedder.model);
  }

  async search(query: string, topK: number): Promise<RetrievedChunk[]> {
    const [q] = await this.embedder.embed([query]);
    const { data, error } = await this.db.rpc('match_chunks', {
      query_embedding: q,
      match_count: topK,
      similarity_floor: this.floor,
    });
    if (error) throw new Error(`match_chunks: ${error.message}`);
    return (data as Record<string, unknown>[]).map((r) => ({
      id: r.id as string,
      doc: r.doc as string,
      headingPath: r.heading_path as string,
      content: r.content as string,
      tokenCount: 0,
      similarity: r.similarity as number,
    }));
  }

  async count(): Promise<number> {
    const { count, error } = await this.db
      .from('doc_chunks')
      .select('id', { count: 'exact', head: true });
    if (error) throw new Error(`count: ${error.message}`);
    return count ?? 0;
  }
}

export { LEXICAL_MODEL };
