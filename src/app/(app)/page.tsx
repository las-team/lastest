import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { CheckCircle, XCircle, Clock, FileCode, Folder, AlertTriangle, Loader2, Shield, Activity, Zap } from 'lucide-react';
import {
  getSelectedRepository,
  getTestsByRepo,
  getFunctionalAreasByRepo,
  getBuildsByRepo,
  getAggregatedSelectorStats,
  getBuildTrends,
  getRouteCoverageStats,
  getGithubAccountByTeam,
  getBaselinesByRepo,
} from '@/lib/db/queries';
import { getCurrentSession } from '@/lib/auth';
import { PlayAgentTimeline } from '@/components/play-agent/play-agent-timeline';
import { SelectorStatsChartClient } from '@/components/dashboard/selector-stats-chart-client';
import { SetupGuide } from '@/components/setup-guide/setup-guide';
import { ActivityAutoFocus } from '@/components/activity-feed/activity-auto-focus-client';
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

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ focusActivity?: string }>;
}) {
  const params = await searchParams;
  const focusActivity = params.focusActivity === '1';
  const session = await getCurrentSession();
  const teamId = session?.team?.id;
  const userId = session?.user?.id;
  const selectedRepo = teamId ? await getSelectedRepository(userId, teamId) : null;
  // Fetch data filtered by selected repo — no global fallbacks
  const [tests, areas, recentBuilds, selectorStats, trends, routeCoverage, githubAccount, baselines] = await Promise.all([
    selectedRepo ? getTestsByRepo(selectedRepo.id) : Promise.resolve([]),
    selectedRepo ? getFunctionalAreasByRepo(selectedRepo.id) : Promise.resolve([]),
    selectedRepo ? getBuildsByRepo(selectedRepo.id, 10) : Promise.resolve([]),
    selectedRepo ? getAggregatedSelectorStats(selectedRepo.id) : Promise.resolve([]),
    selectedRepo ? getBuildTrends(selectedRepo.id, 30) : Promise.resolve([]),
    selectedRepo ? getRouteCoverageStats(selectedRepo.id) : Promise.resolve({ total: 0, withTests: 0, percentage: 0 }),
    teamId ? getGithubAccountByTeam(teamId) : Promise.resolve(null),
    selectedRepo ? getBaselinesByRepo(selectedRepo.id) : Promise.resolve([]),
  ]);

  const setupStatus = {
    githubConnected: !!githubAccount,
    routesExist: (routeCoverage?.total ?? 0) > 0,
    testsExist: tests.length > 0,
    buildsExist: recentBuilds.length > 0,
    baselinesApproved: baselines.length > 0,
    buildCount: recentBuilds.length,
  };

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
  const healthColor = healthScore >= 80 ? 'text-success' : healthScore >= 50 ? 'text-warning' : 'text-destructive';
  const healthBg = healthScore >= 80 ? 'bg-success/10' : healthScore >= 50 ? 'bg-warning/10' : 'bg-destructive/10';

  return (
    <div className="flex flex-col h-full">
      {focusActivity && <ActivityAutoFocus />}
      <div className="flex-1 p-6 space-y-6">
        {/* Setup Guide — surfaces unfinished onboarding/setup items */}
        <SetupGuide initialStatus={setupStatus} latestBuildId={recentBuilds[0]?.id ?? null} />

        {/* Health Score + Stats Cards */}
        <div className="grid grid-cols-5 gap-4">
          {/* Health Score */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Card className={`${healthBg} cursor-default`}>
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
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs p-3 space-y-2 text-left">
              <p className="font-semibold text-sm">How it&apos;s calculated</p>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between gap-4">
                  <span>Pass Rate ({passRate.toFixed(1)}%)</span>
                  <span className="font-mono">{(passRate * 0.6).toFixed(1)} x 0.6</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span>Non-Flaky Rate ({(100 - flakyRate).toFixed(1)}%)</span>
                  <span className="font-mono">{((100 - flakyRate) * 0.2).toFixed(1)} x 0.2</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span>Route Coverage ({coveragePct.toFixed(1)}%)</span>
                  <span className="font-mono">{(coveragePct * 0.2).toFixed(1)} x 0.2</span>
                </div>
                <div className="border-t border-background/20 pt-1 flex justify-between gap-4 font-semibold">
                  <span>Total</span>
                  <span className="font-mono">{healthScore}</span>
                </div>
              </div>
              <div className="border-t border-background/20 pt-1.5 space-y-0.5 text-xs">
                <p className="font-semibold">Thresholds</p>
                <p>80-100 Healthy &middot; 50-79 Needs Attention &middot; 0-49 Critical</p>
              </div>
              <div className="border-t border-background/20 pt-1.5 space-y-0.5 text-xs">
                <p className="font-semibold">Tips to improve</p>
                {passRate < 100 && <p>Fix failing tests to boost pass rate (60% weight)</p>}
                {flakyRate > 0 && <p>Stabilize flaky tests to reduce flaky rate (20% weight)</p>}
                {coveragePct < 100 && <p>Add tests for uncovered routes (20% weight)</p>}
                {passRate === 100 && flakyRate === 0 && coveragePct === 100 && <p>Perfect score! Keep it up.</p>}
              </div>
            </TooltipContent>
          </Tooltip>

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
                <Sparkline data={passRateTrend} color="var(--c-teal)" />
              </CardDescription>
              <CardTitle className="text-3xl flex items-center gap-2 text-success">
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
                <Sparkline data={flakyTrend} color="var(--c-amber)" />
              </CardDescription>
              <CardTitle className="text-3xl flex items-center gap-2 text-warning">
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
                          <Loader2 className="h-4 w-4 text-info animate-spin" />
                        ) : build.overallStatus === 'safe_to_merge' ? (
                          <CheckCircle className="h-4 w-4 text-success" />
                        ) : build.overallStatus === 'blocked' ? (
                          <XCircle className="h-4 w-4 text-destructive" />
                        ) : (
                          <AlertTriangle className="h-4 w-4 text-warning" />
                        )}
                        <div>
                          <span className="font-medium">Build #{build.id.slice(0, 8)}</span>
                          <span className="text-xs text-muted-foreground ml-2">
                            {buildTotal} tests
                          </span>
                          {buildFlaky > 0 && (
                            <span className="text-xs text-warning ml-2">
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
                              className={`h-full transition-all ${buildPassRate === 100 ? 'bg-success' : buildPassRate > 80 ? 'bg-warning' : 'bg-destructive'}`}
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
