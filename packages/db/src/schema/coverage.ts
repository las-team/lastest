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

// The model's value types and policies live in `@lastest/coverage-model` —
// the pure half of this feature, which must not import the database. They are
// re-exported here so `@lastest/db/schema` (and `@/lib/db/schema`) keep
// exporting the same names, exactly as this schema already does for the
// runner wire types in `@lastest/eb-protocol`.
import type {
  CoverageCellStatus,
  CoverageDimensionValue,
  CoverageSnapshotObjectType,
  CoverageSnapshotSource,
  CoverageValueSource,
  CoverageWeightBreakdown,
} from "@lastest/coverage-model";
import { DEFAULT_COVERAGE_ENVIRONMENT } from "@lastest/coverage-model";

export type {
  CoverageValueSource,
  CoverageDimensionValue,
  CoverageCellStatus,
  CoverageWeightBreakdown,
  CoverageWeightPolicy,
  CoverageStopPolicy,
  CoverageSnapshotSource,
  CoverageSnapshotObjectType,
} from "@lastest/coverage-model";
export {
  DEFAULT_COVERAGE_WEIGHT_POLICY,
  DEFAULT_COVERAGE_STOP_POLICY,
  DEFAULT_COVERAGE_ENVIRONMENT,
} from "@lastest/coverage-model";

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
