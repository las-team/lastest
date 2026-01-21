import { getGitInfo } from '@/lib/git/utils';
import { Sidebar } from './sidebar';

export async function SidebarServer() {
  const gitInfo = await getGitInfo();

  return <Sidebar activeBranch={gitInfo.branch} />;
}
