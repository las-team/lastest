'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Play, Loader2, ArrowLeft, Layers } from 'lucide-react';
import { createAndRunBuild } from '@/server/actions/builds';
import { ExecutionTargetSelector } from '@/components/execution/execution-target-selector';
import { useNotifyJobStarted } from '@/components/queue/job-polling-context';
import type { Test, TestVersion } from '@/lib/db/schema';

interface TestWithVersions extends Test {
  versions: TestVersion[];
  functionalAreaName: string | null;
}

interface ComposeClientProps {
  tests: TestWithVersions[];
  repositoryId: string;
  baseUrl: string;
  currentBranch: string | null;
  defaultBranch: string | null;
}

export function ComposeClient({ tests, repositoryId, baseUrl: initialBaseUrl, currentBranch, defaultBranch }: ComposeClientProps) {
  const router = useRouter();
  const notifyJobStarted = useNotifyJobStarted();
  const [selectedTestIds, setSelectedTestIds] = useState<Set<string>>(new Set(tests.map(t => t.id)));
  const [versionOverrides, setVersionOverrides] = useState<Record<string, string>>({});
  const [executionTarget, setExecutionTarget] = useState<string>('local');
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl);
  const [isRunning, setIsRunning] = useState(false);

  // Group tests by functional area
  const groupedTests = useMemo(() => {
    const groups: Record<string, TestWithVersions[]> = {};
    for (const test of tests) {
      const area = test.functionalAreaName || 'Ungrouped';
      (groups[area] ||= []).push(test);
    }
    return Object.entries(groups).sort(([a], [b]) =>
      a === 'Ungrouped' ? 1 : b === 'Ungrouped' ? -1 : a.localeCompare(b)
    );
  }, [tests]);

  const toggleTest = (testId: string) => {
    setSelectedTestIds(prev => {
      const next = new Set(prev);
      if (next.has(testId)) next.delete(testId);
      else next.add(testId);
      return next;
    });
  };

  const allSelected = tests.length > 0 && tests.every(t => selectedTestIds.has(t.id));
  const toggleAll = () => {
    if (allSelected) setSelectedTestIds(new Set());
    else setSelectedTestIds(new Set(tests.map(t => t.id)));
  };

  const handleVersionChange = (testId: string, versionId: string) => {
    setVersionOverrides(prev => {
      if (versionId === 'latest') {
        const next = { ...prev };
        delete next[testId];
        return next;
      }
      return { ...prev, [testId]: versionId };
    });
  };

  const handleRunBuild = async () => {
    if (selectedTestIds.size === 0) return;
    setIsRunning(true);
    try {
      const overrides = Object.keys(versionOverrides).length > 0 ? versionOverrides : undefined;
      const result = await createAndRunBuild(
        'manual',
        Array.from(selectedTestIds),
        repositoryId,
        executionTarget,
        overrides
      );
      notifyJobStarted();
      if (result.buildId) {
        router.push(`/builds/${result.buildId}`);
      }
    } catch (error) {
      console.error('Failed to start compose build:', error);
    } finally {
      setIsRunning(false);
    }
  };

  const formatReason = (reason: string | null) => {
    if (!reason) return '';
    return reason.replace(/_/g, ' ');
  };

  return (
    <div className="flex-1 p-6 overflow-auto">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => router.push('/run')}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-xl font-semibold flex items-center gap-2">
                <Layers className="h-5 w-5" />
                Compose Build
              </h1>
              <p className="text-sm text-muted-foreground">
                Select tests and versions to include in this build
              </p>
            </div>
          </div>
        </div>

        {/* Controls */}
        <Card>
          <CardContent className="pt-4 pb-4 px-4">
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Base URL</label>
                <Input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="http://localhost:3000"
                  className="text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Runner</label>
                <ExecutionTargetSelector
                  value={executionTarget}
                  onChange={setExecutionTarget}
                  disabled={isRunning}
                  capabilityFilter="run"
                  size="sm"
                />
              </div>
              <div className="flex items-end">
                <Button
                  onClick={handleRunBuild}
                  disabled={isRunning || selectedTestIds.size === 0}
                  size="lg"
                >
                  {isRunning ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4 mr-2" />
                  )}
                  Run Build ({selectedTestIds.size})
                </Button>
              </div>
            </div>
            {currentBranch && (
              <div className="text-xs text-muted-foreground mt-2">
                Branch: <span className="font-medium">{currentBranch}</span>
                {defaultBranch && currentBranch !== defaultBranch && (
                  <span> (default: {defaultBranch})</span>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Test Selection */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Tests</CardTitle>
                <CardDescription className="text-xs">
                  {selectedTestIds.size} of {tests.length} selected
                  {Object.keys(versionOverrides).length > 0 && (
                    <span> &middot; {Object.keys(versionOverrides).length} version override(s)</span>
                  )}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
                <span className="text-xs text-muted-foreground">Select all</span>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {groupedTests.map(([areaName, areaTests]) => (
                <div key={areaName}>
                  {groupedTests.length > 1 && (
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm font-medium text-muted-foreground">{areaName}</span>
                      <Badge variant="secondary" className="text-xs">{areaTests.length}</Badge>
                    </div>
                  )}
                  <div className="space-y-1">
                    {areaTests.map((test) => (
                      <div
                        key={test.id}
                        className={`flex items-center justify-between p-3 border rounded-lg transition-colors ${
                          selectedTestIds.has(test.id) ? 'border-primary/30 bg-primary/5' : 'opacity-60'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <Checkbox
                            checked={selectedTestIds.has(test.id)}
                            onCheckedChange={() => toggleTest(test.id)}
                          />
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate">{test.name}</div>
                            <div className="text-xs text-muted-foreground truncate">
                              {test.targetUrl || 'No URL'}
                            </div>
                          </div>
                        </div>
                        {test.versions.length > 0 && (
                          <Select
                            value={versionOverrides[test.id] || 'latest'}
                            onValueChange={(v) => handleVersionChange(test.id, v)}
                          >
                            <SelectTrigger className="w-48 h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="latest">Latest (current)</SelectItem>
                              {test.versions.map((v) => (
                                <SelectItem key={v.id} value={v.id}>
                                  v{v.version} — {formatReason(v.changeReason)}
                                  {v.branch && ` (${v.branch})`}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
