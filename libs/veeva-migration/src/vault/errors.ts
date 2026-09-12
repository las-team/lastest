/**
 * Vault error model (§2.5.3, §8.1). HTTP is 200 even on FAILURE, so every
 * response is branched on `responseStatus`; the resulting `VaultApiError`
 * (contract type in `./types`) is extended here with the HTTP status, the
 * §8.1 error class and the request context the retry loop keys off.
 *
 * Error `type`s are matched with `startsWith` (§2.5.3) — Vault sometimes
 * suffixes them (`INSUFFICIENT_ACCESS_…`) — and unknown types are logged by
 * the transport.
 */
import {
  VaultApiError,
  type VaultError,
  type VaultResponseStatus,
} from "./types";

/** §8.1 classes as seen from the Vault side. */
export type VaultErrorClass =
  /** HTTP 429/503/5xx, `responseStatus: EXCEPTION`, API_LIMIT_EXCEEDED, SERVICE_UNAVAILABLE, RACE_CONDITION, socket errors. */
  | "retryable"
  /** INVALID_SESSION_ID — re-auth once (20/min guard) and replay once. */
  | "session"
  /** Outer FAILURE on a bulk call, INVALID_DATA, PARAMETER_REQUIRED, MALFORMED_URL … — mapping bug, never retried. */
  | "structural"
  /** INSUFFICIENT_ACCESS, OPERATION_NOT_ALLOWED, INACTIVE_USER. */
  | "permission"
  /** Anything else — surfaced as-is, not retried. */
  | "fatal";

/** Known error types (§2.5.3); multiply confirmed first, single-source after. */
export const KNOWN_VAULT_ERROR_TYPES: readonly string[] = [
  "INVALID_SESSION_ID",
  "API_LIMIT_EXCEEDED",
  "INSUFFICIENT_ACCESS",
  "INVALID_DATA",
  "PARAMETER_REQUIRED",
  "OPERATION_NOT_ALLOWED",
  "MALFORMED_URL",
  "METHOD_NOT_SUPPORTED",
  "INACTIVE_USER",
  "UNEXPECTED_ERROR",
  "ATTRIBUTE_NOT_SUPPORTED",
  "INVALID_FILTER",
  "RACE_CONDITION",
  // `[UNVERIFIED name]` (§2.5.2) — kept as a retryable default.
  "SERVICE_UNAVAILABLE",
];

const RETRYABLE_PREFIXES = [
  "API_LIMIT_EXCEEDED",
  "SERVICE_UNAVAILABLE",
  "RACE_CONDITION",
  "EXCEPTION",
  "NETWORK_ERROR",
  "REQUEST_TIMEOUT",
];
const PERMISSION_PREFIXES = [
  "INSUFFICIENT_ACCESS",
  "OPERATION_NOT_ALLOWED",
  "INACTIVE_USER",
];
const STRUCTURAL_PREFIXES = [
  "INVALID_DATA",
  "PARAMETER_REQUIRED",
  "MALFORMED_URL",
  "METHOD_NOT_SUPPORTED",
  "ATTRIBUTE_NOT_SUPPORTED",
  "INVALID_FILTER",
];

function matchesPrefix(type: string, prefixes: readonly string[]): boolean {
  return prefixes.some((p) => type.startsWith(p));
}

/** True when `type` is one of the §2.5.3 documented types (prefix match). */
export function isKnownVaultErrorType(type: string): boolean {
  return matchesPrefix(type.toUpperCase(), KNOWN_VAULT_ERROR_TYPES);
}

/** Derive the §8.1 class from the HTTP status, the `responseStatus` and the error `type`. */
export function classifyVaultError(
  type: string | undefined,
  httpStatus?: number,
  responseStatus?: VaultResponseStatus,
): VaultErrorClass {
  const t = (type ?? "").toUpperCase();
  if (t.startsWith("INVALID_SESSION_ID") || httpStatus === 401)
    return "session";
  if (httpStatus === 429 || httpStatus === 503) return "retryable";
  if (matchesPrefix(t, RETRYABLE_PREFIXES)) return "retryable";
  if (responseStatus === "EXCEPTION") return "retryable";
  if (httpStatus !== undefined && httpStatus >= 500) return "retryable";
  if (matchesPrefix(t, PERMISSION_PREFIXES) || httpStatus === 403)
    return "permission";
  if (matchesPrefix(t, STRUCTURAL_PREFIXES)) return "structural";
  if (httpStatus !== undefined && httpStatus >= 400 && httpStatus < 500)
    return "structural";
  return "fatal";
}

export interface VaultRequestErrorOptions {
  status?: VaultResponseStatus;
  errors?: VaultError[];
  httpStatus?: number;
  method?: string;
  url?: string;
  /** `Retry-After` (ms) when the server sent one. */
  retryAfterMs?: number;
  /** `X-VaultAPI-ExecutionId` of the failed response. */
  executionId?: string;
  /** Force a class instead of deriving it. */
  errorClass?: VaultErrorClass;
  cause?: unknown;
}

/**
 * `VaultApiError` + transport context. `instanceof VaultApiError` still
 * holds, so callers written against the contract type keep working.
 */
export class VaultRequestError extends VaultApiError {
  override readonly name: string = "VaultRequestError";
  readonly httpStatus: number | undefined;
  readonly method: string | undefined;
  readonly url: string | undefined;
  readonly retryAfterMs: number | undefined;
  readonly executionId: string | undefined;
  readonly errorClass: VaultErrorClass;

  constructor(
    type: string,
    message: string,
    opts: VaultRequestErrorOptions = {},
  ) {
    super(type, message, opts.status, opts.errors ?? []);
    if (opts.cause !== undefined)
      (this as { cause?: unknown }).cause = opts.cause;
    this.httpStatus = opts.httpStatus;
    this.method = opts.method;
    this.url = opts.url;
    this.retryAfterMs = opts.retryAfterMs;
    this.executionId = opts.executionId;
    this.errorClass =
      opts.errorClass ?? classifyVaultError(type, opts.httpStatus, opts.status);
  }

  get retryable(): boolean {
    return this.errorClass === "retryable";
  }
}

export function isVaultApiError(e: unknown): e is VaultApiError {
  return e instanceof VaultApiError;
}

/** Class of any error thrown by the client (plain `VaultApiError`s are classified by type). */
export function vaultErrorClass(e: unknown): VaultErrorClass {
  if (e instanceof VaultRequestError) return e.errorClass;
  if (e instanceof VaultApiError)
    return classifyVaultError(e.type, undefined, e.status);
  return toVaultError(e).errorClass;
}

/** Undici / Node network error codes that mean "try again". */
const NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENOTFOUND",
  "EPIPE",
  "ECONNABORTED",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_ABORTED",
  "ABORT_ERR",
]);

/** `TypeError` messages that mean a transport failure (no `code` attached). */
const NETWORK_MESSAGE = /fetch failed|network error|socket hang up|ECONN/i;

function errorCodeOf(e: unknown): string | undefined {
  if (!e || typeof e !== "object") return undefined;
  const o = e as { code?: unknown; cause?: unknown; name?: unknown };
  if (typeof o.code === "string") return o.code;
  if (o.cause && typeof o.cause === "object") {
    const c = (o.cause as { code?: unknown }).code;
    if (typeof c === "string") return c;
  }
  if (o.name === "AbortError" || o.name === "TimeoutError") return "ABORT_ERR";
  return undefined;
}

/**
 * Normalise anything thrown inside the transport into a `VaultRequestError`:
 * socket/DNS/abort failures become retryable `NETWORK_ERROR`/`REQUEST_TIMEOUT`;
 * plain `VaultApiError`s are re-wrapped keeping their type; everything else is
 * `fatal`.
 */
export function toVaultError(
  e: unknown,
  ctx: { method?: string; url?: string } = {},
): VaultRequestError {
  if (e instanceof VaultRequestError) return e;
  if (e instanceof VaultApiError)
    return new VaultRequestError(e.type, e.message.replace(/^[^:]+: /, ""), {
      status: e.status,
      errors: e.errors,
      cause: e,
      ...ctx,
    });
  const code = errorCodeOf(e);
  const msg = e instanceof Error ? e.message : String(e);
  // Undici signals transport failures as `TypeError('fetch failed')` with a
  // `cause.code`; a bare `TypeError` is a programming error, not a network
  // one, and must surface as fatal instead of being retried for minutes.
  const isNetwork =
    (code !== undefined && NETWORK_CODES.has(code)) ||
    (e instanceof TypeError && NETWORK_MESSAGE.test(msg));
  if (isNetwork) {
    return new VaultRequestError(
      code === "ABORT_ERR" ? "REQUEST_TIMEOUT" : "NETWORK_ERROR",
      `Network error${code ? ` (${code})` : ""}: ${msg}`,
      { errorClass: "retryable", cause: e, ...ctx },
    );
  }
  return new VaultRequestError("UNEXPECTED_ERROR", msg, {
    errorClass: "fatal",
    cause: e,
    ...ctx,
  });
}

/** Parse the `errors[]` of a §2.5.3 envelope defensively. */
export function parseVaultErrors(body: unknown): VaultError[] {
  if (!body || typeof body !== "object") return [];
  const raw = (body as { errors?: unknown }).errors;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x) => x && typeof x === "object")
    .map((x) => {
      const o = x as Record<string, unknown>;
      return {
        type: typeof o.type === "string" ? o.type : "UNKNOWN",
        message: typeof o.message === "string" ? o.message : JSON.stringify(o),
      };
    });
}
