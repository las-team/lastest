/**
 * Preflight contract (§2.6, §5). Implemented in `src/preflight/*`.
 */
import type { SfdcClient } from "../sfdc/types";
import type { StateStore } from "../store/types";
import type { VaultClient } from "../vault/types";
import type { MigrationConfig } from "../config/schema";
import type {
  CountryCode,
  Finding,
  MaterialisedMapping,
  ObjectKey,
  ResolvedMetadata,
  RunMode,
  SfdcObjectDescribe,
  Unit,
  VaultObjectMetadata,
  VaultObjectTypeConfig,
} from "../types";

export interface PreflightInput {
  runId: string;
  mode: RunMode;
  config: MigrationConfig;
  /** Units to check (already filtered by wave/country/objects flags). */
  units: Unit[];
  /** Materialised mappings per unit (from `config/resolve.ts`). */
  mappings: Map<string, MaterialisedMapping>;
  sfdc: SfdcClient;
  /** Vault client per target DNS (CN may differ, §1.2). */
  vaults: Map<string, VaultClient>;
  store: StateStore;
  flags: {
    dryRun?: boolean;
    probeWrites?: boolean;
    allowMdl?: boolean;
    allowPicklistCreate?: boolean;
    allowPicklistReactivate?: boolean;
    acceptMappingChange?: boolean;
    reprobe?: boolean;
  };
}

/** Per-object resolution produced by preflight (feeds the transform context). */
export interface ResolvedTarget {
  objectKey: ObjectKey;
  targetObject: string;
  /** §3.2 selection; undefined = `LEGACY_ID_FIELD_MISSING`. */
  legacyIdField?: string;
  metadata: ResolvedMetadata;
  rawMetadata: VaultObjectMetadata;
  objectTypes: VaultObjectTypeConfig[];
  /** picklist name → active value names. */
  picklists: Record<string, string[]>;
  /** SFDC describe used for the column diff. */
  describe?: SfdcObjectDescribe;
  /** Whether `/deleted/` & `/updated/` may be used (§2.1.6). */
  replicateable: boolean;
  /** Source columns actually selectable (mapped ∩ describe) after `SF_FIELD_MISSING` drops. */
  columns: string[];
}

export interface PreflightResult {
  runId: string;
  findings: Finding[];
  /** keyed by `${objectKey}` (global) — per-country target resolution reuses the object entry unless the country targets another vault (`${objectKey}@${vaultDns}`). */
  resolvedTargets: Map<string, ResolvedTarget>;
  /** Mappings after preflight pruning (fields dropped on `SF_FIELD_MISSING`/`VT_FIELD_MISSING` warnings). */
  mappings: Map<string, MaterialisedMapping>;
  /** Units with a blocking finding (skipped by the run). */
  blockedUnits: Unit[];
  /** True when any global blocking finding exists (auth, version, permissions) → exit code 2. */
  blocking: boolean;
  /** SFDC org facts (§5.1 info findings). */
  source: {
    orgId: string;
    apiVersion: string;
    multiCurrency: boolean;
    personAccounts: boolean;
    territory2: boolean;
    now: string;
  };
  /** Country crosswalk built per §3.4 (per vault). */
  countries: Map<
    string,
    Array<{
      iso2: CountryCode;
      sfdcId?: string;
      vaultId?: string;
      name?: string;
    }>
  >;
}

export interface Preflight {
  /** Run every §5 check for the given units; never writes business data (probes use `preflight.probeObject`). */
  run(input: PreflightInput): Promise<PreflightResult>;
}
