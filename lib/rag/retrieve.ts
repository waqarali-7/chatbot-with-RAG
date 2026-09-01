import { providerForRole } from '@/config/models';
import { supabase } from '@/lib/db/client';
import indexJson from '@/content/index.generated.json';
import { OpenAIEmbedder } from './embed';
import { LocalLexicalBackend, PgVectorBackend, type LocalIndex, type RetrievalBackend } from './store';
import { TOP_K, type RetrievalResult } from './types';

const localIndex = indexJson as unknown as LocalIndex;

let cached: RetrievalBackend | null = null;

export function localIndexData(): LocalIndex {
  return localIndex;
}

export function backend(): RetrievalBackend {
  if (!cached) {
    const db = supabase();
    cached =
      db && providerForRole('embedding') === 'openai'
        ? new PgVectorBackend(db, new OpenAIEmbedder())
        : new LocalLexicalBackend(localIndex);
  }
  return cached;
}

/** Test seam. */
export function setBackend(b: RetrievalBackend | null): void {
  cached = b;
}

/**
 * Retrieval with the similarity floor applied. An under-floor result set comes
 * back empty rather than as a weak best guess, and `empty: true` is the signal
 * the agent uses to abstain instead of answering from parametric knowledge.
 */
export async function retrieve(query: string, topK = TOP_K): Promise<RetrievalResult> {
  const started = Date.now();
  const b = backend();
  const chunks = await b.search(query, topK);
  return {
    chunks,
    empty: chunks.length === 0,
    floor: b.floor,
    topK,
    retrievalModel: b.model,
    backendKind: b.kind,
    latencyMs: Date.now() - started,
  };
}

/** The CONTEXT block injected into the system prompt. */
export function formatContext(result: RetrievalResult): string {
  if (result.empty) {
    return '(nothing in the knowledge base matched this, so you do not know the answer)';
  }
  return result.chunks
    .map((c) => `[${c.id}] ${c.headingPath}\n${stripHeading(c.content)}`)
    .join('\n\n');
}

function stripHeading(content: string): string {
  const idx = content.indexOf('\n\n');
  return idx === -1 ? content : content.slice(idx + 2);
}
