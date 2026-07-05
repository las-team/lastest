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
  PublicShareKind,
  Baseline,
  CapturedScreenshot,
  DomDiffResult,
  StepComparisonEvidence,
  StepVerdict,
  WebVitalsSample,
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
    // Preserve/refresh the share kind on repoint. QuickStart re-runs repoint an
    // existing test-scoped share at the fresh build, so a demo share must stay a
    // demo share across re-publishes; omit to leave the stored value untouched.
    kind?: PublicShareKind;
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
      ...(data.kind ? { kind: data.kind } : {}),
    })
    .where(eq(publicShares.id, id));
  const [row] = await db
    .select()
    .from(publicShares)
    .where(eq(publicShares.id, id));
  return row;
}

// Sitemap input: one entry per indexable PER-TEST share (testId not null),
// deduped to the most recent live share per test. Build-wide shares (testId
// null) are EXCLUDED — they're noindex'd on the page to avoid duplicate-content
// competition with their per-test share, so listing them here would contradict
// the robots tag (Search Console "Submitted URL marked noindex"). Limited at
// the call site (sitemap.ts) to keep the XML under Google's 50k-URL cap.
//
// Video fields feed the <video:video> sitemap extension on /r/<slug> entries.
// Google requires the sitemap metadata to be CONSISTENT with the on-page
// VideoObject JSON-LD (title/thumbnail/contentUrl), so the fields mirror what
// the share page selects: the test-share's result video for the share's build
// run.
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
      testId: publicShares.testId,
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
    .where(
      and(eq(publicShares.status, "public"), isNotNull(publicShares.testId)),
    )
    .orderBy(desc(publicShares.createdAt))
    .limit(limit);
  // Two-level dedup, rows are createdAt-desc:
  //  - per slug: retried runs leave multiple results per (run, test) — keep the
  //    first row per slug so each sitemap entry carries at most one video.
  //  - per test: a test may carry multiple public share rows (legacy links
  //    minted before the 1-share-per-test reuse rule). Keep only the most
  //    recent share per test so each test contributes exactly one sitemap URL.
  const seenSlug = new Set<string>();
  const seenTest = new Set<string>();
  const out: Awaited<ReturnType<typeof listPublicSharesForSitemap>> = [];
  for (const r of rows) {
    if (seenSlug.has(r.slug)) continue;
    seenSlug.add(r.slug);
    if (r.testId) {
      if (seenTest.has(r.testId)) continue;
      seenTest.add(r.testId);
    }
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

// Aggregate numbers for the share page's social-proof strip. Distinct target
// domains stand in for "products tested"; total persisted test results stand
// in for "test runs". Both are platform-wide on purpose — the strip's job is
// to show a cold visitor that Lastest is alive, not to describe this share.
export async function getPublicShareStats(): Promise<{
  productsTested: number;
  testRunsCompleted: number;
}> {
  const [products, runs] = await Promise.all([
    db
      .select({
        n: sql<number>`COUNT(DISTINCT ${publicShares.targetDomain})::int`,
      })
      .from(publicShares)
      .where(
        and(
          eq(publicShares.status, "public"),
          isNotNull(publicShares.targetDomain),
        ),
      ),
    db.select({ n: sql<number>`COUNT(*)::int` }).from(testResults),
  ]);
  return {
    productsTested: products[0]?.n ?? 0,
    testRunsCompleted: runs[0]?.n ?? 0,
  };
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

/**
 * Resolve which build a share renders. Test-scoped shares auto-follow the
 * latest completed build that actually ran the test, so re-running the test
 * surfaces on the existing /r/<slug> without a manual republish —
 * share.buildId is just the initial anchor. Build-wide shares (share.testId
 * null) stay pinned to their immutable snapshot. See publishBuildShare() for
 * the matching intent.
 *
 * SINGLE SOURCE OF TRUTH: the share page (getPublicShareContext) AND the
 * /share/<slug>/<path> media route must resolve the SAME build, or the page
 * emits image URLs that the media allow-list rejects with 404.
 */
export async function resolveShareBuild(
  share: Pick<PublicShare, "testId" | "buildId">,
): Promise<typeof builds.$inferSelect | null> {
  if (share.testId) {
    const [latest] = await db
      .select({ build: builds })
      .from(builds)
      .innerJoin(testRuns, eq(builds.testRunId, testRuns.id))
      .innerJoin(testResults, eq(testResults.testRunId, testRuns.id))
      .where(
        and(
          eq(testResults.testId, share.testId),
          isNotNull(builds.completedAt),
        ),
      )
      .orderBy(desc(builds.createdAt))
      .limit(1);
    if (latest?.build) return latest.build;
  }
  // Fallback: build-wide shares, or a test-scoped share whose test has no
  // surviving completed run — render the originally-pinned build.
  const [pinned] = await db
    .select()
    .from(builds)
    .where(eq(builds.id, share.buildId));
  return pinned ?? null;
}

export async function getPublicShareContext(
  slug: string,
): Promise<PublicShareContext | null> {
  const share = await getPublicShareBySlug(slug);
  if (!share || share.status !== "public") return null;

  const build = await resolveShareBuild(share);
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
  // Legacy DOM-diff location: builds.ts writes the DOM diff into
  // visual_diff.metadata.domDiff (the multi-layer scorer's step_comparisons
  // .layers.dom is the newer home). The share page's DOM overlay falls back to
  // this when layers.dom is absent — mirrors Verify's `layers?.dom ?? domDiff`.
  domDiff: DomDiffResult | null;
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
  webVitals: WebVitalsSample[] | null;
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
      // Pull only the domDiff sub-object out of metadata (the rest — aiAnalysis,
      // GH links — would bloat the payload and the share page never reads it).
      domDiff: sql<DomDiffResult | null>`${visualDiffs.metadata}->'domDiff'`,
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
          webVitals: testResults.webVitals,
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
