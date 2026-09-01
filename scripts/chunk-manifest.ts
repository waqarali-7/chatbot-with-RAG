/** Prints the chunk manifest. Ground-truth chunk ids in the golden set refer to these. */
import index from '../content/index.generated.json';
import type { LocalIndex } from '../lib/rag/store';

const idx = index as unknown as LocalIndex;
for (const c of idx.chunks) {
  const body = c.content.split('\n\n').slice(1).join(' ').replace(/\s+/g, ' ');
  console.log(`${c.id.padEnd(24)} ${String(c.tokenCount).padStart(4)}t  ${c.headingPath}`);
  console.log(`  ${body.slice(0, 150)}...`);
}
console.log(`\n${idx.chunks.length} chunks`);
