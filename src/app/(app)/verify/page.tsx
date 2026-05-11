import { redirect } from 'next/navigation';
import { getSelectedRepository, getLastBuildByBranch } from '@/lib/db/queries';
import { getCurrentSession } from '@/lib/auth';
import { isVerifyPhaseEnabled } from '@/lib/verify/feature-flag';
import { fetchRepoBranches } from '@/server/actions/repos';
import { VerifyIndexClient } from './verify-index-client';

export const dynamic = 'force-dynamic';

export default async function VerifyPage() {
  const session = await getCurrentSession();
  // The flag check happens before any other awaits — when off, redirect cleanly.
  if (!isVerifyPhaseEnabled(session?.team)) {
    redirect('/run');
  }

  const teamId = session?.team?.id;
  const userId = session?.user?.id;
  const selectedRepo = teamId ? await getSelectedRepository(userId, teamId) : null;

  let latestBuildId: string | null = null;
  let activeBranch: string | null = null;
  let branches: string[] = [];
  if (selectedRepo) {
    activeBranch = selectedRepo.selectedBranch || selectedRepo.defaultBranch || 'main';
    const [latestBuild, branchList] = await Promise.all([
      getLastBuildByBranch(selectedRepo.id, activeBranch).catch(() => null),
      fetchRepoBranches(selectedRepo.id).catch(() => []),
    ]);
    latestBuildId = latestBuild?.id ?? null;
    branches = branchList.map((b) => b.name);
  }

  // Always render the same JSX shape from this server component. The client
  // component decides whether to navigate or show an empty state — keeping
  // navigation off the server side avoids a Turbopack 16.1.3 perf-measure
  // glitch with redirect()-after-await on this route.
  return (
    <VerifyIndexClient
      hasRepo={!!selectedRepo}
      repositoryId={selectedRepo?.id ?? null}
      activeBranch={activeBranch}
      defaultBranch={selectedRepo?.defaultBranch ?? null}
      branches={branches}
      latestBuildId={latestBuildId}
    />
  );
}
