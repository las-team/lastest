/**
 * Load contract (§2.5.4, §4.4, §6.1 pass 2, §8.1–8.4). Implemented in `src/load/*`.
 */
import type { VaultClient } from "../vault/types";
import type { StateStore } from "../store/types";
import type {
  CountryCode,
  DeletePolicy,
  MaterialisedMapping,
  ObjectKey,
  Payload,
  RowDiagnostic,
  RowResult,
  Unit,
} from "../types";
import type { ResolvedTarget } from "../preflight/types";

/** One transformed row ready for batching (payload files, §2.3). */
export interface PayloadRow {
  sfdcId: string;
  /** `SystemModstamp` for last-wins dedupe (§2.5.4) and delete ordering (§4.3). */
  systemModstamp?: string;
  payload: Payload;
  /** Fields held for pass 2 (`secondPass`). */
  secondPass?: Payload;
  sourceHash: string;
  /** Object type api name (for `changetype` routing, §2.5.6). */
  objectType?: string;
  diagnostics: RowDiagnostic[];
  closure?: boolean;
}

export interface LoadPlan {
  runId: string;
  unit: Unit;
  mapping: MaterialisedMapping;
  target: ResolvedTarget;
  runDir: string;
  dryRun: boolean;
  /** `target.migrationMode` default. */
  migrationMode: boolean;
  unchangedFieldBehavior:
    | "AlwaysIgnore"
    | "IgnoreSetOnCreateOnly"
    | "NeverIgnore";
  /** Numeric migration user id for audit fallback (§3.5). */
  migrationUserId?: number;
  /** `performance.vaultBatch` (≤ 500) unless the mapping overrides it. */
  batchSize: number;
  /** `performance.batchWallTimeMs` (§8.1). */
  batchWallTimeMs: number;
}

export interface BatchOutcome {
  batchNo: number;
  rows: number;
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
  pendingFk: number;
  elapsedMs: number;
  burstRemaining?: number;
  /** Outer FAILURE (structural) — unit aborted (§8.1). */
  structuralError?: { type: string; message: string };
}

export interface LoadResult {
  unit: Unit;
  batches: BatchOutcome[];
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
  pendingFk: number;
  skipped: number;
  /** Rows re-routed through `changetype` (§2.5.6). */
  typeChanged: number;
  aborted?: { reason: string; batchNo?: number };
}

export interface SecondPassResult {
  unit: Unit;
  patched: number;
  failed: number;
  unresolved: number;
}

export interface DeleteRequest {
  unit: Unit;
  policy: DeletePolicy;
  /** SFDC ids with the event time (§4.3 step 5 last-wins). */
  ids: Array<{ sfdcId: string; deletedDate: string }>;
  /** `SystemModstamp` seen in this window per id (undelete/update after delete wins). */
  seenModstamps?: Map<string, string>;
}

export interface DeleteResult {
  unit: Unit;
  routed: number;
  applied: number;
  ignored: number;
  pending: number;
  failed: number;
}

export interface Loader {
  /**
   * §2.5.4 batch upsert: dedupe by legacy id (last-wins by SystemModstamp),
   * hash-skip (§8.2), resolve `$fk`/`$user`/`$composite` at send time via the
   * id map (§2.3), split unresolved rows to `pending_fk` (§8.4), write
   * `row_results` + `id_map` (+ `fk_index`), adapt batch size (§8.1).
   */
  loadBatches(
    rows: AsyncIterable<PayloadRow>,
    plan: LoadPlan,
  ): Promise<LoadResult>;
  /** §6.1 pass 2: PUT self-reference fields by Vault id from `secondPass` payloads. */
  secondPass(
    rows: AsyncIterable<PayloadRow>,
    plan: LoadPlan,
  ): Promise<SecondPassResult>;
  /** §4.4 apply deletes per policy; sets `id_map.deleted_at`. */
  applyDeletes(req: DeleteRequest, plan: LoadPlan): Promise<DeleteResult>;
  /** §8.4 re-evaluate the pending queue after parents landed (≤ `pendingFk.maxRounds`). */
  retryPending(plan: LoadPlan, round: number): Promise<LoadResult>;
  /** §8.6 blob pass by Vault id (PUT ≤ `performance.blobBatchBytes`). */
  loadBlobs?(
    rows: AsyncIterable<{ sfdcId: string; blobs: Payload }>,
    plan: LoadPlan,
  ): Promise<LoadResult>;
}

export interface LoaderDeps {
  vault: VaultClient;
  store: StateStore;
  /** Resolves the `id_map` for one country/vault; injected so the loader is testable with `MemoryStateStore`. */
  country: CountryCode;
  /** Row-result sink override (defaults to `store.rowResults.upsert`). */
  onRowResults?: (rows: RowResult[]) => Promise<void>;
  /** Vault object name of a referenced key (for `$fk` → `id_map.vault_object` sanity). */
  targetObjectOf: (key: ObjectKey) => string | undefined;
}
