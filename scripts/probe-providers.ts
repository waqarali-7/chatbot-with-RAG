import './load-env';
import { providerFor } from '../lib/llm/registry';
import { describeRouting } from '../lib/llm/registry';

async function main() {
  console.log('routing:', JSON.stringify(describeRouting(), null, 0), '\n');
  for (const role of ['agent', 'guardrail', 'judge'] as const) {
    const p = providerFor(role);
    const started = Date.now();
    try {
      const res = await p.complete({
        role,
        system: 'Reply with exactly the word: ok',
        messages: [{ role: 'user', content: 'say ok' }],
        maxTokens: 16,
        temperature: 0,
      });
      console.log(`  ok    ${role.padEnd(10)} ${p.provider}/${p.id} -> ${JSON.stringify(res.text.trim().slice(0, 30))} (${Date.now() - started}ms)`);
    } catch (e) {
      console.log(`  FAIL  ${role.padEnd(10)} ${p.provider}/${p.id}\n        ${String(e).split('\n')[0].slice(0, 220)}`);
    }
  }
}
main();
