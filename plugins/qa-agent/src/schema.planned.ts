import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import type { QaRunMode } from "@lastest/eb-protocol";

import type { QaTaskSource, QaTaskStatus, QaTaskTestRef } from "./types";

/**
 * The two tables QA Agent will own. **Not yet live — and deliberately not
 * named `schema.ts`.**
 *
 * `drizzle.config.ts` globs `./plugins/*​/src/schema.ts`, and the Docker
 * entrypoint runs `drizzle-kit push --force` on startup. If this file carried
 * the canonical name while the migration is paused, that push would:
 *
 *   1. see `qa_agent_triggers` declared **twice** — here without a foreign key
 *      and with an extra index, and in `packages/db/src/schema/agents.ts` with
 *      `repository_id REFERENCES repositories(id) ON DELETE CASCADE` — because
 *      the core table has not been removed yet; and
 *   2. create an empty `qa_agent_tasks` beside the live, populated `qa_tasks`.
 *
 * Renaming it to `schema.planned.ts` is what keeps the design reviewable
 * without arming it. The rename back to `schema.ts` is a step in finishing the
 * migration, and it must happen in the same change that deletes both tables
 * from the core schema and adds `migrateQaAgentTables()` to
 * `scripts/migrate.js`.
 *
 * The two tables QA Agent owns:
 *
 * Two rules from `docs/architecture/core-scope.md` §6, paid for here:
 *
 * 1. **`qa_agent_` prefix.** `core/data`'s `validateSchemaNamespace` refuses
 *    to boot otherwise — and `tablePrefix("qa-agent")` is literally the
 *    example in its own docstring. `qa_agent_triggers` already complied;
 *    `qa_tasks` did not and is renamed to `qa_agent_tasks` by
 *    `migrateQaAgentTables()` in `scripts/migrate.js` **before**
 *    `drizzle-kit push` runs, because push cannot see a rename — it drops the
 *    old table and creates the new one, silently, under `--force`
 *    (recipe §2.4).
 * 2. **No FK to a core table.** Both tables previously carried
 *    `repository_id REFERENCES repositories(id) ON DELETE CASCADE`
 *    (`confdeltype = 'c'` — the ordinary case, no `restrict` surprise like
 *    `ci`'s). Those constraints are dropped by catalogue lookup in
 *    `scripts/migrate.js` and `deletion.ts` is the cascade the database no
 *    longer performs.
 *
 * **What is *not* here: `agent_sessions`.** A QA run's own state is a
 * `kind = "qa"` row in that core table, and the plugin reaches it through
 * `QaAgentHost` rather than owning it. That is a deliberate deviation from
 * the `explorer`/`ranger` precedent and the reasoning is `quickstart`'s,
 * inherited rather than re-derived — see `host.ts` item 2.
 */

/** A directive dropped into the QA agent's queue ("test the billing flow").
 *  The dispatcher picks tasks up oldest first whenever no QA session is
 *  active, runs a task-scoped session, writes the agent's reply back, and
 *  advances the status — the `/qa-agent` task board renders these as kanban
 *  columns. */
export const qaAgentTasks = pgTable(
  "qa_agent_tasks",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    repositoryId: text("repository_id").notNull(),
    teamId: text("team_id").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").$type<QaTaskStatus>().notNull().default("queued"),
    source: text("source").$type<QaTaskSource>().notNull().default("user"),
    /** Display name of who filed it (user name or MCP client name). */
    createdByName: text("created_by_name"),
    createdById: text("created_by_id"),
    /** Agent session that is working (or worked) this task. */
    sessionId: text("session_id"),
    /** The agent's reply when it finishes — or why it needs input. */
    agentReply: text("agent_reply"),
    /** Tests the run generated/healed/matched for this task — board chips. */
    tests: jsonb("tests").$type<QaTaskTestRef[]>(),
    createdAt: timestamp("created_at").$defaultFn(() => new Date()),
    updatedAt: timestamp("updated_at").$defaultFn(() => new Date()),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
  },
  (table) => [
    index("idx_qa_agent_tasks_repo_status").on(
      table.repositoryId,
      table.status,
    ),
    index("idx_qa_agent_tasks_team").on(table.teamId),
  ],
);

export type QaAgentTask = typeof qaAgentTasks.$inferSelect;
export type NewQaAgentTask = typeof qaAgentTasks.$inferInsert;

/** Per-repo automation config: an optional cron schedule and an optional
 *  PR-webhook trigger. One row per repository; both triggers start autonomous
 *  sessions (review gate auto-approved) and are skipped with an activity event
 *  when a session is already running.
 *
 *  The `unique()` on `repository_id` that enforced one-row-per-repo went with
 *  the FK it was declared beside; it is re-declared as a plain unique index
 *  below, since the uniqueness was never the foreign key's doing. */
export const qaAgentTriggers = pgTable(
  "qa_agent_triggers",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    repositoryId: text("repository_id").notNull().unique(),
    teamId: text("team_id").notNull(),
    /** Cron schedule (5-field expression, UTC). */
    scheduleEnabled: boolean("schedule_enabled").notNull().default(false),
    cronExpression: text("cron_expression"),
    scheduleMode: text("schedule_mode")
      .$type<QaRunMode>()
      .notNull()
      .default("fill_gaps"),
    /** Run on PR opened/synchronize webhooks. */
    prEnabled: boolean("pr_enabled").notNull().default(false),
    prMode: text("pr_mode")
      .$type<QaRunMode>()
      .notNull()
      .default("refresh_spec"),
    nextRunAt: timestamp("next_run_at"),
    lastRunAt: timestamp("last_run_at"),
    lastSessionId: text("last_session_id"),
    createdAt: timestamp("created_at").$defaultFn(() => new Date()),
    updatedAt: timestamp("updated_at").$defaultFn(() => new Date()),
  },
  (table) => [index("idx_qa_agent_triggers_team").on(table.teamId)],
);

export type QaAgentTriggerRow = typeof qaAgentTriggers.$inferSelect;
export type NewQaAgentTrigger = typeof qaAgentTriggers.$inferInsert;
