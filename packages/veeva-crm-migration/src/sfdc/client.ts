/**
 * Minimal Salesforce REST + Tooling client on native `fetch`.
 *
 * - three auth flows (pre-issued token, OAuth client-credentials, JWT bearer)
 * - one re-authentication + retry on 401
 * - bounded back-off on 429 / 5xx / network errors
 * - SOQL pagination (`nextRecordsUrl`)
 * - an optional request budget (`maxRequests`)
 * - API-version discovery (`GET /services/data/`)
 */
import { createPrivateKey, sign as cryptoSign } from "node:crypto";

import type {
  ApiVersionInfo,
  QueryResult,
  SfdcErrorBody,
  TokenResponse,
} from "./api-types";

export type SfdcAuth =
  | {
      kind: "token";
      instanceUrl: string;
      accessToken: string;
      /** Never set for pre-issued tokens; declared so `auth.loginUrl` is legal on the union. */
      loginUrl?: undefined;
    }
  | {
      kind: "client_credentials";
      loginUrl: string;
      instanceUrl?: string;
      clientId: string;
      clientSecret: string;
    }
  | {
      kind: "jwt";
      loginUrl: string;
      instanceUrl?: string;
      clientId: string;
      username: string;
      privateKey: string;
    };

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface SfdcClientOptions {
  fetch?: FetchLike;
  log?: (message: string) => void;
  /** `v64.0` or `64.0`; discovered from `/services/data/` when omitted. */
  apiVersion?: string;
  /** Abort with `REQUEST_BUDGET_EXCEEDED` once this many org API calls were made. */
  maxRequests?: number;
  /** Injectable pause for retries (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable clock (JWT `exp`). */
  now?: () => Date;
  /** Back-off schedule in ms for 429 / 5xx / network retries. */
  retryDelaysMs?: readonly number[];
}

export interface ApiUsage {
  used: number;
  max: number;
}

export interface SfdcClient {
  readonly instanceUrl: string;
  /** Mutable so `extractOrgSnapshot` can honour `ExtractOptions.apiVersion`. */
  apiVersion: string;
  /** Org id parsed from the OAuth identity URL, when the flow returned one. */
  readonly orgId?: string;
  /** Org API calls made so far (token exchanges are not counted). */
  readonly requestCount: number;
  /** Last `Sforce-Limit-Info: api-usage` seen. */
  readonly apiUsage?: ApiUsage;
  /** Request budget; `undefined` = unlimited. May be set after creation. */
  maxRequests?: number;
  /** GET relative to `/services/data/{version}` (or absolute / `/services/...`). */
  get<T>(path: string, init?: { headers?: Record<string, string> }): Promise<T>;
  /** SOQL query, drains every page. */
  query<T>(soql: string): Promise<T[]>;
  /** Tooling SOQL query, drains every page. */
  toolingQuery<T>(soql: string): Promise<T[]>;
  /** GET relative to `/services/data/{version}/tooling`. */
  toolingGet<T>(path: string): Promise<T>;
}

export class SfdcApiError extends Error {
  readonly status: number;
  readonly errorCode: string;
  readonly path: string;
  readonly body: unknown;

  constructor(init: {
    status: number;
    errorCode?: string;
    message: string;
    path: string;
    body?: unknown;
  }) {
    super(init.message);
    this.name = "SfdcApiError";
    this.status = init.status;
    this.errorCode = init.errorCode ?? "UNKNOWN";
    this.path = init.path;
    this.body = init.body;
  }
}

export const DEFAULT_API_VERSION = "v64.0";
const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [500, 2000, 8000];
const JWT_LIFETIME_SECONDS = 180;

/** Parses `Sforce-Limit-Info: api-usage=123/100000`. */
export function parseLimitInfo(header: string | null): ApiUsage | undefined {
  if (!header) return undefined;
  const m = header.match(/api-usage=(\d+)\/(\d+)/);
  if (!m) return undefined;
  return { used: Number(m[1]), max: Number(m[2]) };
}

/** `64.0` / `v64.0` / `64` → `v64.0`. */
export function normalizeApiVersion(version: string): string {
  const m = version.trim().match(/^v?(\d+)(?:\.(\d+))?$/i);
  if (!m) throw new Error(`invalid Salesforce API version "${version}"`);
  return `v${m[1]}.${m[2] ?? "0"}`;
}

function base64url(input: Buffer | string): string {
  return (typeof input === "string" ? Buffer.from(input) : input).toString(
    "base64url",
  );
}

/** Builds the RS256 JWT assertion for the OAuth JWT bearer flow. */
export function buildJwtAssertion(
  auth: Extract<SfdcAuth, { kind: "jwt" }>,
  now: Date = new Date(),
): string {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: auth.clientId,
      sub: auth.username,
      aud: auth.loginUrl,
      exp: Math.floor(now.getTime() / 1000) + JWT_LIFETIME_SECONDS,
    }),
  );
  const signingInput = `${header}.${claims}`;
  const key = createPrivateKey(auth.privateKey);
  const signature = cryptoSign("RSA-SHA256", Buffer.from(signingInput), key);
  return `${signingInput}.${base64url(signature)}`;
}

function orgIdFromIdentityUrl(id: string | undefined): string | undefined {
  const m = id?.match(/\/id\/(00D[A-Za-z0-9]{12,15})\//);
  return m?.[1];
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function errorFromBody(
  status: number,
  body: unknown,
  path: string,
): SfdcApiError {
  let errorCode: string | undefined;
  let message: string | undefined;
  const first: SfdcErrorBody | undefined = Array.isArray(body)
    ? (body[0] as SfdcErrorBody | undefined)
    : body && typeof body === "object"
      ? (body as SfdcErrorBody)
      : undefined;
  if (first) {
    errorCode = first.errorCode ?? first.error;
    message = first.message ?? first.error_description;
  } else if (typeof body === "string" && body) {
    message = body.slice(0, 500);
  }
  return new SfdcApiError({
    status,
    errorCode: errorCode ?? `HTTP_${status}`,
    message:
      `${status} ${errorCode ?? ""} ${message ?? "request failed"} (${path})`.replace(
        /\s+/g,
        " ",
      ),
    path,
    body,
  });
}

interface Session {
  accessToken: string;
  instanceUrl: string;
  orgId?: string;
}

async function exchangeToken(
  auth: SfdcAuth,
  fetchImpl: FetchLike,
  now: () => Date,
): Promise<Session> {
  if (auth.kind === "token") {
    return {
      accessToken: auth.accessToken,
      instanceUrl: auth.instanceUrl.replace(/\/+$/, ""),
    };
  }
  const body = new URLSearchParams();
  if (auth.kind === "client_credentials") {
    body.set("grant_type", "client_credentials");
    body.set("client_id", auth.clientId);
    body.set("client_secret", auth.clientSecret);
  } else {
    body.set("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer");
    body.set("assertion", buildJwtAssertion(auth, now()));
  }
  const url = `${auth.loginUrl.replace(/\/+$/, "")}/services/oauth2/token`;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: body.toString(),
    });
  } catch (err) {
    throw new SfdcApiError({
      status: 0,
      errorCode: "NETWORK_ERROR",
      message: `token request failed: ${err instanceof Error ? err.message : String(err)}`,
      path: url,
    });
  }
  const parsed = await readBody(res);
  if (!res.ok) throw errorFromBody(res.status, parsed, url);
  const token = parsed as TokenResponse;
  if (!token?.access_token) {
    throw new SfdcApiError({
      status: res.status,
      errorCode: "INVALID_TOKEN_RESPONSE",
      message: `token response has no access_token (${url})`,
      path: url,
      body: parsed,
    });
  }
  const instanceUrl = (token.instance_url ?? auth.instanceUrl ?? "").replace(
    /\/+$/,
    "",
  );
  if (!instanceUrl) {
    throw new SfdcApiError({
      status: res.status,
      errorCode: "NO_INSTANCE_URL",
      message: "token response has no instance_url and none was configured",
      path: url,
      body: parsed,
    });
  }
  return {
    accessToken: token.access_token,
    instanceUrl,
    orgId: orgIdFromIdentityUrl(token.id),
  };
}

export async function createSfdcClient(
  auth: SfdcAuth,
  options: SfdcClientOptions = {},
): Promise<SfdcClient> {
  const fetchImpl: FetchLike =
    options.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const log = options.log ?? (() => {});
  const now = options.now ?? (() => new Date());
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const retryDelays = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;

  let session = await exchangeToken(auth, fetchImpl, now);
  let requestCount = 0;
  let apiUsage: ApiUsage | undefined;
  let maxRequests = options.maxRequests;
  let apiVersion = options.apiVersion
    ? normalizeApiVersion(options.apiVersion)
    : "";

  function resolveUrl(path: string, tooling: boolean): string {
    if (/^https?:\/\//i.test(path)) return path;
    if (path.startsWith("/services/")) return session.instanceUrl + path;
    const rel = path.startsWith("/") ? path : `/${path}`;
    return `${session.instanceUrl}/services/data/${apiVersion}${tooling ? "/tooling" : ""}${rel}`;
  }

  async function request<T>(
    url: string,
    init: { headers?: Record<string, string> } = {},
  ): Promise<T> {
    let reauthenticated = false;
    let attempt = 0;
    for (;;) {
      if (maxRequests !== undefined && requestCount >= maxRequests) {
        throw new SfdcApiError({
          status: 0,
          errorCode: "REQUEST_BUDGET_EXCEEDED",
          message: `request budget of ${maxRequests} API calls exhausted (${url})`,
          path: url,
        });
      }
      requestCount++;
      let res: Response;
      try {
        res = await fetchImpl(url, {
          method: "GET",
          headers: {
            authorization: `Bearer ${session.accessToken}`,
            accept: "application/json",
            ...init.headers,
          },
        });
      } catch (err) {
        if (attempt < retryDelays.length) {
          const delay = retryDelays[attempt] ?? 0;
          attempt++;
          log(
            `network error on ${url}: ${err instanceof Error ? err.message : String(err)}; retry ${attempt} in ${delay}ms`,
          );
          await sleep(delay);
          continue;
        }
        throw new SfdcApiError({
          status: 0,
          errorCode: "NETWORK_ERROR",
          message: `${err instanceof Error ? err.message : String(err)} (${url})`,
          path: url,
        });
      }
      const usage = parseLimitInfo(res.headers.get("sforce-limit-info"));
      if (usage) apiUsage = usage;

      if (res.status === 401 && !reauthenticated && auth.kind !== "token") {
        reauthenticated = true;
        await readBody(res);
        log("session expired; re-authenticating");
        session = await exchangeToken(auth, fetchImpl, now);
        continue;
      }
      if (
        (res.status === 429 || res.status >= 500) &&
        attempt < retryDelays.length
      ) {
        const retryAfter = Number(res.headers.get("retry-after"));
        const delay =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : (retryDelays[attempt] ?? 0);
        attempt++;
        await readBody(res);
        log(`HTTP ${res.status} on ${url}; retry ${attempt} in ${delay}ms`);
        await sleep(delay);
        continue;
      }
      const body = await readBody(res);
      if (!res.ok) throw errorFromBody(res.status, body, url);
      return body as T;
    }
  }

  async function drain<T>(firstUrl: string): Promise<T[]> {
    const records: T[] = [];
    let url: string | undefined = firstUrl;
    while (url) {
      const page: QueryResult<T> = await request<QueryResult<T>>(url, {
        headers: { "sforce-query-options": "batchSize=2000" },
      });
      if (Array.isArray(page.records)) records.push(...page.records);
      url =
        page.done === false && page.nextRecordsUrl
          ? resolveUrl(page.nextRecordsUrl, false)
          : undefined;
    }
    return records;
  }

  if (!apiVersion) {
    try {
      const versions = await request<ApiVersionInfo[]>(
        `${session.instanceUrl}/services/data/`,
      );
      const best = versions
        .map((v) => Number(v.version))
        .filter((v) => Number.isFinite(v))
        .sort((a, b) => b - a)[0];
      if (best === undefined) throw new Error("empty version list");
      apiVersion = normalizeApiVersion(String(best));
    } catch (err) {
      apiVersion = DEFAULT_API_VERSION;
      log(
        `warning: API version discovery failed (${err instanceof Error ? err.message : String(err)}); using ${DEFAULT_API_VERSION}`,
      );
    }
  }

  const client: SfdcClient = {
    get instanceUrl() {
      return session.instanceUrl;
    },
    get apiVersion() {
      return apiVersion;
    },
    set apiVersion(v: string) {
      apiVersion = normalizeApiVersion(v);
    },
    get orgId() {
      return session.orgId;
    },
    get requestCount() {
      return requestCount;
    },
    get apiUsage() {
      return apiUsage;
    },
    get maxRequests() {
      return maxRequests;
    },
    set maxRequests(v: number | undefined) {
      maxRequests = v;
    },
    get<T>(path: string, init?: { headers?: Record<string, string> }) {
      return request<T>(resolveUrl(path, false), init);
    },
    query<T>(soql: string) {
      return drain<T>(
        resolveUrl(`/query?q=${encodeURIComponent(soql)}`, false),
      );
    },
    toolingQuery<T>(soql: string) {
      return drain<T>(resolveUrl(`/query?q=${encodeURIComponent(soql)}`, true));
    },
    toolingGet<T>(path: string) {
      return request<T>(resolveUrl(path, true));
    },
  };
  return client;
}
