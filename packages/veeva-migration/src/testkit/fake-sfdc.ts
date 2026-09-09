/**
 * In-memory `SfdcClient` for hermetic tests. Rows live per object; describes
 * come from fixtures (`buildDescribe`). A small SOQL evaluator supports the
 * subset the tool emits: `SELECT cols FROM obj [WHERE …] [ORDER BY f [ASC|DESC]] [LIMIT n]`
 * with `=`, `!=`, `<`, `<=`, `>`, `>=`, `IN (…)`, `NOT IN (…)`, `LIKE`,
 * `AND`/`OR`/`NOT`, parentheses, `null`, quoted strings, numbers, booleans and
 * unquoted date/datetime literals. Relationship paths are looked up as
 * flattened keys first (`"Account_vod__r.Name"`), then as nested objects.
 * `SELECT COUNT()` returns the count.
 */
import type {
  SfdcBulkPage,
  SfdcBulkQueryOptions,
  SfdcBulkResult,
  SfdcClient,
  SfdcDeletedResult,
  SfdcLimits,
  SfdcQueryOptions,
  SfdcQueryPlan,
  SfdcUpdatedResult,
} from "../sfdc/types";
import { to18 } from "../transform/ids";
import type {
  SfdcGlobalDescribeEntry,
  SfdcObjectDescribe,
  SfdcRecordType,
  SourceRow,
} from "../types";

// ---------------------------------------------------------------------------
// SOQL mini-evaluator
// ---------------------------------------------------------------------------

type Tok = { t: "id" | "str" | "num" | "punct" | "kw"; v: string };

const KEYWORDS = new Set([
  "SELECT",
  "FROM",
  "WHERE",
  "AND",
  "OR",
  "NOT",
  "IN",
  "LIKE",
  "ORDER",
  "BY",
  "ASC",
  "DESC",
  "LIMIT",
  "NULL",
  "TRUE",
  "FALSE",
  "OFFSET",
  "NULLS",
  "FIRST",
  "LAST",
]);

function tokenize(soql: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < soql.length) {
    const c = soql[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "'") {
      let j = i + 1;
      let s = "";
      while (j < soql.length && soql[j] !== "'") {
        if (soql[j] === "\\" && j + 1 < soql.length) {
          s += soql[j + 1];
          j += 2;
        } else {
          s += soql[j++];
        }
      }
      out.push({ t: "str", v: s });
      i = j + 1;
      continue;
    }
    if (/[(),]/.test(c)) {
      out.push({ t: "punct", v: c });
      i++;
      continue;
    }
    if (/[<>=!]/.test(c)) {
      const two = soql.slice(i, i + 2);
      if (two === "<=" || two === ">=" || two === "!=" || two === "<>") {
        out.push({ t: "punct", v: two === "<>" ? "!=" : two });
        i += 2;
      } else {
        out.push({ t: "punct", v: c });
        i++;
      }
      continue;
    }
    let j = i;
    while (j < soql.length && /[A-Za-z0-9_.:\-+TZ]/.test(soql[j])) j++;
    if (j === i)
      throw new Error(
        `FakeSfdc: cannot tokenize near "${soql.slice(i, i + 10)}"`,
      );
    const word = soql.slice(i, j);
    if (/^\d{4}-\d{2}-\d{2}/.test(word)) out.push({ t: "str", v: word });
    else if (/^-?\d+(\.\d+)?$/.test(word)) out.push({ t: "num", v: word });
    else if (KEYWORDS.has(word.toUpperCase()))
      out.push({ t: "kw", v: word.toUpperCase() });
    else out.push({ t: "id", v: word });
    i = j;
  }
  return out;
}

type Expr = (row: SourceRow) => boolean;

class Parser {
  pos = 0;
  /** Every field name referenced by a WHERE predicate, in source order. */
  readonly fields: string[] = [];
  constructor(private toks: Tok[]) {}
  peek(): Tok | undefined {
    return this.toks[this.pos];
  }
  next(): Tok {
    const t = this.toks[this.pos++];
    if (!t) throw new Error("FakeSfdc: unexpected end of SOQL");
    return t;
  }
  is(t: Tok["t"], v?: string): boolean {
    const p = this.peek();
    return !!p && p.t === t && (v === undefined || p.v === v);
  }
  expect(t: Tok["t"], v?: string): Tok {
    if (!this.is(t, v))
      throw new Error(
        `FakeSfdc: expected ${v ?? t} at token ${this.pos} (${JSON.stringify(this.peek())})`,
      );
    return this.next();
  }
  or(): Expr {
    let left = this.and();
    while (this.is("kw", "OR")) {
      this.next();
      const right = this.and();
      const l = left;
      left = (r) => l(r) || right(r);
    }
    return left;
  }
  and(): Expr {
    let left = this.not();
    while (this.is("kw", "AND")) {
      this.next();
      const right = this.not();
      const l = left;
      left = (r) => l(r) && right(r);
    }
    return left;
  }
  not(): Expr {
    if (this.is("kw", "NOT")) {
      this.next();
      const e = this.not();
      return (r) => !e(r);
    }
    return this.primary();
  }
  primary(): Expr {
    if (this.is("punct", "(")) {
      this.next();
      const e = this.or();
      this.expect("punct", ")");
      return e;
    }
    const field = this.expect("id").v;
    this.fields.push(field);
    if (this.is("kw", "NOT")) {
      this.next();
      this.expect("kw", "IN");
      const list = this.list();
      return (r) => !list.includes(norm(getPath(r, field)));
    }
    if (this.is("kw", "IN")) {
      this.next();
      const list = this.list();
      return (r) => list.includes(norm(getPath(r, field)));
    }
    if (this.is("kw", "LIKE")) {
      this.next();
      const pat = this.expect("str").v;
      const re = new RegExp(
        "^" +
          pat
            .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
            .replace(/%/g, ".*")
            .replace(/_/g, ".") +
          "$",
        "i",
      );
      return (r) => re.test(String(getPath(r, field) ?? ""));
    }
    const op = this.expect("punct").v;
    const lit = this.literal();
    return (r) => compare(norm(getPath(r, field)), op, lit);
  }
  list(): Array<string | number | boolean | null> {
    this.expect("punct", "(");
    const vals: Array<string | number | boolean | null> = [];
    while (!this.is("punct", ")")) {
      vals.push(this.literal());
      if (this.is("punct", ",")) this.next();
    }
    this.expect("punct", ")");
    return vals;
  }
  literal(): string | number | boolean | null {
    const t = this.next();
    if (t.t === "str") return t.v;
    if (t.t === "num") return Number(t.v);
    if (t.t === "kw" && t.v === "NULL") return null;
    if (t.t === "kw" && t.v === "TRUE") return true;
    if (t.t === "kw" && t.v === "FALSE") return false;
    if (t.t === "id") return t.v;
    throw new Error(`FakeSfdc: bad literal ${JSON.stringify(t)}`);
  }
}

function getPath(row: SourceRow, path: string): unknown {
  if (path in row) return row[path];
  if (!path.includes(".")) return undefined;
  let cur: unknown = row;
  for (const p of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function norm(v: unknown): string | number | boolean | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "boolean" || typeof v === "number") return v;
  const s = String(v);
  if (s === "true") return true;
  if (s === "false") return false;
  return s;
}

const DATE_LITERAL_RE =
  /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:?\d{2}))?$/;

/**
 * Epoch millis of a date / datetime literal (date-only = midnight UTC), or
 * `undefined` for anything else. Salesforce compares datetimes as instants:
 * the §4.1 window literal `…T03:04:05Z` (no fractional seconds) and the row
 * value `…T03:04:05.000Z` (as Bulk CSV / REST return it) are equal, which a
 * lexicographic comparison would invert (`'.' < 'Z'`).
 */
export function instantOf(v: unknown): number | undefined {
  if (typeof v !== "string" || !DATE_LITERAL_RE.test(v)) return undefined;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? undefined : ms;
}

function compare(
  a: string | number | boolean | null,
  op: string,
  b: string | number | boolean | null,
): boolean {
  const ia = instantOf(a);
  const ib = instantOf(b);
  if (op === "=")
    return (
      a === b ||
      (ia !== undefined && ia === ib) ||
      (a !== null && b !== null && String(a) === String(b))
    );
  if (op === "!=") return !compare(a, "=", b);
  if (a === null || b === null) return false;
  const instants = ia !== undefined && ib !== undefined;
  const x = instants ? ia : typeof a === "number" ? a : String(a);
  const y = instants ? ib : typeof b === "number" ? b : String(b);
  if (op === "<") return x < y;
  if (op === "<=") return x <= y;
  if (op === ">") return x > y;
  if (op === ">=") return x >= y;
  throw new Error(`FakeSfdc: unsupported operator ${op}`);
}

export interface ParsedSoql {
  columns: string[];
  count: boolean;
  object: string;
  where?: Expr;
  orderBy: Array<{ field: string; desc: boolean }>;
  limit?: number;
  /** Fields referenced by WHERE / ORDER BY (validated like columns). */
  referencedFields: string[];
}

export function parseSoql(soql: string): ParsedSoql {
  const toks = tokenize(soql);
  const p = new Parser(toks);
  p.expect("kw", "SELECT");
  const columns: string[] = [];
  let count = false;
  if (p.is("id", "COUNT") || p.is("id", "count")) {
    p.next();
    p.expect("punct", "(");
    p.expect("punct", ")");
    count = true;
  } else {
    while (!p.is("kw", "FROM")) {
      columns.push(p.expect("id").v);
      if (p.is("punct", ",")) p.next();
    }
  }
  p.expect("kw", "FROM");
  const object = p.expect("id").v;
  let where: Expr | undefined;
  if (p.is("kw", "WHERE")) {
    p.next();
    where = p.or();
  }
  const orderBy: ParsedSoql["orderBy"] = [];
  if (p.is("kw", "ORDER")) {
    p.next();
    p.expect("kw", "BY");
    do {
      if (p.is("punct", ",")) p.next();
      const field = p.expect("id").v;
      let desc = false;
      if (p.is("kw", "ASC") || p.is("kw", "DESC")) desc = p.next().v === "DESC";
      if (p.is("kw", "NULLS")) {
        p.next();
        p.next();
      }
      orderBy.push({ field, desc });
    } while (p.is("punct", ","));
  }
  let limit: number | undefined;
  if (p.is("kw", "LIMIT")) {
    p.next();
    limit = Number(p.expect("num").v);
  }
  return {
    columns,
    count,
    object,
    where,
    orderBy,
    limit,
    referencedFields: [...p.fields, ...orderBy.map((o) => o.field)],
  };
}

function projectRow(row: SourceRow, columns: string[]): SourceRow {
  const out: SourceRow = { Id: row.Id };
  for (const c of columns) {
    const v = getPath(row, c);
    out[c] = v === undefined ? null : v;
  }
  return out;
}

/** RFC-4180 CSV of rows (empty = null, booleans `true/false`). */
export function rowsToCsv(rows: SourceRow[], columns: string[]): string {
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return (
    [
      columns.join(","),
      ...rows.map((r) => columns.map((c) => esc(getPath(r, c))).join(",")),
    ].join("\n") + "\n"
  );
}

// ---------------------------------------------------------------------------
// Fake client
// ---------------------------------------------------------------------------

export interface FakeSfdcOptions {
  orgId?: string;
  apiVersion?: string;
  /** Bulk page size (rows per `SfdcBulkPage`), default 2. */
  bulkPageSize?: number;
  now?: string;
  limits?: Partial<SfdcLimits>;
}

export interface FakeSfdcCall {
  method: string;
  args: unknown[];
}

export class FakeSfdcClient implements SfdcClient {
  readonly orgId: string;
  readonly apiVersion: string;
  readonly instanceUrl = "https://fake.my.salesforce.com";
  readonly calls: FakeSfdcCall[] = [];
  private rows = new Map<string, SourceRow[]>();
  private describes = new Map<string, SfdcObjectDescribe>();
  private deleted = new Map<
    string,
    Array<{ id: string; deletedDate: string }>
  >();
  private recordTypeRows: SfdcRecordType[] = [];
  private jobCounter = 0;
  private opts: Required<Pick<FakeSfdcOptions, "bulkPageSize" | "now">> &
    FakeSfdcOptions;
  /** Set to fail the next matching call (for retry tests). */
  failNext: { method: string; error: Error; remaining: number } | undefined;

  constructor(opts: FakeSfdcOptions = {}) {
    this.orgId = opts.orgId ?? "00D000000000001AAA";
    this.apiVersion = opts.apiVersion ?? "67.0";
    this.opts = { bulkPageSize: 2, now: "2026-09-07T12:00:00.000Z", ...opts };
  }

  // --- fixture setup -----------------------------------------------------

  addDescribe(describe: SfdcObjectDescribe): this {
    this.describes.set(describe.name, describe);
    if (!this.rows.has(describe.name)) this.rows.set(describe.name, []);
    return this;
  }
  addRows(objectName: string, rows: SourceRow[]): this {
    const list = this.rows.get(objectName) ?? [];
    list.push(
      ...rows.map((r) => ({
        ...r,
        Id: to18(r.Id),
        IsDeleted: r.IsDeleted ?? false,
      })),
    );
    this.rows.set(objectName, list);
    return this;
  }
  /** Replace or insert one row (by Id). */
  upsertRow(objectName: string, row: SourceRow): this {
    const list = this.rows.get(objectName) ?? [];
    const id = to18(row.Id);
    const idx = list.findIndex((r) => r.Id === id);
    const next = { ...row, Id: id, IsDeleted: row.IsDeleted ?? false };
    if (idx >= 0) list[idx] = next;
    else list.push(next);
    this.rows.set(objectName, list);
    return this;
  }
  /** Soft-delete a row (IsDeleted = true, feed entry). */
  deleteRow(objectName: string, id: string, deletedDate: string): this {
    const id18 = to18(id);
    const row = (this.rows.get(objectName) ?? []).find((r) => r.Id === id18);
    if (row) {
      row.IsDeleted = true;
      row.SystemModstamp = deletedDate;
    }
    this.addDeleted(objectName, id18, deletedDate);
    return this;
  }
  addDeleted(objectName: string, id: string, deletedDate: string): this {
    const list = this.deleted.get(objectName) ?? [];
    list.push({ id: to18(id), deletedDate });
    this.deleted.set(objectName, list);
    return this;
  }
  addRecordTypes(rows: SfdcRecordType[]): this {
    this.recordTypeRows.push(...rows);
    return this;
  }
  getRows(objectName: string): SourceRow[] {
    return this.rows.get(objectName) ?? [];
  }

  private record(method: string, ...args: unknown[]): void {
    this.calls.push({ method, args });
    if (
      this.failNext &&
      this.failNext.method === method &&
      this.failNext.remaining > 0
    ) {
      this.failNext.remaining--;
      const err = this.failNext.error;
      if (this.failNext.remaining === 0) this.failNext = undefined;
      throw err;
    }
  }

  // --- SfdcClient ---------------------------------------------------------

  async describeGlobal(): Promise<SfdcGlobalDescribeEntry[]> {
    this.record("describeGlobal");
    return [...this.describes.values()].map((d) => ({
      name: d.name,
      label: d.label,
      keyPrefix: d.keyPrefix,
      queryable: d.queryable,
      custom: Boolean(d.custom),
      replicateable: d.replicateable,
    }));
  }

  async describe(objectName: string): Promise<SfdcObjectDescribe> {
    this.record("describe", objectName);
    const d = this.describes.get(objectName);
    if (!d)
      throw Object.assign(
        new Error(
          `NOT_FOUND: The requested resource does not exist (${objectName})`,
        ),
        { errorCode: "NOT_FOUND" },
      );
    return d;
  }

  async recordTypes(): Promise<SfdcRecordType[]> {
    this.record("recordTypes");
    if (this.recordTypeRows.length) return this.recordTypeRows;
    const out: SfdcRecordType[] = [];
    for (const d of this.describes.values())
      for (const rt of d.recordTypeInfos)
        out.push({
          Id: rt.recordTypeId,
          SobjectType: d.name,
          DeveloperName: rt.developerName,
          Name: rt.name,
          IsActive: rt.active,
        });
    return out;
  }

  /** Evaluate SOQL against the in-memory rows (shared by query/bulk/count). */
  evaluate(
    soql: string,
    all: boolean,
  ): { parsed: ParsedSoql; rows: SourceRow[] } {
    const parsed = parseSoql(soql);
    const describe = this.describes.get(parsed.object);
    if (!describe && !this.rows.has(parsed.object))
      throw Object.assign(
        new Error(
          `INVALID_TYPE: sObject type '${parsed.object}' is not supported`,
        ),
        { errorCode: "INVALID_TYPE" },
      );
    if (describe) {
      // a mistyped scope/country/order field is INVALID_FIELD on Salesforce
      // (structural, §8.1) — not a predicate that silently evaluates to null
      const known = new Set(describe.fields.map((f) => f.name));
      for (const c of [...parsed.columns, ...parsed.referencedFields])
        if (!c.includes(".") && !known.has(c))
          throw Object.assign(
            new Error(
              `INVALID_FIELD: No such column '${c}' on entity '${parsed.object}'`,
            ),
            { errorCode: "INVALID_FIELD" },
          );
    }
    let rows = (this.rows.get(parsed.object) ?? []).filter(
      (r) => all || !(r.IsDeleted === true || r.IsDeleted === "true"),
    );
    if (parsed.where) rows = rows.filter(parsed.where);
    for (const o of [...parsed.orderBy].reverse()) {
      rows = [...rows].sort((a, b) => {
        const x = norm(getPath(a, o.field));
        const y = norm(getPath(b, o.field));
        if (x === y) return 0;
        if (x === null) return 1;
        if (y === null) return -1;
        const c = x < y ? -1 : 1;
        return o.desc ? -c : c;
      });
    }
    if (parsed.limit !== undefined) rows = rows.slice(0, parsed.limit);
    return { parsed, rows };
  }

  async *query(
    soql: string,
    opts: SfdcQueryOptions = {},
  ): AsyncIterable<SourceRow> {
    this.record("query", soql, opts);
    const { parsed, rows } = this.evaluate(soql, Boolean(opts.all));
    for (const r of rows)
      yield parsed.count ? r : projectRow(r, parsed.columns);
  }

  async count(objectName: string, whereClause?: string): Promise<number> {
    this.record("count", objectName, whereClause);
    const soql = `SELECT COUNT() FROM ${objectName}${whereClause ? ` WHERE ${whereClause}` : ""}`;
    return this.evaluate(soql, false).rows.length;
  }

  async *queryIds(
    objectName: string,
    ids: readonly string[],
    columns: readonly string[],
  ): AsyncIterable<SourceRow> {
    this.record("queryIds", objectName, [...ids], [...columns]);
    const want = new Set(ids.map(to18));
    for (const r of this.rows.get(objectName) ?? [])
      if (want.has(r.Id)) yield projectRow(r, [...columns]);
  }

  async explain(soql: string): Promise<SfdcQueryPlan[]> {
    this.record("explain", soql);
    const { parsed, rows } = this.evaluate(soql, true);
    return [
      {
        cost: rows.length > 200000 ? 2 : 0.1,
        leadingOperationType: parsed.where ? "Index" : "TableScan",
        sobjectCardinality: (this.rows.get(parsed.object) ?? []).length,
      },
    ];
  }

  bulkQuery(soql: string, opts: SfdcBulkQueryOptions = {}): SfdcBulkResult {
    this.record("bulkQuery", soql, opts);
    const jobId =
      opts.resume?.jobId ??
      `750fake${String(++this.jobCounter).padStart(8, "0")}`;
    const { parsed, rows } = this.evaluate(soql, Boolean(opts.all));
    const pageSize = opts.maxRecords ?? this.opts.bulkPageSize;
    const pages: SfdcBulkPage[] = [];
    const startPage = opts.resume?.pageNo ?? 0;
    for (
      let i = 0, n = 0;
      i < rows.length || (rows.length === 0 && n === 0);
      i += pageSize, n++
    ) {
      const slice = rows
        .slice(i, i + pageSize)
        .map((r) => projectRow(r, parsed.columns));
      const isLast = i + pageSize >= rows.length;
      pages.push({
        jobId,
        locator: n === 0 ? null : `loc-${n}`,
        nextLocator: isLast ? null : `loc-${n + 1}`,
        pageNo: n,
        rows: slice.length,
        csv: rowsToCsv(slice, parsed.columns),
        records: slice,
      });
      if (rows.length === 0) break;
    }
    const job = Promise.resolve({
      id: jobId,
      operation: opts.all ? ("queryAll" as const) : ("query" as const),
      object: parsed.object,
      state: "JobComplete" as const,
      numberRecordsProcessed: rows.length,
    });
    const remaining = pages.slice(startPage);
    return {
      job,
      [Symbol.asyncIterator]: async function* () {
        for (const p of remaining) yield p;
      },
    };
  }

  async abortBulkJob(jobId: string): Promise<void> {
    this.record("abortBulkJob", jobId);
  }

  async getDeleted(
    objectName: string,
    start: string,
    end: string,
  ): Promise<SfdcDeletedResult> {
    this.record("getDeleted", objectName, start, end);
    const d = this.describes.get(objectName);
    if (d && !d.replicateable)
      throw Object.assign(
        new Error(`INVALID_TYPE: entity '${objectName}' is not replicable`),
        { errorCode: "INVALID_TYPE" },
      );
    const lo = instantOf(start) ?? Number.NaN;
    const hi = instantOf(end) ?? Number.NaN;
    const list = (this.deleted.get(objectName) ?? []).filter((x) => {
      const t = instantOf(x.deletedDate);
      return t !== undefined && t >= lo && t < hi;
    });
    return {
      deletedRecords: list,
      earliestDateAvailable: "1970-01-01T00:00:00.000Z",
      latestDateCovered: end,
    };
  }

  async getUpdated(
    objectName: string,
    start: string,
    end: string,
  ): Promise<SfdcUpdatedResult> {
    this.record("getUpdated", objectName, start, end);
    const lo = instantOf(start) ?? Number.NaN;
    const hi = instantOf(end) ?? Number.NaN;
    const ids = (this.rows.get(objectName) ?? [])
      .filter((r) => {
        const t = instantOf(r.SystemModstamp);
        return t !== undefined && t >= lo && t < hi && r.IsDeleted !== true;
      })
      .map((r) => r.Id);
    return { ids, latestDateCovered: end };
  }

  async limits(): Promise<SfdcLimits> {
    this.record("limits");
    return {
      DailyApiRequests: { Max: 1000000, Remaining: 900000 },
      DailyBulkV2QueryJobs: { Max: 10000, Remaining: 9000 },
      ...this.opts.limits,
    };
  }

  async serverNow(): Promise<string> {
    this.record("serverNow");
    return this.opts.now;
  }

  async availableVersions(): Promise<string[]> {
    this.record("availableVersions");
    return ["65.0", "66.0", "67.0"];
  }
}
