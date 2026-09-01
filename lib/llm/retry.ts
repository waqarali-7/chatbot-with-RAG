/**
 * Retry on rate limits and transient upstream errors.
 *
 * Required once the eval suite runs in parallel: six concurrent workers will
 * hit a 429 on most account tiers, and without this a single rate limit kills a
 * two-hour run. Honours Retry-After when the provider sends one.
 */
const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504]);

interface HttpishError {
  status?: number;
  headers?: Record<string, string> | Headers;
  message?: string;
}

function retryAfterMs(err: HttpishError): number | null {
  const h = err.headers;
  const raw =
    h instanceof Headers ? h.get('retry-after') : (h as Record<string, string> | undefined)?.['retry-after'];
  if (!raw) return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) ? seconds * 1000 : null;
}

/**
 * A quota exhaustion is not a bug and not worth a stack trace. It arrives as a
 * 400 with a reset time, and buried in a hundred lines of headers it reads like
 * a code failure.
 */
export class QuotaExhaustedError extends Error {
  constructor(
    readonly provider: string,
    readonly detail: string,
  ) {
    super(
      `${provider} API usage limit reached. ${detail}\n` +
        `  Nothing is wrong with the build. Either wait for the reset, raise the limit, or\n` +
        `  run the remaining stages on another provider, e.g. AGENT_PROVIDER=openai pnpm eval.`,
    );
    this.name = 'QuotaExhaustedError';
  }
}

function quotaMessage(err: unknown): string | null {
  const text = String((err as { message?: string })?.message ?? err);
  const m = /(You have reached your specified API usage limits[^"]*)/i.exec(text);
  if (m) return m[1];
  return /quota|billing|credit balance|insufficient_quota/i.test(text) ? text.slice(0, 200) : null;
}

export async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  attempts = 5,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const quota = quotaMessage(err);
      if (quota) throw new QuotaExhaustedError(label.split('.')[0], quota);
      const status = (err as HttpishError)?.status;
      const retryable =
        (status !== undefined && RETRYABLE.has(status)) ||
        /ECONNRESET|ETIMEDOUT|fetch failed|socket hang up|overloaded/i.test(String(err));
      if (!retryable || attempt === attempts - 1) throw err;

      const backoff = retryAfterMs(err as HttpishError) ?? Math.min(30_000, 2 ** attempt * 1000);
      const jittered = backoff * (0.75 + Math.random() * 0.5);
      if (process.env.DEBUG_RETRY) {
        console.error(`[retry] ${label} ${status ?? 'network'}, waiting ${Math.round(jittered)}ms`);
      }
      await new Promise((r) => setTimeout(r, jittered));
    }
  }
  throw lastError;
}
