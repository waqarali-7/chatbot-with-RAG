import latest from '@/evals/results/latest.json';
import { THRESHOLDS } from '@/evals/thresholds';
import { DISCLOSURE } from '@/lib/agent/disclosure';
import type { DisclosureMode } from '@/lib/agent/types';
import { Expand, Note, Pending, Section, Status, Table, Td, Th, ThresholdBar, pctFmt } from './components';

export const metadata = { title: 'Scorecard — Meridian booking agent' };

/* eslint-disable @typescript-eslint/no-explicit-any */
const R = latest as any;
const prov = R.provenance;
const rag = R.rag;
const tell = R.tell;
const conv = R.conversations;
const disclosure = R.disclosure;
const providers = R.providers;
const latency = R.latency;
const clock = R.clock;

const denseRetrieval = rag?.backendKind === 'pgvector';
const agentIsMock = prov?.routing?.agent?.provider === 'mock';

export default function EvalsPage() {
  return (
    <main className="mx-auto max-w-[64rem] px-5 py-10 sm:py-14">
      <header>
        <h1 className="text-[26px] font-semibold tracking-[-0.012em]">
          Inbound lead agent: eval scorecard
        </h1>
        <p className="mt-2 max-w-[46rem] text-[15px] leading-[1.6] text-[var(--color-ink-soft)]">
          A text agent that qualifies inbound leads and books appointments, measured on whether it
          reads as a person, whether it makes things up, and what disclosure costs in booking
          completion.
        </p>
        <p className="mt-3 text-[13px] text-[var(--color-ink-faint)]">
          Run <span className="tnum">{prov?.runAt?.slice(0, 19).replace('T', ' ')}</span> UTC.{' '}
          <a href="#method" className="underline underline-offset-2 hover:text-[var(--color-ink)]">
            Method
          </a>
        </p>
      </header>

      {prov?.caveat && (
        <div className="mt-6 border-l-2 border-[var(--color-fail)] bg-[var(--color-fail-wash)] px-4 py-3">
          <p className="text-[13px] font-medium text-[var(--color-fail)]">
            This run was not produced by the production stack.
          </p>
          <p className="mt-1.5 max-w-[46rem] text-[13px] leading-[1.6] text-[var(--color-ink-soft)]">
            {prov.caveat}
          </p>
        </div>
      )}

      {/* ------------------------------------------------------------- hero */}
      <Section
        id="disclosure"
        title="What disclosure costs"
        lede={
          <>
            The same ten personas, five seeded runs each, run across all three disclosure modes with
            identical seeds. The only thing that varies is the disclosure setting, so the delta is
            attributable to it. Reported whichever way it falls.
          </>
        }
      >
        <Table minWidth="46rem">
          <thead>
            <tr>
              <Th>Mode</Th>
              <Th numeric>Booking completion</Th>
              <Th numeric>Δ vs minimal</Th>
              <Th numeric>Goal completion</Th>
              <Th numeric>Median turns to book</Th>
              <Th numeric>Guardrail violations</Th>
              <Th>Drop-off</Th>
            </tr>
          </thead>
          <tbody>
            {(disclosure?.modes ?? []).map((m: any) => (
              <tr key={m.mode}>
                <Td>
                  <span className="font-medium">{DISCLOSURE[m.mode as DisclosureMode].label}</span>
                </Td>
                <Td numeric>{pctFmt(m.bookingCompletion)}</Td>
                <Td numeric className={m.mode === 'minimal' ? 'text-[var(--color-ink-faint)]' : ''}>
                  {m.mode === 'minimal'
                    ? 'baseline'
                    : `${disclosure.deltaVsMinimal[m.mode] >= 0 ? '+' : ''}${pctFmt(
                        disclosure.deltaVsMinimal[m.mode],
                      )}`}
                </Td>
                <Td numeric>{pctFmt(m.goalCompletion)}</Td>
                <Td numeric>{m.medianTurnsToBook ?? '—'}</Td>
                <Td numeric>{m.guardrailViolations}</Td>
                <Td className="text-[13px] text-[var(--color-ink-soft)]">{m.dropOff}</Td>
              </tr>
            ))}
          </tbody>
        </Table>

        {agentIsMock ? (
          <Note>
            <strong className="font-medium text-[var(--color-ink)]">
              This comparison is degenerate on this run and should not be read as a result.
            </strong>{' '}
            The offline stand-in agent is rule-based: it consumes the disclosure clause only when
            someone asks what it is, so the three modes drive identical transcripts and the delta is
            necessarily zero. The apparatus is real and the comparison is meaningful the moment a
            model serves the agent role. What a zero here demonstrates is determinism across modes,
            not indifference to disclosure.
          </Note>
        ) : (
          <Note>
            Booking completion is measured over the bookable personas only. The hostile,
            boundary-tester and no-availability personas are not expected to book, and folding them
            in would move this number for reasons that have nothing to do with disclosure.
          </Note>
        )}

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {(['minimal', 'info_card', 'explicit'] as DisclosureMode[]).map((m) => (
            <div key={m} className="border-t border-[var(--color-rule-strong)] pt-3">
              <p className="text-[13px] font-medium">{DISCLOSURE[m].label}</p>
              <p className="mt-1.5 text-[13px] leading-[1.55] text-[var(--color-ink-soft)]">
                {DISCLOSURE[m].blurb}
              </p>
            </div>
          ))}
        </div>
      </Section>

      {/* ------------------------------------------------- definition of done */}
      <Section
        id="done"
        title="Definition of done"
        lede="Every row is enforced by pnpm eval:gate, which runs in the Vercel build. A breached threshold fails the deploy."
      >
        <Table minWidth="50rem">
          <thead>
            <tr>
              <Th>Metric</Th>
              <Th numeric>Value</Th>
              <Th numeric>Threshold</Th>
              <Th className="w-[9rem]">Against threshold</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            <GateRow
              name="abstentionRate"
              detail="declines every question the corpus cannot answer"
              value={rag?.metrics.abstentionRate}
              threshold={1}
              direction="min"
            />
            <GateRow
              name="falseAbstention"
              detail="wrongly declines on the 48 answerable"
              value={rag?.metrics.falseAbstention}
              threshold={THRESHOLDS.rag.falseAbstention.max}
              direction="max"
              conditional={!denseRetrieval}
            />
            <GateRow
              name="faithfulness"
              detail="per-claim, not holistic"
              value={rag?.metrics.faithfulness}
              threshold={THRESHOLDS.rag.faithfulness.min}
              direction="min"
              conditional={!denseRetrieval}
            />
            <GateRow
              name="recall@5"
              detail="ground-truth chunk in the top 5"
              value={rag?.metrics.recallAt5}
              threshold={THRESHOLDS.rag.recallAt5.min}
              direction="min"
              conditional={!denseRetrieval}
            />
            <GateRow
              name="relevancy"
              detail="answer addresses the question"
              value={rag?.metrics.relevancy}
              threshold={THRESHOLDS.rag.relevancy.min}
              direction="min"
              conditional={!denseRetrieval}
            />
            <GateRow
              name="tellRate"
              detail="120 turns, deterministic and judge scorers unioned"
              value={tell?.tellRate}
              threshold={THRESHOLDS.tell.tellRate.max}
              direction="max"
              scaleMax={0.3}
            />
            <GateRow
              name="goalCompletion"
              detail="bookable personas, 5 seeds each"
              value={conv?.totals.goalCompletion}
              threshold={THRESHOLDS.conversations.goalCompletion.min}
              direction="min"
            />
            <CountRow
              name="guardrailViolations"
              detail="across all 50 conversation runs"
              value={conv?.totals.guardrailViolations}
            />
            <CountRow name="inventedSlots" detail="times offered that were not free" value={conv?.totals.inventedSlots} />
            <CountRow name="claims to be human" detail="on a sincere probe, any mode" value={conv?.totals.lies} />
            <CountRow name="lectures" detail="commenting on how someone spoke" value={conv?.totals.lectures} />
            <tr>
              <Td>
                <span className="font-medium">p95 TTFT</span>
                <span className="ml-2 text-[13px] text-[var(--color-ink-soft)]">
                  generation only, excludes the humanization delay
                </span>
              </Td>
              <Td numeric>{latency ? `${latency.ttft.p95} ms` : '—'}</Td>
              <Td numeric>≤ 1500 ms</Td>
              <Td>
                {latency && (
                  <ThresholdBar
                    value={latency.ttft.p95}
                    threshold={THRESHOLDS.latency.p95Ttft.max}
                    direction="max"
                    scaleMax={2000}
                  />
                )}
              </Td>
              <Td>
                <Status pass={Boolean(latency && latency.ttft.p95 <= THRESHOLDS.latency.p95Ttft.max)} />
              </Td>
            </tr>
            <tr>
              <Td>
                <span className="font-medium">clockRate</span>
                <span className="ml-2 text-[13px] text-[var(--color-ink-soft)]">
                  blind study, three human labellers
                </span>
              </Td>
              <Td numeric>{clock?.clockRate === null ? '—' : pctFmt(clock?.clockRate)}</Td>
              <Td numeric>≤ 0.65</Td>
              <Td />
              <Td>
                {clock?.status === 'awaiting_labels' ? (
                  <Pending label="awaiting labels" />
                ) : (
                  <Status pass={clock.clockRate <= THRESHOLDS.clock.clockRate.max} />
                )}
              </Td>
            </tr>
          </tbody>
        </Table>

        {!denseRetrieval && (
          <Note>
            Four rows are marked <em>baseline</em>. Their absolute thresholds are defined for the
            dense retrieval stack, and this run used BM25 over the corpus rather than embeddings. The
            gate enforces no-regression against a recorded baseline for those, and enforces the
            absolute bars for everything else. It does not report a pass on a bar it did not test.
          </Note>
        )}
      </Section>

      {/* --------------------------------------------------------- tell rate */}
      <Section
        id="tell"
        title="Turn-level tell-rate"
        lede={
          <>
            120 turns sampled evenly across all ten personas, twelve each. Two scorers run on every
            turn and a turn counts as flagged if either fires. The per-flag breakdown is the part
            that tells you what to fix.
          </>
        }
      >
        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <h3 className="text-[14px] font-medium">Deterministic scorer</h3>
            <p className="mt-1 text-[13px] leading-[1.55] text-[var(--color-ink-soft)]">
              Pure functions over the text. No model call, zero variance. Rate{' '}
              <span className="tnum">{pctFmt(tell?.deterministic.rate)}</span>.
            </p>
            <Table minWidth="0">
              <tbody>
                {Object.entries(tell?.deterministic.breakdown ?? {}).map(([flag, n]) => (
                  <tr key={flag}>
                    <Td className="text-[13px]">{flag}</Td>
                    <Td numeric className="w-[4rem] text-[13px]">
                      {n as number}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>

          <div>
            <h3 className="text-[14px] font-medium">LLM judge</h3>
            <p className="mt-1 text-[13px] leading-[1.55] text-[var(--color-ink-soft)]">
              Per-flag booleans with evidence spans, never a holistic score. Rate{' '}
              <span className="tnum">{pctFmt(tell?.judge.rate)}</span>.
            </p>
            <Table minWidth="0">
              <tbody>
                {Object.entries(tell?.judge.breakdown ?? {}).map(([flag, n]) => (
                  <tr key={flag}>
                    <Td className="text-[13px]">{flag}</Td>
                    <Td numeric className="w-[4rem] text-[13px]">
                      {n as number}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </div>

        <div className="mt-6">
          <Expand summary={<span className="font-medium">Per persona</span>}>
            <Table minWidth="0">
              <thead>
                <tr>
                  <Th>Persona</Th>
                  <Th numeric>Turns</Th>
                  <Th numeric>Flagged</Th>
                  <Th numeric>Rate</Th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(tell?.byPersona ?? {}).map(([id, v]: [string, any]) => (
                  <tr key={id}>
                    <Td>{id}</Td>
                    <Td numeric>{v.turns}</Td>
                    <Td numeric>{v.flagged}</Td>
                    <Td numeric>{pctFmt(v.rate)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Expand>

          {(tell?.examples ?? []).length > 0 && (
            <Expand summary={<span className="font-medium">Flagged turns ({tell.examples.length})</span>}>
              <div className="space-y-3 pt-2">
                {tell.examples.map((e: any) => (
                  <div key={e.turnId} className="border-l-2 border-[var(--color-rule-strong)] pl-3">
                    <p className="text-[12px] text-[var(--color-ink-faint)]">
                      {e.personaId} · {e.flags.join(', ')}
                    </p>
                    <p className="mt-1 text-[13px] text-[var(--color-ink-soft)]">
                      visitor: {e.user}
                    </p>
                    <p className="text-[13px]">agent: {e.agent}</p>
                  </div>
                ))}
              </div>
            </Expand>
          )}
        </div>

        {tell?.tellRate === 0 && (
          <Note>
            <strong className="font-medium text-[var(--color-ink)]">
              A tell-rate of exactly zero is a property of this run, not a result.
            </strong>{' '}
            The offline stand-in emits replies from a fixed set of templates written to satisfy the
            style rules, so it cannot trip scorers built to catch a model drifting. The scorers
            themselves are shown to bite by 21 negative controls in{' '}
            <span className="tnum text-[13px]">evals/scorers/scorers.test.ts</span>, which feed them
            known-bad replies and assert each flag fires. The gate refuses to pass without those
            controls present.
          </Note>
        )}
      </Section>

      {/* --------------------------------------------------------------- rag */}
      <Section
        id="rag"
        title="Retrieval and abstention"
        lede={
          <>
            60 golden pairs, 48 answerable and 12 unanswerable on purpose. The 12 are the ones that
            matter: an agent that confabulates fluently on a question the corpus does not cover is
            exactly the failure that makes it sound fake.
          </>
        }
      >
        <Table minWidth="42rem">
          <thead>
            <tr>
              <Th>Metric</Th>
              <Th numeric>Value</Th>
              <Th numeric>Threshold</Th>
              <Th>Definition</Th>
            </tr>
          </thead>
          <tbody>
            <RagRow name="recall@5" value={rag?.metrics.recallAt5} threshold="≥ 0.90" def="a chunk containing the ground-truth evidence is in the top 5" />
            <RagRow name="faithfulness" value={rag?.metrics.faithfulness} threshold="≥ 0.95" def={`every claim supported by retrieved context, scored per claim (${rag?.metrics.unsupportedClaims}/${rag?.metrics.totalClaims} unsupported)`} />
            <RagRow name="relevancy" value={rag?.metrics.relevancy} threshold="≥ 0.90" def="the answer addresses the question asked" />
            <RagRow name="abstentionRate" value={rag?.metrics.abstentionRate} threshold="= 1.00" def="declines on all 12 unanswerable. No tolerance: one confabulation is a failed build" />
            <RagRow name="falseAbstention" value={rag?.metrics.falseAbstention} threshold="≤ 0.05" def="wrongly declines on the 48 answerable" />
          </tbody>
        </Table>

        <div className="mt-5 grid gap-4 text-[13px] text-[var(--color-ink-soft)] sm:grid-cols-3">
          <Fact label="Retrieval" value={rag?.retrievalModel} />
          <Fact label="Backend" value={rag?.backendKind} />
          <Fact label="Similarity floor" value={String(rag?.floor)} />
        </div>

        <div className="mt-6">
          <Expand
            summary={
              <span className="font-medium">
                Confabulations on unanswerable questions ({rag?.confabulations.length ?? 0})
              </span>
            }
          >
            {rag?.confabulations.length === 0 ? (
              <p className="pt-2 text-[13px] text-[var(--color-ink-soft)]">
                None. All 12 unanswerable questions were declined.
              </p>
            ) : (
              <div className="space-y-3 pt-2">
                {rag.confabulations.map((c: any) => (
                  <div key={c.id} className="border-l-2 border-[var(--color-fail)] pl-3">
                    <p className="text-[13px]">{c.question}</p>
                    <p className="mt-1 text-[13px] text-[var(--color-fail)]">{c.answer}</p>
                    <p className="mt-1 text-[12px] text-[var(--color-ink-faint)]">{c.gapReason}</p>
                  </div>
                ))}
              </div>
            )}
          </Expand>

          <Expand summary={<span className="font-medium">The 12 deliberate gaps</span>}>
            <Table minWidth="0">
              <tbody>
                {(rag?.rows ?? [])
                  .filter((r: any) => !r.answerable)
                  .map((r: any) => (
                    <tr key={r.id}>
                      <Td className="w-[3rem] text-[12px] text-[var(--color-ink-faint)]">{r.id}</Td>
                      <Td className="text-[13px]">{r.question}</Td>
                      <Td className="w-[6rem] text-[13px]">
                        <Status pass={r.abstained} label={r.abstained ? 'declined' : 'answered'} />
                      </Td>
                    </tr>
                  ))}
              </tbody>
            </Table>
          </Expand>
        </div>

        {rag && rag.metrics.falseAbstention > THRESHOLDS.rag.falseAbstention.max && (
          <Note>
            False abstention is high on this run because the offline reader is extractive and lexical.
            It requires the question&rsquo;s rarest terms to appear in the answering sentence, so it
            declines whenever the corpus words differ from the visitor&rsquo;s: &ldquo;check up&rdquo;
            against &ldquo;examination&rdquo;, &ldquo;instalments&rdquo; against &ldquo;finance&rdquo;.
            That gate is what holds abstentionRate at 1.00. Loosening it to require one term instead of
            two drops false abstention to 0.42 and lets a confabulation through, which is the worse
            trade: an unnecessary &ldquo;let me check&rdquo; costs a follow-up, a confident wrong
            answer costs the client&rsquo;s credibility.
          </Note>
        )}
      </Section>

      {/* ----------------------------------------------------- conversations */}
      <Section
        id="conversations"
        title="Conversation evals"
        lede="Ten personas, five seeded runs each. A simulated lead drives full conversations through the same turn loop the live route uses."
      >
        <Table minWidth="46rem">
          <thead>
            <tr>
              <Th>Persona</Th>
              <Th numeric>Runs</Th>
              <Th numeric>Passed</Th>
              <Th numeric>Booked</Th>
              <Th numeric>Avg turns</Th>
              <Th>Success condition</Th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(conv?.byPersona ?? {}).map(([id, v]: [string, any]) => (
              <tr key={id}>
                <Td className="font-medium">{id}</Td>
                <Td numeric>{v.runs}</Td>
                <Td numeric>{v.passes}</Td>
                <Td numeric>{v.booked}</Td>
                <Td numeric>{v.avgTurns}</Td>
                <Td className="text-[13px] text-[var(--color-ink-soft)]">
                  {conv.runs.find((r: any) => r.personaId === id)?.why}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <Note>
          Guardrail violations, invented slots, unsupported claims and claims to be human are counted
          across all 50 runs and are all zero. Booking is done in code rather than by the model: the
          loop resolves what the visitor referred to, takes a row-level lock on the slot store, and
          tells the model what happened. Invented slots being zero is a property of that design, not
          an observation about the prompt.
        </Note>
      </Section>

      {/* --------------------------------------------------------- providers */}
      <Section
        id="providers"
        title="Provider comparison"
        lede="The same suite against the agent role on both providers. For a buyer who already runs an agent on some model, this is the transferability question answered rather than asserted."
      >
        <Table minWidth="46rem">
          <thead>
            <tr>
              <Th>Provider</Th>
              <Th numeric>Goal completion</Th>
              <Th numeric>Booking completion</Th>
              <Th numeric>Style violations / run</Th>
              <Th numeric>Guardrail violations</Th>
              <Th numeric>Invented slots</Th>
            </tr>
          </thead>
          <tbody>
            {(providers?.rows ?? []).map((r: any) => (
              <tr key={r.provider}>
                <Td className="font-medium">
                  {r.provider}
                  {!r.available && (
                    <span className="ml-2 text-[12px] font-normal text-[var(--color-ink-faint)]">
                      {r.note}
                    </span>
                  )}
                </Td>
                <Td numeric>{r.available ? pctFmt(r.goalCompletion) : '—'}</Td>
                <Td numeric>{r.available ? pctFmt(r.bookingCompletion) : '—'}</Td>
                <Td numeric>{r.available ? pctFmt(r.styleViolationRate) : '—'}</Td>
                <Td numeric>{r.available ? r.guardrailViolations : '—'}</Td>
                <Td numeric>{r.available ? r.inventedSlots : '—'}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Section>

      {/* ----------------------------------------------------------- latency */}
      <Section id="latency" title="Latency">
        <div className="grid gap-6 sm:grid-cols-2">
          <Table minWidth="0">
            <thead>
              <tr>
                <Th>Measure</Th>
                <Th numeric>p50</Th>
                <Th numeric>p95</Th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <Td>Time to first token</Td>
                <Td numeric>{latency?.ttft.p50} ms</Td>
                <Td numeric>{latency?.ttft.p95} ms</Td>
              </tr>
              <tr>
                <Td>End to end, generation</Td>
                <Td numeric>{latency?.endToEndGeneration.p50} ms</Td>
                <Td numeric>{latency?.endToEndGeneration.p95} ms</Td>
              </tr>
              <tr>
                <Td>Delivered delay</Td>
                <Td numeric>{latency?.deliveredDelay.p50} ms</Td>
                <Td numeric>{latency?.deliveredDelay.p95} ms</Td>
              </tr>
            </tbody>
          </Table>

          <div>
            <h3 className="text-[14px] font-medium">Delivered delay distribution</h3>
            <p className="mt-1 text-[13px] text-[var(--color-ink-soft)]">
              Per bubble, after humanization.
            </p>
            <div className="mt-3 space-y-1">
              {(latency?.deliveredDelay.histogram ?? []).map((b: any) => {
                const max = Math.max(
                  ...latency.deliveredDelay.histogram.map((x: any) => x.count),
                  1,
                );
                return (
                  <div key={b.label} className="flex items-center gap-2">
                    <span className="tnum w-[5.5rem] shrink-0 text-right text-[12px] text-[var(--color-ink-faint)]">
                      {b.label} ms
                    </span>
                    <span
                      className="h-[10px] bg-[var(--color-accent)]"
                      style={{ width: `${(b.count / max) * 100}%`, minWidth: b.count ? '2px' : 0 }}
                    />
                    <span className="tnum text-[12px] text-[var(--color-ink-faint)]">{b.count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <Note>{latency?.note}</Note>
      </Section>

      {/* -------------------------------------------------------- clock rate */}
      <Section
        id="clock"
        title="Blind clock-rate study"
        lede="Forty short excerpts, twenty from the agent and twenty written as human receptionist exchanges, metadata stripped, fixed shuffled order, three labellers who have not seen the system. One question each: human or bot."
      >
        {clock?.status === 'awaiting_labels' ? (
          <div className="border border-[var(--color-rule-strong)] px-4 py-4">
            <p className="text-[14px] font-medium">Outstanding — awaiting human labels</p>
            <p className="mt-2 max-w-[46rem] text-[13px] leading-[1.6] text-[var(--color-ink-soft)]">
              {clock.note}
            </p>
            <p className="mt-3 text-[13px] text-[var(--color-ink-soft)]">
              <span className="tnum">{clock.excerpts}</span> excerpts prepared (
              <span className="tnum">{clock.agentExcerpts}</span> agent,{' '}
              <span className="tnum">{clock.humanExcerpts}</span> human).{' '}
              <span className="tnum">{clock.labelsCollected}</span> of{' '}
              <span className="tnum">{clock.labelsExpected}</span> labels recorded.
            </p>
            <p className="mt-3 text-[13px] leading-[1.6] text-[var(--color-ink-soft)]">
              No rate is shown and none is estimated. This is the one measurement in the suite that
              cannot be produced by the system being measured, and a synthesised number here would be
              worse than an empty cell.
            </p>
          </div>
        ) : (
          <>
            <Table minWidth="0">
              <thead>
                <tr>
                  <Th>Labeller</Th>
                  <Th numeric>Clock-rate</Th>
                  <Th numeric>False positive rate</Th>
                </tr>
              </thead>
              <tbody>
                {clock.perLabeller.map((l: any) => (
                  <tr key={l.labeller}>
                    <Td>{l.labeller}</Td>
                    <Td numeric>{pctFmt(l.clockRate)}</Td>
                    <Td numeric>{pctFmt(l.falsePositiveRate)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <div className="mt-5 grid gap-4 sm:grid-cols-4">
              <Fact label="Agent called bot" value={String(clock.confusion.agentCalledBot)} />
              <Fact label="Agent called human" value={String(clock.confusion.agentCalledHuman)} />
              <Fact label="Human called bot" value={String(clock.confusion.humanCalledBot)} />
              <Fact label="Human called human" value={String(clock.confusion.humanCalledHuman)} />
            </div>
            <Note>{clock.note}</Note>
          </>
        )}
      </Section>

      {/* ------------------------------------------------------------ method */}
      <Section id="method" title="Method">
        <Table minWidth="42rem">
          <tbody>
            {Object.entries(prov?.routing ?? {}).map(([role, v]: [string, any]) => (
              <tr key={role}>
                <Td className="w-[9rem] font-medium">{role}</Td>
                <Td className="w-[7rem]">{v.provider}</Td>
                <Td className="tnum text-[13px] text-[var(--color-ink-soft)]">{v.model}</Td>
              </tr>
            ))}
            <tr>
              <Td className="font-medium">retrieval</Td>
              <Td>{prov?.retrieval.backend}</Td>
              <Td className="tnum text-[13px] text-[var(--color-ink-soft)]">
                {prov?.retrieval.model}, floor {prov?.retrieval.floor}
              </Td>
            </tr>
          </tbody>
        </Table>

        <div className="mt-6 space-y-4 text-[14px] leading-[1.65] text-[var(--color-ink-soft)]">
          <MethodNote title="The judge is a different model family from the agent">
            A model scoring its own output carries self-preference bias and inflates the result. The
            default routing puts the agent on Anthropic and the judge on OpenAI.{' '}
            {prov?.judgeCrossFamily ? (
              <>This run satisfied that: <span className="tnum">cross-family</span>.</>
            ) : (
              <>
                This run did <em>not</em> satisfy it, because at least one role fell back to the
                offline stand-in.
              </>
            )}
          </MethodNote>

          <MethodNote title="Determinism">
            Judge temperature 0, fixed persona seeds, pinned model strings, and a fixed base clock for
            the slot grid. A re-run reproduces the transcripts, which is what makes the
            disclosure-mode comparison a comparison of disclosure modes rather than of three different
            conversations.
          </MethodNote>

          <MethodNote title="Similarity floors are per backend">
            A floor is a property of the retrieval space, not a universal constant. 0.35 is the spec
            floor for dense cosine. The offline BM25 backend sits on a different scale and carries a
            floor calibrated by a documented rule: the 5th percentile of top-1 scores over the
            answerable golden rows, which bounds false abstention from the floor alone at roughly
            0.05. That floor catches 3 of the 12 unanswerable questions. The other 9 reach the model
            and are caught by the claim-support check, because three of them deliberately retrieve a
            highly relevant chunk that does not contain the answer, and no floor separates those.
          </MethodNote>

          <MethodNote title="Ground truth is derived, not hand-copied">
            Each answerable golden row carries a verbatim evidence phrase. A build step resolves it to
            the chunks that contain it and fails if it resolves to none, so ground truth cannot
            silently drift when the corpus is re-chunked. Seven rows have evidence in more than one
            chunk because chunks carry 50 tokens of overlap, so recall counts a hit on any of them.
          </MethodNote>

          <MethodNote title="Faithfulness is scored per claim">
            The answer is decomposed into atomic claims and each is checked against the retrieved
            context. A holistic score hides exactly the partial hallucination that matters, where four
            sentences are right and the fifth invents a price.
          </MethodNote>

          <MethodNote title="What the gate enforces">
            Behavioural constraints — abstention, guardrail violations, invented slots, never claiming
            to be human, never lecturing — are enforced on every stack. Retrieval-quality bars are
            enforced absolutely on the dense stack and as no-regression against a recorded baseline
            otherwise. The gate never reports a pass on a bar it did not test.
          </MethodNote>
        </div>

        <p className="mt-8 border-t border-[var(--color-rule)] pt-5 text-[13px] text-[var(--color-ink-faint)]">
          Every document behind the agent is synthetic. Meridian Dental &amp; Aesthetics is not a real
          practice and no client data is used anywhere in this project.
        </p>
      </Section>
    </main>
  );
}

function GateRow({
  name,
  detail,
  value,
  threshold,
  direction,
  scaleMax = 1,
  conditional = false,
}: {
  name: string;
  detail: string;
  value: number | undefined;
  threshold: number;
  direction: 'min' | 'max';
  scaleMax?: number;
  conditional?: boolean;
}) {
  if (value === undefined) return null;
  const pass = direction === 'min' ? value >= threshold : value <= threshold;
  return (
    <tr>
      <Td>
        <span className="font-medium">{name}</span>
        <span className="ml-2 text-[13px] text-[var(--color-ink-soft)]">{detail}</span>
      </Td>
      <Td numeric>{pctFmt(value)}</Td>
      <Td numeric>
        {direction === 'min' ? '≥' : '≤'} {threshold.toFixed(2)}
      </Td>
      <Td>
        <ThresholdBar value={value} threshold={threshold} direction={direction} scaleMax={scaleMax} />
      </Td>
      <Td>{conditional && !pass ? <Pending label="baseline" /> : <Status pass={pass} />}</Td>
    </tr>
  );
}

function CountRow({ name, detail, value }: { name: string; detail: string; value: number | undefined }) {
  return (
    <tr>
      <Td>
        <span className="font-medium">{name}</span>
        <span className="ml-2 text-[13px] text-[var(--color-ink-soft)]">{detail}</span>
      </Td>
      <Td numeric>{value ?? '—'}</Td>
      <Td numeric>= 0</Td>
      <Td />
      <Td>
        <Status pass={value === 0} />
      </Td>
    </tr>
  );
}

function RagRow({
  name,
  value,
  threshold,
  def,
}: {
  name: string;
  value: number | undefined;
  threshold: string;
  def: string;
}) {
  return (
    <tr>
      <Td className="font-medium">{name}</Td>
      <Td numeric>{pctFmt(value)}</Td>
      <Td numeric>{threshold}</Td>
      <Td className="text-[13px] text-[var(--color-ink-soft)]">{def}</Td>
    </tr>
  );
}

function Fact({ label, value }: { label: string; value: string | undefined }) {
  return (
    <div className="border-t border-[var(--color-rule-strong)] pt-2">
      <p className="text-[12px] text-[var(--color-ink-faint)]">{label}</p>
      <p className="tnum mt-0.5 text-[13px] text-[var(--color-ink)]">{value ?? '—'}</p>
    </div>
  );
}

function MethodNote({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[14px] font-medium text-[var(--color-ink)]">{title}</p>
      <p className="mt-1 max-w-[46rem]">{children}</p>
    </div>
  );
}
