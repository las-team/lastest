import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * The playground's one table — moved out of
 * `packages/db/src/schema/growth.ts`, where it sat below the launch board's
 * seven and beside the gamification and share families.
 *
 * The same three rules from `docs/architecture/core-scope.md` §6 that shape
 * `plugins/launch/src/schema.ts`:
 *
 * 1. **Prefixed `playground_`.** `core/data`'s `validateSchemaNamespace`
 *    refuses to boot otherwise. It already carried the prefix, so nothing is
 *    renamed and there is no drop/recreate risk.
 *
 * 2. **No foreign key to a core table.** `user_id REFERENCES users(id) ON
 *    DELETE CASCADE` is gone, and `deletion.ts` is what replaces it. That
 *    cascade was the only thing reaping a deleted person's scores — see
 *    `plugin-migration-recipe.md` §2.1, and note that this plugin needed *no*
 *    core change to honour it, because `onUserDeleted` already landed for
 *    `launch`.
 *
 * 3. **No FK between plugin tables either**, because there is only one. The
 *    unique index is what carries the real invariant: one row per (user,
 *    achievement), which is what makes `POST /progress` idempotent.
 *
 * `drizzle-orm/pg-core` is imported directly and that is deliberate: it defines
 * tables, it opens nothing. What a plugin may never import is a *connection*.
 */
export const playgroundAchievements = pgTable(
  "playground_achievements",
  {
    id: text("id").primaryKey(),
    // No FK. The person this belongs to is a core entity the plugin cannot
    // read; `deletion.ts` is how these rows learn that they died.
    userId: text("user_id").notNull(),
    achievementId: text("achievement_id").notNull(), // e.g. 'buttons.double-click'
    points: integer("points").notNull(), // denormalized from the registry at insert
    earnedAt: timestamp("earned_at"), // client claim, clamped to [account creation, now]
    createdAt: timestamp("created_at"), // server receive time (authoritative for ties)
  },
  (table) => [
    // The idempotency guarantee behind `POST /progress`: re-pushing a held
    // achievement conflicts and is skipped rather than double-counted.
    uniqueIndex("uq_playground_achievements_user_achievement").on(
      table.userId,
      table.achievementId,
    ),
    index("idx_playground_achievements_user").on(table.userId),
  ],
);

export type PlaygroundAchievement = typeof playgroundAchievements.$inferSelect;

export type NewPlaygroundAchievement =
  typeof playgroundAchievements.$inferInsert;
