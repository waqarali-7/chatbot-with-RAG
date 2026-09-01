export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const idx = (s.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return s[lo];
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

export const p50 = (v: number[]) => percentile(v, 0.5);
export const p95 = (v: number[]) => percentile(v, 0.95);

export function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function round(n: number, dp = 4): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/** Histogram over fixed buckets, used for the delivered-delay distribution. */
export function histogram(values: number[], edges: number[]): { label: string; count: number }[] {
  const buckets = edges.map((e, i) => ({
    label: i === 0 ? `<${e}` : `${edges[i - 1]}-${e}`,
    count: 0,
  }));
  buckets.push({ label: `>=${edges[edges.length - 1]}`, count: 0 });
  for (const v of values) {
    let placed = false;
    for (let i = 0; i < edges.length; i++) {
      if (v < edges[i]) {
        buckets[i].count++;
        placed = true;
        break;
      }
    }
    if (!placed) buckets[buckets.length - 1].count++;
  }
  return buckets;
}
