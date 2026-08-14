import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * The awards feature's one table — moved out of `packages/db/src/schema/growth.ts`
 * (RFC §9 phase 4, ninth plugin).
 *
 * ### Renamed for the `<id>_` prefix
 *
 * `repo_awards` was not `awards_`-prefixed, so `core/data`'s
 * `validateSchemaNamespace` would refuse to boot this plugin unchanged.
 * `scripts/migrate.js`'s `AWARDS_RENAMES` does the rename before
 * `drizzle-kit push --force`, which cannot see a rename and would otherwise
 * drop the table and create an empty one under the new name — every earned
 * tier in the product would be gone. This is the fourth migration to need a
 * rename (`explorer`, `gamification`, `ci` were the first three).
 *
 * ### The FK that has to go
 *
 * `repositoryId` carried `references(() => repositories.id, { onDelete:
 * "cascade" })` — a real FK to a core table, which `core-scope.md` §6 forbids
 * a plugin from declaring. `scripts/migrate.js` drops it by catalogue lookup
 * (same shape as `dropPluginUserForeignKeys`/`migrateCiTables`'s FK cleanup)
 * immediately after the rename. `deletion.ts`'s `onRepoDeleted` is what
 * replaces the cascade — the ordinary case per recipe §2.1: one table, one FK,
 * `cascade` behaviour, nothing to reproduce beyond a delete.
 *
 * `proofShareSlug` and `lastBuildId` were always convention-only references
 * (no FK, even before the move) — one of the 104 such columns `core-scope.md`
 * §7 counts. Nothing changes about them here.
 */

export type AwardTier = "none" | "starter" | "bronze" | "silver" | "gold";

export interface AwardCategories {
  a11y: boolean;
  allPassing: boolean;
  zeroDrift: boolean;
}

export const awardsRepoAwards = pgTable(
  "awards_repo_awards",
  {
    id: text("id").primaryKey(),
    repositoryId: text("repository_id").notNull().unique(),
    currentTier: text("current_tier")
      .$type<AwardTier>()
      .notNull()
      .default("none"),
    highestTier: text("highest_tier")
      .$type<AwardTier>()
      .notNull()
      .default("none"),
    categories: jsonb("categories").$type<AwardCategories>().notNull(),
    proofShareSlug: text("proof_share_slug"),
    lastBuildId: text("last_build_id"),
    earnedAt: timestamp("earned_at")
      .$defaultFn(() => new Date())
      .notNull(),
    lastRecomputedAt: timestamp("last_recomputed_at")
      .$defaultFn(() => new Date())
      .notNull(),
    lastDowngradeAt: timestamp("last_downgrade_at"),
    lastDowngradeReason: text("last_downgrade_reason"),
  },
  (table) => [index("idx_awards_repo_awards_tier").on(table.currentTier)],
);

export type RepoAward = typeof awardsRepoAwards.$inferSelect;

export type NewRepoAward = typeof awardsRepoAwards.$inferInsert;
