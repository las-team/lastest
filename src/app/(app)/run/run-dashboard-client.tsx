'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
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
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { createAndRunBuild } from '@/server/actions/builds';
import type { BuildChanges } from '@/server/actions/builds';
import { testServerConnection, saveEnvironmentConfig } from '@/server/actions/environment';
import { useNotifyJobStarted } from '@/components/queue/job-polling-context';
import { ExecutionTargetSelector } from '@/components/execution/execution-target-selector';
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
  baseUrl: string;
  buildChanges?: BuildChanges | null;
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

export function RunDashboardClient({ tests, runs, builds, repositoryId, activeBranch, baseUrl: initialBaseUrl, buildChanges }: RunDashboardClientProps) {
  const router = useRouter();
  const notifyJobStarted = useNotifyJobStarted();
  const [isRunning, setIsRunning] = useState(false);
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; responseTime?: number; statusCode?: number; error?: string } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [urlHistory, setUrlHistory] = useState<string[]>([]);
  const initialBaseUrlRef = useRef(initialBaseUrl);
  const [executionTarget, setExecutionTarget] = useState<string>('local');

  useEffect(() => {
    setUrlHistory(getUrlHistory());
    // Auto-test on mount
    testServerConnection(initialBaseUrl).then((result) => {
      setTestResult({ success: result.success, responseTime: result.responseTime, statusCode: result.statusCode, error: result.error });
    });
  }, []);

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
    }
    // Always test on blur
    setIsTesting(true);
    setTestResult(null);
    const result = await testServerConnection(baseUrl);
    setTestResult({ success: result.success, responseTime: result.responseTime, statusCode: result.statusCode, error: result.error });
    setIsTesting(false);
  };

  const handleRunAll = async () => {
    setIsRunning(true);
    try {
      await saveAndTestBaseUrl();
      const { buildId, testRunId } = await createAndRunBuild('manual', undefined, repositoryId, executionTarget);
      notifyJobStarted();
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
                    ) : (
                      <Play className="h-4 w-4 mr-2" />
                    )}
                    Run All Tests
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
                <div className="flex items-center gap-1 text-xs text-muted-foreground/70">
                  <HelpCircle className="h-3 w-3" />
                  <span>Tests get faster over time as selectors are optimized</span>
                </div>
              </div>
            </CardContent>
          </Card>

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
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Changes</CardTitle>
              <CardDescription className="text-xs">Latest build vs. baseline</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {!buildChanges ? (
                <p className="text-sm text-muted-foreground">Run builds to see changes here</p>
              ) : buildChanges.topChanges.length === 0 && (!buildChanges.passingDelta) ? (
                <p className="text-sm text-muted-foreground">No changes found :)</p>
              ) : (
                <>
                  {builds.length >= 2 && (() => {
                    const chartBuilds = [...builds].reverse();
                    const data = chartBuilds.map(b => b.passedCount ?? 0);
                    const max = Math.max(...data, 1);
                    const min = Math.min(...data, 0);
                    const range = max - min || 1;
                    const w = 200, h = 48, px = 8, py = 6;
                    const points = data.map((v, i) => ({
                      x: px + (i / (data.length - 1)) * (w - 2 * px),
                      y: py + (1 - (v - min) / range) * (h - 2 * py),
                    }));
                    const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
                    const areaPath = `${line} L${points[points.length - 1].x},${h - py} L${points[0].x},${h - py} Z`;
                    const latest = data[data.length - 1];
                    const prev = data[data.length - 2];
                    const delta = latest - prev;
                    return (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">Passing tests</span>
                          <div className="flex items-center gap-1.5 text-xs">
                            <span className="font-medium">{latest}</span>
                            {delta !== 0 && (
                              <span className={delta > 0 ? 'text-green-600' : 'text-red-600'}>
                                {delta > 0 ? '+' : ''}{delta}
                              </span>
                            )}
                          </div>
                        </div>
                        <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-12" preserveAspectRatio="none">
                          <defs>
                            <linearGradient id="passGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="rgb(34,197,94)" stopOpacity="0.2" />
                              <stop offset="100%" stopColor="rgb(34,197,94)" stopOpacity="0" />
                            </linearGradient>
                          </defs>
                          <path d={areaPath} fill="url(#passGrad)" />
                          <path d={line} fill="none" stroke="rgb(34,197,94)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          {points.map((p, i) => (
                            <circle key={i} cx={p.x} cy={p.y} r={i === points.length - 1 ? 3 : 1.5} fill="rgb(34,197,94)" />
                          ))}
                        </svg>
                      </div>
                    );
                  })()}
                  {buildChanges.topChanges.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="text-xs text-muted-foreground font-medium">Top changes</div>
                      {buildChanges.topChanges.map((change, i) => (
                        <div key={i} className="flex items-center justify-between text-xs">
                          <span className="truncate flex-1 mr-2">{change.testName}</span>
                          <span className="text-yellow-600 font-medium shrink-0">{change.percentageDifference.toFixed(1)}%</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
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
                  {(() => {
                    const baselineBuildId = builds.find(b => b.overallStatus === 'safe_to_merge')?.id;
                    return builds.slice(0, 10).map((build) => (
                      <BuildSummaryCard
                        key={build.id}
                        build={build}
                        gitBranch={build.gitBranch}
                        isActiveBranch={build.gitBranch === activeBranch}
                        baseUrl={build.baseUrl || undefined}
                        isBaseline={build.id === baselineBuildId}
                      />
                    ));
                  })()}
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
