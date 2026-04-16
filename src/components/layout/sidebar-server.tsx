import { Suspense } from 'react';
import { getSelectedRepository, getRepositoriesByTeam } from '@/lib/db/queries';
import { getCurrentSession } from '@/lib/auth';
import { syncReposIfStale } from '@/server/actions/repos';
import { getEnvironmentConfig } from '@/server/actions/environment';
import { listSystemEmbeddedSessions } from '@/server/actions/embedded-sessions';
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
    teamId ? getRepositoriesByTeam(teamId) : Promise.resolve([]),
    listSystemEmbeddedSessions().catch(() => []),
  ]);

  const envConfig = await getEnvironmentConfig(selectedRepo?.id).catch(() => null);

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
      />
    </Suspense>
  );
}
