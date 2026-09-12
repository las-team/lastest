/**
 * Reconciliation contract (§2.8, §8.8). Implemented in `src/reconcile/*`.
 */
import type { SfdcClient } from "../sfdc/types";
import type { StateStore } from "../store/types";
import type { VaultClient } from "../vault/types";
import type {
  Finding,
  MaterialisedMapping,
  ReconciliationRow,
  Unit,
} from "../types";
import type { ResolvedTarget } from "../preflight/types";
import type { ExtractManifest } from "../extract/types";
import type { DeleteResult, LoadResult } from "../load/types";

export interface ReconcileInput {
  runId: string;
  unit: Unit;
  mapping: MaterialisedMapping;
  target: ResolvedTarget;
  manifest?: ExtractManifest;
  load?: LoadResult;
  deletes?: DeleteResult;
  /** `reconcile.tolerance` (final-delta forces 0). */
  tolerance: number;
  /** `reconcile.sampleSize`. */
  sampleSize: number;
  /** Country predicate for the `vault_count` VQL when the object is country-scoped. */
  vaultCountryPredicate?: string;
  /** Sample roll-up verification required (§6.3.35). */
  verifySampleRollups?: boolean;
}

export interface SampleDiff {
  sfdcId: string;
  vaultId?: string;
  field: string;
  expected: unknown;
  actual: unknown;
}

export interface ReconcileResult {
  row: ReconciliationRow;
  findings: Finding[];
  /** Gate verdict per §8.8. */
  pass: boolean;
  diffs?: SampleDiff[];
  orphanFks?: Array<{ field: string; count: number }>;
}

export interface Reconciler {
  /** §2.8 counts, invariants, aggregate hashes; persists the `reconciliation` row. */
  reconcileUnit(input: ReconcileInput): Promise<ReconcileResult>;
  /** §8.8 stratified sample read-back diff. */
  sample(input: ReconcileInput): Promise<SampleDiff[]>;
  /** §2.8 orphan FK check post-load. */
  orphanFks(
    input: ReconcileInput,
  ): Promise<Array<{ field: string; count: number }>>;
  /** §2.1.6 key-set reconciliation for non-replicateable objects (`verify --keys`). */
  keySet?(
    input: ReconcileInput,
  ): Promise<{ missingInVault: string[]; goneInSource: string[] }>;
  /** §4.2 FK-consistency pass (`verify --fk`). */
  fkConsistency?(
    input: ReconcileInput,
  ): Promise<
    Array<{ sfdcId: string; field: string; expected: string; actual?: string }>
  >;
}

export interface ReconcilerDeps {
  sfdc: SfdcClient;
  vault: VaultClient;
  store: StateStore;
}
