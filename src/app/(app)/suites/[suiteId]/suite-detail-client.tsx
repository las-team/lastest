'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Play, Pencil, Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { SuiteBuilder } from '@/components/suites/suite-builder';
import { CreateSuiteDialog } from '@/components/suites/create-suite-dialog';
import { ExecutionTargetSelector } from '@/components/execution/execution-target-selector';
import { deleteSuite, runSuite, getSuiteRunProgress } from '@/server/actions/suites';
import { useNotifyJobStarted } from '@/components/queue/job-polling-context';
import type { Suite, FunctionalArea } from '@/lib/db/schema';

interface SuiteTest {
  id: string;
  suiteId: string;
  testId: string;
  orderIndex: number;
  testName: string;
  testCode: string;
  targetUrl: string | null;
  functionalAreaId: string | null;
}

interface TestWithStatus {
  id: string;
  name: string;
  code: string;
  targetUrl: string | null;
  functionalAreaId: string | null;
  latestStatus: string | null;
  area: FunctionalArea | null;
}

interface SuiteWithTests extends Suite {
  tests: SuiteTest[];
}

interface SuiteDetailClientProps {
  suite: SuiteWithTests;
  availableTests: TestWithStatus[];
  areas: FunctionalArea[];
}

interface TestResult {
  testId: string | null;
  status: string | null;
  errorMessage: string | null;
  durationMs: number | null;
}

interface RunProgress {
  status: string | null;
  completedAt: Date | null;
  results: TestResult[];
}

export function SuiteDetailClient({ suite, availableTests, areas }: SuiteDetailClientProps) {
  const router = useRouter();
  const notifyJobStarted = useNotifyJobStarted();
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const [executionTarget, setExecutionTarget] = useState<string>('local');

  // Use ref to allow self-referential polling without violating hooks rules
  const pollProgressRef = useRef<((id: string) => Promise<void>) | undefined>(undefined);

  const pollProgress = useCallback(async (id: string) => {
    const data = await getSuiteRunProgress(id);
    if (data) {
      setProgress(data);
      if (data.status === 'running') {
        setTimeout(() => pollProgressRef.current?.(id), 1000);
      } else {
        setIsRunning(false);
      }
    }
  }, []);

  // Update ref when callback changes
  useEffect(() => {
    pollProgressRef.current = pollProgress;
  }, [pollProgress]);

  useEffect(() => {
    if (runId && isRunning) {
      // Start polling in next tick to avoid setState in effect body
      const timer = setTimeout(() => pollProgress(runId), 0);
      return () => clearTimeout(timer);
    }
  }, [runId, isRunning, pollProgress]);

  const handleDelete = async () => {
    if (!confirm(`Delete suite "${suite.name}"? This cannot be undone.`)) return;
    await deleteSuite(suite.id);
    router.push('/suites');
  };

  const handleRun = async () => {
    if (suite.tests.length === 0) {
      alert('Add tests to the suite before running');
      return;
    }
    setIsRunning(true);
    setProgress(null);
    try {
      const result = await runSuite(suite.id, executionTarget);
      notifyJobStarted();
      setRunId(result.runId);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to run suite');
      setIsRunning(false);
    }
  };

  const handleDismissResults = () => {
    setProgress(null);
    setRunId(null);
    router.refresh();
  };

  // Build a map of test results by testId (available for future use)
  const _resultsByTestId = new Map(
    progress?.results.map((r) => [r.testId, r]) ?? []
  );

  const completedCount = progress?.results.length ?? 0;
  const totalCount = suite.tests.length;
  const progressPct = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      <div className="p-6 border-b bg-muted/30">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold">{suite.name}</h2>
            {suite.description && (
              <p className="text-sm text-muted-foreground mt-1">{suite.description}</p>
            )}
            <p className="text-xs text-muted-foreground mt-2">
              {suite.tests.length} test{suite.tests.length !== 1 ? 's' : ''} in suite
            </p>
          </div>
          <div className="flex items-center gap-2">
            <ExecutionTargetSelector
              value={executionTarget}
              onChange={setExecutionTarget}
              disabled={isRunning}
              capabilityFilter="run"
              size="sm"
            />
            <Button onClick={handleRun} disabled={isRunning || suite.tests.length === 0}>
              {isRunning ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Play className="w-4 h-4 mr-2" />
              )}
              {isRunning ? 'Running...' : 'Run Suite'}
            </Button>
            <Button variant="outline" size="icon" onClick={() => setIsEditOpen(true)} disabled={isRunning}>
              <Pencil className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="icon" className="text-destructive" onClick={handleDelete} disabled={isRunning}>
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Progress bar */}
        {(isRunning || progress) && (
          <div className="mt-4 p-4 border rounded-lg bg-background">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">
                {isRunning ? 'Running tests...' : progress?.status === 'passed' ? 'All tests passed' : 'Run completed with errors'}
              </span>
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">
                  {completedCount} / {totalCount}
                </span>
                {!isRunning && progress && (
                  <Button variant="outline" size="sm" onClick={handleDismissResults}>
                    Dismiss
                  </Button>
                )}
              </div>
            </div>
            <Progress value={progressPct} className="h-2" />
          </div>
        )}
      </div>

      <SuiteBuilder
        isRunning={isRunning}
        runProgress={progress}
        completedCount={completedCount}
        suiteId={suite.id}
        suiteTests={suite.tests}
        availableTests={availableTests}
        areas={areas}
      />

      <CreateSuiteDialog
        open={isEditOpen}
        onOpenChange={setIsEditOpen}
        editSuite={suite}
      />
    </div>
  );
}
