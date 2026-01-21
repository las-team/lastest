'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Play,
  Loader2,
  FileCode,
  Package,
} from 'lucide-react';
import { createAndRunBuild } from '@/server/actions/builds';
import type { Test, TestRun, Build } from '@/lib/db/schema';
import { BuildSummaryCard } from '@/components/builds/build-summary-card';

interface BuildWithBranch extends Build {
  gitBranch?: string;
}

interface RunDashboardClientProps {
  tests: Test[];
  runs: TestRun[];
  builds: BuildWithBranch[];
  repositoryId?: string | null;
  activeBranch?: string;
}

export function RunDashboardClient({ tests, runs, builds, repositoryId, activeBranch }: RunDashboardClientProps) {
  const router = useRouter();
  const [isRunning, setIsRunning] = useState(false);

  const handleRunAll = async () => {
    setIsRunning(true);
    try {
      const { buildId, testRunId } = await createAndRunBuild('manual', undefined, repositoryId);
      router.push(`/builds/${buildId}`);
    } catch (error) {
      console.error('Failed to start build:', error);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="flex-1 p-6 overflow-auto">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-6xl mx-auto">
        {/* Left Column - Run Tests */}
        <div className="space-y-6">
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
        </div>

        {/* Right Column - Build History */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Build History</CardTitle>
              <CardDescription>
                Recent build results and status
              </CardDescription>
            </CardHeader>
            <CardContent>
              {builds.length > 0 ? (
                <div className="space-y-3">
                  {builds.slice(0, 10).map((build) => (
                    <BuildSummaryCard
                      key={build.id}
                      build={build}
                      gitBranch={build.gitBranch}
                      isActiveBranch={build.gitBranch === activeBranch}
                    />
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No builds yet</p>
                  <p className="text-sm">Run your tests to create your first build</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
