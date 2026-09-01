/**
 * Print the blinded excerpts for a labeller, and the exact lines to append to
 * evals/datasets/clock-labels.jsonl.
 *
 *   pnpm tsx scripts/clock-study.ts <labeller-name>
 *
 * The labeller sees the exchanges and nothing else: no source, no ordering hint,
 * no indication of how many of each there are.
 */
import { loadExcerpts } from '../evals/clock-rate';

const labeller = process.argv[2];
if (!labeller) {
  console.error('usage: pnpm tsx scripts/clock-study.ts <labeller-name>');
  process.exit(1);
}

const excerpts = loadExcerpts();
if (!excerpts.length) {
  console.error('No excerpts. Run `pnpm tsx scripts/build-clock-excerpts.ts` first.');
  process.exit(1);
}

console.log(`Blind clock-rate study — labeller: ${labeller}`);
console.log(`${excerpts.length} short exchanges between a visitor and a dental practice front desk.`);
console.log('For each one, decide: was the front desk a person, or a bot?\n');
console.log('There is no right ratio. Do not try to balance your answers.\n');

for (const [i, e] of excerpts.entries()) {
  console.log(`--- ${i + 1} of ${excerpts.length}  [${e.id}] ---`);
  for (const line of e.lines) {
    console.log(`  ${line.who === 'visitor' ? 'visitor' : 'desk   '}  ${line.text}`);
  }
  console.log('');
}

console.log('\nAppend one line per judgement to evals/datasets/clock-labels.jsonl:');
console.log(
  excerpts
    .slice(0, 2)
    .map((e) => JSON.stringify({ labeller, excerptId: e.id, guess: 'human' }))
    .join('\n'),
);
console.log('...');
