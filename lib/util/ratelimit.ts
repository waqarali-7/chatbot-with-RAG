/**
 * Fixed-window rate limiter, 40 messages per hour per IP.
 *
 * In-process, so on a multi-instance deployment the effective limit is per
 * instance. That is a deliberate simplification for a public demo: it exists to
 * stop one person burning the token budget, not to be a security control. A
 * production deployment would put this in Postgres or KV.
 */
const WINDOW_MS = 60 * 60 * 1000;
const buckets = new Map<string, { count: number; resetAt: number }>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export function rateLimit(key: string, limit = Number(process.env.RATE_LIMIT_PER_HOUR ?? 40)): RateLimitResult {
  const now = Date.now();
  const b = buckets.get(key);

  if (!b || b.resetAt < now) {
    const resetAt = now + WINDOW_MS;
    buckets.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: limit - 1, resetAt };
  }

  b.count++;
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (v.resetAt < now) buckets.delete(k);
  }
  return { allowed: b.count <= limit, remaining: Math.max(0, limit - b.count), resetAt: b.resetAt };
}

export function clientKey(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  return (fwd?.split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown').slice(0, 64);
}
