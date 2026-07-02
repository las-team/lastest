import { db } from "../index";
import {
  launchCohorts,
  launchProfiles,
  launchVotes,
  launchMonthlyWinners,
  launchComments,
  launchReactions,
  launchEvents,
  users,
} from "../schema";
import type {
  NewLaunchCohort,
  LaunchCohort,
  LaunchCohortState,
  NewLaunchProfile,
  LaunchProfile,
  LaunchMonthlyWinner,
} from "../schema";
import { DEFAULT_LAUNCH } from "../schema";
import {
  eq,
  and,
  desc,
  asc,
  gte,
  lt,
  inArray,
  isNull,
  sql,
  count,
} from "drizzle-orm";
import { v4 as uuid } from "uuid";

// ============================================
// Cohorts
// ============================================

/**
 * The cohort the board currently points at: a `voting` cohort if one is live,
 * otherwise the soonest `open` cohort. Never returns locked/closed archives.
 */
export async function getCurrentCohort(): Promise<LaunchCohort | undefined> {
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
  id: string,
): Promise<LaunchCohort | undefined> {
  const [row] = await db
    .select()
    .from(launchCohorts)
    .where(eq(launchCohorts.id, id));
  return row;
}

export async function getCohortByWeekStart(
  weekStartAt: Date,
): Promise<LaunchCohort | undefined> {
  const [row] = await db
    .select()
    .from(launchCohorts)
    .where(eq(launchCohorts.weekStartAt, weekStartAt));
  return row;
}

export async function getCohortsByState(
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
  id: string,
  state: LaunchCohortState,
): Promise<void> {
  await db
    .update(launchCohorts)
    .set({ state, updatedAt: new Date() })
    .where(eq(launchCohorts.id, id));
}

export async function lockCohortWinner(
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
  slug: string,
): Promise<LaunchProfile | undefined> {
  const [row] = await db
    .select()
    .from(launchProfiles)
    .where(eq(launchProfiles.slug, slug));
  return row;
}

export async function findProfileByDomain(
  domain: string,
): Promise<LaunchProfile | undefined> {
  const [row] = await db
    .select()
    .from(launchProfiles)
    .where(eq(launchProfiles.domain, domain));
  return row;
}

export async function listProfilesByCohort(
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
  data: Omit<NewLaunchProfile, "id" | "slug" | "createdAt" | "updatedAt"> & {
    slug?: string;
  },
): Promise<LaunchProfile> {
  const id = uuid();
  const now = new Date();

  // Derive a unique human-readable slug from the name.
  let slug = data.slug || slugifyName(data.name);
  let existing = await getProfileBySlug(slug);
  let counter = 1;
  while (existing) {
    slug = `${slugifyName(data.name)}-${counter}`;
    existing = await getProfileBySlug(slug);
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
  slug: string,
  patch: Partial<Omit<NewLaunchProfile, "id" | "slug">>,
): Promise<LaunchProfile | undefined> {
  await db
    .update(launchProfiles)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(launchProfiles.slug, slug));
  return getProfileBySlug(slug);
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
export async function createVote(data: {
  profileId: string;
  voterUserId: string;
  ipAddress: string | null;
}): Promise<void> {
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

/** Set of profile slugs the user has voted for, across the given profile ids. */
export async function getUserVotedProfileIds(
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
export async function recomputeUpvoteCount(profileId: string): Promise<number> {
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
 * {@link DEFAULT_LAUNCH.suspiciousIpClusterThreshold} times across the cohort's
 * profiles (a single-source burst), then recompute affected upvote counts.
 * Returns the number of votes cleared.
 */
export async function clearSuspiciousVotes(cohortId: string): Promise<number> {
  const profiles = await listProfilesByCohort(cohortId);
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
    .having(sql`count(*) > ${DEFAULT_LAUNCH.suspiciousIpClusterThreshold}`);

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
    await recomputeUpvoteCount(id);
  }
  return cleared.length;
}

// ============================================
// Comments
// ============================================

export interface CommentRow {
  id: string;
  body: string;
  authorUserId: string;
  authorName: string | null;
  createdAt: Date | null;
}

export async function getCommentsForProfile(
  profileId: string,
): Promise<CommentRow[]> {
  return db
    .select({
      id: launchComments.id,
      body: launchComments.body,
      authorUserId: launchComments.authorUserId,
      authorName: users.name,
      createdAt: launchComments.createdAt,
    })
    .from(launchComments)
    .leftJoin(users, eq(launchComments.authorUserId, users.id))
    .where(
      and(
        eq(launchComments.profileId, profileId),
        isNull(launchComments.deletedAt),
      ),
    )
    .orderBy(asc(launchComments.createdAt));
}

export async function getCommentById(id: string): Promise<
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

export async function createComment(data: {
  profileId: string;
  authorUserId: string;
  body: string;
  ipAddress: string | null;
}): Promise<CommentRow> {
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
    .select({
      id: launchComments.id,
      body: launchComments.body,
      authorUserId: launchComments.authorUserId,
      authorName: users.name,
      createdAt: launchComments.createdAt,
    })
    .from(launchComments)
    .leftJoin(users, eq(launchComments.authorUserId, users.id))
    .where(eq(launchComments.id, id));
  return row;
}

export async function softDeleteComment(id: string): Promise<void> {
  await db
    .update(launchComments)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(launchComments.id, id));
}

export async function countCommentsByUserSince(
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

export async function addReaction(data: {
  profileId: string;
  reactorUserId: string;
  emoji: string;
}): Promise<void> {
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

export async function removeReaction(data: {
  profileId: string;
  reactorUserId: string;
  emoji: string;
}): Promise<void> {
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

export async function hasRecentEvent(data: {
  profileId: string;
  type: "view" | "visit";
  ipHash: string;
  windowSec: number;
}): Promise<boolean> {
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

export async function recordEvent(data: {
  profileId: string;
  type: "view" | "visit";
  ipHash: string;
  uaHash?: string;
}): Promise<void> {
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

export async function getProfileEventStats(profileId: string): Promise<{
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

export async function getMonthlyWinners(): Promise<LaunchMonthlyWinner[]> {
  return db
    .select()
    .from(launchMonthlyWinners)
    .orderBy(desc(launchMonthlyWinners.month));
}

export async function setMonthlyWinner(
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
