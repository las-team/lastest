/**
 * The value types and tunable policies of the coverage model.
 *
 * These are the model's own payload shapes — unions, interfaces and the
 * `DEFAULT_*` policies — not table rows. They live here rather than in
 * `packages/db/src/schema/coverage.ts` so that every pure module of this
 * package (`weight`, `stop`, `rollup`, `spec`, `dimensions`, `matrix`,
 * `budget`) can be written without an import into the database schema, which
 * is what makes them a library at all (recipe §5).
 *
 * `packages/db/src/schema/coverage.ts` imports and re-exports all of it, so
 * `@/lib/db/schema` keeps exporting the same names it always did and no app
 * import path changed — the same arrangement the schema already has with
 * `@lastest/eb-protocol` for runner wire types (recipe §6.1, row one).
 *
 * The table row types (`CoverageCell`, `CoverageDimension`, …) stay in the
 * schema: they are `$inferSelect` over a Drizzle table and cannot leave it.
 * Where this package needs them it declares a narrowed shape instead — see
 * `CellLike` / `DimensionLike` in `./types`.
 */

/** Where a dimension's value domain came from. */
export type CoverageValueSource =
  | "csv" // derived from a csvDataSources cached column
  | "sheet" // derived from a googleSheetsDataSources cached column
  | "observed" // derived from historical test_results.assignedVariables
  | "profiled" // queried from the system under test (D3: Vault VQL / SQL / REST)
  | "manual"; // hand-authored by the user

export interface CoverageDimensionValue {
  value: string;
  label?: string;
  /** How many real records carry this value. 0 when unknown (non-profiled). */
  recordCount: number;
  /** recordCount / total, 0..1. Equal shares when counts are unknown. */
  share: number;
}

export type CoverageCellStatus =
  | "uncovered"
  | "planned"
  | "covered"
  | "failing"
  | "excluded";

/** Per-term contribution of the weight formula, kept so the UI can explain a
 *  ranking instead of showing an opaque number. See CoverageWeightPolicy. */
export interface CoverageWeightBreakdown {
  volume: number;
  criticality: number;
  failureHistory: number;
  churn: number;
  redundancy: number;
  total: number;
}

/** Tunable weight formula. Surfaced in settings — never a black box.
 *  weight = wVolume*vol + wCriticality*crit + wFailureHistory*fail
 *         + wChurn*churn - wRedundancy*redundancy   (clamped to >= 0) */
export interface CoverageWeightPolicy {
  wVolume: number;
  wCriticality: number;
  wFailureHistory: number;
  wChurn: number;
  wRedundancy: number;
}

export const DEFAULT_COVERAGE_WEIGHT_POLICY: CoverageWeightPolicy = {
  wVolume: 0.45,
  wCriticality: 0.2,
  wFailureHistory: 0.2,
  wChurn: 0.15,
  wRedundancy: 0.25,
};

/** The QA agent's stopping rule. Replaces the hardcoded MAX_PLAN_ITEMS cap
 *  (see src/lib/qa-agent/plan.ts) from P2 onward; P1 only measures against it. */
export interface CoverageStopPolicy {
  /** t in t-way combinatorial coverage. 2 = pairwise (the default). */
  strength: number;
  /** Required fraction of occurring value-pairs covered, 0..1. */
  pairwiseTarget: number;
  /** Required fraction of weighted record volume covered, 0..1. */
  weightedVolumeTarget: number;
  /** Stop when the next-best uncovered cell's weight falls below this. */
  marginalWeightEpsilon: number;
  /** Escalate to (strength + 1)-way for cells at or above this weight. */
  highRiskWeight: number;
  /** Hard ceiling on generated runs — a backstop, not the primary rule. */
  maxRuns: number;
  /** Skip auto-detected dimensions with more distinct values than this;
   *  free-text fields otherwise produce thousands of useless "values". */
  maxDimensionCardinality: number;
}

export const DEFAULT_COVERAGE_STOP_POLICY: CoverageStopPolicy = {
  strength: 2,
  pairwiseTarget: 1.0,
  weightedVolumeTarget: 0.9,
  marginalWeightEpsilon: 0.01,
  highRiskWeight: 0.6,
  maxRuns: 500,
  maxDimensionCardinality: 50,
};

/** Environment scope key. Until environments become first-class (B2), every
 *  row uses DEFAULT_COVERAGE_ENVIRONMENT so the later migration is a backfill
 *  of this column rather than a table restructure. */
export const DEFAULT_COVERAGE_ENVIRONMENT = "default";

/** How a snapshot came to exist. 'backfill' rows are RECONSTRUCTED from the
 *  attribution ledger against today's cell set and weights, so they answer
 *  "how much of the current model had been exercised by then" — not "what the
 *  model said at the time". Kept distinguishable so a trend chart can say so
 *  rather than implying a measurement that never happened. */
export type CoverageSnapshotSource = "sync" | "build" | "backfill";

/** Per-object-type slice of a snapshot. Mirrors ObjectTypeRollup's headline
 *  numbers (see ./rollup) — enough to explain a movement in
 *  the total without keeping a second copy of the whole report. */
export interface CoverageSnapshotObjectType {
  objectType: string;
  totalCells: number;
  coveredCells: number;
  excludedCells: number;
  cellCoverage: number;
}
