import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import type {
  RangerSessionMetadata,
  RangerSessionStatus,
  RangerStepId,
  RangerStepState,
} from "./types";

/**
 * Ranger's own table. Replaces its slice of the shared `agent_sessions`
 * (`kind = "ranger"`), the same move `explorer` made first.
 *
 * Two rules from `docs/architecture/core-scope.md` §6, paid for here:
 *
 * 1. **`ranger_` prefix.** `core/data`'s `validateSchemaNamespace` refuses to
 *    boot otherwise.
 * 2. **No FK to a core table.** `repository_id`/`team_id` are plain `text`.
 *    `deletion.ts` is the cascade the database no longer performs for free.
 *
 * Sessions already sitting in `agent_sessions` with `kind = "ranger"` are not
 * migrated into this table — see the migration result doc §5. They are
 * short-lived polling records (an async job typically drained within minutes
 * by the MCP client), not data anyone returns to, so the honest choice is to
 * let them age out rather than write a one-off backfill for rows that are
 * likely already stale by the time this lands.
 */
export const rangerSessions = pgTable(
  "ranger_sessions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    repositoryId: text("repository_id").notNull(),
    teamId: text("team_id").notNull(),
    status: text("status").$type<RangerSessionStatus>().notNull(),
    currentStepId: text("current_step_id").$type<RangerStepId>(),
    steps: jsonb("steps").$type<RangerStepState[]>().notNull(),
    metadata: jsonb("metadata").$type<RangerSessionMetadata>().notNull(),
    createdAt: timestamp("created_at").$defaultFn(() => new Date()),
    updatedAt: timestamp("updated_at").$defaultFn(() => new Date()),
    completedAt: timestamp("completed_at"),
  },
  (table) => [
    index("idx_ranger_sessions_repo").on(table.repositoryId),
    index("idx_ranger_sessions_team").on(table.teamId),
  ],
);

export type RangerSession = typeof rangerSessions.$inferSelect;
export type NewRangerSession = typeof rangerSessions.$inferInsert;
