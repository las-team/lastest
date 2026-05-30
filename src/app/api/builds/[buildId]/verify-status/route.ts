import { NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/auth';
import * as queries from '@/lib/db/queries';
import { ensureStepComparisonsForBuild } from '@/lib/verify/backfill-step-comparisons';
import { computeChangeMap } from '@/server/actions/change-map';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ buildId: string }> },
) {
  const session = await getCurrentSession();
  if (!session?.team) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const teamId = session.team.id;

  const { buildId } = await params;
  const build = await queries.getBuild(buildId);
  if (!build) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Authorize via the build's repo and remember repoId for downstream
  // lookups (playwright settings).
  let repoId: string | null = null;
  if (build.testRunId) {
    const run = await queries.getTestRun(build.testRunId);
    if (run?.repositoryId) {
      const repo = await queries.getRepository(run.repositoryId);
      if (!repo || repo.teamId !== teamId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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
  ]);

  let stepComparisons = initialStepComparisons;
  if (
    build.testRunId
    && build.completedAt
    && stepComparisons.length === 0
    && runningTestRows.length > 0
  ) {
    await ensureStepComparisonsForBuild(buildId).catch((err) => {
      console.error('[verify-status] backfill failed:', err);
    });
    stepComparisons = await queries.getStepComparisonsByBuild(buildId).catch(() => []);
  }

  const changeMap = cachedChangeMap
    ?? (await computeChangeMap(buildId).catch(() => null));

  const slimDiffs = visualDiffs.map((d) => {
    const meta = d.metadata as import('@/lib/db/schema').DiffMetadata | null;
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
    a11yViolations: r.a11yViolations,
    a11yPassesCount: r.a11yPassesCount,
    designSystemViolations: r.designSystemViolations,
    designSystemRulesChecked: r.designSystemRulesChecked,
    urlTrajectory: r.urlTrajectory,
    webVitals: r.webVitals,
    extractedVariables: r.extractedVariables,
    assignedVariables: r.assignedVariables,
    domSnapshot: r.domSnapshot,
  }));

  // "running tests" = test_results in 'running' status without an end timestamp.
  // Used to show in-flight cards on the verify board.
  const runningTests = runningTestRows
    .filter((r) => r.status === 'running')
    .map((r) => ({ testId: r.testId, name: r.testId }));

  // Error-mode toggles drive the focus view's network/console tab "broken vs
  // warn vs ignore" treatment so the red X pill matches what the runner
  // actually does when it sees a network 4xx / console error.
  //
  // Per-test playwrightOverrides take precedence over the repo defaults — the
  // executor already uses them at run time, so the UI must match or the panel
  // will mislabel passing/failing layers for tests that opted out.
  const distinctTestIds = Array.from(new Set(runningTestRows.map((r) => r.testId).filter((id): id is string => !!id)));
  const perTestOverrides = distinctTestIds.length > 0
    ? await queries.getPlaywrightOverridesByTestIds(distinctTestIds).catch(() => [])
    : [];
  const byTestId: Record<string, { network?: 'fail' | 'warn' | 'ignore'; console?: 'fail' | 'warn' | 'ignore' }> = {};
  for (const t of perTestOverrides) {
    const o = t.playwrightOverrides;
    if (!o) continue;
    const network = o.networkErrorMode;
    const cons = o.consoleErrorMode;
    if (network || cons) byTestId[t.id] = { network, console: cons };
  }
  const errorModes = {
    network: (pwSettings?.networkErrorMode as 'fail' | 'warn' | 'ignore') ?? 'fail',
    console: (pwSettings?.consoleErrorMode as 'fail' | 'warn' | 'ignore') ?? 'fail',
    byTestId,
  };

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
      errorModes,
    },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    },
  );
}
