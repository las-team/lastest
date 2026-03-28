import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, XCircle, Clock, FileCode, Folder, AlertTriangle, Loader2, Shield, Activity, Zap } from 'lucide-react';
import {
  getSelectedRepository,
  getTestsByRepo,
  getFunctionalAreasByRepo,
  getBuildsByRepo,
  getAggregatedSelectorStats,
  getBuildTrends,
  getRouteCoverageStats,
} from '@/lib/db/queries';
import { getCurrentSession } from '@/lib/auth';
import { PlayAgentTimeline } from '@/components/play-agent/play-agent-timeline';
import { SelectorStatsChartClient } from '@/components/dashboard/selector-stats-chart-client';
import Link from 'next/link';

// Simple inline sparkline as SVG
function Sparkline({ data, color = 'currentColor', height = 24, width = 80 }: { data: number[]; color?: string; height?: number; width?: number }) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={width} height={height} className="inline-block ml-2">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default async function DashboardPage() {
  const session = await getCurrentSession();
  const teamId = session?.team?.id;
  const userId = session?.user?.id;
  const selectedRepo = teamId ? await getSelectedRepository(userId, teamId) : null;
  // Fetch data filtered by selected repo — no global fallbacks
  const [tests, areas, recentBuilds, selectorStats, trends, routeCoverage] = await Promise.all([
    selectedRepo ? getTestsByRepo(selectedRepo.id) : Promise.resolve([]),
    selectedRepo ? getFunctionalAreasByRepo(selectedRepo.id) : Promise.resolve([]),
    selectedRepo ? getBuildsByRepo(selectedRepo.id, 10) : Promise.resolve([]),
    selectedRepo ? getAggregatedSelectorStats(selectedRepo.id) : Promise.resolve([]),
    selectedRepo ? getBuildTrends(selectedRepo.id, 30) : Promise.resolve([]),
    selectedRepo ? getRouteCoverageStats(selectedRepo.id) : Promise.resolve({ total: 0, withTests: 0, percentage: 0 }),
  ]);

  // Get stats from the latest build
  const latestBuild = recentBuilds[0];
  const passingCount = latestBuild?.passedCount ?? 0;
  const failingCount = latestBuild?.failedCount ?? 0;
  const flakyCount = latestBuild?.flakyCount ?? 0;
  const totalTests = latestBuild?.totalTests ?? tests.length;

  // Compute health score: pass rate (60%) + flaky rate inverted (20%) + coverage (20%)
  const passRate = totalTests > 0 ? (passingCount / totalTests) * 100 : 0;
  const flakyRate = totalTests > 0 ? (flakyCount / totalTests) * 100 : 0;
  const coveragePct = routeCoverage?.percentage ?? 0;
  const healthScore = Math.round(
    (passRate * 0.6) +
    ((100 - flakyRate) * 0.2) +
    (coveragePct * 0.2)
  );

  const lastBuildTime = latestBuild?.createdAt
    ? new Date(latestBuild.createdAt).toLocaleString()
    : 'Never';

  // Sparkline data from trends
  const passRateTrend = trends.map(t => t.passRate);
  const flakyTrend = trends.map(t => t.flakyRate);

  // Health score color
  const healthColor = healthScore >= 80 ? 'text-green-600' : healthScore >= 50 ? 'text-yellow-600' : 'text-red-600';
  const healthBg = healthScore >= 80 ? 'bg-green-500/10' : healthScore >= 50 ? 'bg-yellow-500/10' : 'bg-red-500/10';

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 p-6 space-y-6">
        {/* Health Score + Stats Cards */}
        <div className="grid grid-cols-5 gap-4">
          {/* Health Score */}
          <Card className={healthBg}>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-1">
                <Shield className="h-3.5 w-3.5" />
                Health Score
              </CardDescription>
              <CardTitle className={`text-4xl font-bold ${healthColor}`}>
                {healthScore}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <p className="text-xs text-muted-foreground">
                {healthScore >= 80 ? 'Healthy' : healthScore >= 50 ? 'Needs attention' : 'Critical'}
              </p>
            </CardContent>
          </Card>

          {/* Total Tests */}
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Tests</CardDescription>
              <CardTitle className="text-3xl flex items-center gap-2">
                <FileCode className="h-5 w-5 text-muted-foreground" />
                {tests.length}
              </CardTitle>
            </CardHeader>
          </Card>

          {/* Passing */}
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center justify-between">
                Passing
                <Sparkline data={passRateTrend} color="var(--color-green-500, #22c55e)" />
              </CardDescription>
              <CardTitle className="text-3xl flex items-center gap-2 text-green-600">
                <CheckCircle className="h-5 w-5" />
                {passingCount}
              </CardTitle>
            </CardHeader>
          </Card>

          {/* Failing */}
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Failing</CardDescription>
              <CardTitle className="text-3xl flex items-center gap-2 text-destructive">
                <XCircle className="h-5 w-5" />
                {failingCount}
              </CardTitle>
            </CardHeader>
          </Card>

          {/* Flaky */}
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center justify-between">
                Flaky
                <Sparkline data={flakyTrend} color="var(--color-yellow-500, #eab308)" />
              </CardDescription>
              <CardTitle className="text-3xl flex items-center gap-2 text-yellow-600">
                <Zap className="h-5 w-5" />
                {flakyCount}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>

        {/* Coverage + Last Build Row */}
        <div className="grid grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-1">
                <Activity className="h-3.5 w-3.5" />
                Route Coverage
              </CardDescription>
              <div className="flex items-center gap-3">
                <CardTitle className="text-2xl">{routeCoverage?.percentage ?? 0}%</CardTitle>
                <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all ${(routeCoverage?.percentage ?? 0) >= 80 ? 'bg-green-500' : (routeCoverage?.percentage ?? 0) >= 50 ? 'bg-yellow-500' : 'bg-red-500'}`}
                    style={{ width: `${routeCoverage?.percentage ?? 0}%` }}
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <p className="text-xs text-muted-foreground">
                {routeCoverage?.withTests ?? 0}/{routeCoverage?.total ?? 0} routes have tests
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Last Build</CardDescription>
              <CardTitle className="text-xl flex items-center gap-2 text-muted-foreground">
                <Clock className="h-5 w-5" />
                {latestBuild ? 'Recent' : 'Never'}
              </CardTitle>
            </CardHeader>
            {latestBuild && (
              <CardContent className="pt-0">
                <p className="text-xs text-muted-foreground">{lastBuildTime}</p>
              </CardContent>
            )}
          </Card>
        </div>

        {/* Auto Setup Agent */}
        {!(session?.team?.banAiMode) && (
          <PlayAgentTimeline repositoryId={selectedRepo?.id} />
        )}

        {/* Selector Stats */}
        {selectorStats.length > 0 && (
          <SelectorStatsChartClient stats={selectorStats} />
        )}

        {/* Recent Builds */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Builds</CardTitle>
            <CardDescription>Your latest build results with visual diff status</CardDescription>
          </CardHeader>
          <CardContent>
            {recentBuilds.length > 0 ? (
              <div className="space-y-2">
                {recentBuilds.map((build) => {
                  const isRunning = !build.completedAt;
                  const buildTotal = build.totalTests ?? 0;
                  const buildPassRate = buildTotal > 0
                    ? Math.round(((build.passedCount ?? 0) / buildTotal) * 100)
                    : 0;
                  const buildFlaky = build.flakyCount ?? 0;
                  return (
                    <Link
                      key={build.id}
                      href={`/builds/${build.id}`}
                      className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        {isRunning ? (
                          <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
                        ) : build.overallStatus === 'safe_to_merge' ? (
                          <CheckCircle className="h-4 w-4 text-green-500" />
                        ) : build.overallStatus === 'blocked' ? (
                          <XCircle className="h-4 w-4 text-destructive" />
                        ) : (
                          <AlertTriangle className="h-4 w-4 text-yellow-500" />
                        )}
                        <div>
                          <span className="font-medium">Build #{build.id.slice(0, 8)}</span>
                          <span className="text-xs text-muted-foreground ml-2">
                            {buildTotal} tests
                          </span>
                          {buildFlaky > 0 && (
                            <span className="text-xs text-yellow-600 ml-2">
                              {buildFlaky} flaky
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {/* Pass rate mini bar */}
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
                            <div
                              className={`h-full transition-all ${buildPassRate === 100 ? 'bg-green-500' : buildPassRate > 80 ? 'bg-yellow-500' : 'bg-red-500'}`}
                              style={{ width: `${buildPassRate}%` }}
                            />
                          </div>
                          <span className="text-xs text-muted-foreground w-8">{buildPassRate}%</span>
                        </div>
                        <Badge variant={
                          isRunning ? 'secondary' :
                          build.overallStatus === 'safe_to_merge' ? 'default' :
                          build.overallStatus === 'blocked' ? 'destructive' : 'outline'
                        }>
                          {isRunning ? 'running' : build.overallStatus?.replace(/_/g, ' ')}
                        </Badge>
                      </div>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <FileCode className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No builds yet</p>
                <p className="text-sm">Record your first test to get started</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Functional Areas */}
        <Card>
          <CardHeader>
            <CardTitle>Functional Areas</CardTitle>
            <CardDescription>Test coverage by functional area</CardDescription>
          </CardHeader>
          <CardContent>
            {areas.length > 0 ? (
              <div className="grid grid-cols-3 gap-3">
                {areas.map((area) => {
                  const areaTests = tests.filter(t => t.functionalAreaId === area.id);
                  return (
                    <Link
                      key={area.id}
                      href="/tests"
                      className="flex items-center gap-3 p-3 border rounded-lg hover:bg-muted/50 transition-colors"
                    >
                      <Folder className="h-5 w-5 text-primary" />
                      <div>
                        <div className="font-medium">{area.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {areaTests.length} test{areaTests.length !== 1 ? 's' : ''}
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <p>No functional areas defined</p>
                <p className="text-sm">Create areas when recording tests</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
