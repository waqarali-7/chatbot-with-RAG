import type { ReactNode } from 'react';

export function Section({
  id,
  title,
  lede,
  children,
}: {
  id: string;
  title: string;
  lede?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="mt-14 scroll-mt-6">
      <h2 className="text-[19px] font-semibold tracking-[-0.008em]">{title}</h2>
      {lede && (
        <p className="mt-2 max-w-[46rem] text-[14px] leading-[1.6] text-[var(--color-ink-soft)]">
          {lede}
        </p>
      )}
      <div className="mt-5">{children}</div>
    </section>
  );
}

export function Table({ children, minWidth = '44rem' }: { children: ReactNode; minWidth?: string }) {
  // Wide tables scroll inside their own container; the page body never scrolls
  // horizontally.
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[14px]" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

export function Th({
  children,
  numeric = false,
  className = '',
}: {
  children: ReactNode;
  numeric?: boolean;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={`border-b border-[var(--color-rule-strong)] py-2 pr-5 text-[12px] font-medium text-[var(--color-ink-faint)] ${
        numeric ? 'text-right' : 'text-left'
      } ${className}`}
    >
      {children}
    </th>
  );
}

export function Td({
  children = null,
  numeric = false,
  className = '',
}: {
  children?: ReactNode;
  numeric?: boolean;
  className?: string;
}) {
  return (
    <td
      className={`border-b border-[var(--color-rule)] py-2.5 pr-5 align-top ${
        numeric ? 'tnum text-right' : ''
      } ${className}`}
    >
      {children}
    </td>
  );
}

/**
 * Value against threshold, with pass or fail carried by which side of the
 * threshold line the marker sits on. Colour repeats that reading rather than
 * being the only way to get it.
 */
export function ThresholdBar({
  value,
  threshold,
  direction,
  scaleMax = 1,
}: {
  value: number;
  threshold: number;
  /** 'min' = higher is better. 'max' = lower is better. */
  direction: 'min' | 'max';
  scaleMax?: number;
}) {
  const pct = (n: number) => `${Math.max(0, Math.min(100, (n / scaleMax) * 100))}%`;
  const pass = direction === 'min' ? value >= threshold : value <= threshold;

  return (
    <div className="relative h-[22px] w-full min-w-[7rem]" aria-hidden="true">
      <div className="absolute inset-x-0 top-[10px] h-[2px] bg-[var(--color-rule)]" />
      <div
        className={`absolute top-[10px] h-[2px] ${pass ? 'bg-[var(--color-pass)]' : 'bg-[var(--color-fail)]'}`}
        style={
          direction === 'min'
            ? { left: 0, width: pct(value) }
            : { left: 0, width: pct(value) }
        }
      />
      <div
        className="absolute top-[3px] h-[16px] w-[1px] bg-[var(--color-accent)]"
        style={{ left: pct(threshold) }}
      />
      <div
        className={`absolute top-[6px] h-[10px] w-[10px] -translate-x-1/2 rounded-full border-2 border-[var(--color-paper)] ${
          pass ? 'bg-[var(--color-pass)]' : 'bg-[var(--color-fail)]'
        }`}
        style={{ left: pct(value) }}
      />
    </div>
  );
}

export function Status({ pass, label }: { pass: boolean; label?: string }) {
  return (
    <span
      className={`inline-block rounded-[3px] px-1.5 py-[2px] text-[11px] font-medium ${
        pass
          ? 'bg-[var(--color-pass-wash)] text-[var(--color-pass)]'
          : 'bg-[var(--color-fail-wash)] text-[var(--color-fail)]'
      }`}
    >
      {label ?? (pass ? 'pass' : 'fail')}
    </span>
  );
}

export function Pending({ label = 'not run' }: { label?: string }) {
  return (
    <span className="inline-block rounded-[3px] border border-[var(--color-rule-strong)] px-1.5 py-[2px] text-[11px] text-[var(--color-ink-faint)]">
      {label}
    </span>
  );
}

/** Inline expansion. Motion only where it shows something changed. */
export function Expand({ summary, children }: { summary: ReactNode; children: ReactNode }) {
  return (
    <details className="group border-b border-[var(--color-rule)]">
      <summary className="cursor-pointer list-none py-2.5 text-[14px] marker:hidden">
        <span className="text-[var(--color-ink-faint)] group-open:hidden">+ </span>
        <span className="hidden text-[var(--color-ink-faint)] group-open:inline">− </span>
        {summary}
      </summary>
      <div className="pb-4 pl-4">{children}</div>
    </details>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return (
    <p className="mt-4 max-w-[46rem] border-l-2 border-[var(--color-rule-strong)] pl-3 text-[13px] leading-[1.6] text-[var(--color-ink-soft)]">
      {children}
    </p>
  );
}

export const pctFmt = (n: number | null | undefined, dp = 2) =>
  n === null || n === undefined ? '—' : n.toFixed(dp);

/**
 * A stage that did not run in this pass. Shown instead of the section, because
 * leaving the last run's numbers in place would put results from two different
 * systems on one page.
 */
export function NotRun({ stage, why }: { stage: string; why: string }) {
  return (
    <div className="border border-[var(--color-rule-strong)] px-4 py-4">
      <p className="text-[14px] font-medium">Not run in this pass</p>
      <p className="mt-2 max-w-[46rem] text-[13px] leading-[1.6] text-[var(--color-ink-soft)]">
        {why} Nothing is shown rather than the previous run's figures: the other sections on this
        page come from a different stack, and mixing them would make the whole page unreadable as
        evidence. Re-run with <span className="tnum">pnpm eval:{stage}</span>.
      </p>
    </div>
  );
}
