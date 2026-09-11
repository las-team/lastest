/**
 * Minimal Vault REST client on native `fetch`.
 *
 * Endpoint paths follow `docs/research/05-verified-endpoints.md` (VAPIL
 * `v26.2`): everything is relative to `https://{vaultDns}/api/{version}`.
 *
 * - auth: pre-issued session id, or `POST /auth` (form `username`, `password`,
 *   `vaultDNS`) → `sessionId`
 * - every call sends `Authorization: {sessionId}` (no `Bearer`) and
 *   `Accept: application/json`
 * - the Vault envelope `{ responseStatus, errors[] }` is checked on every
 *   response; anything but `SUCCESS` throws {@link VaultApiError}
 * - MDL: `POST /mdl/execute` (raw `text/plain` body); async jobs are polled at
 *   `GET /mdl/execute_async/{job_id}/results` with an injectable `sleep`
 * - burst limit: when `X-VaultAPI-BurstLimitRemaining` drops below a floor the
 *   client pauses before the next call; a 429 is retried once after the pause
 */
import type { VaultApiCall } from "../model/types";

export type VaultAuth =
  | { kind: "session"; vaultDns: string; sessionId: string }
  | { kind: "password"; vaultDns: string; username: string; password: string };

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export const DEFAULT_VAULT_API_VERSION = "v26.2";
export const DEFAULT_CLIENT_ID = "lastest-veeva-crm-migration";

export interface VaultError {
  type: string;
  message: string;
}

export interface VaultResponse {
  responseStatus: "SUCCESS" | "FAILURE" | "EXCEPTION";
  responseMessage?: string;
  errors?: VaultError[];
  [key: string]: unknown;
}

export interface MdlStatementExecution {
  vault?: string | number;
  statement?: string;
  response?: string;
  message?: string;
  warnings?: unknown[];
  failures?: unknown[];
  exceptions?: unknown[];
  components_affected?: unknown[];
  execution_time?: number;
  [key: string]: unknown;
}

export interface MdlResult extends VaultResponse {
  statement_execution?: MdlStatementExecution[];
  job_id?: string | number;
  url?: string;
  job_status?: string;
  /** How the script was executed: synchronously, or via a polled async job. */
  mode?: "sync" | "async";
}

export interface VaultObjectField {
  name: string;
  label?: string;
  type?: string;
  [key: string]: unknown;
}

export interface VaultObjectType {
  name: string;
  label?: string;
  [key: string]: unknown;
}

export interface VaultObjectMetadata {
  name: string;
  label?: string;
  fields?: VaultObjectField[];
  object_types?: VaultObjectType[];
  [key: string]: unknown;
}

export interface VaultObjectSummary {
  name: string;
  label?: string;
  url?: string;
  status?: string[] | string;
  [key: string]: unknown;
}

export interface VaultPageLayoutSummary {
  name: string;
  label?: string;
  url?: string;
  [key: string]: unknown;
}

export interface VaultClientOptions {
  fetch?: FetchLike;
  log?: (message: string) => void;
  /** `v26.2` (default) or `26.2`. */
  apiVersion?: string;
  /** Injectable pause used for burst-limit back-off and job polling. */
  sleep?: (ms: number) => Promise<void>;
  /** Pause when `X-VaultAPI-BurstLimitRemaining` is below this (default 20). */
  burstLimitFloor?: number;
  /** How long to pause when the burst limit is low (default 60 s). */
  burstPauseMs?: number;
  /** Interval between async MDL job polls (default 2 s). */
  pollIntervalMs?: number;
  /** Give up polling an async MDL job after this many polls (default 150). */
  maxPolls?: number;
  /** Sent as `X-VaultAPI-ClientID`. */
  clientId?: string;
}

/** A `VaultApiCall` whose JSON body may also be an array (bulk object-record create). */
export interface VaultRequest extends Omit<VaultApiCall, "body"> {
  body?: Record<string, unknown> | readonly unknown[];
}

export interface VaultClient {
  readonly vaultDns: string;
  readonly apiVersion: string;
  /** Calls made so far, including the auth call. */
  readonly requestCount: number;
  /** Last `X-VaultAPI-BurstLimitRemaining` seen, if any. */
  readonly burstLimitRemaining?: number;
  /** One call; `path` is relative to `/api/{version}` unless absolute. */
  request<T = VaultResponse>(call: VaultRequest): Promise<T>;
  /** Executes an MDL script (`POST /mdl/execute`), polling async jobs to completion. */
  executeMdl(script: string, opts?: { async?: boolean }): Promise<MdlResult>;
  /** `GET /metadata/vobjects/{name}` → the object definition. */
  getObjectMetadata(name: string): Promise<VaultObjectMetadata>;
  /** `GET /metadata/vobjects`. */
  listObjects(): Promise<VaultObjectSummary[]>;
  /** `GET /metadata/vobjects/{object}/page_layouts`. */
  getPageLayouts(object: string): Promise<VaultPageLayoutSummary[]>;
  /** VQL query (`POST /query`, form `q`), following `responseDetails.next_page`. */
  query<T = Record<string, unknown>>(vql: string): Promise<T[]>;
}

export class VaultApiError extends Error {
  readonly status: number;
  readonly errors: VaultError[];
  readonly body: unknown;
  readonly method: string;
  readonly path: string;

  constructor(
    message: string,
    details: {
      status: number;
      errors?: VaultError[];
      body?: unknown;
      method: string;
      path: string;
    },
  ) {
    super(message);
    this.name = "VaultApiError";
    this.status = details.status;
    this.errors = details.errors ?? [];
    this.body = details.body;
    this.method = details.method;
    this.path = details.path;
  }

  /** True when any error has the given type (e.g. `INVALID_DATA`). */
  hasType(type: string): boolean {
    return this.errors.some((e) => e.type === type);
  }
}

export function normalizeVaultApiVersion(version: string | undefined): string {
  if (!version) return DEFAULT_VAULT_API_VERSION;
  const v = version.trim();
  if (!v) return DEFAULT_VAULT_API_VERSION;
  return /^v/i.test(v) ? `v${v.slice(1)}` : `v${v}`;
}

/** Trims `https://` and trailing slashes so a DNS or a URL both work. */
export function normalizeVaultDns(dns: string): string {
  return dns
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
}

const PENDING_JOB =
  /queued|running|scheduled|pending|in.?progress|not.*(complete|finish)/i;

/** True when an MDL execute / results body says the async job is still running. */
export function isMdlJobPending(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  const status = b.job_status ?? b.status;
  if (typeof status === "string") return PENDING_JOB.test(status);
  return (
    b.job_id !== undefined &&
    b.statement_execution === undefined &&
    b.errors === undefined
  );
}

function asVaultErrors(value: unknown): VaultError[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
    .map((e) => ({
      type: typeof e.type === "string" ? e.type : "UNKNOWN",
      message: typeof e.message === "string" ? e.message : JSON.stringify(e),
    }));
}

function summarizeErrors(errors: VaultError[], fallback: string): string {
  if (!errors.length) return fallback;
  return errors.map((e) => `${e.type}: ${e.message}`).join("; ");
}

function encodeForm(body: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined || v === null) continue;
    params.set(k, typeof v === "string" ? v : JSON.stringify(v));
  }
  return params.toString();
}

export async function createVaultClient(
  auth: VaultAuth,
  options: VaultClientOptions = {},
): Promise<VaultClient> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (!fetchImpl) throw new Error("no fetch implementation available");
  const log = options.log ?? (() => {});
  const sleep =
    options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const burstFloor = options.burstLimitFloor ?? 20;
  const burstPauseMs = options.burstPauseMs ?? 60_000;
  const pollIntervalMs = options.pollIntervalMs ?? 2_000;
  const maxPolls = options.maxPolls ?? 150;
  const clientId = options.clientId ?? DEFAULT_CLIENT_ID;
  const vaultDns = normalizeVaultDns(auth.vaultDns);
  const apiVersion = normalizeVaultApiVersion(options.apiVersion);
  const base = `https://${vaultDns}/api/${apiVersion}`;

  let sessionId: string | undefined;
  let requestCount = 0;
  let burstLimitRemaining: number | undefined;

  const resolveUrl = (path: string): string => {
    if (/^https?:\/\//i.test(path)) return path;
    if (path.startsWith("/api/")) return `https://${vaultDns}${path}`;
    return `${base}${path.startsWith("/") ? path : `/${path}`}`;
  };

  const readBody = async (
    res: Response,
  ): Promise<{ text: string; json: unknown | undefined }> => {
    const text = await res.text();
    if (!text) return { text, json: undefined };
    try {
      return { text, json: JSON.parse(text) as unknown };
    } catch {
      return { text, json: undefined };
    }
  };

  const noteHeaders = (res: Response): void => {
    const remaining = res.headers.get("X-VaultAPI-BurstLimitRemaining");
    if (remaining !== null && remaining !== "") {
      const n = Number(remaining);
      if (Number.isFinite(n)) burstLimitRemaining = n;
    }
    const delay = res.headers.get("X-VaultAPI-ResponseDelay");
    if (delay && Number(delay) > 0)
      log(`vault throttled the response by ${delay} ms`);
  };

  const pauseIfBurstLow = async (): Promise<void> => {
    if (burstLimitRemaining !== undefined && burstLimitRemaining < burstFloor) {
      log(
        `vault burst limit low (${burstLimitRemaining} remaining): pausing ${burstPauseMs} ms`,
      );
      await sleep(burstPauseMs);
      burstLimitRemaining = undefined;
    }
  };

  /** Raw call: builds headers, encodes the body, checks the envelope. */
  const raw = async <T>(
    method: string,
    path: string,
    init: {
      body?: string;
      contentType?: string;
      auth?: boolean;
      retried?: boolean;
    } = {},
  ): Promise<{ data: T; status: number }> => {
    await pauseIfBurstLow();
    const headers: Record<string, string> = {
      Accept: "application/json",
      "X-VaultAPI-ClientID": clientId,
    };
    if (init.auth !== false && sessionId) headers.Authorization = sessionId;
    if (init.contentType) headers["Content-Type"] = init.contentType;
    requestCount++;
    const res = await fetchImpl(resolveUrl(path), {
      method,
      headers,
      body: init.body,
    });
    noteHeaders(res);
    if (res.status === 429 && !init.retried) {
      log(
        `vault returned 429 for ${method} ${path}: pausing ${burstPauseMs} ms`,
      );
      await sleep(burstPauseMs);
      return raw<T>(method, path, { ...init, retried: true });
    }
    const { text, json } = await readBody(res);
    const envelope =
      json && typeof json === "object"
        ? (json as Partial<VaultResponse>)
        : undefined;
    if (envelope && typeof envelope.responseStatus === "string") {
      if (envelope.responseStatus !== "SUCCESS") {
        const errors = asVaultErrors(envelope.errors);
        throw new VaultApiError(
          `${method} ${path} → ${envelope.responseStatus}: ${summarizeErrors(
            errors,
            typeof envelope.responseMessage === "string"
              ? envelope.responseMessage
              : `HTTP ${res.status}`,
          )}`,
          { status: res.status, errors, body: json, method, path },
        );
      }
      return { data: json as T, status: res.status };
    }
    if (!res.ok) {
      throw new VaultApiError(
        `${method} ${path} → HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`,
        { status: res.status, body: json ?? text, method, path },
      );
    }
    return { data: (json ?? text) as T, status: res.status };
  };

  const request = async <T = VaultResponse>(call: VaultRequest): Promise<T> => {
    let body: string | undefined;
    let contentType: string | undefined;
    if (call.body !== undefined) {
      contentType = call.contentType ?? "application/json";
      if (contentType === "application/x-www-form-urlencoded") {
        if (Array.isArray(call.body))
          throw new Error(
            `${call.method} ${call.path}: a form-encoded body must be an object`,
          );
        body = encodeForm(call.body as Record<string, unknown>);
      } else body = JSON.stringify(call.body);
    }
    const { data } = await raw<T>(call.method, call.path, {
      body,
      contentType,
    });
    return data;
  };

  // --- authentication -----------------------------------------------------
  if (auth.kind === "session") {
    sessionId = auth.sessionId;
  } else {
    const form = new URLSearchParams({
      username: auth.username,
      password: auth.password,
      vaultDNS: vaultDns,
    });
    const { data } = await raw<VaultResponse & { sessionId?: string }>(
      "POST",
      "/auth",
      {
        body: form.toString(),
        contentType: "application/x-www-form-urlencoded",
        auth: false,
      },
    );
    if (typeof data.sessionId !== "string" || !data.sessionId) {
      throw new VaultApiError("POST /auth returned no sessionId", {
        status: 200,
        body: data,
        method: "POST",
        path: "/auth",
      });
    }
    sessionId = data.sessionId;
    log(`authenticated against ${vaultDns} (${apiVersion})`);
  }

  // --- MDL ------------------------------------------------------------------
  const pollJob = async (jobId: string): Promise<MdlResult> => {
    const path = `/mdl/execute_async/${encodeURIComponent(jobId)}/results`;
    for (let i = 0; i < maxPolls; i++) {
      await sleep(pollIntervalMs);
      let body: MdlResult;
      try {
        body = (await raw<MdlResult>("GET", path)).data;
      } catch (err) {
        if (
          err instanceof VaultApiError &&
          err.errors.some((e) => PENDING_JOB.test(`${e.type} ${e.message}`))
        )
          continue;
        throw err;
      }
      if (!isMdlJobPending(body)) return { ...body, mode: "async" };
    }
    throw new VaultApiError(
      `MDL job ${jobId} did not finish after ${maxPolls} polls`,
      { status: 0, method: "GET", path },
    );
  };

  const executeMdl = async (
    script: string,
    opts: { async?: boolean } = {},
  ): Promise<MdlResult> => {
    const path = opts.async ? "/mdl/execute_async" : "/mdl/execute";
    const { data } = await raw<MdlResult>("POST", path, {
      body: script,
      contentType: "text/plain",
    });
    const jobId =
      data.job_id ??
      (typeof data.url === "string"
        ? /execute_async\/([^/]+)/.exec(data.url)?.[1]
        : undefined);
    if (jobId !== undefined && jobId !== null && isMdlJobPending(data)) {
      log(`MDL script queued as job ${jobId}; polling`);
      return pollJob(String(jobId));
    }
    return { ...data, mode: "sync" };
  };

  // --- metadata helpers -----------------------------------------------------
  const getObjectMetadata = async (
    name: string,
  ): Promise<VaultObjectMetadata> => {
    const res = await request<VaultResponse & { object?: VaultObjectMetadata }>(
      { method: "GET", path: `/metadata/vobjects/${encodeURIComponent(name)}` },
    );
    if (!res.object || typeof res.object !== "object")
      throw new VaultApiError(`object ${name}: response carries no "object"`, {
        status: 200,
        body: res,
        method: "GET",
        path: `/metadata/vobjects/${name}`,
      });
    return res.object;
  };

  const listObjects = async (): Promise<VaultObjectSummary[]> => {
    const res = await request<
      VaultResponse & { objects?: VaultObjectSummary[] }
    >({ method: "GET", path: "/metadata/vobjects" });
    return Array.isArray(res.objects) ? res.objects : [];
  };

  const getPageLayouts = async (
    object: string,
  ): Promise<VaultPageLayoutSummary[]> => {
    const res = await request<
      VaultResponse & {
        data?: VaultPageLayoutSummary[];
        page_layouts?: VaultPageLayoutSummary[];
        layouts?: VaultPageLayoutSummary[];
      }
    >({
      method: "GET",
      path: `/metadata/vobjects/${encodeURIComponent(object)}/page_layouts`,
    });
    const list = res.data ?? res.page_layouts ?? res.layouts;
    return Array.isArray(list) ? list : [];
  };

  const query = async <T = Record<string, unknown>>(
    vql: string,
  ): Promise<T[]> => {
    const rows: T[] = [];
    let res = await request<
      VaultResponse & { data?: T[]; responseDetails?: { next_page?: string } }
    >({
      method: "POST",
      path: "/query",
      body: { q: vql },
      contentType: "application/x-www-form-urlencoded",
    });
    for (let guard = 0; guard < 10_000; guard++) {
      if (Array.isArray(res.data)) rows.push(...res.data);
      const next = res.responseDetails?.next_page;
      if (!next) break;
      res = (await raw<typeof res>("GET", next)).data;
    }
    return rows;
  };

  return {
    vaultDns,
    apiVersion,
    get requestCount() {
      return requestCount;
    },
    get burstLimitRemaining() {
      return burstLimitRemaining;
    },
    request,
    executeMdl,
    getObjectMetadata,
    listObjects,
    getPageLayouts,
    query,
  };
}
