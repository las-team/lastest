import { notFound } from 'next/navigation';
import { getBuildSummary, getRecentBuildsByRepo } from '@/server/actions/builds';
import { getSelectedRepository } from '@/lib/db/queries';
import { getCurrentSession } from '@/lib/auth';
import { RecentHistory } from '@/components/dashboard/recent-history';
import { BuildActionsClient } from './build-actions-client';
import { BuildPollingWrapper } from './build-polling-wrapper';

interface PageProps {
  params: Promise<{ buildId: string }>;
}

export default async function BuildPage({ params }: PageProps) {
  const { buildId } = await params;
  const session = await getCurrentSession();
  const teamId = session?.team?.id;
  const [build, selectedRepo] = await Promise.all([
    getBuildSummary(buildId),
    teamId ? getSelectedRepository(teamId) : null,
  ]);
  const recentBuilds = selectedRepo
    ? await getRecentBuildsByRepo(selectedRepo.id, 5)
    : [];

  if (!build) {
    notFound();
  }

  const pendingDiffs = build.diffs.filter((d) => d.status === 'pending');
  const aiApproveCount = build.diffs.filter(
    (d) => d.aiRecommendation === 'approve' && d.status === 'pending'
  ).length;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Hero and Metrics with Polling Support */}
      <BuildPollingWrapper
        buildId={buildId}
        isMainBranch={build.isMainBranch}
        initialBuild={{
          id: build.id,
          overallStatus: build.overallStatus,
          totalTests: build.totalTests,
          passedCount: build.passedCount,
          failedCount: build.failedCount,
          changesDetected: build.changesDetected,
          flakyCount: build.flakyCount,
          completedAt: build.completedAt,
          elapsedMs: build.elapsedMs,
          codeChangeTestIds: build.codeChangeTestIds,
          diffs: build.diffs,
        }}
      >
        {/* Inline: Recent History + Git Info + Actions */}
        <RecentHistory builds={recentBuilds} />
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono">{build.gitBranch}</span>
          <span>·</span>
          <span className="font-mono">{build.gitCommit.slice(0, 7)}</span>
          {build.pullRequestId && (
            <>
              <span>·</span>
              <span className="text-primary font-medium">PR #{build.pullRequestId}</span>
            </>
          )}
        </div>
        <div className="ml-auto">
          <BuildActionsClient
            buildId={buildId}
            hasPendingDiffs={pendingDiffs.length > 0}
            aiApproveCount={aiApproveCount}
          />
        </div>
      </BuildPollingWrapper>
    </div>
  );
}