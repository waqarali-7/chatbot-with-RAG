/**
 * Build evals/datasets/turns.jsonl: 120 agent turns sampled across all ten
 * personas, from real conversation runs at fixed seeds.
 *
 * The dataset is generated rather than hand-written so it scores the agent that
 * actually exists, and committed so the tell-rate is computed over a stable,
 * reviewable sample rather than whatever the last run happened to produce.
 */
import fs from 'node:fs';
import path from 'node:path';
import { mulberry32, seedFrom } from '../lib/util/rand';
import { runConversation, SEEDS } from '../evals/harness/conversation';
import { PERSONAS } from '../evals/personas';

const TARGET = 120;
const OUT = path.join(process.cwd(), 'evals', 'datasets', 'turns.jsonl');

const OFF_SCRIPT = /weather|coffee|football|holiday|joke|traffic|score/i;

async function main() {
  const pool: Record<string, unknown>[] = [];

  for (const persona of PERSONAS) {
    for (const seed of SEEDS) {
      const run = await runConversation({ persona, seed, disclosureMode: 'info_card' });
      run.turns.forEach((t, i) => {
        if (!t.agent.trim()) return;
        pool.push({
          turnId: `${persona.id}-${seed}-${i}`,
          personaId: persona.id,
          user: t.user,
          agent: t.agent,
          context: t.trace.retrievedChunkIds.join(','),
          retrievalEmpty: t.trace.retrievalEmpty,
          offScript: OFF_SCRIPT.test(t.user),
          action: t.trace.action.kind,
        });
      });
    }
  }

  // Stratify: take turns evenly across personas so one talkative persona does
  // not dominate the sample and quietly define the tell-rate.
  const byPersona = new Map<string, Record<string, unknown>[]>();
  for (const row of pool) {
    const id = row.personaId as string;
    if (!byPersona.has(id)) byPersona.set(id, []);
    byPersona.get(id)!.push(row);
  }
  const rng = mulberry32(seedFrom('turns-sample'));
  for (const list of byPersona.values()) {
    list.sort(() => rng() - 0.5);
  }

  const selected: Record<string, unknown>[] = [];
  let round = 0;
  while (selected.length < TARGET) {
    let added = false;
    for (const list of byPersona.values()) {
      if (list[round]) {
        selected.push(list[round]);
        added = true;
        if (selected.length >= TARGET) break;
      }
    }
    if (!added) break;
    round++;
  }

  fs.writeFileSync(OUT, selected.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const counts = new Map<string, number>();
  for (const r of selected) counts.set(r.personaId as string, (counts.get(r.personaId as string) ?? 0) + 1);
  console.log(`wrote ${selected.length} turns to turns.jsonl (pool was ${pool.length})`);
  console.log(
    `  per persona: ${[...counts.entries()].map(([k, v]) => `${k}=${v}`).join(' ')}`,
  );
  if (selected.length < TARGET) {
    console.warn(`  ! only ${selected.length} turns available, target is ${TARGET}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
