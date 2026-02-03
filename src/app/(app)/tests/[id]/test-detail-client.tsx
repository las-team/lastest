'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Play, Trash2, Copy, Edit2, Clock, CheckCircle, XCircle, X, Save, Wrench, Wand2, Loader2, History, RotateCcw, ChevronDown, ChevronRight, Monitor, Video, AlertTriangle, Image } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { deleteTest, updateTest, getTestVersionHistory, restoreTestVersion, getVisualDiffsForTestResult } from '@/server/actions/tests';
import { runTests, getJobStatus } from '@/server/actions/runs';
import { aiFixTest, aiEnhanceTest, updateTestCode } from '@/server/actions/ai';
import { toast } from 'sonner';
import { useNotifyJobStarted } from '@/components/queue/job-polling-context';
import type { Test, TestVersion, VisualDiff } from '@/lib/db/schema';
import type { ScreenshotGroup } from '@/server/actions/tests';

interface StepDiff {
  stepLabel: string | null;
  classification: string | null;
  status: string | null;
  currentImagePath: string | null;
}

interface TestResult {
  id: string;
  testRunId: string | null;
  testId: string | null;
  status: string | null;
  screenshotPath: string | null;
  diffPath: string | null;
  errorMessage: string | null;
  durationMs: number | null;
  viewport: string | null;
  browser: string | null;
  consoleErrors: string[] | null;
  networkRequests: unknown[] | null;
  startedAt: Date | null;
}

interface TestDetailClientProps {
  test: Test;
  results: TestResult[];
  repositoryId?: string | null;
  screenshotGroups?: ScreenshotGroup[];
}

export function TestDetailClient({ test, results, repositoryId, screenshotGroups = [] }: TestDetailClientProps) {
  const router = useRouter();
  const notifyJobStarted = useNotifyJobStarted();
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editName, setEditName] = useState(test.name);
  const [editUrl, setEditUrl] = useState(test.targetUrl || '');
  const [editCode, setEditCode] = useState(test.code || '');

  // Run state
  const [isRunning, setIsRunning] = useState(false);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup poll interval on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  // AI Fix/Enhance states
  const [isFixing, setIsFixing] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [enhancePrompt, setEnhancePrompt] = useState('');

  // Version history state
  const [versions, setVersions] = useState<TestVersion[]>([]);
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);
  const [isRestoring, setIsRestoring] = useState<number | null>(null);

  // Run history expand state
  const [expandedRuns, setExpandedRuns] = useState<Set<string>>(new Set());
  const [runDiffs, setRunDiffs] = useState<Map<string, StepDiff[]>>(new Map());
  const [loadingDiffs, setLoadingDiffs] = useState<Set<string>>(new Set());

  const latestResult = results[0];

  const toggleRunExpanded = async (resultId: string) => {
    const newExpanded = new Set(expandedRuns);
    if (newExpanded.has(resultId)) {
      newExpanded.delete(resultId);
    } else {
      newExpanded.add(resultId);
      // Load diffs if not already loaded
      if (!runDiffs.has(resultId)) {
        setLoadingDiffs(prev => new Set(prev).add(resultId));
        try {
          const diffs = await getVisualDiffsForTestResult(resultId);
          setRunDiffs(prev => new Map(prev).set(resultId, diffs.map(d => ({
            stepLabel: d.stepLabel,
            classification: d.classification,
            status: d.status,
            currentImagePath: d.currentImagePath,
          }))));
        } catch {
          // Ignore errors
        } finally {
          setLoadingDiffs(prev => {
            const next = new Set(prev);
            next.delete(resultId);
            return next;
          });
        }
      }
    }
    setExpandedRuns(newExpanded);
  };

  const getDiffStatusIcon = (diff: StepDiff) => {
    if (diff.status === 'approved' || diff.classification === 'unchanged') {
      return <CheckCircle className="h-3 w-3 text-green-500" />;
    }
    if (diff.classification === 'flaky') {
      return <AlertTriangle className="h-3 w-3 text-yellow-500" />;
    }
    if (diff.classification === 'changed') {
      return <XCircle className="h-3 w-3 text-red-500" />;
    }
    return <Image className="h-3 w-3 text-muted-foreground" />;
  };

  const loadVersions = async () => {
    setIsLoadingVersions(true);
    try {
      const history = await getTestVersionHistory(test.id);
      setVersions(history);
    } catch {
      toast.error('Failed to load version history');
    } finally {
      setIsLoadingVersions(false);
    }
  };

  const handleRestore = async (version: number) => {
    setIsRestoring(version);
    try {
      await restoreTestVersion(test.id, version);
      toast.success(`Restored to version ${version}`);
      router.refresh();
      loadVersions();
    } catch {
      toast.error('Failed to restore version');
    } finally {
      setIsRestoring(null);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await deleteTest(test.id);
      router.push('/tests');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleRun = async (headless = true) => {
    // Clear any existing poll interval
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }

    setIsRunning(true);
    try {
      const { jobId } = await runTests([test.id], repositoryId, headless);
      notifyJobStarted();
      toast.success(headless ? 'Test started' : 'Test started (headed mode)');
      // Poll job status for completion (ensures results are saved before refresh)
      pollIntervalRef.current = setInterval(async () => {
        const { isComplete } = await getJobStatus(jobId);
        if (isComplete) {
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
          setIsRunning(false);
          router.refresh();
          toast.success('Test completed');
        }
      }, 1000);
    } catch (error) {
      setIsRunning(false);
      toast.error(error instanceof Error ? error.message : 'Failed to run test');
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await updateTest(test.id, {
        name: editName,
        targetUrl: editUrl || null,
        code: editCode,
      });
      setIsEditing(false);
      router.refresh();
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setEditName(test.name);
    setEditUrl(test.targetUrl || '');
    setEditCode(test.code || '');
    setIsEditing(false);
  };

  const handleFix = async () => {
    if (!repositoryId) return;
    setIsFixing(true);
    try {
      const errorMsg = latestResult?.errorMessage || 'Test needs fixing';
      const result = await aiFixTest(repositoryId, test.id, errorMsg);
      if (result.success && result.code) {
        await updateTestCode(test.id, result.code, 'ai_fix');
        toast.success('Test fixed and saved');
        router.refresh();
      } else {
        toast.error(result.error || 'Failed to fix test');
      }
    } catch {
      toast.error('Failed to fix test');
    } finally {
      setIsFixing(false);
    }
  };

  const handleEnhance = async () => {
    if (!repositoryId) return;
    setIsEnhancing(true);
    try {
      const result = await aiEnhanceTest(repositoryId, test.id, enhancePrompt || undefined);
      if (result.success && result.code) {
        await updateTestCode(test.id, result.code, 'ai_enhance');
        toast.success('Test enhanced and saved');
        setEnhancePrompt('');
        router.refresh();
      } else {
        toast.error(result.error || 'Failed to enhance test');
      }
    } catch {
      toast.error('Failed to enhance test');
    } finally {
      setIsEnhancing(false);
    }
  };

  return (
    <div className="flex-1 p-6 overflow-auto">
      <div className="max-w-4xl space-y-6">
        {/* Test Info Card */}
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div className="flex-1 mr-4">
                {isEditing ? (
                  <div className="space-y-2">
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="text-xl font-semibold"
                    />
                    <Input
                      value={editUrl}
                      onChange={(e) => setEditUrl(e.target.value)}
                      placeholder="https://example.com"
                      className="text-sm text-muted-foreground"
                    />
                  </div>
                ) : (
                  <>
                    <CardTitle className="flex items-center gap-2">
                      {test.name}
                    </CardTitle>
                    <CardDescription>
                      {test.targetUrl || 'No target URL'}
                    </CardDescription>
                  </>
                )}
              </div>

              <div className="flex gap-2">
                {isEditing ? (
                  <>
                    <Button onClick={handleSave} disabled={isSaving}>
                      <Save className="h-4 w-4 mr-2" />
                      {isSaving ? 'Saving...' : 'Save'}
                    </Button>
                    <Button variant="outline" onClick={handleCancel}>
                      <X className="h-4 w-4 mr-2" />
                      Cancel
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="flex">
                      <Button
                        onClick={() => handleRun(true)}
                        disabled={isRunning}
                        className="rounded-r-none"
                      >
                        {isRunning ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Play className="h-4 w-4 mr-2" />
                        )}
                        {isRunning ? 'Running...' : 'Run'}
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="default"
                            size="icon"
                            disabled={isRunning}
                            className="rounded-l-none border-l border-l-primary-foreground/20"
                          >
                            <ChevronDown className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleRun(true)}>
                            <Play className="h-4 w-4 mr-2" />
                            Run (Headless)
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleRun(false)}>
                            <Monitor className="h-4 w-4 mr-2" />
                            Run Headed
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    {repositoryId && (
                      <Button
                        variant="outline"
                        onClick={handleFix}
                        disabled={isFixing}
                        title="Fix with AI"
                      >
                        {isFixing ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Wrench className="h-4 w-4 mr-2" />
                        )}
                        {isFixing ? 'Fixing...' : 'Fix'}
                      </Button>
                    )}
                    <Button variant="outline" size="icon" onClick={() => setIsEditing(true)} title="Edit">
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => router.push(`/record?rerecordId=${test.id}`)}
                      title="Re-record"
                    >
                      <Video className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="icon" title="Copy">
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => setShowDeleteDialog(true)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>
            </div>
          </CardHeader>

          <CardContent>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Status</span>
                <div className="flex items-center gap-2 mt-1">
                  {latestResult?.status === 'passed' ? (
                    <>
                      <CheckCircle className="h-4 w-4 text-green-500" />
                      <span className="text-green-600">Passed</span>
                    </>
                  ) : latestResult?.status === 'failed' ? (
                    <>
                      <XCircle className="h-4 w-4 text-destructive" />
                      <span className="text-destructive">Failed</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">Not run</span>
                  )}
                </div>
              </div>

              <div>
                <span className="text-muted-foreground">Last Run</span>
                <div className="flex items-center gap-2 mt-1">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span>
                    {latestResult?.durationMs
                      ? `${latestResult.durationMs}ms`
                      : 'Never'}
                  </span>
                </div>
              </div>

              <div>
                <span className="text-muted-foreground">Created</span>
                <div className="mt-1">
                  {test.createdAt
                    ? new Date(test.createdAt).toLocaleDateString()
                    : 'Unknown'}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tabs for Code, Screenshots, History */}
        <Tabs defaultValue="code">
          <TabsList>
            <TabsTrigger value="code">Code</TabsTrigger>
            <TabsTrigger value="screenshots">Screenshots</TabsTrigger>
            <TabsTrigger value="history">Run History</TabsTrigger>
            <TabsTrigger value="versions" onClick={loadVersions}>Versions</TabsTrigger>
          </TabsList>

          <TabsContent value="code" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Test Code</CardTitle>
              </CardHeader>
              <CardContent>
                {isEditing ? (
                  <Textarea
                    value={editCode}
                    onChange={(e) => setEditCode(e.target.value)}
                    className="font-mono text-sm min-h-[300px]"
                  />
                ) : (
                  <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm font-mono">
                    {test.code || '// No code generated yet'}
                  </pre>
                )}
              </CardContent>
            </Card>

            {/* Inline AI Enhance */}
            {repositoryId && !isEditing && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Wand2 className="h-4 w-4" />
                    Enhance with AI
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-2">
                    <Input
                      value={enhancePrompt}
                      onChange={(e) => setEnhancePrompt(e.target.value)}
                      placeholder="Add assertions, improve selectors, test edge cases..."
                      disabled={isEnhancing}
                      onKeyDown={(e) => e.key === 'Enter' && !isEnhancing && handleEnhance()}
                    />
                    <Button onClick={handleEnhance} disabled={isEnhancing}>
                      {isEnhancing ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Wand2 className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Leave empty for general improvements
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="screenshots" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Screenshot Timeline</CardTitle>
              </CardHeader>
              <CardContent>
                {screenshotGroups.length > 0 ? (
                  <div className="space-y-6">
                    {screenshotGroups.map((group) => (
                      <div key={group.runId} className="space-y-3">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground border-b pb-2">
                          <Clock className="h-4 w-4" />
                          <span>
                            {group.startedAt
                              ? new Date(group.startedAt).toLocaleString()
                              : 'Unknown time'}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          {group.screenshots.map((src, i) => {
                            const filename = src.split('/').pop() || '';
                            // Extract label from filename (after runId-testId-)
                            const parts = filename.split('-');
                            const label = parts.slice(10).join(' ').replace('.png', '') || 'screenshot';
                            return (
                              <div key={i} className="space-y-1">
                                <a
                                  href={src}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="block"
                                >
                                  <img
                                    src={src}
                                    alt={label || 'Screenshot'}
                                    className="w-full rounded-lg border hover:opacity-90 transition-opacity"
                                  />
                                </a>
                                <p className="text-xs text-muted-foreground text-center capitalize">{label}</p>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    No screenshots captured yet
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Run History</CardTitle>
              </CardHeader>
              <CardContent>
                {results.length > 0 ? (
                  <div className="space-y-2">
                    {results.map((result) => (
                      <div
                        key={result.id}
                        className="border rounded-lg"
                      >
                        <button
                          onClick={() => toggleRunExpanded(result.id)}
                          className="w-full p-3 flex items-center justify-between hover:bg-muted/50 transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            {expandedRuns.has(result.id) ? (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            )}
                            {result.status === 'passed' ? (
                              <CheckCircle className="h-4 w-4 text-green-500" />
                            ) : (
                              <XCircle className="h-4 w-4 text-destructive" />
                            )}
                            <span className="capitalize">{result.status}</span>
                          </div>
                          <div className="flex items-center gap-4 text-sm text-muted-foreground">
                            <span>{result.durationMs}ms</span>
                            <span>
                              {result.startedAt
                                ? new Date(result.startedAt).toLocaleString()
                                : 'Unknown'}
                            </span>
                          </div>
                        </button>

                        {expandedRuns.has(result.id) && (
                          <div className="px-3 pb-3 border-t">
                            {result.status === 'failed' && result.errorMessage && (
                              <div className="mt-2 p-2 bg-destructive/10 border border-destructive/20 rounded text-sm text-destructive">
                                <pre className="whitespace-pre-wrap font-mono text-xs overflow-x-auto">
                                  {result.errorMessage}
                                </pre>
                              </div>
                            )}

                            {loadingDiffs.has(result.id) ? (
                              <div className="flex items-center gap-2 mt-3 text-sm text-muted-foreground">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Loading steps...
                              </div>
                            ) : runDiffs.has(result.id) && runDiffs.get(result.id)!.length > 0 ? (
                              <div className="mt-3 space-y-2">
                                <div className="text-xs font-medium text-muted-foreground uppercase">Steps</div>
                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                                  {runDiffs.get(result.id)!.map((diff, i) => (
                                    <div key={i} className="border rounded p-2 space-y-1">
                                      <div className="flex items-center gap-1.5">
                                        {getDiffStatusIcon(diff)}
                                        <span className="text-xs font-medium capitalize">
                                          {diff.stepLabel || `step ${i + 1}`}
                                        </span>
                                      </div>
                                      {diff.currentImagePath && (
                                        <a
                                          href={diff.currentImagePath}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="block"
                                        >
                                          <img
                                            src={diff.currentImagePath}
                                            alt={diff.stepLabel || `step ${i + 1}`}
                                            className="w-full h-16 object-cover rounded border hover:opacity-90"
                                          />
                                        </a>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : (
                              <div className="mt-3 text-xs text-muted-foreground">
                                No visual diff data for this run
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    No run history
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="versions" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <History className="h-4 w-4" />
                  Version History
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isLoadingVersions ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : versions.length > 0 ? (
                  <div className="space-y-2">
                    {versions.map((version) => (
                      <div
                        key={version.id}
                        className="p-3 border rounded-lg"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <span className="font-mono text-sm font-medium">v{version.version}</span>
                            <span className="text-xs px-2 py-0.5 rounded bg-muted capitalize">
                              {version.changeReason?.replace(/_/g, ' ') || 'manual edit'}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">
                              {version.createdAt
                                ? new Date(version.createdAt).toLocaleString()
                                : 'Unknown'}
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRestore(version.version)}
                              disabled={isRestoring !== null}
                            >
                              {isRestoring === version.version ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <RotateCcw className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                        </div>
                        <div className="mt-2 text-xs text-muted-foreground truncate">
                          {version.name}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    No version history yet. Versions are created when you edit the test.
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Test</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{test.name}&quot;? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
