/**
 * SOQL text helpers (§2.1.4, §4.1): safe string literals, unquoted ISO
 * date/datetime literals, `IN (…)` list chunking (≤ 400 ids per GET), field
 * list building and `SELECT COUNT()` construction. Pure functions, no I/O.
 */

/** Max ids per `Id IN (…)` GET request (§2.1.4: URL ≤ 16 KB). */
export const SOQL_IN_MAX_IDS = 400;
/** Max ids per `GET /composite/sobjects/{Object}?ids=` request (§2.1.4). */
export const COMPOSITE_MAX_IDS = 2000;

/**
 * Escape a string for use inside a single-quoted SOQL literal. Salesforce
 * documents `\'`, `\\`, `\n`, `\r`, `\t`, `\b`, `\f` and `\"` as the escape
 * sequences; anything else passes through verbatim (SOQL is UTF-8 clean).
 */
export function escapeSoqlString(value: string): string {
  return value.replace(/[\\'"\n\r\t\b\f]/g, (c) => {
    switch (c) {
      case "\\":
        return "\\\\";
      case "'":
        return "\\'";
      case '"':
        return '\\"';
      case "\n":
        return "\\n";
      case "\r":
        return "\\r";
      case "\t":
        return "\\t";
      case "\b":
        return "\\b";
      case "\f":
        return "\\f";
      default:
        return c;
    }
  });
}

/** `'…'` quoted, escaped string literal. */
export function soqlString(value: string): string {
  return `'${escapeSoqlString(value)}'`;
}

function toDate(value: Date | string | number): Date {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime()))
    throw new TypeError(`Invalid date for SOQL literal: ${String(value)}`);
  return d;
}

/**
 * Unquoted datetime literal `YYYY-MM-DDThh:mm:ssZ` (UTC, no fractional
 * seconds — §4.1 `toISOString().replace(/\.\d{3}Z$/, 'Z')`).
 */
export function soqlDateTime(value: Date | string | number): string {
  return toDate(value)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");
}

/** Unquoted date literal `YYYY-MM-DD` (UTC calendar date). */
export function soqlDate(value: Date | string | number): string {
  return toDate(value).toISOString().slice(0, 10);
}

export type SoqlScalar = string | number | boolean | null | Date;

/**
 * Render a JS value as a SOQL literal: strings are quoted+escaped, numbers and
 * booleans verbatim, `null` → `null`, `Date` → datetime literal.
 */
export function soqlLiteral(value: SoqlScalar): string {
  if (value === null) return "null";
  if (value instanceof Date) return soqlDateTime(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError(`Non-finite number in SOQL literal: ${value}`);
    return String(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  return soqlString(value);
}

/** Split `values` into chunks of at most `size` (default 400). */
export function chunkValues<T>(
  values: readonly T[],
  size: number = SOQL_IN_MAX_IDS,
): T[][] {
  if (!Number.isInteger(size) || size < 1)
    throw new RangeError(`chunk size must be a positive integer, got ${size}`);
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size)
    out.push(values.slice(i, i + size));
  return out;
}

/**
 * `field IN ('a','b',…)` for one chunk. Values are deduplicated (first
 * occurrence wins) so a repeated id never inflates the URL.
 */
export function inClause(field: string, values: readonly SoqlScalar[]): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const v of values) {
    const lit = soqlLiteral(v);
    if (seen.has(lit)) continue;
    seen.add(lit);
    parts.push(lit);
  }
  if (parts.length === 0)
    throw new RangeError(`IN list for ${field} must not be empty`);
  return `${field} IN (${parts.join(",")})`;
}

/**
 * `field IN (…)` clauses chunked to `size` values each — one per GET (§2.1.4:
 * ≤ 400 ids). Duplicates are removed across the whole list first.
 */
export function inClauses(
  field: string,
  values: readonly SoqlScalar[],
  size: number = SOQL_IN_MAX_IDS,
): string[] {
  const unique = [...new Set(values.map(soqlLiteral))];
  return chunkValues(unique, size).map(
    (chunk) => `${field} IN (${chunk.join(",")})`,
  );
}

/**
 * Deduplicate and normalise a SELECT field list (case-insensitive, order of
 * first occurrence preserved, blanks dropped). Throws on an empty result.
 */
export function fieldList(columns: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of columns) {
    const c = raw.trim();
    if (!c) continue;
    const key = c.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  if (out.length === 0) throw new RangeError("SELECT field list is empty");
  return out;
}

const OBJECT_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
const FIELD_PATH = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)*$/;

/** Throw when `name` is not a plausible sObject API name (guards interpolation). */
export function assertObjectName(name: string): string {
  if (!OBJECT_NAME.test(name))
    throw new TypeError(`Invalid sObject API name: ${JSON.stringify(name)}`);
  return name;
}

/** Throw when `path` is not a plausible field or relationship path. */
export function assertFieldPath(path: string): string {
  if (!FIELD_PATH.test(path))
    throw new TypeError(`Invalid SOQL field path: ${JSON.stringify(path)}`);
  return path;
}

export interface SelectSpec {
  object: string;
  columns: readonly string[];
  where?: string | readonly string[];
  orderBy?: string | readonly string[];
  limit?: number;
  offset?: number;
}

function whereText(where: SelectSpec["where"]): string {
  if (where === undefined) return "";
  const parts = (typeof where === "string" ? [where] : where)
    .map((w) => w.trim())
    .filter(Boolean);
  if (parts.length === 0) return "";
  return ` WHERE ${parts.length === 1 ? parts[0] : parts.map((p) => `(${p})`).join(" AND ")}`;
}

/** `SELECT a, b FROM X [WHERE …] [ORDER BY …] [LIMIT n] [OFFSET n]`. */
export function buildSelect(spec: SelectSpec): string {
  assertObjectName(spec.object);
  const cols = fieldList(spec.columns).map(assertFieldPath);
  let soql = `SELECT ${cols.join(", ")} FROM ${spec.object}${whereText(spec.where)}`;
  if (spec.orderBy !== undefined) {
    const ob = (
      typeof spec.orderBy === "string" ? [spec.orderBy] : spec.orderBy
    )
      .map((o) => o.trim())
      .filter(Boolean);
    if (ob.length) soql += ` ORDER BY ${ob.join(", ")}`;
  }
  if (spec.limit !== undefined) {
    if (!Number.isInteger(spec.limit) || spec.limit < 0)
      throw new RangeError(`LIMIT must be a non-negative integer`);
    soql += ` LIMIT ${spec.limit}`;
  }
  if (spec.offset !== undefined) {
    if (!Number.isInteger(spec.offset) || spec.offset < 0)
      throw new RangeError(`OFFSET must be a non-negative integer`);
    soql += ` OFFSET ${spec.offset}`;
  }
  return soql;
}

/** `SELECT COUNT() FROM X [WHERE …]` (REST only — Bulk cannot aggregate). */
export function buildCount(
  object: string,
  where?: string | readonly string[],
): string {
  assertObjectName(object);
  return `SELECT COUNT() FROM ${object}${whereText(where)}`;
}

/** Combine predicates with AND, wrapping each in parentheses; empty → undefined. */
export function andPredicates(
  ...predicates: Array<string | undefined | null>
): string | undefined {
  const parts = predicates
    .filter((p): p is string => typeof p === "string")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return undefined;
  if (parts.length === 1) return parts[0];
  return parts.map((p) => `(${p})`).join(" AND ");
}

/** Extract the object name from `SELECT … FROM <Object>` (first FROM). */
export function objectOfSoql(soql: string): string | undefined {
  const m = /\bFROM\s+([A-Za-z][A-Za-z0-9_]*)/i.exec(soql);
  return m?.[1];
}
