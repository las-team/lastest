/**
 * Reference in-memory `StateStore` (§2.4). This is the implementation every
 * consumer tests against; `src/store/postgres.ts` must behave identically
 * (the store contract tests in `memory-store.test.ts` are written so they can
 * be re-run against postgres by swapping the factory).
 */
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
} from "../store/types";
import { to18 } from "../transform/ids";
import type {
  AuditLogEntry,
  CountryCode,
  ExtractCheckpoint,
  Finding,
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
  WatermarkKind,
} from "../types";

const clone = <T>(v: T): T =>
  v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
const nowIso = () => new Date().toISOString();

/** A row that occupies its (vaultObject, vaultId) slot per `id_map_vault_uidx`. */
const isLive = (r: IdMapRow): boolean => !r.mergedInto && !r.deletedAt;
const vaultKey = (r: Pick<IdMapRow, "vaultObject" | "vaultId">): string =>
  `${r.vaultObject}|${r.vaultId}`;

export class MemoryStateStore implements StateStore {
  readonly vaultDns: string;
  private runsMap = new Map<string, RunRecord>();
  private wmMap = new Map<string, Watermark>();
  private idMapRows = new Map<string, IdMapRow>();
  /** `vaultObject|vaultId` → id-map key, live rows only (`id_map_vault_uidx`). */
  private liveByVault = new Map<string, string>();
  private rowResultRows = new Map<string, RowResult>();
  private pendingRows = new Map<string, PendingFk>();
  private fkRows = new Map<string, FkIndexRow>();
  private cpRows: ExtractCheckpoint[] = [];
  private findingRows: StoredFinding[] = [];
  private runOrder: string[] = [];
  private reconRows = new Map<string, ReconciliationRow>();
  private snapshots = new Map<string, MappingSnapshot>();
  private audit: AuditLogEntry[] = [];
  private probes = new Map<string, ProbeResult>();
  private frozen = new Map<string, string>();
  private auditSeq = 0;
  closed = false;

  constructor(vaultDns = "fake.veevavault.com") {
    this.vaultDns = vaultDns;
  }

  private idKey(objectKey: ObjectKey, sfdcId: string): string {
    return `${objectKey}|${to18(sfdcId)}`;
  }

  /**
   * Call before mutating the row stored under `key` (or deleting it) with
   * the row's state after the mutation; keeps `liveByVault` exact.
   */
  private reindexIdMap(key: string, next: IdMapRow | undefined): void {
    const prev = this.idMapRows.get(key);
    if (prev && isLive(prev)) {
      const vk = vaultKey(prev);
      if (this.liveByVault.get(vk) === key) this.liveByVault.delete(vk);
    }
    if (next && isLive(next)) this.liveByVault.set(vaultKey(next), key);
  }

  runs: RunsRepo = {
    create: async (run) => {
      if (this.runsMap.has(run.runId))
        throw new Error(`run ${run.runId} already exists`);
      this.runsMap.set(run.runId, clone(run));
      this.runOrder.push(run.runId);
    },
    get: async (runId) => clone(this.runsMap.get(runId)),
    update: async (runId, patch) => {
      const cur = this.runsMap.get(runId);
      if (!cur) throw new Error(`run ${runId} not found`);
      this.runsMap.set(runId, { ...cur, ...clone(patch) });
    },
    list: async (filter = {}) => {
      let out = [...this.runsMap.values()].sort((a, b) =>
        a.startedAt < b.startedAt ? 1 : -1,
      );
      if (filter.mode) out = out.filter((r) => r.mode === filter.mode);
      if (filter.status) out = out.filter((r) => r.status === filter.status);
      if (filter.limit !== undefined) out = out.slice(0, filter.limit);
      return clone(out);
    },
    latestSucceeded: async () =>
      clone(
        [...this.runsMap.values()]
          .filter((r) => r.status === "succeeded")
          .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))[0],
      ),
  };

  watermarks: WatermarksRepo = {
    get: async (objectKey, country, kind) =>
      clone(this.wmMap.get(`${objectKey}|${country}|${kind}`)),
    set: async (w) => {
      this.wmMap.set(`${w.objectKey}|${w.country}|${w.kind}`, clone(w));
    },
    list: async (filter = {}) =>
      clone(
        [...this.wmMap.values()].filter(
          (w) =>
            (!filter.objectKey || w.objectKey === filter.objectKey) &&
            (!filter.country || w.country === filter.country),
        ),
      ),
  };

  idMap: IdMapRepo = {
    get: async (objectKey, sfdcId) =>
      clone(this.idMapRows.get(this.idKey(objectKey, sfdcId))),
    put: async (row) => {
      const key = this.idKey(row.objectKey, row.sfdcId);
      const existing = this.idMapRows.get(key);
      const next: IdMapRow = {
        ...clone(row),
        sfdcId: to18(row.sfdcId),
        vaultDns: this.vaultDns,
        firstSeenRun: existing?.firstSeenRun ?? row.firstSeenRun,
      };
      // unique (vault_object, vault_id) among live rows
      if (isLive(next)) {
        const otherKey = this.liveByVault.get(vaultKey(next));
        if (otherKey !== undefined && otherKey !== key)
          throw new Error(
            `id_map_vault_uidx violation: ${next.vaultObject}/${next.vaultId} already mapped to ${this.idMapRows.get(otherKey)?.sfdcId ?? otherKey}`,
          );
      }
      this.reindexIdMap(key, next);
      this.idMapRows.set(key, next);
    },
    putMany: async (rows) => {
      for (const r of rows) await this.idMap.put(r);
    },
    bulkGet: async (objectKey, sfdcIds) => {
      const out = new Map<string, IdMapRow>();
      for (const id of sfdcIds) {
        const row = this.idMapRows.get(this.idKey(objectKey, id));
        if (row) out.set(row.sfdcId, clone(row));
      }
      return out;
    },
    byVaultId: async (vaultObject, vaultId) => {
      const key = this.liveByVault.get(vaultKey({ vaultObject, vaultId }));
      return key === undefined ? undefined : clone(this.idMapRows.get(key));
    },
    markDeleted: async (objectKey, sfdcId, deletedAt) => {
      const key = this.idKey(objectKey, sfdcId);
      const row = this.idMapRows.get(key);
      if (!row) return;
      const next = { ...row, deletedAt };
      this.reindexIdMap(key, next);
      this.idMapRows.set(key, next);
    },
    merge: async (objectKey, loser, survivor, runId) => {
      const lKey = this.idKey(objectKey, loser);
      const l = this.idMapRows.get(lKey);
      const s = this.idMapRows.get(this.idKey(objectKey, survivor));
      if (!s) throw new Error(`merge survivor ${survivor} not in id map`);
      const survivorId = to18(survivor);
      if (l) {
        const next: IdMapRow = {
          ...l,
          mergedInto: survivorId,
          vaultId: s.vaultId,
          matchMethod: "merged",
          lastSeenRun: runId,
        };
        this.reindexIdMap(lKey, next);
        this.idMapRows.set(lKey, next);
      } else {
        this.idMapRows.set(lKey, {
          ...clone(s),
          sfdcId: to18(loser),
          mergedInto: survivorId,
          matchMethod: "merged",
          firstSeenRun: runId,
          lastSeenRun: runId,
          sourceHash: null,
          verifiedHash: null,
          verifiedAt: null,
        });
      }
    },
    setSourceHash: async (objectKey, sfdcId, sourceHash, runId) => {
      const row = this.idMapRows.get(this.idKey(objectKey, sfdcId));
      if (row) {
        row.sourceHash = sourceHash;
        row.lastSeenRun = runId;
      }
    },
    setVerified: async (objectKey, sfdcId, verifiedHash, verifiedAt) => {
      const row = this.idMapRows.get(this.idKey(objectKey, sfdcId));
      if (row) {
        row.verifiedHash = verifiedHash;
        row.verifiedAt = verifiedAt;
      }
    },
    count: async (objectKey, country) =>
      [...this.idMapRows.values()].filter(
        (r) =>
          r.objectKey === objectKey &&
          (!country || r.country === country) &&
          !r.deletedAt &&
          !r.mergedInto,
      ).length,
    iterate: (objectKey, country) => {
      const rows = [...this.idMapRows.values()].filter(
        (r) => r.objectKey === objectKey && (!country || r.country === country),
      );
      return (async function* () {
        for (const r of rows) yield clone(r);
      })();
    },
    purgeDryRun: async () => {
      let n = 0;
      for (const [k, r] of this.idMapRows)
        if (r.dryRun) {
          this.reindexIdMap(k, undefined);
          this.idMapRows.delete(k);
          n++;
        }
      return n;
    },
  };

  rowResults: RowResultsRepo = {
    upsert: async (rows) => {
      for (const r of rows)
        this.rowResultRows.set(`${r.runId}|${r.objectKey}|${to18(r.sfdcId)}`, {
          ...clone(r),
          sfdcId: to18(r.sfdcId),
        });
    },
    get: async (runId, objectKey, sfdcId) =>
      clone(this.rowResultRows.get(`${runId}|${objectKey}|${to18(sfdcId)}`)),
    query: async (filter) => {
      const states =
        filter.state === undefined
          ? undefined
          : Array.isArray(filter.state)
            ? filter.state
            : [filter.state];
      let out = [...this.rowResultRows.values()].filter(
        (r) =>
          r.runId === filter.runId &&
          (!filter.objectKey || r.objectKey === filter.objectKey) &&
          (!filter.country || r.country === filter.country) &&
          (!states || states.includes(r.state)) &&
          (!filter.errorType || r.errorType === filter.errorType) &&
          (filter.batchNo === undefined || r.batchNo === filter.batchNo),
      );
      if (filter.offset) out = out.slice(filter.offset);
      if (filter.limit !== undefined) out = out.slice(0, filter.limit);
      return clone(out);
    },
    countByState: async (runId, objectKey, country) => {
      const out: Partial<Record<RowState, number>> = {};
      for (const r of this.rowResultRows.values())
        if (
          r.runId === runId &&
          r.objectKey === objectKey &&
          r.country === country
        )
          out[r.state] = (out[r.state] ?? 0) + 1;
      return out;
    },
    countFailedByType: async (runId, objectKey, country) => {
      const out: Record<string, number> = {};
      for (const r of this.rowResultRows.values())
        if (
          r.runId === runId &&
          r.objectKey === objectKey &&
          r.country === country &&
          r.state === "failed"
        ) {
          const t = r.errorType ?? "UNKNOWN";
          out[t] = (out[t] ?? 0) + 1;
        }
      return out;
    },
  };

  pendingFk: PendingFkRepo = {
    add: async (rows) => {
      for (const r of rows) {
        const key = `${r.runId}|${r.objectKey}|${to18(r.sfdcId)}|${r.field}`;
        const existing = this.pendingRows.get(key);
        this.pendingRows.set(key, {
          ...clone(r),
          sfdcId: to18(r.sfdcId),
          attempts: existing?.attempts ?? r.attempts,
        });
      }
    },
    list: async (runId, filter = {}) =>
      clone(
        [...this.pendingRows.values()].filter(
          (r) =>
            r.runId === runId &&
            (!filter.objectKey || r.objectKey === filter.objectKey) &&
            (!filter.country || r.country === filter.country) &&
            (!filter.unresolvedOnly || !r.resolvedAt),
        ),
      ),
    resolve: async (runId, objectKey, sfdcId, field, resolvedAt) => {
      const r = this.pendingRows.get(
        `${runId}|${objectKey}|${to18(sfdcId)}|${field}`,
      );
      if (r) r.resolvedAt = resolvedAt;
    },
    bumpAttempts: async (runId, objectKey, sfdcId, field) => {
      const r = this.pendingRows.get(
        `${runId}|${objectKey}|${to18(sfdcId)}|${field}`,
      );
      if (r) r.attempts++;
    },
    countUnresolved: async (runId, objectKey, country) =>
      [...this.pendingRows.values()].filter(
        (r) =>
          r.runId === runId &&
          r.objectKey === objectKey &&
          r.country === country &&
          !r.resolvedAt,
      ).length,
  };

  fkIndex: FkIndexRepo = {
    put: async (rows) => {
      for (const r of rows)
        this.fkRows.set(`${r.objectKey}|${to18(r.sfdcId)}|${r.field}`, {
          ...clone(r),
          sfdcId: to18(r.sfdcId),
        });
    },
    childrenOf: async (targetObjectKey, targetSfdcId) =>
      clone(
        [...this.fkRows.values()].filter(
          (r) =>
            r.targetObjectKey === targetObjectKey &&
            r.targetSfdcId === to18(targetSfdcId),
        ),
      ),
    get: async (objectKey, sfdcId) =>
      clone(
        [...this.fkRows.values()].filter(
          (r) => r.objectKey === objectKey && r.sfdcId === to18(sfdcId),
        ),
      ),
  };

  checkpoints: CheckpointsRepo = {
    add: async (cp) => {
      const idx = this.cpRows.findIndex(
        (c) =>
          c.runId === cp.runId &&
          c.jobId === cp.jobId &&
          c.pageNo === cp.pageNo,
      );
      if (idx >= 0) this.cpRows[idx] = clone(cp);
      else this.cpRows.push(clone(cp));
    },
    list: async (runId, objectKey, country) =>
      clone(
        this.cpRows
          .filter(
            (c) =>
              c.runId === runId &&
              c.objectKey === objectKey &&
              c.country === country,
          )
          .sort((a, b) => a.pageNo - b.pageNo),
      ),
    complete: async (runId, jobId, pageNo, completedAt) => {
      const c = this.cpRows.find(
        (x) => x.runId === runId && x.jobId === jobId && x.pageNo === pageNo,
      );
      if (c) c.completedAt = completedAt;
    },
  };

  findings: FindingsRepo = {
    add: async (runId, findings: Finding[]) => {
      const createdAt = nowIso();
      for (const f of findings)
        this.findingRows.push({ ...clone(f), runId, createdAt });
    },
    list: async (runId, filter = {}) =>
      clone(
        this.findingRows.filter(
          (f) =>
            f.runId === runId &&
            (!filter.severity || f.severity === filter.severity) &&
            (!filter.objectKey || f.objectKey === filter.objectKey) &&
            (!filter.country || f.country === filter.country) &&
            (!filter.code || f.code === filter.code),
        ),
      ),
    previous: async (currentRunId) => {
      const idx = this.runOrder.indexOf(currentRunId);
      const prev = idx > 0 ? this.runOrder[idx - 1] : undefined;
      return prev
        ? clone(this.findingRows.filter((f) => f.runId === prev))
        : [];
    },
  };

  reconciliation: ReconciliationRepo = {
    upsert: async (row) => {
      this.reconRows.set(
        `${row.runId}|${row.objectKey}|${row.country}`,
        clone(row),
      );
    },
    get: async (runId, objectKey, country) =>
      clone(this.reconRows.get(`${runId}|${objectKey}|${country}`)),
    list: async (runId) =>
      clone([...this.reconRows.values()].filter((r) => r.runId === runId)),
  };

  mappingSnapshots: MappingSnapshotsRepo = {
    put: async (s) => {
      this.snapshots.set(
        `${s.mappingHash}|${s.objectKey}|${s.country}`,
        clone(s),
      );
    },
    get: async (mappingHash, objectKey, country) =>
      clone(this.snapshots.get(`${mappingHash}|${objectKey}|${country}`)),
    latestFor: async (objectKey, country) =>
      clone(
        [...this.snapshots.values()]
          .filter((s) => s.objectKey === objectKey && s.country === country)
          .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0],
      ),
  };

  auditLog: AuditLogRepo = {
    append: async (entry) => {
      this.audit.push({ ...clone(entry), id: ++this.auditSeq });
    },
    list: async (filter = {}) => {
      let out = this.audit.filter(
        (e) =>
          (!filter.runId || e.runId === filter.runId) &&
          (!filter.event || e.event === filter.event),
      );
      if (filter.limit !== undefined) out = out.slice(-filter.limit);
      return clone(out);
    },
  };

  probeResults: ProbeResultsRepo = {
    get: async (probe) => clone(this.probes.get(probe)),
    set: async (r) => {
      this.probes.set(r.probe, clone({ ...r, vaultDns: this.vaultDns }));
    },
    list: async () => clone([...this.probes.values()]),
  };

  countryStatus: CountryStatusRepo = {
    setFrozen: async (country: CountryCode, frozenAt) => {
      if (frozenAt === null) this.frozen.delete(country);
      else this.frozen.set(country, frozenAt);
    },
    isFrozen: async (country) => this.frozen.has(country),
    list: async () =>
      [...this.frozen.entries()].map(([country, frozenAt]) => ({
        country,
        frozenAt,
      })),
  };

  async migrate(): Promise<void> {
    /* no-op */
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  /** Test helper: seed id-map rows compactly. */
  async seedIdMap(
    objectKey: ObjectKey,
    vaultObject: string,
    entries: Record<string, string>,
    country: CountryCode = "US",
    runId = "seed",
  ): Promise<void> {
    for (const [sfdcId, vaultId] of Object.entries(entries))
      await this.idMap.put({
        objectKey,
        sfdcId,
        vaultDns: this.vaultDns,
        vaultObject,
        vaultId,
        country,
        matchMethod: "created",
        firstSeenRun: runId,
        lastSeenRun: runId,
      });
  }

  /** Test helper: an `IdResolver` view of the current id map (sync snapshot). */
  idResolver(): {
    resolve(objectKey: ObjectKey, sfdcId: string): string | undefined;
    resolveUser(sfdcId: string): number | undefined;
  } {
    return {
      resolve: (objectKey, sfdcId) => {
        const r = this.idMapRows.get(this.idKey(objectKey, sfdcId));
        return r && !r.deletedAt ? r.vaultId : undefined;
      },
      resolveUser: (sfdcId) => {
        const r = this.idMapRows.get(this.idKey("user", sfdcId));
        return r && !r.deletedAt ? Number(r.vaultId) : undefined;
      },
    };
  }

  /** Test helper: watermark kinds seen for a unit. */
  watermarkKinds(objectKey: ObjectKey, country: CountryCode): WatermarkKind[] {
    return [...this.wmMap.values()]
      .filter((w) => w.objectKey === objectKey && w.country === country)
      .map((w) => w.kind);
  }
}
