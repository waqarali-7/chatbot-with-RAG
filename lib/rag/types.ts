export interface Chunk {
  id: string;
  doc: string;
  headingPath: string;
  content: string;
  tokenCount: number;
}

export interface EmbeddedChunk extends Chunk {
  embedding: number[];
  embedModel: string;
}

export interface RetrievedChunk extends Chunk {
  similarity: number;
}

export interface RetrievalResult {
  chunks: RetrievedChunk[];
  /** True when nothing cleared the floor. The agent must abstain. */
  empty: boolean;
  floor: number;
  topK: number;
  retrievalModel: string;
  backendKind: 'pgvector' | 'local-lexical';
  latencyMs: number;
}

/**
 * Below this cosine similarity we return nothing rather than the least-bad
 * chunk. Returning a weak match is how an agent ends up confidently answering a
 * question the corpus does not cover; the floor is what makes abstention
 * possible at all.
 */
export const SIMILARITY_FLOOR = 0.35;
export const TOP_K = 5;
