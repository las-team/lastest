import { db } from '../index';
import { publicShares, builds, tests, testRuns, baselines } from '../schema';
import type { NewPublicShare, PublicShare, Baseline } from '../schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

export async function createPublicShare(
  data: Omit<NewPublicShare, 'id' | 'createdAt'>,
): Promise<PublicShare> {
  const id = uuid();
  const createdAt = new Date();
  await db.insert(publicShares).values({ ...data, id, createdAt });
  const [row] = await db.select().from(publicShares).where(eq(publicShares.id, id));
  return row;
}

export async function getPublicShareBySlug(slug: string): Promise<PublicShare | undefined> {
  const [row] = await db.select().from(publicShares).where(eq(publicShares.slug, slug));
  return row;
}

export async function getPublicShareById(id: string): Promise<PublicShare | undefined> {
  const [row] = await db.select().from(publicShares).where(eq(publicShares.id, id));
  return row;
}

export async function listPublicSharesForBuild(buildId: string): Promise<PublicShare[]> {
  return db
    .select()
    .from(publicShares)
    .where(eq(publicShares.buildId, buildId))
    .orderBy(desc(publicShares.createdAt));
}

export async function listPublicSharesForTest(testId: string): Promise<PublicShare[]> {
  return db
    .select()
    .from(publicShares)
    .where(eq(publicShares.testId, testId))
    .orderBy(desc(publicShares.createdAt));
}

export async function revokePublicShareById(id: string): Promise<void> {
  await db
    .update(publicShares)
    .set({ status: 'revoked', revokedAt: new Date() })
    .where(eq(publicShares.id, id));
}

export async function markPublicShareClaimed(
  slug: string,
  claimedByTeamId: string,
  claimedByUserId: string,
): Promise<void> {
  await db
    .update(publicShares)
    .set({ claimedByTeamId, claimedByUserId, claimedAt: new Date() })
    .where(and(eq(publicShares.slug, slug), sql`${publicShares.claimedByTeamId} IS NULL`));
}

export async function incrementPublicShareView(slug: string): Promise<void> {
  await db
    .update(publicShares)
    .set({
      viewCount: sql`${publicShares.viewCount} + 1`,
      lastViewedAt: new Date(),
    })
    .where(eq(publicShares.slug, slug));
}

export interface PublicShareContext {
  share: PublicShare;
  build: typeof builds.$inferSelect;
  test: typeof tests.$inferSelect | null;
  testRun: typeof testRuns.$inferSelect | null;
}

export async function getActiveBaselinesForTest(testId: string): Promise<Baseline[]> {
  return db
    .select()
    .from(baselines)
    .where(and(eq(baselines.testId, testId), eq(baselines.isActive, true)));
}

export async function getPublicShareContext(slug: string): Promise<PublicShareContext | null> {
  const share = await getPublicShareBySlug(slug);
  if (!share || share.status !== 'public') return null;

  const [build] = await db.select().from(builds).where(eq(builds.id, share.buildId));
  if (!build) return null;

  const test = share.testId
    ? (await db.select().from(tests).where(eq(tests.id, share.testId)))[0] ?? null
    : null;

  const testRun = build.testRunId
    ? (await db.select().from(testRuns).where(eq(testRuns.id, build.testRunId)))[0] ?? null
    : null;

  return { share, build, test, testRun };
}
