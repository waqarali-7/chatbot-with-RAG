/**
 * Running spend accounting with a hard ceiling.
 *
 * The eval suite makes thousands of calls and there was no way to know what a
 * run would cost until the bill arrived. `EVAL_MAX_USD` stops the run the
 * moment the ceiling is crossed, rather than after.
 */

/** USD per million tokens. */
interface Rate {
  input: number;
  output: number;
  /** Anthropic rates are first-party list prices; others are estimates. */
  authoritative: boolean;
}

const RATES: Record<string, Rate> = {
  'claude-sonnet-5': { input: 2, output: 10, authoritative: true },
  'claude-haiku-4-5-20251001': { input: 1, output: 5, authoritative: true },
  'claude-opus-5': { input: 5, output: 25, authoritative: true },
  // Estimates. Wrong here means the ceiling is approximate for OpenAI-served
  // roles, so the figure is labelled rather than presented as exact.
  'gpt-4.1-2025-04-14': { input: 2, output: 8, authoritative: false },
  'gpt-4.1-mini-2025-04-14': { input: 0.4, output: 1.6, authoritative: false },
  'text-embedding-3-small': { input: 0.02, output: 0, authoritative: false },
};

const spend = new Map<string, { input: number; output: number; calls: number }>();

export class BudgetExceededError extends Error {
  constructor(
    readonly spentUsd: number,
    readonly ceilingUsd: number,
  ) {
    super(
      `Eval budget exhausted: $${spentUsd.toFixed(2)} spent against an EVAL_MAX_USD ceiling of $${ceilingUsd.toFixed(2)}.\n` +
        `  Stages completed before the ceiling have been written to evals/results/.\n` +
        `  Raise the ceiling with EVAL_MAX_USD=<dollars>, or run a smaller stage.`,
    );
    this.name = 'BudgetExceededError';
  }
}

export function recordUsage(model: string, input: number, output: number): void {
  const row = spend.get(model) ?? { input: 0, output: 0, calls: 0 };
  row.input += input;
  row.output += output;
  row.calls += 1;
  spend.set(model, row);

  const ceiling = Number(process.env.EVAL_MAX_USD);
  if (Number.isFinite(ceiling) && ceiling > 0 && totalUsd() > ceiling) {
    throw new BudgetExceededError(totalUsd(), ceiling);
  }
}

export function totalUsd(): number {
  let usd = 0;
  for (const [model, row] of spend) {
    const rate = RATES[model];
    if (!rate) continue;
    usd += (row.input / 1e6) * rate.input + (row.output / 1e6) * rate.output;
  }
  return usd;
}

export function spendReport(): string {
  if (!spend.size) return 'no billable calls';
  const lines: string[] = [];
  let anyEstimate = false;
  for (const [model, row] of spend) {
    const rate = RATES[model];
    if (!rate) {
      lines.push(`  ${model}: ${row.calls} calls, no rate on file`);
      continue;
    }
    if (!rate.authoritative) anyEstimate = true;
    const usd = (row.input / 1e6) * rate.input + (row.output / 1e6) * rate.output;
    lines.push(
      `  ${model.padEnd(28)} ${String(row.calls).padStart(5)} calls  ${(row.input / 1000).toFixed(0)}k in  ${(row.output / 1000).toFixed(0)}k out  $${usd.toFixed(2)}${rate.authoritative ? '' : ' (est)'}`,
    );
  }
  lines.push(`  ${'total'.padEnd(28)} ${' '.repeat(11)}${' '.repeat(20)}$${totalUsd().toFixed(2)}`);
  if (anyEstimate) lines.push('  (est) rates are estimates; Anthropic rates are list prices');
  return lines.join('\n');
}

export function resetSpend(): void {
  spend.clear();
}
