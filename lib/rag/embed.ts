import OpenAI from 'openai';
import { EMBEDDING_MODEL } from '@/config/models';
import { retrievalTokens } from '@/lib/util/text';
import { stem } from './stem';

const STOP = new Set(
  "a an the and or of to for in on at is are was were be been being do does did i you we they it its this that with my your our their have has had can could would should will shall if how what when where which who whom why not no yes so as by from about into than then there here me us them but also very just more most some any each other only own same too s t don now much many need needs having getting doing being gone went came taken putting want get got go going take takes make makes give gives put puts come comes know knows think thinks like well back even still way said say says one two first please thanks thank hi hello ok okay".split(
    ' ',
  ),
);

/** Unigrams, Porter stems and bigrams of stems. */
export function features(text: string): string[] {
  const words = retrievalTokens(text).filter((w) => w.length > 1 && !STOP.has(w));
  const stems = words.map(stem);
  const out: string[] = [...words, ...stems.map((s) => `~${s}`)];
  for (let i = 0; i < stems.length - 1; i++) out.push(`${stems[i]}_${stems[i + 1]}`);
  return out;
}

/**
 * Indexed form of a chunk: the heading path is repeated so its terms carry more
 * weight than a passing mention in the body. Without this, "how much is a crown"
 * matches whichever pricing chunk happens to say "crown" once rather than the
 * one headed "Pricing bands > General dentistry".
 */
export const HEADING_BOOST = 3;

export function indexedText(headingPath: string, content: string): string {
  return `${`${headingPath} `.repeat(HEADING_BOOST)}\n${content}`;
}

export interface DenseEmbedder {
  readonly model: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

export class OpenAIEmbedder implements DenseEmbedder {
  readonly model = EMBEDDING_MODEL;
  readonly dimensions = 1536;
  private client: OpenAI;

  constructor(apiKey = process.env.OPENAI_API_KEY) {
    if (!apiKey) throw new Error('OPENAI_API_KEY is not set');
    this.client = new OpenAI({ apiKey });
  }

  async embed(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 96) {
      const res = await this.client.embeddings.create({
        model: this.model,
        input: texts.slice(i, i + 96),
      });
      out.push(...res.data.map((d) => d.embedding));
    }
    return out;
  }
}

export const LEXICAL_MODEL = 'bm25-k1.2-b0.75-v1';

/**
 * Similarity floors are a property of the retrieval space, not a universal
 * constant, so each backend carries its own and every result file records which
 * one produced its numbers.
 *
 * 0.35 is the spec floor for text-embedding-3-small. The offline lexical index
 * sits on a different scale; its floor is set by the rule documented in
 * scripts/calibrate-floor.ts — the midpoint between the 10th percentile of
 * answerable top-1 scores and the 90th percentile of unanswerable ones, on the
 * golden set.
 */
export const FLOORS: Record<string, number> = {
  // Measured, not assumed. The spec's 0.35 silenced 8 of the 48 answerable
  // golden questions on this corpus — 0.17 false abstention from the floor
  // alone, against a 0.05 threshold. scripts/calibrate-dense-floor.ts puts the
  // 5th percentile of answerable top-1 similarity at 0.280, so the documented
  // rule gives 0.27, which silences 2 of 48.
  //
  // Worth knowing: no floor separates answerable from unanswerable here. The
  // unanswerable questions score 0.270 to 0.602, straddling the answerable
  // range entirely. The floor only catches genuinely off-topic queries;
  // abstention is earned by the claim-support check in lib/agent/guardrails.ts.
  [EMBEDDING_MODEL]: 0.27,
  [LEXICAL_MODEL]: 0.37,
};

export function floorFor(model: string): number {
  return FLOORS[model] ?? 0.35;
}
