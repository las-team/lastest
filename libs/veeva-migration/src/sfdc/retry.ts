/**
 * Exponential backoff with full jitter (§8.1: base 2 s, factor 2, cap 300 s,
 * max 8 attempts). Pure — the clock, sleep and RNG are injectable so tests
 * run instantly.
 */
import { isSfdcApiError, toSfdcError, type SfdcApiError } from "./errors";

export interface RetryPolicy {
  baseMs: number;
  factor: number;
  capMs: number;
  /** Total attempts including the first (8 = 7 retries). */
  maxAttempts: number;
  /**
   * `QUERY_TIMEOUT` is retryable "with a smaller window" (§8.1) — the caller
   * shrinks the window, so the transport only replays it this many times.
   */
  queryTimeoutAttempts: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  baseMs: 2_000,
  factor: 2,
  capMs: 300_000,
  maxAttempts: 8,
  queryTimeoutAttempts: 2,
};

export type SleepFn = (ms: number) => Promise<void>;
export type RandomFn = () => number;

export const defaultSleep: SleepFn = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Full-jitter delay for the retry after `failures` consecutive failures
 * (1-based): `random() * min(cap, base * factor^(failures-1))`.
 */
export function backoffDelayMs(
  failures: number,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  random: RandomFn = Math.random,
): number {
  const exp = Math.max(0, failures - 1);
  const ceiling = Math.min(policy.capMs, policy.baseMs * policy.factor ** exp);
  return Math.floor(random() * ceiling);
}

export interface RetryOptions {
  policy?: Partial<RetryPolicy>;
  /** Decide whether `err` (already an `SfdcApiError`) may be retried. Default: `err.retryable`. */
  shouldRetry?: (err: SfdcApiError, attempt: number) => boolean;
  sleep?: SleepFn;
  random?: RandomFn;
  onRetry?: (info: {
    err: SfdcApiError;
    attempt: number;
    delayMs: number;
  }) => void;
  signal?: AbortSignal;
}

/**
 * Run `fn` with §8.1 backoff. `fn` receives the 1-based attempt number. Errors
 * are normalised through `toSfdcError`; the last error is rethrown once the
 * policy is exhausted. `Retry-After` on the error wins over the computed
 * delay (still capped by `capMs`).
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const policy: RetryPolicy = { ...DEFAULT_RETRY_POLICY, ...opts.policy };
  const sleep = opts.sleep ?? defaultSleep;
  const random = opts.random ?? Math.random;
  const shouldRetry = opts.shouldRetry ?? ((e) => e.retryable);
  let attempt = 0;
  for (;;) {
    attempt++;
    try {
      return await fn(attempt);
    } catch (raw) {
      const err = toSfdcError(raw);
      const maxAttempts =
        err.errorCode === "QUERY_TIMEOUT"
          ? Math.min(policy.maxAttempts, policy.queryTimeoutAttempts)
          : policy.maxAttempts;
      if (
        attempt >= maxAttempts ||
        !shouldRetry(err, attempt) ||
        opts.signal?.aborted
      ) {
        throw isSfdcApiError(raw) ? raw : err;
      }
      let delayMs = backoffDelayMs(attempt, policy, random);
      if (err.retryAfterMs !== undefined)
        delayMs = Math.min(policy.capMs, Math.max(delayMs, err.retryAfterMs));
      opts.onRetry?.({ err, attempt, delayMs });
      await sleep(delayMs);
    }
  }
}
