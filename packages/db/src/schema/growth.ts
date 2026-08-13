/**
 * Product surface around the core: gamification, launch, sharing, feedback.
 *
 * Activity feed, seasons and scoring, achievements, public share links, the
 * Launch directory, playground progress, per-repo awards and the in-app bug
 * report widget. Like `agents`, RFC §7 marks this for extraction into plugins;
 * no core table references anything in here.
 */

import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import type { PwAgentType } from "./shared";

import { teams, users } from "./identity";

import { repositories } from "./repos";

// ── Bug Reports ──────────────────────────────────────────────────────────────

export type BugReportSeverity = "low" | "medium" | "high";

export interface BugReportContext {
  url: string;
  viewport: { width: number; height: number };
  userAgent: string;
  appVersion: string | null;
  gitHash: string | null;
  buildDate: string | null;
  consoleErrors: { message: string; timestamp: number }[];
  failedRequests: { url: string; status: number; method: string }[];
  breadcrumbs: { action: string; target: string; timestamp: number }[];
  selectedRepoId?: string | null;
  selectedRepoName?: string | null;
}

export const bugReports = pgTable("bug_reports", {
  id: text("id").primaryKey(),
  teamId: text("team_id")
    .references(() => teams.id, { onDelete: "cascade" })
    .notNull(),
  reportedById: text("reported_by_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  description: text("description").notNull(),
  severity: text("severity")
    .$type<BugReportSeverity>()
    .notNull()
    .default("medium"),
  context: jsonb("context").$type<BugReportContext>(),
  screenshotPath: text("screenshot_path"),
  contentHash: text("content_hash"),
  githubIssueUrl: text("github_issue_url"),
  githubIssueNumber: integer("github_issue_number"),
  createdAt: timestamp("created_at").$defaultFn(() => new Date()),
});

export type BugReport = typeof bugReports.$inferSelect;

export type NewBugReport = typeof bugReports.$inferInsert;

// ── Activity Events (Agent Activity Feed) ───────────────────────────────────

export type ActivityEventType =
  | "session:start"
  | "session:complete"
  | "session:error"
  | "step:start"
  | "step:complete"
  | "step:error"
  | "step:waiting_user"
  | "substep:update"
  // QA agent direction queue
  | "task:created"
  | "task:started"
  | "task:triaged"
  | "task:completed"
  | "task:failed"
  | "mcp:tool_call"
  | "mcp:tool_result"
  | "mcp:tool_error"
  | "artifact:created"
  | "artifact:updated"
  // App Map exploration (QA agent mode = "explore")
  | "map:page_discovered"
  | "map:explorer_status"
  | "map:blocked"
  // Gamification
  | "score:awarded"
  | "score:penalty"
  | "beat_the_bot"
  | "achievement:unlocked"
  | "season:started"
  | "season:ended"
  | "blitz:started"
  | "blitz:ended"
  // Verify phase (v1.14+)
  | "verify:opened"
  | "verify:layer_approved"
  | "verify:layer_rejected"
  | "verify:layer_snoozed"
  | "verify:build_completed"
  | "verify:case_confirmed"
  | "verify:bugfix_filed"
  | "verify:improvement_filed"
  | "verify:case_auto_resolved";

export type ActivitySourceType =
  | "play_agent"
  | "mcp_server"
  | "generate_agent"
  | "heal_agent"
  | "qa_agent"
  | "explorer_agent";

export type ActivityArtifactType =
  | "test"
  | "build"
  | "area"
  | "baseline"
  | "score"
  | "spec_import";

export const activityEvents = pgTable(
  "activity_events",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    teamId: text("team_id").notNull(),
    repositoryId: text("repository_id"),
    sessionId: text("session_id"),
    sourceType: text("source_type").$type<ActivitySourceType>().notNull(),
    eventType: text("event_type").$type<ActivityEventType>().notNull(),
    agentType: text("agent_type").$type<PwAgentType>(),
    stepId: text("step_id"),
    summary: text("summary").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    artifactType: text("artifact_type").$type<ActivityArtifactType>(),
    artifactId: text("artifact_id"),
    artifactLabel: text("artifact_label"),
    promptLogId: text("prompt_log_id"),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at").$defaultFn(() => new Date()),
  },
  (table) => [
    index("idx_activity_events_team_created").on(table.teamId, table.createdAt),
    index("idx_activity_events_session").on(table.sessionId),
  ],
);

export type ActivityEvent = typeof activityEvents.$inferSelect;

export type NewActivityEvent = typeof activityEvents.$inferInsert;

// ── Gamification: Beat-the-Bot ───────────────────────────────────────────────

export type ActorKind = "user" | "bot";

export type BotKind = "play_agent" | "generate_agent" | "mcp_server";

// Bots that compete on the leaderboard alongside humans. Seeded per team when gamification
// is first enabled via ensureDefaultBots().
export const bots = pgTable(
  "bots",
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
  (table) => [index("idx_bots_team").on(table.teamId)],
);

export type Bot = typeof bots.$inferSelect;

export type NewBot = typeof bots.$inferInsert;

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

export const bugBlitzEvents = pgTable(
  "bug_blitz_events",
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
    index("idx_bug_blitz_team_window").on(
      table.teamId,
      table.startsAt,
      table.endsAt,
    ),
  ],
);

export type BugBlitzEvent = typeof bugBlitzEvents.$inferSelect;

export type NewBugBlitzEvent = typeof bugBlitzEvents.$inferInsert;

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
export const scoreEvents = pgTable(
  "score_events",
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
    index("idx_score_events_actor_kind_source").on(
      table.actorKind,
      table.actorId,
      table.kind,
      table.sourceType,
      table.sourceId,
    ),
    index("idx_score_events_team_season_created").on(
      table.teamId,
      table.seasonId,
      table.createdAt,
    ),
    index("idx_score_events_actor_season").on(
      table.actorKind,
      table.actorId,
      table.seasonId,
    ),
  ],
);

export type ScoreEvent = typeof scoreEvents.$inferSelect;

export type NewScoreEvent = typeof scoreEvents.$inferInsert;

// Denormalized running totals for O(1) leaderboard reads. Rebuildable from scoreEvents.
export const userScores = pgTable(
  "user_scores",
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
    index("idx_user_scores_season_actor").on(
      table.seasonId,
      table.actorKind,
      table.actorId,
    ),
    index("idx_user_scores_season_total").on(table.seasonId, table.total),
  ],
);

export type UserScore = typeof userScores.$inferSelect;

export type NewUserScore = typeof userScores.$inferInsert;

export type AchievementCode =
  | "first_test"
  | "first_regression"
  | "beat_bot_first"
  | "beat_bot_by_100"
  | "blitz_champion"
  | "season_winner";

export const achievements = pgTable(
  "achievements",
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
    index("idx_achievements_season_actor_code").on(
      table.seasonId,
      table.actorKind,
      table.actorId,
      table.code,
    ),
  ],
);

export type Achievement = typeof achievements.$inferSelect;

export type NewAchievement = typeof achievements.$inferInsert;

// ============================================
// Public Shares (Campaign Landing Pages)
// ============================================
// An operator on a build detail page can publish a public share, producing
// a short URL (lastest.cloud/r/:slug) that shows the build's artifacts to
// unauthenticated visitors. A "claim" signs the visitor up and copies the
// test definition into their new team. The share itself remains owned by
// the publishing team — copy-on-claim keeps the public URL stable forever.

export type PublicShareStatus = "public" | "revoked";

// Distinguishes an outreach demo share (a QuickStart walkthrough published to
// pitch a founder — run-to-run diffs are inter-run noise, not findings) from a
// genuine regression share (real before/after findings). The presentation layer
// keys almost everything off this: demo shares suppress inter-run diff chips and
// change counts, regression shares render them as today. Defaults to
// "regression" so pre-existing shares and the operator build-detail flow are
// unaffected; QuickStart publishes with "demo".
export type PublicShareKind = "regression" | "demo";

export const publicShares = pgTable(
  "public_shares",
  {
    id: text("id").primaryKey(),
    // 22-char URL-safe token (~128 bits of entropy) — the public handle.
    slug: text("slug").notNull().unique(),
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
    index("idx_public_shares_build").on(table.buildId),
    index("idx_public_shares_owner_team").on(table.ownerTeamId),
  ],
);

export type PublicShare = typeof publicShares.$inferSelect;

export type NewPublicShare = typeof publicShares.$inferInsert;

// ---------------------------------------------------------------------------
// Awards — "Prove your app is not AI slop" campaign
// ---------------------------------------------------------------------------
//
// Per-repository tier + category badges. Tier ratchets upward and only
// downgrades on a confirmed regression (user-rejected visual diff, or
// non-flaky test failure across two consecutive builds). Flaky failures,
// in-flight builds, and unresolved/open diffs do not downgrade.
//
// The badge SVG endpoint resolves a publicShares.slug -> repository -> award
// row, so the embed URL stays stable while the underlying state stays live.

export type AwardTier = "none" | "starter" | "bronze" | "silver" | "gold";

export interface AwardCategories {
  a11y: boolean;
  allPassing: boolean;
  zeroDrift: boolean;
}

export const repoAwards = pgTable(
  "repo_awards",
  {
    id: text("id").primaryKey(),
    repositoryId: text("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" })
      .unique(),
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
  (table) => [index("idx_repo_awards_tier").on(table.currentTier)],
);

export type RepoAward = typeof repoAwards.$inferSelect;

export type NewRepoAward = typeof repoAwards.$inferInsert;

// ============================================
// Launch directory (launch.lastest.cloud)
// ============================================
//
// MOVED OUT. The seven `launch_*` tables and `DEFAULT_LAUNCH` now live in
// `plugins/launch/src/schema.ts` and `plugins/launch/src/config.ts` — the
// launch board is a plugin (RFC §9 phase 4), and `core-scope.md` §6 says
// core does not know what a plugin stores or where.
//
// The FKs from those tables to `users.id` are gone with them; account
// deletion now reaches them through the plugin's `onUserDeleted` hook,
// driven by `cascadePluginDeletion` in `queries.deleteUser`.
//
// `sessions.kind = 'launch'` is unrelated and stays core: it is the OAuth
// handoff credential (see `src/lib/auth/oauth-clients.ts`), shared by the
// launch board, the playground and the marketing site.

// ============================================
// Playground score & leaderboard
// ============================================
//
// Per-user scores earned on the /playground exercises of the static
// lastest-www frontend. The achievement registry (id → points, completion
// bonuses) is vendored from that repo in src/lib/playground/registry.ts —
// points are always taken from the server-side registry, never from the
// client. Mutations require a `playground:score` token (sessions.kind =
// 'launch', minted by /oauth/authorize for client `playground-www`). See
// src/lib/playground/* + src/app/api/v1/playground/[...path]/route.ts.

// Tunables for the playground leaderboard — the same role LAUNCH_CONFIG
// plays for the launch plugin.
export const DEFAULT_PLAYGROUND = {
  // Anti-gaming velocity caps. The full registry is ~75 achievements, so a
  // legitimate speedrun of everything fits well inside one hour's budget.
  achievementsPerAccountPerHour: 120,
  progressPostsPerAccountPerMinute: 30,
  // Leaderboard window.
  leaderboardDefaultLimit: 50,
  leaderboardMaxLimit: 100,
  leaderboardCacheTtlMs: 60_000,
  // Scope string the implicit OAuth flow grants (client `playground-www`).
  scope: "playground:score",
} as const;

export const playgroundAchievements = pgTable(
  "playground_achievements",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    achievementId: text("achievement_id").notNull(), // e.g. 'buttons.double-click'
    points: integer("points").notNull(), // denormalized from the registry at insert
    earnedAt: timestamp("earned_at"), // client claim, clamped to [account creation, now]
    createdAt: timestamp("created_at"), // server receive time (authoritative for ties)
  },
  (table) => [
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
