import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import * as queries from "@/lib/db/queries";
import { ensureStepComparisonsForBuild } from "@/lib/verify/backfill-step-comparisons";
import { computeChangeMap } from "@/lib/change-map/compute";
import {
  deriveCheckModes,
  pickTestModeOverrides,
  type CheckModeMap,
} from "@/lib/verify/check-modes";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ buildId: string }> },
) {
  const session = await getCurrentSession();
  if (!session?.team) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const teamId = session.team.id;

  const { buildId } = await params;
  const build = await queries.getBuild(buildId);
  if (!build) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Authorize via the build's repo and remember repoId for downstream
  // lookups (playwright settings).
  let repoId: string | null = null;
  if (build.testRunId) {
    const run = await queries.getTestRun(build.testRunId);
    if (run?.repositoryId) {
      const repo = await queries.getRepository(run.repositoryId);
      if (!repo || repo.teamId !== teamId) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      repoId = run.repositoryId;
    }
  }

  // Run recovery + change-map compute lazily on the first call that needs
  // them. Both are idempotent: backfill is a no-op once step_comparisons
  // exist, and getBuildChangeMap returns the cached row on subsequent polls
  // so computeChangeMap doesn't re-fire. Page chrome still rendered while
  // we were on the way here.
  const [
    initialStepComparisons,
    layerFeedback,
    visualDiffs,
    runningTestRows,
    cachedChangeMap,
    pwSettings,
    diffSettings,
  ] = await Promise.all([
    queries.getStepComparisonsByBuild(buildId).catch(() => []),
    queries.getLayerFeedbackByBuild(buildId).catch(() => []),
    queries.getVisualDiffsByBuild(buildId).catch(() => []),
    build.testRunId
      ? queries.getTestResultsByRun(build.testRunId).catch(() => [])
      : Promise.resolve([]),
    queries.getBuildChangeMap(buildId).catch(() => null),
    // Repo-level playwright settings drive the network / console error mode
    // hint pills in the focus view. Per-test overrides exist but are rare;
    // the focus view is OK with the repo-level value here.
    queries.getPlaywrightSettings(repoId).catch(() => null),
    // text-diff capture toggle lives on the diff_sensitivity_settings table
    // (legacy textDiffEnabled). Pulled here so the cogwheel modal hydrates
    // the Text layer's mode without a second fetch from the client.
    queries.getDiffSensitivitySettings(repoId).catch(() => null),
  ] as const);

  let stepComparisons = initialStepComparisons;
  if (
    build.testRunId &&
    build.completedAt &&
    stepComparisons.length === 0 &&
    runningTestRows.length > 0
  ) {
    await ensureStepComparisonsForBuild(buildId).catch((err) => {
      console.error("[verify-status] backfill failed:", err);
    });
    stepComparisons = await queries
      .getStepComparisonsByBuild(buildId)
      .catch(() => []);
  }

  const changeMap =
    cachedChangeMap ?? (await computeChangeMap(buildId).catch(() => null));

  const slimDiffs = visualDiffs.map((d) => {
    const meta = d.metadata as import("@/lib/db/schema").DiffMetadata | null;
    return {
      id: d.id,
      testId: d.testId,
      stepLabel: d.stepLabel,
      baselineImagePath: d.baselineImagePath,
      currentImagePath: d.currentImagePath,
      diffImagePath: d.diffImagePath,
      pixelDifference: d.pixelDifference,
      percentageDifference: d.percentageDifference,
      classification: d.classification,
      domDiff: meta?.domDiff ?? null,
      changedRegions: meta?.changedRegions ?? null,
      textDiffStatus: d.textDiffStatus,
      baselineTextPath: d.baselineTextPath,
      currentTextPath: d.currentTextPath,
      textDiffSummary: meta?.textDiffSummary ?? null,
      baselineSourceBranch: meta?.baselineSourceBranch ?? null,
      baselineExistsOn: meta?.baselineExistsOn ?? null,
    };
  });

  const slimResults = runningTestRows.map((r) => ({
    id: r.id,
    testId: r.testId,
    status: r.status,
    errorMessage: r.errorMessage,
    durationMs: r.durationMs,
    browser: r.browser,
    isFlaky: r.isFlaky,
    retryOf: r.retryOf,
    lastReachedStep: r.lastReachedStep,
    totalSteps: r.totalSteps,
    consoleErrors: r.consoleErrors,
    networkRequests: r.networkRequests,
    networkBodiesPath: r.networkBodiesPath,
    a11yViolations: r.a11yViolations,
    a11yPassesCount: r.a11yPassesCount,
    designSystemViolations: r.designSystemViolations,
    designSystemRulesChecked: r.designSystemRulesChecked,
    urlTrajectory: r.urlTrajectory,
    webVitals: r.webVitals,
    extractedVariables: r.extractedVariables,
    assignedVariables: r.assignedVariables,
    domSnapshot: r.domSnapshot,
    apiResult: r.apiResult,
    loadResult: r.loadResult,
  }));

  // "running tests" = test_results in 'running' status without an end timestamp.
  // Used to show in-flight cards on the verify board.
  const runningTests = runningTestRows
    .filter((r) => r.status === "running")
    .map((r) => ({ testId: r.testId, name: r.testId }));

  // Per-check 3-way modes drive the focus toolbar's broken/warn/clean pills
  // for every layer (visual, text, dom, network, console, a11y, design,
  // perf, url). Derived from the repo's playwright_settings + diff
  // sensitivity settings so the panel agrees with whatever the executor
  // saw at run time.
  //
  // Per-test playwrightOverrides take precedence for any layer they touch —
  // the executor already uses them at run time, so the UI must match or
  // the panel will mislabel passing/failing layers for tests that opted
  // out.
  const checkModes: CheckModeMap = deriveCheckModes({
    ...(pwSettings ?? {}),
    textDiffEnabled: diffSettings?.textDiffEnabled ?? null,
  });

  const distinctTestIds = Array.from(
    new Set(
      runningTestRows.map((r) => r.testId).filter((id): id is string => !!id),
    ),
  );
  const perTestOverrides =
    distinctTestIds.length > 0
      ? await queries
          .getPlaywrightOverridesByTestIds(distinctTestIds)
          .catch(() => [])
      : [];
  const checkModesByTestId: Record<string, Partial<CheckModeMap>> = {};
  for (const t of perTestOverrides) {
    const partial = pickTestModeOverrides(t.playwrightOverrides ?? null);
    if (partial) checkModesByTestId[t.id] = partial;
  }

  return NextResponse.json(
    {
      buildId,
      completedAt: build.completedAt ? build.completedAt.toISOString() : null,
      overallStatus: build.overallStatus,
      totalTests: build.totalTests ?? 0,
      passedCount: build.passedCount ?? 0,
      failedCount: build.failedCount ?? 0,
      changesDetected: build.changesDetected ?? 0,
      stepComparisons,
      layerFeedback,
      visualDiffs: slimDiffs,
      testResults: slimResults,
      runningTests,
      changeMap,
      // Per-layer mode shape consumed by the Verify cogwheel modal +
      // toolbar pills. `checkModes` is the repo-level default; `byTestId`
      // carries per-test overrides (sparse — only the layers the test
      // chose to override).
      checkModes,
      checkModesByTestId,
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    },
  );
}
