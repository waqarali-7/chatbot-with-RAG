import './load-env';
import fs from 'node:fs';
import path from 'node:path';
import { claimsBooked } from '../lib/agent/guardrails';

/**
 * Measure the false-confirmation check against recorded real-model transcripts
 * rather than against invented examples.
 *
 * Turns from runs that did book are the negative control: the same wording is
 * legitimate there, so anything flagged on a booked run is a false positive
 * only if the booking had not yet happened at that point in the conversation.
 */
const RESULTS = path.join(process.cwd(), 'evals', 'results');
const files = fs
  .readdirSync(RESULTS)
  .filter((f) => f.startsWith('conversations') && f.endsWith('.json'));

let flaggedUnbooked = 0;
let unbookedTurns = 0;
let flaggedOnOffers = 0;
let offerTurns = 0;
const examples: string[] = [];
const missed: string[] = [];

for (const f of files) {
  const d = JSON.parse(fs.readFileSync(path.join(RESULTS, f), 'utf8')) as {
    provenance?: { routing?: { agent?: { provider?: string } } };
    runs?: { booked: boolean; personaId: string; transcript?: { user: string; agent: string }[] }[];
  };
  if (d.provenance?.routing?.agent?.provider !== 'anthropic') continue;
  for (const r of d.runs ?? []) {
    for (const t of r.transcript ?? []) {
      if (!t.agent.trim()) continue;
      if (t.agent.trim().endsWith('?')) {
        offerTurns++;
        if (claimsBooked(t.agent)) {
          flaggedOnOffers++;
          missed.push(`${r.personaId}: ${t.agent.slice(0, 80)}`);
        }
        continue;
      }
      if (r.booked) continue;
      unbookedTurns++;
      if (claimsBooked(t.agent)) {
        flaggedUnbooked++;
        if (examples.length < 8) examples.push(`${r.personaId}: ${t.agent.slice(0, 78)}`);
      }
    }
  }
}

console.log(`recorded real-model transcripts: ${files.length} files`);
console.log(`\nturns on runs that never booked: ${unbookedTurns}`);
console.log(`  flagged as a false confirmation: ${flaggedUnbooked}`);
for (const e of examples) console.log(`    ${e}`);
console.log(`\nquestion turns (offers, should never flag): ${offerTurns}`);
console.log(`  wrongly flagged: ${flaggedOnOffers}`);
for (const m of missed.slice(0, 5)) console.log(`    ${m}`);
