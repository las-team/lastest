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
import { Play, Trash2, Copy, Edit2, Clock, CheckCircle, XCircle, X, Save, Wrench, Wand2, Loader2, History, RotateCcw, ChevronDown, ChevronRight, Monitor, Video, AlertTriangle, Image, Bug, GitBranch, GitCommit } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { deleteTest, updateTest, getTestVersionHistory, restoreTestVersion, getVisualDiffsForTestResult, restoreTest, permanentlyDeleteTest } from '@/server/actions/tests';
import { runTests, getJobStatus } from '@/server/actions/runs';
import { aiFixTest, aiEnhanceTest, updateTestCode } from '@/server/actions/ai';
import { toast } from 'sonner';
import { useNotifyJobStarted } from '@/components/queue/job-polling-context';
import { ExecutionTargetSelector } from '@/components/execution/execution-target-selector';
import { StepScreenshotMatcher } from '@/components/planned/step-screenshot-matcher';
import { TestSetupOverrides } from '@/components/setup/test-setup-overrides';
import type { Test, TestVersion, PlannedScreenshot, SetupScript, GoogleSheetsDataSource } from '@/lib/db/schema';
import type { ScreenshotGroup } from '@/server/actions/tests';
import { SheetDataPreview } from '@/components/test-data/sheet-data-preview';
import { SheetReferenceInserter } from '@/components/test-data/sheet-reference-inserter';

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
  videoPath: string | null;
  startedAt: Date | null;
}

interface DefaultStepForUI {
  id: string;
  stepType: string;
  testId: string | null;
  scriptId: string | null;
  orderIndex: number;
  testName: string | null;
  scriptName: string | null;
}

interface TestDetailClientProps {
  test: Test;
  results: TestResult[];
  repositoryId?: string | null;
  screenshotGroups?: ScreenshotGroup[];
  plannedScreenshots?: PlannedScreenshot[];
  defaultSetupSteps?: DefaultStepForUI[];
  availableTests?: Test[];
  availableScripts?: SetupScript[];
  sheetDataSources?: GoogleSheetsDataSource[];
}

export function TestDetailClient({ test, results, repositoryId, screenshotGroups = [], plannedScreenshots = [], defaultSetupSteps = [], availableTests = [], availableScripts = [], sheetDataSources = [] }: TestDetailClientProps) {
  const router = useRouter();
  const notifyJobStarted = useNotifyJobStarted();
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isRestoringDeleted, setIsRestoringDeleted] = useState(false);
  const [isPermanentlyDeleting, setIsPermanentlyDeleting] = useState(false);
  const [showPermanentDeleteDialog, setShowPermanentDeleteDialog] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editName, setEditName] = useState(test.name);
  const [editUrl, setEditUrl] = useState(test.targetUrl || '');
  const [editCode, setEditCode] = useState(test.code || '');

  // Run state
  const [isRunning, setIsRunning] = useState(false);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [executionTarget, setExecutionTarget] = useState<string>('local');

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

  const handleRestoreDeleted = async () => {
    setIsRestoringDeleted(true);
    try {
      await restoreTest(test.id);
      router.refresh();
    } finally {
      setIsRestoringDeleted(false);
    }
  };

  const handlePermanentDelete = async () => {
    setIsPermanentlyDeleting(true);
    try {
      await permanentlyDeleteTest(test.id);
      router.push('/tests');
    } finally {
      setIsPermanentlyDeleting(false);
    }
  };

  const handleRun = async (headless = true, forceVideoRecording?: boolean) => {
    // Clear any existing poll interval
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }

    setIsRunning(true);
    try {
      const { jobId } = await runTests([test.id], repositoryId, headless, executionTarget, forceVideoRecording);
      notifyJobStarted();
      toast.success(forceVideoRecording ? 'Test started with recording' : headless ? 'Test started' : 'Test started (headed mode)');
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
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Deleted Banner */}
        {test.deletedAt && (
          <div className="flex items-center justify-between p-4 rounded-lg bg-destructive/10 border border-destructive/20">
            <div className="flex items-center gap-2 text-sm">
              <Trash2 className="h-4 w-4 text-destructive" />
              <span>This test was deleted on {new Date(test.deletedAt).toLocaleDateString()}</span>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleRestoreDeleted}
                disabled={isRestoringDeleted}
              >
                <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                {isRestoringDeleted ? 'Restoring...' : 'Restore'}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setShowPermanentDeleteDialog(true)}
                disabled={isPermanentlyDeleting}
              >
                <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                Delete Forever
              </Button>
            </div>
          </div>
        )}

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
                    <ExecutionTargetSelector
                      value={executionTarget}
                      onChange={setExecutionTarget}
                      disabled={isRunning}
                      capabilityFilter="run"
                      size="sm"
                    />
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
                          <DropdownMenuItem onClick={() => router.push(`/tests/${test.id}/debug`)}>
                            <Bug className="h-4 w-4 mr-2" />
                            Debug
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

        {/* Placeholder banner */}
        {test.isPlaceholder && (
          <Card className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
            <CardContent className="py-4 space-y-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
                <span className="font-semibold text-sm">Placeholder Test &mdash; Ready to Record</span>
              </div>
              {test.description && (
                <div className="bg-background/60 rounded-md px-3 py-2 text-sm text-muted-foreground">
                  {test.description}
                </div>
              )}
              <Button
                size="sm"
                onClick={() => router.push(`/record?rerecordId=${test.id}`)}
              >
                <Video className="h-4 w-4 mr-2" />
                Record Now
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Tabs for Code, Screenshots, History */}
        <Tabs defaultValue="code">
          <TabsList>
            <TabsTrigger value="code">Code</TabsTrigger>
            <TabsTrigger value="setup">Setup</TabsTrigger>
            <TabsTrigger value="screenshots">Screenshots</TabsTrigger>
            <TabsTrigger value="plans">Plans</TabsTrigger>
            <TabsTrigger value="history">Run History</TabsTrigger>
            <TabsTrigger value="recordings">Recordings</TabsTrigger>
            <TabsTrigger value="versions" onClick={loadVersions}>Versions</TabsTrigger>
          </TabsList>

          <TabsContent value="code" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">Test Code</CardTitle>
                  {isEditing && sheetDataSources.length > 0 && (
                    <SheetReferenceInserter
                      dataSources={sheetDataSources}
                      onInsert={(ref) => {
                        setEditCode((prev) => prev + ref);
                      }}
                    />
                  )}
                </div>
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

            {/* Sheet Data Reference Preview */}
            {sheetDataSources.length > 0 && (test.code || editCode)?.includes('{{sheet:') && (
              <SheetDataPreview
                code={isEditing ? editCode : (test.code || '')}
                dataSources={sheetDataSources}
              />
            )}

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

          <TabsContent value="setup" className="mt-4">
            <TestSetupOverrides
              testId={test.id}
              setupOverrides={test.setupOverrides ?? null}
              defaultSetupSteps={defaultSetupSteps.map((s) => ({
                ...s,
                stepType: s.stepType as 'test' | 'script',
              }))}
              availableTests={availableTests}
              availableScripts={availableScripts}
            />
          </TabsContent>

          <TabsContent value="screenshots" className="mt-4 space-y-6">
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

          <TabsContent value="plans" className="mt-4">
            {repositoryId ? (
              <StepScreenshotMatcher
                testId={test.id}
                repositoryId={repositoryId}
                screenshotGroups={screenshotGroups}
                plannedScreenshots={plannedScreenshots}
                onUpdate={() => router.refresh()}
              />
            ) : (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  Select a repository to manage planned screenshots
                </CardContent>
              </Card>
            )}
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
                                            loading="lazy"
                                            decoding="async"
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

          <TabsContent value="recordings" className="mt-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-sm">Recordings</CardTitle>
                  <CardDescription>Video recordings of test runs</CardDescription>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleRun(true, true)}
                  disabled={isRunning}
                >
                  {isRunning ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Video className="h-4 w-4 mr-1" />}
                  Run with Recording
                </Button>
              </CardHeader>
              <CardContent>
                {results.filter(r => r.videoPath).length > 0 ? (
                  <div className="space-y-4">
                    {results.filter(r => r.videoPath).map((result) => (
                      <div key={result.id} className="border rounded-lg p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            {result.status === 'passed' ? (
                              <CheckCircle className="h-4 w-4 text-green-500" />
                            ) : (
                              <XCircle className="h-4 w-4 text-destructive" />
                            )}
                            <span className="text-sm font-medium capitalize">{result.status}</span>
                            {result.durationMs && (
                              <span className="text-xs text-muted-foreground">{result.durationMs}ms</span>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {result.startedAt
                              ? new Date(result.startedAt).toLocaleString()
                              : 'Unknown'}
                          </span>
                        </div>
                        <video
                          src={result.videoPath!}
                          controls
                          preload="metadata"
                          className="w-full rounded border bg-black"
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <Video className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p>No recordings yet</p>
                    <p className="text-xs mt-1">Enable Video Recording in Settings &gt; Playwright to record test runs</p>
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
                        {(version.branch || version.firstBuildId) && (
                          <div className="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground">
                            {version.branch && (
                              <span className="inline-flex items-center gap-1">
                                <GitBranch className="h-3 w-3" />
                                {version.branch}
                              </span>
                            )}
                            {version.firstBuildId && (
                              <a
                                href={`/builds/${version.firstBuildId}`}
                                className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                              >
                                <GitCommit className="h-3 w-3" />
                                {version.firstBuildBranch}
                                {version.firstBuildCommit && `@${version.firstBuildCommit.slice(0, 7)}`}
                              </a>
                            )}
                          </div>
                        )}
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
            <DialogTitle>Move to Trash</DialogTitle>
            <DialogDescription>
              &quot;{test.name}&quot; will be moved to the Recently Deleted section. You can restore it later.
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
              {isDeleting ? 'Moving...' : 'Move to Trash'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Permanent Delete Confirmation Dialog */}
      <Dialog open={showPermanentDeleteDialog} onOpenChange={setShowPermanentDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Permanently Delete Test</DialogTitle>
            <DialogDescription>
              Are you sure you want to permanently delete &quot;{test.name}&quot;? All related data (results, baselines, diffs) will also be deleted. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPermanentDeleteDialog(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handlePermanentDelete}
              disabled={isPermanentlyDeleting}
            >
              {isPermanentlyDeleting ? 'Deleting...' : 'Permanently Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
