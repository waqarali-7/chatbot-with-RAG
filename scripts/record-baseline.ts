/**
 * Record the current offline numbers as the no-regression baseline.
 *
 * Run this deliberately, after reviewing a change that moves the metrics for a
 * good reason. Running it to make a failing gate pass is the same as deleting
 * the test.
 */
import fs from 'node:fs';
import path from 'node:path';

const RESULTS = path.join(process.cwd(), 'evals', 'results');
const read = (n: string) => JSON.parse(fs.readFileSync(path.join(RESULTS, `${n}.json`), 'utf8'));

const rag = read('rag');
const tell = read('tell');
const conversations = read('conversations');

const baseline = {
  recordedAt: new Date().toISOString(),
  stack: `${rag.backendKind} / ${rag.provenance.routing.agent.provider}`,
  note: 'No-regression baseline for the offline stack. Absolute ship thresholds live in evals/thresholds.ts and are enforced when the dense retrieval stack is configured.',
  rag: {
    recallAt5: rag.metrics.recallAt5,
    faithfulness: rag.metrics.faithfulness,
    relevancy: rag.metrics.relevancy,
    falseAbstention: rag.metrics.falseAbstention,
  },
  tell: { tellRate: tell.tellRate },
  conversations: { goalCompletion: conversations.totals.goalCompletion },
};

fs.writeFileSync(path.join(process.cwd(), 'evals', 'baseline.json'), JSON.stringify(baseline, null, 2));
console.log('recorded baseline:', JSON.stringify(baseline.rag), JSON.stringify(baseline.tell));
