import { db } from "../index";
import {
  publicShares,
  builds,
  tests,
  testRuns,
  baselines,
  visualDiffs,
  testResults,
  stepComparisons,
} from "../schema";
import type {
  NewPublicShare,
  PublicShare,
  Baseline,
  CapturedScreenshot,
  StepComparisonEvidence,
  StepVerdict,
} from "../schema";
import { eq, and, desc, sql, isNotNull } from "drizzle-orm";
import { v4 as uuid } from "uuid";

export async function createPublicShare(
  data: Omit<NewPublicShare, "id" | "createdAt">,
): Promise<PublicShare> {
  const id = uuid();
  const createdAt = new Date();
  await db.insert(publicShares).values({ ...data, id, createdAt });
  const [row] = await db
    .select()
    .from(publicShares)
    .where(eq(publicShares.id, id));
  return row;
}

export async function getPublicShareBySlug(
  slug: string,
): Promise<PublicShare | undefined> {
  const [row] = await db
    .select()
    .from(publicShares)
    .where(eq(publicShares.slug, slug));
  return row;
}

export async function getPublicShareById(
  id: string,
): Promise<PublicShare | undefined> {
  const [row] = await db
    .select()
    .from(publicShares)
    .where(eq(publicShares.id, id));
  return row;
}

export async function listPublicSharesForBuild(
  buildId: string,
): Promise<PublicShare[]> {
  return db
    .select()
    .from(publicShares)
    .where(eq(publicShares.buildId, buildId))
    .orderBy(desc(publicShares.createdAt));
}

export async function listPublicSharesForTest(
  testId: string,
): Promise<PublicShare[]> {
  return db
    .select()
    .from(publicShares)
    .where(eq(publicShares.testId, testId))
    .orderBy(desc(publicShares.createdAt));
}

// Most recent live build-wide share for a build (testId IS NULL). Backs the
// "1 share per build" reuse rule — re-publishing a build returns this slug
// instead of minting a new one.
export async function getActiveBuildShare(
  buildId: string,
): Promise<PublicShare | undefined> {
  const [row] = await db
    .select()
    .from(publicShares)
    .where(
      and(
        eq(publicShares.buildId, buildId),
        eq(publicShares.status, "public"),
        sql`${publicShares.testId} IS NULL`,
      ),
    )
    .orderBy(desc(publicShares.createdAt))
    .limit(1);
  return row;
}

// Most recent live share scoped to a single test, across ALL builds. Backs the
// "1 stable URL per test" reuse rule — re-running a test produces a new build,
// but re-publishing returns this same slug (repointed at the fresh build) so the
// shared link never changes.
export async function getActiveTestShare(
  testId: string,
): Promise<PublicShare | undefined> {
  const [row] = await db
    .select()
    .from(publicShares)
    .where(
      and(eq(publicShares.testId, testId), eq(publicShares.status, "public")),
    )
    .orderBy(desc(publicShares.createdAt))
    .limit(1);
  return row;
}

// Repoint an existing share at a newer build and refresh its derived fields,
// keeping the same id/slug so the public URL is stable across re-runs.
export async function repointPublicShare(
  id: string,
  data: {
    buildId: string;
    targetDomain: string | null;
    publishedByUserId?: string | null;
  },
): Promise<PublicShare> {
  await db
    .update(publicShares)
    .set({
      buildId: data.buildId,
      targetDomain: data.targetDomain,
      ...(data.publishedByUserId
        ? { publishedByUserId: data.publishedByUserId }
        : {}),
    })
    .where(eq(publicShares.id, id));
  const [row] = await db
    .select()
    .from(publicShares)
    .where(eq(publicShares.id, id));
  return row;
}

// Sitemap input: every non-revoked share with its build timestamp for lastmod.
// Limited at the call site (sitemap.ts) to keep the XML under Google's 50k-URL
// cap; the share table is currently far below that ceiling but the limit makes
// the contract explicit.
//
// Video fields feed the <video:video> sitemap extension on /r/<slug> entries.
// Google requires the sitemap metadata to be CONSISTENT with the on-page
// VideoObject JSON-LD (title/thumbnail/contentUrl), so the fields mirror what
// the share page selects: the test-share's result video for the share's build
// run. Build shares (testId null) never join a video — same as the page,
// which only emits VideoObject markup for test shares.
export async function listPublicSharesForSitemap(limit = 5000): Promise<
  Array<{
    slug: string;
    updatedAt: Date | null;
    targetDomain: string | null;
    testName: string | null;
    changesDetected: number;
    videoPath: string | null;
    videoDurationMs: number | null;
  }>
> {
  const rows = await db
    .select({
      slug: publicShares.slug,
      buildCompletedAt: builds.completedAt,
      buildCreatedAt: builds.createdAt,
      shareCreatedAt: publicShares.createdAt,
      targetDomain: publicShares.targetDomain,
      testName: tests.name,
      changesDetected: builds.changesDetected,
      videoPath: testResults.videoPath,
      videoDurationMs: testResults.durationMs,
    })
    .from(publicShares)
    .leftJoin(builds, eq(publicShares.buildId, builds.id))
    .leftJoin(tests, eq(publicShares.testId, tests.id))
    .leftJoin(
      testResults,
      and(
        eq(testResults.testRunId, builds.testRunId),
        eq(testResults.testId, publicShares.testId),
        isNotNull(testResults.videoPath),
      ),
    )
    .where(eq(publicShares.status, "public"))
    .orderBy(desc(publicShares.createdAt))
    .limit(limit);
  // Retried runs can leave multiple results per (run, test) — keep the first
  // row per slug so each sitemap entry carries at most one video.
  const seen = new Set<string>();
  const out: Awaited<ReturnType<typeof listPublicSharesForSitemap>> = [];
  for (const r of rows) {
    if (seen.has(r.slug)) continue;
    seen.add(r.slug);
    out.push({
      slug: r.slug,
      updatedAt:
        r.buildCompletedAt ?? r.buildCreatedAt ?? r.shareCreatedAt ?? null,
      targetDomain: r.targetDomain,
      testName: r.testName,
      changesDetected: r.changesDetected ?? 0,
      videoPath: r.videoPath,
      videoDurationMs: r.videoDurationMs,
    });
  }
  return out;
}

export async function revokePublicShareById(id: string): Promise<void> {
  await db
    .update(publicShares)
    .set({ status: "revoked", revokedAt: new Date() })
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
    .where(
      and(
        eq(publicShares.slug, slug),
        sql`${publicShares.claimedByTeamId} IS NULL`,
      ),
    );
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

export async function getActiveBaselinesForTest(
  testId: string,
): Promise<Baseline[]> {
  return db
    .select()
    .from(baselines)
    .where(and(eq(baselines.testId, testId), eq(baselines.isActive, true)));
}

export async function getPublicShareContext(
  slug: string,
): Promise<PublicShareContext | null> {
  const share = await getPublicShareBySlug(slug);
  if (!share || share.status !== "public") return null;

  const [build] = await db
    .select()
    .from(builds)
    .where(eq(builds.id, share.buildId));
  if (!build) return null;

  const test = share.testId
    ? ((await db.select().from(tests).where(eq(tests.id, share.testId)))[0] ??
      null)
    : null;

  const testRun = build.testRunId
    ? ((
        await db.select().from(testRuns).where(eq(testRuns.id, build.testRunId))
      )[0] ?? null)
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

// Slim step-comparison projection for share rendering. Drops issue/reviewer
// metadata (GH issue link, confirmedBy, reviewerNote …) so only the verdict +
// layer-diff summaries cross the wire.
export type ShareStepComparison = {
  id: string;
  testId: string;
  stepLabel: string | null;
  stepIndex: number | null;
  verdict: StepVerdict;
  layers: StepComparisonEvidence;
};

export interface ShareData extends PublicShareContext {
  diffs: ShareVisualDiff[];
  results: ShareTestResult[];
  stepComparisons: ShareStepComparison[];
}

export async function getShareDataBySlug(
  slug: string,
): Promise<ShareData | null> {
  const ctx = await getPublicShareContext(slug);
  if (!ctx) return null;
  const { share, build } = ctx;

  const diffsWhere = share.testId
    ? and(
        eq(visualDiffs.buildId, build.id),
        eq(visualDiffs.testId, share.testId),
      )
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
            ? and(
                eq(testResults.testRunId, testRunId),
                eq(testResults.testId, share.testId),
              )
            : eq(testResults.testRunId, testRunId),
        )
    : Promise.resolve([]);

  const stepCmpWhere = share.testId
    ? and(
        eq(stepComparisons.buildId, build.id),
        eq(stepComparisons.testId, share.testId),
      )
    : eq(stepComparisons.buildId, build.id);

  const stepCmpQuery = db
    .select({
      id: stepComparisons.id,
      testId: stepComparisons.testId,
      stepLabel: stepComparisons.stepLabel,
      stepIndex: stepComparisons.stepIndex,
      verdict: stepComparisons.verdict,
      layers: stepComparisons.layers,
    })
    .from(stepComparisons)
    .where(stepCmpWhere);

  const [diffs, results, stepCmps] = await Promise.all([
    diffsQuery,
    resultsQuery,
    stepCmpQuery,
  ]);
  return { ...ctx, diffs, results, stepComparisons: stepCmps };
}
