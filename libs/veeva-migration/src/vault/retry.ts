/**
 * Exponential backoff with full jitter for Vault calls (§8.1: base 2 s,
 * factor 2, cap 300 s, max 8 attempts). Pure — sleep and RNG are injectable
 * so tests run instantly. Session errors are NOT retried here: the transport
 * handles INVALID_SESSION_ID with a single re-auth + replay (§2.5.2).
 */
import { toVaultError, type VaultRequestError } from "./errors";

export interface VaultRetryPolicy {
  baseMs: number;
  factor: number;
  capMs: number;
  /** Total attempts including the first (8 = 7 retries). */
  maxAttempts: number;
}

export const DEFAULT_VAULT_RETRY_POLICY: VaultRetryPolicy = {
  baseMs: 2_000,
  factor: 2,
  capMs: 300_000,
  maxAttempts: 8,
};

export type SleepFn = (ms: number) => Promise<void>;
export type RandomFn = () => number;

export const defaultSleep: SleepFn = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Full-jitter delay after `failures` consecutive failures (1-based). */
export function backoffDelayMs(
  failures: number,
  policy: VaultRetryPolicy = DEFAULT_VAULT_RETRY_POLICY,
  random: RandomFn = Math.random,
): number {
  const exp = Math.max(0, failures - 1);
  const ceiling = Math.min(policy.capMs, policy.baseMs * policy.factor ** exp);
  return Math.floor(random() * ceiling);
}

export interface VaultRetryOptions {
  policy?: Partial<VaultRetryPolicy>;
  /** Default: `err.retryable`. */
  shouldRetry?: (err: VaultRequestError, attempt: number) => boolean;
  sleep?: SleepFn;
  random?: RandomFn;
  onRetry?: (info: {
    err: VaultRequestError;
    attempt: number;
    delayMs: number;
  }) => void;
  signal?: AbortSignal;
}

/**
 * Run `fn` with §8.1 backoff. Errors are normalised through `toVaultError`;
 * the last one is rethrown once the policy is exhausted. `Retry-After` wins
 * over the computed delay (still capped by `capMs`).
 */
export async function withVaultRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: VaultRetryOptions = {},
): Promise<T> {
  const policy: VaultRetryPolicy = {
    ...DEFAULT_VAULT_RETRY_POLICY,
    ...opts.policy,
  };
  const sleep = opts.sleep ?? defaultSleep;
  const random = opts.random ?? Math.random;
  const shouldRetry = opts.shouldRetry ?? ((e) => e.retryable);
  let attempt = 0;
  for (;;) {
    attempt++;
    try {
      return await fn(attempt);
    } catch (raw) {
      const err = toVaultError(raw);
      if (
        attempt >= policy.maxAttempts ||
        !shouldRetry(err, attempt) ||
        opts.signal?.aborted
      ) {
        throw err;
      }
      let delayMs = backoffDelayMs(attempt, policy, random);
      if (err.retryAfterMs !== undefined)
        delayMs = Math.min(policy.capMs, Math.max(delayMs, err.retryAfterMs));
      opts.onRetry?.({ err, attempt, delayMs });
      await sleep(delayMs);
    }
  }
}
