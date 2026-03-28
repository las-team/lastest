import { notFound } from 'next/navigation';
import { getBuildSummary, getRecentBuildsByRepo } from '@/server/actions/builds';
import { getSelectedRepository } from '@/lib/db/queries';
import { getCurrentSession } from '@/lib/auth';
import { RecentHistory } from '@/components/dashboard/recent-history';
import { BuildActionsClient } from './build-actions-client';
import { BuildPollingWrapper } from './build-polling-wrapper';
import { getStreamUrlForRunner } from '@/server/actions/embedded-sessions';
import * as queries from '@/lib/db/queries';

interface PageProps {
  params: Promise<{ buildId: string }>;
}

export default async function BuildPage({ params }: PageProps) {
  const { buildId } = await params;
  const session = await getCurrentSession();
  const teamId = session?.team?.id;
  const userId = session?.user?.id;
  const [build, selectedRepo] = await Promise.all([
    getBuildSummary(buildId),
    teamId ? getSelectedRepository(userId, teamId) : null,
  ]);
  const recentBuilds = selectedRepo
    ? await getRecentBuildsByRepo(selectedRepo.id, 5)
    : [];

  if (!build) {
    notFound();
  }

  // Look up embedded stream URL if this build uses an embedded runner
  let embeddedStreamUrl: string | null = null;
  const buildRecord = await queries.getBuild(buildId);
  if (buildRecord?.testRunId) {
    const testRun = await queries.getTestRun(buildRecord.testRunId);
    if (testRun?.runnerId) {
      const streamInfo = await getStreamUrlForRunner(testRun.runnerId);
      if (streamInfo?.streamUrl) {
        const token = streamInfo.streamAuthToken;
        // Pass direct stream URL — BrowserViewer will replace hostname for remote access
        embeddedStreamUrl = token
          ? `${streamInfo.streamUrl}?token=${encodeURIComponent(token)}`
          : streamInfo.streamUrl;
      }
    }
  }

  // Comparison pair lookup
  let comparisonPairBuild: { id: string; role: string } | null = null;
  if (buildRecord?.comparisonPairId) {
    const pairBuilds = await queries.getBuildsByComparisonPairId(buildRecord.comparisonPairId);
    const sibling = pairBuilds.find(b => b.id !== buildId);
    if (sibling) {
      comparisonPairBuild = { id: sibling.id, role: sibling.comparisonRole || 'unknown' };
    }
  }

  const banAiMode = session?.team?.banAiMode ?? false;

  // Fetch a11y compliance data
  const a11yData = buildRecord ? {
    score: buildRecord.a11yScore ?? null,
    violationCount: buildRecord.a11yViolationCount ?? null,
    criticalCount: buildRecord.a11yCriticalCount ?? null,
    totalRulesChecked: buildRecord.a11yTotalRulesChecked ?? null,
    trend: selectedRepo ? await queries.getA11yScoreTrend(selectedRepo.id) : [],
  } : undefined;
  const pendingDiffs = build.diffs.filter((d) => d.status === 'pending');
  const aiApproveCount = banAiMode ? 0 : build.diffs.filter(
    (d) => d.aiRecommendation === 'approve' && d.status === 'pending'
  ).length;

  return (
    <div className="flex-1 p-6 overflow-auto">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Comparison pair banner */}
        {buildRecord?.comparisonRole && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-blue-50 border border-blue-200 text-blue-800 text-sm">
            <span className="font-medium">
              {buildRecord.comparisonRole === 'baseline' ? 'Baseline build' : 'Feature build'}
            </span>
            <span className="text-blue-600">of a comparison run.</span>
            {comparisonPairBuild && (
              <a
                href={`/builds/${comparisonPairBuild.id}`}
                className="ml-auto text-blue-700 hover:text-blue-900 underline text-xs"
              >
                View {comparisonPairBuild.role === 'baseline' ? 'baseline' : 'feature'} build &rarr;
              </a>
            )}
          </div>
        )}
        {/* Hero and Metrics with Polling Support */}
        <BuildPollingWrapper
          buildId={buildId}
          isMainBranch={build.isMainBranch}
          embeddedStreamUrl={embeddedStreamUrl}
          banAiMode={banAiMode}
          a11y={a11yData}
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
            errorMessage: build.errorMessage,
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
              banAiMode={banAiMode}
            />
          </div>
        </BuildPollingWrapper>
      </div>
    </div>
  );
}
