import { db } from '../index';
import {
  publicShares,
  builds,
  tests,
  testRuns,
  baselines,
  visualDiffs,
  testResults,
} from '../schema';
import type {
  NewPublicShare,
  PublicShare,
  Baseline,
  CapturedScreenshot,
} from '../schema';
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

// Slim visual diff projection for public share consumers. Excludes heavy
// JSONB columns (a11yViolations, consoleErrors, networkRequests, downloads,
// metadata, aiAnalysis*) that the share page never reads — they bloat the
// serialized payload and explode the Next/SWC type graph on cold compile.
export type ShareVisualDiff = {
  id: string;
  buildId: string;
  testResultId: string | null;
  testId: string;
  stepLabel: string | null;
  baselineImagePath: string | null;
  currentImagePath: string | null;
  diffImagePath: string | null;
  status: string;
  pixelDifference: number | null;
  percentageDifference: string | null;
  classification: string | null;
  plannedImagePath: string | null;
  plannedDiffImagePath: string | null;
  mainBaselineImagePath: string | null;
  mainDiffImagePath: string | null;
  testResultStatus: string | null;
  testName: string | null;
};

export type ShareTestResult = {
  testId: string | null;
  status: string | null;
  screenshotPath: string | null;
  videoPath: string | null;
  durationMs: number | null;
  screenshots: CapturedScreenshot[] | null;
};

export interface ShareData extends PublicShareContext {
  diffs: ShareVisualDiff[];
  results: ShareTestResult[];
}

export async function getShareDataBySlug(slug: string): Promise<ShareData | null> {
  const ctx = await getPublicShareContext(slug);
  if (!ctx) return null;
  const { share, build } = ctx;

  const diffsWhere = share.testId
    ? and(eq(visualDiffs.buildId, build.id), eq(visualDiffs.testId, share.testId))
    : eq(visualDiffs.buildId, build.id);

  const diffsQuery = db
    .select({
      id: visualDiffs.id,
      buildId: visualDiffs.buildId,
      testResultId: visualDiffs.testResultId,
      testId: visualDiffs.testId,
      stepLabel: visualDiffs.stepLabel,
      baselineImagePath: visualDiffs.baselineImagePath,
      currentImagePath: visualDiffs.currentImagePath,
      diffImagePath: visualDiffs.diffImagePath,
      status: visualDiffs.status,
      pixelDifference: visualDiffs.pixelDifference,
      percentageDifference: visualDiffs.percentageDifference,
      classification: visualDiffs.classification,
      plannedImagePath: visualDiffs.plannedImagePath,
      plannedDiffImagePath: visualDiffs.plannedDiffImagePath,
      mainBaselineImagePath: visualDiffs.mainBaselineImagePath,
      mainDiffImagePath: visualDiffs.mainDiffImagePath,
      testResultStatus: testResults.status,
      testName: tests.name,
    })
    .from(visualDiffs)
    .leftJoin(testResults, eq(visualDiffs.testResultId, testResults.id))
    .leftJoin(tests, eq(visualDiffs.testId, tests.id))
    .where(diffsWhere);

  const testRunId = build.testRunId;
  const resultsQuery: Promise<ShareTestResult[]> = testRunId
    ? db
        .select({
          testId: testResults.testId,
          status: testResults.status,
          screenshotPath: testResults.screenshotPath,
          videoPath: testResults.videoPath,
          durationMs: testResults.durationMs,
          screenshots: testResults.screenshots,
        })
        .from(testResults)
        .where(
          share.testId
            ? and(eq(testResults.testRunId, testRunId), eq(testResults.testId, share.testId))
            : eq(testResults.testRunId, testRunId),
        )
    : Promise.resolve([]);

  const [diffs, results] = await Promise.all([diffsQuery, resultsQuery]);
  return { ...ctx, diffs, results };
}

// Allowlist of storage paths the public share is permitted to serve. Rebuilt
// per request from the same two projection-narrow selects above; no cache
// needed, so changes (re-runs, baseline approvals, AI analysis rewrites) are
// picked up immediately.
export async function getShareAllowlist(slug: string): Promise<Set<string> | null> {
  const share = await getPublicShareBySlug(slug);
  if (!share || share.status !== 'public') return null;

  const [build] = await db.select().from(builds).where(eq(builds.id, share.buildId));
  if (!build) return null;

  const diffsWhere = share.testId
    ? and(eq(visualDiffs.buildId, build.id), eq(visualDiffs.testId, share.testId))
    : eq(visualDiffs.buildId, build.id);

  const diffPathsQuery = db
    .select({
      baselineImagePath: visualDiffs.baselineImagePath,
      currentImagePath: visualDiffs.currentImagePath,
      diffImagePath: visualDiffs.diffImagePath,
      plannedImagePath: visualDiffs.plannedImagePath,
      plannedDiffImagePath: visualDiffs.plannedDiffImagePath,
      mainBaselineImagePath: visualDiffs.mainBaselineImagePath,
      mainDiffImagePath: visualDiffs.mainDiffImagePath,
    })
    .from(visualDiffs)
    .where(diffsWhere);

  const testRunId = build.testRunId;
  const resultPathsQuery = testRunId
    ? db
        .select({
          screenshotPath: testResults.screenshotPath,
          videoPath: testResults.videoPath,
          screenshots: testResults.screenshots,
        })
        .from(testResults)
        .where(
          share.testId
            ? and(eq(testResults.testRunId, testRunId), eq(testResults.testId, share.testId))
            : eq(testResults.testRunId, testRunId),
        )
    : Promise.resolve(
        [] as Array<{
          screenshotPath: string | null;
          videoPath: string | null;
          screenshots: CapturedScreenshot[] | null;
        }>,
      );

  const [diffRows, resultRows] = await Promise.all([diffPathsQuery, resultPathsQuery]);

  const allow = new Set<string>();
  const add = (p: string | null | undefined) => {
    if (p) allow.add(p.startsWith('/') ? p : `/${p}`);
  };
  for (const d of diffRows) {
    add(d.baselineImagePath);
    add(d.currentImagePath);
    add(d.diffImagePath);
    add(d.plannedImagePath);
    add(d.plannedDiffImagePath);
    add(d.mainBaselineImagePath);
    add(d.mainDiffImagePath);
  }
  for (const r of resultRows) {
    add(r.screenshotPath);
    add(r.videoPath);
    for (const s of r.screenshots ?? []) add(s.path);
  }
  return allow;
}
