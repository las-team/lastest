import { notFound } from 'next/navigation';
import { getBuildSummary, getRecentBuilds } from '@/server/actions/builds';
import { BuildSummaryHero } from '@/components/dashboard/build-summary-hero';
import { RecentHistory } from '@/components/dashboard/recent-history';
import { BuildActionsClient } from './build-actions-client';
import { BuildDetailClient } from './build-detail-client';

interface PageProps {
  params: Promise<{ buildId: string }>;
}

export default async function BuildPage({ params }: PageProps) {
  const { buildId } = await params;
  const build = await getBuildSummary(buildId);
  const recentBuilds = await getRecentBuilds(5);

  if (!build) {
    notFound();
  }

  const pendingDiffs = build.diffs.filter((d) => d.status === 'pending');

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Hero Status */}
      <BuildSummaryHero
        status={build.overallStatus}
        changesDetected={build.changesDetected}
      />

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

      {/* Metrics Row and Diff List with Filter Support */}
      <BuildDetailClient
        buildId={buildId}
        diffs={build.diffs}
        metrics={{
          totalTests: build.totalTests,
          changesDetected: build.changesDetected,
          flakyCount: build.flakyCount,
          failedCount: build.failedCount,
          elapsedMs: build.elapsedMs,
        }}
        hasPendingDiffs={pendingDiffs.length > 0}
      />
    </div>
  );
}
