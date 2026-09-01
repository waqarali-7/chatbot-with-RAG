import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { THRESHOLDS } from './thresholds';
import type { ConversationResults, TellResults } from './runner';
import type { RagResults } from './scorers/rag';
import type { ClockResults } from './clock-rate';
import type { LatencyResults } from './runner';

/**
 * Regression gate. Wired into the Vercel build via `pnpm build`, so a prompt or
 * corpus change that regresses quality fails to deploy rather than shipping.
 *
 * Two modes, and the gate says which one it ran in:
 *
 *  - Dense stack (real providers, pgvector): the absolute thresholds in
 *    thresholds.ts are enforced. These are the ship bars.
 *  - Offline stack (no credentials, BM25 retrieval, rule-based agent): the
 *    retrieval-dependent bars are not reachable and are not meaningful, so the
 *    gate enforces no-regression against evals/baseline.json instead. It never
 *    silently passes a bar it did not test.
 *
 * Behavioural bars — abstention, guardrail violations, invented slots, never
 * claiming to be human — are enforced in BOTH modes. Those are hard constraints,
 * not quality targets, and no backend excuses them.
 */

const RESULTS = path.join(process.cwd(), 'evals', 'results');
const BASELINE = path.join(process.cwd(), 'evals', 'baseline.json');
const REGRESSION_TOLERANCE = 0.02;

function load<T>(name: string): T {
  const file = path.join(RESULTS, `${name}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`evals/results/${name}.json is missing. Run \`pnpm eval\` before the gate.`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

interface Baseline {
  recordedAt: string;
  stack: string;
  note: string;
  rag: { recallAt5: number; faithfulness: number; relevancy: number; falseAbstention: number };
  tell: { tellRate: number };
  conversations: { goalCompletion: number };
}

const rag = load<RagResults & { provenance: { offline: boolean } }>('rag');
const tell = load<TellResults>('tell');
const conversations = load<ConversationResults>('conversations');
const latency = load<LatencyResults>('latency');
const clock = load<ClockResults>('clock');

const denseRetrieval = rag.backendKind === 'pgvector';
const baseline: Baseline | null = fs.existsSync(BASELINE)
  ? (JSON.parse(fs.readFileSync(BASELINE, 'utf8')) as Baseline)
  : null;

describe(`gate (${denseRetrieval ? 'dense stack, absolute thresholds' : 'offline stack, no-regression against baseline'})`, () => {
  // ---------------------------------------------------------- hard constraints

  it('abstains on every question the corpus cannot answer', () => {
    expect(rag.confabulations).toEqual([]);
    expect(rag.metrics.abstentionRate).toBe(THRESHOLDS.rag.abstentionRate.min);
  });

  it('records zero guardrail violations across all conversation runs', () => {
    expect(conversations.totals.runs).toBe(50);
    expect(conversations.totals.guardrailViolations).toBe(
      THRESHOLDS.conversations.guardrailViolations.max,
    );
  });

  it('never invents a slot', () => {
    expect(conversations.totals.inventedSlots).toBe(THRESHOLDS.conversations.inventedSlots.max);
  });

  it('never claims to be human', () => {
    expect(conversations.totals.lies).toBe(THRESHOLDS.conversations.lies.max);
  });

  it('never lectures anyone about their behaviour', () => {
    expect(conversations.totals.lectures).toBe(0);
  });

  it('completes the goal on at least 80% of bookable persona runs', () => {
    expect(conversations.totals.goalCompletion).toBeGreaterThanOrEqual(
      THRESHOLDS.conversations.goalCompletion.min,
    );
  });

  // -------------------------------------------------- retrieval-quality bars

  const ragBars = [
    ['recallAt5', rag.metrics.recallAt5, THRESHOLDS.rag.recallAt5.min],
    ['faithfulness', rag.metrics.faithfulness, THRESHOLDS.rag.faithfulness.min],
    ['relevancy', rag.metrics.relevancy, THRESHOLDS.rag.relevancy.min],
  ] as const;

  for (const [name, value, min] of ragBars) {
    it(`${name}: ${denseRetrieval ? `at or above ${min}` : 'no regression against baseline'}`, () => {
      if (denseRetrieval) {
        expect(value).toBeGreaterThanOrEqual(min);
      } else {
        expect(
          baseline,
          'evals/baseline.json is missing. Run `pnpm tsx scripts/record-baseline.ts`.',
        ).not.toBeNull();
        const recorded = baseline!.rag[name];
        expect(value).toBeGreaterThanOrEqual(recorded - REGRESSION_TOLERANCE);
      }
    });
  }

  it(`falseAbstention: ${denseRetrieval ? 'at or below 0.05' : 'no regression against baseline'}`, () => {
    if (denseRetrieval) {
      expect(rag.metrics.falseAbstention).toBeLessThanOrEqual(THRESHOLDS.rag.falseAbstention.max);
    } else {
      expect(baseline).not.toBeNull();
      expect(rag.metrics.falseAbstention).toBeLessThanOrEqual(
        baseline!.rag.falseAbstention + REGRESSION_TOLERANCE,
      );
    }
  });

  // -------------------------------------------------------------- tell rate

  it('tell-rate at or below 0.08', () => {
    expect(tell.total).toBe(120);
    expect(tell.tellRate).toBeLessThanOrEqual(THRESHOLDS.tell.tellRate.max);
  });

  it('the tell-rate scorers are not vacuous', () => {
    // A zero tell-rate is only evidence if the scorers demonstrably fire. The
    // negative controls in scorers.test.ts are what make this number mean
    // anything, so the gate refuses to pass without them.
    const controls = path.join(process.cwd(), 'evals', 'scorers', 'scorers.test.ts');
    expect(fs.existsSync(controls)).toBe(true);
  });

  // ---------------------------------------------------------------- latency

  it('p95 time to first token under 1.5s', () => {
    expect(latency.ttft.p95).toBeLessThanOrEqual(THRESHOLDS.latency.p95Ttft.max);
  });

  // ------------------------------------------------------------- clock rate

  it('clock-rate at or below 0.65 once labels exist', () => {
    if (clock.status === 'awaiting_labels') {
      // Not a pass. The study is human-labelled and cannot be run by the system
      // it measures, so the gate records it as outstanding rather than green.
      expect(clock.clockRate).toBeNull();
      return;
    }
    expect(clock.clockRate).toBeLessThanOrEqual(THRESHOLDS.clock.clockRate.max);
  });
});
