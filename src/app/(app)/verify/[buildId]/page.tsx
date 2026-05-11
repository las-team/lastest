import { notFound, redirect } from 'next/navigation';
import {
  getBuild,
  getBuildChangeMap,
  getStepComparisonsByBuild,
  getTestRun,
  getRepository,
  getFunctionalAreasByRepo,
  getTestsByRepo,
  getLayerFeedbackByBuild,
  getVisualDiffsByBuild,
  getTestResultsByRun,
} from '@/lib/db/queries';
import { getCurrentSession, requireRepoAccess } from '@/lib/auth';
import { isVerifyPhaseEnabled } from '@/lib/verify/feature-flag';
import { ensureStepComparisonsForBuild } from '@/lib/verify/backfill-step-comparisons';
import { computeChangeMap } from '@/server/actions/change-map';
import { fetchRepoBranches } from '@/server/actions/repos';
import { BoardFocusClient } from './board-focus-client';

export const dynamic = 'force-dynamic';

interface VerifyBuildPageProps {
  params: Promise<{ buildId: string }>;
}

export default async function VerifyBuildPage({ params }: VerifyBuildPageProps) {
  const { buildId } = await params;
  const session = await getCurrentSession();
  if (!isVerifyPhaseEnabled(session?.team)) {
    redirect(`/builds/${buildId}`);
  }

  const build = await getBuild(buildId);
  if (!build) notFound();

  const testRun = build.testRunId ? await getTestRun(build.testRunId) : null;
  const repo = testRun?.repositoryId ? await getRepository(testRun.repositoryId) : null;
  if (repo) await requireRepoAccess(repo.id);

  // Compute change-map on demand if missing (older builds). Best-effort.
  let changeMap = await getBuildChangeMap(buildId).catch(() => null);
  if (!changeMap) {
    changeMap = await computeChangeMap(buildId).catch(() => null);
  }

  // Recovery path: builds that crashed mid-execution (overall_status='blocked')
  // can land test_results without their per-result step_comparison rows. The
  // verify board renders cases from step_comparisons, so without these the
  // page is blank. Backfill on demand from already-persisted test_results +
  // visual_diffs. Idempotent — no-op when step_comparisons is already
  // populated.
  if (build.testRunId) {
    await ensureStepComparisonsForBuild(buildId).catch((err) => {
      console.error('[verify] backfill step_comparisons failed:', err);
    });
  }

  const [stepComparisons, areas, tests, layerFeedback, visualDiffs, branches, testResults] = await Promise.all([
    getStepComparisonsByBuild(buildId).catch(() => []),
    repo ? getFunctionalAreasByRepo(repo.id).catch(() => []) : Promise.resolve([]),
    repo ? getTestsByRepo(repo.id).catch(() => []) : Promise.resolve([]),
    getLayerFeedbackByBuild(buildId).catch(() => []),
    getVisualDiffsByBuild(buildId).catch(() => []),
    repo ? fetchRepoBranches(repo.id).catch(() => []) : Promise.resolve([]),
    build.testRunId ? getTestResultsByRun(build.testRunId).catch(() => []) : Promise.resolve([]),
  ]);

  // Slim test results down to just the per-layer capture data the verify
  // page needs to render real data even when there's no diff. The compare
  // panes can then show "captured, no diff" for layers whose source field
  // is non-null on the test result, and "not captured" otherwise.
  const slimResults = testResults.map((r) => ({
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

  // Slim visualDiffs to just what the client renders (image paths + diff
  // stats + DOM diff + region rects from metadata).
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

  return (
    <BoardFocusClient
      build={build}
      branch={testRun?.gitBranch ?? null}
      changeMap={changeMap}
      stepComparisons={stepComparisons}
      areas={areas.map((a) => ({ id: a.id, name: a.name }))}
      tests={tests.map((t) => ({ id: t.id, name: t.name, functionalAreaId: t.functionalAreaId }))}
      layerFeedback={layerFeedback}
      visualDiffs={slimDiffs}
      testResults={slimResults}
      repositoryId={repo?.id ?? null}
      branches={branches.map((b) => b.name)}
      defaultBranch={repo?.defaultBranch ?? null}
    />
  );
}
