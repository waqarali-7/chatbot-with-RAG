import './load-env';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Rebuild evals/results/latest.json from the per-stage files, keeping only the
 * stages that belong to the same run.
 *
 * The runner writes latest.json at the very end, so an interrupted run leaves
 * it pointing at whatever finished last time. That is how /evals ended up
 * rendering an offline mock run while rag, conversations and tell on disk were
 * real Claude. Mixing provenance on one page is worse than showing less: a
 * scorecard whose rows come from different systems is not measuring anything.
 *
 * A stage is kept when its routing and retrieval backend match the reference
 * stage. Everything else is reported as not run, and the stale file is moved to
 * evals/results/archive/ rather than deleted.
 */
const RESULTS = path.join(process.cwd(), 'evals', 'results');
const ARCHIVE = path.join(RESULTS, 'archive');
const STAGES = ['rag', 'conversations', 'tell', 'disclosure', 'providers', 'latency', 'clock'] as const;

type Stage = (typeof STAGES)[number];
const read = (n: string) => {
  const p = path.join(RESULTS, `${n}.json`);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const stackOf = (d: Record<string, unknown> | null): string | null => {
  const prov = d?.provenance as
    | { routing?: Record<string, { provider?: string }>; retrieval?: { backend?: string } }
    | undefined;
  if (!prov?.routing) return null;
  const roles = ['agent', 'guardrail', 'judge', 'embedding'];
  return `${roles.map((r) => `${r}=${prov.routing![r]?.provider}`).join(' ')} retrieval=${prov.retrieval?.backend}`;
};

const loaded = Object.fromEntries(STAGES.map((s) => [s, read(s)])) as Record<
  Stage,
  Record<string, unknown> | null
>;

// The reference is the rag stage when present: it is the first thing the runner
// writes, so it identifies the run everything else should belong to.
const reference = loaded.rag ?? loaded.conversations ?? loaded.tell;
const referenceStack = stackOf(reference ?? null);
if (!referenceStack) {
  console.error('No stage carries provenance. Run `pnpm eval` first.');
  process.exit(1);
}

const kept: Stage[] = [];
const dropped: { stage: Stage; stack: string | null }[] = [];
const out: Record<string, unknown> = {};

for (const stage of STAGES) {
  const data = loaded[stage];
  if (!data) {
    dropped.push({ stage, stack: null });
    out[stage] = null;
    continue;
  }
  // The clock study makes no provider calls, so it has no stack to match.
  if (stage === 'clock') {
    out[stage] = data;
    kept.push(stage);
    continue;
  }
  const stack = stackOf(data);
  if (stack === referenceStack) {
    out[stage] = data;
    kept.push(stage);
  } else {
    dropped.push({ stage, stack });
    out[stage] = null;
  }
}

fs.mkdirSync(ARCHIVE, { recursive: true });
for (const { stage, stack } of dropped) {
  if (!stack) continue;
  const from = path.join(RESULTS, `${stage}.json`);
  if (fs.existsSync(from)) {
    fs.renameSync(from, path.join(ARCHIVE, `${stage}.${Date.now()}.json`));
  }
}

fs.writeFileSync(
  path.join(RESULTS, 'latest.json'),
  JSON.stringify(
    {
      provenance: (reference as Record<string, unknown>).provenance,
      ran: kept,
      notRun: dropped.map((d) => d.stage),
      assembledAt: new Date().toISOString(),
      ...out,
    },
    null,
    2,
  ),
);

console.log(`stack: ${referenceStack}`);
console.log(`kept:    ${kept.join(', ') || 'none'}`);
console.log(`not run: ${dropped.map((d) => d.stage).join(', ') || 'none'}`);
if (dropped.some((d) => d.stack)) {
  console.log(`\nmoved mismatched stages to evals/results/archive/:`);
  for (const d of dropped.filter((x) => x.stack)) console.log(`  ${d.stage}  was ${d.stack}`);
}
