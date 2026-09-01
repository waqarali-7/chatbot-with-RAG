/**
 * Bounded-concurrency map, preserving input order in the output.
 *
 * The eval suite is embarrassingly parallel at the row and run level: every
 * golden row and every conversation gets its own slot store and its own fixed
 * seed, so running them together changes the wall clock and nothing else.
 * Sequentially the full suite is a couple of hours of mostly waiting on the
 * network.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;

  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });

  await Promise.all(workers);
  return out;
}

export function evalConcurrency(): number {
  const n = Number(process.env.EVAL_CONCURRENCY);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 6;
}
