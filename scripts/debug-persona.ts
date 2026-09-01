import './load-env';
import { runConversation, SEEDS } from '../evals/harness/conversation';
import { PERSONAS } from '../evals/personas';

async function main() {
  const id = process.argv[2] ?? 'eager';
  const persona = PERSONAS.find((p) => p.id === id)!;
  const run = await runConversation({ persona, seed: SEEDS[0], disclosureMode: 'info_card' });
  for (const t of run.turns) {
    console.log(`visitor  ${t.user}`);
    console.log(`nadia    ${t.agent}`);
    console.log(
      `         [action=${t.trace.action.kind} offered=${t.trace.offeredSlotIds.join(',') || '-'} out=${t.trace.outputVerdict.labels.join(',') || 'ok'} regen=${t.trace.regenerations}]`,
    );
  }
  console.log(
    `\nbooked=${run.booked} turns=${run.turnCount} name=${run.state.name} reason=${run.state.reason} offeredIds=${run.state.offeredSlotIds.length} held=${run.state.heldSlotId}`,
  );
  console.log(persona.successCondition(run));
}
main();
