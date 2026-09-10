/**
 * Veeva CRM → Vault CRM migration: projects, waves and the runs of the engine.
 *
 * Rows a migration LEAD owns rather than rows the engine owns. The split is
 * deliberate and load-bearing:
 *
 *   these tables            → what the customer decided. Which environments are
 *                             source and target, which countries ship in which
 *                             wave, what has been signed off, who pressed the
 *                             button. Small, hand-edited, read on every page.
 *   `veeva_migration.*`     → what the engine did. `@lastest/veeva-migration`'s
 *     (a separate schema      own `StateStore` (§2.4) writes the ID crosswalk,
 *      in the same database)  per-row results, watermarks, reconciliation and
 *                             findings there, and owns its migrations. Nothing
 *                             here duplicates it; `migration_runs.engineRunId`
 *                             is the join.
 *
 * That is why there is no `migration_run_units` table: the unit grid is read
 * live from the engine store, so a run's numbers can never drift from the run.
 * What IS mirrored is the terminal summary (`migration_runs.summary`), because
 * a finished run must stay readable when the engine schema is dropped and
 * re-created between waves.
 */

import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { users } from "./identity";
import { repositories } from "./repos";
import { environments, sutConnectors } from "./settings";

// ============================================
// Stage model
// ============================================

/**
 * The cutover flow, in order — the same nine steps the demo screencast walks
 * (`packages/veeva-migration/demo/`): connect, plan and inspect the mapping,
 * preflight, rehearse with a dry run, initial load, keep in sync with deltas,
 * freeze and cut over, verify, sign off.
 *
 * One stage per thing a migration lead actually does, NOT one per engine mode
 * — `retry-failed`, `blobs` and `report` are actions inside a stage, not
 * stages of their own, and `init --dry-run` is its own stage because
 * rehearsing is a decision point even though it is the same mode.
 *
 * `deriveStageState()` in `src/lib/migration/stages.ts` is the single place
 * that decides which of these is reachable; the UI renders from that.
 */
export const MIGRATION_STAGES = [
  "connect",
  "plan",
  "preflight",
  "dryrun",
  "initial",
  "delta",
  "cutover",
  "verify",
  "signoff",
] as const;

export type MigrationStage = (typeof MIGRATION_STAGES)[number];

export type MigrationProjectStatus =
  | "draft"
  | "active"
  | "signed_off"
  | "archived";

/**
 * The subset of `MigrationConfigInput` a user edits in the UI.
 *
 * Deliberately NOT the whole config: `source` and `target` (hosts, API
 * versions, auth) are DERIVED from the two connectors at run time by
 * `buildMigrationConfig()`, so a rotated Vault password or a re-pointed
 * sandbox never means editing a migration. Everything here is a decision, not
 * a credential — nothing in this blob is secret, and it is served to the
 * browser as-is.
 */
export interface MigrationProjectConfig {
  /** `scope.historyMonths` — how far back transactional data is carried. */
  historyMonths?: number;
  /** `scope.cutoffDate` (YYYY-MM-DD); overrides `historyMonths` when set. */
  cutoffDate?: string;
  sampleRetentionMonths?: number;
  tovRetentionMonths?: number;
  samplesIncludeCalls?: boolean;
  /** Object keys explicitly excluded from every wave. */
  excludedObjects?: string[];
  /** `legacyId.preferred` — legacy-id field candidates, in order. */
  legacyIdFields?: string[];
  /** `delta.overlapMinutes` / `delta.safetyLagMinutes`. */
  deltaOverlapMinutes?: number;
  deltaSafetyLagMinutes?: number;
  /** `preflight.probeWrites` — 1-row create/delete round trips (§5.3). */
  probeWrites?: boolean;
  /** `picklists.onUnmapped`. */
  unmappedPicklistPolicy?: "error" | "skip" | "createValue";
  /** `performance.*` overrides, merged over the engine defaults. */
  performance?: Record<string, number>;
  /** Free-form escape hatch merged last — `objects.*`, `countries.*` overlays. */
  advanced?: Record<string, unknown>;
}

/**
 * A migration from one Salesforce org to one Vault, for one repository.
 *
 * Source and target are `sut_connectors` rows, which are themselves scoped to
 * `environments` — so "migrate UAT first, then PROD" is two projects pointing
 * at two environments, and neither one re-types a host or a password.
 *
 * `set null` on both connector references, not cascade: deleting a connector
 * must leave the migration visible and broken rather than silently deleting a
 * signed-off cutover record.
 */
export const migrationProjects = pgTable(
  "migration_projects",
  {
    id: text("id").primaryKey(),
    repositoryId: text("repository_id")
      .references(() => repositories.id, { onDelete: "cascade" })
      .notNull(),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status")
      .$type<MigrationProjectStatus>()
      .notNull()
      .default("draft"),
    /** Furthest stage the flow has been advanced to; the rail renders from it. */
    stage: text("stage").$type<MigrationStage>().notNull().default("connect"),
    /** Salesforce connector (`sut_connectors.type = 'salesforce'`). */
    sourceConnectorId: text("source_connector_id").references(
      () => sutConnectors.id,
      { onDelete: "set null" },
    ),
    /** Vault connector (`sut_connectors.type = 'vault'`). */
    targetConnectorId: text("target_connector_id").references(
      () => sutConnectors.id,
      { onDelete: "set null" },
    ),
    /** Denormalised from the connectors so the list renders without a join,
     *  and so a deleted connector still says which environment it was. */
    sourceEnvironmentId: text("source_environment_id").references(
      () => environments.id,
      { onDelete: "set null" },
    ),
    targetEnvironmentId: text("target_environment_id").references(
      () => environments.id,
      { onDelete: "set null" },
    ),
    config: jsonb("config").$type<MigrationProjectConfig>().notNull(),
    /** `staging.runDir` — where extract pages and reports are written. */
    runDir: text("run_dir"),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").$defaultFn(() => new Date()),
    updatedAt: timestamp("updated_at").$defaultFn(() => new Date()),
  },
  (table) => [
    index("idx_migration_projects_repo").on(table.repositoryId),
    uniqueIndex("uq_migration_projects_repo_name").on(
      table.repositoryId,
      table.name,
    ),
  ],
);

export type MigrationProject = typeof migrationProjects.$inferSelect;

export type NewMigrationProject = typeof migrationProjects.$inferInsert;

export type MigrationWaveStatus =
  | "planned"
  | "in_progress"
  | "frozen"
  | "signed_off";

/**
 * A set of countries that cut over together (§1.2, §4.5).
 *
 * The engine's unit of work is (object, country); a wave is the unit of
 * *scheduling* over those. `countries` is the wave's ISO list — stored as a
 * jsonb array rather than a Postgres array so the shape matches the engine's
 * `waves[].countries` verbatim and the config builder can hand it straight
 * over.
 */
export const migrationWaves = pgTable(
  "migration_waves",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .references(() => migrationProjects.id, { onDelete: "cascade" })
      .notNull(),
    /** Engine `waves[].name` — `^[a-z][a-z0-9-]*$`, validated in the action. */
    key: text("key").notNull(),
    label: text("label").notNull(),
    countries: jsonb("countries").$type<string[]>().notNull(),
    status: text("status")
      .$type<MigrationWaveStatus>()
      .notNull()
      .default("planned"),
    /** SFDC freeze timestamp (`--freeze-at`), set when the wave enters cutover. */
    freezeAt: timestamp("freeze_at"),
    /** Planned cutover window, for the board. Informational. */
    plannedAt: timestamp("planned_at"),
    signedOffAt: timestamp("signed_off_at"),
    signedOffBy: text("signed_off_by").references(() => users.id, {
      onDelete: "set null",
    }),
    /** Why the reconciliation gate was accepted with exceptions (§8.8). */
    signOffNote: text("sign_off_note"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at").$defaultFn(() => new Date()),
    updatedAt: timestamp("updated_at").$defaultFn(() => new Date()),
  },
  (table) => [
    index("idx_migration_waves_project").on(table.projectId),
    uniqueIndex("uq_migration_waves_project_key").on(
      table.projectId,
      table.key,
    ),
  ],
);

export type MigrationWave = typeof migrationWaves.$inferSelect;

export type NewMigrationWave = typeof migrationWaves.$inferInsert;

/** Engine modes (§2.7) — mirrored here so the DB layer needs no engine import. */
export const MIGRATION_RUN_MODES = [
  "preflight",
  "init",
  "delta",
  "final-delta",
  "verify",
  "retry-failed",
  "blobs",
  "report",
] as const;

export type MigrationRunMode = (typeof MIGRATION_RUN_MODES)[number];

export type MigrationRunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "blocked"
  | "aborted";

/** Terminal roll-up, mirrored so a finished run stays readable forever. */
export interface MigrationRunSummary {
  /** §8.10 exit code. */
  exitCode?: number;
  units?: {
    total: number;
    succeeded: number;
    failed: number;
    blocked: number;
    skipped: number;
  };
  findings?: { blocking: number; warning: number; info: number };
  rows?: {
    extracted: number;
    created: number;
    updated: number;
    unchanged: number;
    skipped: number;
    failed: number;
    pendingFk: number;
    deleted: number;
  };
  /** Reconciliation gate verdict (`final-delta`). */
  gate?: "pass" | "fail" | "pending";
  reportPath?: string;
}

/**
 * One invocation of the engine, launched from the flow console.
 *
 * `engineRunId` is the engine's own run id — the join into
 * `veeva_migration.runs`, `…row_results`, `…reconciliation` and `…findings`,
 * which is where every per-unit number is read from live. It is nullable
 * because the row is written BEFORE the engine starts: a run that dies during
 * wiring must still appear in the history with its error, not vanish.
 */
export const migrationRuns = pgTable(
  "migration_runs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .references(() => migrationProjects.id, { onDelete: "cascade" })
      .notNull(),
    waveId: text("wave_id").references(() => migrationWaves.id, {
      onDelete: "set null",
    }),
    /** `veeva_migration.runs.run_id`. Null until the engine assigns one. */
    engineRunId: text("engine_run_id"),
    /** `background_jobs.id` driving it — what the queue indicator polls. */
    jobId: text("job_id"),
    mode: text("mode").$type<MigrationRunMode>().notNull(),
    status: text("status")
      .$type<MigrationRunStatus>()
      .notNull()
      .default("queued"),
    dryRun: boolean("dry_run").notNull().default(false),
    /** Countries actually passed to the engine (wave list, or a narrowed subset). */
    countries: jsonb("countries").$type<string[]>().notNull().default([]),
    /** `--objects` narrowing, when the operator re-ran part of a step. */
    objects: jsonb("objects").$type<string[]>(),
    /** `retry-failed --run` / `blobs --run` — the run being repaired. */
    parentRunId: text("parent_run_id"),
    freezeAt: timestamp("freeze_at"),
    summary: jsonb("summary").$type<MigrationRunSummary>(),
    error: text("error"),
    /** Operator justification for a manual override (§8.5). */
    justification: text("justification"),
    startedBy: text("started_by").references(() => users.id, {
      onDelete: "set null",
    }),
    startedAt: timestamp("started_at").$defaultFn(() => new Date()),
    finishedAt: timestamp("finished_at"),
  },
  (table) => [
    index("idx_migration_runs_project").on(table.projectId, table.startedAt),
    index("idx_migration_runs_wave").on(table.waveId),
    index("idx_migration_runs_status").on(table.status),
    uniqueIndex("uq_migration_runs_engine_run").on(table.engineRunId),
  ],
);

export type MigrationRun = typeof migrationRuns.$inferSelect;

export type NewMigrationRun = typeof migrationRuns.$inferInsert;

/**
 * A preflight finding a human has explicitly accepted.
 *
 * The findings themselves live in the engine store and are re-derived on every
 * preflight; only the ACCEPTANCE is a decision, so only the acceptance is
 * stored here. Keyed by the finding's stable `code` plus its object/country, so
 * an acknowledgement survives the next preflight run — which is the point: a
 * lead should not re-accept the same known-good warning on every rehearsal.
 */
export const migrationFindingAcks = pgTable(
  "migration_finding_acks",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .references(() => migrationProjects.id, { onDelete: "cascade" })
      .notNull(),
    /** `Finding.code` — stable identifier, never a message. */
    code: text("code").notNull(),
    /** Empty string, not NULL: this is half of a unique key (see below). */
    objectKey: text("object_key").notNull().default(""),
    country: text("country").notNull().default(""),
    /** Required — an accepted blocking finding without a reason is not a decision. */
    justification: text("justification").notNull(),
    acknowledgedBy: text("acknowledged_by").references(() => users.id, {
      onDelete: "set null",
    }),
    acknowledgedAt: timestamp("acknowledged_at").$defaultFn(() => new Date()),
  },
  (table) => [
    index("idx_migration_finding_acks_project").on(table.projectId),
    // `objectKey`/`country` default to '' rather than NULL precisely so this
    // index enforces something: Postgres treats NULLs as distinct, and a
    // project-wide acknowledgement is the common case.
    uniqueIndex("uq_migration_finding_acks_key").on(
      table.projectId,
      table.code,
      table.objectKey,
      table.country,
    ),
  ],
);

export type MigrationFindingAck = typeof migrationFindingAcks.$inferSelect;

export type NewMigrationFindingAck = typeof migrationFindingAcks.$inferInsert;
