'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
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
  ChevronRight,
  ChevronDown,
} from 'lucide-react';
import { toast } from 'sonner';
import type { TestRun } from '@/lib/db/schema';
import {
  getLatestRunForBranch,
  queueRunForBranch,
  type BranchRunInfo,
} from '@/server/actions/compare';

interface CompareClientProps {
  branches: string[];
  runs: TestRun[];
  defaultBaseline?: string | null;
  repositoryId?: string;
  activeBranch?: string;
}

interface BranchBuildState {
  buildId: string;
  status: 'running' | 'completed' | 'failed';
  passedCount: number;
  failedCount: number;
  totalTests: number;
}

function formatTimestamp(date: Date | null): string {
  if (!date) return 'Never';
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(date));
}

function TestStatusIcon({ status }: { status: string | null }) {
  switch (status) {
    case 'passed':
      return <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />;
    case 'failed':
      return <XCircle className="h-4 w-4 text-destructive shrink-0" />;
    default:
      return <div className="h-4 w-4 rounded-full bg-muted shrink-0" />;
  }
}

interface BranchColumnProps {
  branch: string;
  branchInfo: BranchRunInfo | null;
  buildState: BranchBuildState | null;
  isLoading: boolean;
  onRun: () => void;
  onRerun: () => void;
  expandedTests: Set<string>;
  onToggleTest: (testId: string) => void;
  activeBranch?: string;
  scrollRef?: React.RefObject<HTMLDivElement | null>;
  onScroll?: (e: React.UIEvent<HTMLDivElement>) => void;
}

function BranchColumn({
  branch,
  branchInfo,
  buildState,
  isLoading,
  onRun,
  onRerun,
  expandedTests,
  onToggleTest,
  activeBranch,
  scrollRef,
  onScroll,
}: BranchColumnProps) {
  const hasRun = branchInfo?.run !== null;
  const isRunning = buildState?.status === 'running';
  const isActiveBranch = branch === activeBranch;

  const testsWithLiveStatus = branchInfo?.allTests || [];

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
        {isRunning && buildState && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Running...</span>
              {buildState.totalTests > 0 && (
                <span className="text-muted-foreground">
                  {buildState.passedCount + buildState.failedCount}/{buildState.totalTests}
                </span>
              )}
            </div>
            <Progress
              value={buildState.totalTests > 0 ? ((buildState.passedCount + buildState.failedCount) / buildState.totalTests) * 100 : 0}
            />
          </div>
        )}

        {/* Run/Re-run buttons - only for active branch */}
        <div className="flex gap-2 h-9">
          {isActiveBranch && (
            <>
              {!hasRun && !isRunning && (
                <Button onClick={onRun} disabled={isLoading} size="sm" className="flex-1">
                  {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
                  Run Tests
                </Button>
              )}
              {hasRun && !isRunning && (
                <Button onClick={onRerun} disabled={isLoading} variant="outline" size="sm" className="flex-1">
                  {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                  Re-run
                </Button>
              )}
            </>
          )}
        </div>

        {/* All tests display */}
        {testsWithLiveStatus.length > 0 && (
          <div className="space-y-2">
            <div className="text-sm font-medium">Tests ({testsWithLiveStatus.length})</div>
            <div
              ref={scrollRef}
              onScroll={onScroll}
              className="space-y-1 max-h-96 overflow-y-auto"
            >
              {testsWithLiveStatus.map((test) => {
                const isExpanded = expandedTests.has(test.id);
                const hasScreenshot = Boolean(test.screenshotPath);

                return (
                  <div key={test.id} className="rounded-md">
                    <button
                      onClick={() => hasScreenshot && onToggleTest(test.id)}
                      className={`flex items-center gap-2 p-2 w-full text-sm text-left ${hasScreenshot ? 'cursor-pointer hover:bg-muted/80' : 'cursor-default'}`}
                    >
                      {hasScreenshot ? (
                        isExpanded ? (
                          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                        )
                      ) : (
                        <div className="h-4 w-4 shrink-0" />
                      )}
                      <TestStatusIcon status={test.status} />
                      <span className="truncate flex-1">{test.name}</span>
                      {hasScreenshot && (
                        <ImageIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                      )}
                    </button>

                    {/* Expanded timeline view */}
                    {isExpanded && hasScreenshot && (
                      <div className="px-2 pb-3 pt-1">
                        <div className="ml-6 pl-4 border-l-2 border-muted-foreground/20">
                          <div className="text-xs font-medium text-muted-foreground mb-2">
                            Screenshot Timeline
                          </div>
                          <div className="relative">
                            {/* Timeline dot */}
                            <div className="absolute -left-[21px] top-0 h-3 w-3 rounded-full bg-primary border-2 border-background" />
                            <a
                              href={test.screenshotPath!}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block"
                            >
                              <img
                                src={test.screenshotPath!}
                                alt={`Screenshot for ${test.name}`}
                                className="w-full rounded-md border hover:opacity-90 transition-opacity"
                              />
                            </a>
                            <div className="text-xs text-muted-foreground mt-1">
                              Final screenshot
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* No tests message */}
        {testsWithLiveStatus.length === 0 && !isRunning && (
          <div className="text-center py-4 text-muted-foreground text-sm">
            No tests available
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function CompareClient({ branches, runs, defaultBaseline, repositoryId, activeBranch }: CompareClientProps) {
  const [baseBranch, setBaseBranch] = useState<string>(defaultBaseline || '');
  const [targetBranch, setTargetBranch] = useState<string>('');
  const [baseInfo, setBaseInfo] = useState<BranchRunInfo | null>(null);
  const [targetInfo, setTargetInfo] = useState<BranchRunInfo | null>(null);
  const [isLoadingBase, setIsLoadingBase] = useState(false);
  const [isLoadingTarget, setIsLoadingTarget] = useState(false);
  const [branchBuilds, setBranchBuilds] = useState<Record<string, BranchBuildState>>({});
  const [expandedTests, setExpandedTests] = useState<Set<string>>(new Set());

  // Synchronized scrolling refs
  const baseScrollRef = useRef<HTMLDivElement>(null);
  const targetScrollRef = useRef<HTMLDivElement>(null);
  const isScrollSyncing = useRef(false);

  const handleBaseScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (isScrollSyncing.current) return;
    isScrollSyncing.current = true;
    if (targetScrollRef.current) {
      targetScrollRef.current.scrollTop = e.currentTarget.scrollTop;
    }
    requestAnimationFrame(() => { isScrollSyncing.current = false; });
  };

  const handleTargetScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (isScrollSyncing.current) return;
    isScrollSyncing.current = true;
    if (baseScrollRef.current) {
      baseScrollRef.current.scrollTop = e.currentTarget.scrollTop;
    }
    requestAnimationFrame(() => { isScrollSyncing.current = false; });
  };

  const toggleTest = (testId: string) => {
    const newExpanded = new Set(expandedTests);
    if (newExpanded.has(testId)) {
      newExpanded.delete(testId);
    } else {
      newExpanded.add(testId);
    }
    setExpandedTests(newExpanded);
  };

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
      const info = await getLatestRunForBranch(branch, repositoryId);
      setInfo(info);
    } catch (error) {
      console.warn('Failed to fetch branch info:', error);
      toast.error(`Failed to load ${branch} info`);
    } finally {
      setLoading(false);
    }
  }, [repositoryId]);

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

  // Poll build status for active builds
  useEffect(() => {
    const activeBuilds = Object.entries(branchBuilds).filter(
      ([, state]) => state.status === 'running'
    );

    if (activeBuilds.length === 0) return;

    const pollBuilds = async () => {
      for (const [branch, buildState] of activeBuilds) {
        try {
          const res = await fetch(`/api/builds/${buildState.buildId}/status`);
          if (!res.ok) continue;
          const data = await res.json();

          const _completed = data.passedCount + data.failedCount;
          const isComplete = data.overallStatus !== 'review_required' || data.completedAt;

          if (isComplete) {
            setBranchBuilds((prev) => ({
              ...prev,
              [branch]: { ...prev[branch], status: 'completed', passedCount: data.passedCount, failedCount: data.failedCount, totalTests: data.totalTests },
            }));
            // Refresh branch info after completion
            const isBase = branch === baseBranch;
            fetchBranchInfo(branch, isBase);
            toast.success(`Build completed for ${branch}`);
          } else {
            setBranchBuilds((prev) => ({
              ...prev,
              [branch]: { ...prev[branch], passedCount: data.passedCount, failedCount: data.failedCount, totalTests: data.totalTests },
            }));
          }
        } catch {
          // Ignore poll errors
        }
      }
    };

    const interval = setInterval(pollBuilds, 2000);
    pollBuilds();

    return () => clearInterval(interval);
  }, [branchBuilds, baseBranch, targetBranch, fetchBranchInfo]);

  const handleRunBranch = async (branch: string) => {
    try {
      const result = await queueRunForBranch(branch, repositoryId);

      if (result.queued || !result.buildId) {
        toast.info(`Build queued for ${branch}`);
        return;
      }

      toast.info(`Build started for ${branch}`);
      const buildId = result.buildId!;
      setBranchBuilds((prev) => ({
        ...prev,
        [branch]: {
          buildId,
          status: 'running',
          passedCount: 0,
          failedCount: 0,
          totalTests: 0,
        },
      }));
    } catch (error) {
      console.error('Failed to start build:', error);
      toast.error('Failed to start build');
    }
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
                buildState={branchBuilds[baseBranch] || null}
                isLoading={isLoadingBase}
                onRun={() => handleRunBranch(baseBranch)}
                onRerun={() => handleRunBranch(baseBranch)}
                expandedTests={expandedTests}
                onToggleTest={toggleTest}
                activeBranch={activeBranch}
                scrollRef={baseScrollRef}
                onScroll={handleBaseScroll}
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
                buildState={branchBuilds[targetBranch] || null}
                isLoading={isLoadingTarget}
                onRun={() => handleRunBranch(targetBranch)}
                onRerun={() => handleRunBranch(targetBranch)}
                expandedTests={expandedTests}
                onToggleTest={toggleTest}
                activeBranch={activeBranch}
                scrollRef={targetScrollRef}
                onScroll={handleTargetScroll}
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
