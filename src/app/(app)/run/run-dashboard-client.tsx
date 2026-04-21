'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { usePreferredRunner } from '@/hooks/use-preferred-runner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Play,
  Loader2,
  FileCode,
  Package,
  CheckCircle2,
  XCircle,
  Globe,
  Monitor,
  HelpCircle,
  GitBranch,
  GitCompare,
  Zap,
  ChevronDown,
  ChevronRight,
  List,
  AlertTriangle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { createAndRunBuild, createComparisonRun } from '@/server/actions/builds';
import { analyzeSmartRun, runSmartBuild, type SmartRunAnalysis } from '@/server/actions/smart-run';
import { testServerConnection, saveEnvironmentConfig, saveBranchBaseUrl } from '@/server/actions/environment';
import { updateComparisonRunSettings } from '@/server/actions/repos';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useNotifyJobStarted } from '@/components/queue/job-polling-context';
import { ExecutionTargetSelector } from '@/components/execution/execution-target-selector';
import type { Test, TestRun, Build } from '@/lib/db/schema';
import { BuildSummaryCard } from '@/components/builds/build-summary-card';
import { BuildGraphView } from '@/components/builds/build-graph-view';
import { BranchSelector } from '@/components/settings/branch-selector';
import { ReviewContent, type TodoRow } from '@/components/review/review-content';
import type { VisualDiffWithTestStatus } from '@/lib/db/schema';
import { cn } from '@/lib/utils';

interface BuildWithBranch extends Build {
  gitBranch?: string;
  gitCommit?: string;
}

interface ComposeConfigProp {
  selectedTestIds: string[] | null;
  versionOverrides: Record<string, string> | null;
}

interface RunDashboardClientProps {
  tests: Test[];
  runs: TestRun[];
  builds: BuildWithBranch[];
  repositoryId?: string | null;
  activeBranch?: string;
  currentBranch: string | null;
  defaultBranch: string | null;
  baseUrl: string;
  branchHeads?: Record<string, string>;
  initialTodos: TodoRow[];
  initialDiffs: VisualDiffWithTestStatus[];
  latestBuildId: string | null;
  composeConfig?: ComposeConfigProp | null;
  banAiMode?: boolean;
  comparisonRunEnabled?: boolean;
  comparisonBaselineBranch?: string | null;
  branches?: string[];
  branchBaseUrls?: Record<string, string> | null;
}

const HISTORY_KEY = 'baseurl-history';

function getUrlHistory(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch {
    return [];
  }
}

function pushUrlHistory(url: string) {
  const history = getUrlHistory().filter((u) => u !== url);
  history.unshift(url);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 5)));
}

function isLocalUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0';
  } catch {
    return true;
  }
}

export function RunDashboardClient({ tests, runs: _runs, builds, repositoryId, activeBranch, currentBranch, defaultBranch, baseUrl: initialBaseUrl, branchHeads, initialTodos, initialDiffs, latestBuildId, composeConfig, banAiMode = false, comparisonRunEnabled: initialComparisonEnabled = false, comparisonBaselineBranch: initialBaselineBranch, branches = [], branchBaseUrls }: RunDashboardClientProps) {
  const router = useRouter();
  const notifyJobStarted = useNotifyJobStarted();
  const [isRunning, setIsRunning] = useState(false);
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl);

  // Comparison run state
  const [comparisonEnabled, setComparisonEnabled] = useState(initialComparisonEnabled);
  const [baselineBranch, setBaselineBranch] = useState(initialBaselineBranch || defaultBranch || 'main');
  const [baselineUrl, setBaselineUrl] = useState(branchBaseUrls?.[initialBaselineBranch || defaultBranch || 'main'] || initialBaseUrl);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; responseTime?: number; statusCode?: number; error?: string } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [urlHistory, setUrlHistory] = useState<string[]>([]);
  const initialBaseUrlRef = useRef(initialBaseUrl);
  const [executionTarget, setExecutionTarget] = usePreferredRunner();
  const [smartAnalysis, setSmartAnalysis] = useState<SmartRunAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSmartRunning, setIsSmartRunning] = useState(false);
  const [showSmartDetails, setShowSmartDetails] = useState(false);
  const [buildView, setBuildView] = useState<'list' | 'graph'>('graph');

  // Sync base URL state when repo/branch changes
  useEffect(() => {
    setBaseUrl(initialBaseUrl);
    initialBaseUrlRef.current = initialBaseUrl;
  }, [initialBaseUrl]);

  // Sync baseline URL when branch base URLs change
  useEffect(() => {
    setBaselineUrl(branchBaseUrls?.[baselineBranch] || initialBaseUrl);
  }, [branchBaseUrls, baselineBranch, initialBaseUrl]);

  // Load smart run analysis (uses GitHub API to compare branches)
  useEffect(() => {
    if (repositoryId) {
      setIsAnalyzing(true);
      analyzeSmartRun(repositoryId).then((analysis) => {
        setSmartAnalysis(analysis);
        setIsAnalyzing(false);
      });
    }
  }, [repositoryId]);

  const handleSmartRun = async () => {
    if (!smartAnalysis?.isAvailable) return;
    setIsSmartRunning(true);
    try {
      await saveAndTestBaseUrl();

      // If compose config exists, intersect smart-run tests with composed selection
      if (composeConfig?.selectedTestIds) {
        const composedSet = new Set(composeConfig.selectedTestIds);
        const filteredTestIds = smartAnalysis.affectedTests
          .map(t => t.testId)
          .filter(id => composedSet.has(id));

        if (filteredTestIds.length === 0) {
          console.error('Smart run: no tests after intersecting with compose config');
          return;
        }

        const versionOverrides = composeConfig.versionOverrides ?? undefined;
        const result = await createAndRunBuild('manual', filteredTestIds, repositoryId, executionTarget, versionOverrides);
        notifyJobStarted();
        if ('queued' in result && result.queued) {
          toast.info('All browsers are busy — build queued and will start automatically');
        } else {
          router.push(`/builds/${result.buildId}`);
        }
      } else {
        const result = await runSmartBuild(repositoryId ?? null, executionTarget);
        if ('error' in result) {
          console.error('Smart run failed:', result.error);
        } else {
          notifyJobStarted();
          router.push(`/builds/${result.buildId}`);
        }
      }
    } catch (error) {
      console.error('Failed to start smart run:', error);
    } finally {
      setIsSmartRunning(false);
    }
  };

  useEffect(() => {
    setUrlHistory(getUrlHistory());
    // Auto-test on mount
    testServerConnection(initialBaseUrl).then((result) => {
      setTestResult({ success: result.success, responseTime: result.responseTime, statusCode: result.statusCode, error: result.error });
    });
  }, [initialBaseUrl]);

  const saveAndTestBaseUrl = async () => {
    if (baseUrl !== initialBaseUrlRef.current) {
      pushUrlHistory(baseUrl);
      setUrlHistory(getUrlHistory());
      initialBaseUrlRef.current = baseUrl;
      await saveEnvironmentConfig({
        repositoryId,
        mode: 'manual',
        baseUrl,
      });
      if (repositoryId && activeBranch) {
        await saveBranchBaseUrl(repositoryId, activeBranch, baseUrl);
      }
    }
    // Always test on blur
    setIsTesting(true);
    setTestResult(null);
    const result = await testServerConnection(baseUrl);
    setTestResult({ success: result.success, responseTime: result.responseTime, statusCode: result.statusCode, error: result.error });
    setIsTesting(false);
  };

  // Determine composed test count for UI indicator
  const composedTestCount = composeConfig?.selectedTestIds ? composeConfig.selectedTestIds.length : null;
  const hasComposeConfig = composedTestCount !== null && composedTestCount < tests.length;

  const handleRunAll = async () => {
    setIsRunning(true);
    try {
      await saveAndTestBaseUrl();
      const testIds = composeConfig?.selectedTestIds ?? undefined;
      const versionOverrides = composeConfig?.versionOverrides ?? undefined;

      if (comparisonEnabled && repositoryId) {
        const featureBranch = activeBranch || currentBranch || 'main';
        const { baselineBuildId } = await createComparisonRun(
          repositoryId,
          baselineBranch,
          baselineUrl,
          featureBranch,
          baseUrl,
          executionTarget,
          testIds,
          versionOverrides,
        );
        notifyJobStarted();
        router.push(`/builds/${baselineBuildId}`);
      } else {
        const result = await createAndRunBuild('manual', testIds, repositoryId, executionTarget, versionOverrides);
        notifyJobStarted();
        if ('queued' in result && result.queued) {
          toast.info('All browsers are busy — build queued and will start automatically');
        } else {
          router.push(`/builds/${result.buildId}`);
        }
      }
    } catch (error) {
      console.error('Failed to start build:', error);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="flex-1 p-6 overflow-auto">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-6xl mx-auto">
        {/* Right Column - Run Tests */}
        <div className="space-y-6 lg:order-2">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Run Tests</CardTitle>
                  <CardDescription>
                    Execute all tests or select specific ones
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <ExecutionTargetSelector
                    value={executionTarget}
                    onChange={setExecutionTarget}
                    disabled={isRunning}
                    capabilityFilter="run"
                    size="sm"
                  />
                  <Button
                    onClick={handleRunAll}
                    disabled={isRunning || tests.length === 0}
                    size="lg"
                  >
                    {isRunning ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : comparisonEnabled ? (
                      <GitCompare className="h-4 w-4 mr-2" />
                    ) : (
                      <Play className="h-4 w-4 mr-2" />
                    )}
                    {comparisonEnabled
                      ? 'Run Comparison'
                      : hasComposeConfig ? `Run ${composedTestCount} Tests` : 'Run All Tests'}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <div className="flex items-center gap-1">
                  <FileCode className="h-4 w-4" />
                  {tests.length} test{tests.length !== 1 ? 's' : ''}
                </div>
                {hasComposeConfig && (
                  <Badge variant="outline" className="text-[10px] gap-0.5 px-1.5 py-0 bg-blue-50 text-blue-700 border-blue-200">
                    {composedTestCount} composed
                  </Badge>
                )}
                <div className="flex items-center gap-1 text-xs text-muted-foreground/70">
                  <HelpCircle className="h-3 w-3" />
                  <span>Tests get faster over time as selectors are optimized</span>
                </div>
              </div>
              {/* Comparison Run toggle */}
              {repositoryId && (
                <div className="mt-3 pt-3 border-t">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <GitCompare className="h-3.5 w-3.5 text-muted-foreground" />
                      <Label htmlFor="comparison-toggle" className="text-sm font-medium cursor-pointer">
                        Comparison Run
                      </Label>
                    </div>
                    <Switch
                      id="comparison-toggle"
                      checked={comparisonEnabled}
                      onCheckedChange={(checked) => {
                        setComparisonEnabled(checked);
                        updateComparisonRunSettings(repositoryId, checked, baselineBranch);
                      }}
                    />
                  </div>
                  {comparisonEnabled && (
                    <div className="mt-3 space-y-3">
                      <div className="flex items-center gap-2 p-2 rounded-md bg-amber-50 border border-amber-200 text-amber-800">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                        <span className="text-xs">
                          Baseline branch will be auto-approved, overwriting existing baselines.
                        </span>
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">Baseline Branch</span>
                          <Select
                            value={baselineBranch}
                            onValueChange={(val) => {
                              setBaselineBranch(val);
                              setBaselineUrl(branchBaseUrls?.[val] || initialBaseUrl);
                              updateComparisonRunSettings(repositoryId, true, val);
                            }}
                          >
                            <SelectTrigger className="w-[180px] h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {branches.length > 0 ? branches.map((b) => (
                                <SelectItem key={b} value={b} className="text-xs">{b}</SelectItem>
                              )) : (
                                <SelectItem value={defaultBranch || 'main'} className="text-xs">
                                  {defaultBranch || 'main'}
                                </SelectItem>
                              )}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <span className="text-xs text-muted-foreground">Baseline URL</span>
                          <Input
                            value={baselineUrl}
                            onChange={(e) => setBaselineUrl(e.target.value)}
                            onBlur={() => {
                              if (repositoryId && baselineBranch) {
                                saveBranchBaseUrl(repositoryId, baselineBranch, baselineUrl);
                              }
                            }}
                            placeholder="http://localhost:3000"
                            className="text-xs h-8 mt-1"
                          />
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        <span className="font-medium">Flow:</span> Run on {baselineBranch} ({baselineUrl}) → auto-set baselines → Run on {activeBranch || 'current branch'} ({baseUrl})
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Smart Run Card - Compares selected branch to default branch via GitHub API */}
          {!banAiMode && repositoryId && (isAnalyzing || smartAnalysis?.isAvailable) && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-yellow-500" />
                    <CardTitle className="text-sm font-medium">Smart Run</CardTitle>
                  </div>
                  {isAnalyzing ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : (
                    <Badge variant="outline" className="text-[10px] gap-0.5 px-1.5 py-0 bg-yellow-50 text-yellow-700 border-yellow-200">
                      Available
                    </Badge>
                  )}
                </div>
                <CardDescription className="text-xs">
                  Run only tests affected by your git changes
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {isAnalyzing ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Analyzing git diff...
                  </div>
                ) : smartAnalysis?.isAvailable && (
                  <>
                    {/* Branch comparison */}
                    <div className="flex items-center gap-2 text-xs">
                      <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="font-medium">{smartAnalysis.currentBranch}</span>
                      <span className="text-muted-foreground">→</span>
                      <span className="text-muted-foreground">{smartAnalysis.baseBranch}</span>
                    </div>

                    {/* Stats */}
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span>{smartAnalysis.changedFiles.length} files changed</span>
                      <span className="text-green-600 font-medium">
                        {smartAnalysis.affectedTests.length} tests to run
                      </span>
                      {smartAnalysis.skippedTests.length > 0 && (
                        <span>{smartAnalysis.skippedTests.length} skipped</span>
                      )}
                    </div>

                    {/* Expandable details */}
                    {smartAnalysis.affectedTests.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowSmartDetails(!showSmartDetails)}
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {showSmartDetails ? (
                          <ChevronDown className="h-3 w-3" />
                        ) : (
                          <ChevronRight className="h-3 w-3" />
                        )}
                        View affected tests
                      </button>
                    )}

                    {showSmartDetails && (
                      <div className="space-y-1 pl-4 border-l-2 border-muted">
                        {smartAnalysis.affectedTests.slice(0, 5).map((test) => (
                          <div key={test.testId} className="flex items-center justify-between text-xs">
                            <span className="truncate flex-1 mr-2">{test.testName}</span>
                            <Badge variant="outline" className="text-[9px] px-1 py-0">
                              {test.matchReason.replace('_', ' ')}
                            </Badge>
                          </div>
                        ))}
                        {smartAnalysis.affectedTests.length > 5 && (
                          <p className="text-xs text-muted-foreground">
                            +{smartAnalysis.affectedTests.length - 5} more
                          </p>
                        )}
                      </div>
                    )}

                    {/* Smart Run Button */}
                    <div className="flex items-center gap-2">
                      <ExecutionTargetSelector
                        value={executionTarget}
                        onChange={setExecutionTarget}
                        disabled={isSmartRunning}
                        capabilityFilter="run"
                        size="sm"
                      />
                      <Button
                        onClick={handleSmartRun}
                        disabled={isSmartRunning || smartAnalysis.affectedTests.length === 0}
                        size="sm"
                        variant="outline"
                        className="flex-1"
                      >
                        {isSmartRunning ? (
                          <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                        ) : (
                          <Zap className="h-3.5 w-3.5 mr-2" />
                        )}
                        Smart Run ({smartAnalysis.affectedTests.length} tests)
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Base URL</span>
                  <Badge variant="outline" className="text-[10px] gap-0.5 px-1.5 py-0">
                    {isLocalUrl(baseUrl) ? (
                      <><Monitor className="h-2.5 w-2.5" /> Local</>
                    ) : (
                      <><Globe className="h-2.5 w-2.5" /> Remote</>
                    )}
                  </Badge>
                </div>
                {isTesting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                ) : testResult && (
                  <div className="flex items-center gap-1 text-xs">
                    {testResult.success ? (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                        {testResult.responseTime != null && (
                          <span className="text-muted-foreground">{testResult.responseTime}ms</span>
                        )}
                      </>
                    ) : (
                      <>
                        <XCircle className="h-3.5 w-3.5 text-red-500" />
                        <span className="text-red-500">
                          {testResult.statusCode ? testResult.statusCode : 'unreachable'}
                        </span>
                      </>
                    )}
                  </div>
                )}
              </div>
              <div className="relative">
                <Input
                  value={baseUrl}
                  onChange={(e) => { setBaseUrl(e.target.value); setTestResult(null); setShowHistory(false); }}
                  onBlur={() => { setTimeout(() => setShowHistory(false), 150); saveAndTestBaseUrl(); }}
                  onFocus={() => { if (urlHistory.length > 0) setShowHistory(true); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur(); } }}
                  placeholder="http://localhost:3000"
                  className="text-sm pr-8"
                />
                {showHistory && urlHistory.length > 0 && (
                  <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-popover border rounded-md shadow-md py-1">
                    {urlHistory.filter(u => u !== baseUrl).map((url) => (
                      <button
                        key={url}
                        type="button"
                        className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent truncate"
                        onMouseDown={(e) => { e.preventDefault(); setBaseUrl(url); setShowHistory(false); setTestResult(null); }}
                      >
                        {url}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {repositoryId && (
                <div className="flex items-center justify-between mt-3 pt-3 border-t">
                  <div className="flex items-center gap-2">
                    <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-sm font-medium">Branch</span>
                  </div>
                  <BranchSelector
                    repositoryId={repositoryId}
                    currentBranch={currentBranch}
                    defaultBranch={defaultBranch}
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {repositoryId && (
            <ReviewContent
              initialTodos={initialTodos}
              initialDiffs={initialDiffs}
              latestBuildId={latestBuildId}
            />
          )}
        </div>

        {/* Left Column - Build History */}
        <div className="space-y-6 flex flex-col lg:order-1">
          <Card className="flex-1 flex flex-col">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Build History</CardTitle>
                  <CardDescription>
                    Recent build results and status
                  </CardDescription>
                </div>
                {builds.length > 0 && (
                  <div className="flex items-center rounded-md border p-0.5">
                    <button
                      type="button"
                      onClick={() => setBuildView('list')}
                      className={cn(
                        'inline-flex items-center justify-center rounded-sm px-2 py-1 text-xs transition-colors',
                        buildView === 'list'
                          ? 'bg-accent text-accent-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      <List className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setBuildView('graph')}
                      className={cn(
                        'inline-flex items-center justify-center rounded-sm px-2 py-1 text-xs transition-colors',
                        buildView === 'graph'
                          ? 'bg-accent text-accent-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      <GitBranch className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="flex-1">
              {builds.length > 0 ? (
                (() => {
                  const effectiveDefaultBranch = defaultBranch || 'main';
                  const mainBaselineBuildId = builds.find(b => b.overallStatus === 'safe_to_merge' && b.gitBranch === effectiveDefaultBranch)?.id;
                  const branchBaselineBuildId = currentBranch && currentBranch !== effectiveDefaultBranch
                    ? builds.find(b => b.overallStatus === 'safe_to_merge' && b.gitBranch === currentBranch)?.id
                    : undefined;
                  return buildView === 'graph' ? (
                    <BuildGraphView
                      builds={builds}
                      defaultBranch={defaultBranch}
                      mainBaselineBuildId={mainBaselineBuildId}
                      branchBaselineBuildId={branchBaselineBuildId}
                      branchHeads={branchHeads}
                    />
                  ) : (
                    <div className="space-y-3">
                      {builds.slice(0, 25).map((build) => (
                        <BuildSummaryCard
                          key={build.id}
                          build={build}
                          gitBranch={build.gitBranch}
                          gitCommit={build.gitCommit}
                          isActiveBranch={build.gitBranch === activeBranch}
                          baseUrl={build.baseUrl || undefined}
                          isMainBaseline={build.id === mainBaselineBuildId}
                          isBranchBaseline={build.id === branchBaselineBuildId}
                        />
                      ))}
                    </div>
                  );
                })()
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
