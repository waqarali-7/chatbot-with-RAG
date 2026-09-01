import './load-env';
import { providerFor } from '../lib/llm/registry';
import { mapLimit } from '../lib/util/concurrency';

async function main() {
  const p = providerFor('agent');
  const started = Date.now();
  const out = await mapLimit([1, 2, 3, 4, 5, 6], 6, async (n) => {
    const res = await p.complete({
      role: 'agent',
      system: 'Reply with exactly the given number and nothing else.',
      messages: [{ role: 'user', content: String(n) }],
      maxTokens: 8,
      temperature: 0,
    });
    return res.text.trim();
  });
  console.log(`6 concurrent calls in ${Date.now() - started}ms -> ${JSON.stringify(out)}`);
}
main().catch((e) => console.error('FAILED:', String(e).split('\n')[0]));
