import { Header } from '@/components/layout/header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, XCircle, Clock, FileCode, Folder, AlertTriangle, Loader2 } from 'lucide-react';
import {
  getTests,
  getFunctionalAreas,
  getSelectedRepository,
  getTestsByRepo,
  getFunctionalAreasByRepo,
  getRouteCoverageStats,
  getRecentBuilds,
  getBuildsByRepo,
} from '@/lib/db/queries';
import { CoverageBar } from '@/components/coverage/coverage-bar';
import Link from 'next/link';

export default async function DashboardPage() {
  const selectedRepo = await getSelectedRepository();

  // Fetch data filtered by selected repo if available
  const [tests, areas, recentBuilds] = await Promise.all([
    selectedRepo ? getTestsByRepo(selectedRepo.id) : getTests(),
    selectedRepo ? getFunctionalAreasByRepo(selectedRepo.id) : getFunctionalAreas(),
    selectedRepo ? getBuildsByRepo(selectedRepo.id, 5) : getRecentBuilds(5),
  ]);

  // Fetch route coverage stats
  const coverage = selectedRepo
    ? await getRouteCoverageStats(selectedRepo.id)
    : { total: 0, withTests: 0, percentage: 0 };

  // Get stats from the latest build
  const latestBuild = recentBuilds[0];
  const passingCount = latestBuild?.passedCount ?? 0;
  const failingCount = latestBuild?.failedCount ?? 0;

  const lastBuildTime = latestBuild?.createdAt
    ? new Date(latestBuild.createdAt).toLocaleString()
    : 'Never';

  return (
    <div className="flex flex-col h-full">
      <Header title="Dashboard" />

      <div className="flex-1 p-6 space-y-6">
        {/* Stats Cards */}
        <div className="grid grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Tests</CardDescription>
              <CardTitle className="text-3xl flex items-center gap-2">
                <FileCode className="h-5 w-5 text-muted-foreground" />
                {tests.length}
              </CardTitle>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Passing</CardDescription>
              <CardTitle className="text-3xl flex items-center gap-2 text-green-600">
                <CheckCircle className="h-5 w-5" />
                {passingCount}
              </CardTitle>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Failing</CardDescription>
              <CardTitle className="text-3xl flex items-center gap-2 text-destructive">
                <XCircle className="h-5 w-5" />
                {failingCount}
              </CardTitle>
            </CardHeader>
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

        {/* Route Coverage */}
        {coverage.total > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Route Coverage</CardTitle>
              <CardDescription>
                Test coverage across discovered routes
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CoverageBar covered={coverage.withTests} total={coverage.total} />
            </CardContent>
          </Card>
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
                  const totalTests = build.totalTests ?? 0;
                  const passRate = totalTests > 0
                    ? Math.round(((build.passedCount ?? 0) / totalTests) * 100)
                    : 0;
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
                            {totalTests} tests
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {/* Pass rate mini bar */}
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-2 bg-gray-200 rounded-full overflow-hidden">
                            <div
                              className={`h-full transition-all ${passRate === 100 ? 'bg-green-500' : passRate > 80 ? 'bg-yellow-500' : 'bg-red-500'}`}
                              style={{ width: `${passRate}%` }}
                            />
                          </div>
                          <span className="text-xs text-muted-foreground w-8">{passRate}%</span>
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
