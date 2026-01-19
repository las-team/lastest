import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getBuildSummary, getRecentBuilds } from '@/server/actions/builds';
import { BuildSummaryHero } from '@/components/dashboard/build-summary-hero';
import { MetricsRow } from '@/components/dashboard/metrics-row';
import { RecentHistory } from '@/components/dashboard/recent-history';
import { BuildActionsClient } from './build-actions-client';
import { AlertTriangle, CheckCircle, XCircle, ExternalLink } from 'lucide-react';

interface PageProps {
  params: Promise<{ buildId: string }>;
}

const diffStatusIcons: Record<string, typeof CheckCircle> = {
  pending: AlertTriangle,
  approved: CheckCircle,
  rejected: XCircle,
  auto_approved: CheckCircle,
};

const diffStatusColors: Record<string, string> = {
  pending: 'text-yellow-600 bg-yellow-50',
  approved: 'text-green-600 bg-green-50',
  rejected: 'text-red-600 bg-red-50',
  auto_approved: 'text-blue-600 bg-blue-50',
};

export default async function BuildPage({ params }: PageProps) {
  const { buildId } = await params;
  const build = await getBuildSummary(buildId);
  const recentBuilds = await getRecentBuilds(5);

  if (!build) {
    notFound();
  }

  const pendingDiffs = build.diffs.filter((d) => d.status === 'pending');
  const failedDiffs = build.diffs.filter((d) => d.status === 'rejected');
  const changedDiffs = build.diffs.filter(
    (d) => d.pixelDifference && d.pixelDifference > 0
  );

  // Sort: Failed first, then pending changes, then others
  const sortedDiffs = [
    ...failedDiffs,
    ...pendingDiffs.filter((d) => !failedDiffs.includes(d)),
    ...build.diffs.filter(
      (d) => !failedDiffs.includes(d) && !pendingDiffs.includes(d)
    ),
  ];

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Hero Status */}
      <BuildSummaryHero
        status={build.overallStatus}
        changesDetected={build.changesDetected}
      />

      {/* Metrics Row */}
      <MetricsRow
        totalTests={build.totalTests}
        changesDetected={build.changesDetected}
        flakyCount={build.flakyCount}
        failedCount={build.failedCount}
        elapsedMs={build.elapsedMs}
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

      {/* Tests for Review */}
      <div>
        <h2 className="text-lg font-semibold mb-4">
          Tests for Review ({sortedDiffs.length})
        </h2>

        {sortedDiffs.length === 0 ? (
          <div className="text-center py-8 text-gray-500 border rounded-lg">
            No visual changes detected in this build.
          </div>
        ) : (
          <div className="space-y-2">
            {sortedDiffs.map((diff) => {
              const StatusIcon = diffStatusIcons[diff.status];
              const statusColor = diffStatusColors[diff.status];

              return (
                <Link
                  key={diff.id}
                  href={`/builds/${buildId}/diff/${diff.id}`}
                  className="flex items-center justify-between p-4 border rounded-lg hover:border-blue-300 hover:bg-blue-50/30 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded ${statusColor}`}>
                      <StatusIcon className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="font-medium">Test {diff.testId.slice(0, 8)}</div>
                      <div className="text-sm text-gray-500">
                        {diff.pixelDifference
                          ? `${diff.pixelDifference.toLocaleString()} pixels changed (${diff.percentageDifference}%)`
                          : 'No changes detected'}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    {diff.currentImagePath && (
                      <img
                        src={diff.currentImagePath}
                        alt="Screenshot"
                        className="w-20 h-12 object-cover rounded border"
                      />
                    )}
                    <ExternalLink className="w-4 h-4 text-gray-400" />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
