import {
  pgTable,
  text,
  integer,
  jsonb,
  boolean,
  timestamp,
  doublePrecision,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";

import { repositories } from "./repos";
import { testResults } from "./tests";

// ─────────────────────────────────────────────────────────────────────────────
// Data-driven coverage model (P1 / D0)
//
// Coverage is measured over a DATA SPACE, not a page count. A `dimension` is a
// field with an enumerable value domain (country, call type, channel). A `cell`
// is a combination of dimension values that ACTUALLY OCCURS in the data. Cells
// carry a weight so the planner can rank them and the QA agent has a principled
// stopping rule instead of a hardcoded plan cap.
//
// Cell↔run attribution is free: the executor already persists the resolved
// assign-mode variable map on test_results.assignedVariables, and that map IS
// the cell coordinate of the run.
// ─────────────────────────────────────────────────────────────────────────────

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

export const coverageDimensions = pgTable(
  "coverage_dimensions",
  {
    id: text("id").primaryKey(),
    repositoryId: text("repository_id")
      .references(() => repositories.id, { onDelete: "cascade" })
      .notNull(),
    environmentKey: text("environment_key")
      .notNull()
      .default(DEFAULT_COVERAGE_ENVIRONMENT),
    /** Object type / DB table in the system under test ('call__v', 'orders').
     *  Free text — Lastest does not own the SUT's type system. */
    objectType: text("object_type").notNull(),
    /** Field on that object ('country__v'). For csv/sheet sources this is the
     *  column header; for observed sources it is the TestVariable name. */
    field: text("field").notNull(),
    label: text("label"),
    valueSource: text("value_source")
      .$type<CoverageValueSource>()
      .notNull()
      .default("observed"),
    /** csv/gsheet data-source alias this dimension was derived from. */
    sourceAlias: text("source_alias"),
    values: jsonb("values").$type<CoverageDimensionValue[]>().notNull(),
    /** Distinct value count — denormalized from values for cheap filtering. */
    cardinality: integer("cardinality").notNull().default(0),
    /** Auto-detected dimensions start disabled; the user confirms them.
     *  Prevents free-text fields silently exploding the cell space. */
    enabled: boolean("enabled").notNull().default(false),
    profiledAt: timestamp("profiled_at"),
    createdAt: timestamp("created_at").$defaultFn(() => new Date()),
    updatedAt: timestamp("updated_at").$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("uq_coverage_dimension").on(
      table.repositoryId,
      table.environmentKey,
      table.objectType,
      table.field,
    ),
    index("idx_coverage_dimensions_repo").on(table.repositoryId),
  ],
);

export type CoverageDimension = typeof coverageDimensions.$inferSelect;
export type NewCoverageDimension = typeof coverageDimensions.$inferInsert;

export const coverageCells = pgTable(
  "coverage_cells",
  {
    id: text("id").primaryKey(),
    repositoryId: text("repository_id")
      .references(() => repositories.id, { onDelete: "cascade" })
      .notNull(),
    environmentKey: text("environment_key")
      .notNull()
      .default(DEFAULT_COVERAGE_ENVIRONMENT),
    objectType: text("object_type").notNull(),
    /** Canonical serialization of coords ('callType=Detail|country=DE') —
     *  field-sorted so the unique index is stable regardless of key order. */
    coordsKey: text("coords_key").notNull(),
    coords: jsonb("coords").$type<Record<string, string>>().notNull(),
    /** Records in the SUT matching this combination. 0 = unknown, not absent —
     *  only 'profiled' dimensions can distinguish the two. */
    observedCount: integer("observed_count").notNull().default(0),
    /** Normalized 0..1 priority. See CoverageWeightPolicy. */
    weight: doublePrecision("weight").notNull().default(0),
    weightBreakdown: jsonb("weight_breakdown").$type<CoverageWeightBreakdown>(),
    status: text("status")
      .$type<CoverageCellStatus>()
      .notNull()
      .default("uncovered"),
    /** Why this cell is deliberately not tested — the artifact that lets the
     *  QA agent justify what it skipped. Required when status='excluded'. */
    excludedReason: text("excluded_reason"),
    runCount: integer("run_count").notNull().default(0),
    passCount: integer("pass_count").notNull().default(0),
    failCount: integer("fail_count").notNull().default(0),
    lastRunAt: timestamp("last_run_at"),
    lastVerdict: text("last_verdict"),
    createdAt: timestamp("created_at").$defaultFn(() => new Date()),
    updatedAt: timestamp("updated_at").$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("uq_coverage_cell").on(
      table.repositoryId,
      table.environmentKey,
      table.objectType,
      table.coordsKey,
    ),
    index("idx_coverage_cells_repo_status").on(
      table.repositoryId,
      table.status,
    ),
    index("idx_coverage_cells_weight").on(table.repositoryId, table.weight),
  ],
);

export type CoverageCell = typeof coverageCells.$inferSelect;
export type NewCoverageCell = typeof coverageCells.$inferInsert;

/** Which run exercised which cell. Derived from test_results.assignedVariables,
 *  so it backfills over history with no change to test code. */
export const coverageCellRuns = pgTable(
  "coverage_cell_runs",
  {
    id: text("id").primaryKey(),
    cellId: text("cell_id")
      .references(() => coverageCells.id, { onDelete: "cascade" })
      .notNull(),
    testResultId: text("test_result_id")
      .references(() => testResults.id, { onDelete: "cascade" })
      .notNull(),
    testId: text("test_id"),
    buildId: text("build_id"),
    /** Mirrors test_results.status: 'passed' | 'failed' | 'skipped'. */
    verdict: text("verdict"),
    ranAt: timestamp("ran_at"),
    recordedAt: timestamp("recorded_at").$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("uq_coverage_cell_run").on(table.cellId, table.testResultId),
    index("idx_coverage_cell_runs_cell").on(table.cellId),
    index("idx_coverage_cell_runs_result").on(table.testResultId),
  ],
);

export type CoverageCellRun = typeof coverageCellRuns.$inferSelect;
export type NewCoverageCellRun = typeof coverageCellRuns.$inferInsert;

/** How a snapshot came to exist. 'backfill' rows are RECONSTRUCTED from the
 *  attribution ledger against today's cell set and weights, so they answer
 *  "how much of the current model had been exercised by then" — not "what the
 *  model said at the time". Kept distinguishable so a trend chart can say so
 *  rather than implying a measurement that never happened. */
export type CoverageSnapshotSource = "sync" | "build" | "backfill";

/** Per-object-type slice of a snapshot. Mirrors ObjectTypeRollup's headline
 *  numbers (see src/lib/coverage/rollup.ts) — enough to explain a movement in
 *  the total without keeping a second copy of the whole report. */
export interface CoverageSnapshotObjectType {
  objectType: string;
  totalCells: number;
  coveredCells: number;
  excludedCells: number;
  cellCoverage: number;
}

/**
 * Point-in-time coverage totals. `coverage_cells` is overwritten in place by
 * every sync, so without this table the model can only ever answer "where are
 * we now" — never "are we improving", which is the question a release
 * regression programme is actually run against.
 */
export const coverageSnapshots = pgTable(
  "coverage_snapshots",
  {
    id: text("id").primaryKey(),
    repositoryId: text("repository_id")
      .references(() => repositories.id, { onDelete: "cascade" })
      .notNull(),
    environmentKey: text("environment_key")
      .notNull()
      .default(DEFAULT_COVERAGE_ENVIRONMENT),
    /** The build this snapshot describes, when it was taken on build
     *  completion or reconstructed for one. Null for plain sync snapshots. */
    buildId: text("build_id"),
    source: text("source")
      .$type<CoverageSnapshotSource>()
      .notNull()
      .default("sync"),
    capturedAt: timestamp("captured_at").notNull(),
    totalCells: integer("total_cells").notNull().default(0),
    coveredCells: integer("covered_cells").notNull().default(0),
    excludedCells: integer("excluded_cells").notNull().default(0),
    failingCells: integer("failing_cells").notNull().default(0),
    /** covered / non-excluded, 0..1. */
    cellCoverage: doublePrecision("cell_coverage").notNull().default(0),
    tupleCoverage: doublePrecision("tuple_coverage").notNull().default(0),
    weightedVolumeCoverage: doublePrecision("weighted_volume_coverage")
      .notNull()
      .default(0),
    dimensionsEnabled: integer("dimensions_enabled").notNull().default(0),
    strength: integer("strength").notNull().default(2),
    shouldStop: boolean("should_stop").notNull().default(false),
    byObjectType: jsonb("by_object_type").$type<CoverageSnapshotObjectType[]>(),
    createdAt: timestamp("created_at").$defaultFn(() => new Date()),
  },
  (table) => [
    // One snapshot per build, so re-running the build hook or the backfill is
    // idempotent rather than duplicating points on the trend line.
    uniqueIndex("uq_coverage_snapshot_build").on(
      table.repositoryId,
      table.environmentKey,
      table.buildId,
    ),
    index("idx_coverage_snapshots_repo_time").on(
      table.repositoryId,
      table.environmentKey,
      table.capturedAt,
    ),
  ],
);

export type CoverageSnapshot = typeof coverageSnapshots.$inferSelect;
export type NewCoverageSnapshot = typeof coverageSnapshots.$inferInsert;
