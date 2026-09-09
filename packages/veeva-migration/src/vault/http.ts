/**
 * Vault HTTP transport (§2.5.1–2.5.3, §8.1, §8.3): a `fetch` wrapper that
 *
 *  - stamps `Authorization`, `X-VaultAPI-ClientID`, `X-VaultAPI-ReferenceId`;
 *  - parses the `X-VaultAPI-*` burst headers on every response and pauses
 *    until the 5-minute window rolls when `BurstLimitRemaining < burstFloor`;
 *  - warns on `X-VaultAPI-ResponseDelay > 0`;
 *  - honours `X-VaultAPI-DowntimeExpectedDurationMinutes` (pause announced
 *    minutes + 1, then re-authenticate);
 *  - branches on `responseStatus` (HTTP 200 with FAILURE → `VaultRequestError`);
 *  - classifies errors with `startsWith` (§2.5.3), re-authenticates once on
 *    `INVALID_SESSION_ID` and replays the request once, and retries
 *    retryable classes with full-jitter backoff (§8.1).
 *
 * All clocks are injectable so tests run instantly and hermetically.
 */
import { getLogger, type Logger } from "../logger";
import {
  isKnownVaultErrorType,
  parseVaultErrors,
  toVaultError,
  VaultRequestError,
} from "./errors";
import {
  defaultSleep,
  withVaultRetry,
  type RandomFn,
  type SleepFn,
  type VaultRetryPolicy,
} from "./retry";
import type { VaultBurstInfo, VaultResponseStatus } from "./types";

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type VaultHttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "OPTIONS";

export interface VaultHttpHooks {
  /** A response announced a scheduled downtime (§2.5.1). Called before the pause. */
  onDowntime?: (info: {
    minutes: number;
    pauseMs: number;
  }) => void | Promise<void>;
  /** The burst floor was hit and the transport is about to pause (§8.3). */
  onBurstPause?: (info: {
    remaining: number;
    floor: number;
    pauseMs: number;
  }) => void;
  onRetry?: (info: {
    err: VaultRequestError;
    attempt: number;
    delayMs: number;
  }) => void;
}

export interface VaultHttpOptions {
  vaultDns: string;
  apiVersion: string;
  /** `X-VaultAPI-ClientID` (≤ 100 chars, `[A-Za-z0-9_-]`). */
  clientId: string;
  /** Returns the `Authorization` header value (raw session id, or `Bearer …`). */
  authorization: () => string | undefined;
  /** Re-authenticate after INVALID_SESSION_ID / downtime; must replace what `authorization()` returns. */
  reauthenticate?: () => Promise<void>;
  fetch?: FetchLike;
  sleep?: SleepFn;
  random?: RandomFn;
  now?: () => number;
  /** Pause when `X-VaultAPI-BurstLimitRemaining` drops below this (default 200). */
  burstFloor?: number;
  /** Burst window length (fixed 5-min window, §2.5.2). */
  burstWindowMs?: number;
  retry?: Partial<VaultRetryPolicy>;
  /** Per-request timeout (default 120 s). */
  timeoutMs?: number;
  /** Cap for a downtime pause (default 4 h) — longer announcements throw. */
  maxDowntimePauseMs?: number;
  hooks?: VaultHttpHooks;
  logger?: Logger;
}

export interface VaultRequest {
  method: VaultHttpMethod;
  /**
   * Path relative to `/api/{version}` (with leading slash), an origin-relative
   * path when `absolute: true` (e.g. `/api/mdl/execute`, `next_page`), or a
   * full `https://` URL (OAuth session endpoint).
   */
  path: string;
  absolute?: boolean;
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string | undefined>;
  /**
   * Plain object/array → JSON; `URLSearchParams` → form; string/bytes →
   * sent as-is with `contentType`; `FormData` → multipart (boundary set by fetch).
   */
  body?: unknown;
  contentType?: string;
  accept?: string;
  /** `X-VaultAPI-ReferenceId: {run_id}:{object}:{batch}`. */
  referenceId?: string;
  /** Skip `Authorization` (auth endpoint). */
  noAuth?: boolean;
  /** Retry retryable classes (default true). */
  retry?: boolean;
  /** Replay once after re-auth on INVALID_SESSION_ID (default true unless `noAuth`). */
  replayOnSessionError?: boolean;
  /** Return the raw text body instead of parsed JSON. */
  raw?: boolean;
  /** Also return (instead of throwing) when the envelope is FAILURE/EXCEPTION. Used by probes. */
  allowFailure?: boolean;
  timeoutMs?: number;
}

export interface VaultHttpResponse<T = unknown> {
  httpStatus: number;
  headers: Headers;
  body: T;
  burst: VaultBurstInfo;
  url: string;
  /** Envelope status when the body was a JSON envelope. */
  responseStatus?: VaultResponseStatus;
}

/** Envelope subset (§2.5.3). */
export interface VaultEnvelope {
  responseStatus?: VaultResponseStatus;
  responseMessage?: string;
  errors?: Array<{ type: string; message: string }>;
  warnings?: Array<{ type: string; message: string }>;
  [k: string]: unknown;
}

const BURST_WINDOW_MS = 5 * 60_000;

function headerNumber(headers: Headers, name: string): number | undefined {
  const v = headers.get(name);
  if (v === null || v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Parse the `X-VaultAPI-*` counters of one response (§2.5.2). */
export function parseBurstHeaders(
  headers: Headers,
  observedAt: number,
): VaultBurstInfo {
  const info: VaultBurstInfo = {
    observedAt: new Date(observedAt).toISOString(),
  };
  const limit = headerNumber(headers, "X-VaultAPI-BurstLimit");
  const remaining = headerNumber(headers, "X-VaultAPI-BurstLimitRemaining");
  const delay = headerNumber(headers, "X-VaultAPI-ResponseDelay");
  const downtime = headerNumber(
    headers,
    "X-VaultAPI-DowntimeExpectedDurationMinutes",
  );
  const exec = headers.get("X-VaultAPI-ExecutionId");
  if (limit !== undefined) info.burstLimit = limit;
  if (remaining !== undefined) info.burstLimitRemaining = remaining;
  if (delay !== undefined) info.responseDelayMs = delay;
  if (downtime !== undefined) info.downtimeExpectedMinutes = downtime;
  if (exec) info.executionId = exec;
  return info;
}

function parseRetryAfterMs(headers: Headers, now: number): number | undefined {
  const v = headers.get("Retry-After");
  if (!v) return undefined;
  const secs = Number(v);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(v);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

function isJsonContentType(headers: Headers): boolean {
  const ct = headers.get("content-type") ?? "";
  return /json/i.test(ct);
}

function redactedUrl(url: string): string {
  return url.replace(
    /([?&](?:password|token|sessionId)=)[^&]*/gi,
    "$1[redacted]",
  );
}

/**
 * Stateful transport bound to one vault. Construct once per client; every
 * request goes through `request()`.
 */
export class VaultHttp {
  private readonly fetchImpl: FetchLike;
  private readonly sleep: SleepFn;
  private readonly random: RandomFn;
  private readonly now: () => number;
  private readonly burstFloor: number;
  private readonly burstWindowMs: number;
  private readonly timeoutMs: number;
  private readonly maxDowntimePauseMs: number;
  private readonly log: Logger;
  private readonly hooks: VaultHttpHooks;
  private readonly retryPolicy: Partial<VaultRetryPolicy>;

  /** Counters from the most recent response (§2.5.2). */
  burst: VaultBurstInfo = {};
  /** Effective API version (may change through the §2.5.1 fallback). */
  apiVersion: string;
  /** Default `X-VaultAPI-ReferenceId` when a request carries none. */
  defaultReferenceId: string | undefined;

  private pauseUntil = 0;
  private reauthAfterPause = false;
  /** Number of burst pauses taken (tests / audit). */
  burstPauses = 0;
  downtimePauses = 0;

  constructor(private readonly opts: VaultHttpOptions) {
    this.fetchImpl =
      opts.fetch ??
      ((input, init) => globalThis.fetch(input, init) as Promise<Response>);
    this.sleep = opts.sleep ?? defaultSleep;
    this.random = opts.random ?? Math.random;
    this.now = opts.now ?? Date.now;
    this.burstFloor = opts.burstFloor ?? 200;
    this.burstWindowMs = opts.burstWindowMs ?? BURST_WINDOW_MS;
    this.timeoutMs = opts.timeoutMs ?? 120_000;
    this.maxDowntimePauseMs = opts.maxDowntimePauseMs ?? 4 * 3_600_000;
    this.hooks = opts.hooks ?? {};
    this.retryPolicy = opts.retry ?? {};
    this.apiVersion = opts.apiVersion;
    this.log = opts.logger ?? getLogger("Vault", { vault_dns: opts.vaultDns });
  }

  get vaultDns(): string {
    return this.opts.vaultDns;
  }

  get origin(): string {
    return `https://${this.opts.vaultDns}`;
  }

  /** Resolve a `VaultRequest` path to a full URL (with query string). */
  resolveUrl(req: Pick<VaultRequest, "path" | "absolute" | "query">): string {
    let url: string;
    if (/^https?:\/\//i.test(req.path)) url = req.path;
    else if (req.absolute) url = `${this.origin}${req.path}`;
    else url = `${this.origin}/api/${this.apiVersion}${req.path}`;
    if (req.query) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(req.query))
        if (v !== undefined) qs.set(k, String(v));
      const s = qs.toString();
      if (s) url += (url.includes("?") ? "&" : "?") + s;
    }
    return url;
  }

  /** Send one request with pause/retry/session-replay semantics. */
  async request<T = VaultEnvelope>(
    req: VaultRequest,
  ): Promise<VaultHttpResponse<T>> {
    if (!req.noAuth && !this.opts.authorization())
      throw new VaultRequestError(
        "INVALID_SESSION_ID",
        "No Vault session — call authenticate() first",
        {
          errorClass: "session",
          method: req.method,
          url: this.resolveUrl(req),
        },
      );
    const send = async () => {
      await this.beforeSend();
      return this.sendWithSessionReplay<T>(req);
    };
    if (req.retry === false) return send();
    return withVaultRetry(send, {
      policy: this.retryPolicy,
      sleep: this.sleep,
      random: this.random,
      onRetry: (info) => {
        this.log.warn(
          {
            error_type: info.err.type,
            attempt: info.attempt,
            delay_ms: info.delayMs,
            http_status: info.err.httpStatus,
            vault_execution_id: info.err.executionId,
          },
          "retrying Vault call",
        );
        this.hooks.onRetry?.(info);
      },
    });
  }

  /** Convenience: `request()` and return the parsed body only. */
  async json<T = VaultEnvelope>(req: VaultRequest): Promise<T> {
    return (await this.request<T>(req)).body;
  }

  // -- pauses ---------------------------------------------------------------

  private async beforeSend(): Promise<void> {
    const now = this.now();
    if (this.pauseUntil > now) {
      await this.sleep(this.pauseUntil - now);
      this.pauseUntil = 0;
      if (this.reauthAfterPause) {
        this.reauthAfterPause = false;
        await this.opts.reauthenticate?.();
      }
    }
    const remaining = this.burst.burstLimitRemaining;
    if (remaining !== undefined && remaining < this.burstFloor) {
      const t = this.now();
      const pauseMs = this.burstWindowMs - (t % this.burstWindowMs) + 1_000;
      this.burstPauses++;
      this.log.warn(
        {
          code: "VT_BURST_PAUSE",
          burst_remaining: remaining,
          burst_floor: this.burstFloor,
          pause_ms: pauseMs,
        },
        "burst floor reached — pausing until the window rolls",
      );
      this.hooks.onBurstPause?.({ remaining, floor: this.burstFloor, pauseMs });
      await this.sleep(pauseMs);
      // Forget the stale counter; the next response refreshes it.
      this.burst = { ...this.burst, burstLimitRemaining: undefined };
    }
  }

  private noteResponseHeaders(headers: Headers): VaultBurstInfo {
    const now = this.now();
    const burst = parseBurstHeaders(headers, now);
    this.burst = burst;
    if (burst.responseDelayMs !== undefined && burst.responseDelayMs > 0) {
      this.log.warn(
        {
          code: "VT_RESPONSE_DELAY",
          response_delay_ms: burst.responseDelayMs,
          burst_remaining: burst.burstLimitRemaining,
          vault_execution_id: burst.executionId,
        },
        "Vault applied throttling delay",
      );
    }
    if (
      burst.downtimeExpectedMinutes !== undefined &&
      burst.downtimeExpectedMinutes > 0
    ) {
      const pauseMs = (burst.downtimeExpectedMinutes + 1) * 60_000;
      if (pauseMs > this.maxDowntimePauseMs)
        throw new VaultRequestError(
          "DOWNTIME_TOO_LONG",
          `Vault announced ${burst.downtimeExpectedMinutes} min of downtime, above the ${Math.round(this.maxDowntimePauseMs / 60_000)} min pause cap`,
          { errorClass: "fatal" },
        );
      this.pauseUntil = Math.max(this.pauseUntil, now + pauseMs);
      this.reauthAfterPause = true;
      this.downtimePauses++;
      this.log.info(
        {
          code: "VT_DOWNTIME_PAUSE",
          downtime_minutes: burst.downtimeExpectedMinutes,
          pause_ms: pauseMs,
        },
        "Vault announced scheduled downtime — pausing after the in-flight call",
      );
      void this.hooks.onDowntime?.({
        minutes: burst.downtimeExpectedMinutes,
        pauseMs,
      });
    }
    return burst;
  }

  // -- session replay -------------------------------------------------------

  private async sendWithSessionReplay<T>(
    req: VaultRequest,
  ): Promise<VaultHttpResponse<T>> {
    try {
      return await this.sendOnce<T>(req);
    } catch (raw) {
      const err = toVaultError(raw);
      const replay = req.replayOnSessionError ?? !req.noAuth;
      if (err.errorClass === "session" && replay && this.opts.reauthenticate) {
        this.log.warn(
          { error_type: err.type, url: redactedUrl(err.url ?? "") },
          "session invalid — re-authenticating and replaying once",
        );
        await this.opts.reauthenticate();
        return this.sendOnce<T>(req);
      }
      throw err;
    }
  }

  // -- single send ----------------------------------------------------------

  private buildInit(req: VaultRequest, url: string): RequestInit {
    const headers: Record<string, string> = {
      Accept: req.accept ?? "application/json",
      "X-VaultAPI-ClientID": this.opts.clientId,
    };
    if (!req.noAuth) {
      const auth = this.opts.authorization();
      if (!auth)
        throw new VaultRequestError(
          "INVALID_SESSION_ID",
          "No Vault session — call authenticate() first",
          { errorClass: "session", method: req.method, url },
        );
      headers.Authorization = auth;
    }
    const ref = req.referenceId ?? this.defaultReferenceId;
    if (ref) headers["X-VaultAPI-ReferenceId"] = ref;
    for (const [k, v] of Object.entries(req.headers ?? {}))
      if (v !== undefined) headers[k] = v;

    let body: BodyInit | undefined;
    const b = req.body;
    if (b === undefined || b === null) body = undefined;
    else if (b instanceof URLSearchParams) {
      body = b.toString();
      headers["Content-Type"] =
        req.contentType ?? "application/x-www-form-urlencoded";
    } else if (typeof FormData !== "undefined" && b instanceof FormData) {
      body = b; // fetch sets the multipart boundary
    } else if (typeof b === "string") {
      body = b;
      headers["Content-Type"] = req.contentType ?? "text/plain";
    } else if (b instanceof Uint8Array) {
      body = b as Uint8Array<ArrayBuffer>;
      headers["Content-Type"] = req.contentType ?? "application/octet-stream";
    } else {
      body = JSON.stringify(b);
      headers["Content-Type"] = req.contentType ?? "application/json";
    }
    const init: RequestInit = { method: req.method, headers, body };
    const timeout = req.timeoutMs ?? this.timeoutMs;
    if (timeout > 0 && typeof AbortSignal?.timeout === "function")
      init.signal = AbortSignal.timeout(timeout);
    return init;
  }

  private async sendOnce<T>(req: VaultRequest): Promise<VaultHttpResponse<T>> {
    const url = this.resolveUrl(req);
    const init = this.buildInit(req, url);
    const started = this.now();
    let res: Response;
    try {
      res = await this.fetchImpl(url, init);
    } catch (e) {
      throw toVaultError(e, { method: req.method, url: redactedUrl(url) });
    }
    const burst = this.noteResponseHeaders(res.headers);
    const httpStatus = res.status;
    let text = "";
    try {
      text = await res.text();
    } catch {
      text = "";
    }
    const json = isJsonContentType(res.headers) || /^\s*[[{]/.test(text);
    let parsed: unknown = text;
    if (json && text.trim()) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    const envelope =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as VaultEnvelope)
        : undefined;
    const responseStatus = envelope?.responseStatus;
    const errors = parseVaultErrors(envelope);
    const primary = errors[0];
    const ctx = {
      method: req.method,
      url: redactedUrl(url),
      httpStatus,
      executionId: burst.executionId,
      retryAfterMs: parseRetryAfterMs(res.headers, this.now()),
      errors,
    };

    this.log.debug(
      {
        method: req.method,
        url: redactedUrl(url),
        http_status: httpStatus,
        response_status: responseStatus,
        elapsed_ms: this.now() - started,
        burst_remaining: burst.burstLimitRemaining,
        vault_execution_id: burst.executionId,
      },
      "vault call",
    );

    const failed =
      responseStatus === "FAILURE" || responseStatus === "EXCEPTION";
    if (failed && !req.allowFailure) {
      const type =
        primary?.type ??
        (responseStatus === "EXCEPTION" ? "EXCEPTION" : "FAILURE");
      const message =
        primary?.message ??
        envelope?.responseMessage ??
        `Vault returned ${responseStatus}`;
      if (!isKnownVaultErrorType(type))
        this.log.warn(
          { error_type: type, http_status: httpStatus },
          "unknown Vault error type",
        );
      throw new VaultRequestError(type, message, {
        status: responseStatus,
        ...ctx,
      });
    }
    if (httpStatus >= 400 && !(failed && req.allowFailure)) {
      const type =
        primary?.type ??
        (httpStatus === 401
          ? "INVALID_SESSION_ID"
          : httpStatus === 429 || httpStatus === 503
            ? "SERVICE_UNAVAILABLE"
            : httpStatus === 404
              ? "MALFORMED_URL"
              : "UNEXPECTED_ERROR");
      const message =
        primary?.message ??
        envelope?.responseMessage ??
        `HTTP ${httpStatus}${text ? `: ${text.slice(0, 300)}` : ""}`;
      throw new VaultRequestError(type, message, {
        status: responseStatus,
        ...ctx,
      });
    }
    if (responseStatus === "WARNING" && envelope?.warnings?.length)
      this.log.debug(
        { warnings: envelope.warnings.map((w) => w.type) },
        "Vault warning",
      );

    return {
      httpStatus,
      headers: res.headers,
      body: (req.raw ? text : parsed) as T,
      burst,
      url,
      responseStatus,
    };
  }
}
