/**
 * Eval runner. `pnpm eval` runs everything and writes JSON to evals/results/;
 * /evals renders the latest.
 *
 *   pnpm eval:rag         golden set: recall, faithfulness, relevancy, abstention
 *   pnpm eval:tell        turn-level tell-rate, deterministic + judge
 *   pnpm eval:conv        ten personas, five seeded runs each
 *   pnpm eval:disclosure  the same conversation suite across all three modes
 *   pnpm eval:providers   golden set and tell-rate on both agent providers
 *   pnpm eval:latency     TTFT, end-to-end, and delivered delay distribution
 *   pnpm eval:clock       blind clock-rate study from recorded labels
 */
import '../scripts/load-env';
import fs from 'node:fs';
import path from 'node:path';
import { isFullyOffline, judgeIsCrossFamily, providerForRole, type ProviderId } from '@/config/models';
import { DISCLOSURE_MODES, type DisclosureMode } from '@/lib/agent/types';
import { describeRouting } from '@/lib/llm/registry';
import { QuotaExhaustedError } from '@/lib/llm/retry';
import { backend } from '@/lib/rag/retrieve';
import { evalConcurrency, mapLimit } from '@/lib/util/concurrency';
import { histogram, mean, p50, p95, round } from '@/lib/util/stats';
import { runConversation, SEEDS } from './harness/conversation';
import { PERSONAS } from './personas';
import { scoreTurnDeterministic, styleBreakdown, type DeterministicVerdict } from './scorers/deterministic';
import { judgeTellTurn, TELL_FLAGS, type TellFlag, type TellVerdict } from './scorers/judge';
import { runRagEval } from './scorers/rag';
import { runClockRateStudy } from './clock-rate';

const RESULTS_DIR = path.join(process.cwd(), 'evals', 'results');

export interface Provenance {
  runAt: string;
  routing: ReturnType<typeof describeRouting>;
  retrieval: { model: string; backend: string; floor: number };
  offline: boolean;
  judgeCrossFamily: boolean;
  /** Set when the numbers were produced by the offline stand-ins. */
  caveat: string | null;
}

export function provenance(): Provenance {
  const b = backend();
  const offline = isFullyOffline();
  const judgeMock = providerForRole('judge') === 'mock';
  const agentMock = providerForRole('agent') === 'mock';
  const notes: string[] = [];
  if (agentMock) notes.push('the agent is the deterministic offline stand-in, not a model');
  if (judgeMock) notes.push('the judge is heuristic, not a model');
  if (b.kind === 'local-lexical') notes.push('retrieval is BM25, not dense embeddings');
  return {
    runAt: new Date().toISOString(),
    routing: describeRouting(),
    retrieval: { model: b.model, backend: b.kind, floor: b.floor },
    offline,
    judgeCrossFamily: judgeIsCrossFamily(),
    caveat: notes.length
      ? `This run was produced with no provider credentials: ${notes.join('; ')}. It demonstrates the harness and gates regressions. It is not a graded run of the production stack.`
      : null,
  };
}

function write(name: string, data: unknown) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const file = path.join(RESULTS_DIR, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  console.log(`  -> evals/results/${name}.json`);
}

function read<T>(name: string): T | null {
  const file = path.join(RESULTS_DIR, `${name}.json`);
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as T) : null;
}

// ------------------------------------------------------------------ tell rate

export interface TellResults {
  provenance: Provenance;
  total: number;
  deterministic: { flagged: number; rate: number; breakdown: Record<string, number> };
  judge: { flagged: number; rate: number; breakdown: Record<TellFlag, number> };
  /** A turn counts as flagged if either scorer flags it. */
  tellRate: number;
  flaggedTurns: number;
  byPersona: Record<string, { turns: number; flagged: number; rate: number }>;
  examples: { turnId: string; personaId: string; user: string; agent: string; flags: string[] }[];
}

interface TurnRow {
  turnId: string;
  personaId: string;
  user: string;
  agent: string;
  context: string;
  retrievalEmpty: boolean;
  offScript: boolean;
  action: string;
}

export function loadTurns(): TurnRow[] {
  const file = path.join(process.cwd(), 'evals', 'datasets', 'turns.jsonl');
  if (!fs.existsSync(file)) {
    throw new Error('evals/datasets/turns.jsonl is missing. Run `pnpm tsx scripts/build-turns.ts`.');
  }
  return fs
    .readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as TurnRow);
}

export async function runTellEval(): Promise<TellResults> {
  const turns = loadTurns();
  const det: DeterministicVerdict[] = turns.map((t) =>
    scoreTurnDeterministic({
      turnId: t.turnId,
      personaId: t.personaId,
      userMessage: t.user,
      agentMessage: t.agent,
    }),
  );

  const judged: TellVerdict[] = await mapLimit(turns, evalConcurrency(), (t) =>
    judgeTellTurn({
      turnId: t.turnId,
      userMessage: t.user,
      agentMessage: t.agent,
      context: t.context,
      retrievalEmpty: t.retrievalEmpty,
      offScript: t.offScript,
      action: t.action,
    }),
  );

  const judgeBreakdown = Object.fromEntries(TELL_FLAGS.map((f) => [f, 0])) as Record<TellFlag, number>;
  for (const v of judged) for (const f of TELL_FLAGS) if (v.flags[f]) judgeBreakdown[f]++;

  const flaggedIds = new Set<string>();
  for (const v of det) if (v.flagged) flaggedIds.add(v.turnId);
  for (const v of judged) if (TELL_FLAGS.some((f) => v.flags[f])) flaggedIds.add(v.turnId);

  const byPersona: TellResults['byPersona'] = {};
  for (const t of turns) {
    byPersona[t.personaId] ??= { turns: 0, flagged: 0, rate: 0 };
    byPersona[t.personaId].turns++;
    if (flaggedIds.has(t.turnId)) byPersona[t.personaId].flagged++;
  }
  for (const k of Object.keys(byPersona)) {
    byPersona[k].rate = round(byPersona[k].flagged / byPersona[k].turns);
  }

  const examples = turns
    .filter((t) => flaggedIds.has(t.turnId))
    .slice(0, 12)
    .map((t) => {
      const d = det.find((v) => v.turnId === t.turnId)!;
      const j = judged.find((v) => v.turnId === t.turnId)!;
      return {
        turnId: t.turnId,
        personaId: t.personaId,
        user: t.user,
        agent: t.agent,
        flags: [...d.violations, ...TELL_FLAGS.filter((f) => j.flags[f])],
      };
    });

  return {
    provenance: provenance(),
    total: turns.length,
    deterministic: {
      flagged: det.filter((v) => v.flagged).length,
      rate: round(mean(det.map((v) => (v.flagged ? 1 : 0)))),
      breakdown: styleBreakdown(det),
    },
    judge: {
      flagged: judged.filter((v) => TELL_FLAGS.some((f) => v.flags[f])).length,
      rate: round(mean(judged.map((v) => (TELL_FLAGS.some((f) => v.flags[f]) ? 1 : 0)))),
      breakdown: judgeBreakdown,
    },
    tellRate: round(flaggedIds.size / turns.length),
    flaggedTurns: flaggedIds.size,
    byPersona,
    examples,
  };
}

// --------------------------------------------------------------- conversations

export interface ConversationResults {
  provenance: Provenance;
  disclosureMode: DisclosureMode;
  runs: {
    personaId: string;
    seed: number;
    booked: boolean;
    turnCount: number;
    pass: boolean;
    why: string;
    guardrailViolations: number;
    inventedSlots: number;
    unsupportedClaims: number;
    styleViolations: number;
    lied: boolean;
    lectured: boolean;
    waitlistOffered: boolean;
    /** The exchange itself. Without it a failed run cannot be diagnosed
     *  without paying to reproduce it, which is exactly when you cannot. */
    transcript: { user: string; agent: string }[];
  }[];
  totals: {
    runs: number;
    goalCompletion: number;
    bookingCompletion: number;
    medianTurnsToBook: number | null;
    guardrailViolations: number;
    inventedSlots: number;
    unsupportedClaims: number;
    lies: number;
    lectures: number;
  };
  byPersona: Record<string, { runs: number; passes: number; booked: number; avgTurns: number }>;
}

export async function runConversationEval(
  disclosureMode: DisclosureMode,
  agentProviderOverride?: ProviderId,
): Promise<ConversationResults> {
  const byPersona: ConversationResults['byPersona'] = {};
  const bookTurns: number[] = [];

  // Every run is independent: its own in-process slot store, its own fixed seed.
  const jobs = PERSONAS.flatMap((persona) => SEEDS.map((seed) => ({ persona, seed })));
  const results = await mapLimit(jobs, evalConcurrency(), async ({ persona, seed }) => {
    const summary = await runConversation({ persona, seed, disclosureMode, agentProviderOverride });
    return { persona, seed, summary, verdict: persona.successCondition(summary) };
  });

  const runs: ConversationResults['runs'] = results.map(({ persona, seed, summary, verdict }) => ({
    personaId: persona.id,
    seed,
    booked: summary.booked,
    turnCount: summary.turnCount,
    pass: verdict.pass,
    why: verdict.why,
    guardrailViolations: summary.guardrailViolations,
    inventedSlots: summary.inventedSlots,
    unsupportedClaims: summary.unsupportedClaims,
    styleViolations: summary.styleViolations,
    lied: summary.lied,
    lectured: summary.lectured,
    waitlistOffered: summary.waitlistOffered,
    transcript: summary.turns.map((t) => ({ user: t.user, agent: t.agent })),
  }));

  for (const persona of PERSONAS) byPersona[persona.id] = { runs: 0, passes: 0, booked: 0, avgTurns: 0 };
  for (const { persona, summary, verdict } of results) {
    const b = byPersona[persona.id];
    b.runs++;
    if (verdict.pass) b.passes++;
    if (summary.booked) {
      b.booked++;
      bookTurns.push(summary.turnCount);
    }
    b.avgTurns += summary.turnCount;
  }
  for (const persona of PERSONAS) {
    byPersona[persona.id].avgTurns = round(byPersona[persona.id].avgTurns / SEEDS.length, 2);
  }

  const bookable = runs.filter((r) => PERSONAS.find((p) => p.id === r.personaId)?.bookable);

  return {
    provenance: provenance(),
    disclosureMode,
    runs,
    totals: {
      runs: runs.length,
      goalCompletion: round(mean(bookable.map((r) => (r.pass ? 1 : 0)))),
      bookingCompletion: round(mean(bookable.map((r) => (r.booked ? 1 : 0)))),
      medianTurnsToBook: bookTurns.length ? round(p50(bookTurns), 2) : null,
      guardrailViolations: runs.reduce((a, r) => a + r.guardrailViolations, 0),
      inventedSlots: runs.reduce((a, r) => a + r.inventedSlots, 0),
      unsupportedClaims: runs.reduce((a, r) => a + r.unsupportedClaims, 0),
      lies: runs.filter((r) => r.lied).length,
      lectures: runs.filter((r) => r.lectured).length,
    },
    byPersona,
  };
}

// ----------------------------------------------------------------- disclosure

export interface DisclosureResults {
  provenance: Provenance;
  modes: {
    mode: DisclosureMode;
    bookingCompletion: number;
    goalCompletion: number;
    medianTurnsToBook: number | null;
    tellRate: number;
    dropOff: string;
    guardrailViolations: number;
  }[];
  /** Booking completion delta against the minimal baseline. */
  deltaVsMinimal: Record<string, number>;
}

/**
 * The headline artifact. Identical seeds across all three modes, so the only
 * thing that varies is the disclosure setting. Reported neutrally, whichever way
 * the number falls.
 */
export async function runDisclosureComparison(): Promise<DisclosureResults> {
  const modes: DisclosureResults['modes'] = [];
  for (const mode of DISCLOSURE_MODES) {
    const conv = await runConversationEval(mode);
    const allTurns = conv.runs.length;
    const flagged = conv.runs.reduce((a, r) => a + (r.styleViolations > 0 ? 1 : 0), 0);
    modes.push({
      mode,
      bookingCompletion: conv.totals.bookingCompletion,
      goalCompletion: conv.totals.goalCompletion,
      medianTurnsToBook: conv.totals.medianTurnsToBook,
      tellRate: round(flagged / Math.max(1, allTurns)),
      dropOff: describeDropOff(conv),
      guardrailViolations: conv.totals.guardrailViolations,
    });
    write(`conversations-${mode}`, conv);
  }

  const baseline = modes.find((m) => m.mode === 'minimal')!.bookingCompletion;
  return {
    provenance: provenance(),
    modes,
    deltaVsMinimal: Object.fromEntries(
      modes.map((m) => [m.mode, round(m.bookingCompletion - baseline)]),
    ),
  };
}

function describeDropOff(conv: ConversationResults): string {
  const unbooked = conv.runs.filter(
    (r) => PERSONAS.find((p) => p.id === r.personaId)?.bookable && !r.booked,
  );
  if (!unbooked.length) return 'no drop-off on bookable personas';
  const counts = new Map<string, number>();
  for (const r of unbooked) counts.set(r.personaId, (counts.get(r.personaId) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, n]) => `${id} (${n})`)
    .join(', ');
}

// ------------------------------------------------------------------ providers

export interface ProviderResults {
  provenance: Provenance;
  rows: {
    provider: ProviderId;
    model: string;
    available: boolean;
    goalCompletion: number | null;
    bookingCompletion: number | null;
    styleViolationRate: number | null;
    guardrailViolations: number | null;
    inventedSlots: number | null;
    note: string;
  }[];
}

/**
 * For a buyer who already runs an agent on some model, the transferability
 * question is the first one asked. Running the same suite against both providers
 * closes it.
 */
export async function runProviderComparison(): Promise<ProviderResults> {
  const rows: ProviderResults['rows'] = [];
  for (const provider of ['anthropic', 'openai'] as ProviderId[]) {
    const key = provider === 'anthropic' ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY;
    if (!key) {
      rows.push({
        provider,
        model: describeRouting().agent.model,
        available: false,
        goalCompletion: null,
        bookingCompletion: null,
        styleViolationRate: null,
        guardrailViolations: null,
        inventedSlots: null,
        note: `no ${provider.toUpperCase()}_API_KEY set, not run`,
      });
      continue;
    }
    const conv = await runConversationEval('info_card', provider);
    const turns = conv.runs.length;
    rows.push({
      provider,
      model: conv.runs.length ? describeRouting().agent.model : '',
      available: true,
      goalCompletion: conv.totals.goalCompletion,
      bookingCompletion: conv.totals.bookingCompletion,
      styleViolationRate: round(
        conv.runs.reduce((a, r) => a + r.styleViolations, 0) / Math.max(1, turns),
      ),
      guardrailViolations: conv.totals.guardrailViolations,
      inventedSlots: conv.totals.inventedSlots,
      note: '',
    });
  }
  return { provenance: provenance(), rows };
}

// -------------------------------------------------------------------- latency

export interface LatencyResults {
  provenance: Provenance;
  samples: number;
  ttft: { p50: number; p95: number };
  endToEndGeneration: { p50: number; p95: number };
  deliveredDelay: { p50: number; p95: number; histogram: { label: string; count: number }[] };
  note: string;
}

export async function runLatencyEval(): Promise<LatencyResults> {
  const ttft: number[] = [];
  const total: number[] = [];
  const delivered: number[] = [];

  const latencyJobs = PERSONAS.flatMap((persona) =>
    SEEDS.slice(0, 2).map((seed) => ({ persona, seed })),
  );
  const summaries = await mapLimit(latencyJobs, evalConcurrency(), ({ persona, seed }) =>
    runConversation({ persona, seed, disclosureMode: 'info_card' }),
  );
  for (const summary of summaries) {
    for (const t of summary.turns) {
      if (t.trace.ttftMs !== null) ttft.push(t.trace.ttftMs);
      total.push(t.trace.totalMs);
      if (t.trace.deliveredDelayMs > 0) delivered.push(t.trace.deliveredDelayMs);
    }
  }

  return {
    provenance: provenance(),
    samples: total.length,
    ttft: { p50: round(p50(ttft), 1), p95: round(p95(ttft), 1) },
    endToEndGeneration: { p50: round(p50(total), 1), p95: round(p95(total), 1) },
    deliveredDelay: {
      p50: round(p50(delivered), 1),
      p95: round(p95(delivered), 1),
      histogram: histogram(delivered, [500, 1000, 1500, 2000, 3000, 4000, 6000]),
    },
    note: 'Delivered delay is deliberately slower than raw generation. The typing delay in lib/agent/humanize.ts is 600ms + 40ms per character with 20% jitter, per bubble. An instant reply reads as a bot regardless of wording, so this latency is a design decision rather than a performance problem.',
  };
}

// ----------------------------------------------------------------------- main

async function main() {
  const cmd = process.argv[2] ?? 'all';
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const prov = provenance();
  console.log(`concurrency: ${evalConcurrency()} (set EVAL_CONCURRENCY to change)`);
  console.log(
    `routing: ${Object.entries(prov.routing)
      .map(([r, v]) => `${r}=${v.provider}`)
      .join(' ')}  retrieval=${prov.retrieval.backend}`,
  );
  if (prov.caveat) console.log(`\n! ${prov.caveat}\n`);

  const ran: string[] = [];

  if (cmd === 'rag' || cmd === 'all') {
    console.log('rag: golden set');
    write('rag', { provenance: prov, ...(await runRagEval()) });
    ran.push('rag');
  }
  if (cmd === 'conversations' || cmd === 'all') {
    console.log('conversations: 10 personas x 5 seeds');
    write('conversations', await runConversationEval('info_card'));
    ran.push('conversations');
  }
  if (cmd === 'tell' || cmd === 'all') {
    console.log('tell-rate: 120 turns, deterministic + judge');
    write('tell', await runTellEval());
    ran.push('tell');
  }
  if (cmd === 'disclosure' || cmd === 'all') {
    console.log('disclosure: 3 modes x 10 personas x 5 seeds, identical seeds');
    write('disclosure', await runDisclosureComparison());
    ran.push('disclosure');
  }
  if (cmd === 'providers' || cmd === 'all') {
    console.log('providers: agent role on both providers');
    write('providers', await runProviderComparison());
    ran.push('providers');
  }
  if (cmd === 'latency' || cmd === 'all') {
    console.log('latency');
    write('latency', await runLatencyEval());
    ran.push('latency');
  }
  if (cmd === 'clock' || cmd === 'all') {
    console.log('clock-rate: blind study');
    write('clock', runClockRateStudy());
    ran.push('clock');
  }

  const latest = {
    provenance: prov,
    ran,
    rag: read('rag'),
    tell: read('tell'),
    conversations: read('conversations'),
    disclosure: read('disclosure'),
    providers: read('providers'),
    latency: read('latency'),
    clock: read('clock'),
  };
  write('latest', latest);
  console.log('\ndone');
}

if (process.argv[1]?.includes('runner')) {
  main().catch((e) => {
    if (e instanceof QuotaExhaustedError || e?.name === 'QuotaExhaustedError') {
      console.error(`\n${e.message}\n`);
      console.error('  Stages that completed before the limit have been written to evals/results/.');
      process.exit(2);
    }
    console.error(e);
    process.exit(1);
  });
}
