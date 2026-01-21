'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Play,
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
  GitBranch,
  GitCommit,
  FileCode,
} from 'lucide-react';
import { createAndRunBuild } from '@/server/actions/builds';
import type { Test, TestRun, Build } from '@/lib/db/schema';
import Link from 'next/link';

interface RunDashboardClientProps {
  tests: Test[];
  runs: TestRun[];
  builds: Build[];
}

export function RunDashboardClient({ tests, runs, builds }: RunDashboardClientProps) {
  const router = useRouter();
  const [isRunning, setIsRunning] = useState(false);

  const handleRunAll = async () => {
    setIsRunning(true);
    try {
      const { buildId, testRunId } = await createAndRunBuild('manual');
      router.push(`/builds/${buildId}`);
    } catch (error) {
      console.error('Failed to start build:', error);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="flex-1 p-6 overflow-auto">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Run All Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Run Tests</CardTitle>
                <CardDescription>
                  Execute all tests or select specific ones
                </CardDescription>
              </div>
              <Button
                onClick={handleRunAll}
                disabled={isRunning || tests.length === 0}
                size="lg"
              >
                {isRunning ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Play className="h-4 w-4 mr-2" />
                )}
                Run All Tests
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-1">
                <FileCode className="h-4 w-4" />
                {tests.length} test{tests.length !== 1 ? 's' : ''}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Recent Runs */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Runs</CardTitle>
            <CardDescription>
              Previous test execution results
            </CardDescription>
          </CardHeader>
          <CardContent>
            {runs.length > 0 ? (
              <div className="space-y-3">
                {runs.slice(0, 10).map((run) => (
                  <Link
                    key={run.id}
                    href={`/run/${run.id}`}
                    className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      {run.status === 'passed' ? (
                        <CheckCircle className="h-5 w-5 text-green-500" />
                      ) : run.status === 'failed' ? (
                        <XCircle className="h-5 w-5 text-destructive" />
                      ) : (
                        <Loader2 className="h-5 w-5 animate-spin text-yellow-500" />
                      )}

                      <div>
                        <div className="flex items-center gap-2">
                          <Badge
                            variant={
                              run.status === 'passed'
                                ? 'default'
                                : run.status === 'failed'
                                ? 'destructive'
                                : 'secondary'
                            }
                          >
                            {run.status}
                          </Badge>
                          <span className="text-sm font-medium">
                            Run #{run.id.slice(0, 8)}
                          </span>
                        </div>

                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <GitBranch className="h-3 w-3" />
                            {run.gitBranch}
                          </span>
                          <span className="flex items-center gap-1">
                            <GitCommit className="h-3 w-3" />
                            {run.gitCommit}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="text-right text-sm text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {run.startedAt
                          ? new Date(run.startedAt).toLocaleString()
                          : 'Unknown'}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Clock className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No test runs yet</p>
                <p className="text-sm">Run your tests to see results here</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
