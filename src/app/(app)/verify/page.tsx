import { redirect } from 'next/navigation';
import { getSelectedRepository, getLastBuildByBranch } from '@/lib/db/queries';
import { getCurrentSession } from '@/lib/auth';
import { isVerifyPhaseEnabled } from '@/lib/verify/feature-flag';
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
  if (selectedRepo) {
    activeBranch = selectedRepo.selectedBranch || selectedRepo.defaultBranch || 'main';
    const latestBuild = await getLastBuildByBranch(selectedRepo.id, activeBranch).catch(() => null);
    latestBuildId = latestBuild?.id ?? null;
  }

  // Always render the same JSX shape from this server component. The client
  // component decides whether to navigate or show an empty state — keeping
  // navigation off the server side avoids a Turbopack 16.1.3 perf-measure
  // glitch with redirect()-after-await on this route.
  return (
    <VerifyIndexClient
      hasRepo={!!selectedRepo}
      activeBranch={activeBranch}
      latestBuildId={latestBuildId}
    />
  );
}
