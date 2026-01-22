import { getSelectedRepository } from '@/lib/db/queries';
import { Sidebar } from './sidebar';

export async function SidebarServer() {
  const selectedRepo = await getSelectedRepository();
  const activeBranch = selectedRepo?.selectedBranch || selectedRepo?.defaultBranch || 'main';

  return <Sidebar activeBranch={activeBranch} />;
}
