'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
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
import { VideoPlayer } from '@/components/video-player';
import { Play, Trash2, Copy, Edit2, Clock, CheckCircle, XCircle, X, Save, Wrench, Wand2, Loader2, History, RotateCcw, ChevronDown, ChevronRight, ChevronUp, Monitor, Video, AlertTriangle, Image, Bug, GitBranch, GitCommit, Tv2, Code2, Maximize2, Minimize2, Sparkles } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { deleteTest, updateTest, getTestVersionHistory, restoreTestVersion, getVisualDiffsForTestResult, restoreTest, permanentlyDeleteTest, cloneTest, getSelectorStatsForTestAction } from '@/server/actions/tests';
import type { SelectorStatRow } from '@lastest/shared/selector-stats';
import { runTests, getJobStatus, getTestRunStepState } from '@/server/actions/runs';
import { extractTestBody, parseSteps } from '@/lib/playwright/debug-parser';
import { PlaybackTimeline, type StepResultsMap } from '@/components/playback/playback-timeline';
import { startHealTestAgent, aiEnhanceTest, updateTestCode, startGeneratePlaceholderTestAgent } from '@/server/actions/ai';
import { toast } from 'sonner';
import { useNotifyJobStarted } from '@/components/queue/job-polling-context';
import { ScreenshotTimeline } from '@/components/tests/screenshot-timeline';
import { TestSetupOverrides } from '@/components/setup/test-setup-overrides';
import type { Test, TestVersion, PlannedScreenshot, SetupScript, GoogleSheetsDataSource, CsvDataSource, A11yViolation, StabilizationSettings, DiffSensitivitySettings, TestSpec } from '@/lib/db/schema';
import { DEFAULT_STABILIZATION_SETTINGS, DEFAULT_DIFF_THRESHOLDS } from '@/lib/db/schema';
import { TestStabilizationOverrides } from '@/components/settings/test-stabilization-overrides';
import { TestDiffOverrides as TestDiffOverridesComponent } from '@/components/settings/test-diff-overrides';
import { TestPlaywrightOverrides as TestPlaywrightOverridesComponent } from '@/components/settings/test-playwright-overrides';
import { A11yViolationsPanel } from '@/components/builds/a11y-violations-panel';
import { RuntimeErrorsPanel, stripRuntimeErrorsFromMessage } from '@/components/builds/runtime-errors-panel';
import { TestStepsTab } from '@/components/tests/success-criteria-tab';
import { StepCriteriaTab } from '@/components/tests/step-criteria-tab';
import { TestVarsTab } from '@/components/tests/test-vars-tab';
import type { ScreenshotGroup } from '@/server/actions/tests';
import { SheetDataPreview } from '@/components/test-data/sheet-data-preview';
import { SheetReferenceInserter } from '@/components/test-data/sheet-reference-inserter';
import { VarReferenceInserter } from '@/components/test-data/var-reference-inserter';
import { BrowserViewer } from '@/components/embedded-browser/browser-viewer-client';
import { getStreamUrlForRunner } from '@/server/actions/embedded-sessions';
import { TestSpecEditor } from '@/components/tests/test-spec-editor';
import { PublishShareDialog } from '@/app/(app)/builds/[buildId]/publish-share-dialog';
import { diffLines as diffTextLines, diffStats } from '@/lib/diff/text-diff';
import { InspectTabClient } from './inspect/inspect-tab-client';
import { track } from '@/lib/analytics/umami';
import { Events } from '@/lib/analytics/events';

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
  downloads: import('@/lib/db/schema').DownloadRecord[] | null;
  videoPath: string | null;
  a11yViolations: A11yViolation[] | null;
  softErrors: string[] | null;
  assertionResults: import('@/lib/db/schema').AssertionResult[] | null;
  startedAt: Date | null;
  networkBodiesPath: string | null;
  screenshots: import('@/lib/db/schema').CapturedScreenshot[] | null;
  lastReachedStep: number | null;
  totalSteps: number | null;
  extractedVariables: Record<string, string> | null;
  assignedVariables: Record<string, string> | null;
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
  csvDataSources?: CsvDataSource[];
  googleSheetsAccount?: {
    id: string;
    googleEmail: string;
    googleName: string | null;
  } | null;
  stabilizationDefaults?: StabilizationSettings | null;
  banAiMode?: boolean;
  earlyAdopterMode?: boolean;
  diffDefaults?: DiffSensitivitySettings | null;
  playwrightDefaults?: PlaywrightSettingsForDefaults | null;
  envBaseUrl?: string | null;
  testSpec?: TestSpec | null;
  contentClassName?: string;
  onRefresh?: () => void | Promise<void>;
  /** True when an AI provider is configured well enough to call from
   *  variable resolution (provider !== 'claude-cli' AND its credentials are
   *  present). Drives the AI-generated variable source enable/disable. */
  aiAvailable?: boolean;
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

export function TestDetailClient({ test, results, repositoryId, screenshotGroups = [], plannedScreenshots = [], defaultSetupSteps = [], availableTests = [], availableScripts = [], sheetDataSources = [], csvDataSources = [], googleSheetsAccount = null, stabilizationDefaults, banAiMode = false, earlyAdopterMode = false, diffDefaults, playwrightDefaults, envBaseUrl, testSpec, contentClassName, onRefresh, aiAvailable = false }: TestDetailClientProps) {
  const router = useRouter();
  const notifyJobStarted = useNotifyJobStarted();
  const [isDeleting, setIsDeleting] = useState(false);
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

  // Live browser viewer state
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [showViewer, setShowViewer] = useState(true);
  const [isViewerFullscreen, setIsViewerFullscreen] = useState(false);
  const viewerLayoutRef = useRef<HTMLDivElement>(null);

  // Live step timeline state
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(-1);
  const [stepResults, setStepResults] = useState<StepResultsMap>({});

  // Per-step selector fallback stats from the selector_stats table. Loaded
  // once on mount and refreshed when a run completes so newly recorded
  // outcomes show up in the hover panel without a page reload.
  const [selectorStats, setSelectorStats] = useState<SelectorStatRow[]>([]);
  useEffect(() => {
    let cancelled = false;
    getSelectorStatsForTestAction(test.id)
      .then((rows) => { if (!cancelled) setSelectorStats(rows); })
      .catch(() => { /* best-effort — diagnostic only */ });
    return () => { cancelled = true; };
  }, [test.id]);

  // Parsed steps from the current test code — feeds the upcoming-step list
  // ahead of time so the timeline shows what's coming, not just what's done.
  const plannedSteps = useMemo(() => {
    const code = isEditing ? editCode : test.code;
    if (!code) return [];
    const body = extractTestBody(code);
    return body ? parseSteps(body) : [];
  }, [test.code, editCode, isEditing]);

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
  const [expandedDiffVersion, setExpandedDiffVersion] = useState<number | null>(null);
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
      toast.success('Test moved to trash');
      router.push('/tests');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to move test to trash');
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
    setCurrentStepIndex(-1);
    setStepResults({});
    try {
      track(Events.test_run_started, {
        trigger: 'manual',
        scope: 'single',
        testId: test.id,
        headless,
        repoId: repositoryId ?? '',
      });
      const result = await runTests([test.id], repositoryId, headless, 'auto', forceVideoRecording);
      const { jobId } = result;
      const runId = 'runId' in result ? (result.runId ?? null) : null;
      notifyJobStarted();
      if ('queued' in result && result.queued) {
        toast.success('Test queued — will run when current tests finish');
      } else {
        toast.success(forceVideoRecording ? 'Test started with recording' : headless ? 'Test started' : 'Test started (headed mode)');
      }

      // Resolves stream URL for headed runs once the actual runner is known.
      let streamResolved = headless;
      pollIntervalRef.current = setInterval(async () => {
        const { isComplete, status, error, actualRunnerId } = await getJobStatus(jobId);

        // Resolve stream URL once the actual runner is known
        if (!streamResolved && !headless && actualRunnerId) {
          streamResolved = true;
          try {
            const streamInfo = await getStreamUrlForRunner(actualRunnerId);
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

        // Pull live step state for the headed timeline. Cheap call; only
        // active while this poll is running.
        if (runId && !headless) {
          try {
            const stepState = await getTestRunStepState(runId);
            if (stepState) {
              setCurrentStepIndex(stepState.currentStepIndex);
              setStepResults(stepState.results as StepResultsMap);
            }
          } catch {
            // Non-critical
          }
        }

        if (isComplete) {
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
          setIsRunning(false);
          setStreamUrl(null);
          router.refresh();
          // Pull fresh selector_stats so the per-step hover reflects this
          // run's outcomes. Best-effort.
          getSelectorStatsForTestAction(test.id)
            .then(setSelectorStats)
            .catch(() => { /* diagnostic only */ });
          if (onRefresh) {
            try {
              await onRefresh();
            } catch {
              // Ignore refresh errors
            }
          }
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
      const result = await startHealTestAgent({
        repositoryId,
        testId: test.id,
        testName: test.name,
      });
      if (result.success) {
        toast.success('Test healing started — check the activity feed for progress');
      } else {
        toast.error(result.error || 'Failed to start test healing');
      }
    } catch {
      toast.error('Failed to start test healing');
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
        const saveResult = await updateTestCode(test.id, result.code, 'ai_enhance');
        if (saveResult.success) {
          toast.success('Test enhanced and saved');
          setEnhancePrompt('');
          router.refresh();
        } else {
          toast.error(saveResult.error || 'Failed to save enhanced test');
        }
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
    <div className="flex-1 p-6">
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
                          router.push(`/tests?test=${encodeURIComponent(cloned.id)}`);
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
                      onClick={handleDelete}
                      disabled={isDeleting}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    <PublishShareDialog testId={test.id} initialShares={[]} iconOnly />
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
                {testSpec?.spec && testSpec.spec !== test.name && (
                  testSpec.spec.includes('\n') ? (
                    <ul className="text-sm text-muted-foreground list-disc list-inside space-y-0.5">
                      {testSpec.spec.split('\n').filter(Boolean).slice(0, 5).map((line, i) => (
                        <li key={i}>{line.replace(/^[-*]\s+/, '')}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">{testSpec.spec}</p>
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
              {testSpec?.title && testSpec.title !== test.name && (
                <div className="bg-background/60 rounded-md px-3 py-2 text-sm text-muted-foreground">
                  {testSpec.title}
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
                <div className="flex-1 relative flex flex-col overflow-hidden min-h-0">
                  <BrowserViewer
                    streamUrl={streamUrl}
                    hideControls
                    fit
                    className="flex-1 min-h-0"
                  />
                  {plannedSteps.length > 0 && (
                    <div className="pointer-events-none absolute right-4 top-4 bottom-4 w-72 layer-playback-timeline hidden md:block">
                      <PlaybackTimeline
                        steps={plannedSteps}
                        currentStepIndex={currentStepIndex}
                        results={stepResults}
                        isRunning={isRunning}
                        selectorStats={selectorStats}
                        compact
                        className="h-full pointer-events-auto"
                      />
                    </div>
                  )}
                </div>
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 layer-playback-controls flex items-center gap-1.5 px-3 py-1.5 bg-card/95 backdrop-blur-sm border border-border rounded-full shadow-2xl">
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
              <div className={cn(
                'grid gap-3',
                plannedSteps.length > 0 ? 'lg:grid-cols-[minmax(0,1fr)_320px]' : 'grid-cols-1',
              )}>
                <Card className="overflow-hidden py-0 min-w-0">
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
                      className="h-[500px]"
                      fit
                      hideFullscreenToggle
                      hideScreenshot
                      hideViewportSelector
                      readOnlyUrl
                    />
                  )}
                </Card>
                {plannedSteps.length > 0 && showViewer && (
                  <PlaybackTimeline
                    steps={plannedSteps}
                    currentStepIndex={currentStepIndex}
                    results={stepResults}
                    isRunning={isRunning}
                    selectorStats={selectorStats}
                    className="h-[540px]"
                  />
                )}
              </div>
            )}
          </div>
        )}

        {/* Tabs for Code, Screenshots, History */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="h-11 w-full p-1 gap-1 bg-white dark:bg-zinc-950 border">
            <TabsTrigger value="code" className="h-full flex-1 px-2 text-sm data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=active]:shadow-sm">Code</TabsTrigger>
            {earlyAdopterMode && (
              <TabsTrigger value="spec" className="h-full flex-1 px-2 text-sm data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=active]:shadow-sm">Spec</TabsTrigger>
            )}
            <TabsTrigger value="steps" className="h-full flex-1 px-2 text-sm data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=active]:shadow-sm">Steps</TabsTrigger>
            <TabsTrigger value="criteria" className="h-full flex-1 px-2 text-sm data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=active]:shadow-sm">Criteria</TabsTrigger>
            <TabsTrigger value="vars" className="h-full flex-1 px-2 text-sm data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=active]:shadow-sm">Vars</TabsTrigger>
            <TabsTrigger value="playback" className="h-full flex-1 px-2 text-sm data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=active]:shadow-sm">Overrides</TabsTrigger>
            <TabsTrigger value="screenshots" className="h-full flex-1 px-2 text-sm data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=active]:shadow-sm">Screenshots</TabsTrigger>
            <TabsTrigger value="inspect" className="h-full flex-1 px-2 text-sm data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=active]:shadow-sm">Inspect</TabsTrigger>
            <TabsTrigger value="history" className="h-full flex-1 px-2 text-sm data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=active]:shadow-sm">History</TabsTrigger>
            <TabsTrigger value="recordings" className="h-full flex-1 px-2 text-sm data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=active]:shadow-sm">Recordings</TabsTrigger>
            <TabsTrigger value="versions" onClick={loadVersions} className="h-full flex-1 px-2 text-sm data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=active]:shadow-sm">Versions</TabsTrigger>
          </TabsList>

          <TabsContent value="code" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">Test Code</CardTitle>
                  {isEditing && (
                    <div className="flex items-center gap-2">
                      {sheetDataSources.length > 0 && (
                        <SheetReferenceInserter
                          dataSources={sheetDataSources}
                          onInsert={(ref) => {
                            setEditCode((prev) => prev + ref);
                          }}
                        />
                      )}
                      <VarReferenceInserter
                        variables={test.variables ?? []}
                        onInsert={(ref) => {
                          setEditCode((prev) => prev + ref);
                        }}
                      />
                    </div>
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
              lastReachedStep={latestResult?.lastReachedStep ?? null}
              totalSteps={latestResult?.totalSteps ?? null}
              variables={test.variables ?? null}
              sheetSources={sheetDataSources}
              csvSources={csvDataSources}
              onSaveVariables={async (next) => {
                const { saveTestVariables } = await import('@/server/actions/tests');
                await saveTestVariables(test.id, next);
                if (onRefresh) await onRefresh(); else router.refresh();
              }}
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
              onStepValueChange={async (lineStart, lineEnd, oldValue, newValue) => {
                const { updateStepValue } = await import('@/server/actions/tests');
                await updateStepValue(test.id, lineStart, lineEnd, oldValue, newValue);
                if (onRefresh) await onRefresh(); else router.refresh();
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
              onNavigateToVars={() => setActiveTab('vars')}
            />
          </TabsContent>

          <TabsContent value="criteria" className="mt-4">
            <StepCriteriaTab
              testId={test.id}
              screenshots={latestResult?.screenshots ?? null}
              stepCriteria={test.stepCriteria ?? null}
              assertions={test.assertions ?? null}
              code={test.code ?? null}
              variables={test.variables ?? null}
              onSaveVariables={async (next) => {
                const { saveTestVariables } = await import('@/server/actions/tests');
                await saveTestVariables(test.id, next);
                // Refetch the parent's cached test detail. `router.refresh()`
                // alone won't help here — this view is hydrated from a client
                // server-action call that's not driven by server-component
                // rendering, so the cache lives in `definition-page-client`'s
                // `openTestDetailData` state.
                if (onRefresh) await onRefresh(); else router.refresh();
              }}
              onMutated={async () => {
                if (onRefresh) await onRefresh(); else router.refresh();
              }}
            />
          </TabsContent>

          <TabsContent value="vars" className="mt-4">
            <TestVarsTab
              testId={test.id}
              repositoryId={repositoryId ?? null}
              variables={test.variables ?? []}
              sheetSources={sheetDataSources}
              csvSources={csvDataSources}
              googleSheetsAccount={googleSheetsAccount}
              extractedValues={latestResult?.extractedVariables ?? null}
              assignedValues={latestResult?.assignedVariables ?? null}
              code={test.code ?? null}
              onRefresh={onRefresh}
              aiAvailable={aiAvailable}
              aiVarLastValues={test.aiVarLastValues ?? null}
              onSaveVariables={async (next) => {
                const { saveTestVariables } = await import('@/server/actions/tests');
                await saveTestVariables(test.id, next);
                if (onRefresh) await onRefresh(); else router.refresh();
              }}
            />
          </TabsContent>

          <TabsContent value="playback" className="mt-4 space-y-6">
            <TestSetupOverrides
              testId={test.id}
              setupOverrides={test.setupOverrides ?? null}
              defaultSetupSteps={defaultSetupSteps.map((s) => ({
                ...s,
                stepType: s.stepType as 'test' | 'script',
              }))}
              availableTests={availableTests}
              availableScripts={availableScripts}
              onRefresh={onRefresh}
            />

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
                  networkErrorMode: (playwrightDefaults?.networkErrorMode as 'fail' | 'warn' | 'ignore') ?? 'warn',
                  consoleErrorMode: (playwrightDefaults?.consoleErrorMode as 'fail' | 'warn' | 'ignore') ?? 'warn',
                  acceptAnyCertificate: playwrightDefaults?.acceptAnyCertificate ?? false,
                  maxParallelTests: playwrightDefaults?.maxParallelTests ?? 2,
                  cursorPlaybackSpeed: playwrightDefaults?.cursorPlaybackSpeed ?? 1,
                  baseUrl: envBaseUrl ?? 'http://localhost:3000',
                }}
              />
            )}
          </TabsContent>

          <TabsContent value="screenshots" className="mt-4 space-y-6">
            <ScreenshotTimeline
              testId={test.id}
              repositoryId={repositoryId ?? null}
              screenshotGroups={screenshotGroups}
              plannedScreenshots={plannedScreenshots}
              onUpdate={() => router.refresh()}
            />
          </TabsContent>

          <TabsContent value="inspect" className="mt-4">
            <InspectTabClient testId={test.id} />
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

                            <RuntimeErrorsPanel consoleErrors={result.consoleErrors} networkRequests={result.networkRequests} networkBodiesPath={result.networkBodiesPath} downloads={result.downloads} />

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
                                No screenshots captured in this run. Add a Screenshot step
                                in the <span className="font-medium">Steps</span> tab to record one.
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
                        <VideoPlayer
                          src={result.videoPath!}
                          preload="metadata"
                          className="w-full aspect-video rounded border"
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
                    {versions.map((version, idx) => {
                      // Each `testVersions` row stores the code state BEFORE its own
                      // change (`updateTestWithVersion` saves `test.code` first, then
                      // updates). So the diff that this version introduced is:
                      //   before = versions[idx].code (this row's pre-change snapshot)
                      //   after  = next-newer snapshot, OR `test.code` if this is the
                      //            latest version (idx === 0)
                      // versions arrive newest-first.
                      const beforeCode = version.code ?? '';
                      const afterCode = idx === 0
                        ? (test.code ?? '')
                        : (versions[idx - 1].code ?? '');
                      const isExpanded = expandedDiffVersion === version.version;
                      const diff = isExpanded
                        ? diffTextLines(beforeCode, afterCode)
                        : null;
                      const stats = diff ? diffStats(diff) : null;
                      return (
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
                              {beforeCode !== afterCode && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setExpandedDiffVersion(isExpanded ? null : version.version)}
                                  title={isExpanded ? 'Hide diff' : `Show what changed in v${version.version}`}
                                >
                                  {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                </Button>
                              )}
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
                          {isExpanded && diff && (
                            <div className="mt-3 border rounded-md overflow-hidden">
                              <div className="px-3 py-1.5 bg-muted/40 text-xs font-mono text-muted-foreground flex items-center justify-between">
                                <span>
                                  Changes in v{version.version}
                                  {idx === 0 && <span className="ml-1 text-muted-foreground/60">(current)</span>}
                                </span>
                                {stats && (
                                  <span className="flex items-center gap-2">
                                    <span className="text-emerald-600 dark:text-emerald-400">+{stats.added}</span>
                                    <span className="text-red-600 dark:text-red-400">-{stats.removed}</span>
                                  </span>
                                )}
                              </div>
                              <pre className="text-xs font-mono overflow-x-auto max-h-[500px] overflow-y-auto bg-background">
                                {diff.map((line, lineIdx) => {
                                  const bg =
                                    line.op === 'add' ? 'bg-emerald-50 dark:bg-emerald-950/40' :
                                    line.op === 'del' ? 'bg-red-50 dark:bg-red-950/40' : '';
                                  const prefix = line.op === 'add' ? '+' : line.op === 'del' ? '-' : ' ';
                                  return (
                                    <div key={lineIdx} className={`flex ${bg}`}>
                                      <span className="select-none w-10 text-right pr-1 text-muted-foreground/60 border-r">
                                        {line.oldLineNo ?? ''}
                                      </span>
                                      <span className="select-none w-10 text-right pr-1 text-muted-foreground/60 border-r">
                                        {line.newLineNo ?? ''}
                                      </span>
                                      <span className="select-none w-4 text-center text-muted-foreground">{prefix}</span>
                                      <span className="flex-1 whitespace-pre pl-1 pr-2">{line.line || ' '}</span>
                                    </div>
                                  );
                                })}
                              </pre>
                            </div>
                          )}
                        </div>
                      );
                    })}
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
