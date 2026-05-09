import { Suspense } from 'react';
import {
  getSelectedRepository,
  getRepositoriesByTeamWithTestCounts,
  getReviewTodosByBranch,
  getLastBuildByBranch,
  getStepComparisonsByBuild,
} from '@/lib/db/queries';
import { getCurrentSession } from '@/lib/auth';
import { syncReposIfStale } from '@/server/actions/repos';
import { getEnvironmentConfig } from '@/server/actions/environment';
import { listSystemEmbeddedSessions } from '@/server/actions/embedded-sessions';
import { isVerifyPhaseEnabled } from '@/lib/verify/feature-flag';
import { Sidebar } from './sidebar';

export async function SidebarServer() {
  const session = await getCurrentSession();

  if (!session) {
    return (
      <Suspense>
        <Sidebar repos={[]} selectedRepo={null} currentUser={null} team={null} />
      </Suspense>
    );
  }

  const teamId = session.team?.id;
  const userId = session.user?.id;

  // Fire-and-forget: sync repos if stale (don't block render)
  if (teamId) {
    syncReposIfStale(teamId).catch(() => {});
  }

  const [selectedRepo, repos, ebSessions] = await Promise.all([
    teamId ? getSelectedRepository(userId, teamId) : Promise.resolve(null),
    teamId ? getRepositoriesByTeamWithTestCounts(teamId) : Promise.resolve([]),
    listSystemEmbeddedSessions().catch(() => []),
  ]);

  const envConfig = await getEnvironmentConfig(selectedRepo?.id).catch(() => null);

  // Verify-phase notification count: red verdicts on the latest build of the
  // active branch + open review todos. Fetched best-effort; failures → 0.
  const verifyPendingCount = isVerifyPhaseEnabled(session.team) && selectedRepo
    ? await computeVerifyPendingCount(selectedRepo.id, selectedRepo.selectedBranch || selectedRepo.defaultBranch || 'main').catch(() => 0)
    : 0;

  return (
    <Suspense>
      <Sidebar
        repos={repos}
        selectedRepo={selectedRepo ?? null}
        currentUser={session.user}
        team={session.team}
        baseUrl={envConfig?.baseUrl ?? ''}
        repositoryId={selectedRepo?.id}
        ebSessions={ebSessions}
        verifyPendingCount={verifyPendingCount}
      />
    </Suspense>
  );
}

async function computeVerifyPendingCount(repoId: string, branch: string): Promise<number> {
  const [todos, latestBuild] = await Promise.all([
    getReviewTodosByBranch(repoId, branch).catch(() => []),
    getLastBuildByBranch(repoId, branch).catch(() => null),
  ]);
  const openTodos = todos.filter((t) => t.todo.status === 'open').length;
  let redVerdicts = 0;
  if (latestBuild) {
    const steps = await getStepComparisonsByBuild(latestBuild.id).catch(() => []);
    redVerdicts = steps.filter((s) => s.verdict === 'red').length;
  }
  return openTodos + redVerdicts;
}
