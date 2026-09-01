import { validateStyle } from '@/lib/agent/humanize';
import type { StyleViolation } from '@/lib/agent/types';

/**
 * Deterministic tell-rate scorer. Pure functions over the text, no model call,
 * zero variance. It catches most of it, and the flags it produces are the ones
 * you can act on directly.
 */
export interface DeterministicTurnInput {
  turnId: string;
  personaId: string;
  userMessage: string;
  agentMessage: string;
}

export interface DeterministicVerdict {
  turnId: string;
  personaId: string;
  violations: StyleViolation[];
  evidence: Partial<Record<StyleViolation, string>>;
  flagged: boolean;
}

export function scoreTurnDeterministic(input: DeterministicTurnInput): DeterministicVerdict {
  const report = validateStyle(input.agentMessage, input.userMessage);
  return {
    turnId: input.turnId,
    personaId: input.personaId,
    violations: report.violations,
    evidence: report.evidence,
    flagged: report.violations.length > 0,
  };
}

export const STYLE_VIOLATIONS: StyleViolation[] = [
  'over_length',
  'list_formatting',
  'em_dash',
  'banned_opener',
  'assistant_register',
  'question_stacking',
  'recap',
  'over_ack',
  'emoji_excess',
];

export function styleBreakdown(verdicts: DeterministicVerdict[]): Record<StyleViolation, number> {
  const out = Object.fromEntries(STYLE_VIOLATIONS.map((v) => [v, 0])) as Record<
    StyleViolation,
    number
  >;
  for (const v of verdicts) for (const violation of v.violations) out[violation]++;
  return out;
}
