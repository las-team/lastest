import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import type {
  ExperienceNote,
  ExplorerActionLog,
  ExplorerFindingEvidence,
  ExplorerFindingKind,
  ExplorerFindingStatus,
  ExplorerScenario,
  ExplorerSessionMetadata,
  ExplorerSessionStatus,
  ExplorerSeverity,
  ExplorerStepId,
  ExplorerStepState,
  KnowledgeMatchKind,
  KnowledgePageAutomationStep,
} from "./types";

/**
 * Explorer's own tables.
 *
 * Three rules from `docs/architecture/core-scope.md` §6 shape every line here:
 *
 * 1. **Every table is prefixed `explorer_`.** `core/data`'s
 *    `validateSchemaNamespace` refuses to boot otherwise, which is what stops a
 *    plugin re-exporting `repositories` from its own `schema()` and querying it
 *    through the handle core handed over. The import ban alone cannot close
 *    that hole; the prefix can.
 *
 * 2. **No foreign key points at a core table.** `repository_id` and `team_id`
 *    are plain `text` columns. That is not laziness — it is the rule, and this
 *    schema is where its cost is paid: see `deletion.ts` for the cascade the
 *    database will no longer perform for us.
 *
 * 3. **Core never reads these.** Nothing outside this plugin knows the shape,
 *    so changing it is a plugin PR.
 *
 * `drizzle-orm/pg-core` is imported directly and that is deliberate: it defines
 * tables, it opens nothing. What a plugin may never import is a *connection* —
 * `@lastest/db`, `postgres`, `pg` — because `ctx.data` owns the pool. See the
 * `db-connection` / `db-orm` split in `tools/architecture/boundaries.mjs`.
 */

/** One exploratory run. Replaces this feature's slice of `agent_sessions`. */
export const explorerSessions = pgTable(
  "explorer_sessions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    repositoryId: text("repository_id").notNull(),
    teamId: text("team_id").notNull(),
    status: text("status")
      .$type<ExplorerSessionStatus>()
      .notNull()
      .default("active"),
    currentStepId: text("current_step_id").$type<ExplorerStepId>(),
    steps: jsonb("steps").$type<ExplorerStepState[]>().notNull(),
    metadata: jsonb("metadata").$type<ExplorerSessionMetadata>().notNull(),
    createdAt: timestamp("created_at").$defaultFn(() => new Date()),
    updatedAt: timestamp("updated_at").$defaultFn(() => new Date()),
    completedAt: timestamp("completed_at"),
  },
  (table) => [
    index("idx_explorer_sessions_repo").on(table.repositoryId),
    index("idx_explorer_sessions_team").on(table.teamId),
  ],
);

export type ExplorerSession = typeof explorerSessions.$inferSelect;
export type NewExplorerSession = typeof explorerSessions.$inferInsert;

/**
 * Human-provided hints loaded when a page's URL matches (explorbot's
 * `knowledge/` directory, DB-backed for repo scoping + credential encryption).
 * The body is markdown injected into planner/tester prompts verbatim.
 */
export const explorerKnowledge = pgTable(
  "explorer_knowledge",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    repositoryId: text("repository_id").notNull(),
    teamId: text("team_id").notNull(),
    title: text("title").notNull(),
    /** "/login" (exact), "/admin/*" (prefix), "^/users/\\d+$" (regex), "*" = all. */
    urlPattern: text("url_pattern").notNull(),
    matchKind: text("match_kind")
      .$type<KnowledgeMatchKind>()
      .notNull()
      .default("prefix"),
    body: text("body").notNull(),
    /** Page-scoped credentials. The password is encrypted at rest by the query
     *  layer; the email stays plaintext (low-sensitivity identifier). */
    credEmail: text("cred_email"),
    credPassword: text("cred_password"),
    pageAutomation:
      jsonb("page_automation").$type<KnowledgePageAutomationStep[]>(),
    enabled: boolean("enabled").notNull().default(true),
    createdById: text("created_by_id"),
    createdAt: timestamp("created_at").$defaultFn(() => new Date()),
    updatedAt: timestamp("updated_at").$defaultFn(() => new Date()),
  },
  (table) => [index("idx_explorer_knowledge_repo").on(table.repositoryId)],
);

export type ExplorerKnowledge = typeof explorerKnowledge.$inferSelect;
export type NewExplorerKnowledge = typeof explorerKnowledge.$inferInsert;

/**
 * What the explorer learned by doing: failed attempts, working resolutions,
 * observations — keyed by page state (normalized URL + h1/h2 hash) and reused
 * on later runs.
 */
export const explorerExperience = pgTable(
  "explorer_experience",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    repositoryId: text("repository_id").notNull(),
    teamId: text("team_id").notNull(),
    stateHash: text("state_hash").notNull(),
    normalizedUrl: text("normalized_url").notNull(),
    headingsDigest: text("headings_digest"),
    notes: jsonb("notes").$type<ExperienceNote[]>().notNull(),
    timesVisited: integer("times_visited").notNull().default(1),
    lastSessionId: text("last_session_id"),
    createdAt: timestamp("created_at").$defaultFn(() => new Date()),
    updatedAt: timestamp("updated_at").$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("uq_explorer_experience_repo_state").on(
      table.repositoryId,
      table.stateHash,
    ),
  ],
);

export type ExplorerExperience = typeof explorerExperience.$inferSelect;
export type NewExplorerExperience = typeof explorerExperience.$inferInsert;

/** A defect or UX issue the explorer observed, clustered by the analyst step. */
export const explorerFindings = pgTable(
  "explorer_findings",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    repositoryId: text("repository_id").notNull(),
    teamId: text("team_id").notNull(),
    sessionId: text("session_id").notNull(),
    kind: text("kind").$type<ExplorerFindingKind>().notNull().default("defect"),
    severity: text("severity")
      .$type<ExplorerSeverity>()
      .notNull()
      .default("medium"),
    title: text("title").notNull(),
    description: text("description").notNull(),
    rootCauseCluster: text("root_cause_cluster"),
    pageStateHash: text("page_state_hash"),
    url: text("url"),
    /** Back-link to a promoted bug report. Plain `text`, no FK to a core
     *  table (rule 2 above) — `bug_reports` lives in core. Carried over
     *  from `agent_findings` by the rename migration; nothing here writes
     *  it yet (the promote-to-bug-report flow is not reimplemented as a
     *  plugin action), but keeping the column preserves rows migrated
     *  from before the split instead of silently dropping them. */
    bugReportId: text("bug_report_id"),
    scenario: jsonb("scenario").$type<ExplorerScenario>(),
    evidence: jsonb("evidence").$type<ExplorerFindingEvidence>(),
    status: text("status")
      .$type<ExplorerFindingStatus>()
      .notNull()
      .default("open"),
    createdAt: timestamp("created_at").$defaultFn(() => new Date()),
  },
  (table) => [
    index("idx_explorer_findings_session").on(table.sessionId),
    index("idx_explorer_findings_repo").on(table.repositoryId),
  ],
);

export type ExplorerFinding = typeof explorerFindings.$inferSelect;
export type NewExplorerFinding = typeof explorerFindings.$inferInsert;

/**
 * Per-repo cron automation. One row per repository.
 *
 * `target_url` is new, and it is here because of the no-read rule rather than
 * because the feature wanted it: the old dispatcher read `repositories`
 * directly to derive a branch base URL, which a plugin may no longer do. Until
 * core offers "the base URL for this repo and branch", a scheduled run carries
 * the URL the operator configured. See `host.ts`.
 */
export const explorerTriggers = pgTable("explorer_triggers", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  repositoryId: text("repository_id").notNull().unique(),
  teamId: text("team_id").notNull(),
  scheduleEnabled: boolean("schedule_enabled").notNull().default(false),
  /** Cron schedule (5-field expression, UTC). */
  cronExpression: text("cron_expression"),
  maxIterations: integer("max_iterations").notNull().default(4),
  targetUrl: text("target_url"),
  nextRunAt: timestamp("next_run_at"),
  lastRunAt: timestamp("last_run_at"),
  lastSessionId: text("last_session_id"),
  createdAt: timestamp("created_at").$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at").$defaultFn(() => new Date()),
});

export type ExplorerTrigger = typeof explorerTriggers.$inferSelect;
export type NewExplorerTrigger = typeof explorerTriggers.$inferInsert;
