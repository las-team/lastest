import { notFound, redirect } from 'next/navigation';
import {
  getBuild,
  getBuildChangeMap,
  getStepComparisonsByBuild,
  getTestRun,
  getRepository,
  getFunctionalAreasByRepo,
  getTestsByRepo,
  countStepComparisonVerdicts,
  getLayerFeedbackByBuild,
} from '@/lib/db/queries';
import { getCurrentSession, requireRepoAccess } from '@/lib/auth';
import { isVerifyPhaseEnabled } from '@/lib/verify/feature-flag';
import { computeChangeMap } from '@/server/actions/change-map';
import { VerifyBuildClient } from './verify-build-client';

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

  const [stepComparisons, areas, tests, verdictCounts, layerFeedback] = await Promise.all([
    getStepComparisonsByBuild(buildId),
    repo ? getFunctionalAreasByRepo(repo.id) : Promise.resolve([]),
    repo ? getTestsByRepo(repo.id) : Promise.resolve([]),
    countStepComparisonVerdicts(buildId),
    getLayerFeedbackByBuild(buildId),
  ]);

  return (
    <VerifyBuildClient
      build={build}
      branch={testRun?.gitBranch ?? null}
      changeMap={changeMap}
      stepComparisons={stepComparisons}
      areas={areas.map((a) => ({ id: a.id, name: a.name, parentId: a.parentId }))}
      tests={tests.map((t) => ({ id: t.id, name: t.name, functionalAreaId: t.functionalAreaId }))}
      verdictCounts={verdictCounts}
      layerFeedback={layerFeedback}
    />
  );
}
