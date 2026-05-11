import { NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/auth';
import * as queries from '@/lib/db/queries';

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

  // Authorize via the build's repo.
  if (build.testRunId) {
    const run = await queries.getTestRun(build.testRunId);
    if (run?.repositoryId) {
      const repo = await queries.getRepository(run.repositoryId);
      if (!repo || repo.teamId !== teamId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }
  }

  const [stepComparisons, layerFeedback, visualDiffs, runningTestRows] = await Promise.all([
    queries.getStepComparisonsByBuild(buildId).catch(() => []),
    queries.getLayerFeedbackByBuild(buildId).catch(() => []),
    queries.getVisualDiffsByBuild(buildId).catch(() => []),
    // Use the same running-tests source as the existing build summary.
    build.testRunId
      ? queries.getTestResultsByRun(build.testRunId).catch(() => [])
      : Promise.resolve([]),
  ]);

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
    },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    },
  );
}
