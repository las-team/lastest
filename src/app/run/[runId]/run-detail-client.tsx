'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  CheckCircle,
  XCircle,
  Clock,
  GitBranch,
  GitCommit,
  FileCode,
  Image as ImageIcon,
} from 'lucide-react';
import type { TestRun, TestResult } from '@/lib/db/schema';

interface ResultWithTest extends TestResult {
  testName: string;
}

interface RunDetailClientProps {
  run: TestRun;
  results: ResultWithTest[];
}

export function RunDetailClient({ run, results }: RunDetailClientProps) {
  const passedCount = results.filter(r => r.status === 'passed').length;
  const failedCount = results.filter(r => r.status === 'failed').length;
  const totalCount = results.length;
  const passRate = totalCount > 0 ? Math.round((passedCount / totalCount) * 100) : 0;

  const totalDuration = results.reduce((sum, r) => sum + (r.durationMs || 0), 0);

  return (
    <div className="flex-1 p-6 overflow-auto">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Summary Card */}
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  {run.status === 'passed' ? (
                    <CheckCircle className="h-5 w-5 text-green-500" />
                  ) : run.status === 'failed' ? (
                    <XCircle className="h-5 w-5 text-destructive" />
                  ) : (
                    <Clock className="h-5 w-5 text-yellow-500 animate-pulse" />
                  )}
                  Test Run Summary
                </CardTitle>
                <CardDescription>
                  {run.startedAt
                    ? new Date(run.startedAt).toLocaleString()
                    : 'Unknown start time'}
                </CardDescription>
              </div>
              <Badge
                variant={
                  run.status === 'passed'
                    ? 'default'
                    : run.status === 'failed'
                    ? 'destructive'
                    : 'secondary'
                }
                className="text-sm"
              >
                {run.status}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-4 gap-4 mb-6">
              <div className="text-center">
                <div className="text-3xl font-bold">{totalCount}</div>
                <div className="text-sm text-muted-foreground">Total</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-green-600">{passedCount}</div>
                <div className="text-sm text-muted-foreground">Passed</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-destructive">{failedCount}</div>
                <div className="text-sm text-muted-foreground">Failed</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold">{totalDuration}ms</div>
                <div className="text-sm text-muted-foreground">Duration</div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Pass Rate</span>
                <span>{passRate}%</span>
              </div>
              <Progress value={passRate} className="h-2" />
            </div>

            <div className="flex items-center gap-4 mt-4 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <GitBranch className="h-4 w-4" />
                {run.gitBranch}
              </span>
              <span className="flex items-center gap-1">
                <GitCommit className="h-4 w-4" />
                {run.gitCommit}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Results List */}
        <Card>
          <CardHeader>
            <CardTitle>Test Results</CardTitle>
          </CardHeader>
          <CardContent>
            {results.length > 0 ? (
              <div className="space-y-2">
                {results.map((result) => (
                  <div
                    key={result.id}
                    className="flex items-center justify-between p-4 border rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      {result.status === 'passed' ? (
                        <CheckCircle className="h-5 w-5 text-green-500" />
                      ) : (
                        <XCircle className="h-5 w-5 text-destructive" />
                      )}
                      <div>
                        <div className="font-medium">{result.testName}</div>
                        {result.errorMessage && (
                          <div className="text-sm text-destructive mt-1">
                            {result.errorMessage}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      {result.screenshotPath && (
                        <a
                          href={result.screenshotPath}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <ImageIcon className="h-4 w-4" />
                        </a>
                      )}
                      <span className="text-sm text-muted-foreground">
                        {result.durationMs}ms
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                {run.status === 'running' ? (
                  <>
                    <Clock className="h-12 w-12 mx-auto mb-4 animate-pulse" />
                    <p>Tests are running...</p>
                  </>
                ) : (
                  <p>No results available</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
