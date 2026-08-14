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

import type { BotKind, PwAgentType } from "./shared";

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
//
// MOVED OUT. The six tables and their types now live in
// `plugins/gamification/src/schema.ts` (RFC §9 phase 4).
//
// Five of the six were **renamed** on the way out, because `core/data`
// requires a plugin's tables to be `<id>_`-prefixed and only
// `gamification_seasons` already was:
//
//   bots              -> gamification_bots
//   bug_blitz_events  -> gamification_bug_blitz_events
//   score_events      -> gamification_score_events
//   user_scores       -> gamification_user_scores
//   achievements      -> gamification_achievements
//
// `scripts/migrate.js` performs those renames before `drizzle-kit push`, which
// cannot see a rename and would drop-and-create instead. Two of the old names
// (`achievements`, `user_scores`) were generic enough to read like core
// concepts; they never were, and the prefix rule is what makes that legible.
//
// `ActorKind`, `ScoreEventKind` and friends went with them. `BotKind` did not:
// it names core's own agents and is now in `./shared`, because
// `createTest(…, createdByAgent)` is typed by it — see `src/lib/db/test-hooks.ts`.
//
// No FK was dropped, because none existed: `team_id` here was always a
// convention-only reference. Team deletion reaches these rows through the
// plugin's `onTeamDeleted` hook, which is a *fix* rather than a replacement —
// nothing was reaping them before.

// ============================================
// Public Shares — MOVED OUT.
// ============================================
// `public_shares` and its types now live in `plugins/share/src/schema.ts`
// (RFC §9 phase 4), renamed `share_public_shares` — `core/data`'s
// `validateSchemaNamespace` requires the `<id>_` prefix, and this table
// never had one (`plugin-migration-recipe.md` §2.4).
//
// No FK was dropped: `buildId`, `testId`, `repositoryId`, `ownerTeamId`,
// `publishedByUserId`, `claimedByTeamId`, `claimedByUserId` were always
// convention-only references, the same finding `gamification` made. Team and
// repo deletion reach these rows through the plugin's `onTeamDeleted`/
// `onRepoDeleted` hooks — a genuine fix (nothing reaped them before), not a
// replacement for a cascade that used to run. `scripts/migrate.js` performs
// the rename before `drizzle-kit push`, which cannot see a rename and would
// drop-and-create instead.

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
// MOVED OUT. `playground_achievements` and `DEFAULT_PLAYGROUND` now live in
// `plugins/playground/src/schema.ts` and `plugins/playground/src/config.ts`
// (RFC §9 phase 4), for the same reason the launch board's tables did.
//
// Its FK to `users.id` is gone with it; account deletion reaches these rows
// through the plugin's `onUserDeleted` hook, driven by
// `cascadePluginDeletion` in `queries.deleteUser`.
//
// `DEFAULT_PLAYGROUND.scope` did not survive the move: it duplicated
// `PLAYGROUND_SCOPE` in `src/lib/auth/oauth-clients.ts`, which is the copy
// everything actually read. What a credential *grants* stays with the OAuth
// client registry; what an endpoint *demands* is the plugin's own
// `PLAYGROUND_SCOPES`.
