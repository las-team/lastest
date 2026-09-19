/**
 * VQL (§2.5.5): `POST /query` with a form-encoded `q=`, pagination by
 * following `responseDetails.next_page` (POST, expires after ~15 min),
 * `PAGESIZE 0` totals, picklist-array normalisation and literal helpers.
 *
 * Picklist fields come back as arrays even when single-valued `[OBS]`. The
 * client asks for `X-VaultAPI-DescribeQuery: true` on the first page and
 * uses `queryDescribe.fields[].type` to normalise every picklist column to
 * an array (a string value is split on `,`); callers may also pass the
 * picklist columns explicitly.
 */
import { normaliseVaultType } from "../types";
import { VaultRequestError } from "./errors";
import type { VaultHttp } from "./http";
import type { VqlPage } from "./types";

/** `IN (…)` lists are chunked to this many values (§2.5.5: ≤ 500). */
export const VQL_IN_MAX = 500;
/** Default/max page size for objects (§2.5.5). */
export const VQL_PAGE_SIZE = 1000;

export type VqlScalar = string | number | boolean | null | Date;

/** Quote a VQL string literal, escaping `'` and `\` with a backslash. */
export function vqlString(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function pad(n: number, w = 2): string {
  return String(n).padStart(w, "0");
}

/** `'YYYY-MM-DD'` (UTC) from a `Date` or a date/datetime string. */
export function vqlDate(value: Date | string): string {
  if (typeof value === "string") {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(value);
    if (m) return `'${m[1]}'`;
    value = new Date(value);
  }
  return `'${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}'`;
}

/** `'YYYY-MM-DDTHH:MM:SS.sssZ'` (UTC). */
export function vqlDateTime(value: Date | string): string {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime()))
    throw new VaultRequestError(
      "INVALID_DATA",
      `Invalid datetime literal: ${String(value)}`,
      { errorClass: "structural" },
    );
  return `'${d.toISOString()}'`;
}

/** Literal for any scalar: strings quoted/escaped, dates as datetimes, `null`, booleans, numbers. */
export function vqlValue(value: VqlScalar): string {
  if (value === null || value === undefined) return "null";
  if (value instanceof Date) return vqlDateTime(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new VaultRequestError(
        "INVALID_DATA",
        `Non-finite number in VQL: ${value}`,
        { errorClass: "structural" },
      );
    return String(value);
  }
  return vqlString(value);
}

/** Split `values` into chunks of at most `size` (default 500). */
export function chunkIn<T>(values: readonly T[], size = VQL_IN_MAX): T[][] {
  if (size < 1) throw new RangeError("chunk size must be ≥ 1");
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size)
    out.push(values.slice(i, i + size));
  return out;
}

/** `('a','b',…)` for one chunk (≤ 500 values; throws above). */
export function vqlIn(values: readonly VqlScalar[]): string {
  if (values.length > VQL_IN_MAX)
    throw new VaultRequestError(
      "INVALID_DATA",
      `IN list has ${values.length} values (max ${VQL_IN_MAX}) — use vqlInClauses()`,
      { errorClass: "structural" },
    );
  return `(${values.map(vqlValue).join(",")})`;
}

/** `field IN (…)` clauses, one per ≤ 500-value chunk; deduplicates values. */
export function vqlInClauses(
  field: string,
  values: readonly VqlScalar[],
  size = VQL_IN_MAX,
): string[] {
  const unique = [...new Set(values)];
  return chunkIn(unique, size).map((chunk) => `${field} IN ${vqlIn(chunk)}`);
}

/** `CONTAINS ('a','b')` for multi-value fields. */
export function vqlContains(values: readonly string[]): string {
  return `CONTAINS (${values.map(vqlString).join(",")})`;
}

const TRAILING_PAGING = /\s+(PAGESIZE|LIMIT|MAXROWS|SKIP)\s+\d+\s*$/i;

/** Strip trailing `PAGESIZE/LIMIT/MAXROWS/SKIP n` clauses and append `PAGESIZE 0`. */
export function withPageSizeZero(q: string): string {
  let s = q.trim();
  while (TRAILING_PAGING.test(s)) s = s.replace(TRAILING_PAGING, "");
  return `${s} PAGESIZE 0`;
}

interface QueryDescribeField {
  name?: string;
  type?: string;
  multi_value?: boolean;
}

/** Column names whose describe type is Picklist (case-insensitive). */
export function picklistFieldsFromDescribe(describe: unknown): Set<string> {
  const out = new Set<string>();
  const d = describe as { fields?: unknown } | undefined;
  if (!d || !Array.isArray(d.fields)) return out;
  for (const f of d.fields as QueryDescribeField[]) {
    if (
      f &&
      typeof f.name === "string" &&
      normaliseVaultType(f.type) === "picklist"
    )
      out.add(f.name);
  }
  return out;
}

/** Ensure every picklist column is an array (`null` stays `null`). */
export function normalisePicklistArrays(
  row: Record<string, unknown>,
  picklistFields: ReadonlySet<string>,
): Record<string, unknown> {
  if (!picklistFields.size) return row;
  let out: Record<string, unknown> | undefined;
  for (const f of picklistFields) {
    if (!(f in row)) continue;
    const v = row[f];
    if (v === null || v === undefined || Array.isArray(v)) continue;
    out ??= { ...row };
    out[f] =
      typeof v === "string"
        ? v
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [v];
  }
  return out ?? row;
}

function parseResponseDetails(
  body: Record<string, unknown>,
): VqlPage["responseDetails"] {
  const rd = (body.responseDetails ?? {}) as Record<string, unknown>;
  const num = (k: string, dflt = 0) => {
    const n = Number(rd[k]);
    return Number.isFinite(n) ? n : dflt;
  };
  const details: VqlPage["responseDetails"] = {
    pagesize: num("pagesize"),
    pageoffset: num("pageoffset"),
    size: num("size"),
    total: num("total"),
  };
  if (typeof rd.next_page === "string" && rd.next_page)
    details.next_page = rd.next_page;
  if (typeof rd.previous_page === "string" && rd.previous_page)
    details.previous_page = rd.previous_page;
  return details;
}

export interface VqlOptions {
  /** Picklist columns to normalise in addition to what `queryDescribe` reports. */
  picklistFields?: readonly string[];
  /** Send `X-VaultAPI-DescribeQuery: true` on the first page (default true). */
  describe?: boolean;
  /** `X-VaultAPI-RecordProperties` header value. */
  recordProperties?: string;
  referenceId?: string;
}

/**
 * Run `q` and yield pages (not rows), following `next_page` with POST. The
 * first page is requested with `X-VaultAPI-DescribeQuery: true` so picklist
 * columns can be normalised without a metadata round-trip.
 */
export async function* vqlPages(
  http: VaultHttp,
  q: string,
  opts: VqlOptions = {},
): AsyncIterable<VqlPage> {
  const picklists = new Set<string>(opts.picklistFields ?? []);
  const describe = opts.describe ?? true;
  const headers: Record<string, string | undefined> = {
    "X-VaultAPI-DescribeQuery": describe ? "true" : undefined,
    "X-VaultAPI-RecordProperties": opts.recordProperties,
  };
  let res = await http.request<Record<string, unknown>>({
    method: "POST",
    path: "/query",
    body: new URLSearchParams({ q }),
    headers,
    referenceId: opts.referenceId,
  });
  if (describe)
    for (const f of picklistFieldsFromDescribe(res.body.queryDescribe))
      picklists.add(f);
  let guard = 0;
  for (;;) {
    const body = res.body;
    const details = parseResponseDetails(body);
    const data = Array.isArray(body.data)
      ? (body.data as Array<Record<string, unknown>>).map((r) =>
          normalisePicklistArrays(r, picklists),
        )
      : [];
    yield { responseDetails: details, data };
    if (!details.next_page) return;
    if (++guard > 1_000_000)
      throw new VaultRequestError(
        "UNEXPECTED_ERROR",
        "VQL pagination did not terminate",
        { errorClass: "fatal" },
      );
    res = await http.request<Record<string, unknown>>({
      method: "POST",
      path: details.next_page,
      absolute: !/^https?:\/\//i.test(details.next_page),
      referenceId: opts.referenceId,
    });
  }
}

/** Yield rows across all pages. */
export async function* vqlRows(
  http: VaultHttp,
  q: string,
  opts: VqlOptions = {},
): AsyncIterable<Record<string, unknown>> {
  for await (const page of vqlPages(http, q, opts)) yield* page.data;
}

/** `PAGESIZE 0` → `responseDetails.total`. */
export async function vqlCount(
  http: VaultHttp,
  q: string,
  opts: Pick<VqlOptions, "referenceId"> = {},
): Promise<number> {
  const res = await http.request<Record<string, unknown>>({
    method: "POST",
    path: "/query",
    body: new URLSearchParams({ q: withPageSizeZero(q) }),
    referenceId: opts.referenceId,
  });
  return parseResponseDetails(res.body).total;
}
