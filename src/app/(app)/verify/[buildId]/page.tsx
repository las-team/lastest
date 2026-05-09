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
} from '@/lib/db/queries';
import { getCurrentSession, requireRepoAccess } from '@/lib/auth';
import { isVerifyPhaseEnabled } from '@/lib/verify/feature-flag';
import { computeChangeMap } from '@/server/actions/change-map';
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

  // Compute change-map on demand if missing (older builds).
  let changeMap = await getBuildChangeMap(buildId);
  if (!changeMap) {
    changeMap = await computeChangeMap(buildId).catch(() => null);
  }

  const [stepComparisons, areas, tests, layerFeedback] = await Promise.all([
    getStepComparisonsByBuild(buildId),
    repo ? getFunctionalAreasByRepo(repo.id) : Promise.resolve([]),
    repo ? getTestsByRepo(repo.id) : Promise.resolve([]),
    getLayerFeedbackByBuild(buildId),
  ]);

  return (
    <BoardFocusClient
      build={build}
      branch={testRun?.gitBranch ?? null}
      changeMap={changeMap}
      stepComparisons={stepComparisons}
      areas={areas.map((a) => ({ id: a.id, name: a.name }))}
      tests={tests.map((t) => ({ id: t.id, name: t.name, functionalAreaId: t.functionalAreaId }))}
      layerFeedback={layerFeedback}
      repositoryId={repo?.id ?? null}
    />
  );
}
