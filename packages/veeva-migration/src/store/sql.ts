/**
 * Pure SQL builders for the postgres `StateStore` (§2.4). Everything here is
 * deterministic text + positional parameters so it can be unit-tested without
 * a database; `postgres.ts` executes the results through `sql.unsafe`.
 *
 * Column policy: every column named in §2.4 exists with the stated primary
 * keys and indexes; a few are added ("columns may be extended"): `runs.seq`
 * (creation order for `findings.previous`), `id_map.object_type` /
 * `id_map.dry_run` (§2.5.6, §8.9), `reconciliation.*` breakdown columns
 * (§8.8), `country_status` (§4.5) and `schema_migrations`. Timestamps are
 * stored as ISO-8601 text so values round-trip byte-identically with the
 * reference in-memory store (the contract suite compares strings).
 */

export const DEFAULT_SCHEMA = "veeva_migration";
export const SCHEMA_VERSION = 1;

export type PgType =
  | "text"
  | "char(18)"
  | "int"
  | "bigint"
  | "boolean"
  | "jsonb"
  | "text[]";

export interface ColumnDef {
  /** snake_case column name. */
  name: string;
  /** camelCase property on the TS row type. */
  prop: string;
  type: PgType;
  nullable?: boolean;
  /** SQL default expression (verbatim). */
  default?: string;
  /** `bigserial` — never written by the builders, returned on insert. */
  serial?: boolean;
  /** 18-char SFDC id — normalised by the store before it reaches a builder. */
  sfdcId?: boolean;
}

export interface IndexDef {
  name: string;
  columns: string[];
  unique?: boolean;
  where?: string;
}

export interface TableDef {
  name: string;
  columns: ColumnDef[];
  primaryKey: string[];
  indexes?: IndexDef[];
}

export type TableName =
  | "runs"
  | "watermarks"
  | "id_map"
  | "row_results"
  | "pending_fk"
  | "extract_checkpoints"
  | "preflight_findings"
  | "reconciliation"
  | "mapping_snapshots"
  | "fk_index"
  | "audit_log"
  | "probe_results"
  | "country_status"
  | "schema_migrations";

const c = (
  name: string,
  type: PgType,
  opts: Partial<Omit<ColumnDef, "name" | "type">> = {},
): ColumnDef => ({
  name,
  prop: opts.prop ?? snakeToCamel(name),
  type,
  ...opts,
});

export function snakeToCamel(name: string): string {
  return name.replace(/_([a-z0-9])/g, (_, ch: string) => ch.toUpperCase());
}

export const TABLES: Record<TableName, TableDef> = {
  runs: {
    name: "runs",
    columns: [
      c("run_id", "text"),
      c("seq", "bigint", { serial: true }),
      c("mode", "text"),
      c("wave", "text", { nullable: true }),
      c("countries", "text[]"),
      c("started_at", "text"),
      c("finished_at", "text", { nullable: true }),
      c("status", "text"),
      c("tool_version", "text"),
      c("config_hash", "text"),
      c("mapping_hash", "text", { nullable: true }),
      c("source_org_id", "text", { nullable: true }),
      c("source_api_version", "text", { nullable: true }),
      c("target_vault_id", "text", { nullable: true }),
      c("target_vault_dns", "text", { nullable: true }),
      c("target_api_version", "text", { nullable: true }),
      c("sfdc_now_at_start", "text", { nullable: true }),
      c("freeze_at", "text", { nullable: true }),
      c("dry_run", "boolean", { default: "false" }),
    ],
    primaryKey: ["run_id"],
    indexes: [
      { name: "runs_status_started_idx", columns: ["status", "started_at"] },
    ],
  },
  watermarks: {
    name: "watermarks",
    columns: [
      c("object_key", "text"),
      c("country", "text"),
      c("kind", "text"),
      c("value", "text"),
      c("cutoff_date", "text", { nullable: true }),
      c("run_id", "text"),
      c("updated_at", "text"),
    ],
    primaryKey: ["object_key", "country", "kind"],
  },
  id_map: {
    name: "id_map",
    columns: [
      c("object_key", "text"),
      c("sfdc_id", "char(18)", { sfdcId: true }),
      c("vault_dns", "text"),
      c("vault_object", "text"),
      c("vault_id", "text"),
      c("country", "text"),
      c("match_method", "text"),
      c("merged_into", "char(18)", { nullable: true, sfdcId: true }),
      c("first_seen_run", "text"),
      c("last_seen_run", "text"),
      c("source_hash", "text", { nullable: true }),
      c("verified_hash", "text", { nullable: true }),
      c("verified_at", "text", { nullable: true }),
      c("deleted_at", "text", { nullable: true }),
      c("object_type", "text", { nullable: true }),
      c("dry_run", "boolean", { default: "false" }),
    ],
    primaryKey: ["vault_dns", "object_key", "sfdc_id"],
    indexes: [
      {
        name: "id_map_vault_uidx",
        columns: ["vault_dns", "vault_object", "vault_id"],
        unique: true,
        where: "merged_into is null and deleted_at is null",
      },
      {
        name: "id_map_unit_idx",
        columns: ["vault_dns", "object_key", "country"],
      },
      { name: "id_map_dry_run_idx", columns: ["vault_dns"], where: "dry_run" },
    ],
  },
  row_results: {
    name: "row_results",
    columns: [
      c("run_id", "text"),
      c("object_key", "text"),
      c("country", "text"),
      c("sfdc_id", "char(18)", { sfdcId: true }),
      c("batch_no", "int", { nullable: true }),
      c("state", "text"),
      c("error_type", "text", { nullable: true }),
      c("error_message", "text", { nullable: true }),
      c("attempt", "int"),
      c("payload_hash", "text", { nullable: true }),
      c("vault_id", "text", { nullable: true }),
      c("updated_at", "text"),
    ],
    primaryKey: ["run_id", "object_key", "sfdc_id"],
    indexes: [
      {
        name: "row_results_unit_state_idx",
        columns: ["run_id", "object_key", "country", "state"],
      },
    ],
  },
  pending_fk: {
    name: "pending_fk",
    columns: [
      c("run_id", "text"),
      c("object_key", "text"),
      c("country", "text"),
      c("sfdc_id", "char(18)", { sfdcId: true }),
      c("field", "text"),
      c("target_object_key", "text"),
      c("target_sfdc_id", "char(18)", { sfdcId: true }),
      c("attempts", "int"),
      c("resolved_at", "text", { nullable: true }),
    ],
    primaryKey: ["run_id", "object_key", "sfdc_id", "field"],
    indexes: [
      {
        name: "pending_fk_unit_idx",
        columns: ["run_id", "object_key", "country"],
      },
    ],
  },
  extract_checkpoints: {
    name: "extract_checkpoints",
    columns: [
      c("run_id", "text"),
      c("object_key", "text"),
      c("country", "text"),
      c("job_id", "text"),
      c("locator", "text", { nullable: true }),
      c("page_no", "int"),
      c("rows", "int"),
      c("file", "text"),
      c("completed_at", "text", { nullable: true }),
    ],
    primaryKey: ["run_id", "job_id", "page_no"],
    indexes: [
      {
        name: "extract_checkpoints_unit_idx",
        columns: ["run_id", "object_key", "country"],
      },
    ],
  },
  preflight_findings: {
    name: "preflight_findings",
    columns: [
      c("id", "bigint", { serial: true }),
      c("run_id", "text"),
      c("severity", "text"),
      c("code", "text"),
      c("object_key", "text", { nullable: true }),
      c("country", "text", { nullable: true }),
      c("field", "text", { nullable: true }),
      c("detail", "jsonb"),
      c("count", "int", { nullable: true }),
      c("created_at", "text"),
    ],
    primaryKey: ["id"],
    indexes: [{ name: "preflight_findings_run_idx", columns: ["run_id"] }],
  },
  reconciliation: {
    name: "reconciliation",
    columns: [
      c("run_id", "text"),
      c("object_key", "text"),
      c("country", "text"),
      c("sfdc_scope_count", "int", { nullable: true }),
      c("extracted", "int"),
      c("extracted_deleted", "int", { nullable: true }),
      c("closure", "int", { nullable: true }),
      c("transformed", "int"),
      c("skipped", "int"),
      c("skipped_by_reason", "jsonb", { nullable: true }),
      c("pending_fk", "int"),
      c("created", "int"),
      c("updated", "int"),
      c("unchanged", "int"),
      c("failed", "int"),
      c("failed_by_type", "jsonb", { nullable: true }),
      c("deleted", "int"),
      c("deleted_applied", "int", { nullable: true }),
      c("deleted_ignored", "int", { nullable: true }),
      c("deleted_pending", "int", { nullable: true }),
      c("vault_count", "int", { nullable: true }),
      c("agg_hash_src", "text", { nullable: true }),
      c("agg_hash_tgt", "text", { nullable: true }),
      c("status", "text"),
    ],
    primaryKey: ["run_id", "object_key", "country"],
  },
  mapping_snapshots: {
    name: "mapping_snapshots",
    columns: [
      c("mapping_hash", "text"),
      c("object_key", "text"),
      c("country", "text"),
      c("materialised", "jsonb"),
      c("created_at", "text"),
    ],
    primaryKey: ["mapping_hash", "object_key", "country"],
    indexes: [
      {
        name: "mapping_snapshots_unit_idx",
        columns: ["object_key", "country", "created_at"],
      },
    ],
  },
  fk_index: {
    name: "fk_index",
    columns: [
      c("object_key", "text"),
      c("sfdc_id", "char(18)", { sfdcId: true }),
      c("field", "text"),
      c("target_object_key", "text"),
      c("target_sfdc_id", "char(18)", { sfdcId: true }),
      c("run_id", "text"),
    ],
    primaryKey: ["object_key", "sfdc_id", "field"],
    indexes: [
      {
        name: "fk_index_target_idx",
        columns: ["target_object_key", "target_sfdc_id"],
      },
    ],
  },
  audit_log: {
    name: "audit_log",
    columns: [
      c("id", "bigint", { serial: true }),
      c("run_id", "text", { nullable: true }),
      c("at", "text"),
      c("actor", "text"),
      c("event", "text"),
      c("detail", "jsonb", { nullable: true }),
    ],
    primaryKey: ["id"],
    indexes: [
      { name: "audit_log_run_idx", columns: ["run_id"] },
      { name: "audit_log_event_idx", columns: ["event"] },
    ],
  },
  probe_results: {
    name: "probe_results",
    columns: [
      c("vault_dns", "text"),
      c("probe", "text"),
      c("result", "jsonb"),
      c("checked_at", "text"),
    ],
    primaryKey: ["vault_dns", "probe"],
  },
  country_status: {
    name: "country_status",
    columns: [c("country", "text"), c("frozen_at", "text")],
    primaryKey: ["country"],
  },
  schema_migrations: {
    name: "schema_migrations",
    columns: [c("version", "int"), c("applied_at", "text")],
    primaryKey: ["version"],
  },
};

export const TABLE_NAMES = Object.keys(TABLES) as TableName[];

// ---------------------------------------------------------------------------
// Identifiers / DDL
// ---------------------------------------------------------------------------

export function ident(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name))
    throw new Error(`invalid SQL identifier: ${name}`);
  return `"${name}"`;
}

export function qualified(table: TableName, schema = DEFAULT_SCHEMA): string {
  return `${ident(schema)}.${ident(table)}`;
}

function columnDdl(col: ColumnDef): string {
  if (col.serial) return `${ident(col.name)} bigserial`;
  const parts = [ident(col.name), col.type];
  if (!col.nullable) parts.push("not null");
  if (col.default !== undefined) parts.push(`default ${col.default}`);
  return parts.join(" ");
}

/** `create … if not exists` statements for the whole schema, in order. */
export function ddlStatements(schema = DEFAULT_SCHEMA): string[] {
  const out: string[] = [`create schema if not exists ${ident(schema)}`];
  for (const table of TABLE_NAMES) {
    const def = TABLES[table];
    const cols = def.columns.map(columnDdl);
    cols.push(`primary key (${def.primaryKey.map(ident).join(", ")})`);
    out.push(
      `create table if not exists ${qualified(table, schema)} (\n  ${cols.join(",\n  ")}\n)`,
    );
    for (const idx of def.indexes ?? []) {
      out.push(
        `create ${idx.unique ? "unique " : ""}index if not exists ${ident(idx.name)} on ${qualified(table, schema)} (${idx.columns.map(ident).join(", ")})${idx.where ? ` where ${idx.where}` : ""}`,
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Row ↔ record mapping
// ---------------------------------------------------------------------------

function writableColumns(table: TableName): ColumnDef[] {
  return TABLES[table].columns.filter((col) => !col.serial);
}

/** JS value → parameter value for one column (`undefined` → `null`; jsonb stays a JS value). */
export function toDbValue(col: ColumnDef, value: unknown): unknown {
  if (value === undefined || value === null) {
    if (col.nullable) return null;
    if (col.default !== undefined)
      return col.default === "false" ? false : null;
    return null;
  }
  switch (col.type) {
    case "jsonb":
      // the driver serialises jsonb itself (JSON.stringify); never pre-encode
      return value;
    case "text[]":
      return Array.isArray(value) ? value.map(String) : [String(value)];
    case "boolean":
      return Boolean(value);
    case "int":
    case "bigint":
      return typeof value === "number" ? value : Number(value);
    default:
      return String(value);
  }
}

/** DB record (snake_case, nulls) → row (camelCase, nulls stripped). */
export function fromRecord<T>(
  table: TableName,
  rec: Record<string, unknown>,
): T {
  const out: Record<string, unknown> = {};
  for (const col of TABLES[table].columns) {
    const v = rec[col.name];
    if (v === null || v === undefined) continue;
    if (col.type === "bigint" || col.type === "int") out[col.prop] = Number(v);
    else out[col.prop] = v;
  }
  return out as T;
}

// ---------------------------------------------------------------------------
// Statement builders
// ---------------------------------------------------------------------------

export interface Statement {
  text: string;
  params: unknown[];
}

/** Collects positional parameters. */
export class Params {
  readonly values: unknown[] = [];
  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

export interface UpsertOptions {
  schema?: string;
  /**
   * Conflict handling on the primary key: `"nothing"`, or `"update"` (every
   * non-key column is overwritten from `excluded`) optionally minus `keep`
   * (columns that retain their stored value, e.g. `first_seen_run`).
   */
  onConflict?: "nothing" | "update" | "none";
  keep?: string[];
  returning?: string[];
}

/**
 * Parameter type and projection used inside the `unnest(…)` insert for one
 * column. Two driver/server quirks are absorbed here: an array-typed column
 * cannot travel as `text[][]` (unnest would flatten it), so it is passed as
 * one JSON document per row; and `postgres` declares a JS boolean array with
 * the scalar boolean OID (and its element serializer turns the `'true'` text
 * workaround into `f`), so booleans travel as text and are cast per row.
 */
export function unnestColumn(col: ColumnDef): {
  cast: string;
  projection: string;
  encode: (value: unknown) => unknown;
} {
  const ref = `t.${ident(col.name)}`;
  switch (col.type) {
    case "text[]":
      return {
        cast: "jsonb[]",
        projection: `array(select jsonb_array_elements_text(${ref}->'v'))::text[]`,
        // one JSON document per row, wrapped in an object: the driver would
        // treat a bare nested array as a multi-dimensional array literal
        encode: (v) => {
          const arr = toDbValue(col, v);
          return arr === null ? null : { v: arr };
        },
      };
    case "boolean":
      return {
        cast: "text[]",
        projection: `${ref}::boolean`,
        encode: (v) => {
          const b = toDbValue(col, v);
          return b === null ? null : b ? "true" : "false";
        },
      };
    default:
      return {
        cast: `${col.type}[]`,
        projection: ref,
        encode: (v) => toDbValue(col, v),
      };
  }
}

/**
 * Bulk `insert … select from unnest($1::type[], …)` (one statement per batch,
 * §2.4 "≥ 500 rows per statement"). Rows are camelCase objects; columns
 * missing from a row are written as `null`/default.
 */
export function buildUpsert(
  table: TableName,
  rows: ReadonlyArray<Record<string, unknown>>,
  opts: UpsertOptions = {},
): Statement {
  const schema = opts.schema ?? DEFAULT_SCHEMA;
  const def = TABLES[table];
  const cols = writableColumns(table);
  const params = new Params();
  const specs = cols.map(unnestColumn);
  const arrays = cols.map((col, i) =>
    params.add(rows.map((row) => specs[i].encode(row[col.prop]))),
  );
  const names = cols.map((col) => ident(col.name)).join(", ");
  const unnest = cols
    .map((_, i) => `${arrays[i]}::${specs[i].cast}`)
    .join(", ");
  const projection = specs.map((s) => s.projection).join(", ");
  let text = `insert into ${qualified(table, schema)} (${names})\nselect ${projection} from unnest(${unnest}) as t(${names})`;
  const mode = opts.onConflict ?? "update";
  if (mode === "nothing") {
    text += `\non conflict (${def.primaryKey.map(ident).join(", ")}) do nothing`;
  } else if (mode === "update") {
    const keep = new Set([...def.primaryKey, ...(opts.keep ?? [])]);
    const sets = cols
      .filter((col) => !keep.has(col.name))
      .map((col) => `${ident(col.name)} = excluded.${ident(col.name)}`);
    text +=
      sets.length === 0
        ? `\non conflict (${def.primaryKey.map(ident).join(", ")}) do nothing`
        : `\non conflict (${def.primaryKey.map(ident).join(", ")}) do update set ${sets.join(", ")}`;
  }
  if (opts.returning?.length)
    text += `\nreturning ${opts.returning.map(ident).join(", ")}`;
  return { text, params: params.values };
}

export interface Condition {
  column: string;
  /** default `=`; `any` → `= any($n::type[])`. */
  op?: "=" | "!=" | "any" | "is null" | "is not null" | "<" | ">";
  value?: unknown;
  /** element type for `any` (defaults to the column type). */
  arrayType?: PgType;
}

/** `where a = $1 and b = any($2::text[]) and c is null` (empty → ""). */
export function buildWhere(
  table: TableName,
  conditions: ReadonlyArray<Condition | undefined | false>,
  params: Params,
): string {
  const parts: string[] = [];
  for (const cond of conditions) {
    if (!cond) continue;
    const col = TABLES[table].columns.find((x) => x.name === cond.column);
    if (!col) throw new Error(`unknown column ${table}.${cond.column}`);
    const op = cond.op ?? "=";
    if (op === "is null" || op === "is not null") {
      parts.push(`${ident(col.name)} ${op}`);
    } else if (op === "any") {
      const values = Array.isArray(cond.value) ? cond.value : [cond.value];
      const type = cond.arrayType ?? col.type;
      parts.push(
        `${ident(col.name)} = any(${params.add(values.map((v) => toDbValue(col, v)))}::${type}[])`,
      );
    } else {
      parts.push(
        `${ident(col.name)} ${op} ${params.add(toDbValue(col, cond.value))}`,
      );
    }
  }
  return parts.length ? `where ${parts.join(" and ")}` : "";
}

export interface SelectOptions {
  schema?: string;
  where?: ReadonlyArray<Condition | undefined | false>;
  orderBy?: string[];
  limit?: number;
  offset?: number;
  /** projection; default `*`. */
  columns?: string[];
}

export function buildSelect(
  table: TableName,
  opts: SelectOptions = {},
): Statement {
  const params = new Params();
  const cols = opts.columns?.length ? opts.columns.map(ident).join(", ") : "*";
  const parts = [
    `select ${cols} from ${qualified(table, opts.schema ?? DEFAULT_SCHEMA)}`,
  ];
  const where = buildWhere(table, opts.where ?? [], params);
  if (where) parts.push(where);
  if (opts.orderBy?.length) parts.push(`order by ${opts.orderBy.join(", ")}`);
  if (opts.limit !== undefined) parts.push(`limit ${params.add(opts.limit)}`);
  if (opts.offset) parts.push(`offset ${params.add(opts.offset)}`);
  return { text: parts.join("\n"), params: params.values };
}

export function buildCount(
  table: TableName,
  where: ReadonlyArray<Condition | undefined | false>,
  schema = DEFAULT_SCHEMA,
): Statement {
  const params = new Params();
  const w = buildWhere(table, where, params);
  return {
    text: `select count(*)::int as n from ${qualified(table, schema)}${w ? `\n${w}` : ""}`,
    params: params.values,
  };
}

/** `update t set a = $1, b = $2 where …` — `set` values are camelCase props. */
export interface MutationOptions {
  schema?: string;
  returning?: string[];
}

export function buildUpdate(
  table: TableName,
  set: Record<string, unknown>,
  where: ReadonlyArray<Condition | undefined | false>,
  opts: MutationOptions = {},
): Statement {
  const schema = opts.schema ?? DEFAULT_SCHEMA;
  const params = new Params();
  const sets: string[] = [];
  for (const [prop, value] of Object.entries(set)) {
    const col = TABLES[table].columns.find((x) => x.prop === prop);
    if (!col) throw new Error(`unknown property ${table}.${prop}`);
    if (col.serial) continue;
    sets.push(`${ident(col.name)} = ${params.add(toDbValue(col, value))}`);
  }
  if (sets.length === 0)
    throw new Error(`buildUpdate(${table}): nothing to set`);
  const w = buildWhere(table, where, params);
  if (!w)
    throw new Error(`buildUpdate(${table}): refusing an unfiltered update`);
  return {
    text: `update ${qualified(table, schema)} set ${sets.join(", ")}\n${w}${returning(opts)}`,
    params: params.values,
  };
}

function returning(opts: MutationOptions): string {
  return opts.returning?.length
    ? `\nreturning ${opts.returning.map(ident).join(", ")}`
    : "";
}

export function buildDelete(
  table: TableName,
  where: ReadonlyArray<Condition | undefined | false>,
  opts: MutationOptions = {},
): Statement {
  const schema = opts.schema ?? DEFAULT_SCHEMA;
  const params = new Params();
  const w = buildWhere(table, where, params);
  if (!w)
    throw new Error(`buildDelete(${table}): refusing an unfiltered delete`);
  return {
    text: `delete from ${qualified(table, schema)}\n${w}${returning(opts)}`,
    params: params.values,
  };
}

/**
 * Collapse duplicate keys inside one batch (postgres rejects a second hit on
 * the same row within a single `on conflict do update`). Last write wins;
 * `keepFirst` props (e.g. `firstSeenRun`, `attempts`) come from the first
 * occurrence, matching sequential single-row upserts.
 */
export function dedupeRows<T extends Record<string, unknown>>(
  rows: readonly T[],
  keyOf: (row: T) => string,
  keepFirst: ReadonlyArray<keyof T> = [],
): T[] {
  const byKey = new Map<string, T>();
  for (const row of rows) {
    const key = keyOf(row);
    const first = byKey.get(key);
    if (!first) {
      byKey.set(key, row);
      continue;
    }
    const merged: T = { ...row };
    for (const prop of keepFirst) merged[prop] = first[prop];
    byKey.set(key, merged);
  }
  return [...byKey.values()];
}

/** Split an array into chunks of `size` (last one may be shorter). */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size <= 0) throw new Error("chunk size must be positive");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}
