/**
 * Build the blind clock-rate excerpt set: 20 excerpts from real agent runs and
 * 20 written as human receptionist exchanges, shuffled into one fixed order with
 * the source recorded but never shown to labellers.
 */
import fs from 'node:fs';
import path from 'node:path';
import { mulberry32, seedFrom } from '../lib/util/rand';
import { runConversation, SEEDS } from '../evals/harness/conversation';
import { PERSONAS } from '../evals/personas';
import { HUMAN_EXCERPTS } from '../evals/datasets/human-excerpts';
import type { ClockExcerpt } from '../evals/clock-rate';

const OUT = path.join(process.cwd(), 'evals', 'datasets', 'clock-excerpts.jsonl');

async function main() {
  const agentExcerpts: ClockExcerpt[] = [];

  // Draw from the personas a real visitor could plausibly be, so the control and
  // treatment arms are comparable. An excerpt of the agent refusing crude
  // content is trivially identifiable and would flatter the number.
  const usable = PERSONAS.filter((p) => !['hostile', 'boundary_tester'].includes(p.id));

  outer: for (const persona of usable) {
    for (const seed of SEEDS) {
      const run = await runConversation({ persona, seed, disclosureMode: 'info_card' });
      const withAgent = run.turns.filter((t) => t.agent.trim());
      if (withAgent.length < 2) continue;
      const start = Math.max(0, Math.min(1, withAgent.length - 2));
      const window = withAgent.slice(start, start + 2);
      const lines = window.flatMap((t) => [
        { who: 'visitor' as const, text: t.user },
        { who: 'desk' as const, text: t.agent },
      ]);
      agentExcerpts.push({ id: `a${String(agentExcerpts.length + 1).padStart(2, '0')}`, source: 'agent', lines });
      if (agentExcerpts.length >= 20) break outer;
    }
  }

  const humans: ClockExcerpt[] = HUMAN_EXCERPTS.map((h) => ({ ...h, source: 'human' as const }));
  const all = [...agentExcerpts, ...humans];

  // Fixed shuffle: the presentation order is stable across runs so two labellers
  // see the same sequence, but carries no information about the source.
  const rng = mulberry32(seedFrom('clock-order-v1'));
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }

  fs.writeFileSync(OUT, all.map((e) => JSON.stringify(e)).join('\n') + '\n');
  console.log(`wrote ${all.length} excerpts (${agentExcerpts.length} agent, ${humans.length} human)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
