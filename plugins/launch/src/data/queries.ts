import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  sql,
} from "drizzle-orm";
import { v4 as uuid } from "uuid";

import { LAUNCH_CONFIG } from "../config";
import {
  launchCohorts,
  launchComments,
  launchEvents,
  launchMonthlyWinners,
  launchProfiles,
  launchReactions,
  launchVotes,
  type LaunchCohort,
  type LaunchCohortState,
  type LaunchMonthlyWinner,
  type LaunchProfile,
  type NewLaunchCohort,
  type NewLaunchProfile,
} from "../schema";
import type { LaunchDb } from "./db";

/**
 * Every read and write the launch board performs, against its own seven tables
 * through the handle `core/data` supplied.
 *
 * Ported from `src/lib/db/queries/launch.ts`, which shared one `db` handle with
 * all 98 tables in the app. Two changes, both forced by
 * `docs/architecture/core-scope.md` §6:
 *
 * 1. **The `leftJoin(users)` in the comment queries is gone.** A plugin may not
 *    read a core table, so `CommentRow` no longer carries `authorName`; the API
 *    layer resolves display names through `LaunchHost.resolveUserNames` and
 *    merges them at serialization time.
 * 2. **`onUserDeleted` deletes** (bottom of this file) exist at all. They are
 *    the replacement for the four `ON DELETE CASCADE` FKs to `users.id` that
 *    the schema no longer has.
 *
 * Everything else is the same SQL. Behaviour is held constant (RFC §2).
 */

// ============================================
// Cohorts
// ============================================

/**
 * The cohort the board currently points at: a `voting` cohort if one is live,
 * otherwise the soonest `open` cohort. Never returns locked/closed archives.
 */
export async function getCurrentCohort(
  db: LaunchDb,
): Promise<LaunchCohort | undefined> {
  const [live] = await db
    .select()
    .from(launchCohorts)
    .where(eq(launchCohorts.state, "voting"))
    .orderBy(desc(launchCohorts.weekStartAt))
    .limit(1);
  if (live) return live;

  const [open] = await db
    .select()
    .from(launchCohorts)
    .where(eq(launchCohorts.state, "open"))
    .orderBy(asc(launchCohorts.weekStartAt))
    .limit(1);
  return open;
}

export async function getCohortById(
  db: LaunchDb,
  id: string,
): Promise<LaunchCohort | undefined> {
  const [row] = await db
    .select()
    .from(launchCohorts)
    .where(eq(launchCohorts.id, id));
  return row;
}

export async function getCohortByWeekStart(
  db: LaunchDb,
  weekStartAt: Date,
): Promise<LaunchCohort | undefined> {
  const [row] = await db
    .select()
    .from(launchCohorts)
    .where(eq(launchCohorts.weekStartAt, weekStartAt));
  return row;
}

export async function getCohortsByState(
  db: LaunchDb,
  states: LaunchCohortState[],
): Promise<LaunchCohort[]> {
  if (states.length === 0) return [];
  return db
    .select()
    .from(launchCohorts)
    .where(inArray(launchCohorts.state, states))
    .orderBy(desc(launchCohorts.weekStartAt));
}

export async function createCohort(
  db: LaunchDb,
  data: Omit<NewLaunchCohort, "id" | "createdAt" | "updatedAt">,
): Promise<LaunchCohort> {
  const id = uuid();
  const now = new Date();
  await db
    .insert(launchCohorts)
    .values({ ...data, id, createdAt: now, updatedAt: now });
  const [row] = await db
    .select()
    .from(launchCohorts)
    .where(eq(launchCohorts.id, id));
  return row;
}

export async function setCohortState(
  db: LaunchDb,
  id: string,
  state: LaunchCohortState,
): Promise<void> {
  await db
    .update(launchCohorts)
    .set({ state, updatedAt: new Date() })
    .where(eq(launchCohorts.id, id));
}

export async function lockCohortWinner(
  db: LaunchDb,
  id: string,
  winnerSlug: string | null,
): Promise<void> {
  await db
    .update(launchCohorts)
    .set({ state: "locked", winnerSlug, updatedAt: new Date() })
    .where(eq(launchCohorts.id, id));
}

/** All cohorts in a state, oldest first — used by the state engine to advance due ones. */
export async function listCohortsByStateAsc(
  db: LaunchDb,
  states: LaunchCohortState[],
): Promise<LaunchCohort[]> {
  if (states.length === 0) return [];
  return db
    .select()
    .from(launchCohorts)
    .where(inArray(launchCohorts.state, states))
    .orderBy(asc(launchCohorts.weekStartAt));
}

// ============================================
// Profiles
// ============================================

function slugifyName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .substring(0, 50) || "launch"
  );
}

/** Normalize a website URL to its bare host (lowercase, no www/port) for dup detection. */
export function normalizeDomain(websiteUrl: string): string | null {
  try {
    const url = new URL(
      websiteUrl.includes("://") ? websiteUrl : `https://${websiteUrl}`,
    );
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export async function getProfileBySlug(
  db: LaunchDb,
  slug: string,
): Promise<LaunchProfile | undefined> {
  const [row] = await db
    .select()
    .from(launchProfiles)
    .where(eq(launchProfiles.slug, slug));
  return row;
}

export async function findProfileByDomain(
  db: LaunchDb,
  domain: string,
): Promise<LaunchProfile | undefined> {
  const [row] = await db
    .select()
    .from(launchProfiles)
    .where(eq(launchProfiles.domain, domain));
  return row;
}

export async function listProfilesByCohort(
  db: LaunchDb,
  cohortId: string,
): Promise<LaunchProfile[]> {
  return db
    .select()
    .from(launchProfiles)
    .where(eq(launchProfiles.cohortId, cohortId))
    .orderBy(desc(launchProfiles.upvoteCount));
}

/** Only featured (live) entries for a cohort — what the public leaderboard shows. */
export async function listFeaturedProfilesByCohort(
  db: LaunchDb,
  cohortId: string,
): Promise<LaunchProfile[]> {
  return db
    .select()
    .from(launchProfiles)
    .where(
      and(
        eq(launchProfiles.cohortId, cohortId),
        eq(launchProfiles.status, "featured"),
      ),
    )
    .orderBy(desc(launchProfiles.upvoteCount));
}

export async function createProfile(
  db: LaunchDb,
  data: Omit<NewLaunchProfile, "id" | "slug" | "createdAt" | "updatedAt"> & {
    slug?: string;
  },
): Promise<LaunchProfile> {
  const id = uuid();
  const now = new Date();

  // Derive a unique human-readable slug from the name.
  let slug = data.slug || slugifyName(data.name);
  let existing = await getProfileBySlug(db, slug);
  let counter = 1;
  while (existing) {
    slug = `${slugifyName(data.name)}-${counter}`;
    existing = await getProfileBySlug(db, slug);
    counter++;
  }

  await db
    .insert(launchProfiles)
    .values({ ...data, id, slug, createdAt: now, updatedAt: now });
  const [row] = await db
    .select()
    .from(launchProfiles)
    .where(eq(launchProfiles.id, id));
  return row;
}

export async function updateProfile(
  db: LaunchDb,
  slug: string,
  patch: Partial<Omit<NewLaunchProfile, "id" | "slug">>,
): Promise<LaunchProfile | undefined> {
  await db
    .update(launchProfiles)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(launchProfiles.slug, slug));
  return getProfileBySlug(db, slug);
}

// ============================================
// Votes
// ============================================

export class DuplicateVoteError extends Error {
  constructor() {
    super("already-voted");
    this.name = "DuplicateVoteError";
  }
}

// Drizzle wraps the driver error as a generic Error and hangs the real
// PostgresError (with `.code`) off `.cause`. Check both levels.
function isUniqueViolation(err: unknown): boolean {
  for (let cur: unknown = err, depth = 0; cur && depth < 3; depth++) {
    if (
      typeof cur === "object" &&
      "code" in cur &&
      (cur as { code?: string }).code === "23505"
    ) {
      return true;
    }
    cur =
      typeof cur === "object" && "cause" in cur
        ? (cur as { cause?: unknown }).cause
        : undefined;
  }
  return false;
}

/**
 * Record a vote. Throws {@link DuplicateVoteError} if the (profile, voter) pair
 * already exists (the DB unique index is the real guard against races).
 */
export async function createVote(
  db: LaunchDb,
  data: {
    profileId: string;
    voterUserId: string;
    ipAddress: string | null;
  },
): Promise<void> {
  try {
    await db.insert(launchVotes).values({
      id: uuid(),
      profileId: data.profileId,
      voterUserId: data.voterUserId,
      ipAddress: data.ipAddress,
      createdAt: new Date(),
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new DuplicateVoteError();
    }
    throw err;
  }
}

export async function deleteVote(
  db: LaunchDb,
  profileId: string,
  voterUserId: string,
): Promise<void> {
  await db
    .delete(launchVotes)
    .where(
      and(
        eq(launchVotes.profileId, profileId),
        eq(launchVotes.voterUserId, voterUserId),
      ),
    );
}

export async function hasUserVoted(
  db: LaunchDb,
  profileId: string,
  voterUserId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: launchVotes.id })
    .from(launchVotes)
    .where(
      and(
        eq(launchVotes.profileId, profileId),
        eq(launchVotes.voterUserId, voterUserId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** Set of profile ids the user has voted for, across the given profile ids. */
export async function getUserVotedProfileIds(
  db: LaunchDb,
  voterUserId: string,
  profileIds: string[],
): Promise<Set<string>> {
  if (profileIds.length === 0) return new Set();
  const rows = await db
    .select({ profileId: launchVotes.profileId })
    .from(launchVotes)
    .where(
      and(
        eq(launchVotes.voterUserId, voterUserId),
        inArray(launchVotes.profileId, profileIds),
      ),
    );
  return new Set(rows.map((r) => r.profileId));
}

export async function countVotesByUserSince(
  db: LaunchDb,
  voterUserId: string,
  since: Date,
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(launchVotes)
    .where(
      and(
        eq(launchVotes.voterUserId, voterUserId),
        gte(launchVotes.createdAt, since),
      ),
    );
  return row?.n ?? 0;
}

export async function countVotesByIpSince(
  db: LaunchDb,
  ipAddress: string,
  since: Date,
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(launchVotes)
    .where(
      and(
        eq(launchVotes.ipAddress, ipAddress),
        gte(launchVotes.createdAt, since),
      ),
    );
  return row?.n ?? 0;
}

export async function countSubmissionsByUserSince(
  db: LaunchDb,
  submittedByUserId: string,
  since: Date,
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(launchProfiles)
    .where(
      and(
        eq(launchProfiles.submittedByUserId, submittedByUserId),
        gte(launchProfiles.createdAt, since),
      ),
    );
  return row?.n ?? 0;
}

/** Recompute and persist a profile's upvoteCount from non-cleared votes. */
export async function recomputeUpvoteCount(
  db: LaunchDb,
  profileId: string,
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(launchVotes)
    .where(
      and(eq(launchVotes.profileId, profileId), eq(launchVotes.cleared, false)),
    );
  const n = row?.n ?? 0;
  await db
    .update(launchProfiles)
    .set({ upvoteCount: n, updatedAt: new Date() })
    .where(eq(launchProfiles.id, profileId));
  return n;
}

/**
 * Vote-clearing pass for a cohort: flag votes from IPs that appear more than
 * {@link LAUNCH_CONFIG.suspiciousIpClusterThreshold} times across the cohort's
 * profiles (a single-source burst), then recompute affected upvote counts.
 * Returns the number of votes cleared.
 */
export async function clearSuspiciousVotes(
  db: LaunchDb,
  cohortId: string,
): Promise<number> {
  const profiles = await listProfilesByCohort(db, cohortId);
  const profileIds = profiles.map((p) => p.id);
  if (profileIds.length === 0) return 0;

  // IPs whose total votes across the cohort exceed the cluster threshold.
  const clusters = await db
    .select({ ip: launchVotes.ipAddress, n: count() })
    .from(launchVotes)
    .where(
      and(
        inArray(launchVotes.profileId, profileIds),
        eq(launchVotes.cleared, false),
      ),
    )
    .groupBy(launchVotes.ipAddress)
    .having(sql`count(*) > ${LAUNCH_CONFIG.suspiciousIpClusterThreshold}`);

  const suspiciousIps = clusters
    .map((c) => c.ip)
    .filter((ip): ip is string => Boolean(ip));
  if (suspiciousIps.length === 0) return 0;

  const cleared = await db
    .update(launchVotes)
    .set({ cleared: true })
    .where(
      and(
        inArray(launchVotes.profileId, profileIds),
        inArray(launchVotes.ipAddress, suspiciousIps),
      ),
    )
    .returning({ id: launchVotes.id });

  for (const id of profileIds) {
    await recomputeUpvoteCount(db, id);
  }
  return cleared.length;
}

// ============================================
// Comments
// ============================================

/**
 * A comment as this plugin can see it.
 *
 * `authorName` is gone: it came from `leftJoin(users, …)`, and `users` is a
 * core table. The API layer fills the name in from
 * `LaunchHost.resolveUserNames` instead — see `../api/handlers.ts`.
 */
export interface CommentRow {
  id: string;
  body: string;
  authorUserId: string;
  createdAt: Date | null;
}

const commentColumns = {
  id: launchComments.id,
  body: launchComments.body,
  authorUserId: launchComments.authorUserId,
  createdAt: launchComments.createdAt,
};

export async function getCommentsForProfile(
  db: LaunchDb,
  profileId: string,
): Promise<CommentRow[]> {
  return db
    .select(commentColumns)
    .from(launchComments)
    .where(
      and(
        eq(launchComments.profileId, profileId),
        isNull(launchComments.deletedAt),
      ),
    )
    .orderBy(asc(launchComments.createdAt));
}

export async function getCommentById(
  db: LaunchDb,
  id: string,
): Promise<
  | {
      id: string;
      profileId: string;
      authorUserId: string;
      deletedAt: Date | null;
    }
  | undefined
> {
  const [row] = await db
    .select({
      id: launchComments.id,
      profileId: launchComments.profileId,
      authorUserId: launchComments.authorUserId,
      deletedAt: launchComments.deletedAt,
    })
    .from(launchComments)
    .where(eq(launchComments.id, id));
  return row;
}

export async function createComment(
  db: LaunchDb,
  data: {
    profileId: string;
    authorUserId: string;
    body: string;
    ipAddress: string | null;
  },
): Promise<CommentRow> {
  const id = uuid();
  const now = new Date();
  await db.insert(launchComments).values({
    id,
    profileId: data.profileId,
    authorUserId: data.authorUserId,
    body: data.body.trim(),
    ipAddress: data.ipAddress,
    createdAt: now,
    updatedAt: now,
  });
  const [row] = await db
    .select(commentColumns)
    .from(launchComments)
    .where(eq(launchComments.id, id));
  return row;
}

export async function softDeleteComment(
  db: LaunchDb,
  id: string,
): Promise<void> {
  await db
    .update(launchComments)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(launchComments.id, id));
}

export async function countCommentsByUserSince(
  db: LaunchDb,
  authorUserId: string,
  since: Date,
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(launchComments)
    .where(
      and(
        eq(launchComments.authorUserId, authorUserId),
        gte(launchComments.createdAt, since),
        isNull(launchComments.deletedAt),
      ),
    );
  return row?.n ?? 0;
}

// ============================================
// Reactions
// ============================================

export interface ReactionSummary {
  counts: Record<string, number>;
  mine: string[];
}

export async function getReactionsForProfile(
  db: LaunchDb,
  profileId: string,
  reactorUserId?: string,
): Promise<ReactionSummary> {
  const rows = await db
    .select({
      emoji: launchReactions.emoji,
      reactorUserId: launchReactions.reactorUserId,
    })
    .from(launchReactions)
    .where(eq(launchReactions.profileId, profileId));

  const counts: Record<string, number> = {};
  const mine: string[] = [];
  for (const row of rows) {
    counts[row.emoji] = (counts[row.emoji] ?? 0) + 1;
    if (reactorUserId && row.reactorUserId === reactorUserId) {
      mine.push(row.emoji);
    }
  }
  return { counts, mine };
}

export async function addReaction(
  db: LaunchDb,
  data: {
    profileId: string;
    reactorUserId: string;
    emoji: string;
  },
): Promise<void> {
  try {
    await db.insert(launchReactions).values({
      id: uuid(),
      profileId: data.profileId,
      reactorUserId: data.reactorUserId,
      emoji: data.emoji,
      createdAt: new Date(),
    });
  } catch (err) {
    // 23505 = unique violation — already reacted, treat as success
    if (!isUniqueViolation(err)) throw err;
  }
}

export async function removeReaction(
  db: LaunchDb,
  data: {
    profileId: string;
    reactorUserId: string;
    emoji: string;
  },
): Promise<void> {
  await db
    .delete(launchReactions)
    .where(
      and(
        eq(launchReactions.profileId, data.profileId),
        eq(launchReactions.reactorUserId, data.reactorUserId),
        eq(launchReactions.emoji, data.emoji),
      ),
    );
}

// ============================================
// Events (analytics)
// ============================================

export async function hasRecentEvent(
  db: LaunchDb,
  data: {
    profileId: string;
    type: "view" | "visit";
    ipHash: string;
    windowSec: number;
  },
): Promise<boolean> {
  const since = new Date(Date.now() - data.windowSec * 1000);
  const [row] = await db
    .select({ id: launchEvents.id })
    .from(launchEvents)
    .where(
      and(
        eq(launchEvents.profileId, data.profileId),
        eq(launchEvents.type, data.type),
        eq(launchEvents.ipHash, data.ipHash),
        gte(launchEvents.createdAt, since),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function recordEvent(
  db: LaunchDb,
  data: {
    profileId: string;
    type: "view" | "visit";
    ipHash: string;
    uaHash?: string;
  },
): Promise<void> {
  try {
    await db.insert(launchEvents).values({
      id: uuid(),
      profileId: data.profileId,
      type: data.type,
      ipHash: data.ipHash,
      uaHash: data.uaHash ?? null,
      createdAt: new Date(),
    });
  } catch (err) {
    // 23505 = already recorded (same day dedup via unique index) — fine
    if (!isUniqueViolation(err)) throw err;
  }
}

// ============================================
// Stats (owner/admin)
// ============================================

export async function getProfileEventStats(
  db: LaunchDb,
  profileId: string,
): Promise<{
  views: number;
  visits: number;
  viewsByDay: { date: string; count: number }[];
  visitsByDay: { date: string; count: number }[];
}> {
  const totals = await db
    .select({ type: launchEvents.type, n: count() })
    .from(launchEvents)
    .where(eq(launchEvents.profileId, profileId))
    .groupBy(launchEvents.type);

  const views = totals.find((r) => r.type === "view")?.n ?? 0;
  const visits = totals.find((r) => r.type === "visit")?.n ?? 0;

  const byDay = await db
    .select({
      type: launchEvents.type,
      date: sql<string>`to_char(${launchEvents.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
      n: count(),
    })
    .from(launchEvents)
    .where(eq(launchEvents.profileId, profileId))
    .groupBy(
      launchEvents.type,
      sql`to_char(${launchEvents.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
    )
    .orderBy(
      sql`to_char(${launchEvents.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
    );

  return {
    views,
    visits,
    viewsByDay: byDay
      .filter((r) => r.type === "view")
      .map((r) => ({ date: r.date, count: r.n })),
    visitsByDay: byDay
      .filter((r) => r.type === "visit")
      .map((r) => ({ date: r.date, count: r.n })),
  };
}

// ============================================
// Monthly winners
// ============================================

export async function getMonthlyWinners(
  db: LaunchDb,
): Promise<LaunchMonthlyWinner[]> {
  return db
    .select()
    .from(launchMonthlyWinners)
    .orderBy(desc(launchMonthlyWinners.month));
}

export async function setMonthlyWinner(
  db: LaunchDb,
  month: string,
  profileSlug: string,
): Promise<void> {
  const existing = await db
    .select({ id: launchMonthlyWinners.id })
    .from(launchMonthlyWinners)
    .where(eq(launchMonthlyWinners.month, month));
  if (existing.length > 0) {
    await db
      .update(launchMonthlyWinners)
      .set({ profileSlug })
      .where(eq(launchMonthlyWinners.month, month));
  } else {
    await db
      .insert(launchMonthlyWinners)
      .values({ id: uuid(), month, profileSlug, createdAt: new Date() });
  }
}

// ============================================
// Account deletion (the FK cascade this replaces)
// ============================================

/**
 * Everything the board holds for one user.
 *
 * Ordered so that a partial failure leaves nothing referencing a row that is
 * already gone: votes, comments and reactions first (each also triggers an
 * `upvoteCount` recompute for votes), then the profile back-reference.
 *
 * `launch_profiles` rows are *not* deleted. The FK was `ON DELETE SET NULL`,
 * so a submission has always outlived its submitter — the board keeps showing
 * a featured app after the founder closes their account. Only the link to the
 * person goes.
 */
export async function deleteUserData(
  db: LaunchDb,
  userId: string,
): Promise<void> {
  const votedProfiles = await db
    .select({ profileId: launchVotes.profileId })
    .from(launchVotes)
    .where(eq(launchVotes.voterUserId, userId));

  await db.delete(launchVotes).where(eq(launchVotes.voterUserId, userId));
  await db
    .delete(launchReactions)
    .where(eq(launchReactions.reactorUserId, userId));
  await db
    .delete(launchComments)
    .where(eq(launchComments.authorUserId, userId));
  await db
    .update(launchProfiles)
    .set({ submittedByUserId: null, updatedAt: new Date() })
    .where(eq(launchProfiles.submittedByUserId, userId));

  // The denormalized counter is the board's ranking input, so it must not keep
  // counting a vote that no longer exists.
  for (const id of new Set(votedProfiles.map((r) => r.profileId))) {
    await recomputeUpvoteCount(db, id);
  }
}
