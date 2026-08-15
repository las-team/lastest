import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Scheduling's one table — moved out of `packages/db/src/schema/runs.ts`
 * (RFC §9 phase 4, thirteenth plugin).
 *
 * ### Renamed for the `<id>_` prefix
 *
 * `build_schedules` was not `scheduling_`-prefixed, so `core/data`'s
 * `validateSchemaNamespace` would refuse to boot this plugin unchanged.
 * `scripts/migrate.js`'s `SCHEDULING_RENAMES` does the rename before
 * `drizzle-kit push --force`, which cannot see a rename and would otherwise
 * drop the table and create an empty one under the new name — every
 * configured recurring run in the product would be gone.
 *
 * ### The FK that has to go
 *
 * `repositoryId` carried `references(() => repositories.id, { onDelete:
 * "cascade" })` — a real FK to a core table, which `core-scope.md` §6 forbids
 * a plugin from declaring. `scripts/migrate.js` drops it by catalogue lookup
 * (same shape as `migrateAwardsTables`'s FK cleanup) immediately after the
 * rename. `deletion.ts`'s `onRepoDeleted` is what replaces the cascade — the
 * ordinary case per recipe §2.1: one table, one FK, `cascade` behaviour,
 * nothing to reproduce beyond a delete.
 *
 * There is no `teamId` column, so there is no `onTeamDeleted` hook either —
 * same shape as `awards`. Deleting a team deletes its repositories first
 * (core's own cascade), and each repo delete drives `onRepoDeleted`, so team
 * deletion is still covered, one level removed.
 *
 * `runnerId`, `testIds`, `suiteId` and `lastBuildId` were always
 * convention-only references (no FK, even before the move) — one of the
 * 104-ish such columns `core-scope.md` §7 counts. Nothing changes about them
 * here.
 */
export const schedulingBuildSchedules = pgTable("scheduling_build_schedules", {
  id: text("id").primaryKey(),
  repositoryId: text("repository_id").notNull(),
  name: text("name").notNull(),
  enabled: boolean("enabled").default(true),
  cronExpression: text("cron_expression").notNull(),
  timezone: text("timezone").default("UTC"),
  runnerId: text("runner_id"),
  testIds: jsonb("test_ids").$type<string[]>(),
  suiteId: text("suite_id"),
  gitBranch: text("git_branch"),
  nextRunAt: timestamp("next_run_at"),
  lastRunAt: timestamp("last_run_at"),
  lastBuildId: text("last_build_id"),
  consecutiveFailures: integer("consecutive_failures").default(0),
  maxConsecutiveFailures: integer("max_consecutive_failures").default(5),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

export type BuildSchedule = typeof schedulingBuildSchedules.$inferSelect;
export type NewBuildSchedule = typeof schedulingBuildSchedules.$inferInsert;
