import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import type { BotKind } from "./domain/types";

/**
 * The Beat-the-Bot feature's six tables — moved out of
 * `packages/db/src/schema/growth.ts`.
 *
 * ### The first migration that had to rename tables
 *
 * `core/data`'s `validateSchemaNamespace` refuses to boot a plugin whose
 * tables are not `<id>_`-prefixed, and only one of these six already was:
 *
 * | Was | Now |
 * | --- | --- |
 * | `bots` | `gamification_bots` |
 * | `gamification_seasons` | `gamification_seasons` (unchanged) |
 * | `bug_blitz_events` | `gamification_bug_blitz_events` |
 * | `score_events` | `gamification_score_events` |
 * | `user_scores` | `gamification_user_scores` |
 * | `achievements` | `gamification_achievements` |
 *
 * Every previous migration got the prefix for free — `launch_*`, `a11y_*`,
 * `explorer_*` and `playground_achievements` were all already namespaced, so
 * "no rename, no backfill" was starting to read like a property of the process
 * rather than luck. It was luck. `scripts/migrate.js` does the five
 * `ALTER TABLE … RENAME TO` before `drizzle-kit push`, because push cannot see
 * a rename: it would `DROP` the old table and `CREATE` the new one, and every
 * score in the product would be gone.
 *
 * Two of the old names are worth pausing on — `achievements` and `user_scores`
 * are generic enough that they read like core concepts. They were not; they
 * are this feature's. That ambiguity is exactly what the prefix rule exists to
 * remove.
 *
 * ### No foreign key to a core table
 *
 * `team_id` and `actor_id` are convention-only references, as
 * `core-scope.md` §6 requires — and note that none of these carried an FK
 * *before* the move either, so nothing was lost here (the schema already had
 * 104 such columns; §7). `deletion.ts` is what makes team deletion reach them.
 *
 * `season_id` and `bug_blitz_id` point at this plugin's own tables and could
 * carry real FKs; they did not before and gain none now, to keep this a move
 * rather than a change.
 *
 * `drizzle-orm/pg-core` is imported directly and that is deliberate: it defines
 * tables, it opens nothing. What a plugin may never import is a *connection*.
 */

export type ActorKind = "user" | "bot";

// Bots that compete on the leaderboard alongside humans. Seeded per team when
// gamification is first enabled via ensureDefaultBots().
export const gamificationBots = pgTable(
  "gamification_bots",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    teamId: text("team_id").notNull(),
    name: text("name").notNull(),
    kind: text("kind").$type<BotKind>().notNull(),
    avatarEmoji: text("avatar_emoji").default("🤖"),
    createdAt: timestamp("created_at").$defaultFn(() => new Date()),
  },
  (table) => [index("idx_gamification_bots_team").on(table.teamId)],
);

export type Bot = typeof gamificationBots.$inferSelect;

export type NewBot = typeof gamificationBots.$inferInsert;

export type GamificationSeasonStatus = "active" | "ended";

export const gamificationSeasons = pgTable(
  "gamification_seasons",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    teamId: text("team_id").notNull(),
    name: text("name").notNull(),
    startsAt: timestamp("starts_at").notNull(),
    endsAt: timestamp("ends_at"),
    status: text("status")
      .$type<GamificationSeasonStatus>()
      .notNull()
      .default("active"),
    createdAt: timestamp("created_at").$defaultFn(() => new Date()),
  },
  (table) => [
    index("idx_gamification_seasons_team_status").on(
      table.teamId,
      table.status,
    ),
  ],
);

export type GamificationSeason = typeof gamificationSeasons.$inferSelect;

export type NewGamificationSeason = typeof gamificationSeasons.$inferInsert;

export type BugBlitzStatus = "scheduled" | "active" | "ended";

export const gamificationBugBlitzEvents = pgTable(
  "gamification_bug_blitz_events",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    teamId: text("team_id").notNull(),
    seasonId: text("season_id").notNull(),
    name: text("name").notNull(),
    startsAt: timestamp("starts_at").notNull(),
    endsAt: timestamp("ends_at").notNull(),
    multiplier: integer("multiplier").notNull().default(200), // stored ×100, 200 = 2×
    status: text("status")
      .$type<BugBlitzStatus>()
      .notNull()
      .default("scheduled"),
    createdAt: timestamp("created_at").$defaultFn(() => new Date()),
  },
  (table) => [
    index("idx_gamification_blitz_team_window").on(
      table.teamId,
      table.startsAt,
      table.endsAt,
    ),
  ],
);

export type BugBlitzEvent = typeof gamificationBugBlitzEvents.$inferSelect;

export type NewBugBlitzEvent = typeof gamificationBugBlitzEvents.$inferInsert;

export type ScoreEventKind =
  | "test_created"
  | "diff_approved_as_change"
  | "regression_caught"
  | "triage_resolved"
  | "flake_penalty"
  | "achievement_bonus";

export type ScoreEventSource =
  | "test"
  | "diff"
  | "review_todo"
  | "test_result"
  | "achievement";

// Immutable ledger of every point change.
// The (actor, kind, source) index supports idempotency checks in awardScore.
export const gamificationScoreEvents = pgTable(
  "gamification_score_events",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    teamId: text("team_id").notNull(),
    seasonId: text("season_id").notNull(),
    bugBlitzId: text("bug_blitz_id"),
    actorKind: text("actor_kind").$type<ActorKind>().notNull(),
    actorId: text("actor_id").notNull(), // userId or botId
    kind: text("kind").$type<ScoreEventKind>().notNull(),
    delta: integer("delta").notNull(), // points after multiplier, can be negative
    baseDelta: integer("base_delta").notNull(), // rule base value, for auditing
    multiplier: integer("multiplier").notNull().default(100), // 100 = 1×
    sourceType: text("source_type").$type<ScoreEventSource>().notNull(),
    sourceId: text("source_id").notNull(),
    reason: text("reason"),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => [
    index("idx_gamification_score_events_actor_kind_source").on(
      table.actorKind,
      table.actorId,
      table.kind,
      table.sourceType,
      table.sourceId,
    ),
    index("idx_gamification_score_events_team_season_created").on(
      table.teamId,
      table.seasonId,
      table.createdAt,
    ),
    index("idx_gamification_score_events_actor_season").on(
      table.actorKind,
      table.actorId,
      table.seasonId,
    ),
  ],
);

export type ScoreEvent = typeof gamificationScoreEvents.$inferSelect;

export type NewScoreEvent = typeof gamificationScoreEvents.$inferInsert;

// Denormalized running totals for O(1) leaderboard reads. Rebuildable from
// gamificationScoreEvents.
export const gamificationUserScores = pgTable(
  "gamification_user_scores",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    teamId: text("team_id").notNull(),
    seasonId: text("season_id").notNull(),
    actorKind: text("actor_kind").$type<ActorKind>().notNull(),
    actorId: text("actor_id").notNull(),
    total: integer("total").notNull().default(0),
    testsCreated: integer("tests_created").notNull().default(0),
    regressionsCaught: integer("regressions_caught").notNull().default(0),
    flakesIncurred: integer("flakes_incurred").notNull().default(0),
    lastEventAt: timestamp("last_event_at"),
    createdAt: timestamp("created_at").$defaultFn(() => new Date()),
    updatedAt: timestamp("updated_at").$defaultFn(() => new Date()),
  },
  (table) => [
    index("idx_gamification_user_scores_season_actor").on(
      table.seasonId,
      table.actorKind,
      table.actorId,
    ),
    index("idx_gamification_user_scores_season_total").on(
      table.seasonId,
      table.total,
    ),
  ],
);

export type UserScore = typeof gamificationUserScores.$inferSelect;

export type NewUserScore = typeof gamificationUserScores.$inferInsert;

export type AchievementCode =
  | "first_test"
  | "first_regression"
  | "beat_bot_first"
  | "beat_bot_by_100"
  | "blitz_champion"
  | "season_winner";

export const gamificationAchievements = pgTable(
  "gamification_achievements",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    teamId: text("team_id").notNull(),
    seasonId: text("season_id").notNull(),
    actorKind: text("actor_kind").$type<ActorKind>().notNull(),
    actorId: text("actor_id").notNull(),
    code: text("code").$type<AchievementCode>().notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    awardedAt: timestamp("awarded_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => [
    index("idx_gamification_achievements_season_actor_code").on(
      table.seasonId,
      table.actorKind,
      table.actorId,
      table.code,
    ),
  ],
);

export type Achievement = typeof gamificationAchievements.$inferSelect;

export type NewAchievement = typeof gamificationAchievements.$inferInsert;
