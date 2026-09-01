import { estimateTokens } from '@/lib/util/text';
import type { Chunk } from './types';

const TARGET_MIN = 300;
const TARGET_MAX = 500;
const OVERLAP_TOKENS = 50;

interface Section {
  headingPath: string;
  heading: string;
  depth: number;
  body: string;
  tokens: number;
}

/**
 * Semantic chunking by markdown heading, packed to a 300-500 token budget.
 *
 * Splitting on every heading alone yields 50-token fragments, which retrieve
 * badly: the surrounding sentences that disambiguate a fact end up in a
 * different chunk. So consecutive sections are packed together until the budget
 * is reached, and the heading path of the first section in the pack is kept as
 * metadata for traceable citation.
 */
export function chunkMarkdown(doc: string, markdown: string): Chunk[] {
  const sections = parseSections(doc, markdown);
  const chunks: Chunk[] = [];

  let pack: Section[] = [];
  let packTokens = 0;

  const flush = () => {
    if (!pack.length) return;
    const headingPath = pack[0].headingPath;
    const content = pack
      .map((s) => (s.heading ? `${'#'.repeat(s.depth)} ${s.heading}\n${s.body}` : s.body))
      .join('\n\n')
      .trim();
    chunks.push({
      id: `${doc}#${chunks.length}`,
      doc,
      headingPath,
      content: `${doc} > ${headingPath}\n\n${content}`,
      tokenCount: estimateTokens(content),
    });
    // Carry ~50 tokens of tail overlap so a fact that straddles a pack boundary
    // is retrievable from either side.
    const tail = pack[pack.length - 1];
    const tailWords = tail.body.split(/\s+/);
    if (tailWords.length > OVERLAP_TOKENS) {
      const overlap = tailWords.slice(-OVERLAP_TOKENS).join(' ');
      pack = [{ ...tail, heading: '', body: overlap, tokens: OVERLAP_TOKENS }];
      packTokens = OVERLAP_TOKENS;
    } else {
      pack = [];
      packTokens = 0;
    }
  };

  for (const section of sections) {
    // A single oversized section is split on paragraph boundaries first.
    for (const piece of splitOversized(section)) {
      if (packTokens + piece.tokens > TARGET_MAX && packTokens >= TARGET_MIN) flush();
      pack.push(piece);
      packTokens += piece.tokens;
      if (packTokens >= TARGET_MAX) flush();
    }
  }
  // Fold a small trailing remainder back into the previous chunk rather than
  // emitting an orphan.
  if (pack.length && packTokens < 80 && chunks.length) {
    const tail = pack
      .map((s) => (s.heading ? `${'#'.repeat(s.depth)} ${s.heading}\n${s.body}` : s.body))
      .join('\n\n')
      .trim();
    const last = chunks[chunks.length - 1];
    if (!last.content.includes(tail)) {
      last.content = `${last.content}\n\n${tail}`;
      last.tokenCount += packTokens;
    }
    pack = [];
  }
  flush();

  return chunks;
}

function parseSections(doc: string, markdown: string): Section[] {
  const body = markdown.replace(/^---\n[\s\S]*?\n---\n/, '');
  const stack: string[] = [];
  const sections: Section[] = [];
  let current: Section | null = null;

  const push = (heading: string, depth: number) => {
    stack.length = Math.min(stack.length, depth - 1);
    stack[depth - 1] = heading;
    current = {
      headingPath: stack.filter(Boolean).join(' > ') || doc,
      heading,
      depth,
      body: '',
      tokens: 0,
    };
    sections.push(current);
  };

  for (const line of body.split('\n')) {
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      push(h[2].trim(), h[1].length);
      continue;
    }
    if (!current) push('', 1);
    current!.body += `${line}\n`;
  }

  for (const s of sections) {
    s.body = s.body.trim();
    s.tokens = estimateTokens(s.body) + estimateTokens(s.heading);
  }
  return sections.filter((s) => s.body || s.heading);
}

function splitOversized(section: Section): Section[] {
  if (section.tokens <= TARGET_MAX) return [section];
  const paras = section.body.split(/\n{2,}/);
  const out: Section[] = [];
  let buf: string[] = [];
  let first = true;
  for (const p of paras) {
    const next = [...buf, p];
    if (estimateTokens(next.join('\n\n')) > TARGET_MAX && buf.length) {
      out.push({
        ...section,
        heading: first ? section.heading : '',
        body: buf.join('\n\n'),
        tokens: estimateTokens(buf.join('\n\n')),
      });
      first = false;
      buf = [p];
    } else {
      buf = next;
    }
  }
  if (buf.length) {
    out.push({
      ...section,
      heading: first ? section.heading : '',
      body: buf.join('\n\n'),
      tokens: estimateTokens(buf.join('\n\n')),
    });
  }
  return out;
}
