import { notFound } from 'next/navigation';
import { getBuildSummary, getRecentBuilds, getRecentBuildsByRepo } from '@/server/actions/builds';
import { getSelectedRepository } from '@/lib/db/queries';
import { RecentHistory } from '@/components/dashboard/recent-history';
import { BuildActionsClient } from './build-actions-client';
import { BuildPollingWrapper } from './build-polling-wrapper';

interface PageProps {
  params: Promise<{ buildId: string }>;
}

export default async function BuildPage({ params }: PageProps) {
  const { buildId } = await params;
  const [build, selectedRepo] = await Promise.all([
    getBuildSummary(buildId),
    getSelectedRepository(),
  ]);
  const recentBuilds = selectedRepo
    ? await getRecentBuildsByRepo(selectedRepo.id, 5)
    : await getRecentBuilds(5);

  if (!build) {
    notFound();
  }

  const pendingDiffs = build.diffs.filter((d) => d.status === 'pending');

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Hero and Metrics with Polling Support */}
      <BuildPollingWrapper
        buildId={buildId}
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
          diffs: build.diffs,
        }}
      >
        {/* Quick Actions */}
        <div className="flex items-center justify-between">
          <RecentHistory builds={recentBuilds} />
          <BuildActionsClient
            buildId={buildId}
            hasPendingDiffs={pendingDiffs.length > 0}
          />
        </div>

        {/* Git Info */}
        <div className="p-4 bg-gray-50 rounded-lg text-sm">
          <div className="flex items-center gap-4">
            <div>
              <span className="text-gray-500">Branch:</span>{' '}
              <span className="font-mono">{build.gitBranch}</span>
            </div>
            <div>
              <span className="text-gray-500">Commit:</span>{' '}
              <span className="font-mono">{build.gitCommit.slice(0, 7)}</span>
            </div>
            {build.pullRequestId && (
              <div>
                <span className="text-gray-500">PR:</span>{' '}
                <span className="text-blue-600">#{build.pullRequestId}</span>
              </div>
            )}
          </div>
        </div>
      </BuildPollingWrapper>
    </div>
  );
}