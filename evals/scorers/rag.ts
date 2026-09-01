import fs from 'node:fs';
import path from 'node:path';
import { runTurn } from '@/lib/agent/loop';
import { newConversationState, type DisclosureMode } from '@/lib/agent/types';
import { MemorySlotStore } from '@/lib/booking/memory-store';
import { generateSlots } from '@/lib/booking/seed';
import { retrieve } from '@/lib/rag/retrieve';
import { TOP_K } from '@/lib/rag/types';
import { evalConcurrency, mapLimit } from '@/lib/util/concurrency';
import { mean, round } from '@/lib/util/stats';
import { EVAL_BASE_MS } from '../harness/conversation';
import { judgeFaithfulness, judgeRelevancy } from './judge';

export interface GoldenRow {
  id: string;
  question: string;
  answer: string;
  evidence?: string;
  groundTruthChunkIds: string[];
  answerable: boolean;
  gapReason?: string;
}

export function loadGolden(): GoldenRow[] {
  const file = path.join(process.cwd(), 'evals', 'datasets', 'golden.jsonl');
  return fs
    .readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as GoldenRow);
}

export interface RagRowResult {
  id: string;
  question: string;
  answerable: boolean;
  retrievedChunkIds: string[];
  topSimilarity: number;
  retrievalEmpty: boolean;
  recallHit: boolean;
  answer: string;
  abstained: boolean;
  claims: { claim: string; supported: boolean }[];
  relevant: boolean;
}

export interface RagResults {
  rows: RagRowResult[];
  metrics: {
    recallAt5: number;
    faithfulness: number;
    relevancy: number;
    abstentionRate: number;
    falseAbstention: number;
    totalClaims: number;
    unsupportedClaims: number;
  };
  retrievalModel: string;
  backendKind: string;
  floor: number;
  topK: number;
  confabulations: { id: string; question: string; answer: string; gapReason?: string }[];
}

/**
 * RAG evaluation over the golden set.
 *
 * Each question is put through the real agent loop rather than a bare retrieval
 * call, because abstention is a property of the whole pipeline: the similarity
 * floor catches the easy gaps, and the claim-support check catches the hard ones
 * where retrieval returns a highly relevant chunk that happens not to contain
 * the answer.
 */
export async function runRagEval(disclosureMode: DisclosureMode = 'info_card'): Promise<RagResults> {
  const golden = loadGolden();
  let backendKind = '';
  let retrievalModel = '';
  let floor = 0;

  // Each row builds its own slot store and carries its own seed, so running
  // them together changes the wall clock and nothing else.
  const rows: RagRowResult[] = await mapLimit(golden, evalConcurrency(), async (g) => {
    const retrieval = await retrieve(g.question, TOP_K);
    backendKind = retrieval.backendKind;
    retrievalModel = retrieval.retrievalModel;
    floor = retrieval.floor;

    const store = new MemorySlotStore(() => EVAL_BASE_MS);
    await store.reset(generateSlots(EVAL_BASE_MS));
    const state = newConversationState(`golden-${g.id}`, disclosureMode, EVAL_BASE_MS);

    const res = await runTurn({
      message: g.question,
      state,
      history: [],
      store,
      now: EVAL_BASE_MS,
    });
    const answer = res.bubbles.map((b) => b.text).join(' ');

    const context = res.context.map((c) => `[${c.id}] ${c.headingPath}\n${c.content}`).join('\n\n');
    const { claims } = await judgeFaithfulness({ question: g.question, answer, context });
    const relevancy = await judgeRelevancy({ question: g.question, answer, context });
    // Judged, not pattern-matched. See the note on RELEVANCY_SYSTEM.
    const abstained = relevancy.declines;

    return {
      id: g.id,
      question: g.question,
      answerable: g.answerable,
      retrievedChunkIds: res.context.map((c) => c.id),
      topSimilarity: round(res.context[0]?.similarity ?? 0),
      retrievalEmpty: retrieval.empty,
      recallHit: g.answerable
        ? res.context.some((c) => g.groundTruthChunkIds.includes(c.id))
        : false,
      answer,
      abstained,
      claims,
      relevant: relevancy.addresses,
    };
  });

  const answerable = rows.filter((r) => r.answerable);
  const unanswerable = rows.filter((r) => !r.answerable);
  const allClaims = rows.flatMap((r) => r.claims);

  return {
    rows,
    retrievalModel,
    backendKind,
    floor,
    topK: TOP_K,
    metrics: {
      recallAt5: round(mean(answerable.map((r) => (r.recallHit ? 1 : 0)))),
      faithfulness: round(
        allClaims.length ? mean(allClaims.map((c) => (c.supported ? 1 : 0))) : 1,
      ),
      relevancy: round(mean(rows.map((r) => (r.relevant ? 1 : 0)))),
      // No tolerance here. One confabulation on a question the corpus cannot
      // answer is a failed build.
      abstentionRate: round(mean(unanswerable.map((r) => (r.abstained ? 1 : 0)))),
      falseAbstention: round(mean(answerable.map((r) => (r.abstained ? 1 : 0)))),
      totalClaims: allClaims.length,
      unsupportedClaims: allClaims.filter((c) => !c.supported).length,
    },
    confabulations: unanswerable
      .filter((r) => !r.abstained)
      .map((r) => ({
        id: r.id,
        question: r.question,
        answer: r.answer,
        gapReason: golden.find((g) => g.id === r.id)?.gapReason,
      })),
  };
}
