/**
 * Error model for the SFDC client (§2.1.7, §8.1). Every failure surfaced by
 * the transport is an `SfdcApiError` carrying the Salesforce `errorCode`
 * (when the body had one), the HTTP status and the §8.1 error class the
 * retry loop and the callers key off.
 */

/** §8.1 error classes as seen from the SFDC side. */
export type SfdcErrorClass =
  /** HTTP 429/5xx, REQUEST_LIMIT_EXCEEDED, SERVER_UNAVAILABLE, UNABLE_TO_LOCK_ROW, QUERY_TIMEOUT, socket errors. */
  | "retryable"
  /** 401 INVALID_SESSION_ID — re-auth once and replay. */
  | "session"
  /** INVALID_FIELD, MALFORMED_QUERY, INVALID_TYPE … — mapping bug, never retried. */
  | "structural"
  /** INSUFFICIENT_ACCESS*, OPERATION_NOT_ALLOWED, API_DISABLED_FOR_ORG. */
  | "permission"
  /** OAuth token exchange failures (`invalid_grant`, …) and unsupported flows. */
  | "auth"
  /** Local daily-API budget exhausted (§8.3 token bucket). */
  | "budget"
  /** Anything else — surfaced as-is, not retried. */
  | "fatal";

export interface SfdcErrorDetail {
  errorCode?: string;
  message: string;
  fields?: string[];
}

export interface SfdcApiErrorOptions {
  status?: number;
  errorCode?: string;
  errors?: SfdcErrorDetail[];
  method?: string;
  url?: string;
  /** `Retry-After` (ms) when the server sent one. */
  retryAfterMs?: number;
  /** Force a class instead of deriving it from status/code. */
  errorClass?: SfdcErrorClass;
  cause?: unknown;
}

/** Codes Salesforce documents as transient (§2.1.7, §8.1). */
export const RETRYABLE_CODES: ReadonlySet<string> = new Set([
  "REQUEST_LIMIT_EXCEEDED",
  "SERVER_UNAVAILABLE",
  "UNABLE_TO_LOCK_ROW",
  "QUERY_TIMEOUT",
  "SERVICE_UNAVAILABLE",
  "TOO_MANY_REQUESTS",
  "NETWORK_ERROR",
  "REQUEST_TIMEOUT",
]);

/** Structural = mapping bug: fatal for the unit, never retried (§8.1). */
export const STRUCTURAL_CODES: ReadonlySet<string> = new Set([
  "INVALID_FIELD",
  "MALFORMED_QUERY",
  "INVALID_TYPE",
  "INVALID_QUERY_FILTER_OPERATOR",
  "INVALID_QUERY_LOCATOR",
  "INVALID_FIELD_FOR_INSERT_UPDATE",
  "INVALID_OPERATION",
  "NOT_FOUND",
  "INVALID_ID_FIELD",
  "MALFORMED_ID",
  "INVALID_BATCH_SIZE",
  "INVALID_JOB",
  "INVALID_JOB_STATE",
  "BULK_JOB_FAILED",
  "BULK_JOB_ABORTED",
  "INVALID_REPLICATION_DATE",
  "REPLICATION_WINDOW_EXCEEDED",
]);

export const PERMISSION_CODES: ReadonlySet<string> = new Set([
  "INSUFFICIENT_ACCESS",
  "INSUFFICIENT_ACCESS_OR_READONLY",
  "INSUFFICIENT_ACCESS_ON_CROSS_REFERENCE_ENTITY",
  "OPERATION_NOT_ALLOWED",
  "API_DISABLED_FOR_ORG",
  "API_CURRENTLY_DISABLED",
  "FORBIDDEN",
]);

/** Derive the §8.1 class from HTTP status + Salesforce errorCode. */
export function classifySfdcError(
  status: number | undefined,
  errorCode: string | undefined,
): SfdcErrorClass {
  const code = errorCode?.toUpperCase();
  if (status === 401 || code === "INVALID_SESSION_ID") return "session";
  if (code && RETRYABLE_CODES.has(code)) return "retryable";
  if (status === 429) return "retryable";
  if (status !== undefined && status >= 500) return "retryable";
  if (code && STRUCTURAL_CODES.has(code)) return "structural";
  if (code && (PERMISSION_CODES.has(code) || code.startsWith("INSUFFICIENT_")))
    return "permission";
  if (status === 403) return "permission";
  return "fatal";
}

export class SfdcApiError extends Error {
  override readonly name: string = "SfdcApiError";
  readonly status: number | undefined;
  readonly errorCode: string;
  readonly errors: SfdcErrorDetail[];
  readonly method: string | undefined;
  readonly url: string | undefined;
  readonly retryAfterMs: number | undefined;
  readonly errorClass: SfdcErrorClass;

  constructor(message: string, opts: SfdcApiErrorOptions = {}) {
    super(
      message,
      opts.cause !== undefined ? { cause: opts.cause } : undefined,
    );
    this.status = opts.status;
    this.errorCode = opts.errorCode ?? "UNKNOWN";
    this.errors = opts.errors ?? [];
    this.method = opts.method;
    this.url = opts.url;
    this.retryAfterMs = opts.retryAfterMs;
    this.errorClass =
      opts.errorClass ?? classifySfdcError(opts.status, opts.errorCode);
  }

  get retryable(): boolean {
    return this.errorClass === "retryable";
  }
}

export function isSfdcApiError(e: unknown): e is SfdcApiError {
  return e instanceof SfdcApiError;
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
 * Wrap a `fetch` rejection (socket error, DNS failure, abort/timeout) into a
 * retryable `SfdcApiError`; pass `SfdcApiError`s through untouched.
 */
export function toSfdcError(
  e: unknown,
  ctx: { method?: string; url?: string } = {},
): SfdcApiError {
  if (isSfdcApiError(e)) return e;
  const code = errorCodeOf(e);
  const msg = e instanceof Error ? e.message : String(e);
  const isNetwork =
    (code !== undefined && NETWORK_CODES.has(code)) ||
    (e instanceof TypeError && /fetch failed/i.test(msg));
  if (isNetwork || e instanceof TypeError) {
    return new SfdcApiError(
      `Network error${code ? ` (${code})` : ""}: ${msg}`,
      {
        errorCode: code === "ABORT_ERR" ? "REQUEST_TIMEOUT" : "NETWORK_ERROR",
        errorClass: "retryable",
        cause: e,
        ...ctx,
      },
    );
  }
  return new SfdcApiError(msg, {
    errorCode: code ?? "UNKNOWN",
    errorClass: "fatal",
    cause: e,
    ...ctx,
  });
}

/**
 * Parse a Salesforce error body. REST returns `[{errorCode, message, fields?}]`;
 * OAuth returns `{error, error_description}`; Bulk 2.0 sometimes returns a
 * single object `{errorCode, message}`.
 */
export function parseErrorBody(body: unknown): SfdcErrorDetail[] {
  if (Array.isArray(body)) {
    return body
      .filter((x) => x && typeof x === "object")
      .map((x) => {
        const o = x as Record<string, unknown>;
        return {
          errorCode:
            typeof o.errorCode === "string"
              ? o.errorCode
              : typeof o.error === "string"
                ? o.error
                : undefined,
          message:
            typeof o.message === "string"
              ? o.message
              : typeof o.error_description === "string"
                ? o.error_description
                : JSON.stringify(o),
          fields: Array.isArray(o.fields)
            ? o.fields.filter((f): f is string => typeof f === "string")
            : undefined,
        };
      });
  }
  if (body && typeof body === "object") {
    const o = body as Record<string, unknown>;
    if (typeof o.errorCode === "string" || typeof o.error === "string") {
      return [
        {
          errorCode: (o.errorCode ?? o.error) as string,
          message:
            typeof o.message === "string"
              ? o.message
              : typeof o.error_description === "string"
                ? o.error_description
                : JSON.stringify(o),
        },
      ];
    }
  }
  if (typeof body === "string" && body.trim()) {
    return [{ message: body.slice(0, 500) }];
  }
  return [];
}
