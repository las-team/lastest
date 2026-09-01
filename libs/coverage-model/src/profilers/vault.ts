/**
 * Veeva Vault profiler — real record distributions over VQL.
 *
 * Vault exposes VQL through the REST API (`POST /api/{version}/query`), which
 * is how test-data volume becomes knowable: `SELECT country__v, call_type__v,
 * COUNT() FROM call__v GROUP BY ...`.
 *
 * Auth is session-based: `POST /api/{version}/auth` returns a `sessionId` used
 * as the `Authorization` header on subsequent calls. Sessions expire, so the
 * client re-authenticates on 401 rather than assuming a long-lived token.
 *
 * READ-ONLY BY CONSTRUCTION. This profiler issues SELECT/COUNT queries and
 * nothing else. A profiler that could mutate a validated GxP system would be
 * unusable in the segment it exists for — no customer will point a tool at a
 * production Vault if it holds write credentials.
 */

import {
  DEFAULT_PROFILE_LIMIT,
  type ProfileQuery,
  type ProfileResult,
  type ProfiledGroup,
  type SutProfiler,
} from "./types";

export interface VaultProfilerConfig {
  /** e.g. https://my-vault.veevavault.com */
  baseUrl: string;
  /** API version path segment, e.g. 'v24.1'. */
  apiVersion?: string;
  username: string;
  password: string;
  /** Overrides username/password when a session is already held. */
  sessionId?: string;
  /**
   * Injected fetch. Narrower than `typeof fetch` on purpose: this profiler only
   * ever calls it as `(url, init)`, and the host's SSRF-guarding wrapper cannot
   * honour a `Request` (it would have to reconstruct method, headers and body
   * from it, and silently dropping them is worse than refusing the shape).
   */
  fetchImpl?: (url: string | URL, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
}

const DEFAULT_API_VERSION = "v24.1";
const DEFAULT_TIMEOUT_MS = 30_000;

/** VQL identifiers are `[a-z0-9_]+__(v|c)` shaped. Anything else is rejected
 *  rather than escaped: this string is interpolated into a query, and an
 *  allowlist is the only defensible position for that. */
const VQL_IDENT = /^[A-Za-z][A-Za-z0-9_]*$/;

export function assertVqlIdentifier(name: string, what: string): string {
  if (!VQL_IDENT.test(name)) {
    throw new Error(`Invalid ${what} for VQL: ${JSON.stringify(name)}`);
  }
  return name;
}

export function buildVqlGroupQuery(query: ProfileQuery): string {
  const objectType = assertVqlIdentifier(query.objectType, "object type");
  const fields = query.fields.map((f) => assertVqlIdentifier(f, "field"));
  if (fields.length === 0) {
    throw new Error("At least one field is required to profile");
  }
  const select = [...fields, "COUNT() AS record_count"].join(", ");
  const where = query.where ? ` WHERE ${query.where}` : "";
  const limit = query.limit ?? DEFAULT_PROFILE_LIMIT;
  return `SELECT ${select} FROM ${objectType}${where} GROUP BY ${fields.join(", ")} LIMIT ${limit}`;
}

export class VaultProfiler implements SutProfiler {
  readonly kind = "vault" as const;
  readonly label: string;
  private sessionId: string | undefined;
  private readonly fetchImpl: (
    url: string | URL,
    init?: RequestInit,
  ) => Promise<Response>;

  constructor(private readonly config: VaultProfilerConfig) {
    this.label = `Vault ${config.baseUrl}`;
    this.sessionId = config.sessionId;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  private get apiBase(): string {
    const version = this.config.apiVersion ?? DEFAULT_API_VERSION;
    return `${this.config.baseUrl.replace(/\/+$/, "")}/api/${version}`;
  }

  private async authenticate(): Promise<string> {
    const body = new URLSearchParams({
      username: this.config.username,
      password: this.config.password,
    });
    const res = await this.fetchImpl(`${this.apiBase}/auth`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
      signal: AbortSignal.timeout(this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    const json = (await res.json().catch(() => ({}))) as {
      responseStatus?: string;
      sessionId?: string;
      errors?: Array<{ message?: string }>;
    };
    if (json.responseStatus !== "SUCCESS" || !json.sessionId) {
      const msg =
        json.errors
          ?.map((e) => e.message)
          .filter(Boolean)
          .join("; ") || `HTTP ${res.status}`;
      throw new Error(`Vault authentication failed: ${msg}`);
    }
    this.sessionId = json.sessionId;
    return json.sessionId;
  }

  private async ensureSession(): Promise<string> {
    return this.sessionId ?? (await this.authenticate());
  }

  private async runVql(vql: string, retryOnAuth = true): Promise<unknown[]> {
    const session = await this.ensureSession();
    const res = await this.fetchImpl(`${this.apiBase}/query`, {
      method: "POST",
      headers: {
        Authorization: session,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "X-VaultAPI-DescribeQuery": "false",
      },
      body: new URLSearchParams({ q: vql }).toString(),
      signal: AbortSignal.timeout(this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });

    // Vault signals an expired session with 401 (and sometimes a SUCCESS-shaped
    // body carrying an INVALID_SESSION_ID error) — re-auth once, then give up.
    if (res.status === 401 && retryOnAuth) {
      this.sessionId = undefined;
      return this.runVql(vql, false);
    }

    const json = (await res.json().catch(() => ({}))) as {
      responseStatus?: string;
      data?: unknown[];
      errors?: Array<{ type?: string; message?: string }>;
    };

    if (
      json.errors?.some((e) => e.type === "INVALID_SESSION_ID") &&
      retryOnAuth
    ) {
      this.sessionId = undefined;
      return this.runVql(vql, false);
    }
    if (json.responseStatus !== "SUCCESS") {
      const msg =
        json.errors
          ?.map((e) => e.message)
          .filter(Boolean)
          .join("; ") || `HTTP ${res.status}`;
      throw new Error(`VQL query failed: ${msg}`);
    }
    return json.data ?? [];
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.authenticate();
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async profile(query: ProfileQuery): Promise<ProfileResult> {
    const limit = query.limit ?? DEFAULT_PROFILE_LIMIT;
    const vql = buildVqlGroupQuery({ ...query, limit });
    const rows = await this.runVql(vql);
    const groups = parseVaultGroups(rows, query.fields);
    return {
      objectType: query.objectType,
      fields: query.fields,
      groups,
      truncated: rows.length >= limit,
    };
  }
}

/** Vault returns aggregate rows as flat objects; COUNT() lands on a key whose
 *  name varies by version, so accept the alias or any count-shaped key. */
export function parseVaultGroups(
  rows: unknown[],
  fields: string[],
): ProfiledGroup[] {
  const out: ProfiledGroup[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const coords: Record<string, string> = {};
    for (const f of fields) {
      const v = row[f];
      if (v === null || v === undefined) continue;
      coords[f] = String(v).trim();
    }
    if (Object.keys(coords).length !== fields.length) continue;

    const countKey =
      ["record_count", "count", "COUNT()", "count__v"].find(
        (k) => typeof row[k] === "number" || typeof row[k] === "string",
      ) ?? null;
    const count = countKey ? Number(row[countKey]) : NaN;
    out.push({ coords, count: Number.isFinite(count) ? count : 0 });
  }
  return out.sort((a, b) => b.count - a.count);
}
