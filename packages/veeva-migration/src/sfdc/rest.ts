/**
 * Salesforce REST transport and endpoints (§2.1.2–§2.1.4, §2.1.6, §2.1.7,
 * §8.1, §8.3).
 *
 * `SfdcTransport` is the single HTTP path: every call goes through the
 * daily-API token bucket, the REST worker semaphore, the §8.1 retry loop
 * (full-jitter backoff), one re-auth + replay on `401 INVALID_SESSION_ID`,
 * `Sforce-Limit-Info` parsing and `Date`-header capture (§4.1 `sfdc_now`).
 *
 * `SfdcRest` layers the REST endpoints on top: SOQL paging via
 * `nextRecordsUrl`, `Id IN (…)` chunking (≤ 400), `/composite/sobjects`
 * retrieval (≤ 2 000), describe caching with `If-Modified-Since`, delete /
 * update feeds with the 30-day window and `replicateable` guards, limits,
 * explain and the API version list.
 */
import { getLogger } from "../logger";
import { to18 } from "../transform/ids";
import type {
  SfdcGlobalDescribeEntry,
  SfdcObjectDescribe,
  SfdcRecordType,
  SourceRow,
} from "../types";
import type { FetchFn, SfdcAuthenticator } from "./auth";
import { SfdcApiError, parseErrorBody, toSfdcError } from "./errors";
import { ApiBudget, Semaphore } from "./limits";
import { withRetry, type RetryOptions } from "./retry";
import {
  COMPOSITE_MAX_IDS,
  SOQL_IN_MAX_IDS,
  assertFieldPath,
  assertObjectName,
  buildCount,
  buildSelect,
  chunkValues,
  fieldList,
  inClauses,
} from "./soql";
import type {
  SfdcDeletedResult,
  SfdcLimits,
  SfdcQueryOptions,
  SfdcQueryPlan,
  SfdcUpdatedResult,
} from "./types";

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface SfdcRequest {
  method: HttpMethod;
  /**
   * `/sobjects/...` → relative to `/services/data/v{apiVersion}`;
   * `/services/...` → relative to the instance URL; `https://…` → absolute.
   */
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  /** JSON body (serialised) unless `rawBody` is given. */
  body?: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
  /** Response decoding: `json` (default) or `text` (CSV results). */
  accept?: "json" | "text";
  /** `bulk` bypasses the REST worker semaphore (Bulk jobs have their own cap). */
  lane?: "rest" | "bulk";
  /** Default true; the unversioned `/services/data/` listing is free. */
  countsAgainstBudget?: boolean;
  /** Per-request timeout override (ms). */
  timeoutMs?: number;
  /** Treat 304 as success with a `null` body (describe cache). */
  allow304?: boolean;
  signal?: AbortSignal;
}

export interface SfdcResponse<T = unknown> {
  status: number;
  headers: Headers;
  body: T;
}

export interface SfdcTransportOptions {
  auth: SfdcAuthenticator;
  apiVersion: string;
  fetch?: FetchFn;
  budget?: ApiBudget;
  /** `performance.sfdcRestConcurrency` (default 2). */
  restConcurrency?: number;
  retry?: Pick<RetryOptions, "policy" | "sleep" | "random">;
  /** Per-request timeout, default 600 000 ms (§2.1.7: 10 min). */
  requestTimeoutMs?: number;
  now?: () => number;
}

export interface SfdcTransportStats {
  requests: number;
  retries: number;
  reauths: number;
}

function retryAfterMs(headers: Headers): number | undefined {
  const h = headers.get("retry-after");
  if (!h) return undefined;
  const secs = Number(h);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const t = Date.parse(h);
  return Number.isNaN(t) ? undefined : Math.max(0, t - Date.now());
}

/**
 * Low-level HTTP client for one Salesforce session (§8.1 retry + re-auth,
 * §8.3 budget + worker cap).
 */
export class SfdcTransport {
  readonly apiVersion: string;
  readonly budget: ApiBudget;
  readonly stats: SfdcTransportStats = { requests: 0, retries: 0, reauths: 0 };
  private readonly auth: SfdcAuthenticator;
  private readonly fetchFn: FetchFn;
  private readonly restSem: Semaphore;
  private readonly retry: Pick<RetryOptions, "policy" | "sleep" | "random">;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly log = getLogger("Sfdc");
  private firstServerDate: string | null = null;
  private lastServerDate: string | null = null;

  constructor(opts: SfdcTransportOptions) {
    this.auth = opts.auth;
    this.apiVersion = opts.apiVersion;
    this.fetchFn =
      opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.budget = opts.budget ?? new ApiBudget();
    this.restSem = new Semaphore(opts.restConcurrency ?? 2);
    this.retry = opts.retry ?? {};
    this.timeoutMs = opts.requestTimeoutMs ?? 600_000;
    this.now = opts.now ?? (() => Date.now());
  }

  /** `Date` header of the first REST call of the run (ISO) — §4.1 `sfdc_now`. */
  get serverDate(): string | null {
    return this.firstServerDate;
  }

  /** `Date` header of the most recent REST call (ISO). */
  get latestServerDate(): string | null {
    return this.lastServerDate;
  }

  async instanceUrl(): Promise<string> {
    return (await this.auth.getSession()).instanceUrl;
  }

  async orgId(): Promise<string> {
    return (await this.auth.getSession()).orgId;
  }

  /** `Date` header of the token exchange (ISO), when Salesforce sent one. */
  async sessionServerDate(): Promise<string | null> {
    const d = (await this.auth.getSession()).serverDate;
    if (!d) return null;
    const t = Date.parse(d);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }

  resolveUrl(
    instanceUrl: string,
    path: string,
    query?: SfdcRequest["query"],
  ): string {
    let url: string;
    if (/^https?:\/\//i.test(path)) url = path;
    else if (path.startsWith("/services/")) url = `${instanceUrl}${path}`;
    else
      url = `${instanceUrl}/services/data/v${this.apiVersion}${path.startsWith("/") ? path : `/${path}`}`;
    if (query) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(query))
        if (v !== undefined) qs.set(k, String(v));
      const s = qs.toString();
      if (s) url += (url.includes("?") ? "&" : "?") + s;
    }
    return url;
  }

  /** One request with §8.1 retry classes and a single re-auth replay. */
  async request<T = unknown>(req: SfdcRequest): Promise<SfdcResponse<T>> {
    const counts = req.countsAgainstBudget ?? true;
    const lane = req.lane ?? "rest";
    return withRetry(
      async (attempt) => {
        if (attempt > 1) this.stats.retries++;
        if (counts) this.budget.assertAvailable();
        const run = () => this.attemptWithReauth<T>(req, counts);
        return lane === "rest" ? this.restSem.run(run) : run();
      },
      {
        ...this.retry,
        signal: req.signal,
        onRetry: ({ err, attempt, delayMs }) =>
          this.log.warn(
            {
              method: req.method,
              path: req.path,
              attempt,
              delayMs,
              errorCode: err.errorCode,
              status: err.status,
            },
            "retrying Salesforce request",
          ),
      },
    );
  }

  private async attemptWithReauth<T>(
    req: SfdcRequest,
    counts: boolean,
  ): Promise<SfdcResponse<T>> {
    let session = await this.auth.getSession();
    for (let replay = 0; ; replay++) {
      try {
        return await this.attempt<T>(
          req,
          session.instanceUrl,
          session.accessToken,
          counts,
        );
      } catch (e) {
        const err = toSfdcError(e, { method: req.method, url: req.path });
        if (err.errorClass === "session" && replay === 0) {
          this.stats.reauths++;
          this.log.warn(
            { method: req.method, path: req.path },
            "Salesforce session expired; re-authenticating",
          );
          session = await this.auth.refresh(session.accessToken);
          continue;
        }
        throw err;
      }
    }
  }

  private async attempt<T>(
    req: SfdcRequest,
    instanceUrl: string,
    accessToken: string,
    counts: boolean,
  ): Promise<SfdcResponse<T>> {
    const url = this.resolveUrl(instanceUrl, req.path, req.query);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      Accept: req.accept === "text" ? "text/csv" : "application/json",
      ...req.headers,
    };
    let body: string | undefined;
    if (req.rawBody !== undefined) body = req.rawBody;
    else if (req.body !== undefined) {
      body = JSON.stringify(req.body);
      headers["Content-Type"] ??= "application/json; charset=UTF-8";
    }
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    req.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(
      () => controller.abort(),
      req.timeoutMs ?? this.timeoutMs,
    );
    if (typeof timer === "object" && "unref" in timer) timer.unref();
    this.stats.requests++;
    if (counts) this.budget.consume();
    let res: Response;
    try {
      res = await this.fetchFn(url, {
        method: req.method,
        headers,
        body,
        signal: controller.signal,
      });
    } catch (e) {
      throw toSfdcError(e, { method: req.method, url });
    } finally {
      clearTimeout(timer);
      req.signal?.removeEventListener("abort", onAbort);
    }
    this.observeHeaders(res.headers);
    if (res.status === 304 && req.allow304) {
      return { status: res.status, headers: res.headers, body: null as T };
    }
    const text = await res.text();
    if (!res.ok) throw this.toError(res, text, req.method, url);
    if (res.status === 204 || text.length === 0)
      return {
        status: res.status,
        headers: res.headers,
        body: (req.accept === "text" ? "" : null) as T,
      };
    if (req.accept === "text")
      return { status: res.status, headers: res.headers, body: text as T };
    let json: T;
    try {
      json = JSON.parse(text) as T;
    } catch (e) {
      throw new SfdcApiError(
        `Salesforce returned a non-JSON body (${res.status}) for ${req.method} ${url}`,
        {
          status: res.status,
          errorCode: "INVALID_RESPONSE",
          errorClass: "retryable",
          method: req.method,
          url,
          cause: e,
        },
      );
    }
    return { status: res.status, headers: res.headers, body: json };
  }

  private observeHeaders(headers: Headers): void {
    this.budget.fromLimitInfo(headers.get("sforce-limit-info"));
    const date = headers.get("date");
    if (date) {
      const t = Date.parse(date);
      if (!Number.isNaN(t)) {
        const iso = new Date(t).toISOString();
        this.lastServerDate = iso;
        this.firstServerDate ??= iso;
      }
    }
  }

  private toError(
    res: Response,
    text: string,
    method: string,
    url: string,
  ): SfdcApiError {
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* keep text */
    }
    const errors = parseErrorBody(parsed);
    const code = errors[0]?.errorCode;
    const msg = errors.map((e) => e.message).join("; ") || `HTTP ${res.status}`;
    return new SfdcApiError(
      `Salesforce ${method} ${url} failed (${res.status}${code ? ` ${code}` : ""}): ${msg}`,
      {
        status: res.status,
        errorCode: code ?? `HTTP_${res.status}`,
        errors,
        method,
        url,
        retryAfterMs: retryAfterMs(res.headers),
      },
    );
  }
}

// ---------------------------------------------------------------------------
// Record flattening (§2.1.4: relationship values → dotted keys)
// ---------------------------------------------------------------------------

function isRelationship(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v) && "attributes" in v;
}

function isSubquery(
  v: unknown,
): v is { records: unknown[]; totalSize?: number; done?: boolean } {
  return (
    !!v &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    Array.isArray((v as { records?: unknown }).records)
  );
}

/**
 * Flatten a REST query record: drop `attributes`, turn nested relationship
 * objects into dotted keys (`Account_vod__r.Name`); child subquery results
 * keep their `{ totalSize, done, records }` shape with flattened records.
 */
export function flattenRecord(
  rec: Record<string, unknown>,
  prefix = "",
  out: Record<string, unknown> = {},
): Record<string, unknown> {
  for (const [k, v] of Object.entries(rec)) {
    if (k === "attributes") continue;
    const key = prefix ? `${prefix}.${k}` : k;
    if (isRelationship(v)) flattenRecord(v, key, out);
    else if (isSubquery(v))
      out[key] = {
        ...v,
        records: v.records.map((r) =>
          isRelationship(r) ? flattenRecord(r) : r,
        ),
      };
    else out[key] = v;
  }
  return out;
}

function toSourceRow(rec: Record<string, unknown>): SourceRow {
  const flat = flattenRecord(rec);
  if (typeof flat.Id === "string") flat.Id = to18(flat.Id);
  return flat as SourceRow;
}

// ---------------------------------------------------------------------------
// REST endpoints
// ---------------------------------------------------------------------------

interface QueryResponse {
  totalSize: number;
  done: boolean;
  nextRecordsUrl?: string;
  records: Record<string, unknown>[];
}

interface DescribeCacheEntry<T> {
  value: T;
  lastModified: string | null;
  fetchedAt: number;
}

export interface SfdcRestOptions {
  /** Re-validate cached describes with `If-Modified-Since` after this many ms (default 10 min). */
  describeTtlMs?: number;
  /** `extract.closureStrategy` (§2.1.4): `soqlIn` (default) or `composite`. */
  closureStrategy?: "soqlIn" | "composite";
  /** Delete/update feed look-back guard in days (§2.1.6, default 30). */
  feedWindowDays?: number;
  /** Ids per `Id IN (…)` GET (default 400). */
  inChunkSize?: number;
  /** Ids per `/composite/sobjects` GET (default 2 000). */
  compositeChunkSize?: number;
  now?: () => number;
}

const MS_PER_DAY = 86_400_000;

/** `2025-01-01T00:00:00.000Z` → `2025-01-01T00:00:00+00:00` (feed param format). */
export function feedTimestamp(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new TypeError(`Invalid ISO datetime: ${iso}`);
  return new Date(t).toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

export class SfdcRest {
  private readonly log = getLogger("Sfdc");
  private readonly describeTtlMs: number;
  private readonly closureStrategy: "soqlIn" | "composite";
  private readonly feedWindowMs: number;
  private readonly inChunkSize: number;
  private readonly compositeChunkSize: number;
  private readonly now: () => number;
  private readonly describes = new Map<
    string,
    DescribeCacheEntry<SfdcObjectDescribe>
  >();
  /** Stored in the exact shape `cachedGet` mutates on 304 (`fetchedAt` refresh). */
  private globalCache: DescribeCacheEntry<{
    sobjects: SfdcGlobalDescribeEntry[];
  }> | null = null;
  private recordTypeCache: SfdcRecordType[] | null = null;
  private versionsCache: string[] | null = null;

  constructor(
    readonly transport: SfdcTransport,
    opts: SfdcRestOptions = {},
  ) {
    this.describeTtlMs = opts.describeTtlMs ?? 600_000;
    this.closureStrategy = opts.closureStrategy ?? "soqlIn";
    this.feedWindowMs = (opts.feedWindowDays ?? 30) * MS_PER_DAY;
    this.inChunkSize = Math.min(
      SOQL_IN_MAX_IDS,
      opts.inChunkSize ?? SOQL_IN_MAX_IDS,
    );
    this.compositeChunkSize = Math.min(
      COMPOSITE_MAX_IDS,
      opts.compositeChunkSize ?? COMPOSITE_MAX_IDS,
    );
    this.now = opts.now ?? (() => Date.now());
  }

  /** Drop every cached describe / record type / version list. */
  clearCaches(): void {
    this.describes.clear();
    this.globalCache = null;
    this.recordTypeCache = null;
    this.versionsCache = null;
  }

  // --- §2.1.2 --------------------------------------------------------------

  async availableVersions(): Promise<string[]> {
    if (this.versionsCache) return [...this.versionsCache];
    const res = await this.transport.request<Array<{ version: string }>>({
      method: "GET",
      path: "/services/data/",
      countsAgainstBudget: false,
    });
    this.versionsCache = (res.body ?? []).map((v) => v.version);
    return [...this.versionsCache];
  }

  // --- §2.1.3 --------------------------------------------------------------

  private async cachedGet<T>(
    path: string,
    entry: DescribeCacheEntry<T> | null,
    onFresh: (value: T, lastModified: string | null) => void,
  ): Promise<T> {
    if (entry && this.now() - entry.fetchedAt < this.describeTtlMs)
      return entry.value;
    const headers: Record<string, string> = {};
    if (entry?.lastModified) headers["If-Modified-Since"] = entry.lastModified;
    const res = await this.transport.request<T | null>({
      method: "GET",
      path,
      headers,
      allow304: true,
    });
    if (res.status === 304 && entry) {
      entry.fetchedAt = this.now();
      return entry.value;
    }
    if (res.body === null)
      throw new SfdcApiError(`Empty describe response for ${path}`, {
        status: res.status,
        errorCode: "INVALID_RESPONSE",
        errorClass: "retryable",
      });
    onFresh(
      res.body,
      res.headers.get("last-modified") ?? res.headers.get("date"),
    );
    return res.body;
  }

  async describeGlobal(): Promise<SfdcGlobalDescribeEntry[]> {
    const list = await this.cachedGet<{ sobjects: SfdcGlobalDescribeEntry[] }>(
      "/sobjects",
      this.globalCache,
      (body, lastModified) => {
        this.globalCache = {
          value: { sobjects: body.sobjects ?? [] },
          lastModified,
          fetchedAt: this.now(),
        };
      },
    );
    return (list.sobjects ?? []).map((s) => ({
      name: s.name,
      label: s.label,
      keyPrefix: s.keyPrefix ?? null,
      queryable: Boolean(s.queryable),
      custom: Boolean(s.custom),
      replicateable: Boolean(s.replicateable),
    }));
  }

  async describe(objectName: string): Promise<SfdcObjectDescribe> {
    assertObjectName(objectName);
    return this.cachedGet<SfdcObjectDescribe>(
      `/sobjects/${objectName}/describe`,
      this.describes.get(objectName) ?? null,
      (body, lastModified) => {
        this.describes.set(objectName, {
          value: body,
          lastModified,
          fetchedAt: this.now(),
        });
      },
    );
  }

  async recordTypes(): Promise<SfdcRecordType[]> {
    if (this.recordTypeCache) return [...this.recordTypeCache];
    const out: SfdcRecordType[] = [];
    for await (const r of this.query(
      "SELECT Id, SobjectType, DeveloperName, Name, IsActive, IsPersonType FROM RecordType",
    )) {
      out.push({
        Id: r.Id,
        SobjectType: String(r.SobjectType),
        DeveloperName: String(r.DeveloperName),
        Name: String(r.Name),
        IsActive: r.IsActive === true || r.IsActive === "true",
        IsPersonType: r.IsPersonType === true || r.IsPersonType === "true",
      });
    }
    this.recordTypeCache = out;
    return [...out];
  }

  // --- §2.1.4 --------------------------------------------------------------

  async *query(
    soql: string,
    opts: SfdcQueryOptions = {},
  ): AsyncIterable<SourceRow> {
    const headers: Record<string, string> = {};
    if (opts.batchSize !== undefined) {
      const bs = Math.min(2000, Math.max(200, Math.floor(opts.batchSize)));
      headers["Sforce-Query-Options"] = `batchSize=${bs}`;
    }
    let res = await this.transport.request<QueryResponse>({
      method: "GET",
      path: opts.all ? "/queryAll" : "/query",
      query: { q: soql },
      headers,
    });
    let pages = 0;
    for (;;) {
      pages++;
      for (const rec of res.body.records ?? []) yield toSourceRow(rec);
      if (res.body.done || !res.body.nextRecordsUrl) break;
      res = await this.transport.request<QueryResponse>({
        method: "GET",
        path: res.body.nextRecordsUrl,
        headers,
      });
    }
    this.log.debug(
      { pages, totalSize: res.body.totalSize, all: Boolean(opts.all) },
      "SOQL query complete",
    );
  }

  async count(objectName: string, whereClause?: string): Promise<number> {
    const res = await this.transport.request<QueryResponse>({
      method: "GET",
      path: "/query",
      query: { q: buildCount(objectName, whereClause) },
    });
    return res.body.totalSize;
  }

  async explain(soql: string): Promise<SfdcQueryPlan[]> {
    const res = await this.transport.request<{ plans?: SfdcQueryPlan[] }>({
      method: "GET",
      path: "/query/",
      query: { explain: soql },
    });
    return res.body.plans ?? [];
  }

  /** `Id IN (…)` closure lookup, ≤ 400 ids per GET, `queryAll` semantics. */
  async *queryIds(
    objectName: string,
    ids: readonly string[],
    columns: readonly string[],
  ): AsyncIterable<SourceRow> {
    if (ids.length === 0) return;
    if (this.closureStrategy === "composite") {
      yield* this.compositeByIds(objectName, ids, columns);
      return;
    }
    yield* this.queryIdsSoql(objectName, ids, columns);
  }

  async *queryIdsSoql(
    objectName: string,
    ids: readonly string[],
    columns: readonly string[],
  ): AsyncIterable<SourceRow> {
    assertObjectName(objectName);
    const cols = fieldList(columns);
    if (!cols.some((c) => c.toLowerCase() === "id")) cols.unshift("Id");
    const ids18 = ids.map(to18);
    for (const clause of inClauses("Id", ids18, this.inChunkSize)) {
      const soql = buildSelect({
        object: objectName,
        columns: cols,
        where: clause,
      });
      yield* this.query(soql, { all: true });
    }
  }

  /**
   * `GET /composite/sobjects/{Object}?ids=…&fields=…` (≤ 2 000 ids). Deleted
   * or inaccessible ids come back as `null` entries and are simply omitted —
   * the closure treats a missing parent as dangling (§2.1.4).
   */
  async *compositeByIds(
    objectName: string,
    ids: readonly string[],
    columns: readonly string[],
  ): AsyncIterable<SourceRow> {
    assertObjectName(objectName);
    const cols = fieldList(columns).map(assertFieldPath);
    if (!cols.some((c) => c.toLowerCase() === "id")) cols.unshift("Id");
    const unique = [...new Set(ids.map(to18))];
    for (const chunk of chunkValues(unique, this.compositeChunkSize)) {
      const res = await this.transport.request<
        Array<Record<string, unknown> | null>
      >({
        method: "GET",
        path: `/composite/sobjects/${objectName}`,
        query: { ids: chunk.join(","), fields: cols.join(",") },
      });
      for (const rec of res.body ?? []) if (rec) yield toSourceRow(rec);
    }
  }

  // --- §2.1.6 --------------------------------------------------------------

  private async guardFeed(
    objectName: string,
    start: string,
    end: string,
  ): Promise<{ start: string; end: string }> {
    assertObjectName(objectName);
    const s = Date.parse(start);
    const e = Date.parse(end);
    if (Number.isNaN(s) || Number.isNaN(e))
      throw new SfdcApiError(
        `Feed window must be ISO datetimes, got start=${start} end=${end}`,
        {
          errorCode: "INVALID_REPLICATION_DATE",
          errorClass: "structural",
        },
      );
    if (e <= s)
      throw new SfdcApiError(
        `Feed window end (${end}) must be after start (${start})`,
        {
          errorCode: "INVALID_REPLICATION_DATE",
          errorClass: "structural",
        },
      );
    const nowMs = this.transport.latestServerDate
      ? Date.parse(this.transport.latestServerDate)
      : this.now();
    if (nowMs - s > this.feedWindowMs)
      throw new SfdcApiError(
        `Feed window start ${start} is more than ${Math.round(this.feedWindowMs / MS_PER_DAY)} days in the past; Salesforce keeps delete/update feeds for 30 days only (§2.1.6) — use verify --keys to resynchronise`,
        { errorCode: "REPLICATION_WINDOW_EXCEEDED", errorClass: "structural" },
      );
    const d = await this.describe(objectName);
    if (!d.replicateable)
      throw new SfdcApiError(
        `${objectName} is not replicateable: /deleted/ and /updated/ feeds are unavailable (SF_NOT_REPLICATEABLE, §2.1.6)`,
        { errorCode: "NOT_REPLICATEABLE", errorClass: "structural" },
      );
    return { start: feedTimestamp(start), end: feedTimestamp(end) };
  }

  async getDeleted(
    objectName: string,
    start: string,
    end: string,
  ): Promise<SfdcDeletedResult> {
    const w = await this.guardFeed(objectName, start, end);
    const res = await this.transport.request<SfdcDeletedResult>({
      method: "GET",
      path: `/sobjects/${objectName}/deleted/`,
      query: { start: w.start, end: w.end },
    });
    return {
      deletedRecords: (res.body.deletedRecords ?? []).map((r) => ({
        id: to18(r.id),
        deletedDate: r.deletedDate,
      })),
      earliestDateAvailable: res.body.earliestDateAvailable,
      latestDateCovered: res.body.latestDateCovered,
    };
  }

  async getUpdated(
    objectName: string,
    start: string,
    end: string,
  ): Promise<SfdcUpdatedResult> {
    const w = await this.guardFeed(objectName, start, end);
    const res = await this.transport.request<SfdcUpdatedResult>({
      method: "GET",
      path: `/sobjects/${objectName}/updated/`,
      query: { start: w.start, end: w.end },
    });
    return {
      ids: (res.body.ids ?? []).map(to18),
      latestDateCovered: res.body.latestDateCovered,
    };
  }

  // --- §2.1.7 --------------------------------------------------------------

  async limits(): Promise<SfdcLimits> {
    const res = await this.transport.request<SfdcLimits>({
      method: "GET",
      path: "/limits",
    });
    this.transport.budget.fromLimits(res.body);
    return res.body;
  }

  // --- §4.1 ----------------------------------------------------------------

  /** `sfdc_now`: `Date` header of the first REST call, else one cheap call to obtain it. */
  async serverNow(): Promise<string> {
    if (this.transport.serverDate) return this.transport.serverDate;
    await this.transport.request({
      method: "GET",
      path: "/services/data/",
      countsAgainstBudget: false,
    });
    if (this.transport.serverDate) return this.transport.serverDate;
    // The token exchange is a Salesforce call too: its Date header is a
    // (slightly earlier, hence conservative) sfdc_now.
    const sessionDate = await this.transport.sessionServerDate();
    if (sessionDate) return sessionDate;
    // No Date header (proxy stripped it): fall back to the org's own clock via SOQL.
    for await (const r of this.query(
      "SELECT MAX(SystemModstamp) ts FROM Organization",
    )) {
      const ts = r.ts;
      if (typeof ts === "string") {
        this.log.warn(
          "Salesforce did not return a Date header; using MAX(SystemModstamp) of Organization as sfdc_now",
        );
        return new Date(ts).toISOString();
      }
    }
    throw new SfdcApiError(
      "Cannot determine Salesforce server time (no Date header, no SystemModstamp)",
      {
        errorCode: "NO_SERVER_TIME",
        errorClass: "fatal",
      },
    );
  }
}
