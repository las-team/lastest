/**
 * State store contract (§2.4). `src/store/postgres.ts` implements it on the
 * `veeva_migration` schema; `src/testkit/memory-store.ts` is the reference
 * in-memory implementation that every consumer tests against. Column
 * semantics are those of §2.4; the store instance is bound to one target
 * vault (`vaultDns`) so id-map methods are implicitly scoped (§2.4: one map
 * per target vault; a sandbox map is never reused for production).
 */
import type {
  AuditLogEntry,
  CountryCode,
  ExtractCheckpoint,
  Finding,
  FindingSeverity,
  FkIndexRow,
  IdMapRow,
  MappingSnapshot,
  ObjectKey,
  PendingFk,
  ProbeResult,
  ReconciliationRow,
  RowResult,
  RowState,
  RunMode,
  RunRecord,
  RunStatus,
  StoredFinding,
  Watermark,
  WatermarkKind,
} from "../types";

export interface RunsRepo {
  /** Insert a run row (`status = running`). */
  create(run: RunRecord): Promise<void>;
  get(runId: string): Promise<RunRecord | undefined>;
  /** Patch columns (`finishedAt`, `status`, `mappingHash`, `freezeAt`, …). */
  update(
    runId: string,
    patch: Partial<Omit<RunRecord, "runId">>,
  ): Promise<void>;
  list(filter?: {
    mode?: RunMode;
    status?: RunStatus;
    limit?: number;
  }): Promise<RunRecord[]>;
  /** Latest run with `status = succeeded` (used for `MAP_HASH_CHANGED`, `SF_ORG_MISMATCH`). */
  latestSucceeded(): Promise<RunRecord | undefined>;
}

export interface WatermarksRepo {
  /** §4.1 one watermark per (object, country, kind). */
  get(
    objectKey: ObjectKey,
    country: CountryCode,
    kind: WatermarkKind,
  ): Promise<Watermark | undefined>;
  /** Upsert; called only after a unit fully succeeded (§4.1 advance rule). */
  set(watermark: Watermark): Promise<void>;
  list(filter?: {
    objectKey?: ObjectKey;
    country?: CountryCode;
  }): Promise<Watermark[]>;
}

export interface IdMapRepo {
  /** Lookup by (object, 18-char SFDC id); callers normalise ids with `to18`. Follows nothing — `mergedInto` rows are returned as stored. */
  get(objectKey: ObjectKey, sfdcId: string): Promise<IdMapRow | undefined>;
  /** Upsert one row keyed by (vaultDns, objectKey, sfdcId); `firstSeenRun` is kept on update. */
  put(row: IdMapRow): Promise<void>;
  /** Batched upsert (≥ 500 rows per statement in postgres). */
  putMany(rows: IdMapRow[]): Promise<void>;
  /** Batched lookup → map keyed by sfdcId (missing ids absent). */
  bulkGet(
    objectKey: ObjectKey,
    sfdcIds: readonly string[],
  ): Promise<Map<string, IdMapRow>>;
  /** Reverse lookup by (vaultObject, vaultId) among live rows (unique index of §2.4). */
  byVaultId(
    vaultObject: string,
    vaultId: string,
  ): Promise<IdMapRow | undefined>;
  /** §4.4 soft delete (`deleted_at`); `null` clears it on undelete. */
  markDeleted(
    objectKey: ObjectKey,
    sfdcId: string,
    deletedAt: string | null,
  ): Promise<void>;
  /** §3.4 many→one: set `merged_into = survivor` on the loser (vault_id follows the survivor). */
  merge(
    objectKey: ObjectKey,
    loserSfdcId: string,
    survivorSfdcId: string,
    runId: string,
  ): Promise<void>;
  /** §8.2 hash skip bookkeeping after a successful load. */
  setSourceHash(
    objectKey: ObjectKey,
    sfdcId: string,
    sourceHash: string,
    runId: string,
  ): Promise<void>;
  /** §8.8 verification read-back bookkeeping. */
  setVerified(
    objectKey: ObjectKey,
    sfdcId: string,
    verifiedHash: string,
    verifiedAt: string,
  ): Promise<void>;
  /** Live (not deleted, not merged) row count per unit — reconciliation input. */
  count(objectKey: ObjectKey, country?: CountryCode): Promise<number>;
  /** Stream rows of a unit (used by key-set reconciliation §2.1.6 and fan-out §4.2). */
  iterate(objectKey: ObjectKey, country?: CountryCode): AsyncIterable<IdMapRow>;
  /** §8.9 purge `dryRun = true` rows at the next real run. */
  purgeDryRun(): Promise<number>;
}

export interface RowResultsRepo {
  /** Upsert by (runId, objectKey, sfdcId). */
  upsert(rows: RowResult[]): Promise<void>;
  get(
    runId: string,
    objectKey: ObjectKey,
    sfdcId: string,
  ): Promise<RowResult | undefined>;
  query(filter: {
    runId: string;
    objectKey?: ObjectKey;
    country?: CountryCode;
    state?: RowState | RowState[];
    errorType?: string;
    batchNo?: number;
    limit?: number;
    offset?: number;
  }): Promise<RowResult[]>;
  /** Counts per state for a unit (reconciliation §2.8). */
  countByState(
    runId: string,
    objectKey: ObjectKey,
    country: CountryCode,
  ): Promise<Partial<Record<RowState, number>>>;
  /** Counts of `failed` rows by `errorType`. */
  countFailedByType(
    runId: string,
    objectKey: ObjectKey,
    country: CountryCode,
  ): Promise<Record<string, number>>;
}

export interface PendingFkRepo {
  /** §8.4 enqueue (upsert by runId, objectKey, sfdcId, field). */
  add(rows: PendingFk[]): Promise<void>;
  list(
    runId: string,
    filter?: {
      objectKey?: ObjectKey;
      country?: CountryCode;
      unresolvedOnly?: boolean;
    },
  ): Promise<PendingFk[]>;
  /** Mark resolved (row re-sent) or bump `attempts`. */
  resolve(
    runId: string,
    objectKey: ObjectKey,
    sfdcId: string,
    field: string,
    resolvedAt: string,
  ): Promise<void>;
  bumpAttempts(
    runId: string,
    objectKey: ObjectKey,
    sfdcId: string,
    field: string,
  ): Promise<void>;
  countUnresolved(
    runId: string,
    objectKey: ObjectKey,
    country: CountryCode,
  ): Promise<number>;
}

export interface FkIndexRepo {
  /** §4.2 written during transform; upsert by (objectKey, sfdcId, field). */
  put(rows: FkIndexRow[]): Promise<void>;
  /** Children pointing at a parent (fan-out on merge/re-key). */
  childrenOf(
    targetObjectKey: ObjectKey | "user",
    targetSfdcId: string,
  ): Promise<FkIndexRow[]>;
  /** All FK edges of one row. */
  get(objectKey: ObjectKey, sfdcId: string): Promise<FkIndexRow[]>;
}

export interface CheckpointsRepo {
  /** §2.2 step 3 append `(jobId, locator, page)`. */
  add(cp: ExtractCheckpoint): Promise<void>;
  list(
    runId: string,
    objectKey: ObjectKey,
    country: CountryCode,
  ): Promise<ExtractCheckpoint[]>;
  /** Mark a page fully consumed (transform + load recorded). */
  complete(
    runId: string,
    jobId: string,
    pageNo: number,
    completedAt: string,
  ): Promise<void>;
}

export interface FindingsRepo {
  add(runId: string, findings: Finding[]): Promise<void>;
  list(
    runId: string,
    filter?: {
      severity?: FindingSeverity;
      objectKey?: ObjectKey;
      country?: CountryCode;
      code?: string;
    },
  ): Promise<StoredFinding[]>;
  /** Findings of the previous run for the "new since last run" diff (§5). */
  previous(currentRunId: string): Promise<StoredFinding[]>;
}

export interface ReconciliationRepo {
  upsert(row: ReconciliationRow): Promise<void>;
  get(
    runId: string,
    objectKey: ObjectKey,
    country: CountryCode,
  ): Promise<ReconciliationRow | undefined>;
  list(runId: string): Promise<ReconciliationRow[]>;
}

export interface MappingSnapshotsRepo {
  put(snapshot: MappingSnapshot): Promise<void>;
  get(
    mappingHash: string,
    objectKey: ObjectKey,
    country: CountryCode,
  ): Promise<MappingSnapshot | undefined>;
  /** Most recent snapshot of a unit (for `MAP_HASH_CHANGED`). */
  latestFor(
    objectKey: ObjectKey,
    country: CountryCode,
  ): Promise<MappingSnapshot | undefined>;
}

export interface AuditLogRepo {
  /** §8.5 append-only. */
  append(entry: Omit<AuditLogEntry, "id">): Promise<void>;
  list(filter?: {
    runId?: string;
    event?: string;
    limit?: number;
  }): Promise<AuditLogEntry[]>;
}

export interface ProbeResultsRepo {
  /** §5.3 cached per vault. */
  get(probe: string): Promise<ProbeResult | undefined>;
  set(result: ProbeResult): Promise<void>;
  list(): Promise<ProbeResult[]>;
}

export interface CountryStatusRepo {
  /** §4.5 step 3: countries marked frozen after sign-off. */
  setFrozen(country: CountryCode, frozenAt: string | null): Promise<void>;
  isFrozen(country: CountryCode): Promise<boolean>;
  list(): Promise<Array<{ country: CountryCode; frozenAt: string }>>;
}

export interface StateStore {
  /** Target vault the id map belongs to. */
  readonly vaultDns: string;
  runs: RunsRepo;
  watermarks: WatermarksRepo;
  idMap: IdMapRepo;
  rowResults: RowResultsRepo;
  pendingFk: PendingFkRepo;
  fkIndex: FkIndexRepo;
  checkpoints: CheckpointsRepo;
  findings: FindingsRepo;
  reconciliation: ReconciliationRepo;
  mappingSnapshots: MappingSnapshotsRepo;
  auditLog: AuditLogRepo;
  probeResults: ProbeResultsRepo;
  countryStatus: CountryStatusRepo;
  /** Create tables/schema if missing (postgres); no-op in memory. */
  migrate?(): Promise<void>;
  close(): Promise<void>;
}
