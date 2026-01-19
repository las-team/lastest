import { Header } from '@/components/layout/header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, XCircle, Clock, FileCode, Folder } from 'lucide-react';
import { getTests, getFunctionalAreas, getTestRuns, getTestResultsByRun } from '@/lib/db/queries';
import Link from 'next/link';

export default async function DashboardPage() {
  const [tests, areas, runs] = await Promise.all([
    getTests(),
    getFunctionalAreas(),
    getTestRuns(),
  ]);

  // Get results from the latest run to calculate pass/fail
  const latestRun = runs[0];
  let passingCount = 0;
  let failingCount = 0;

  if (latestRun) {
    const results = await getTestResultsByRun(latestRun.id);
    passingCount = results.filter(r => r.status === 'passed').length;
    failingCount = results.filter(r => r.status === 'failed').length;
  }

  const lastRunTime = latestRun?.startedAt
    ? new Date(latestRun.startedAt).toLocaleString()
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
              <CardDescription>Last Run</CardDescription>
              <CardTitle className="text-xl flex items-center gap-2 text-muted-foreground">
                <Clock className="h-5 w-5" />
                {latestRun ? 'Recent' : 'Never'}
              </CardTitle>
            </CardHeader>
            {latestRun && (
              <CardContent className="pt-0">
                <p className="text-xs text-muted-foreground">{lastRunTime}</p>
              </CardContent>
            )}
          </Card>
        </div>

        {/* Recent Runs */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Test Runs</CardTitle>
            <CardDescription>Your latest test execution results</CardDescription>
          </CardHeader>
          <CardContent>
            {runs.length > 0 ? (
              <div className="space-y-2">
                {runs.slice(0, 5).map((run) => (
                  <Link
                    key={run.id}
                    href={`/run/${run.id}`}
                    className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {run.status === 'passed' ? (
                        <CheckCircle className="h-4 w-4 text-green-500" />
                      ) : run.status === 'failed' ? (
                        <XCircle className="h-4 w-4 text-destructive" />
                      ) : (
                        <Clock className="h-4 w-4 text-yellow-500" />
                      )}
                      <div>
                        <span className="font-medium">Run #{run.id.slice(0, 8)}</span>
                        <span className="text-xs text-muted-foreground ml-2">
                          {run.gitBranch}
                        </span>
                      </div>
                    </div>
                    <Badge variant={run.status === 'passed' ? 'default' : 'destructive'}>
                      {run.status}
                    </Badge>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <FileCode className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No test runs yet</p>
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
