import { getSelectedRepository, getRepositories } from '@/lib/db/queries';
import { Sidebar } from './sidebar';

export async function SidebarServer() {
  const [selectedRepo, repos] = await Promise.all([
    getSelectedRepository(),
    getRepositories(),
  ]);
  const activeBranch = selectedRepo?.selectedBranch || selectedRepo?.defaultBranch || 'main';

  return <Sidebar activeBranch={activeBranch} repos={repos} selectedRepo={selectedRepo ?? null} />;
}
