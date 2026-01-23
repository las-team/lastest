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
} from 'lucide-react';
import { createAndRunBuild } from '@/server/actions/builds';
import { testServerConnection, saveEnvironmentConfig } from '@/server/actions/environment';
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

export function RunDashboardClient({ tests, runs, builds, repositoryId, activeBranch, baseUrl: initialBaseUrl }: RunDashboardClientProps) {
  const router = useRouter();
  const [isRunning, setIsRunning] = useState(false);
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; responseTime?: number } | null>(null);
  const [urlHistory, setUrlHistory] = useState<string[]>([]);
  const initialBaseUrlRef = useRef(initialBaseUrl);

  useEffect(() => {
    setUrlHistory(getUrlHistory());
    // Auto-test on mount
    testServerConnection(initialBaseUrl).then((result) => {
      setTestResult({ success: result.success, responseTime: result.responseTime });
    });
  }, []);

  const saveBaseUrl = async () => {
    if (baseUrl === initialBaseUrlRef.current) return;
    pushUrlHistory(baseUrl);
    setUrlHistory(getUrlHistory());
    initialBaseUrlRef.current = baseUrl;
    await saveEnvironmentConfig({
      repositoryId,
      mode: 'manual',
      baseUrl,
    });
  };

  const handleTest = async () => {
    setIsTesting(true);
    setTestResult(null);
    const result = await testServerConnection(baseUrl);
    setTestResult({ success: result.success, responseTime: result.responseTime });
    setIsTesting(false);
  };

  const handleRunAll = async () => {
    setIsRunning(true);
    try {
      await saveBaseUrl();
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

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Base URL</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Input
                  value={baseUrl}
                  onChange={(e) => { setBaseUrl(e.target.value); setTestResult(null); }}
                  onBlur={saveBaseUrl}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur(); } }}
                  list="baseurl-history"
                  placeholder="http://localhost:3000"
                  className="text-sm"
                />
                <datalist id="baseurl-history">
                  {urlHistory.map((url) => (
                    <option key={url} value={url} />
                  ))}
                </datalist>
                <Button variant="outline" size="sm" onClick={handleTest} disabled={isTesting}>
                  {isTesting ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Test'}
                </Button>
                {testResult && (
                  <div className="flex items-center gap-1 text-xs whitespace-nowrap">
                    {testResult.success ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 text-red-500" />
                    )}
                    {testResult.responseTime != null && (
                      <span className="text-muted-foreground">{testResult.responseTime}ms</span>
                    )}
                  </div>
                )}
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
