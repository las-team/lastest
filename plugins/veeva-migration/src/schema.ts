import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  char,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Every table this plugin owns — the migration lead's decisions AND the
 * engine's state.
 *
 * ### Why the engine's state is in here now
 *
 * Before this migration the split was across two *owners*, not two concerns:
 * four `migration_*` tables in the core schema barrel, and thirteen more in a
 * Postgres schema called `veeva_migration` that the engine created and wrote
 * through a `postgres()` pool of its own. The decision/engine split was a good
 * idea and is kept — decisions here are small and hand-edited, engine rows are
 * large and machine-written, and `engineRunId` is still the join — but the
 * engine half had three defects that all came from owning its own database:
 *
 *  1. **No tenant key.** `runs` was filtered by `status` alone; `watermarks`
 *     was keyed `(object_key, country, kind)`; only `id_map` and
 *     `probe_results` carried anything at all, and that was `vault_dns` — a
 *     string any team member types into their own connector. One customer
 *     entering another's Vault DNS could page through their crosswalk.
 *  2. **Cross-project collision inside one team.** The documented shape is
 *     "UAT first, then PROD" as two projects. With no project key on
 *     `watermarks`, the PROD initial load inherited UAT's high-water marks and
 *     skipped data. That is a silent data-loss bug, not only an isolation one.
 *  3. **Untraced, unredacted, and a connection per page render.** Its client
 *     was not the instrumented one in `@lastest/db`, so no statement appeared
 *     in a trace and none of its bound-parameter redaction applied; and every
 *     console render opened a four-connection pool and ran DDL under an
 *     advisory lock.
 *
 * All three are structural, so the fix is structural: the engine's `StateStore`
 * is now implemented over `ctx.data` (`src/store/`), the tables live here, and
 * **`projectId` is the leading column of every engine primary key**. A
 * watermark belongs to one project by its key, not by a filter someone has to
 * remember to write.
 *
 * ### Names
 *
 * `core/data`'s `validateSchemaNamespace` requires the `veeva_migration_`
 * prefix on all of them, which also settles the one name clash the merge
 * creates: the lead's runs are `veeva_migration_runs` and the engine's are
 * `veeva_migration_engine_runs`.
 *
 * | Was | Now |
 * | --- | --- |
 * | `migration_projects` | `veeva_migration_projects` |
 * | `migration_waves` | `veeva_migration_waves` |
 * | `migration_runs` | `veeva_migration_runs` |
 * | `migration_finding_acks` | `veeva_migration_finding_acks` |
 * | `veeva_migration.runs` | `veeva_migration_engine_runs` |
 * | `veeva_migration.preflight_findings` | `veeva_migration_findings` |
 * | `veeva_migration.<rest>` | `veeva_migration_<rest>` |
 *
 * `scripts/migrate.js` does the four `ALTER TABLE … RENAME TO` before
 * `drizzle-kit push`, because push cannot see a rename and would resolve it as
 * DROP + CREATE (recipe §2.4). The engine's old schema is dropped outright:
 * its rows are keyed by a `vault_dns` with no project, so there is nothing that
 * could be back-filled into a project-scoped table without guessing.
 *
 * ### Nine foreign keys to core tables, dropped
 *
 * `repositories` (cascade), `sut_connectors` ×2 and `environments` ×2 (set
 * null), `users` ×4 (set null). `core-scope.md` §6 forbids all of them and the
 * database will not cascade for us any more — `deletion.ts` is what replaces
 * them. FKs *between* this plugin's own tables are kept and still cascade:
 * both sides are plugin-owned, so they break no rule.
 *
 * `teamId` is new and `.notNull()` on `veeva_migration_projects`. With the FK
 * to `repositories` gone, it is the only tenancy boundary these tables have —
 * the same tightening `plugins/ci` and `plugins/data-sources` made for the same
 * reason. Everything else reaches its team through `projectId`.
 *
 * ### `run_dir` is gone
 *
 * It was free text, saved by `updateMigrationSettings` with no validation, and
 * the engine called `fs.mkdir` on it — so anyone with `repos:settings` could
 * direct multi-gigabyte writes anywhere the app user could reach. The run
 * directory is now derived by the host from its storage root plus ids
 * (`VeevaMigrationHost.runArtifactRoot`) and never persisted.
 */

// ============================================
// Stage model
// ============================================

/**
 * The cutover flow, in order — the same nine steps the demo screencast walks:
 * connect, plan and inspect the mapping, preflight, rehearse with a dry run,
 * initial load, keep in sync with deltas, freeze and cut over, verify, sign
 * off.
 *
 * One stage per thing a migration lead actually does, NOT one per engine mode
 * — `retry-failed`, `blobs` and `report` are actions inside a stage, not
 * stages of their own, and `init --dry-run` is its own stage because
 * rehearsing is a decision point even though it is the same mode.
 *
 * `deriveFlowState()` in `./flow.ts` is the single place that decides which of
 * these is reachable; the UI renders from that.
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
 * The subset of the engine config a user edits in the UI.
 *
 * Deliberately NOT the whole config: `source` and `target` (hosts, API
 * versions, auth) are DERIVED from the two connectors at run time by
 * `buildConfigSkeleton()`, so a rotated Vault password or a re-pointed sandbox
 * never means editing a migration. Everything here is a decision, not a
 * credential — nothing in this blob is secret, and it is served to the browser
 * as-is.
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

// ============================================
// The lead's decisions
// ============================================

/**
 * A migration from one Salesforce org to one Vault, for one repository.
 *
 * Source and target are `sut_connectors` rows, which are themselves scoped to
 * `environments` — so "migrate UAT first, then PROD" is two projects pointing
 * at two environments, and neither one re-types a host or a password. Those
 * ids are stored, not referenced: convention only, per `core-scope.md` §6. A
 * deleted connector therefore leaves the migration visible and broken rather
 * than silently deleting a signed-off cutover record — which is what the old
 * `set null` FK bought, and what the console's own "connector missing" state
 * now has to render instead.
 */
export const veevaMigrationProjects = pgTable(
  "veeva_migration_projects",
  {
    id: text("id").primaryKey(),
    // Convention-only references to core tables, per core-scope.md §6.
    repositoryId: text("repository_id").notNull(),
    /** The tenancy boundary. See the note at the top of this file. */
    teamId: text("team_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status")
      .$type<MigrationProjectStatus>()
      .notNull()
      .default("draft"),
    /** Furthest stage the flow has been advanced to; the rail renders from it. */
    stage: text("stage").$type<MigrationStage>().notNull().default("connect"),
    /** Salesforce connector (`sut_connectors.type = 'salesforce'`). */
    sourceConnectorId: text("source_connector_id"),
    /** Vault connector (`sut_connectors.type = 'vault'`). */
    targetConnectorId: text("target_connector_id"),
    /** Denormalised from the connectors so the list renders without a join,
     *  and so a deleted connector still says which environment it was. */
    sourceEnvironmentId: text("source_environment_id"),
    targetEnvironmentId: text("target_environment_id"),
    config: jsonb("config").$type<MigrationProjectConfig>().notNull(),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at").$defaultFn(() => new Date()),
    updatedAt: timestamp("updated_at").$defaultFn(() => new Date()),
  },
  (table) => [
    index("idx_veeva_migration_projects_repo").on(table.repositoryId),
    index("idx_veeva_migration_projects_team").on(table.teamId),
    uniqueIndex("uq_veeva_migration_projects_repo_name").on(
      table.repositoryId,
      table.name,
    ),
  ],
);

export type MigrationProject = typeof veevaMigrationProjects.$inferSelect;
export type NewMigrationProject = typeof veevaMigrationProjects.$inferInsert;

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
export const veevaMigrationWaves = pgTable(
  "veeva_migration_waves",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .references(() => veevaMigrationProjects.id, { onDelete: "cascade" })
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
    signedOffBy: text("signed_off_by"),
    /** Why the reconciliation gate was accepted with exceptions (§8.8). */
    signOffNote: text("sign_off_note"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at").$defaultFn(() => new Date()),
    updatedAt: timestamp("updated_at").$defaultFn(() => new Date()),
  },
  (table) => [
    index("idx_veeva_migration_waves_project").on(table.projectId),
    uniqueIndex("uq_veeva_migration_waves_project_key").on(
      table.projectId,
      table.key,
    ),
  ],
);

export type MigrationWave = typeof veevaMigrationWaves.$inferSelect;
export type NewMigrationWave = typeof veevaMigrationWaves.$inferInsert;

/** Engine modes (§2.7) — mirrored here so the data layer needs no engine import. */
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
 * `veeva_migration_engine_runs`, `…row_results`, `…reconciliation` and
 * `…findings`, which is where every per-unit number is read from live. It is
 * nullable because the row is written BEFORE the engine starts: a run that
 * dies during wiring must still appear in the history with its error, not
 * vanish.
 *
 * `jobId` is a `plugin_jobs.id` now, not a `background_jobs.id`. The run used
 * to be a detached in-process promise beside a `background_jobs` row; core's
 * plugin queue owns the lifecycle instead, which is where the run's abort
 * signal comes from.
 */
export const veevaMigrationRuns = pgTable(
  "veeva_migration_runs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .references(() => veevaMigrationProjects.id, { onDelete: "cascade" })
      .notNull(),
    waveId: text("wave_id").references(() => veevaMigrationWaves.id, {
      onDelete: "set null",
    }),
    /** `veeva_migration_engine_runs.run_id`. Null until the engine assigns one. */
    engineRunId: text("engine_run_id"),
    /** `plugin_jobs.id` driving it — what the queue indicator polls. */
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
    startedBy: text("started_by"),
    startedAt: timestamp("started_at").$defaultFn(() => new Date()),
    finishedAt: timestamp("finished_at"),
  },
  (table) => [
    index("idx_veeva_migration_runs_project").on(
      table.projectId,
      table.startedAt,
    ),
    index("idx_veeva_migration_runs_wave").on(table.waveId),
    index("idx_veeva_migration_runs_status").on(table.status),
    // Per project, not globally: engine run ids are only unique within the
    // project that produced them now that the engine tables are project-keyed.
    uniqueIndex("uq_veeva_migration_runs_engine_run").on(
      table.projectId,
      table.engineRunId,
    ),
  ],
);

export type MigrationRun = typeof veevaMigrationRuns.$inferSelect;
export type NewMigrationRun = typeof veevaMigrationRuns.$inferInsert;

/**
 * A preflight finding a human has explicitly accepted.
 *
 * The findings themselves live in the engine tables and are re-derived on every
 * preflight; only the ACCEPTANCE is a decision, so only the acceptance is
 * stored here. Keyed by the finding's stable `code` plus its object/country, so
 * an acknowledgement survives the next preflight run — which is the point: a
 * lead should not re-accept the same known-good warning on every rehearsal.
 */
export const veevaMigrationFindingAcks = pgTable(
  "veeva_migration_finding_acks",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .references(() => veevaMigrationProjects.id, { onDelete: "cascade" })
      .notNull(),
    /** `Finding.code` — stable identifier, never a message. */
    code: text("code").notNull(),
    /** Empty string, not NULL: this is half of a unique key (see below). */
    objectKey: text("object_key").notNull().default(""),
    country: text("country").notNull().default(""),
    /** Required — an accepted blocking finding without a reason is not a decision. */
    justification: text("justification").notNull(),
    acknowledgedBy: text("acknowledged_by"),
    acknowledgedAt: timestamp("acknowledged_at").$defaultFn(() => new Date()),
  },
  (table) => [
    index("idx_veeva_migration_finding_acks_project").on(table.projectId),
    // `objectKey`/`country` default to '' rather than NULL precisely so this
    // index enforces something: Postgres treats NULLs as distinct, and a
    // project-wide acknowledgement is the common case.
    uniqueIndex("uq_veeva_migration_finding_acks_key").on(
      table.projectId,
      table.code,
      table.objectKey,
      table.country,
    ),
  ],
);

export type MigrationFindingAck = typeof veevaMigrationFindingAcks.$inferSelect;
export type NewMigrationFindingAck =
  typeof veevaMigrationFindingAcks.$inferInsert;

// ============================================
// The engine's state
// ============================================

/**
 * Every table below is the engine's, translated from the `TABLES` map that used
 * to render raw DDL in `src/store/sql.ts`, with two systematic changes:
 *
 *  - **`projectId` is prepended to every primary key**, and is the first
 *    column of every index the store queries through. That is the tenancy fix;
 *    see the note at the top of this file for what it repairs.
 *  - **Timestamps stay `text`.** The engine writes and compares ISO-8601
 *    strings throughout (watermarks are compared lexicographically, which is
 *    only sound because they are ISO), and `RunRecord.startedAt` and friends
 *    are typed `string` in the engine's own contract. Converting here would
 *    mean converting in every store method, for nothing.
 *
 * `schema_migrations` is not translated: core owns DDL now (`pnpm db:push`), so
 * the engine's hand-rolled version table has nothing left to do.
 */

/** §2.4 the engine's own run rows. `veeva_migration_runs` is the lead's view. */
export const veevaMigrationEngineRuns = pgTable(
  "veeva_migration_engine_runs",
  {
    projectId: text("project_id")
      .references(() => veevaMigrationProjects.id, { onDelete: "cascade" })
      .notNull(),
    runId: text("run_id").notNull(),
    mode: text("mode").notNull(),
    wave: text("wave"),
    countries: jsonb("countries").$type<string[]>().notNull(),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
    status: text("status").notNull(),
    toolVersion: text("tool_version").notNull(),
    configHash: text("config_hash").notNull(),
    mappingHash: text("mapping_hash"),
    sourceOrgId: text("source_org_id"),
    sourceApiVersion: text("source_api_version"),
    targetVaultId: text("target_vault_id"),
    targetVaultDns: text("target_vault_dns"),
    targetApiVersion: text("target_api_version"),
    sfdcNowAtStart: text("sfdc_now_at_start"),
    freezeAt: text("freeze_at"),
    dryRun: boolean("dry_run").notNull().default(false),
  },
  (table) => [
    primaryKey({
      name: "pk_veeva_migration_engine_runs",
      columns: [table.projectId, table.runId],
    }),
    index("idx_veeva_migration_engine_runs_status").on(
      table.projectId,
      table.status,
      table.startedAt,
    ),
  ],
);

/**
 * §4.1 one watermark per (project, object, country, kind).
 *
 * The `projectId` here is the single most important column in this file. Its
 * absence is what made the documented "UAT project then PROD project" shape
 * unsafe: both read and wrote the same three-column key, so PROD's initial load
 * started from UAT's high-water mark and skipped every row in between.
 */
export const veevaMigrationWatermarks = pgTable(
  "veeva_migration_watermarks",
  {
    projectId: text("project_id")
      .references(() => veevaMigrationProjects.id, { onDelete: "cascade" })
      .notNull(),
    objectKey: text("object_key").notNull(),
    country: text("country").notNull(),
    kind: text("kind").notNull(),
    value: text("value").notNull(),
    cutoffDate: text("cutoff_date"),
    runId: text("run_id").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({
      name: "pk_veeva_migration_watermarks",
      columns: [table.projectId, table.objectKey, table.country, table.kind],
    }),
  ],
);

/** §2.5.1 the legacy-id ↔ Vault-id crosswalk. The crown jewels. */
export const veevaMigrationIdMap = pgTable(
  "veeva_migration_id_map",
  {
    projectId: text("project_id")
      .references(() => veevaMigrationProjects.id, { onDelete: "cascade" })
      .notNull(),
    objectKey: text("object_key").notNull(),
    sfdcId: char("sfdc_id", { length: 18 }).notNull(),
    vaultDns: text("vault_dns").notNull(),
    vaultObject: text("vault_object").notNull(),
    vaultId: text("vault_id").notNull(),
    country: text("country").notNull(),
    matchMethod: text("match_method").notNull(),
    mergedInto: char("merged_into", { length: 18 }),
    firstSeenRun: text("first_seen_run").notNull(),
    lastSeenRun: text("last_seen_run").notNull(),
    sourceHash: text("source_hash"),
    verifiedHash: text("verified_hash"),
    verifiedAt: text("verified_at"),
    deletedAt: text("deleted_at"),
    objectType: text("object_type"),
    dryRun: boolean("dry_run").notNull().default(false),
  },
  (table) => [
    primaryKey({
      name: "pk_veeva_migration_id_map",
      columns: [table.projectId, table.vaultDns, table.objectKey, table.sfdcId],
    }),
    // The reverse lookup, still partial: a merged-away or deleted row may
    // legitimately share a Vault id with its survivor.
    uniqueIndex("uq_veeva_migration_id_map_vault")
      .on(table.projectId, table.vaultDns, table.vaultObject, table.vaultId)
      .where(sql`merged_into is null and deleted_at is null`),
    index("idx_veeva_migration_id_map_unit").on(
      table.projectId,
      table.vaultDns,
      table.objectKey,
      table.country,
    ),
  ],
);

/** §8.2 per-row load outcome, the resume ledger. */
export const veevaMigrationRowResults = pgTable(
  "veeva_migration_row_results",
  {
    projectId: text("project_id")
      .references(() => veevaMigrationProjects.id, { onDelete: "cascade" })
      .notNull(),
    runId: text("run_id").notNull(),
    objectKey: text("object_key").notNull(),
    country: text("country").notNull(),
    sfdcId: char("sfdc_id", { length: 18 }).notNull(),
    batchNo: integer("batch_no"),
    state: text("state").notNull(),
    errorType: text("error_type"),
    errorMessage: text("error_message"),
    attempt: integer("attempt").notNull(),
    payloadHash: text("payload_hash"),
    vaultId: text("vault_id"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({
      name: "pk_veeva_migration_row_results",
      columns: [table.projectId, table.runId, table.objectKey, table.sfdcId],
    }),
    index("idx_veeva_migration_row_results_unit").on(
      table.projectId,
      table.runId,
      table.objectKey,
      table.country,
      table.state,
    ),
  ],
);

/** §8.4 references that could not resolve yet, retried in rounds. */
export const veevaMigrationPendingFk = pgTable(
  "veeva_migration_pending_fk",
  {
    projectId: text("project_id")
      .references(() => veevaMigrationProjects.id, { onDelete: "cascade" })
      .notNull(),
    runId: text("run_id").notNull(),
    objectKey: text("object_key").notNull(),
    country: text("country").notNull(),
    sfdcId: char("sfdc_id", { length: 18 }).notNull(),
    field: text("field").notNull(),
    targetObjectKey: text("target_object_key").notNull(),
    targetSfdcId: char("target_sfdc_id", { length: 18 }).notNull(),
    attempts: integer("attempts").notNull(),
    resolvedAt: text("resolved_at"),
  },
  (table) => [
    primaryKey({
      name: "pk_veeva_migration_pending_fk",
      columns: [
        table.projectId,
        table.runId,
        table.objectKey,
        table.sfdcId,
        table.field,
      ],
    }),
    index("idx_veeva_migration_pending_fk_unit").on(
      table.projectId,
      table.runId,
      table.objectKey,
      table.country,
    ),
  ],
);

/** §8.2 extract paging checkpoints, so a resumed extract does not re-page. */
export const veevaMigrationExtractCheckpoints = pgTable(
  "veeva_migration_extract_checkpoints",
  {
    projectId: text("project_id")
      .references(() => veevaMigrationProjects.id, { onDelete: "cascade" })
      .notNull(),
    runId: text("run_id").notNull(),
    objectKey: text("object_key").notNull(),
    country: text("country").notNull(),
    jobId: text("job_id").notNull(),
    locator: text("locator"),
    pageNo: integer("page_no").notNull(),
    rows: integer("rows").notNull(),
    file: text("file").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [
    primaryKey({
      name: "pk_veeva_migration_extract_checkpoints",
      columns: [table.projectId, table.runId, table.jobId, table.pageNo],
    }),
    index("idx_veeva_migration_extract_checkpoints_unit").on(
      table.projectId,
      table.runId,
      table.objectKey,
      table.country,
    ),
  ],
);

/**
 * §5 findings of a run — preflight's and the loader's both.
 *
 * Named `veeva_migration_findings`, not `…_preflight_findings`: the engine has
 * always written load-time and reconciliation findings here too, and the old
 * name misdescribed it.
 */
export const veevaMigrationFindings = pgTable(
  "veeva_migration_findings",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    projectId: text("project_id")
      .references(() => veevaMigrationProjects.id, { onDelete: "cascade" })
      .notNull(),
    runId: text("run_id").notNull(),
    severity: text("severity").notNull(),
    code: text("code").notNull(),
    objectKey: text("object_key"),
    country: text("country"),
    field: text("field"),
    detail: jsonb("detail"),
    count: integer("count"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_veeva_migration_findings_run").on(table.projectId, table.runId),
  ],
);

/** §8.8 per-unit counts and the gate verdict. */
export const veevaMigrationReconciliation = pgTable(
  "veeva_migration_reconciliation",
  {
    projectId: text("project_id")
      .references(() => veevaMigrationProjects.id, { onDelete: "cascade" })
      .notNull(),
    runId: text("run_id").notNull(),
    objectKey: text("object_key").notNull(),
    country: text("country").notNull(),
    sfdcScopeCount: integer("sfdc_scope_count"),
    extracted: integer("extracted").notNull(),
    extractedDeleted: integer("extracted_deleted"),
    closure: integer("closure"),
    transformed: integer("transformed").notNull(),
    skipped: integer("skipped").notNull(),
    skippedByReason: jsonb("skipped_by_reason"),
    pendingFk: integer("pending_fk").notNull(),
    created: integer("created").notNull(),
    updated: integer("updated").notNull(),
    unchanged: integer("unchanged").notNull(),
    failed: integer("failed").notNull(),
    failedByType: jsonb("failed_by_type"),
    deleted: integer("deleted").notNull(),
    deletedApplied: integer("deleted_applied"),
    deletedIgnored: integer("deleted_ignored"),
    deletedPending: integer("deleted_pending"),
    vaultCount: integer("vault_count"),
    aggHashSrc: text("agg_hash_src"),
    aggHashTgt: text("agg_hash_tgt"),
    status: text("status").notNull(),
  },
  (table) => [
    primaryKey({
      name: "pk_veeva_migration_reconciliation",
      columns: [table.projectId, table.runId, table.objectKey, table.country],
    }),
  ],
);

/** §2.1.5 the materialised field mapping a run actually used. */
export const veevaMigrationMappingSnapshots = pgTable(
  "veeva_migration_mapping_snapshots",
  {
    projectId: text("project_id")
      .references(() => veevaMigrationProjects.id, { onDelete: "cascade" })
      .notNull(),
    mappingHash: text("mapping_hash").notNull(),
    objectKey: text("object_key").notNull(),
    country: text("country").notNull(),
    materialised: jsonb("materialised").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({
      name: "pk_veeva_migration_mapping_snapshots",
      columns: [
        table.projectId,
        table.mappingHash,
        table.objectKey,
        table.country,
      ],
    }),
    index("idx_veeva_migration_mapping_snapshots_unit").on(
      table.projectId,
      table.objectKey,
      table.country,
      table.createdAt,
    ),
  ],
);

/** §4.2 who points at whom, for the orphan-FK pass. */
export const veevaMigrationFkIndex = pgTable(
  "veeva_migration_fk_index",
  {
    projectId: text("project_id")
      .references(() => veevaMigrationProjects.id, { onDelete: "cascade" })
      .notNull(),
    objectKey: text("object_key").notNull(),
    sfdcId: char("sfdc_id", { length: 18 }).notNull(),
    field: text("field").notNull(),
    targetObjectKey: text("target_object_key").notNull(),
    targetSfdcId: char("target_sfdc_id", { length: 18 }).notNull(),
    runId: text("run_id").notNull(),
  },
  (table) => [
    primaryKey({
      name: "pk_veeva_migration_fk_index",
      columns: [table.projectId, table.objectKey, table.sfdcId, table.field],
    }),
    index("idx_veeva_migration_fk_index_target").on(
      table.projectId,
      table.targetObjectKey,
      table.targetSfdcId,
    ),
  ],
);

/**
 * §8.5 the append-only audit trail.
 *
 * `actor` is the acting user's id, supplied by the caller through
 * `RunContext.actor`. It used to be `process.env.USER`, which in a regulated
 * cutover meant the engine's own audit log — the record that matters — said
 * the server's OS account pressed every button.
 */
export const veevaMigrationAuditLog = pgTable(
  "veeva_migration_audit_log",
  {
    // `bigserial`, not a uuid: the engine's `AuditLogEntry.id` is typed
    // `number` and the log is read in insertion order.
    id: bigserial("id", { mode: "number" }).primaryKey(),
    projectId: text("project_id")
      .references(() => veevaMigrationProjects.id, { onDelete: "cascade" })
      .notNull(),
    runId: text("run_id"),
    at: text("at").notNull(),
    actor: text("actor").notNull(),
    event: text("event").notNull(),
    detail: jsonb("detail"),
  },
  (table) => [
    index("idx_veeva_migration_audit_log_run").on(table.projectId, table.runId),
    index("idx_veeva_migration_audit_log_event").on(
      table.projectId,
      table.event,
    ),
  ],
);

/** §5.3 cached capability probes, per project and vault. */
export const veevaMigrationProbeResults = pgTable(
  "veeva_migration_probe_results",
  {
    projectId: text("project_id")
      .references(() => veevaMigrationProjects.id, { onDelete: "cascade" })
      .notNull(),
    vaultDns: text("vault_dns").notNull(),
    probe: text("probe").notNull(),
    result: jsonb("result").notNull(),
    checkedAt: text("checked_at").notNull(),
  },
  (table) => [
    primaryKey({
      name: "pk_veeva_migration_probe_results",
      columns: [table.projectId, table.vaultDns, table.probe],
    }),
  ],
);

/** §4.5 countries frozen for cutover; later deltas skip them. */
export const veevaMigrationCountryStatus = pgTable(
  "veeva_migration_country_status",
  {
    projectId: text("project_id")
      .references(() => veevaMigrationProjects.id, { onDelete: "cascade" })
      .notNull(),
    country: text("country").notNull(),
    frozenAt: text("frozen_at").notNull(),
  },
  (table) => [
    primaryKey({
      name: "pk_veeva_migration_country_status",
      columns: [table.projectId, table.country],
    }),
  ],
);
