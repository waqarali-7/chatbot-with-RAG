import { z } from 'zod';
import { providerFor } from '@/lib/llm/registry';
import type { LLMProvider } from '@/lib/llm/provider';

/**
 * LLM judge. Two rules make the numbers mean anything:
 *
 *  1. Temperature 0 and a pinned model, so a re-run reproduces the verdict.
 *  2. The judge must differ in family from the agent. A model scoring its own
 *     output carries self-preference bias and inflates the result, so the
 *     default routing puts the agent on Anthropic and the judge on OpenAI.
 *
 * Verdicts are per-flag booleans with evidence spans, never a holistic score.
 * A holistic score is noise: it cannot tell you what to fix and it hides the
 * partial failures that matter.
 */

export const TELL_FLAGS = [
  'recap',
  'over_ack',
  'assistant_register',
  'over_explains',
  'unnatural_formality',
  'no_idk',
  'derails_off_script',
] as const;

export type TellFlag = (typeof TELL_FLAGS)[number];

const TellSchema = z.object({
  flags: z.object({
    recap: z.boolean(),
    over_ack: z.boolean(),
    assistant_register: z.boolean(),
    over_explains: z.boolean(),
    unnatural_formality: z.boolean(),
    no_idk: z.boolean(),
    derails_off_script: z.boolean(),
  }),
  evidence: z.record(z.string(), z.string().nullable()).default({}),
});

export interface TellVerdict {
  turnId: string;
  flags: Record<TellFlag, boolean>;
  evidence: Record<string, string | null>;
}

const TELL_SYSTEM = `You are grading one reply from a dental clinic's front desk, looking only for signs that it was written by a language model rather than a person.

You are given the visitor's message, the reply, and the knowledge-base extract the reply was allowed to use.

Set a flag to true only if it clearly applies. When in doubt, false.

recap: restates or paraphrases the visitor's message back before answering it
over_ack: performative acknowledgement, e.g. "I've noted that down", "thank you for confirming"
assistant_register: customer-service-bot phrasing, e.g. "happy to assist", "is there anything else", "feel free to"
over_explains: answers substantially more than was asked
unnatural_formality: register noticeably more formal than the visitor's
no_idk: asserts a fact about the business that the extract does not contain. Specific appointment times and dates are NOT covered by the extract and are never a reason to set this flag: they come from a live availability list you are not shown.
derails_off_script: ignores or loses the thread of something the visitor raised

Reply with JSON only, no prose:
{"flags":{"recap":false,"over_ack":false,"assistant_register":false,"over_explains":false,"unnatural_formality":false,"no_idk":false,"derails_off_script":false},"evidence":{"recap":null}}

evidence maps each true flag to the exact span from the reply that triggered it.`;

export interface TellJudgeInput {
  turnId: string;
  userMessage: string;
  agentMessage: string;
  context: string;
  retrievalEmpty: boolean;
  offScript: boolean;
  /** What the loop did this turn: reply, offer, held, booked, waitlist, handoff. */
  action?: string;
}

export async function judgeTellTurn(
  input: TellJudgeInput,
  provider: LLMProvider = providerFor('judge'),
): Promise<TellVerdict> {
  const user = `VISITOR: ${input.userMessage}\n\nREPLY: ${input.agentMessage}\n\nKNOWLEDGE BASE EXTRACT:\n${
    input.context || '(nothing was retrieved for this turn)'
  }`;

  const res = await provider.complete({
    role: 'judge',
    system: TELL_SYSTEM,
    messages: [{ role: 'user', content: user }],
    maxTokens: 400,
    temperature: 0,
    seed: 0,
    meta: { task: 'tell', ...input },
  });

  const parsed = TellSchema.safeParse(safeJson(res.text));
  if (!parsed.success) {
    // A judge that fails to parse must not silently score as clean.
    throw new Error(`judge returned unparseable tell verdict for ${input.turnId}: ${res.text.slice(0, 200)}`);
  }
  return { turnId: input.turnId, flags: parsed.data.flags, evidence: parsed.data.evidence };
}

// ------------------------------------------------------------- faithfulness

const ClaimsSchema = z.object({
  claims: z.array(z.object({ claim: z.string(), supported: z.boolean() })),
});

const FAITHFULNESS_SYSTEM = `You check whether an answer is supported by the extract it was given.

Break the answer into atomic factual claims about the business: one fact per claim. Ignore questions, greetings, statements about the assistant itself, and anything about appointment availability. Specific times and dates offered come from a live diary rather than the extract and are checked separately, so they are never claims here. For each remaining claim, decide whether the extract supports it.

A claim is supported only if the extract states it or directly entails it. Plausible is not supported.

Reply with JSON only:
{"claims":[{"claim":"...","supported":true}]}

If the answer makes no factual claims, return {"claims":[]}.`;

export interface ClaimJudgeInput {
  question: string;
  answer: string;
  context: string;
}

/**
 * Per-claim faithfulness. Decomposing and checking each claim is the whole
 * point: a single holistic score hides exactly the partial hallucination that
 * matters, where four sentences are right and the fifth invents a price.
 */
export async function judgeFaithfulness(
  input: ClaimJudgeInput,
  provider: LLMProvider = providerFor('judge'),
): Promise<{ claims: { claim: string; supported: boolean }[] }> {
  const res = await provider.complete({
    role: 'judge',
    system: FAITHFULNESS_SYSTEM,
    messages: [
      {
        role: 'user',
        content: `QUESTION: ${input.question}\n\nANSWER: ${input.answer}\n\nEXTRACT:\n${input.context || '(nothing retrieved)'}`,
      },
    ],
    maxTokens: 600,
    temperature: 0,
    seed: 0,
    meta: { task: 'faithfulness', ...input },
  });
  const parsed = ClaimsSchema.safeParse(safeJson(res.text));
  if (!parsed.success) throw new Error(`judge returned unparseable claims: ${res.text.slice(0, 200)}`);
  return parsed.data;
}

const RelevancySchema = z.object({
  addresses: z.boolean(),
  declines: z.boolean(),
  reason: z.string().default(''),
});

/**
 * Relevancy and abstention are judged in the same call.
 *
 * Abstention was previously detected with a hedge regex, which is the wrong
 * tool for the most important metric in the suite: it read "I'm not totally
 * sure, let me find out" and "I'm not certain we offer that" as confident
 * assertions, and scored two correct declines as confabulations. Whether an
 * answer committed to a claim or declined is a judgement, so it is judged.
 */
const RELEVANCY_SYSTEM = `You are grading one answer from a dental clinic's front desk.

Answer two things about it.

addresses: does the answer engage with the question that was asked? An explicit "I'm not sure, I'll check" engages with it. A fluent answer to a different question does not.

declines: does the answer decline to give a factual answer, saying it does not know, is not sure, needs to check, or will have someone follow up? Hedged phrasings count: "I'm not totally sure", "I'm not certain we offer that", "nothing listed on my end", "let me find out". An answer that states a fact about the business does NOT count as declining, even if it adds an offer to check afterwards. Asking a booking question is not declining.

Reply with JSON only: {"addresses":true,"declines":false,"reason":"..."}`;

export async function judgeRelevancy(
  input: ClaimJudgeInput,
  provider: LLMProvider = providerFor('judge'),
): Promise<{ addresses: boolean; declines: boolean; reason: string }> {
  const res = await provider.complete({
    role: 'judge',
    system: RELEVANCY_SYSTEM,
    messages: [{ role: 'user', content: `QUESTION: ${input.question}\n\nANSWER: ${input.answer}` }],
    maxTokens: 200,
    temperature: 0,
    seed: 0,
    meta: { task: 'relevancy', ...input },
  });
  const parsed = RelevancySchema.safeParse(safeJson(res.text));
  if (!parsed.success) throw new Error(`judge returned unparseable relevancy: ${res.text.slice(0, 200)}`);
  return parsed.data;
}

function safeJson(text: string): unknown {
  const cleaned = text.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const m = /\{[\s\S]*\}/.exec(cleaned);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}
