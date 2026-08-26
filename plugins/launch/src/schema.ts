import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * The launch board's own tables — moved out of
 * `packages/db/src/schema/growth.ts`, where they sat beside the gamification
 * and share families.
 *
 * Three rules from `docs/architecture/core-scope.md` §6 shape this file, the
 * same three that shape `plugins/explorer/src/schema.ts`:
 *
 * 1. **Every table is prefixed `launch_`.** `core/data`'s
 *    `validateSchemaNamespace` refuses to boot otherwise. All seven already
 *    carried the prefix, so nothing is renamed and no drop/recreate risk is
 *    involved.
 *
 * 2. **No foreign key points at a core table.** Five FKs to `users.id` are
 *    gone — four of them `ON DELETE CASCADE`, which is how a deleted account's
 *    votes, comments and reactions used to disappear. `deletion.ts` is the
 *    replacement, and it is the reason `DeletionHook` grew an `onUserDeleted`
 *    (a core PR, landed first). `launch_profiles.submitted_by_user_id` was
 *    `ON DELETE SET NULL` and is now nulled by the same hook.
 *
 * 3. **FKs *between* these tables stay.** They are all plugin-owned, so
 *    `profile_id REFERENCES launch_profiles(id) ON DELETE CASCADE` breaks no
 *    rule and does real work: deleting one profile still reaps its votes,
 *    comments, reactions and events in the database, which keeps the deletion
 *    hook small.
 *
 * `drizzle-orm/pg-core` is imported directly and that is deliberate: it defines
 * tables, it opens nothing. What a plugin may never import is a *connection*.
 */

// Weekly cohort: open (accepting/queued) → voting (live Mon–Sun) →
// locked (winner decided Sun) → closed (archived).
export type LaunchCohortState = "open" | "voting" | "locked" | "closed";

export const launchCohorts = pgTable(
  "launch_cohorts",
  {
    id: text("id").primaryKey(),
    // Monday 00:00 PT — start of the voting week. Unique = one cohort per week.
    weekStartAt: timestamp("week_start_at").notNull().unique(),
    // Sunday 23:59 PT — voting closes.
    weekEndAt: timestamp("week_end_at").notNull(),
    state: text("state").$type<LaunchCohortState>().notNull().default("open"),
    // Slug of the Founder-of-the-Week winner, set when the cohort locks.
    winnerSlug: text("winner_slug"),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [index("idx_launch_cohorts_state").on(table.state)],
);

export type LaunchCohort = typeof launchCohorts.$inferSelect;

export type NewLaunchCohort = typeof launchCohorts.$inferInsert;

export type LaunchProfileStatus =
  | "pending_review"
  | "featured"
  | "rejected"
  | "archived";

export interface LaunchWalkthrough {
  src: string;
  poster?: string;
  description?: string;
}

export const launchProfiles = pgTable(
  "launch_profiles",
  {
    id: text("id").primaryKey(),
    // Human-readable URL handle (kebab of name + uniqueness counter).
    slug: text("slug").notNull().unique(),
    cohortId: text("cohort_id").references(() => launchCohorts.id, {
      onDelete: "set null",
    }),
    // Was `REFERENCES users(id) ON DELETE SET NULL`. Now a plain column —
    // `deletion.ts`'s `onUserDeleted` nulls it instead. Kept nullable for
    // exactly that reason: a submission outlives its submitter's account.
    submittedByUserId: text("submitted_by_user_id"),
    name: text("name").notNull(),
    tagline: text("tagline"),
    description: text("description"),
    category: text("category"),
    websiteUrl: text("website_url").notNull(),
    // Normalized host (lowercase, no www/port) for dup-domain detection.
    domain: text("domain"),
    founderName: text("founder_name"),
    founderHandle: text("founder_handle"),
    contactEmail: text("contact_email"),
    logoUrl: text("logo_url"),
    status: text("status")
      .$type<LaunchProfileStatus>()
      .notNull()
      .default("pending_review"),
    // Admin-attached test report (points at an existing /r/<slug> public share)
    // + AI walkthrough video. Set via the admin PATCH endpoint.
    testReportShareUrl: text("test_report_share_url"),
    walkthrough: jsonb("walkthrough").$type<LaunchWalkthrough>(),
    // Denormalized cache of non-cleared votes; source of truth is launch_votes.
    upvoteCount: integer("upvote_count").notNull().default(0),
    // Anti-gaming editorial signals.
    flagged: boolean("flagged").notNull().default(false),
    suspiciousVoteRatio: doublePrecision("suspicious_vote_ratio"),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    index("idx_launch_profiles_cohort").on(table.cohortId),
    index("idx_launch_profiles_domain").on(table.domain),
    index("idx_launch_profiles_status").on(table.status),
    // New: the deletion hook nulls submissions by user id, and the velocity
    // gate counts them per user per hour. Both were index-free scans while the
    // FK to `users` existed to make them rare.
    index("idx_launch_profiles_submitter").on(table.submittedByUserId),
  ],
);

export type LaunchProfile = typeof launchProfiles.$inferSelect;

export type NewLaunchProfile = typeof launchProfiles.$inferInsert;

export const launchVotes = pgTable(
  "launch_votes",
  {
    id: text("id").primaryKey(),
    profileId: text("profile_id")
      .notNull()
      .references(() => launchProfiles.id, { onDelete: "cascade" }),
    // Was `REFERENCES users(id) ON DELETE CASCADE`.
    voterUserId: text("voter_user_id").notNull(),
    ipAddress: text("ip_address"),
    // Vote-clearing soft-flag: a cleared vote is excluded from upvoteCount/winner.
    cleared: boolean("cleared").notNull().default(false),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    // One vote per account per profile — drives the 409 already-voted response.
    uniqueIndex("uq_launch_votes_profile_voter").on(
      table.profileId,
      table.voterUserId,
    ),
    index("idx_launch_votes_voter").on(table.voterUserId),
    index("idx_launch_votes_ip").on(table.ipAddress),
  ],
);

export type LaunchVote = typeof launchVotes.$inferSelect;

export type NewLaunchVote = typeof launchVotes.$inferInsert;

// "Tested Startup of the Month" — admin-set from the month's weekly winners.
export const launchMonthlyWinners = pgTable(
  "launch_monthly_winners",
  {
    id: text("id").primaryKey(),
    month: text("month").notNull().unique(), // 'YYYY-MM' (PT)
    profileSlug: text("profile_slug").notNull(),
    createdAt: timestamp("created_at"),
  },
  (table) => [index("idx_launch_monthly_winners_month").on(table.month)],
);

export type LaunchMonthlyWinner = typeof launchMonthlyWinners.$inferSelect;

export type NewLaunchMonthlyWinner = typeof launchMonthlyWinners.$inferInsert;

export const launchComments = pgTable(
  "launch_comments",
  {
    id: text("id").primaryKey(),
    profileId: text("profile_id")
      .notNull()
      .references(() => launchProfiles.id, { onDelete: "cascade" }),
    // Was `REFERENCES users(id) ON DELETE CASCADE`.
    authorUserId: text("author_user_id").notNull(),
    body: text("body").notNull(),
    ipAddress: text("ip_address"),
    flagged: boolean("flagged").notNull().default(false),
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    index("idx_launch_comments_profile").on(table.profileId),
    index("idx_launch_comments_author").on(table.authorUserId),
  ],
);

export type LaunchComment = typeof launchComments.$inferSelect;

export type NewLaunchComment = typeof launchComments.$inferInsert;

export const launchReactions = pgTable(
  "launch_reactions",
  {
    id: text("id").primaryKey(),
    profileId: text("profile_id")
      .notNull()
      .references(() => launchProfiles.id, { onDelete: "cascade" }),
    // Was `REFERENCES users(id) ON DELETE CASCADE`.
    reactorUserId: text("reactor_user_id").notNull(),
    emoji: text("emoji").notNull(),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    uniqueIndex("uq_launch_reactions_profile_reactor_emoji").on(
      table.profileId,
      table.reactorUserId,
      table.emoji,
    ),
    // New: `onUserDeleted` deletes by reactor, which the composite unique index
    // above cannot serve (wrong leading column).
    index("idx_launch_reactions_reactor").on(table.reactorUserId),
  ],
);

export type LaunchReaction = typeof launchReactions.$inferSelect;

export type NewLaunchReaction = typeof launchReactions.$inferInsert;

export const launchEvents = pgTable(
  "launch_events",
  {
    id: text("id").primaryKey(),
    profileId: text("profile_id")
      .notNull()
      .references(() => launchProfiles.id, { onDelete: "cascade" }),
    type: text("type").$type<"view" | "visit">().notNull(),
    // sha256(ip + YYYY-MM-DD) — never store raw IP
    ipHash: text("ip_hash").notNull(),
    uaHash: text("ua_hash"),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    index("idx_launch_events_profile_type").on(table.profileId, table.type),
    index("idx_launch_events_created_at").on(table.createdAt),
    uniqueIndex("uq_launch_events_dedupe").on(
      table.profileId,
      table.type,
      table.ipHash,
    ),
  ],
);

export type LaunchEvent = typeof launchEvents.$inferSelect;

export type NewLaunchEvent = typeof launchEvents.$inferInsert;
