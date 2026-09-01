import { describe, expect, it, vi } from 'vitest';
import { QuotaExhaustedError, withRetry } from './retry';

const anthropicQuotaError = () =>
  Object.assign(
    new Error(
      '400 {"type":"error","error":{"type":"invalid_request_error","message":"You have reached your specified API usage limits. You will regain access on 2026-09-01 at 00:00 UTC."}}',
    ),
    { status: 400 },
  );

describe('withRetry', () => {
  it('turns a quota error into a typed one and does not retry it', async () => {
    const fn = vi.fn().mockRejectedValue(anthropicQuotaError());
    await expect(withRetry('anthropic.stream', fn)).rejects.toBeInstanceOf(QuotaExhaustedError);
    // Retrying a spent budget just burns wall clock on a wall.
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('names the provider and the reset time', async () => {
    const fn = vi.fn().mockRejectedValue(anthropicQuotaError());
    await expect(withRetry('anthropic.stream', fn)).rejects.toThrow(/anthropic API usage limit/);
    await expect(withRetry('anthropic.stream', fn)).rejects.toThrow(/2026-09-01 at 00:00 UTC/);
  });

  it('retries a rate limit and succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('429 too many requests'), { status: 429 }))
      .mockResolvedValue('ok');
    await expect(withRetry('openai.complete', fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry an ordinary 400', async () => {
    const fn = vi.fn().mockRejectedValue(Object.assign(new Error('400 bad request'), { status: 400 }));
    await expect(withRetry('openai.complete', fn)).rejects.toThrow(/bad request/);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives up after the attempt budget on a persistent 503', async () => {
    const fn = vi.fn().mockRejectedValue(Object.assign(new Error('503'), { status: 503 }));
    await expect(withRetry('openai.complete', fn, 3)).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
