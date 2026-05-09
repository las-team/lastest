import { redirect } from 'next/navigation';
import {
  getSelectedRepository,
  getLastBuildByBranch,
  getBuildChangeMap,
  countStepComparisonVerdicts,
} from '@/lib/db/queries';
import { getBuildsByRepo } from '@/server/actions/builds';
import { getCurrentSession } from '@/lib/auth';
import { isVerifyPhaseEnabled } from '@/lib/verify/feature-flag';
import { VerifyDashboardClient } from './verify-dashboard-client';

export const dynamic = 'force-dynamic';

export default async function VerifyPage() {
  const session = await getCurrentSession();
  if (!isVerifyPhaseEnabled(session?.team)) {
    // Feature flag off — keep /run as the primary surface during rollout.
    redirect('/run');
  }

  const teamId = session?.team?.id;
  const userId = session?.user?.id;
  const selectedRepo = teamId ? await getSelectedRepository(userId, teamId) : null;

  if (!selectedRepo) {
    return <VerifyDashboardClient repositoryId={null} activeBranch={null} buildLanes={null} baselineBuild={null} />;
  }

  const activeBranch = selectedRepo.selectedBranch || selectedRepo.defaultBranch || 'main';
  const [builds, baselineBuild] = await Promise.all([
    getBuildsByRepo(selectedRepo.id, 30),
    getLastBuildByBranch(selectedRepo.id, activeBranch),
  ]);

  // Pull verdict counts + change-map summaries in parallel for the cards.
  const enriched = await Promise.all(builds.map(async (b) => {
    const [verdictCounts, changeMap] = await Promise.all([
      countStepComparisonVerdicts(b.id).catch(() => ({ green: 0, yellow: 0, red: 0 })),
      getBuildChangeMap(b.id).catch(() => null),
    ]);
    return {
      build: b,
      verdictCounts,
      changeMap,
    };
  }));

  // Three lanes: awaiting / in-progress / verified.
  const buildLanes = {
    awaiting: enriched.filter((e) =>
      e.build.overallStatus === 'review_required' ||
      e.build.overallStatus === 'has_todos'
    ),
    inProgress: enriched.filter((e) => e.build.overallStatus === 'blocked'),
    verified: enriched.filter((e) => e.build.overallStatus === 'safe_to_merge').slice(0, 50),
  };

  return (
    <VerifyDashboardClient
      repositoryId={selectedRepo.id}
      activeBranch={activeBranch}
      buildLanes={buildLanes}
      baselineBuild={baselineBuild ?? null}
    />
  );
}
