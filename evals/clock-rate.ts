import fs from 'node:fs';
import path from 'node:path';
import { round } from '@/lib/util/stats';

/**
 * Blind clock-rate study.
 *
 * Forty short excerpts, twenty from the agent and twenty written as human
 * receptionist exchanges, presented with metadata stripped in a fixed shuffled
 * order. Three labellers who have not seen the system answer one question per
 * excerpt: human or bot.
 *
 * This is the one measurement in the suite that cannot be automated. Labels are
 * read from evals/datasets/clock-labels.jsonl; when that file is absent or
 * incomplete the study reports `status: "awaiting_labels"` and no rate. It never
 * synthesises labels, because a clock-rate produced by the same system being
 * measured is not evidence of anything.
 */

export interface ClockExcerpt {
  id: string;
  /** Never shown to labellers. */
  source: 'agent' | 'human';
  lines: { who: 'visitor' | 'desk'; text: string }[];
}

export interface ClockLabel {
  labeller: string;
  excerptId: string;
  guess: 'human' | 'bot';
}

const EXCERPTS_FILE = path.join(process.cwd(), 'evals', 'datasets', 'clock-excerpts.jsonl');
const LABELS_FILE = path.join(process.cwd(), 'evals', 'datasets', 'clock-labels.jsonl');

export function loadExcerpts(): ClockExcerpt[] {
  if (!fs.existsSync(EXCERPTS_FILE)) return [];
  return fs
    .readFileSync(EXCERPTS_FILE, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as ClockExcerpt);
}

export function loadLabels(): ClockLabel[] {
  if (!fs.existsSync(LABELS_FILE)) return [];
  return fs
    .readFileSync(LABELS_FILE, 'utf8')
    .trim()
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('//'))
    .map((l) => JSON.parse(l) as ClockLabel);
}

export interface ClockResults {
  status: 'awaiting_labels' | 'complete';
  excerpts: number;
  agentExcerpts: number;
  humanExcerpts: number;
  labellers: string[];
  labelsCollected: number;
  labelsExpected: number;
  /** Share of agent excerpts correctly identified as bot. Chance is 0.50. */
  clockRate: number | null;
  perLabeller: { labeller: string; clockRate: number; falsePositiveRate: number }[];
  confusion: { agentCalledBot: number; agentCalledHuman: number; humanCalledBot: number; humanCalledHuman: number } | null;
  agreement: number | null;
  note: string;
}

export function runClockRateStudy(): ClockResults {
  const excerpts = loadExcerpts();
  const labels = loadLabels();
  const agent = excerpts.filter((e) => e.source === 'agent');
  const human = excerpts.filter((e) => e.source === 'human');
  const labellers = [...new Set(labels.map((l) => l.labeller))].sort();
  const expected = excerpts.length * 3;

  const base = {
    excerpts: excerpts.length,
    agentExcerpts: agent.length,
    humanExcerpts: human.length,
    labellers,
    labelsCollected: labels.length,
    labelsExpected: expected,
  };

  if (labellers.length < 3 || labels.length < expected) {
    return {
      ...base,
      status: 'awaiting_labels',
      clockRate: null,
      perLabeller: [],
      confusion: null,
      agreement: null,
      note: `This study needs three human labellers who have not seen the system. ${labels.length} of ${expected} labels are recorded across ${labellers.length} labellers. Run \`pnpm tsx scripts/clock-study.ts\` to print the blinded excerpts, then append one JSON line per judgement to evals/datasets/clock-labels.jsonl. No rate is reported until then, and none is estimated.`,
    };
  }

  const sourceOf = new Map(excerpts.map((e) => [e.id, e.source]));
  const confusion = { agentCalledBot: 0, agentCalledHuman: 0, humanCalledBot: 0, humanCalledHuman: 0 };
  const perLabeller: ClockResults['perLabeller'] = [];

  for (const labeller of labellers) {
    const mine = labels.filter((l) => l.labeller === labeller);
    let agentCorrect = 0;
    let agentTotal = 0;
    let humanWrong = 0;
    let humanTotal = 0;
    for (const l of mine) {
      const src = sourceOf.get(l.excerptId);
      if (src === 'agent') {
        agentTotal++;
        if (l.guess === 'bot') {
          agentCorrect++;
          confusion.agentCalledBot++;
        } else confusion.agentCalledHuman++;
      } else if (src === 'human') {
        humanTotal++;
        if (l.guess === 'bot') {
          humanWrong++;
          confusion.humanCalledBot++;
        } else confusion.humanCalledHuman++;
      }
    }
    perLabeller.push({
      labeller,
      clockRate: agentTotal ? round(agentCorrect / agentTotal) : 0,
      falsePositiveRate: humanTotal ? round(humanWrong / humanTotal) : 0,
    });
  }

  const totalAgent = confusion.agentCalledBot + confusion.agentCalledHuman;

  // Share of excerpts where all three labellers agreed.
  let unanimous = 0;
  for (const e of excerpts) {
    const guesses = labels.filter((l) => l.excerptId === e.id).map((l) => l.guess);
    if (guesses.length === 3 && new Set(guesses).size === 1) unanimous++;
  }

  return {
    ...base,
    status: 'complete',
    clockRate: totalAgent ? round(confusion.agentCalledBot / totalAgent) : null,
    perLabeller,
    confusion,
    agreement: excerpts.length ? round(unanimous / excerpts.length) : null,
    note: 'Directional, not statistically robust: 40 excerpts and 3 labellers. Chance is 0.50. Read the confusion matrix alongside the rate, because a labeller who calls everything a bot scores a perfect clock-rate and a 1.00 false positive rate.',
  };
}
