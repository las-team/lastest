/**
 * Generic REST profiler — for systems that expose records over plain JSON but
 * have no aggregate/GROUP BY endpoint.
 *
 * Grouping happens client-side over a bounded page walk, which is the honest
 * trade: it is exact only when the walk reaches the end of the collection, and
 * `truncated` says so when it does not. A profiler that silently reported
 * partial counts as a distribution would produce weights that look
 * authoritative and are not.
 */

import {
  DEFAULT_PROFILE_LIMIT,
  type ProfileQuery,
  type ProfileResult,
  type ProfiledGroup,
  type SutProfiler,
} from "./types";

export interface RestProfilerConfig {
  /** Collection endpoint template; `{objectType}` is substituted. */
  urlTemplate: string;
  headers?: Record<string, string>;
  /** JSON path to the record array in the response, dot-separated
   *  (e.g. "data.items"). Empty means the body itself is the array. */
  recordsPath?: string;
  /** Query params for paging. Absent = single request, no paging. */
  paging?: {
    limitParam: string;
    offsetParam: string;
    pageSize: number;
  };
  /** Hard ceiling on records walked, regardless of paging. */
  maxRecords?: number;
  /**
   * Injected fetch. Narrower than `typeof fetch` on purpose: this profiler only
   * ever calls it as `(url, init)`, and the host's SSRF-guarding wrapper cannot
   * honour a `Request` (it would have to reconstruct method, headers and body
   * from it, and silently dropping them is worse than refusing the shape).
   */
  fetchImpl?: (url: string | URL, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
}

const DEFAULT_MAX_RECORDS = 10_000;
const DEFAULT_TIMEOUT_MS = 30_000;

export function extractRecords(
  body: unknown,
  path: string | undefined,
): Array<Record<string, unknown>> {
  let node: unknown = body;
  for (const seg of (path ?? "").split(".").filter(Boolean)) {
    if (!node || typeof node !== "object") return [];
    node = (node as Record<string, unknown>)[seg];
  }
  if (!Array.isArray(node)) return [];
  return node.filter(
    (r): r is Record<string, unknown> => !!r && typeof r === "object",
  );
}

/** Group records by the requested fields. Records missing any field are
 *  skipped — a partial tuple is not evidence a combination occurs. */
export function groupRecords(
  records: Array<Record<string, unknown>>,
  fields: string[],
): ProfiledGroup[] {
  const byKey = new Map<string, ProfiledGroup>();
  for (const rec of records) {
    const coords: Record<string, string> = {};
    let complete = true;
    for (const f of fields) {
      const v = rec[f];
      if (v === null || v === undefined || String(v).trim() === "") {
        complete = false;
        break;
      }
      coords[f] = String(v).trim();
    }
    if (!complete) continue;
    const key = fields.map((f) => `${f}=${coords[f]}`).join("|");
    const existing = byKey.get(key);
    if (existing) existing.count += 1;
    else byKey.set(key, { coords, count: 1 });
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count);
}

export class RestProfiler implements SutProfiler {
  readonly kind = "rest" as const;
  readonly label: string;
  private readonly fetchImpl: (
    url: string | URL,
    init?: RequestInit,
  ) => Promise<Response>;

  constructor(private readonly config: RestProfilerConfig) {
    this.label = `REST ${config.urlTemplate}`;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  private urlFor(objectType: string, offset: number): string {
    const base = this.config.urlTemplate.replace(
      "{objectType}",
      encodeURIComponent(objectType),
    );
    if (!this.config.paging) return base;
    const url = new URL(base);
    url.searchParams.set(
      this.config.paging.limitParam,
      String(this.config.paging.pageSize),
    );
    url.searchParams.set(this.config.paging.offsetParam, String(offset));
    return url.toString();
  }

  private async fetchPage(
    objectType: string,
    offset: number,
  ): Promise<Array<Record<string, unknown>>> {
    const res = await this.fetchImpl(this.urlFor(objectType, offset), {
      headers: { Accept: "application/json", ...(this.config.headers ?? {}) },
      signal: AbortSignal.timeout(this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`REST profile request failed: HTTP ${res.status}`);
    }
    return extractRecords(await res.json(), this.config.recordsPath);
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.fetchPage("__probe__", 0);
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async profile(query: ProfileQuery): Promise<ProfileResult> {
    const maxRecords = Math.min(
      this.config.maxRecords ?? DEFAULT_MAX_RECORDS,
      (query.limit ?? DEFAULT_PROFILE_LIMIT) * 100,
    );
    const all: Array<Record<string, unknown>> = [];
    let truncated = false;

    if (!this.config.paging) {
      all.push(...(await this.fetchPage(query.objectType, 0)));
      truncated = all.length >= maxRecords;
    } else {
      const { pageSize } = this.config.paging;
      for (let offset = 0; offset < maxRecords; offset += pageSize) {
        const page = await this.fetchPage(query.objectType, offset);
        all.push(...page);
        // A short page means the collection is exhausted; a full page at the
        // ceiling means we stopped early and the counts are incomplete.
        if (page.length < pageSize) break;
        if (all.length >= maxRecords) {
          truncated = true;
          break;
        }
      }
    }

    return {
      objectType: query.objectType,
      fields: query.fields,
      groups: groupRecords(all.slice(0, maxRecords), query.fields),
      truncated,
    };
  }
}
