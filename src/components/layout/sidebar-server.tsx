import { getSelectedRepository, getRepositories } from '@/lib/db/queries';
import { getCurrentUser } from '@/lib/auth';
import { Sidebar } from './sidebar';

export async function SidebarServer() {
  const [selectedRepo, repos, currentUser] = await Promise.all([
    getSelectedRepository(),
    getRepositories(),
    getCurrentUser(),
  ]);

  return (
    <Sidebar
      repos={repos}
      selectedRepo={selectedRepo ?? null}
      currentUser={currentUser}
    />
  );
}
