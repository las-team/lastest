import { pgTable, text, integer, timestamp, index } from "drizzle-orm/pg-core";

/**
 * The share plugin's one table — moved out of
 * `packages/db/src/schema/growth.ts`, where it sat below the launch board's
 * seven and beside the gamification and playground families.
 *
 * 1. **Renamed `public_shares` → `share_public_shares`.** `core/data`'s
 *    `validateSchemaNamespace` refuses to boot a plugin whose tables are not
 *    `<id>_`-prefixed, and this one was not (`plugin-migration-recipe.md`
 *    §2.4 — free five times running, then not, and now the expected case).
 *    `scripts/migrate.js` renames the table before `drizzle-kit push`, which
 *    cannot see a rename and would drop-and-recreate under `--force`.
 *
 * 2. **No foreign key to a core table, and none dropped either.** Every one
 *    of `buildId`, `testId`, `repositoryId`, `ownerTeamId`,
 *    `publishedByUserId`, `claimedByTeamId`, `claimedByUserId` was already a
 *    convention-only reference before this migration — the same finding
 *    `gamification` made (`core-scope.md` §6): "no FK was dropped, because
 *    none existed." Team/repo deletion reaches these rows through
 *    `deletion.ts`, which is a genuine fix (nothing reaped them before), not
 *    a replacement for a cascade that used to run.
 *
 * `drizzle-orm/pg-core` is imported directly and that is deliberate: it
 * defines tables, it opens nothing. What a plugin may never import is a
 * *connection*.
 */
export type PublicShareStatus = "public" | "revoked";

// Distinguishes an outreach demo share (a QuickStart walkthrough published to
// pitch a founder — run-to-run diffs are inter-run noise, not findings) from a
// genuine regression share (real before/after findings). Defaults to
// "regression" so pre-existing shares and the operator build-detail flow are
// unaffected; QuickStart publishes with "demo".
export type PublicShareKind = "regression" | "demo";

export const sharePublicShares = pgTable(
  "share_public_shares",
  {
    id: text("id").primaryKey(),
    // 22-char URL-safe token (~128 bits of entropy) — the public handle.
    slug: text("slug").notNull().unique(),
    // Convention-only references into core tables — see the header above.
    buildId: text("build_id").notNull(),
    testId: text("test_id"),
    repositoryId: text("repository_id"),
    ownerTeamId: text("owner_team_id"),
    publishedByUserId: text("published_by_user_id"),
    status: text("status")
      .$type<PublicShareStatus>()
      .notNull()
      .default("public"),
    kind: text("kind").$type<PublicShareKind>().notNull().default("regression"),
    targetDomain: text("target_domain"),
    claimedByTeamId: text("claimed_by_team_id"),
    claimedByUserId: text("claimed_by_user_id"),
    claimedAt: timestamp("claimed_at"),
    viewCount: integer("view_count").notNull().default(0),
    lastViewedAt: timestamp("last_viewed_at"),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    index("idx_share_public_shares_build").on(table.buildId),
    index("idx_share_public_shares_owner_team").on(table.ownerTeamId),
  ],
);

export type PublicShare = typeof sharePublicShares.$inferSelect;

export type NewPublicShare = typeof sharePublicShares.$inferInsert;
