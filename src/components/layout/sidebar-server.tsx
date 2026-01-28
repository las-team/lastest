import { getSelectedRepository, getRepositories } from '@/lib/db/queries';
import { Sidebar } from './sidebar';

export async function SidebarServer() {
  const [selectedRepo, repos] = await Promise.all([
    getSelectedRepository(),
    getRepositories(),
  ]);

  return <Sidebar repos={repos} selectedRepo={selectedRepo ?? null} />;
}
