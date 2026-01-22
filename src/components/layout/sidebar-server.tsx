import { getGitInfo } from '@/lib/git/utils';
import { getSelectedRepository } from '@/lib/db/queries';
import { Sidebar } from './sidebar';

export async function SidebarServer() {
  const selectedRepo = await getSelectedRepository();
  const repoPath = selectedRepo?.localPath || undefined;
  const gitInfo = await getGitInfo(repoPath);

  return <Sidebar activeBranch={gitInfo.branch} />;
}
