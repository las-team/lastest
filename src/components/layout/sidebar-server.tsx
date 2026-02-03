import { getSelectedRepository, getRepositoriesByTeam, getTeam } from '@/lib/db/queries';
import { getCurrentSession } from '@/lib/auth';
import { Sidebar } from './sidebar';

export async function SidebarServer() {
  const session = await getCurrentSession();

  if (!session) {
    return <Sidebar repos={[]} selectedRepo={null} currentUser={null} team={null} />;
  }

  const teamId = session.team?.id;

  const [selectedRepo, repos] = await Promise.all([
    teamId ? getSelectedRepository(teamId) : Promise.resolve(null),
    teamId ? getRepositoriesByTeam(teamId) : Promise.resolve([]),
  ]);

  return (
    <Sidebar
      repos={repos}
      selectedRepo={selectedRepo ?? null}
      currentUser={session.user}
      team={session.team}
    />
  );
}
