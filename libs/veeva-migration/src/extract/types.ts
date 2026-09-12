/**
 * Extract contract (§2.2). Implemented in `src/extract/*`.
 */
import type { SfdcClient } from "../sfdc/types";
import type { StateStore } from "../store/types";
import type {
  CountryCode,
  MaterialisedMapping,
  ObjectKey,
  SourceRow,
  Unit,
} from "../types";
import type { ResolvedTarget } from "../preflight/types";

export interface ExtractPlan {
  runId: string;
  mode: "init" | "delta" | "final-delta" | "verify" | "retry-failed";
  runDir: string;
  mapping: MaterialisedMapping;
  target: ResolvedTarget;
  /** Explicit literal, §1.1 #2 (`YYYY-MM-DD`). */
  cutoffDate?: string;
  /** Delta window (§4.1), absent on init. Literals `YYYY-MM-DDThh:mm:ssZ`. */
  window?: { wmLo: string; wmHi: string };
  /** Force PK chunking (large objects on init, or after `EXTRACT_COUNT_MISMATCH`). */
  pkChunking?: boolean;
  /** `--limit N` for dry runs. */
  limit?: number;
  /** Prefer REST when the expected size is small (§2.1.5 selection rule). */
  expectedRows?: number;
  /** Delete feed start (watermark kind `deleted`). */
  deletedSince?: string;
  /**
   * Delete feed end when the plan has `deletedSince` but no `window` (full
   * re-extract after a cutoff change, §4.3 step 1): the run's `wm_hi`, so the
   * `deleted` watermark stays aligned with the run clock. Falls back to the
   * extractor clock when absent.
   */
  deletedUntil?: string;
}

export interface ExtractFile {
  path: string;
  jobId: string;
  pageNo: number;
  rows: number;
  /** Rows tagged closure = true bypass the scope filter (§2.2 step 6). */
  closure: boolean;
  /** Partition index when `load.partitionBy` applies (0 = parents). */
  partition?: number;
}

/** FK id-sets collected while streaming (§2.2 step 4), keyed by target object key. */
export type FkIdSets = Map<ObjectKey | "user", Set<string>>;

export interface ExtractManifest {
  unit: Unit;
  files: ExtractFile[];
  fkSets: FkIdSets;
  /** `IsDeleted = false` rows streamed. */
  extractedLive: number;
  /** `IsDeleted = true` rows routed to the delete queue. */
  extractedDeleted: number;
  /** Rows fetched by closure (§1.1 #5). */
  closureRows: number;
  /**
   * REST `COUNT()` (`query` semantics) with the identical predicate (§2.8),
   * **net of the client-side country filter** when the parent id-set
   * strategy filters rows client-side: the §2.8/§8.8 gate compares it with
   * `extractedLive` at tolerance 0, so it must count the same population.
   * The raw `COUNT()` is only compared internally (step 8) with the rows
   * streamed before the filter.
   */
  sfdcScopeCount?: number;
  /** Feed results (§4.4 sources 2). */
  deletedIds: Array<{ id: string; deletedDate: string }>;
  /** `latestDateCovered` to persist as the next `deleted` watermark. */
  deletedLatestCovered?: string;
  /** The predicate actually used (for the report). */
  predicate: string;
  columns: string[];
  /** Queue owners (`00G`) seen, resolved by §3.4. */
  queueOwners: Set<string>;
}

export interface ClosureRequest {
  runId: string;
  country: CountryCode;
  runDir: string;
  /** Remaining ids per object after subtracting the id map and this run's extracts. */
  needed: FkIdSets;
  /** Mappings/targets for the referenced objects (column lists). */
  mappings: Map<ObjectKey, MaterialisedMapping>;
  targets: Map<ObjectKey, ResolvedTarget>;
  maxRounds: number;
  strategy: "soqlIn" | "composite";
  /**
   * Distinguishes this invocation's page files from those of other units
   * that close over the same parent object in the same country (the engine
   * runs the units of a step concurrently). Defaults to a random token;
   * callers should pass the referencing unit id for readable file names.
   */
  tag?: string;
}

export interface ClosureResult {
  /** Per object: files with closure rows + their own FK sets for the next round. */
  files: Map<ObjectKey, ExtractFile[]>;
  rounds: number;
  /** Ids that could not be fetched (deleted/missing parents) — dangling. */
  dangling: FkIdSets;
  fetched: Map<ObjectKey, number>;
}

export interface Extractor {
  /**
   * §2.2 steps 1–4, 8, 9: build predicate + column list, stream CSV pages to
   * `{runDir}/{country}/{objectKey}/extract/`, checkpoint each page, collect FK
   * id-sets, route `IsDeleted` rows, run the `COUNT()` cross-check, produce
   * partitions/sorted streams as declared by `load.partitionBy/orderBy`.
   */
  extractUnit(unit: Unit, plan: ExtractPlan): Promise<ExtractManifest>;
  /** §2.2 step 5 FK closure to a fixpoint (≤ maxRounds, blocking beyond). */
  closure(req: ClosureRequest): Promise<ClosureResult>;
  /** Stream rows back from a manifest/file set (used by transform and retry-failed). */
  readRows(
    files: readonly ExtractFile[],
  ): AsyncIterable<{ row: SourceRow; file: ExtractFile }>;
}

export interface ExtractorDeps {
  sfdc: SfdcClient;
  store: StateStore;
}
