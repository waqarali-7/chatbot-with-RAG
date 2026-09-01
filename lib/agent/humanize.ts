import { mulberry32 } from '@/lib/util/rand';
import {
  clamp,
  countEmoji,
  countSentences,
  longestCommonRun,
  splitSentences,
  truncateAtSentence,
} from '@/lib/util/text';
import type { Bubble, StyleReport, StyleViolation } from './types';

export const MAX_CHARS = 240;
export const MAX_SENTENCES = 2;
export const RECAP_RUN_TOKENS = 6;

const BANNED_OPENERS = [
  'great',
  'perfect',
  'absolutely',
  'certainly',
  'of course',
  'thanks for sharing',
  'thank you for sharing',
  'i understand',
  "i'd be happy to",
  'i would be happy to',
  'happy to help',
  'sure thing',
  'no problem at all',
];

const ASSISTANT_REGISTER = [
  'happy to assist',
  'how may i',
  'anything else i can help',
  'anything else i can do',
  'is there anything else',
  'feel free to',
  'please do not hesitate',
  "don't hesitate to",
  'i can certainly',
  'let me know if you have any',
  'thank you for reaching out',
  'as an ai',
  'i am an ai',
  'assist you today',
  'how can i help you today',
];

const OVER_ACK = [
  "i've noted",
  'ive noted',
  'noted that down',
  "i've made a note",
  "i've got that recorded",
  'recorded that',
  "got it, i've",
  "got it, i'll just",
  "i've popped that",
  'duly noted',
];

/**
 * Distinct things a single message asks the visitor for. Used to catch a reply
 * that stacks several requests behind one question mark.
 */
const ASK_TARGETS: [string, RegExp][] = [
  ['name', /\b(your name|who'?s it for|can i (take|grab|get) (your )?name|name\?)/i],
  ['site', /\b(which (site|location|branch|one)|preferred (site|location)|docklands or|shoreditch or|clapham or|where would you|whereabouts)/i],
  ['reason', /\b(what'?s it for|what do you need|what are you (after|coming in)|reason for|what'?s the appointment for|what needs)/i],
  ['time', /\b(what time|which time|when (would|works|suits|are you)|\d{1,2}(:\d{2})?\s?[ap]m\b|morning or afternoon)/i],
];

export function askTargets(text: string): string[] {
  return ASK_TARGETS.filter(([, re]) => re.test(text)).map(([k]) => k);
}

/**
 * Post-generation style validator. Every generation is checked before it reaches
 * the client. These are the same rules the prompt states, enforced as code
 * because a prompt alone drifts across a long conversation and the failure is
 * silent.
 */
export function validateStyle(text: string, previousUserMessage?: string): StyleReport {
  const violations: StyleViolation[] = [];
  const evidence: Partial<Record<StyleViolation, string>> = {};
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  if (trimmed.length > MAX_CHARS) {
    violations.push('over_length');
    evidence.over_length = `${trimmed.length} chars`;
  } else if (countSentences(trimmed) > MAX_SENTENCES) {
    violations.push('over_length');
    evidence.over_length = `${countSentences(trimmed)} sentences`;
  }

  const listHit = /(^|\n)\s*(?:[-*•]\s|\d+[.)]\s)/.exec(trimmed) ?? /\n\n/.exec(trimmed);
  if (listHit) {
    violations.push('list_formatting');
    evidence.list_formatting = JSON.stringify(listHit[0]);
  }

  const dash = /[—–]|\s-{1,2}\s/.exec(trimmed);
  if (dash) {
    violations.push('em_dash');
    evidence.em_dash = dash[0];
  }

  const opener = BANNED_OPENERS.find((b) => lower.startsWith(b));
  if (opener) {
    violations.push('banned_opener');
    evidence.banned_opener = opener;
  }

  const register = ASSISTANT_REGISTER.find((p) => lower.includes(p));
  if (register) {
    violations.push('assistant_register');
    evidence.assistant_register = register;
  }

  const questions = (trimmed.match(/\?/g) ?? []).length;
  const asked = askTargets(trimmed);
  if (questions > 1) {
    violations.push('question_stacking');
    evidence.question_stacking = `${questions} question marks`;
  } else if (questions === 1 && asked.length > 1) {
    // "Can I grab your name, and got a preferred site, or would 10am work?"
    // is three questions wearing one question mark. Counting punctuation alone
    // misses the failure the one-question-at-a-time rule exists to prevent.
    violations.push('question_stacking');
    evidence.question_stacking = `asks for ${asked.join(' + ')} in one message`;
  }

  const ack = OVER_ACK.find((p) => lower.includes(p));
  if (ack) {
    violations.push('over_ack');
    evidence.over_ack = ack;
  }

  if (countEmoji(trimmed) > 1) {
    violations.push('emoji_excess');
    evidence.emoji_excess = `${countEmoji(trimmed)} emoji`;
  }

  if (previousUserMessage) {
    const run = longestCommonRun(previousUserMessage, trimmed);
    if (run.length >= RECAP_RUN_TOKENS) {
      violations.push('recap');
      evidence.recap = run.text;
    }
  }

  return { violations, evidence, ok: violations.length === 0 };
}

/** Human-readable reason fed back to the model on the single retry. */
export function describeViolations(report: StyleReport): string {
  return report.violations
    .map((v) => {
      const ev = report.evidence[v];
      switch (v) {
        case 'over_length':
          return `too long (${ev}), keep it to two sentences and 240 characters`;
        case 'list_formatting':
          return 'you used list formatting or a blank line, write it as plain sentences';
        case 'em_dash':
          return `you used a dash (${ev}), use a comma or a full stop`;
        case 'banned_opener':
          return `you opened with "${ev}", just answer`;
        case 'assistant_register':
          return `you used customer-service phrasing ("${ev}")`;
        case 'question_stacking':
          return ev?.startsWith('asks for')
            ? `you asked for several things at once (${ev.replace('asks for ', '').replace(' in one message', '')}), ask for one`
            : 'you asked more than one question, ask one';
        case 'recap':
          return `you repeated their words back ("${ev}"), just respond to it`;
        case 'over_ack':
          return `you over-confirmed ("${ev}")`;
        case 'emoji_excess':
          return 'too many emoji';
      }
    })
    .join('; ');
}

/**
 * Last-resort repair after the retry also fails. Truncating at a sentence
 * boundary under the cap is a worse message than a good generation, but it is
 * never a style violation reaching the visitor.
 */
export function repair(text: string): string {
  let out = text
    .replace(/[—–]/g, ',')
    .replace(/\s-{1,2}\s/g, ', ')
    .replace(/(^|\n)\s*(?:[-*•]\s|\d+[.)]\s)/g, '$1')
    .replace(/\n{2,}/g, ' ')
    .replace(/\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  for (const opener of BANNED_OPENERS) {
    const re = new RegExp(`^${opener}[,!.]?\\s+`, 'i');
    if (re.test(out)) out = out.replace(re, '');
  }
  out = out.charAt(0).toUpperCase() + out.slice(1);

  const sentences = splitSentences(out);
  if (sentences.length > MAX_SENTENCES) out = sentences.slice(0, MAX_SENTENCES).join(' ');
  if (out.length > MAX_CHARS) out = truncateAtSentence(out, MAX_CHARS);

  // Keep only the first question mark.
  const first = out.indexOf('?');
  if (first !== -1) {
    out = out.slice(0, first + 1) + out.slice(first + 1).replace(/\?/g, '.');
  }
  return out.trim();
}

/**
 * Message splitting. Two sentences go out as two bubbles, because people send
 * short bursts rather than compound sentences. A short second sentence that is
 * really a tag ("ok?") stays attached.
 */
export function splitBubbles(text: string): string[] {
  const sentences = splitSentences(text.trim());
  if (sentences.length < 2) return [text.trim()];
  const [a, b] = sentences;
  if (b.length < 12) return [text.trim()];
  return [a, sentences.slice(1).join(' ')];
}

export const TYPING_BASE_MS = 600;
export const TYPING_PER_CHAR_MS = 40;
export const TYPING_CAP_MS = 4000;
export const JITTER = 0.2;

/**
 * Typing delay per bubble. Instant replies read as a bot regardless of wording,
 * and this moves perceived humanness more than any prompt edit. The jitter
 * matters as much as the base: a perfectly uniform delay is its own tell.
 */
export function typingDelayMs(text: string, rng: () => number): number {
  const base = TYPING_BASE_MS + TYPING_PER_CHAR_MS * text.length;
  const capped = Math.min(base, TYPING_CAP_MS);
  const jitter = 1 + (rng() * 2 - 1) * JITTER;
  return Math.round(clamp(capped * jitter, 250, TYPING_CAP_MS * (1 + JITTER)));
}

export function toBubbles(text: string, seed: number): Bubble[] {
  const rng = mulberry32(seed);
  return splitBubbles(text).map((t) => ({ text: t, delayMs: typingDelayMs(t, rng) }));
}

/**
 * Register mirroring applied to the outgoing text: shorter, lowercase-leaning,
 * no terminal full stop on a short reply. Questions keep their question mark.
 */
export function mirrorRegister(text: string): string {
  const t = text.trim();
  if (t.length > 60) return t;
  // Commit to the register rather than half-applying it. "that one I'm not
  // sure on" reads worse than either the formal or the casual version.
  let out = t.toLowerCase();
  if (/[.]$/.test(out) && out.length < 40) out = out.slice(0, -1);
  return out;
}
