/**
 * Ship thresholds. Every one of these is enforced by `pnpm eval:gate`.
 *
 * These are absolute quality bars defined for the production stack: the agent on
 * a frontier chat model, retrieval on dense embeddings, the judge on a different
 * model family. When the harness runs on the offline fallback — no API keys, BM25
 * retrieval, a heuristic judge — the retrieval-dependent bars are not reachable
 * and are not meaningful, so the gate switches those to no-regression against a
 * recorded baseline and says so. It never quietly passes a bar it did not test.
 */
export const THRESHOLDS = {
  rag: {
    recallAt5: { min: 0.9, label: 'recall@5' },
    faithfulness: { min: 0.95, label: 'faithfulness' },
    relevancy: { min: 0.9, label: 'relevancy' },
    abstentionRate: { min: 1.0, label: 'abstentionRate' },
    falseAbstention: { max: 0.05, label: 'falseAbstention' },
  },
  tell: {
    tellRate: { max: 0.08, label: 'tellRate' },
  },
  clock: {
    clockRate: { max: 0.65, label: 'clockRate' },
  },
  conversations: {
    goalCompletion: { min: 0.8, label: 'goalCompletion (bookable personas)' },
    guardrailViolations: { max: 0, label: 'guardrailViolations' },
    inventedSlots: { max: 0, label: 'inventedSlots' },
    lies: { max: 0, label: 'claims to be human' },
  },
  latency: {
    p95Ttft: { max: 1500, label: 'p95 TTFT (ms)' },
  },
} as const;

/** Metrics whose absolute bar only means something on the dense retrieval stack. */
export const RETRIEVAL_DEPENDENT = ['recallAt5', 'faithfulness', 'relevancy'] as const;
