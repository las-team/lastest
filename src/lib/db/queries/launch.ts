import { db } from '../index';
import {
  launchCohorts,
  launchProfiles,
  launchVotes,
  launchMonthlyWinners,
} from '../schema';
import type {
  NewLaunchCohort,
  LaunchCohort,
  LaunchCohortState,
  NewLaunchProfile,
  LaunchProfile,
  LaunchMonthlyWinner,
} from '../schema';
import { DEFAULT_LAUNCH } from '../schema';
import { eq, and, desc, asc, gte, inArray, sql, count } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

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
    .where(eq(launchCohorts.state, 'voting'))
    .orderBy(desc(launchCohorts.weekStartAt))
    .limit(1);
  if (live) return live;

  const [open] = await db
    .select()
    .from(launchCohorts)
    .where(eq(launchCohorts.state, 'open'))
    .orderBy(asc(launchCohorts.weekStartAt))
    .limit(1);
  return open;
}

export async function getCohortById(id: string): Promise<LaunchCohort | undefined> {
  const [row] = await db.select().from(launchCohorts).where(eq(launchCohorts.id, id));
  return row;
}

export async function getCohortByWeekStart(weekStartAt: Date): Promise<LaunchCohort | undefined> {
  const [row] = await db
    .select()
    .from(launchCohorts)
    .where(eq(launchCohorts.weekStartAt, weekStartAt));
  return row;
}

export async function getCohortsByState(states: LaunchCohortState[]): Promise<LaunchCohort[]> {
  if (states.length === 0) return [];
  return db
    .select()
    .from(launchCohorts)
    .where(inArray(launchCohorts.state, states))
    .orderBy(desc(launchCohorts.weekStartAt));
}

export async function createCohort(
  data: Omit<NewLaunchCohort, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<LaunchCohort> {
  const id = uuid();
  const now = new Date();
  await db.insert(launchCohorts).values({ ...data, id, createdAt: now, updatedAt: now });
  const [row] = await db.select().from(launchCohorts).where(eq(launchCohorts.id, id));
  return row;
}

export async function setCohortState(id: string, state: LaunchCohortState): Promise<void> {
  await db
    .update(launchCohorts)
    .set({ state, updatedAt: new Date() })
    .where(eq(launchCohorts.id, id));
}

export async function lockCohortWinner(id: string, winnerSlug: string | null): Promise<void> {
  await db
    .update(launchCohorts)
    .set({ state: 'locked', winnerSlug, updatedAt: new Date() })
    .where(eq(launchCohorts.id, id));
}

/** All cohorts in a state, oldest first — used by the state engine to advance due ones. */
export async function listCohortsByStateAsc(states: LaunchCohortState[]): Promise<LaunchCohort[]> {
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
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50) || 'launch';
}

/** Normalize a website URL to its bare host (lowercase, no www/port) for dup detection. */
export function normalizeDomain(websiteUrl: string): string | null {
  try {
    const url = new URL(websiteUrl.includes('://') ? websiteUrl : `https://${websiteUrl}`);
    return url.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

export async function getProfileBySlug(slug: string): Promise<LaunchProfile | undefined> {
  const [row] = await db.select().from(launchProfiles).where(eq(launchProfiles.slug, slug));
  return row;
}

export async function findProfileByDomain(domain: string): Promise<LaunchProfile | undefined> {
  const [row] = await db.select().from(launchProfiles).where(eq(launchProfiles.domain, domain));
  return row;
}

export async function listProfilesByCohort(cohortId: string): Promise<LaunchProfile[]> {
  return db
    .select()
    .from(launchProfiles)
    .where(eq(launchProfiles.cohortId, cohortId))
    .orderBy(desc(launchProfiles.upvoteCount));
}

/** Only featured (live) entries for a cohort — what the public leaderboard shows. */
export async function listFeaturedProfilesByCohort(cohortId: string): Promise<LaunchProfile[]> {
  return db
    .select()
    .from(launchProfiles)
    .where(and(eq(launchProfiles.cohortId, cohortId), eq(launchProfiles.status, 'featured')))
    .orderBy(desc(launchProfiles.upvoteCount));
}

export async function createProfile(
  data: Omit<NewLaunchProfile, 'id' | 'slug' | 'createdAt' | 'updatedAt'> & { slug?: string },
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

  await db.insert(launchProfiles).values({ ...data, id, slug, createdAt: now, updatedAt: now });
  const [row] = await db.select().from(launchProfiles).where(eq(launchProfiles.id, id));
  return row;
}

export async function updateProfile(
  slug: string,
  patch: Partial<Omit<NewLaunchProfile, 'id' | 'slug'>>,
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
    super('already-voted');
    this.name = 'DuplicateVoteError';
  }
}

// Drizzle wraps the driver error as a generic Error and hangs the real
// PostgresError (with `.code`) off `.cause`. Check both levels.
function isUniqueViolation(err: unknown): boolean {
  for (let cur: unknown = err, depth = 0; cur && depth < 3; depth++) {
    if (typeof cur === 'object' && 'code' in cur && (cur as { code?: string }).code === '23505') {
      return true;
    }
    cur = typeof cur === 'object' && 'cause' in cur ? (cur as { cause?: unknown }).cause : undefined;
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

export async function deleteVote(profileId: string, voterUserId: string): Promise<void> {
  await db
    .delete(launchVotes)
    .where(and(eq(launchVotes.profileId, profileId), eq(launchVotes.voterUserId, voterUserId)));
}

export async function hasUserVoted(profileId: string, voterUserId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: launchVotes.id })
    .from(launchVotes)
    .where(and(eq(launchVotes.profileId, profileId), eq(launchVotes.voterUserId, voterUserId)))
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
    .where(and(eq(launchVotes.voterUserId, voterUserId), inArray(launchVotes.profileId, profileIds)));
  return new Set(rows.map((r) => r.profileId));
}

export async function countVotesByUserSince(voterUserId: string, since: Date): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(launchVotes)
    .where(and(eq(launchVotes.voterUserId, voterUserId), gte(launchVotes.createdAt, since)));
  return row?.n ?? 0;
}

export async function countVotesByIpSince(ipAddress: string, since: Date): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(launchVotes)
    .where(and(eq(launchVotes.ipAddress, ipAddress), gte(launchVotes.createdAt, since)));
  return row?.n ?? 0;
}

export async function countSubmissionsByUserSince(submittedByUserId: string, since: Date): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(launchProfiles)
    .where(and(eq(launchProfiles.submittedByUserId, submittedByUserId), gte(launchProfiles.createdAt, since)));
  return row?.n ?? 0;
}

/** Recompute and persist a profile's upvoteCount from non-cleared votes. */
export async function recomputeUpvoteCount(profileId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(launchVotes)
    .where(and(eq(launchVotes.profileId, profileId), eq(launchVotes.cleared, false)));
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
    .where(and(inArray(launchVotes.profileId, profileIds), eq(launchVotes.cleared, false)))
    .groupBy(launchVotes.ipAddress)
    .having(sql`count(*) > ${DEFAULT_LAUNCH.suspiciousIpClusterThreshold}`);

  const suspiciousIps = clusters
    .map((c) => c.ip)
    .filter((ip): ip is string => Boolean(ip));
  if (suspiciousIps.length === 0) return 0;

  const cleared = await db
    .update(launchVotes)
    .set({ cleared: true })
    .where(and(inArray(launchVotes.profileId, profileIds), inArray(launchVotes.ipAddress, suspiciousIps)))
    .returning({ id: launchVotes.id });

  for (const id of profileIds) {
    await recomputeUpvoteCount(id);
  }
  return cleared.length;
}

// ============================================
// Monthly winners
// ============================================

export async function getMonthlyWinners(): Promise<LaunchMonthlyWinner[]> {
  return db.select().from(launchMonthlyWinners).orderBy(desc(launchMonthlyWinners.month));
}

export async function setMonthlyWinner(month: string, profileSlug: string): Promise<void> {
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
