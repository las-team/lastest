import { Suspense } from 'react';
import { getSelectedRepository, getRepositoriesByTeam } from '@/lib/db/queries';
import { getCurrentSession } from '@/lib/auth';
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

  const [selectedRepo, repos] = await Promise.all([
    teamId ? getSelectedRepository(userId, teamId) : Promise.resolve(null),
    teamId ? getRepositoriesByTeam(teamId) : Promise.resolve([]),
  ]);

  return (
    <Suspense>
      <Sidebar
        repos={repos}
        selectedRepo={selectedRepo ?? null}
        currentUser={session.user}
        team={session.team}
      />
    </Suspense>
  );
}
