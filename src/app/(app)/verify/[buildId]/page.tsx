import { notFound, redirect } from 'next/navigation';
import {
  getBuild,
  getBuildChangeMap,
  getTestRun,
  getRepository,
  getFunctionalAreasByRepo,
  getTestsByRepo,
} from '@/lib/db/queries';
import { getCurrentSession, requireRepoAccess } from '@/lib/auth';
import { isVerifyPhaseEnabled } from '@/lib/verify/feature-flag';
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

  // Frame-only data — fast lookups for the header chrome + drag/drop targets.
  // Heavy data (step_comparisons, layer feedback, visual_diffs, test_results,
  // change-map compute, crashed-build backfill) is deferred to the client's
  // first /verify-status fetch so the page renders the frame instantly.
  const [areas, tests, branches, changeMap] = await Promise.all([
    repo ? getFunctionalAreasByRepo(repo.id).catch(() => []) : Promise.resolve([]),
    repo ? getTestsByRepo(repo.id).catch(() => []) : Promise.resolve([]),
    repo ? fetchRepoBranches(repo.id).catch(() => []) : Promise.resolve([]),
    getBuildChangeMap(buildId).catch(() => null),
  ]);

  return (
    <BoardFocusClient
      build={build}
      branch={testRun?.gitBranch ?? null}
      changeMap={changeMap}
      stepComparisons={[]}
      areas={areas.map((a) => ({ id: a.id, name: a.name }))}
      tests={tests.map((t) => ({ id: t.id, name: t.name, functionalAreaId: t.functionalAreaId }))}
      layerFeedback={[]}
      visualDiffs={[]}
      testResults={[]}
      repositoryId={repo?.id ?? null}
      branches={branches.map((b) => b.name)}
      defaultBranch={repo?.defaultBranch ?? null}
    />
  );
}
