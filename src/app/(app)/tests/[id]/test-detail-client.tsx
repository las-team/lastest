'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { usePreferredRunner } from '@/hooks/use-preferred-runner';
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Textarea } from '@/components/ui/textarea';
import { Play, Trash2, Copy, Edit2, Clock, CheckCircle, XCircle, X, Save, Wrench, Wand2, Loader2, History, RotateCcw, ChevronDown, ChevronRight, ChevronUp, Monitor, Video, AlertTriangle, Image, Bug, GitBranch, GitCommit, Tv2, Code2, Maximize2, Minimize2, Sparkles } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { deleteTest, updateTest, getTestVersionHistory, restoreTestVersion, getVisualDiffsForTestResult, restoreTest, permanentlyDeleteTest, cloneTest } from '@/server/actions/tests';
import { runTests, getJobStatus } from '@/server/actions/runs';
import { aiFixTest, aiEnhanceTest, updateTestCode, startGeneratePlaceholderTestAgent } from '@/server/actions/ai';
import { toast } from 'sonner';
import { useNotifyJobStarted } from '@/components/queue/job-polling-context';
import { ExecutionTargetSelector } from '@/components/execution/execution-target-selector';
import { StepScreenshotMatcher } from '@/components/planned/step-screenshot-matcher';
import { TestSetupOverrides } from '@/components/setup/test-setup-overrides';
import type { Test, TestVersion, PlannedScreenshot, SetupScript, GoogleSheetsDataSource, A11yViolation, StabilizationSettings, DiffSensitivitySettings, TestSpec } from '@/lib/db/schema';
import { DEFAULT_STABILIZATION_SETTINGS, DEFAULT_DIFF_THRESHOLDS } from '@/lib/db/schema';
import { TestStabilizationOverrides } from '@/components/settings/test-stabilization-overrides';
import { TestDiffOverrides as TestDiffOverridesComponent } from '@/components/settings/test-diff-overrides';
import { TestPlaywrightOverrides as TestPlaywrightOverridesComponent } from '@/components/settings/test-playwright-overrides';
import { A11yViolationsPanel } from '@/components/builds/a11y-violations-panel';
import { RuntimeErrorsPanel, stripRuntimeErrorsFromMessage } from '@/components/builds/runtime-errors-panel';
import { TestStepsTab } from '@/components/tests/success-criteria-tab';
import type { ScreenshotGroup } from '@/server/actions/tests';
import { SheetDataPreview } from '@/components/test-data/sheet-data-preview';
import { SheetReferenceInserter } from '@/components/test-data/sheet-reference-inserter';
import { BrowserViewer } from '@/components/embedded-browser/browser-viewer-client';
import { getStreamUrlForRunner } from '@/server/actions/embedded-sessions';
import { TestSpecEditor } from '@/components/tests/test-spec-editor';

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
  networkRequests: import('@/lib/db/schema').NetworkRequest[] | null;
  videoPath: string | null;
  a11yViolations: A11yViolation[] | null;
  softErrors: string[] | null;
  assertionResults: import('@/lib/db/schema').AssertionResult[] | null;
  startedAt: Date | null;
  networkBodiesPath: string | null;
  screenshots: import('@/lib/db/schema').CapturedScreenshot[] | null;
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

interface PlaywrightSettingsForDefaults {
  browser?: string | null;
  navigationTimeout?: number | null;
  actionTimeout?: number | null;
  screenshotDelay?: number | null;
  networkErrorMode?: string | null;
  consoleErrorMode?: string | null;
  acceptAnyCertificate?: boolean | null;
  maxParallelTests?: number | null;
  cursorPlaybackSpeed?: number | null;
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
  stabilizationDefaults?: StabilizationSettings | null;
  banAiMode?: boolean;
  earlyAdopterMode?: boolean;
  diffDefaults?: DiffSensitivitySettings | null;
  playwrightDefaults?: PlaywrightSettingsForDefaults | null;
  envBaseUrl?: string | null;
  testSpec?: TestSpec | null;
  contentClassName?: string;
}

function splitBoilerplate(code: string): { boilerplate: string; testBody: string } | null {
  // Match the standard helper block: from signature line through replayCursorPath closing brace
  const signatureMatch = code.match(/^(import\s.*\n\n)?export\s+async\s+function\s+test\s*\([^)]*\)\s*\{/m);
  if (!signatureMatch) return null;

  // Find the end of the last boilerplate helper (replayCursorPath or locateWithFallback)
  const markers = ['async function replayCursorPath', 'async function locateWithFallback', 'function getScreenshotPath', 'function buildUrl'];
  let lastHelperEnd = -1;

  for (const marker of markers) {
    let searchFrom = 0;
    while (true) {
      const idx = code.indexOf(marker, searchFrom);
      if (idx === -1) break;
      // Find the closing brace of this function by counting braces
      let braceCount = 0;
      let started = false;
      let endIdx = idx;
      for (let i = idx; i < code.length; i++) {
        if (code[i] === '{') { braceCount++; started = true; }
        if (code[i] === '}') { braceCount--; }
        if (started && braceCount === 0) { endIdx = i + 1; break; }
      }
      if (endIdx > lastHelperEnd) lastHelperEnd = endIdx;
      searchFrom = endIdx;
    }
  }

  if (lastHelperEnd === -1) return null;

  // Skip blank lines after the last helper, but preserve indentation
  let bodyStart = lastHelperEnd;
  while (bodyStart < code.length && (code[bodyStart] === '\n' || code[bodyStart] === '\r')) {
    bodyStart++;
  }

  const boilerplate = code.slice(0, lastHelperEnd);
  const testBody = code.slice(bodyStart);

  // Only collapse if there's meaningful test body left
  if (!testBody.trim() || testBody.trim() === '}') return null;

  return { boilerplate, testBody };
}

function NumberedCode({ code, startLine, highlightLine, className }: { code: string; startLine: number; highlightLine?: number | null; className?: string }) {
  const lines = code.split('\n');
  return (
    <pre className={className}>
      {lines.map((line, i) => {
        const lineNum = startLine + i;
        const isHighlighted = highlightLine === lineNum;
        return (
          <div
            key={lineNum}
            id={`code-line-${lineNum}`}
            className={isHighlighted ? 'bg-yellow-200/40 dark:bg-yellow-800/30 -mx-4 px-4 transition-colors duration-1000' : undefined}
          >
            <span className="inline-block w-8 text-right mr-4 text-muted-foreground/50 select-none">{lineNum}</span>
            {line}
          </div>
        );
      })}
    </pre>
  );
}

function CollapsibleTestCode({ code, highlightLine }: { code: string; highlightLine?: number | null }) {
  const [showHelpers, setShowHelpers] = useState(false);
  const split = splitBoilerplate(code);

  if (!split) {
    return (
      <div className="bg-muted rounded-lg overflow-x-auto text-sm font-mono">
        <NumberedCode code={code} startLine={1} highlightLine={highlightLine} className="p-4" />
      </div>
    );
  }

  const boilerplateLineCount = split.boilerplate.split('\n').length;
  const testBodyStartLine = boilerplateLineCount + 1;

  return (
    <div className="bg-muted rounded-lg overflow-x-auto text-sm font-mono">
      <button
        type="button"
        onClick={() => setShowHelpers(!showHelpers)}
        className="flex items-center gap-2 px-4 py-2 w-full text-left text-muted-foreground hover:text-foreground transition-colors border-b border-border/50"
      >
        {showHelpers ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <Code2 className="h-3 w-3" />
        <span className="text-xs">Standard helpers (buildUrl, locateWithFallback, ...)</span>
      </button>
      {showHelpers && (
        <NumberedCode code={split.boilerplate} startLine={1} highlightLine={highlightLine} className="px-4 py-2 border-b border-border/50 text-muted-foreground" />
      )}
      <NumberedCode code={split.testBody} startLine={testBodyStartLine} highlightLine={highlightLine} className="p-4" />
    </div>
  );
}

export function TestDetailClient({ test, results, repositoryId, screenshotGroups = [], plannedScreenshots = [], defaultSetupSteps = [], availableTests = [], availableScripts = [], sheetDataSources = [], stabilizationDefaults, banAiMode = false, earlyAdopterMode = false, diffDefaults, playwrightDefaults, envBaseUrl, testSpec, contentClassName }: TestDetailClientProps) {
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
  const [activeTab, setActiveTab] = useState('code');
  const [highlightLine, setHighlightLine] = useState<number | null>(null);

  // Run state
  const [isRunning, setIsRunning] = useState(false);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [executionTarget, setExecutionTarget] = usePreferredRunner();

  // Live browser viewer state
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [showViewer, setShowViewer] = useState(true);
  const [isViewerFullscreen, setIsViewerFullscreen] = useState(false);
  const viewerLayoutRef = useRef<HTMLDivElement>(null);

  const toggleViewerFullscreen = useCallback(() => {
    if (!viewerLayoutRef.current) return;
    try {
      if (!isViewerFullscreen) {
        viewerLayoutRef.current.requestFullscreen?.();
      } else if (document.fullscreenElement) {
        document.exitFullscreen();
      }
    } catch {
      setIsViewerFullscreen(false);
    }
  }, [isViewerFullscreen]);

  useEffect(() => {
    const handler = () => setIsViewerFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

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
  const [isGeneratingPlaceholder, setIsGeneratingPlaceholder] = useState(false);
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
    // eslint-disable-next-line jsx-a11y/alt-text
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
      router.push('/definition');
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
      router.push('/definition');
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
      const result = await runTests([test.id], repositoryId, headless, executionTarget, forceVideoRecording);
      const { jobId } = result;
      notifyJobStarted();
      if ('queued' in result && result.queued) {
        toast.success('Test queued — will run when current tests finish');
      } else {
        toast.success(forceVideoRecording ? 'Test started with recording' : headless ? 'Test started' : 'Test started (headed mode)');
      }

      // Fetch stream URL for headed runs on embedded/system runners
      if (!headless && executionTarget !== 'local') {
        try {
          const streamInfo = await getStreamUrlForRunner(executionTarget);
          if (streamInfo?.streamUrl) {
            const token = streamInfo.streamAuthToken;
            setStreamUrl(
              token
                ? `${streamInfo.streamUrl}?token=${encodeURIComponent(token)}`
                : streamInfo.streamUrl
            );
          }
        } catch {
          // Stream not available — not critical
        }
      }

      // Poll job status for completion (ensures results are saved before refresh)
      pollIntervalRef.current = setInterval(async () => {
        const { isComplete, status, error } = await getJobStatus(jobId);
        if (isComplete) {
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
          setIsRunning(false);
          setStreamUrl(null);
          router.refresh();
          if (status === 'failed') {
            toast.error(error || 'Test run failed');
          } else {
            toast.success('Test completed');
          }
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
      <div className={cn("max-w-4xl mx-auto space-y-6", contentClassName)}>
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
          <CardHeader className="space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                {isEditing ? (
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="text-xl font-semibold"
                  />
                ) : (
                  <CardTitle className="flex items-center gap-2">
                    {test.name}
                  </CardTitle>
                )}
              </div>

              <div className="flex gap-2 flex-shrink-0">
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
                    {!banAiMode && repositoryId && (
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
                    <Button
                      variant="outline"
                      size="icon"
                      title="Clone"
                      onClick={async () => {
                        try {
                          const cloned = await cloneTest(test.id);
                          toast.success('Test cloned');
                          router.push(`/tests/${cloned.id}`);
                        } catch {
                          toast.error('Failed to clone test');
                        }
                      }}
                    >
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
            {isEditing ? (
              <Input
                value={editUrl}
                onChange={(e) => setEditUrl(e.target.value)}
                placeholder="https://example.com"
                className="text-sm text-muted-foreground"
              />
            ) : (
              <>
                {test.description && (
                  test.description.includes('\n') ? (
                    <ul className="text-sm text-muted-foreground list-disc list-inside space-y-0.5">
                      {test.description.split('\n').filter(Boolean).map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">{test.description}</p>
                  )
                )}
                <CardDescription>
                  {test.targetUrl || 'No target URL'}
                </CardDescription>
              </>
            )}
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
                    latestResult.errorMessage ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="flex items-center gap-2 cursor-default">
                            <XCircle className="h-4 w-4 text-destructive" />
                            <span className="text-destructive">Failed</span>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="max-w-md">
                          <pre className="whitespace-pre-wrap font-mono text-xs max-h-48 overflow-y-auto">{latestResult.errorMessage}</pre>
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <>
                        <XCircle className="h-4 w-4 text-destructive" />
                        <span className="text-destructive">Failed</span>
                      </>
                    )
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
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => router.push(`/record?rerecordId=${test.id}`)}
                >
                  <Video className="h-4 w-4 mr-2" />
                  Record Now
                </Button>
                {!banAiMode && repositoryId && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isGeneratingPlaceholder}
                    onClick={async () => {
                      setIsGeneratingPlaceholder(true);
                      try {
                        const result = await startGeneratePlaceholderTestAgent({
                          testId: test.id,
                          repositoryId: repositoryId!,
                        });
                        if (result.success) {
                          toast.success('Test generation started — check the activity feed for progress');
                        } else {
                          toast.error(result.error || 'Failed to start AI generation');
                        }
                      } catch {
                        toast.error('Failed to start AI generation');
                      } finally {
                        setIsGeneratingPlaceholder(false);
                      }
                    }}
                  >
                    {isGeneratingPlaceholder ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4 mr-2" />
                    )}
                    {isGeneratingPlaceholder ? 'Generating...' : 'Generate with AI'}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Live Browser Viewer (headed runs on embedded/system runners) */}
        {streamUrl && isRunning && (
          <div ref={viewerLayoutRef} className={isViewerFullscreen ? 'flex-1 flex flex-col h-full overflow-hidden bg-muted/50' : ''}>
            {isViewerFullscreen ? (
              <>
                <div className="flex-1 relative flex items-center justify-center overflow-auto min-h-0">
                  <BrowserViewer
                    streamUrl={streamUrl}
                    hideControls
                  />
                </div>
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1.5 px-3 py-1.5 bg-card/95 backdrop-blur-sm border border-border rounded-full shadow-2xl">
                  <div className="flex items-center gap-2 px-1">
                    <div className="h-2.5 w-2.5 rounded-full bg-green-500 animate-pulse" />
                    <span className="text-sm font-medium text-foreground">Running</span>
                  </div>
                  <div className="w-px h-5 bg-border" />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={toggleViewerFullscreen}
                    title="Exit fullscreen"
                  >
                    <Minimize2 className="h-4 w-4" />
                  </Button>
                </div>
              </>
            ) : (
              <Card className="overflow-hidden py-0">
                <div className="flex items-center gap-2 w-full px-3 py-2 text-sm font-medium bg-muted/50">
                  <button
                    type="button"
                    className="flex items-center gap-2 flex-1 hover:bg-muted transition-colors rounded px-1 -mx-1"
                    onClick={() => setShowViewer(!showViewer)}
                  >
                    <Tv2 className="h-4 w-4 text-purple-500" />
                    <span>Live Browser View</span>
                    {showViewer ? <ChevronUp className="h-4 w-4 ml-auto" /> : <ChevronDown className="h-4 w-4 ml-auto" />}
                  </button>
                  {showViewer && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      onClick={toggleViewerFullscreen}
                      title="Fullscreen"
                    >
                      <Maximize2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                {showViewer && (
                  <BrowserViewer
                    streamUrl={streamUrl}
                    className="max-h-[500px]"
                    hideFullscreenToggle
                    hideScreenshot
                    hideViewportSelector
                    readOnlyUrl
                  />
                )}
              </Card>
            )}
          </div>
        )}

        {/* Tabs for Code, Screenshots, History */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="h-11 w-full p-1 gap-1 bg-white dark:bg-zinc-950 border">
            <TabsTrigger value="code" className="flex-1 px-2 text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm">Code</TabsTrigger>
            {earlyAdopterMode && (
              <TabsTrigger value="spec" className="flex-1 px-2 text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm">Spec</TabsTrigger>
            )}
            <TabsTrigger value="steps" className="flex-1 px-2 text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm">Steps</TabsTrigger>
            <TabsTrigger value="setup" className="flex-1 px-2 text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm">Seed</TabsTrigger>
            <TabsTrigger value="playback" className="flex-1 px-2 text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm">Overrides</TabsTrigger>
            <TabsTrigger value="screenshots" className="flex-1 px-2 text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm">Screenshots</TabsTrigger>
            <TabsTrigger value="plans" className="flex-1 px-2 text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm">Plans</TabsTrigger>
            <TabsTrigger value="history" className="flex-1 px-2 text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm">History</TabsTrigger>
            <TabsTrigger value="recordings" className="flex-1 px-2 text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm">Recordings</TabsTrigger>
            <TabsTrigger value="versions" onClick={loadVersions} className="flex-1 px-2 text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm">Versions</TabsTrigger>
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
                  <CollapsibleTestCode code={test.code || '// No code generated yet'} highlightLine={highlightLine} />
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
            {!banAiMode && repositoryId && !isEditing && (
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

          {earlyAdopterMode && (
            <TabsContent value="spec" className="mt-4">
              {repositoryId && (
                <TestSpecEditor
                  testId={test.id}
                  testName={test.name}
                  repositoryId={repositoryId}
                  initialSpec={testSpec ?? null}
                  functionalAreaId={test.functionalAreaId}
                />
              )}
            </TabsContent>
          )}

          <TabsContent value="steps" className="mt-4">
            <TestStepsTab
              assertions={test.assertions ?? null}
              assertionResults={latestResult?.assertionResults ?? null}
              softErrors={latestResult?.softErrors ?? null}
              code={test.code || ''}
              testStatus={latestResult?.status ?? null}
              errorMessage={latestResult?.errorMessage ?? null}
              screenshots={latestResult?.screenshots ?? null}
              envBaseUrl={envBaseUrl ?? null}
              onParseNeeded={async () => {
                try {
                  const { parseAssertions } = await import('@/lib/playwright/assertion-parser');
                  const parsed = parseAssertions(test.code || '');
                  if (parsed.length > 0) {
                    const { syncTestAssertions } = await import('@/server/actions/tests');
                    await syncTestAssertions(test.id, parsed);
                  }
                } catch {
                  // Best effort
                }
              }}
              onToggleAssertionSoftness={async (assertionId, makeSoft) => {
                const { toggleAssertionSoftness } = await import('@/server/actions/tests');
                await toggleAssertionSoftness(test.id, assertionId, makeSoft);
                router.refresh();
              }}
              onStepValueChange={async (lineStart, lineEnd, oldValue, newValue) => {
                const { updateStepValue } = await import('@/server/actions/tests');
                await updateStepValue(test.id, lineStart, lineEnd, oldValue, newValue);
                router.refresh();
              }}
              onGoToCode={(line) => {
                setHighlightLine(line);
                setActiveTab('code');
                // Scroll to the line after tab switch renders
                setTimeout(() => {
                  document.getElementById(`code-line-${line}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  // Clear highlight after animation
                  setTimeout(() => setHighlightLine(null), 2000);
                }, 100);
              }}
            />
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

          <TabsContent value="playback" className="mt-4 space-y-6">
            <TestStabilizationOverrides
              testId={test.id}
              overrides={test.stabilizationOverrides ?? null}
              defaults={stabilizationDefaults ?? DEFAULT_STABILIZATION_SETTINGS}
            />

            {earlyAdopterMode && (
              <TestDiffOverridesComponent
                testId={test.id}
                repositoryId={repositoryId ?? null}
                overrides={test.diffOverrides ?? null}
                defaults={{
                  unchangedThreshold: diffDefaults?.unchangedThreshold ?? DEFAULT_DIFF_THRESHOLDS.unchangedThreshold,
                  flakyThreshold: diffDefaults?.flakyThreshold ?? DEFAULT_DIFF_THRESHOLDS.flakyThreshold,
                  includeAntiAliasing: diffDefaults?.includeAntiAliasing ?? DEFAULT_DIFF_THRESHOLDS.includeAntiAliasing,
                  ignorePageShift: diffDefaults?.ignorePageShift ?? DEFAULT_DIFF_THRESHOLDS.ignorePageShift,
                  diffEngine: (diffDefaults?.diffEngine as 'pixelmatch' | 'ssim' | 'butteraugli') ?? DEFAULT_DIFF_THRESHOLDS.diffEngine,
                  textRegionAwareDiffing: diffDefaults?.textRegionAwareDiffing ?? DEFAULT_DIFF_THRESHOLDS.textRegionAwareDiffing,
                  textRegionThreshold: diffDefaults?.textRegionThreshold ?? DEFAULT_DIFF_THRESHOLDS.textRegionThreshold,
                  textRegionPadding: diffDefaults?.textRegionPadding ?? DEFAULT_DIFF_THRESHOLDS.textRegionPadding,
                  textDetectionGranularity: (diffDefaults?.textDetectionGranularity as 'word' | 'line' | 'block') ?? DEFAULT_DIFF_THRESHOLDS.textDetectionGranularity,
                  regionDetectionMode: (diffDefaults?.regionDetectionMode as 'grid' | 'flood-fill') ?? DEFAULT_DIFF_THRESHOLDS.regionDetectionMode,
                }}
              />
            )}

            {earlyAdopterMode && (
              <TestPlaywrightOverridesComponent
                testId={test.id}
                repositoryId={repositoryId ?? null}
                overrides={test.playwrightOverrides ?? null}
                defaults={{
                  browser: (playwrightDefaults?.browser as 'chromium' | 'firefox' | 'webkit') ?? 'chromium',
                  navigationTimeout: playwrightDefaults?.navigationTimeout ?? 30000,
                  actionTimeout: playwrightDefaults?.actionTimeout ?? 30000,
                  screenshotDelay: playwrightDefaults?.screenshotDelay ?? 0,
                  networkErrorMode: (playwrightDefaults?.networkErrorMode as 'fail' | 'warn' | 'ignore') ?? 'fail',
                  consoleErrorMode: (playwrightDefaults?.consoleErrorMode as 'fail' | 'warn' | 'ignore') ?? 'fail',
                  acceptAnyCertificate: playwrightDefaults?.acceptAnyCertificate ?? false,
                  maxParallelTests: playwrightDefaults?.maxParallelTests ?? 2,
                  cursorPlaybackSpeed: playwrightDefaults?.cursorPlaybackSpeed ?? 1,
                  baseUrl: envBaseUrl ?? 'http://localhost:3000',
                }}
              />
            )}
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
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
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
                            {result.status === 'failed' && result.errorMessage ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className="flex items-center gap-2 cursor-default">
                                    <XCircle className="h-4 w-4 text-destructive" />
                                    <span className="capitalize">{result.status}</span>
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent side="right" className="max-w-md">
                                  <pre className="whitespace-pre-wrap font-mono text-xs max-h-48 overflow-y-auto">{result.errorMessage}</pre>
                                </TooltipContent>
                              </Tooltip>
                            ) : result.status === 'passed' ? (
                              <CheckCircle className="h-4 w-4 text-green-500" />
                            ) : (
                              <XCircle className="h-4 w-4 text-destructive" />
                            )}
                            {!(result.status === 'failed' && result.errorMessage) && (
                              <span className="capitalize">{result.status}</span>
                            )}
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
                            {result.status === 'failed' && result.errorMessage && (() => {
                              const cleaned = stripRuntimeErrorsFromMessage(result.errorMessage);
                              return cleaned ? (
                                <div className="mt-2 p-2 bg-destructive/10 border border-destructive/20 rounded text-sm text-destructive">
                                  <pre className="whitespace-pre-wrap font-mono text-xs overflow-x-auto">
                                    {cleaned}
                                  </pre>
                                </div>
                              ) : null;
                            })()}

                            <RuntimeErrorsPanel consoleErrors={result.consoleErrors} networkRequests={result.networkRequests} networkBodiesPath={result.networkBodiesPath} />

                            {result.softErrors && (result.softErrors as string[]).length > 0 && (
                              <div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-800 dark:bg-yellow-950/30 dark:border-yellow-800 dark:text-yellow-200">
                                <div className="flex items-start gap-2">
                                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                                  <div className="space-y-1">
                                    {(result.softErrors as string[]).map((err, i) => (
                                      <p key={i} className="text-xs break-all whitespace-pre-wrap">{err}</p>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            )}

                            <A11yViolationsPanel violations={result.a11yViolations ?? []} />

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
                                          {diff.stepLabel || `Step ${i + 1}`}
                                        </span>
                                      </div>
                                      {diff.currentImagePath && (
                                        <a
                                          href={diff.currentImagePath}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="block"
                                        >
                                          {/* eslint-disable-next-line @next/next/no-img-element */}
                                          <img
                                            src={diff.currentImagePath}
                                            alt={diff.stepLabel || `Step ${i + 1}`}
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
                            {result.status === 'failed' && result.errorMessage ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className="flex items-center gap-2 cursor-default">
                                    <XCircle className="h-4 w-4 text-destructive" />
                                    <span className="text-sm font-medium capitalize">{result.status}</span>
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent side="right" className="max-w-md">
                                  <pre className="whitespace-pre-wrap font-mono text-xs max-h-48 overflow-y-auto">{result.errorMessage}</pre>
                                </TooltipContent>
                              </Tooltip>
                            ) : (
                              <>
                                {result.status === 'passed' ? (
                                  <CheckCircle className="h-4 w-4 text-green-500" />
                                ) : (
                                  <XCircle className="h-4 w-4 text-destructive" />
                                )}
                                <span className="text-sm font-medium capitalize">{result.status}</span>
                              </>
                            )}
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
                            {version.viewportWidth && version.viewportHeight && (
                              <span className="text-xs px-2 py-0.5 rounded bg-muted font-mono text-muted-foreground">
                                {version.viewportWidth}&times;{version.viewportHeight}
                              </span>
                            )}
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
