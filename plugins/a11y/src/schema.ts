import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import type { A11yBaselinePayload } from "@lastest/eb-protocol";

/**
 * The a11y plugin's own table.
 *
 * Moved here from `packages/db/src/schema/visual.ts`, where it sat beside the
 * six other per-layer baseline tables. Two things changed in the move, both
 * required by `docs/architecture/core-scope.md` §6:
 *
 * 1. **The FK to `tests.id` is gone.** It carried `onDelete: "cascade"`, which
 *    is exactly the database-level coupling a plugin table may not have. In
 *    practice nothing hard-deletes a `tests` row (the app soft-deletes via
 *    `deleted_at`), so that cascade only ever fired as a side effect of a repo
 *    or team being deleted — which is precisely what `deletion.ts` now does
 *    explicitly.
 *
 * 2. **`repository_id` / `team_id` were added.** Without the FK there is no
 *    path from a baseline row back to its owner, and the deletion hook is
 *    handed a team id or a repo id — never a test id. Existing rows are
 *    backfilled through `a11y_baselines → tests → repositories` by the
 *    migration in `scripts/migrate.js`, which must run before
 *    `drizzle-kit push` sees these NOT NULL columns.
 *
 * The table name is unchanged (`a11y_baselines`): it already satisfies
 * `core/data`'s `validateSchemaNamespace` prefix rule for plugin id `a11y`,
 * so no rename — and therefore no drop/recreate risk — is involved.
 *
 * `test_id` stays as a plain `text` column: the per-(test, step, branch)
 * lookup is the whole point of the table, it just no longer constrains.
 */
export const a11yBaselines = pgTable(
  "a11y_baselines",
  {
    id: text("id").primaryKey(),
    testId: text("test_id").notNull(),
    repositoryId: text("repository_id").notNull(),
    teamId: text("team_id").notNull(),
    stepLabel: text("step_label"),
    branch: text("branch").notNull(),
    // Environment scope (B2) — see `baselines.environmentKey` in core. Held as
    // the environment KEY rather than an id for the same reason `test_id` is a
    // plain column here: a plugin table carries no FK to a core table.
    environmentKey: text("environment_key"),
    isActive: boolean("is_active").default(true),
    approvedFromComparisonId: text("approved_from_comparison_id"),
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at").$defaultFn(() => new Date()),
    payload: jsonb("payload").$type<A11yBaselinePayload>().notNull(),
    createdAt: timestamp("created_at").$defaultFn(() => new Date()),
  },
  (table) => [
    index("idx_a11y_baselines_test").on(table.testId),
    index("idx_a11y_baselines_repo").on(table.repositoryId),
    index("idx_a11y_baselines_team").on(table.teamId),
  ],
);

export type A11yBaseline = typeof a11yBaselines.$inferSelect;
export type NewA11yBaseline = typeof a11yBaselines.$inferInsert;
