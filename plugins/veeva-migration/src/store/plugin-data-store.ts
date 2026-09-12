import { and, asc, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import type { StateStore } from "@lastest/veeva-migration/store";
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
} from "@lastest/veeva-migration/types";

import type { VeevaMigrationDb } from "../data/db";
import {
  veevaMigrationAuditLog as auditLog,
  veevaMigrationCountryStatus as countryStatus,
  veevaMigrationEngineRuns as engineRuns,
  veevaMigrationExtractCheckpoints as checkpoints,
  veevaMigrationFindings as findings,
  veevaMigrationFkIndex as fkIndex,
  veevaMigrationIdMap as idMap,
  veevaMigrationMappingSnapshots as mappingSnapshots,
  veevaMigrationPendingFk as pendingFk,
  veevaMigrationProbeResults as probeResults,
  veevaMigrationReconciliation as reconciliation,
  veevaMigrationRowResults as rowResults,
  veevaMigrationWatermarks as watermarks,
} from "../schema";

/**
 * The engine's `StateStore`, implemented over `ctx.data`.
 *
 * This is the replacement for `PostgresStateStore`, which the engine used to
 * own, and it is where the feature's tenancy hole is actually closed. Three
 * properties hold by construction rather than by discipline:
 *
 *  1. **Every statement is scoped to one project.** `projectId` is bound in the
 *     constructor and is the first predicate of every read, the first column of
 *     every key, and part of every conflict target. There is no method that can
 *     see another project's rows, so no future method can forget to filter. The
 *     old store scoped `runs` by nothing, `watermarks` by nothing, and
 *     `id_map`/`probe_results` by a Vault DNS the tenant typed in themselves.
 *  2. **It cannot open a connection.** `core/data` hands over a handle bound to
 *     this plugin's schema, on core's own pool. That makes `close()` a no-op —
 *     the engine used to open a four-connection pool per console render and run
 *     DDL under an advisory lock — and it puts every statement through the
 *     instrumented client in `@lastest/db`, so DB spans and the bound-parameter
 *     redaction policy apply for the first time.
 *  3. **Deletion is real.** The rows hang off `veeva_migration_projects` by a
 *     plugin-internal FK that still cascades, and the plugin's `DeletionHook`
 *     drives the rest. The old engine schema outlived the project, the repo and
 *     the team, audit log and id map included.
 *
 * `vaultDns` is still carried, because the engine's contract is "one map per
 * target vault" (§2.4) and `id_map`/`probe_results` are keyed by it — but it is
 * now a key *within* a project, not the only key there is.
 *
 * Correctness is checked against the engine's own `stateStoreContract` suite,
 * the same one `MemoryStateStore` and `FileStateStore` are held to. See
 * `plugin-data-store.integration.test.ts`.
 */
export interface PluginDataStoreOptions {
  readonly db: VeevaMigrationDb;
  /** The tenant key. Every statement is scoped to it. */
  readonly projectId: string;
  readonly vaultDns: string;
  /** Rows per statement for the batched upserts. */
  readonly batchSize?: number;
}

const DEFAULT_BATCH = 500;

/** Postgres caps a statement's parameters; the id map has the widest row. */
function chunk<T>(rows: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** Drop `null`s so an `Omit<…, "projectId">` row matches the engine's optional fields. */
function clean<T extends Record<string, unknown>>(row: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) if (v !== null) out[k] = v;
  return out as T;
}

export class PluginDataStateStore implements StateStore {
  readonly vaultDns: string;
  private readonly db: VeevaMigrationDb;
  private readonly projectId: string;
  private readonly batchSize: number;

  constructor(opts: PluginDataStoreOptions) {
    this.db = opts.db;
    this.projectId = opts.projectId;
    this.vaultDns = opts.vaultDns;
    this.batchSize = opts.batchSize ?? DEFAULT_BATCH;
    if (!this.projectId)
      throw new Error("PluginDataStateStore: projectId is required");
    if (!this.vaultDns)
      throw new Error("PluginDataStateStore: vaultDns is required");
  }

  /** The tenant predicate. Every query below starts with it. */
  private get mine() {
    return this.projectId;
  }

  // ----------------------------------------------------------------- runs

  runs: StateStore["runs"] = {
    create: async (run) => {
      await this.db
        .insert(engineRuns)
        .values({ projectId: this.mine, ...run })
        .onConflictDoNothing();
    },
    get: async (runId) => {
      const [row] = await this.db
        .select()
        .from(engineRuns)
        .where(
          and(eq(engineRuns.projectId, this.mine), eq(engineRuns.runId, runId)),
        );
      return row ? (clean(row) as unknown as RunRecord) : undefined;
    },
    update: async (runId, patch) => {
      await this.db
        .update(engineRuns)
        .set(patch)
        .where(
          and(eq(engineRuns.projectId, this.mine), eq(engineRuns.runId, runId)),
        );
    },
    list: async (filter) => {
      const where = [eq(engineRuns.projectId, this.mine)];
      if (filter?.mode) where.push(eq(engineRuns.mode, filter.mode));
      if (filter?.status) where.push(eq(engineRuns.status, filter.status));
      const rows = await this.db
        .select()
        .from(engineRuns)
        .where(and(...where))
        .orderBy(desc(engineRuns.startedAt))
        .limit(filter?.limit ?? 100);
      return rows.map((r) => clean(r) as unknown as RunRecord);
    },
    latestSucceeded: async () => {
      const [row] = await this.db
        .select()
        .from(engineRuns)
        .where(
          and(
            eq(engineRuns.projectId, this.mine),
            eq(engineRuns.status, "succeeded"),
          ),
        )
        .orderBy(desc(engineRuns.startedAt))
        .limit(1);
      return row ? (clean(row) as unknown as RunRecord) : undefined;
    },
  };

  // ----------------------------------------------------------- watermarks

  watermarks: StateStore["watermarks"] = {
    get: async (objectKey, country, kind) => {
      const [row] = await this.db
        .select()
        .from(watermarks)
        .where(
          and(
            eq(watermarks.projectId, this.mine),
            eq(watermarks.objectKey, objectKey),
            eq(watermarks.country, country),
            eq(watermarks.kind, kind),
          ),
        );
      return row ? (clean(row) as unknown as Watermark) : undefined;
    },
    set: async (watermark) => {
      await this.db
        .insert(watermarks)
        .values({ projectId: this.mine, ...watermark })
        .onConflictDoUpdate({
          target: [
            watermarks.projectId,
            watermarks.objectKey,
            watermarks.country,
            watermarks.kind,
          ],
          set: {
            value: watermark.value,
            cutoffDate: watermark.cutoffDate ?? null,
            runId: watermark.runId,
            updatedAt: watermark.updatedAt,
          },
        });
    },
    list: async (filter) => {
      const where = [eq(watermarks.projectId, this.mine)];
      if (filter?.objectKey)
        where.push(eq(watermarks.objectKey, filter.objectKey));
      if (filter?.country) where.push(eq(watermarks.country, filter.country));
      const rows = await this.db
        .select()
        .from(watermarks)
        .where(and(...where));
      return rows.map((r) => clean(r) as unknown as Watermark);
    },
  };

  // --------------------------------------------------------------- id map

  /** Live = neither merged away nor soft-deleted. The reverse index's predicate. */
  private get liveIdMap() {
    return and(isNull(idMap.mergedInto), isNull(idMap.deletedAt));
  }

  idMap: StateStore["idMap"] = {
    get: async (objectKey, sfdcId) => {
      const [row] = await this.db
        .select()
        .from(idMap)
        .where(
          and(
            eq(idMap.projectId, this.mine),
            eq(idMap.vaultDns, this.vaultDns),
            eq(idMap.objectKey, objectKey),
            eq(idMap.sfdcId, sfdcId),
          ),
        );
      return row ? (clean(row) as unknown as IdMapRow) : undefined;
    },
    put: async (row) => {
      await this.idMap.putMany([row]);
    },
    putMany: async (rows) => {
      if (rows.length === 0) return;
      for (const batch of chunk(rows, this.batchSize)) {
        await this.db
          .insert(idMap)
          .values(batch.map((r) => ({ projectId: this.mine, ...r })))
          .onConflictDoUpdate({
            target: [
              idMap.projectId,
              idMap.vaultDns,
              idMap.objectKey,
              idMap.sfdcId,
            ],
            // `firstSeenRun` is deliberately absent: it is the one column an
            // upsert must not touch (§2.4).
            set: {
              vaultObject: sql`excluded.vault_object`,
              vaultId: sql`excluded.vault_id`,
              country: sql`excluded.country`,
              matchMethod: sql`excluded.match_method`,
              mergedInto: sql`excluded.merged_into`,
              lastSeenRun: sql`excluded.last_seen_run`,
              sourceHash: sql`excluded.source_hash`,
              verifiedHash: sql`excluded.verified_hash`,
              verifiedAt: sql`excluded.verified_at`,
              deletedAt: sql`excluded.deleted_at`,
              objectType: sql`excluded.object_type`,
              dryRun: sql`excluded.dry_run`,
            },
          });
      }
    },
    bulkGet: async (objectKey, sfdcIds) => {
      const out = new Map<string, IdMapRow>();
      if (sfdcIds.length === 0) return out;
      for (const batch of chunk(sfdcIds, this.batchSize)) {
        const rows = await this.db
          .select()
          .from(idMap)
          .where(
            and(
              eq(idMap.projectId, this.mine),
              eq(idMap.vaultDns, this.vaultDns),
              eq(idMap.objectKey, objectKey),
              inArray(idMap.sfdcId, [...batch]),
            ),
          );
        for (const row of rows)
          out.set(row.sfdcId, clean(row) as unknown as IdMapRow);
      }
      return out;
    },
    byVaultId: async (vaultObject, vaultId) => {
      const [row] = await this.db
        .select()
        .from(idMap)
        .where(
          and(
            eq(idMap.projectId, this.mine),
            eq(idMap.vaultDns, this.vaultDns),
            eq(idMap.vaultObject, vaultObject),
            eq(idMap.vaultId, vaultId),
            this.liveIdMap,
          ),
        );
      return row ? (clean(row) as unknown as IdMapRow) : undefined;
    },
    markDeleted: async (objectKey, sfdcId, deletedAt) => {
      await this.db
        .update(idMap)
        .set({ deletedAt })
        .where(
          and(
            eq(idMap.projectId, this.mine),
            eq(idMap.vaultDns, this.vaultDns),
            eq(idMap.objectKey, objectKey),
            eq(idMap.sfdcId, sfdcId),
          ),
        );
    },
    merge: async (objectKey, loserSfdcId, survivorSfdcId, runId) => {
      const survivor = await this.idMap.get(objectKey, survivorSfdcId);
      await this.db
        .update(idMap)
        .set({
          mergedInto: survivorSfdcId,
          lastSeenRun: runId,
          // The loser follows the survivor's Vault id (§3.4): children
          // re-pointed through the loser must land on the surviving record.
          ...(survivor ? { vaultId: survivor.vaultId } : {}),
        })
        .where(
          and(
            eq(idMap.projectId, this.mine),
            eq(idMap.vaultDns, this.vaultDns),
            eq(idMap.objectKey, objectKey),
            eq(idMap.sfdcId, loserSfdcId),
          ),
        );
    },
    setSourceHash: async (objectKey, sfdcId, sourceHash, runId) => {
      await this.db
        .update(idMap)
        .set({ sourceHash, lastSeenRun: runId })
        .where(
          and(
            eq(idMap.projectId, this.mine),
            eq(idMap.vaultDns, this.vaultDns),
            eq(idMap.objectKey, objectKey),
            eq(idMap.sfdcId, sfdcId),
          ),
        );
    },
    setVerified: async (objectKey, sfdcId, verifiedHash, verifiedAt) => {
      await this.db
        .update(idMap)
        .set({ verifiedHash, verifiedAt })
        .where(
          and(
            eq(idMap.projectId, this.mine),
            eq(idMap.vaultDns, this.vaultDns),
            eq(idMap.objectKey, objectKey),
            eq(idMap.sfdcId, sfdcId),
          ),
        );
    },
    count: async (objectKey, country) => {
      const where = [
        eq(idMap.projectId, this.mine),
        eq(idMap.vaultDns, this.vaultDns),
        eq(idMap.objectKey, objectKey),
        this.liveIdMap,
      ];
      if (country) where.push(eq(idMap.country, country));
      const [row] = await this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(idMap)
        .where(and(...where));
      return row?.n ?? 0;
    },
    iterate: (objectKey, country) => this.iterateIdMap(objectKey, country),
    purgeDryRun: async () => {
      const deleted = await this.db
        .delete(idMap)
        .where(
          and(
            eq(idMap.projectId, this.mine),
            eq(idMap.vaultDns, this.vaultDns),
            eq(idMap.dryRun, true),
          ),
        )
        .returning({ sfdcId: idMap.sfdcId });
      return deleted.length;
    },
  };

  /**
   * Keyset pagination, not a cursor: `core/data` hands over a query surface,
   * not a connection, so there is nowhere to hold a server-side cursor. Ordering
   * by the tail of the primary key makes the page boundary exact even while rows
   * are being written.
   */
  private async *iterateIdMap(
    objectKey: ObjectKey,
    country?: CountryCode,
  ): AsyncIterable<IdMapRow> {
    let after = "";
    for (;;) {
      const where = [
        eq(idMap.projectId, this.mine),
        eq(idMap.vaultDns, this.vaultDns),
        eq(idMap.objectKey, objectKey),
      ];
      if (country) where.push(eq(idMap.country, country));
      if (after) where.push(gt(idMap.sfdcId, after));
      const page = await this.db
        .select()
        .from(idMap)
        .where(and(...where))
        .orderBy(asc(idMap.sfdcId))
        .limit(this.batchSize);
      if (page.length === 0) return;
      for (const row of page) yield clean(row) as unknown as IdMapRow;
      after = page[page.length - 1]!.sfdcId;
      if (page.length < this.batchSize) return;
    }
  }

  // ---------------------------------------------------------- row results

  rowResults: StateStore["rowResults"] = {
    upsert: async (rows) => {
      if (rows.length === 0) return;
      for (const batch of chunk(rows, this.batchSize)) {
        await this.db
          .insert(rowResults)
          .values(batch.map((r) => ({ projectId: this.mine, ...r })))
          .onConflictDoUpdate({
            target: [
              rowResults.projectId,
              rowResults.runId,
              rowResults.objectKey,
              rowResults.sfdcId,
            ],
            set: {
              country: sql`excluded.country`,
              batchNo: sql`excluded.batch_no`,
              state: sql`excluded.state`,
              errorType: sql`excluded.error_type`,
              errorMessage: sql`excluded.error_message`,
              attempt: sql`excluded.attempt`,
              payloadHash: sql`excluded.payload_hash`,
              vaultId: sql`excluded.vault_id`,
              updatedAt: sql`excluded.updated_at`,
            },
          });
      }
    },
    get: async (runId, objectKey, sfdcId) => {
      const [row] = await this.db
        .select()
        .from(rowResults)
        .where(
          and(
            eq(rowResults.projectId, this.mine),
            eq(rowResults.runId, runId),
            eq(rowResults.objectKey, objectKey),
            eq(rowResults.sfdcId, sfdcId),
          ),
        );
      return row ? (clean(row) as unknown as RowResult) : undefined;
    },
    query: async (filter) => {
      const where = [
        eq(rowResults.projectId, this.mine),
        eq(rowResults.runId, filter.runId),
      ];
      if (filter.objectKey)
        where.push(eq(rowResults.objectKey, filter.objectKey));
      if (filter.country) where.push(eq(rowResults.country, filter.country));
      if (filter.state)
        where.push(
          Array.isArray(filter.state)
            ? inArray(rowResults.state, filter.state)
            : eq(rowResults.state, filter.state),
        );
      if (filter.errorType)
        where.push(eq(rowResults.errorType, filter.errorType));
      if (filter.batchNo !== undefined)
        where.push(eq(rowResults.batchNo, filter.batchNo));
      let q = this.db
        .select()
        .from(rowResults)
        .where(and(...where))
        .orderBy(asc(rowResults.objectKey), asc(rowResults.sfdcId))
        .$dynamic();
      if (filter.limit !== undefined) q = q.limit(filter.limit);
      if (filter.offset !== undefined) q = q.offset(filter.offset);
      const rows = await q;
      return rows.map((r) => clean(r) as unknown as RowResult);
    },
    countByState: async (runId, objectKey, country) => {
      const rows = await this.db
        .select({
          state: rowResults.state,
          n: sql<number>`count(*)::int`,
        })
        .from(rowResults)
        .where(
          and(
            eq(rowResults.projectId, this.mine),
            eq(rowResults.runId, runId),
            eq(rowResults.objectKey, objectKey),
            eq(rowResults.country, country),
          ),
        )
        .groupBy(rowResults.state);
      const out: Partial<Record<RowState, number>> = {};
      for (const r of rows) out[r.state as RowState] = r.n;
      return out;
    },
    countFailedByType: async (runId, objectKey, country) => {
      const rows = await this.db
        .select({
          errorType: rowResults.errorType,
          n: sql<number>`count(*)::int`,
        })
        .from(rowResults)
        .where(
          and(
            eq(rowResults.projectId, this.mine),
            eq(rowResults.runId, runId),
            eq(rowResults.objectKey, objectKey),
            eq(rowResults.country, country),
            eq(rowResults.state, "failed"),
          ),
        )
        .groupBy(rowResults.errorType);
      const out: Record<string, number> = {};
      for (const r of rows) out[r.errorType ?? "unknown"] = r.n;
      return out;
    },
  };

  // ----------------------------------------------------------- pending fk

  pendingFk: StateStore["pendingFk"] = {
    add: async (rows) => {
      if (rows.length === 0) return;
      for (const batch of chunk(rows, this.batchSize)) {
        await this.db
          .insert(pendingFk)
          .values(batch.map((r) => ({ projectId: this.mine, ...r })))
          .onConflictDoUpdate({
            target: [
              pendingFk.projectId,
              pendingFk.runId,
              pendingFk.objectKey,
              pendingFk.sfdcId,
              pendingFk.field,
            ],
            set: {
              country: sql`excluded.country`,
              targetObjectKey: sql`excluded.target_object_key`,
              targetSfdcId: sql`excluded.target_sfdc_id`,
              attempts: sql`excluded.attempts`,
              resolvedAt: sql`excluded.resolved_at`,
            },
          });
      }
    },
    list: async (runId, filter) => {
      const where = [
        eq(pendingFk.projectId, this.mine),
        eq(pendingFk.runId, runId),
      ];
      if (filter?.objectKey)
        where.push(eq(pendingFk.objectKey, filter.objectKey));
      if (filter?.country) where.push(eq(pendingFk.country, filter.country));
      if (filter?.unresolvedOnly) where.push(isNull(pendingFk.resolvedAt));
      const rows = await this.db
        .select()
        .from(pendingFk)
        .where(and(...where));
      return rows.map((r) => clean(r) as unknown as PendingFk);
    },
    resolve: async (runId, objectKey, sfdcId, field, resolvedAt) => {
      await this.db
        .update(pendingFk)
        .set({ resolvedAt })
        .where(this.pendingFkKey(runId, objectKey, sfdcId, field));
    },
    bumpAttempts: async (runId, objectKey, sfdcId, field) => {
      await this.db
        .update(pendingFk)
        .set({ attempts: sql`${pendingFk.attempts} + 1` })
        .where(this.pendingFkKey(runId, objectKey, sfdcId, field));
    },
    countUnresolved: async (runId, objectKey, country) => {
      const [row] = await this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(pendingFk)
        .where(
          and(
            eq(pendingFk.projectId, this.mine),
            eq(pendingFk.runId, runId),
            eq(pendingFk.objectKey, objectKey),
            eq(pendingFk.country, country),
            isNull(pendingFk.resolvedAt),
          ),
        );
      return row?.n ?? 0;
    },
  };

  private pendingFkKey(
    runId: string,
    objectKey: string,
    sfdcId: string,
    field: string,
  ) {
    return and(
      eq(pendingFk.projectId, this.mine),
      eq(pendingFk.runId, runId),
      eq(pendingFk.objectKey, objectKey),
      eq(pendingFk.sfdcId, sfdcId),
      eq(pendingFk.field, field),
    );
  }

  // ------------------------------------------------------------- fk index

  fkIndex: StateStore["fkIndex"] = {
    put: async (rows) => {
      if (rows.length === 0) return;
      for (const batch of chunk(rows, this.batchSize)) {
        await this.db
          .insert(fkIndex)
          .values(batch.map((r) => ({ projectId: this.mine, ...r })))
          .onConflictDoUpdate({
            target: [
              fkIndex.projectId,
              fkIndex.objectKey,
              fkIndex.sfdcId,
              fkIndex.field,
            ],
            set: {
              targetObjectKey: sql`excluded.target_object_key`,
              targetSfdcId: sql`excluded.target_sfdc_id`,
              runId: sql`excluded.run_id`,
            },
          });
      }
    },
    childrenOf: async (targetObjectKey, targetSfdcId) => {
      const rows = await this.db
        .select()
        .from(fkIndex)
        .where(
          and(
            eq(fkIndex.projectId, this.mine),
            eq(fkIndex.targetObjectKey, targetObjectKey),
            eq(fkIndex.targetSfdcId, targetSfdcId),
          ),
        );
      return rows.map((r) => clean(r) as unknown as FkIndexRow);
    },
    get: async (objectKey, sfdcId) => {
      const rows = await this.db
        .select()
        .from(fkIndex)
        .where(
          and(
            eq(fkIndex.projectId, this.mine),
            eq(fkIndex.objectKey, objectKey),
            eq(fkIndex.sfdcId, sfdcId),
          ),
        );
      return rows.map((r) => clean(r) as unknown as FkIndexRow);
    },
  };

  // ---------------------------------------------------------- checkpoints

  checkpoints: StateStore["checkpoints"] = {
    add: async (cp) => {
      await this.db
        .insert(checkpoints)
        .values({ projectId: this.mine, ...cp })
        .onConflictDoUpdate({
          target: [
            checkpoints.projectId,
            checkpoints.runId,
            checkpoints.jobId,
            checkpoints.pageNo,
          ],
          set: {
            objectKey: sql`excluded.object_key`,
            country: sql`excluded.country`,
            locator: sql`excluded.locator`,
            rows: sql`excluded.rows`,
            file: sql`excluded.file`,
            completedAt: sql`excluded.completed_at`,
          },
        });
    },
    list: async (runId, objectKey, country) => {
      const rows = await this.db
        .select()
        .from(checkpoints)
        .where(
          and(
            eq(checkpoints.projectId, this.mine),
            eq(checkpoints.runId, runId),
            eq(checkpoints.objectKey, objectKey),
            eq(checkpoints.country, country),
          ),
        )
        .orderBy(asc(checkpoints.pageNo));
      return rows.map((r) => clean(r) as unknown as ExtractCheckpoint);
    },
    complete: async (runId, jobId, pageNo, completedAt) => {
      await this.db
        .update(checkpoints)
        .set({ completedAt })
        .where(
          and(
            eq(checkpoints.projectId, this.mine),
            eq(checkpoints.runId, runId),
            eq(checkpoints.jobId, jobId),
            eq(checkpoints.pageNo, pageNo),
          ),
        );
    },
  };

  // ------------------------------------------------------------- findings

  findings: StateStore["findings"] = {
    add: async (runId, list) => {
      if (list.length === 0) return;
      const now = new Date().toISOString();
      for (const batch of chunk(list, this.batchSize)) {
        await this.db.insert(findings).values(
          batch.map((f) => ({
            projectId: this.mine,
            runId,
            severity: f.severity,
            code: f.code,
            objectKey: f.objectKey ?? null,
            country: f.country ?? null,
            field: f.field ?? null,
            detail: f.detail as unknown,
            count: f.count ?? null,
            createdAt: now,
          })),
        );
      }
    },
    list: async (runId, filter) => {
      const where = [
        eq(findings.projectId, this.mine),
        eq(findings.runId, runId),
      ];
      if (filter?.severity) where.push(eq(findings.severity, filter.severity));
      if (filter?.objectKey)
        where.push(eq(findings.objectKey, filter.objectKey));
      if (filter?.country) where.push(eq(findings.country, filter.country));
      if (filter?.code) where.push(eq(findings.code, filter.code));
      const rows = await this.db
        .select()
        .from(findings)
        .where(and(...where))
        .orderBy(asc(findings.id));
      return rows.map(toStoredFinding);
    },
    previous: async (currentRunId) => {
      // The run before this one, by start time — not "the last succeeded":
      // §5's "new since last run" diff is against whatever ran last, including
      // a failure.
      const [current] = await this.db
        .select({ startedAt: engineRuns.startedAt })
        .from(engineRuns)
        .where(
          and(
            eq(engineRuns.projectId, this.mine),
            eq(engineRuns.runId, currentRunId),
          ),
        );
      if (!current) return [];
      const [prev] = await this.db
        .select({ runId: engineRuns.runId })
        .from(engineRuns)
        .where(
          and(
            eq(engineRuns.projectId, this.mine),
            sql`${engineRuns.startedAt} < ${current.startedAt}`,
          ),
        )
        .orderBy(desc(engineRuns.startedAt))
        .limit(1);
      if (!prev) return [];
      return this.findings.list(prev.runId);
    },
  };

  // ------------------------------------------------------- reconciliation

  reconciliation: StateStore["reconciliation"] = {
    upsert: async (row) => {
      await this.db
        .insert(reconciliation)
        .values({ projectId: this.mine, ...row })
        .onConflictDoUpdate({
          target: [
            reconciliation.projectId,
            reconciliation.runId,
            reconciliation.objectKey,
            reconciliation.country,
          ],
          // Spelled out rather than derived from `Object.keys(row)`: building
          // `excluded.<column>` with `sql.raw` from a runtime string is the one
          // shape `packages/db/src/tracing.ts` singles out as able to smuggle a
          // literal into a span, and a typo'd column name would fail at
          // runtime instead of at the type checker.
          set: {
            sfdcScopeCount: sql`excluded.sfdc_scope_count`,
            extracted: sql`excluded.extracted`,
            extractedDeleted: sql`excluded.extracted_deleted`,
            closure: sql`excluded.closure`,
            transformed: sql`excluded.transformed`,
            skipped: sql`excluded.skipped`,
            skippedByReason: sql`excluded.skipped_by_reason`,
            pendingFk: sql`excluded.pending_fk`,
            created: sql`excluded.created`,
            updated: sql`excluded.updated`,
            unchanged: sql`excluded.unchanged`,
            failed: sql`excluded.failed`,
            failedByType: sql`excluded.failed_by_type`,
            deleted: sql`excluded.deleted`,
            deletedApplied: sql`excluded.deleted_applied`,
            deletedIgnored: sql`excluded.deleted_ignored`,
            deletedPending: sql`excluded.deleted_pending`,
            vaultCount: sql`excluded.vault_count`,
            aggHashSrc: sql`excluded.agg_hash_src`,
            aggHashTgt: sql`excluded.agg_hash_tgt`,
            status: sql`excluded.status`,
          },
        });
    },
    get: async (runId, objectKey, country) => {
      const [row] = await this.db
        .select()
        .from(reconciliation)
        .where(
          and(
            eq(reconciliation.projectId, this.mine),
            eq(reconciliation.runId, runId),
            eq(reconciliation.objectKey, objectKey),
            eq(reconciliation.country, country),
          ),
        );
      return row ? (clean(row) as unknown as ReconciliationRow) : undefined;
    },
    list: async (runId) => {
      const rows = await this.db
        .select()
        .from(reconciliation)
        .where(
          and(
            eq(reconciliation.projectId, this.mine),
            eq(reconciliation.runId, runId),
          ),
        )
        .orderBy(asc(reconciliation.objectKey), asc(reconciliation.country));
      return rows.map((r) => clean(r) as unknown as ReconciliationRow);
    },
  };

  // ----------------------------------------------------- mapping snapshots

  mappingSnapshots: StateStore["mappingSnapshots"] = {
    put: async (snapshot) => {
      await this.db
        .insert(mappingSnapshots)
        .values({ projectId: this.mine, ...snapshot })
        .onConflictDoUpdate({
          target: [
            mappingSnapshots.projectId,
            mappingSnapshots.mappingHash,
            mappingSnapshots.objectKey,
            mappingSnapshots.country,
          ],
          set: {
            materialised: sql`excluded.materialised`,
            createdAt: sql`excluded.created_at`,
          },
        });
    },
    get: async (mappingHash, objectKey, country) => {
      const [row] = await this.db
        .select()
        .from(mappingSnapshots)
        .where(
          and(
            eq(mappingSnapshots.projectId, this.mine),
            eq(mappingSnapshots.mappingHash, mappingHash),
            eq(mappingSnapshots.objectKey, objectKey),
            eq(mappingSnapshots.country, country),
          ),
        );
      return row ? (clean(row) as unknown as MappingSnapshot) : undefined;
    },
    latestFor: async (objectKey, country) => {
      const [row] = await this.db
        .select()
        .from(mappingSnapshots)
        .where(
          and(
            eq(mappingSnapshots.projectId, this.mine),
            eq(mappingSnapshots.objectKey, objectKey),
            eq(mappingSnapshots.country, country),
          ),
        )
        .orderBy(desc(mappingSnapshots.createdAt))
        .limit(1);
      return row ? (clean(row) as unknown as MappingSnapshot) : undefined;
    },
  };

  // ------------------------------------------------------------ audit log

  auditLog: StateStore["auditLog"] = {
    append: async (entry) => {
      await this.db.insert(auditLog).values({
        projectId: this.mine,
        runId: entry.runId ?? null,
        at: entry.at,
        actor: entry.actor,
        event: entry.event,
        detail: entry.detail ?? null,
      });
    },
    list: async (filter) => {
      const where = [eq(auditLog.projectId, this.mine)];
      if (filter?.runId) where.push(eq(auditLog.runId, filter.runId));
      if (filter?.event) where.push(eq(auditLog.event, filter.event));
      const rows = await this.db
        .select()
        .from(auditLog)
        .where(and(...where))
        .orderBy(asc(auditLog.id))
        .limit(filter?.limit ?? 500);
      return rows.map((r) => clean(r) as unknown as AuditLogEntry);
    },
  };

  // -------------------------------------------------------- probe results

  probeResults: StateStore["probeResults"] = {
    get: async (probe) => {
      const [row] = await this.db
        .select()
        .from(probeResults)
        .where(
          and(
            eq(probeResults.projectId, this.mine),
            eq(probeResults.vaultDns, this.vaultDns),
            eq(probeResults.probe, probe),
          ),
        );
      return row ? (clean(row) as unknown as ProbeResult) : undefined;
    },
    set: async (result) => {
      await this.db
        .insert(probeResults)
        .values({ projectId: this.mine, ...result })
        .onConflictDoUpdate({
          target: [
            probeResults.projectId,
            probeResults.vaultDns,
            probeResults.probe,
          ],
          set: {
            result: sql`excluded.result`,
            checkedAt: sql`excluded.checked_at`,
          },
        });
    },
    list: async () => {
      const rows = await this.db
        .select()
        .from(probeResults)
        .where(
          and(
            eq(probeResults.projectId, this.mine),
            eq(probeResults.vaultDns, this.vaultDns),
          ),
        );
      return rows.map((r) => clean(r) as unknown as ProbeResult);
    },
  };

  // ------------------------------------------------------- country status

  countryStatus: StateStore["countryStatus"] = {
    setFrozen: async (country, frozenAt) => {
      if (frozenAt === null) {
        await this.db
          .delete(countryStatus)
          .where(
            and(
              eq(countryStatus.projectId, this.mine),
              eq(countryStatus.country, country),
            ),
          );
        return;
      }
      await this.db
        .insert(countryStatus)
        .values({ projectId: this.mine, country, frozenAt })
        .onConflictDoUpdate({
          target: [countryStatus.projectId, countryStatus.country],
          set: { frozenAt: sql`excluded.frozen_at` },
        });
    },
    isFrozen: async (country) => {
      const [row] = await this.db
        .select({ country: countryStatus.country })
        .from(countryStatus)
        .where(
          and(
            eq(countryStatus.projectId, this.mine),
            eq(countryStatus.country, country),
          ),
        );
      return Boolean(row);
    },
    list: async () => {
      const rows = await this.db
        .select()
        .from(countryStatus)
        .where(eq(countryStatus.projectId, this.mine))
        .orderBy(asc(countryStatus.country));
      return rows.map((r) => ({
        country: r.country as CountryCode,
        frozenAt: r.frozenAt,
      }));
    },
  };

  /**
   * A no-op, and that is the point.
   *
   * Core owns the connection pool, so there is nothing here to tear down. The
   * store this replaces opened a four-connection pool and ran DDL under an
   * advisory lock on **every** call — including every console page render.
   */
  async close(): Promise<void> {}
}

function toStoredFinding(row: {
  runId: string;
  severity: string;
  code: string;
  objectKey: string | null;
  country: string | null;
  field: string | null;
  detail: unknown;
  count: number | null;
  createdAt: string;
}): StoredFinding {
  return clean({
    runId: row.runId,
    severity: row.severity,
    code: row.code,
    objectKey: row.objectKey,
    country: row.country,
    field: row.field,
    detail: row.detail,
    count: row.count,
    createdAt: row.createdAt,
  } as unknown as Record<string, unknown>) as unknown as StoredFinding;
}
