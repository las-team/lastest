/**
 * Postgres `StateStore` (§2.4) on the `veeva_migration` schema, using the
 * `postgres` driver with raw SQL built by `./sql.ts`. Semantics mirror the
 * reference `MemoryStateStore` (the contract suite runs against both):
 *
 * - every SFDC id is normalised to 18 chars before it is keyed or compared;
 * - the id map is scoped to the bound `vaultDns` (§2.4: one map per vault);
 * - bulk writes are single `insert … select from unnest(…)` statements
 *   (`batchSize` rows each), duplicates within a batch collapsed last-wins;
 * - `merged_into` / `deleted_at` are soft flags (§3.4, §4.4); the partial
 *   unique index `id_map_vault_uidx` enforces one live SFDC row per Vault id.
 *
 * `migrate()` (or `connect()`) creates schema/tables/indexes if missing under
 * an advisory lock, so several processes may start concurrently.
 */
import postgres from "postgres";
import type { Sql } from "postgres";
import { hash32 } from "../hash";
import { getLogger } from "../logger";
import { to18 } from "../transform/ids";
import type {
  AuditLogEntry,
  CountryCode,
  ExtractCheckpoint,
  FkIndexRow,
  IdMapRow,
  MappingSnapshot,
  ObjectKey,
  PendingFk,
  ProbeResult,
  ReconciliationRow,
  RowResult,
  RowState,
  RunRecord,
  StoredFinding,
  Watermark,
} from "../types";
import {
  buildCount,
  buildDelete,
  buildSelect,
  buildUpdate,
  buildUpsert,
  buildWhere,
  chunk,
  DEFAULT_SCHEMA,
  ddlStatements,
  dedupeRows,
  fromRecord,
  ident,
  Params,
  qualified,
  SCHEMA_VERSION,
  type Statement,
  type TableName,
} from "./sql";
import type {
  AuditLogRepo,
  CheckpointsRepo,
  CountryStatusRepo,
  FindingsRepo,
  FkIndexRepo,
  IdMapRepo,
  MappingSnapshotsRepo,
  PendingFkRepo,
  ProbeResultsRepo,
  ReconciliationRepo,
  RowResultsRepo,
  RunsRepo,
  StateStore,
  WatermarksRepo,
} from "./types";

type Rec = Record<string, unknown>;

/**
 * Minimal execution surface the store needs — implemented over `postgres`
 * by `postgresExecutor()` and by a recording fake in the unit tests.
 */
export interface SqlExecutor {
  query(text: string, params?: unknown[]): Promise<Rec[]>;
  /** Server-side cursor: yields batches of rows. */
  cursor(
    text: string,
    params: unknown[],
    batchSize: number,
  ): AsyncIterable<Rec[]>;
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
  end(): Promise<void>;
}

/**
 * `postgres` infers the type of an array parameter from its first element and
 * declares a boolean array as scalar `boolean`, which makes `$n::boolean[]`
 * fail with "cannot cast type boolean to boolean[]". Sending booleans inside
 * arrays as `'true'`/`'false'` text leaves the type to the server-side cast.
 */
export function driverParams(params: unknown[]): unknown[] {
  return params.map((p) =>
    Array.isArray(p) && p.some((v) => typeof v === "boolean")
      ? p.map((v) => (typeof v === "boolean" ? (v ? "true" : "false") : v))
      : p,
  );
}

/** Adapt a `postgres` client (or transaction handle) to `SqlExecutor`. */
export function postgresExecutor(sql: Sql): SqlExecutor {
  type Args = Parameters<Sql["unsafe"]>[1];
  return {
    query: async (text, params = []) =>
      [...(await sql.unsafe(text, driverParams(params) as Args))] as Rec[],
    cursor: (text, params, batchSize) =>
      sql
        .unsafe(text, driverParams(params) as Args)
        .cursor(batchSize) as AsyncIterable<Rec[]>,
    transaction: (fn) =>
      sql.begin((tx) => fn(postgresExecutor(tx as unknown as Sql))) as Promise<
        Awaited<ReturnType<typeof fn>>
      >,
    end: () => sql.end({ timeout: 5 }),
  };
}

export interface PostgresStateStoreOptions {
  vaultDns: string;
  /** `postgres://…` connection string (ignored when `executor` is given). */
  databaseUrl?: string;
  /** Pre-built executor (tests, shared pools). */
  executor?: SqlExecutor;
  /** Schema namespace (default `veeva_migration`). */
  schema?: string;
  /** Rows per bulk statement (default 1000; §2.4 asks for ≥ 500). */
  batchSize?: number;
  /** Pool size when `databaseUrl` is used (default 4). */
  maxConnections?: number;
}

const ADVISORY_LOCK_KEY = "veeva_migration.migrate";

export class PostgresStateStore implements StateStore {
  readonly vaultDns: string;
  readonly schema: string;
  readonly batchSize: number;
  private readonly db: SqlExecutor;
  private readonly log = getLogger("Store", { driver: "postgres" });

  constructor(opts: PostgresStateStoreOptions) {
    this.vaultDns = opts.vaultDns;
    this.schema = opts.schema ?? DEFAULT_SCHEMA;
    this.batchSize = opts.batchSize ?? 1000;
    ident(this.schema); // validate early
    if (opts.executor) this.db = opts.executor;
    else if (opts.databaseUrl)
      this.db = postgresExecutor(
        postgres(opts.databaseUrl, {
          max: opts.maxConnections ?? 4,
          prepare: false,
          onnotice: () => undefined,
        }),
      );
    else
      throw new Error("PostgresStateStore: databaseUrl or executor required");
  }

  /** Connect and run the create-if-not-exists migration. */
  static async connect(
    opts: PostgresStateStoreOptions,
  ): Promise<PostgresStateStore> {
    const store = new PostgresStateStore(opts);
    await store.migrate();
    return store;
  }

  // ---------------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------------

  private t(table: TableName): string {
    return qualified(table, this.schema);
  }

  private run(stmt: Statement, db: SqlExecutor = this.db): Promise<Rec[]> {
    return db.query(stmt.text, stmt.params);
  }

  private async one<T>(
    table: TableName,
    stmt: Statement,
    db: SqlExecutor = this.db,
  ): Promise<T | undefined> {
    const rows = await this.run(stmt, db);
    return rows.length ? fromRecord<T>(table, rows[0]) : undefined;
  }

  private async many<T>(
    table: TableName,
    stmt: Statement,
    db: SqlExecutor = this.db,
  ): Promise<T[]> {
    const rows = await this.run(stmt, db);
    return rows.map((r) => fromRecord<T>(table, r));
  }

  private async count(stmt: Statement): Promise<number> {
    const rows = await this.run(stmt);
    return Number(rows[0]?.n ?? 0);
  }

  private select(
    table: TableName,
    opts: Omit<Parameters<typeof buildSelect>[1], "schema"> = {},
  ): Statement {
    return buildSelect(table, { ...opts, schema: this.schema });
  }

  /** Bulk upsert in `batchSize` chunks; unique-index violations are re-thrown with the index name. */
  private async upsertChunks(
    table: TableName,
    rows: Rec[],
    opts: { keep?: string[]; onConflict?: "nothing" | "update" | "none" } = {},
    db: SqlExecutor = this.db,
  ): Promise<void> {
    for (const part of chunk(rows, this.batchSize)) {
      try {
        await this.run(
          buildUpsert(table, part, { ...opts, schema: this.schema }),
          db,
        );
      } catch (err) {
        throw translateError(err);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // migration
  // ---------------------------------------------------------------------------

  async migrate(): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.query("select pg_advisory_xact_lock($1)", [
        hash32(ADVISORY_LOCK_KEY),
      ]);
      for (const text of ddlStatements(this.schema)) await tx.query(text);
      await tx.query(
        `insert into ${this.t("schema_migrations")} ("version", "applied_at") values ($1, $2) on conflict ("version") do nothing`,
        [SCHEMA_VERSION, new Date().toISOString()],
      );
    });
    this.log.debug({ schema: this.schema }, "state store schema ready");
  }

  async close(): Promise<void> {
    await this.db.end();
  }

  // ---------------------------------------------------------------------------
  // repos
  // ---------------------------------------------------------------------------

  runs: RunsRepo = {
    create: async (run) => {
      try {
        await this.run(
          buildUpsert("runs", [run as unknown as Rec], {
            onConflict: "none",
            schema: this.schema,
          }),
        );
      } catch (err) {
        const e = translateError(err);
        throw isUniqueViolation(err)
          ? new Error(`run ${run.runId} already exists`)
          : e;
      }
    },
    get: (runId) =>
      this.one<RunRecord>(
        "runs",
        this.select("runs", { where: [{ column: "run_id", value: runId }] }),
      ),
    update: async (runId, patch) => {
      const set: Rec = {};
      // `undefined` means "leave as is" (the memory/file stores drop it via
      // JSON clone); only an explicit `null` clears a nullable column
      for (const [k, v] of Object.entries(patch))
        if (k !== "runId" && v !== undefined) set[k] = v;
      if (Object.keys(set).length === 0) {
        const cur = await this.runs.get(runId);
        if (!cur) throw new Error(`run ${runId} not found`);
        return;
      }
      const rows = await this.run(
        buildUpdate("runs", set, [{ column: "run_id", value: runId }], {
          schema: this.schema,
          returning: ["run_id"],
        }),
      );
      if (rows.length === 0) throw new Error(`run ${runId} not found`);
    },
    list: (filter = {}) =>
      this.many<RunRecord>(
        "runs",
        this.select("runs", {
          where: [
            filter.mode !== undefined && { column: "mode", value: filter.mode },
            filter.status !== undefined && {
              column: "status",
              value: filter.status,
            },
          ],
          orderBy: ['"started_at" desc', '"seq" desc'],
          limit: filter.limit,
        }),
      ),
    latestSucceeded: () =>
      this.one<RunRecord>(
        "runs",
        this.select("runs", {
          where: [{ column: "status", value: "succeeded" }],
          orderBy: ['"started_at" desc', '"seq" desc'],
          limit: 1,
        }),
      ),
  };

  watermarks: WatermarksRepo = {
    get: (objectKey, country, kind) =>
      this.one<Watermark>(
        "watermarks",
        this.select("watermarks", {
          where: [
            { column: "object_key", value: objectKey },
            { column: "country", value: country },
            { column: "kind", value: kind },
          ],
        }),
      ),
    set: (w) => this.upsertChunks("watermarks", [w as unknown as Rec]),
    list: (filter = {}) =>
      this.many<Watermark>(
        "watermarks",
        this.select("watermarks", {
          where: [
            filter.objectKey !== undefined && {
              column: "object_key",
              value: filter.objectKey,
            },
            filter.country !== undefined && {
              column: "country",
              value: filter.country,
            },
          ],
          orderBy: ['"object_key"', '"country"', '"kind"'],
        }),
      ),
  };

  private idKeyWhere(objectKey: ObjectKey, sfdcId: string) {
    return [
      { column: "vault_dns", value: this.vaultDns },
      { column: "object_key", value: objectKey },
      { column: "sfdc_id", value: to18(sfdcId) },
    ];
  }

  private normaliseIdMapRow(row: IdMapRow): IdMapRow {
    return {
      ...row,
      sfdcId: to18(row.sfdcId),
      mergedInto: row.mergedInto ? to18(row.mergedInto) : row.mergedInto,
      vaultDns: this.vaultDns,
      dryRun: row.dryRun ?? false,
    };
  }

  idMap: IdMapRepo = {
    get: (objectKey, sfdcId) =>
      this.one<IdMapRow>(
        "id_map",
        this.select("id_map", { where: this.idKeyWhere(objectKey, sfdcId) }),
      ),
    put: (row) => this.idMap.putMany([row]),
    putMany: async (rows) => {
      if (rows.length === 0) return;
      const prepared = dedupeRows(
        rows.map((r) => this.normaliseIdMapRow(r) as unknown as Rec),
        (r) => `${String(r.objectKey)}|${String(r.sfdcId)}`,
        ["firstSeenRun"],
      );
      await this.upsertChunks("id_map", prepared, { keep: ["first_seen_run"] });
    },
    bulkGet: async (objectKey, sfdcIds) => {
      const out = new Map<string, IdMapRow>();
      const ids = [...new Set(sfdcIds.map((id) => to18(id)))];
      for (const part of chunk(ids, 5000)) {
        const rows = await this.many<IdMapRow>(
          "id_map",
          this.select("id_map", {
            where: [
              { column: "vault_dns", value: this.vaultDns },
              { column: "object_key", value: objectKey },
              { column: "sfdc_id", op: "any", value: part },
            ],
          }),
        );
        for (const r of rows) out.set(r.sfdcId, r);
      }
      return out;
    },
    byVaultId: (vaultObject, vaultId) =>
      this.one<IdMapRow>(
        "id_map",
        this.select("id_map", {
          where: [
            { column: "vault_dns", value: this.vaultDns },
            { column: "vault_object", value: vaultObject },
            { column: "vault_id", value: vaultId },
            { column: "merged_into", op: "is null" },
            { column: "deleted_at", op: "is null" },
          ],
          limit: 1,
        }),
      ),
    markDeleted: async (objectKey, sfdcId, deletedAt) => {
      await this.run(
        buildUpdate(
          "id_map",
          { deletedAt },
          this.idKeyWhere(objectKey, sfdcId),
          {
            schema: this.schema,
          },
        ),
      );
    },
    merge: async (objectKey, loser, survivor, runId) => {
      const survivorId = to18(survivor);
      const loserId = to18(loser);
      await this.db.transaction(async (tx) => {
        const s = await this.one<IdMapRow>(
          "id_map",
          this.select("id_map", {
            where: this.idKeyWhere(objectKey, survivorId),
          }),
          tx,
        );
        if (!s) throw new Error(`merge survivor ${survivor} not in id map`);
        const l = await this.one<IdMapRow>(
          "id_map",
          this.select("id_map", { where: this.idKeyWhere(objectKey, loserId) }),
          tx,
        );
        if (l) {
          await this.run(
            buildUpdate(
              "id_map",
              {
                mergedInto: survivorId,
                vaultId: s.vaultId,
                matchMethod: "merged",
                lastSeenRun: runId,
              },
              this.idKeyWhere(objectKey, loserId),
              { schema: this.schema },
            ),
            tx,
          );
        } else {
          const row: IdMapRow = {
            ...s,
            sfdcId: loserId,
            mergedInto: survivorId,
            matchMethod: "merged",
            firstSeenRun: runId,
            lastSeenRun: runId,
            sourceHash: null,
            verifiedHash: null,
            verifiedAt: null,
          };
          await this.upsertChunks(
            "id_map",
            [this.normaliseIdMapRow(row) as unknown as Rec],
            { keep: ["first_seen_run"] },
            tx,
          );
        }
      });
    },
    setSourceHash: async (objectKey, sfdcId, sourceHash, runId) => {
      await this.run(
        buildUpdate(
          "id_map",
          { sourceHash, lastSeenRun: runId },
          this.idKeyWhere(objectKey, sfdcId),
          { schema: this.schema },
        ),
      );
    },
    setVerified: async (objectKey, sfdcId, verifiedHash, verifiedAt) => {
      await this.run(
        buildUpdate(
          "id_map",
          { verifiedHash, verifiedAt },
          this.idKeyWhere(objectKey, sfdcId),
          { schema: this.schema },
        ),
      );
    },
    count: (objectKey, country) =>
      this.count(
        buildCount(
          "id_map",
          [
            { column: "vault_dns", value: this.vaultDns },
            { column: "object_key", value: objectKey },
            country !== undefined && { column: "country", value: country },
            { column: "deleted_at", op: "is null" },
            { column: "merged_into", op: "is null" },
          ],
          this.schema,
        ),
      ),
    iterate: (objectKey, country) => {
      const stmt = this.select("id_map", {
        where: [
          { column: "vault_dns", value: this.vaultDns },
          { column: "object_key", value: objectKey },
          country !== undefined && { column: "country", value: country },
        ],
        orderBy: ['"sfdc_id"'],
      });
      const db = this.db;
      const batch = this.batchSize;
      return (async function* () {
        for await (const rows of db.cursor(stmt.text, stmt.params, batch))
          for (const r of rows) yield fromRecord<IdMapRow>("id_map", r);
      })();
    },
    purgeDryRun: async () => {
      const rows = await this.run(
        buildDelete(
          "id_map",
          [
            { column: "vault_dns", value: this.vaultDns },
            { column: "dry_run", value: true },
          ],
          { schema: this.schema, returning: ["sfdc_id"] },
        ),
      );
      return rows.length;
    },
  };

  rowResults: RowResultsRepo = {
    upsert: async (rows) => {
      if (rows.length === 0) return;
      const prepared = dedupeRows(
        rows.map((r) => ({ ...r, sfdcId: to18(r.sfdcId) }) as unknown as Rec),
        (r) => `${String(r.runId)}|${String(r.objectKey)}|${String(r.sfdcId)}`,
      );
      await this.upsertChunks("row_results", prepared);
    },
    get: (runId, objectKey, sfdcId) =>
      this.one<RowResult>(
        "row_results",
        this.select("row_results", {
          where: [
            { column: "run_id", value: runId },
            { column: "object_key", value: objectKey },
            { column: "sfdc_id", value: to18(sfdcId) },
          ],
        }),
      ),
    query: (filter) => {
      const states =
        filter.state === undefined
          ? undefined
          : Array.isArray(filter.state)
            ? filter.state
            : [filter.state];
      return this.many<RowResult>(
        "row_results",
        this.select("row_results", {
          where: [
            { column: "run_id", value: filter.runId },
            filter.objectKey !== undefined && {
              column: "object_key",
              value: filter.objectKey,
            },
            filter.country !== undefined && {
              column: "country",
              value: filter.country,
            },
            states !== undefined && {
              column: "state",
              op: "any",
              value: states,
            },
            filter.errorType !== undefined && {
              column: "error_type",
              value: filter.errorType,
            },
            filter.batchNo !== undefined && {
              column: "batch_no",
              value: filter.batchNo,
            },
          ],
          orderBy: ['"object_key"', '"country"', '"sfdc_id"'],
          limit: filter.limit,
          offset: filter.offset,
        }),
      );
    },
    countByState: async (runId, objectKey, country) => {
      const params = new Params();
      const where = buildWhere(
        "row_results",
        [
          { column: "run_id", value: runId },
          { column: "object_key", value: objectKey },
          { column: "country", value: country },
        ],
        params,
      );
      const rows = await this.db.query(
        `select "state", count(*)::int as n from ${this.t("row_results")} ${where} group by "state"`,
        params.values,
      );
      const out: Partial<Record<RowState, number>> = {};
      for (const r of rows) out[r.state as RowState] = Number(r.n);
      return out;
    },
    countFailedByType: async (runId, objectKey, country) => {
      const params = new Params();
      const where = buildWhere(
        "row_results",
        [
          { column: "run_id", value: runId },
          { column: "object_key", value: objectKey },
          { column: "country", value: country },
          { column: "state", value: "failed" },
        ],
        params,
      );
      const rows = await this.db.query(
        `select coalesce("error_type", 'UNKNOWN') as t, count(*)::int as n from ${this.t("row_results")} ${where} group by 1`,
        params.values,
      );
      const out: Record<string, number> = {};
      for (const r of rows) out[String(r.t)] = Number(r.n);
      return out;
    },
  };

  private pendingWhere(
    runId: string,
    objectKey: ObjectKey,
    sfdcId: string,
    field: string,
  ) {
    return [
      { column: "run_id", value: runId },
      { column: "object_key", value: objectKey },
      { column: "sfdc_id", value: to18(sfdcId) },
      { column: "field", value: field },
    ];
  }

  pendingFk: PendingFkRepo = {
    add: async (rows) => {
      if (rows.length === 0) return;
      const prepared = dedupeRows(
        rows.map(
          (r) =>
            ({
              ...r,
              sfdcId: to18(r.sfdcId),
              targetSfdcId: to18(r.targetSfdcId),
            }) as unknown as Rec,
        ),
        (r) =>
          `${String(r.runId)}|${String(r.objectKey)}|${String(r.sfdcId)}|${String(r.field)}`,
        ["attempts"],
      );
      await this.upsertChunks("pending_fk", prepared, { keep: ["attempts"] });
    },
    list: (runId, filter = {}) =>
      this.many<PendingFk>(
        "pending_fk",
        this.select("pending_fk", {
          where: [
            { column: "run_id", value: runId },
            filter.objectKey !== undefined && {
              column: "object_key",
              value: filter.objectKey,
            },
            filter.country !== undefined && {
              column: "country",
              value: filter.country,
            },
            filter.unresolvedOnly === true && {
              column: "resolved_at",
              op: "is null",
            },
          ],
          orderBy: ['"object_key"', '"sfdc_id"', '"field"'],
        }),
      ),
    resolve: async (runId, objectKey, sfdcId, field, resolvedAt) => {
      await this.run(
        buildUpdate(
          "pending_fk",
          { resolvedAt },
          this.pendingWhere(runId, objectKey, sfdcId, field),
          { schema: this.schema },
        ),
      );
    },
    bumpAttempts: async (runId, objectKey, sfdcId, field) => {
      const params = new Params();
      const where = buildWhere(
        "pending_fk",
        this.pendingWhere(runId, objectKey, sfdcId, field),
        params,
      );
      await this.db.query(
        `update ${this.t("pending_fk")} set "attempts" = "attempts" + 1 ${where}`,
        params.values,
      );
    },
    countUnresolved: (runId, objectKey, country) =>
      this.count(
        buildCount(
          "pending_fk",
          [
            { column: "run_id", value: runId },
            { column: "object_key", value: objectKey },
            { column: "country", value: country },
            { column: "resolved_at", op: "is null" },
          ],
          this.schema,
        ),
      ),
  };

  fkIndex: FkIndexRepo = {
    put: async (rows) => {
      if (rows.length === 0) return;
      const prepared = dedupeRows(
        rows.map(
          (r) =>
            ({
              ...r,
              sfdcId: to18(r.sfdcId),
              targetSfdcId: to18(r.targetSfdcId),
            }) as unknown as Rec,
        ),
        (r) => `${String(r.objectKey)}|${String(r.sfdcId)}|${String(r.field)}`,
      );
      await this.upsertChunks("fk_index", prepared);
    },
    childrenOf: (targetObjectKey, targetSfdcId) =>
      this.many<FkIndexRow>(
        "fk_index",
        this.select("fk_index", {
          where: [
            { column: "target_object_key", value: targetObjectKey },
            { column: "target_sfdc_id", value: to18(targetSfdcId) },
          ],
          orderBy: ['"object_key"', '"sfdc_id"', '"field"'],
        }),
      ),
    get: (objectKey, sfdcId) =>
      this.many<FkIndexRow>(
        "fk_index",
        this.select("fk_index", {
          where: [
            { column: "object_key", value: objectKey },
            { column: "sfdc_id", value: to18(sfdcId) },
          ],
          orderBy: ['"field"'],
        }),
      ),
  };

  checkpoints: CheckpointsRepo = {
    add: (cp) =>
      this.upsertChunks("extract_checkpoints", [cp as unknown as Rec]),
    list: (runId, objectKey, country) =>
      this.many<ExtractCheckpoint>(
        "extract_checkpoints",
        this.select("extract_checkpoints", {
          where: [
            { column: "run_id", value: runId },
            { column: "object_key", value: objectKey },
            { column: "country", value: country },
          ],
          orderBy: ['"page_no"', '"job_id"'],
        }),
      ),
    complete: async (runId, jobId, pageNo, completedAt) => {
      await this.run(
        buildUpdate(
          "extract_checkpoints",
          { completedAt },
          [
            { column: "run_id", value: runId },
            { column: "job_id", value: jobId },
            { column: "page_no", value: pageNo },
          ],
          { schema: this.schema },
        ),
      );
    },
  };

  findings: FindingsRepo = {
    add: async (runId, findings) => {
      if (findings.length === 0) return;
      const createdAt = new Date().toISOString();
      await this.upsertChunks(
        "preflight_findings",
        findings.map((f) => ({ ...f, runId, createdAt }) as unknown as Rec),
        { onConflict: "none" },
      );
    },
    list: (runId, filter = {}) =>
      this.many<StoredFinding>(
        "preflight_findings",
        this.select("preflight_findings", {
          where: [
            { column: "run_id", value: runId },
            filter.severity !== undefined && {
              column: "severity",
              value: filter.severity,
            },
            filter.objectKey !== undefined && {
              column: "object_key",
              value: filter.objectKey,
            },
            filter.country !== undefined && {
              column: "country",
              value: filter.country,
            },
            filter.code !== undefined && { column: "code", value: filter.code },
          ],
          orderBy: ['"id"'],
        }),
      ),
    previous: async (currentRunId) => {
      const rows = await this.db.query(
        `select "run_id" from ${this.t("runs")} where "seq" < (select "seq" from ${this.t("runs")} where "run_id" = $1) order by "seq" desc limit 1`,
        [currentRunId],
      );
      const prev = rows[0]?.run_id;
      return prev ? this.findings.list(String(prev)) : [];
    },
  };

  reconciliation: ReconciliationRepo = {
    upsert: (row) =>
      this.upsertChunks("reconciliation", [row as unknown as Rec]),
    get: (runId, objectKey, country) =>
      this.one<ReconciliationRow>(
        "reconciliation",
        this.select("reconciliation", {
          where: [
            { column: "run_id", value: runId },
            { column: "object_key", value: objectKey },
            { column: "country", value: country },
          ],
        }),
      ),
    list: (runId) =>
      this.many<ReconciliationRow>(
        "reconciliation",
        this.select("reconciliation", {
          where: [{ column: "run_id", value: runId }],
          orderBy: ['"object_key"', '"country"'],
        }),
      ),
  };

  mappingSnapshots: MappingSnapshotsRepo = {
    put: (s) => this.upsertChunks("mapping_snapshots", [s as unknown as Rec]),
    get: (mappingHash, objectKey, country) =>
      this.one<MappingSnapshot>(
        "mapping_snapshots",
        this.select("mapping_snapshots", {
          where: [
            { column: "mapping_hash", value: mappingHash },
            { column: "object_key", value: objectKey },
            { column: "country", value: country },
          ],
        }),
      ),
    latestFor: (objectKey, country) =>
      this.one<MappingSnapshot>(
        "mapping_snapshots",
        this.select("mapping_snapshots", {
          where: [
            { column: "object_key", value: objectKey },
            { column: "country", value: country },
          ],
          orderBy: ['"created_at" desc'],
          limit: 1,
        }),
      ),
  };

  auditLog: AuditLogRepo = {
    append: (entry) =>
      this.upsertChunks("audit_log", [entry as unknown as Rec], {
        onConflict: "none",
      }),
    list: async (filter = {}) => {
      const params = new Params();
      const where = buildWhere(
        "audit_log",
        [
          filter.runId !== undefined && {
            column: "run_id",
            value: filter.runId,
          },
          filter.event !== undefined && {
            column: "event",
            value: filter.event,
          },
        ],
        params,
      );
      const text =
        filter.limit !== undefined
          ? `select * from (select * from ${this.t("audit_log")} ${where} order by "id" desc limit ${params.add(filter.limit)}) sub order by "id" asc`
          : `select * from ${this.t("audit_log")} ${where} order by "id" asc`;
      const rows = await this.db.query(text, params.values);
      return rows.map((r) => fromRecord<AuditLogEntry>("audit_log", r));
    },
  };

  probeResults: ProbeResultsRepo = {
    get: (probe) =>
      this.one<ProbeResult>(
        "probe_results",
        this.select("probe_results", {
          where: [
            { column: "vault_dns", value: this.vaultDns },
            { column: "probe", value: probe },
          ],
        }),
      ),
    set: (r) =>
      this.upsertChunks("probe_results", [
        { ...r, vaultDns: this.vaultDns } as unknown as Rec,
      ]),
    list: () =>
      this.many<ProbeResult>(
        "probe_results",
        this.select("probe_results", {
          where: [{ column: "vault_dns", value: this.vaultDns }],
          orderBy: ['"probe"'],
        }),
      ),
  };

  countryStatus: CountryStatusRepo = {
    setFrozen: async (country, frozenAt) => {
      if (frozenAt === null)
        await this.run(
          buildDelete(
            "country_status",
            [{ column: "country", value: country }],
            {
              schema: this.schema,
            },
          ),
        );
      else await this.upsertChunks("country_status", [{ country, frozenAt }]);
    },
    isFrozen: async (country) =>
      (await this.count(
        buildCount(
          "country_status",
          [{ column: "country", value: country }],
          this.schema,
        ),
      )) > 0,
    list: () =>
      this.many<{ country: CountryCode; frozenAt: string }>(
        "country_status",
        this.select("country_status", { orderBy: ['"country"'] }),
      ),
  };
}

// ---------------------------------------------------------------------------
// error translation
// ---------------------------------------------------------------------------

interface PgErrorLike {
  code?: string;
  constraint_name?: string;
  message?: string;
}

export function isUniqueViolation(err: unknown): boolean {
  return (err as PgErrorLike)?.code === "23505";
}

/** Surface the constraint name in the message (`id_map_vault_uidx violation: …`). */
export function translateError(err: unknown): Error {
  const e = err as PgErrorLike;
  if (isUniqueViolation(err) && e.constraint_name) {
    const out = new Error(
      `${e.constraint_name} violation: ${e.message ?? "duplicate key"}`,
    );
    (out as Error & { cause?: unknown }).cause = err;
    return out;
  }
  return err instanceof Error ? err : new Error(String(err));
}
