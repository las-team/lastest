/**
 * §8.1 error classes as seen by the loader, plus the retry loop around one
 * Vault bulk call. The transport already retries transport-level failures;
 * this layer decides what a *surviving* error means for the unit:
 *
 *  - `retryable`  → backoff (base 2 s, factor 2, cap 300 s, ≤ 8 attempts), the
 *                   batch is re-sent whole (upsert makes it safe);
 *  - `session`    → re-auth once, replay once;
 *  - `structural` → unit aborted with a blocking finding, never retried;
 *  - `permission` → unit aborted, blocking;
 *  - `fatal`      → unit aborted.
 *
 * Row-level errors never reach this loop — they are per-row `FAILURE` entries
 * of a `SUCCESS`/`WARNING` envelope and classified by `rowErrorClass()`.
 */
import { vaultErrorClass, type VaultErrorClass } from "../vault/errors";
import {
  DEFAULT_VAULT_RETRY_POLICY,
  backoffDelayMs,
  defaultSleep,
  type RandomFn,
  type SleepFn,
  type VaultRetryPolicy,
} from "../vault/retry";
import { VaultApiError } from "../vault/types";

export type LoadErrorClass = VaultErrorClass;

/** Row-level `errors[].type` classes (§8.1 "Row-level value" vs retryable). */
export type RowErrorClass = "value" | "retryable" | "permission" | "unknown";

const ROW_RETRYABLE = ["RACE_CONDITION", "API_LIMIT_EXCEEDED", "EXCEPTION"];
const ROW_PERMISSION = ["INSUFFICIENT_ACCESS", "OPERATION_NOT_ALLOWED"];
const ROW_VALUE = [
  "INVALID_DATA",
  "PARAMETER_REQUIRED",
  "ATTRIBUTE_NOT_SUPPORTED",
  "INVALID_FILTER",
  "UNIQUE",
  "DUPLICATE",
];

export function rowErrorClass(type: string | undefined): RowErrorClass {
  const t = (type ?? "").toUpperCase();
  if (ROW_RETRYABLE.some((p) => t.startsWith(p))) return "retryable";
  if (ROW_PERMISSION.some((p) => t.startsWith(p))) return "permission";
  if (ROW_VALUE.some((p) => t.startsWith(p))) return "value";
  return "unknown";
}

/** Error types `retry-failed` re-sends by default (value errors after a fix, transient row errors). */
export function isRetryableRowErrorType(type: string | undefined): boolean {
  const c = rowErrorClass(type);
  return c === "value" || c === "retryable" || c === "unknown";
}

export function loadErrorClass(e: unknown): LoadErrorClass {
  return vaultErrorClass(e);
}

export function errorTypeOf(e: unknown): string {
  if (e instanceof VaultApiError) return e.type;
  if (e && typeof e === "object" && "code" in e)
    return String((e as { code: unknown }).code);
  return e instanceof Error ? e.name : "UNKNOWN";
}

export function errorMessageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export interface LoadRetryOptions {
  policy?: Partial<VaultRetryPolicy>;
  sleep?: SleepFn;
  random?: RandomFn;
  /** Re-authenticate on a `session` error (called at most once per call). */
  reauth?: () => Promise<unknown>;
  onRetry?: (info: {
    error: unknown;
    attempt: number;
    delayMs: number;
    errorClass: LoadErrorClass;
  }) => void;
}

/** Thrown by `withLoadRetry` when the error is not retryable; `errorClass` drives the unit outcome. */
export class LoadCallError extends Error {
  constructor(
    public readonly errorClass: LoadErrorClass,
    public readonly type: string,
    message: string,
    public readonly attempts: number,
    public readonly cause?: unknown,
  ) {
    super(`${type}: ${message}`);
    this.name = "LoadCallError";
  }
}

/**
 * Run one Vault call with the §8.1 policy. Resolves with the call result or
 * throws a `LoadCallError` carrying the final class (`retryable` when the
 * budget is exhausted → unit `failed(transport)`).
 */
export async function withLoadRetry<T>(
  fn: () => Promise<T>,
  opts: LoadRetryOptions = {},
): Promise<T> {
  const policy: VaultRetryPolicy = {
    ...DEFAULT_VAULT_RETRY_POLICY,
    ...opts.policy,
  };
  const sleep = opts.sleep ?? defaultSleep;
  let reauthed = false;
  let failures = 0;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const cls = loadErrorClass(e);
      if (cls === "session" && !reauthed && opts.reauth) {
        reauthed = true;
        await opts.reauth();
        continue;
      }
      if (cls !== "retryable" || attempt >= policy.maxAttempts) {
        throw new LoadCallError(
          cls === "session" ? "session" : cls,
          errorTypeOf(e),
          errorMessageOf(e),
          attempt,
          e,
        );
      }
      failures++;
      const delayMs = backoffDelayMs(failures, policy, opts.random);
      opts.onRetry?.({ error: e, attempt, delayMs, errorClass: cls });
      await sleep(delayMs);
    }
  }
}
