'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  GitBranch,
  ArrowRight,
  Loader2,
  CheckCircle,
  XCircle,
  Play,
  RefreshCw,
  Clock,
  ImageIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import type { TestRun } from '@/lib/db/schema';
import {
  getLatestRunForBranch,
  queueRunForBranch,
  getQueueStatus,
  type BranchRunInfo,
} from '@/server/actions/compare';
import type { QueuedRun } from '@/lib/run-queue';

interface CompareClientProps {
  branches: string[];
  runs: TestRun[];
  defaultBaseline?: string | null;
}

function formatTimestamp(date: Date | null): string {
  if (!date) return 'Never';
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(date));
}

interface BranchColumnProps {
  branch: string;
  branchInfo: BranchRunInfo | null;
  queuedRun: QueuedRun | null;
  isLoading: boolean;
  onRun: () => void;
  onRerun: () => void;
}

function BranchColumn({
  branch,
  branchInfo,
  queuedRun,
  isLoading,
  onRun,
  onRerun,
}: BranchColumnProps) {
  const hasRun = branchInfo?.run !== null;
  const isRunning = queuedRun?.status === 'running';
  const isQueued = queuedRun?.status === 'queued';
  const progress = queuedRun?.progress;

  return (
    <Card className="flex-1">
      <CardHeader className="pb-3 min-h-[72px]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4" />
            <CardTitle className="text-base">{branch}</CardTitle>
          </div>
          {branchInfo?.run && (
            <Badge variant={branchInfo.run.status === 'passed' ? 'default' : 'destructive'}>
              {branchInfo.run.status}
            </Badge>
          )}
        </div>
        {branchInfo?.run && (
          <CardDescription className="flex items-center gap-1 text-xs">
            <Clock className="h-3 w-3" />
            {formatTimestamp(branchInfo.timestamp)}
            {branchInfo.run.gitCommit && (
              <span className="ml-2 font-mono text-xs opacity-60">
                {branchInfo.run.gitCommit.slice(0, 7)}
              </span>
            )}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Progress bar when running */}
        {(isRunning || isQueued) && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {isQueued ? 'Queued...' : progress?.currentTestName || 'Running...'}
              </span>
              {progress && progress.total > 0 && (
                <span className="text-muted-foreground">
                  {progress.completed}/{progress.total}
                </span>
              )}
            </div>
            <Progress
              value={progress && progress.total > 0 ? (progress.completed / progress.total) * 100 : 0}
            />
          </div>
        )}

        {/* Run/Re-run buttons */}
        <div className="flex gap-2">
          {!hasRun && !isRunning && !isQueued && (
            <Button onClick={onRun} disabled={isLoading} size="sm" className="flex-1">
              {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
              Run Tests
            </Button>
          )}
          {hasRun && !isRunning && !isQueued && (
            <Button onClick={onRerun} disabled={isLoading} variant="outline" size="sm" className="flex-1">
              {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Re-run
            </Button>
          )}
        </div>

        {/* Test results */}
        {branchInfo?.results && branchInfo.results.length > 0 && (
          <div className="space-y-2">
            <div className="text-sm font-medium">Results ({branchInfo.results.length})</div>
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {branchInfo.results.map((result) => (
                <div
                  key={result.id}
                  className="flex items-center gap-2 p-2 rounded-md bg-muted/50 text-sm"
                >
                  {result.status === 'passed' ? (
                    <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
                  ) : (
                    <XCircle className="h-4 w-4 text-destructive shrink-0" />
                  )}
                  <span className="truncate flex-1">{result.testName}</span>
                  {result.screenshotPath && (
                    <a
                      href={result.screenshotPath}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0"
                    >
                      <ImageIcon className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* No results message */}
        {(!branchInfo?.results || branchInfo.results.length === 0) && !isRunning && !isQueued && (
          <div className="text-center py-4 text-muted-foreground text-sm">
            {hasRun ? 'No test results' : 'No runs yet'}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function CompareClient({ branches, runs, defaultBaseline }: CompareClientProps) {
  const [baseBranch, setBaseBranch] = useState<string>(defaultBaseline || '');
  const [targetBranch, setTargetBranch] = useState<string>('');
  const [baseInfo, setBaseInfo] = useState<BranchRunInfo | null>(null);
  const [targetInfo, setTargetInfo] = useState<BranchRunInfo | null>(null);
  const [isLoadingBase, setIsLoadingBase] = useState(false);
  const [isLoadingTarget, setIsLoadingTarget] = useState(false);
  const [queueStatus, setQueueStatus] = useState<{ queue: QueuedRun[]; activeRun: QueuedRun | null }>({
    queue: [],
    activeRun: null,
  });

  // Get runs grouped by branch for badge display
  const runsByBranch = runs.reduce((acc, run) => {
    if (!acc[run.gitBranch]) acc[run.gitBranch] = [];
    acc[run.gitBranch].push(run);
    return acc;
  }, {} as Record<string, TestRun[]>);

  // Fetch branch info when selection changes
  const fetchBranchInfo = useCallback(async (branch: string, isBase: boolean) => {
    if (!branch) return;

    const setLoading = isBase ? setIsLoadingBase : setIsLoadingTarget;
    const setInfo = isBase ? setBaseInfo : setTargetInfo;

    setLoading(true);
    try {
      const info = await getLatestRunForBranch(branch);
      setInfo(info);
    } catch (error) {
      console.error('Failed to fetch branch info:', error);
      toast.error(`Failed to load ${branch} info`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (baseBranch) {
      fetchBranchInfo(baseBranch, true);
    }
  }, [baseBranch, fetchBranchInfo]);

  useEffect(() => {
    if (targetBranch) {
      fetchBranchInfo(targetBranch, false);
    }
  }, [targetBranch, fetchBranchInfo]);

  // Poll queue status when runs are active
  useEffect(() => {
    const pollQueue = async () => {
      try {
        const status = await getQueueStatus();
        setQueueStatus(status);

        // Refresh branch info when runs complete
        const wasRunning = queueStatus.activeRun !== null;
        const isNowIdle = status.activeRun === null && status.queue.length === 0;

        if (wasRunning && isNowIdle) {
          if (baseBranch) fetchBranchInfo(baseBranch, true);
          if (targetBranch) fetchBranchInfo(targetBranch, false);
          toast.success('Test run completed');
        }
      } catch (error) {
        console.error('Failed to poll queue status:', error);
      }
    };

    const interval = setInterval(pollQueue, 2000);
    pollQueue();

    return () => clearInterval(interval);
  }, [baseBranch, targetBranch, fetchBranchInfo, queueStatus.activeRun]);

  const handleRunBranch = async (branch: string) => {
    try {
      const result = await queueRunForBranch(branch);
      toast.info(`Tests queued for ${branch}`);

      // Immediate status refresh
      const status = await getQueueStatus();
      setQueueStatus(status);
    } catch (error) {
      console.error('Failed to queue run:', error);
      toast.error('Failed to queue tests');
    }
  };

  const getQueuedRunForBranch = (branch: string): QueuedRun | null => {
    return queueStatus.queue.find((q) => q.branch === branch) || null;
  };

  return (
    <div className="flex-1 p-6 overflow-auto">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Branch Selection */}
        <Card>
          <CardHeader>
            <CardTitle>Compare Branches</CardTitle>
            <CardDescription>
              Select two branches to compare visual differences
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <label className="text-sm font-medium mb-2 block">Base Branch</label>
                <Select value={baseBranch} onValueChange={setBaseBranch}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select base branch" />
                  </SelectTrigger>
                  <SelectContent>
                    {branches.map((branch) => (
                      <SelectItem key={branch} value={branch}>
                        <span className="flex items-center gap-2">
                          <GitBranch className="h-4 w-4" />
                          {branch}
                          {runsByBranch[branch] && (
                            <Badge variant="secondary" className="ml-2">
                              {runsByBranch[branch].length} runs
                            </Badge>
                          )}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <ArrowRight className="h-5 w-5 text-muted-foreground mt-6" />

              <div className="flex-1">
                <label className="text-sm font-medium mb-2 block">Target Branch</label>
                <Select value={targetBranch} onValueChange={setTargetBranch}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select target branch" />
                  </SelectTrigger>
                  <SelectContent>
                    {branches.map((branch) => (
                      <SelectItem key={branch} value={branch}>
                        <span className="flex items-center gap-2">
                          <GitBranch className="h-4 w-4" />
                          {branch}
                          {runsByBranch[branch] && (
                            <Badge variant="secondary" className="ml-2">
                              {runsByBranch[branch].length} runs
                            </Badge>
                          )}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 2-Column Branch Display */}
        {(baseBranch || targetBranch) && (
          <div className="grid grid-cols-2 gap-6">
            {baseBranch ? (
              <BranchColumn
                branch={baseBranch}
                branchInfo={baseInfo}
                queuedRun={getQueuedRunForBranch(baseBranch)}
                isLoading={isLoadingBase}
                onRun={() => handleRunBranch(baseBranch)}
                onRerun={() => handleRunBranch(baseBranch)}
              />
            ) : (
              <Card className="flex-1 flex items-center justify-center min-h-[200px]">
                <div className="text-muted-foreground text-sm">Select base branch</div>
              </Card>
            )}

            {targetBranch ? (
              <BranchColumn
                branch={targetBranch}
                branchInfo={targetInfo}
                queuedRun={getQueuedRunForBranch(targetBranch)}
                isLoading={isLoadingTarget}
                onRun={() => handleRunBranch(targetBranch)}
                onRerun={() => handleRunBranch(targetBranch)}
              />
            ) : (
              <Card className="flex-1 flex items-center justify-center min-h-[200px]">
                <div className="text-muted-foreground text-sm">Select target branch</div>
              </Card>
            )}
          </div>
        )}

        {/* No branches message */}
        {branches.length === 0 && (
          <Card>
            <CardContent className="py-8">
              <div className="text-center text-muted-foreground">
                <GitBranch className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No git branches found</p>
                <p className="text-sm mt-2">
                  Initialize a git repository to enable branch comparison
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
