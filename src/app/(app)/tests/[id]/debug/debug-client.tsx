'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { usePreferredRunner } from '@/hooks/use-preferred-runner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Play,
  StepForward,
  SkipBack,
  Square,
  ArrowLeft,
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  Pause,
  FastForward,
  FileSearch,
  Globe,
  Terminal,
  Circle,
  Tv2,
  Crosshair,
  FileCode,
  Copy,
  Download,
  Search,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { startDebugSession, getDebugState, sendDebugCommand, stopDebugSession, flushDebugTrace } from '@/server/actions/debug';
import { toast } from 'sonner';
import type { Test } from '@/lib/db/schema';
import type { DebugState, DebugNetworkEntry, DebugConsoleEntry } from '@/lib/playwright/types';
import { BrowserViewer, type BrowserViewerHandle, type InspectElementResult, type DomSnapshotResult } from '@/components/embedded-browser/browser-viewer-client';
import { Input } from '@/components/ui/input';
import { ExecutionTargetSelector } from '@/components/execution/execution-target-selector';
import { getStreamUrlForRunner } from '@/server/actions/embedded-sessions';

interface DebugClientProps {
  test: Test;
  repositoryId: string | null;
}

export function DebugClient({ test, repositoryId }: DebugClientProps) {
  const router = useRouter();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [state, setState] = useState<DebugState | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stepListRef = useRef<HTMLDivElement>(null);

  // Runner selector + live view state
  const [executionTarget, setExecutionTarget, isRunnerHydrated] = usePreferredRunner();
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [resolvedRunnerId, setResolvedRunnerId] = useState<string | null>(null);

  // Inspect / DOM snapshot state
  const [inspectMode, setInspectMode] = useState(false);
  const [inspectedElement, setInspectedElement] = useState<InspectElementResult | null>(null);
  const [domSnapshot, setDomSnapshot] = useState<DomSnapshotResult | null>(null);
  const [domSnapshotLoading, setDomSnapshotLoading] = useState(false);
  const [selectorSearch, setSelectorSearch] = useState('');
  const browserViewerRef = useRef<BrowserViewerHandle>(null);
  const [rightTab, setRightTab] = useState('steps');
  const [leftTab, setLeftTab] = useState('code');

  // Editable code state
  const [localCode, setLocalCode] = useState<string>(test.code || '');
  const lastSentCodeRef = useRef<string>(test.code || '');
  const codeVersionRef = useRef<number>(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track sessionId in a ref so cleanup/effect can access latest value
  const sessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  // Guards against double-releasing the EB across stop button, unmount, and pagehide beacon
  const releasedRef = useRef(false);
  useEffect(() => {
    releasedRef.current = false;
  }, [sessionId]);

  const isRemote = executionTarget !== 'local';

  // Track whether initial mount has completed to avoid double-start from hydration
  const hasMountedRef = useRef(false);
  // Serializes concurrent init attempts (e.g. Strict Mode double-mount in dev) so the
  // second mount waits for the first to finish releasing its claimed EB before claiming again.
  const initPromiseRef = useRef<Promise<void> | null>(null);

  // Start session on mount or when execution target changes (wait for hydration)
  useEffect(() => {
    if (!isRunnerHydrated) return;

    let cancelled = false;
    const previous = initPromiseRef.current;
    const run = (async () => {
      if (previous) await previous.catch(() => {});
      if (cancelled) return;

      // Stop any existing session (only on target change after initial mount)
      const prevSessionId = sessionIdRef.current;
      if (prevSessionId && hasMountedRef.current) {
        await stopDebugSession(prevSessionId).catch(() => {});
        if (cancelled) return;
        setSessionId(null);
        setState(null);
      }
      hasMountedRef.current = true;
      const result = await startDebugSession(test.id, repositoryId, executionTarget === 'local' ? null : executionTarget);
      if (cancelled) {
        // Effect was cancelled after the EB was already claimed (e.g. Strict Mode double-mount
        // in dev, or fast unmount). Release it so subsequent claims can succeed.
        if (result.sessionId) {
          await stopDebugSession(result.sessionId).catch(() => {});
        }
        return;
      }
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setSessionId(result.sessionId);
      if (result.actualRunnerId) {
        setResolvedRunnerId(result.actualRunnerId);
      }
    })();
    initPromiseRef.current = run;

    return () => {
      cancelled = true;
    };
  }, [test.id, repositoryId, executionTarget, isRunnerHydrated]);

  // Poll for state
  useEffect(() => {
    if (!sessionId) return;

    const poll = async () => {
      const s = await getDebugState(sessionId);
      if (s) {
        setState(s);
        // Sync server code → localCode when codeVersion changes (no pending local edits)
        if (s.codeVersion !== codeVersionRef.current) {
          codeVersionRef.current = s.codeVersion;
          if (!debounceRef.current) {
            setLocalCode(s.code);
            lastSentCodeRef.current = s.code;
          }
        }
      }
    };

    // Initial fetch
    poll();

    pollingRef.current = setInterval(poll, 250);

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [sessionId]);

  // Cleanup on unmount (covers SPA route changes — other exit paths handled separately)
  useEffect(() => {
    return () => {
      if (sessionIdRef.current && !releasedRef.current) {
        releasedRef.current = true;
        stopDebugSession(sessionIdRef.current).catch(() => {});
      }
    };
  }, []);

  // Tab close / reload / browser close: use sendBeacon since server actions get aborted on unload.
  // pagehide is preferred over beforeunload (doesn't break bfcache, more reliable on mobile).
  // visibilitychange=hidden is a belt-and-braces guard for mobile Safari edge cases.
  useEffect(() => {
    if (!sessionId) return;
    const release = () => {
      if (releasedRef.current) return;
      releasedRef.current = true;
      const blob = new Blob([JSON.stringify({ sessionId })], { type: 'application/json' });
      navigator.sendBeacon('/api/debug/release', blob);
    };
    const onPageHide = () => release();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') release();
    };
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [sessionId]);

  // Auto-scroll step list to current step
  useEffect(() => {
    if (state?.currentStepIndex !== undefined && stepListRef.current) {
      const el = stepListRef.current.querySelector(`[data-step-index="${state.currentStepIndex}"]`);
      if (el) {
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }, [state?.currentStepIndex]);

  const sendCmd = useCallback(async (cmd: Parameters<typeof sendDebugCommand>[1]) => {
    if (!sessionId) return;
    const result = await sendDebugCommand(sessionId, cmd);
    if (!result.ok && result.error) {
      toast.error(result.error);
    }
  }, [sessionId]);

  const handleStop = useCallback(async () => {
    if (sessionId && !releasedRef.current) {
      releasedRef.current = true;
      try {
        await stopDebugSession(sessionId);
      } catch {
        // ignore — reaper / unmount fallback will catch it
      }
    }
    router.push(`/tests?test=${encodeURIComponent(test.id)}`);
  }, [sessionId, router, test.id]);

  // Debounced code update handler
  const handleCodeChange = useCallback((newCode: string) => {
    setLocalCode(newCode);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      if (newCode !== lastSentCodeRef.current) {
        lastSentCodeRef.current = newCode;
        sendCmd({ type: 'update_code', code: newCode });
      }
    }, 500);
  }, [sendCmd]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const inTextarea = (e.target as HTMLElement)?.tagName === 'TEXTAREA';

      // In textarea: only respond to Ctrl-modified shortcuts
      if (inTextarea && !e.ctrlKey && !e.metaKey) return;

      if ((e.key === 'Enter') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (e.shiftKey) {
          sendCmd({ type: 'step_back' });
        } else {
          sendCmd({ type: 'step_forward' });
        }
      } else if (e.key === 'F10') {
        e.preventDefault();
        if (e.shiftKey) {
          sendCmd({ type: 'step_back' });
        } else {
          sendCmd({ type: 'step_forward' });
        }
      } else if (e.key === 'F9') {
        e.preventDefault();
        sendCmd({ type: 'step_back' });
      } else if (e.key === 'F5' && (e.ctrlKey || e.metaKey || !inTextarea)) {
        e.preventDefault();
        sendCmd({ type: 'run_to_end' });
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleStop();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [sendCmd, handleStop]);

  // Resolve stream URL when actual runner is known
  useEffect(() => {
    let cancelled = false;
    const runnerId = resolvedRunnerId || (executionTarget !== 'local' && executionTarget !== 'auto' ? executionTarget : null);
    if (!runnerId) {
      Promise.resolve().then(() => { if (!cancelled) setStreamUrl(null); });
    } else {
      (async () => {
        try {
          const streamInfo = await getStreamUrlForRunner(runnerId);
          if (cancelled) return;
          if (streamInfo?.streamUrl) {
            const token = streamInfo.streamAuthToken;
            setStreamUrl(
              token
                ? `${streamInfo.streamUrl}?token=${encodeURIComponent(token)}`
                : streamInfo.streamUrl
            );
          } else {
            setStreamUrl(null);
          }
        } catch {
          if (!cancelled) setStreamUrl(null);
        }
      })();
    }
    return () => { cancelled = true; };
  }, [executionTarget, resolvedRunnerId]);

  const isPaused = state?.status === 'paused';
  const isError = state?.status === 'error';
  const isCompleted = state?.status === 'completed';
  const isInitializing = state?.status === 'initializing' || !state;
  const isRecording = state?.isRecording ?? false;
  const isBusy = state?.status === 'stepping' || state?.status === 'running';

  // Past-step edit warning
  const hasPastStepWarning = state?.error?.includes('Step back to apply');

  const statusColor = {
    initializing: 'bg-yellow-500',
    paused: 'bg-blue-500',
    stepping: 'bg-yellow-500',
    running: 'bg-green-500',
    completed: 'bg-green-600',
    error: 'bg-red-500',
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-2 bg-background">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.push(`/tests?test=${encodeURIComponent(test.id)}`)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-sm font-medium">Debug: {test.name}</h1>
          <ExecutionTargetSelector
            value={executionTarget}
            onChange={setExecutionTarget}
            capabilityFilter="run"
            size="sm"
            disabled={!!sessionId}
          />
          <Badge
            variant="secondary"
            className={`text-white ${statusColor[state?.status || 'initializing']}`}
          >
            {state?.status || 'initializing'}
          </Badge>
          {isRecording && (
            <span className="flex items-center gap-1 text-xs text-red-500">
              <Circle className="h-2 w-2 fill-red-500 animate-pulse" />
              REC
            </span>
          )}
          {state && state.steps.length > 0 && (
            <span className="text-xs text-muted-foreground">
              Step {(state.currentStepIndex ?? -1) + 1} / {state.steps.length}
            </span>
          )}
        </div>

        {/* Control bar */}
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => sendCmd({ type: 'step_back' })}
            disabled={isRecording || ((!isPaused && !isError) || (state?.currentStepIndex ?? 0) <= 0)}
            title="Step Back (Ctrl+Shift+Enter / F9)"
          >
            <SkipBack className="h-4 w-4" />
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={() => sendCmd({ type: 'step_forward' })}
            disabled={isRecording || (!isPaused && !isError)}
            title="Step Forward (Ctrl+Enter / F10)"
          >
            <StepForward className="h-4 w-4 mr-1" />
            Step
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => sendCmd({ type: 'run_to_end' })}
            disabled={isRecording || (!isPaused && !isError)}
            title="Run to End (Ctrl+F5)"
          >
            <FastForward className="h-4 w-4 mr-1" />
            Run
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleStop}
            title="Stop (Escape)"
          >
            <Square className="h-4 w-4" />
          </Button>
          <div className="w-px h-5 bg-border mx-1" />
          {/* Record toggle (local only — remote debug executor doesn't support recording yet) */}
          {!isRemote && (isRecording ? (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => sendCmd({ type: 'stop_recording' })}
              title="Stop Recording"
            >
              <Square className="h-3 w-3 mr-1" />
              Stop Rec{(state?.recordedEventCount ?? 0) > 0 ? ` (${state!.recordedEventCount})` : ''}
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => sendCmd({ type: 'start_recording' })}
              disabled={!isPaused}
              title="Record actions in browser"
            >
              <Circle className="h-3 w-3 mr-1 text-red-500 fill-red-500" />
              Record
            </Button>
          ))}
          {!isRemote && (
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                if (!sessionId) return;
                const result = await flushDebugTrace(sessionId);
                const traceUrl = result.url || state?.traceUrl;
                if (traceUrl) {
                  window.open(
                    `https://trace.playwright.dev/?trace=${window.location.origin}${traceUrl}`,
                    '_blank'
                  );
                } else {
                  toast.error('No trace available');
                }
              }}
              disabled={!sessionId}
              title="Export Playwright Trace"
            >
              <FileSearch className="h-4 w-4 mr-1" />
              Trace
            </Button>
          )}
          {streamUrl && (
            <>
              <div className="w-px h-5 bg-border mx-1" />
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setDomSnapshotLoading(true);
                  browserViewerRef.current?.requestDomSnapshot();
                }}
                disabled={!streamUrl || domSnapshotLoading}
                title="Download all selectors from current page"
              >
                {domSnapshotLoading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <FileCode className="h-4 w-4 mr-1" />}
                DOM
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Main content */}
      {isInitializing ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Launching browser...</p>
          </div>
        </div>
      ) : (
        <ResizablePanelGroup orientation="horizontal" className="flex-1 min-h-0">
          {/* Left Panel — Code / Live View */}
          <ResizablePanel defaultSize={60} minSize={30}>
            <Tabs value={leftTab} onValueChange={setLeftTab} className="flex flex-col h-full gap-0">
              <div className="px-2 py-1.5 border-b bg-muted/50">
                <TabsList className="h-7">
                  <TabsTrigger value="code" className="text-xs px-2 py-0.5 h-6">
                    Code
                  </TabsTrigger>
                  {streamUrl && (
                    <TabsTrigger value="liveview" className="text-xs px-2 py-0.5 h-6">
                      <Tv2 className="h-3 w-3 mr-1" />
                      Live View
                    </TabsTrigger>
                  )}
                </TabsList>
              </div>

              <TabsContent value="code" className="flex flex-col flex-1 min-h-0 mt-0">
                {/* Past-step edit warning */}
                {hasPastStepWarning && (
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-yellow-500/10 border-b border-yellow-500/20">
                    <p className="text-xs text-yellow-600 flex-1">Code changed at an already-executed step. Step back to apply changes.</p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 text-xs border-yellow-500/30 text-yellow-600"
                      onClick={() => sendCmd({ type: 'step_back' })}
                    >
                      <SkipBack className="h-3 w-3 mr-1" />
                      Step Back
                    </Button>
                  </div>
                )}
                <EditableCodeDisplay
                  code={localCode}
                  steps={state?.steps || []}
                  currentStepIndex={state?.currentStepIndex ?? -1}
                  stepResults={state?.stepResults || []}
                  onCodeChange={handleCodeChange}
                  onClickStep={(idx) => {
                    if ((isPaused || isError || isCompleted) && idx !== (state?.currentStepIndex ?? -1)) {
                      sendCmd({ type: 'run_to_step', stepIndex: idx });
                    }
                  }}
                  disabled={isBusy}
                />
              </TabsContent>

              {streamUrl && (
                <TabsContent value="liveview" className="flex flex-col flex-1 min-h-0 mt-0">
                  <BrowserViewer
                    ref={browserViewerRef}
                    streamUrl={streamUrl}
                    className="h-full"
                    interactive={isRecording || inspectMode}
                    inspectMode={inspectMode}
                    onInspectResult={(result) => setInspectedElement(result)}
                    onDomSnapshot={(result) => { setDomSnapshot(result); setDomSnapshotLoading(false); }}
                    hideControls
                    hideFullscreenToggle
                    hideScreenshot
                    hideViewportSelector
                    readOnlyUrl
                  />
                </TabsContent>
              )}
            </Tabs>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* Right Panel — Tabbed: Steps / Network / Console */}
          <ResizablePanel defaultSize={40} minSize={20} className="overflow-hidden">
            <Tabs value={rightTab} onValueChange={(tab) => {
              setRightTab(tab);
              if (tab === 'selectors' && streamUrl) {
                // Auto-enable inspect mode and switch to live view
                setInspectMode(true);
                browserViewerRef.current?.sendInspectMode(true);
                if (leftTab !== 'liveview') setLeftTab('liveview');
              } else if (rightTab === 'selectors' && tab !== 'selectors') {
                // Leaving selectors tab — disable inspect mode
                setInspectMode(false);
                browserViewerRef.current?.sendInspectMode(false);
              }
            }} className="flex flex-col h-full gap-0">
              <div className="px-2 py-1.5 border-b bg-muted/50">
                <TabsList className="h-7">
                  <TabsTrigger value="steps" className="text-xs px-2 py-0.5 h-6">
                    Steps
                  </TabsTrigger>
                  <TabsTrigger value="network" className="text-xs px-2 py-0.5 h-6">
                    <Globe className="h-3 w-3 mr-1" />
                    Network{(state?.networkEntries?.length ?? 0) > 0 && ` (${state!.networkEntries.length})`}
                  </TabsTrigger>
                  <TabsTrigger value="console" className="text-xs px-2 py-0.5 h-6">
                    <Terminal className="h-3 w-3 mr-1" />
                    Console{(state?.consoleEntries?.length ?? 0) > 0 && ` (${state!.consoleEntries.length})`}
                  </TabsTrigger>
                  {streamUrl && (
                    <TabsTrigger value="selectors" className="text-xs px-2 py-0.5 h-6">
                      <Crosshair className="h-3 w-3 mr-1" />
                      Selectors
                    </TabsTrigger>
                  )}
                </TabsList>
              </div>

              {/* Steps Tab */}
              <TabsContent value="steps" className="flex flex-col flex-1 min-h-0 mt-0">
                {/* Error banner (non-past-step errors) */}
                {isError && state?.error && !hasPastStepWarning && (
                  <div className="mx-3 mt-2 p-2 rounded bg-destructive/10 border border-destructive/20">
                    <p className="text-xs text-destructive font-mono">{state.error}</p>
                  </div>
                )}

                {/* Completed banner */}
                {isCompleted && (
                  <div className="mx-3 mt-2 p-2 rounded bg-green-500/10 border border-green-500/20">
                    <p className="text-xs text-green-600">All steps completed successfully.</p>
                  </div>
                )}

                <ScrollArea className="flex-1 overflow-hidden">
                  <div ref={stepListRef} className="p-2 space-y-1">
                    {(state?.steps || []).map((step, idx) => {
                      const result = state?.stepResults?.[idx];
                      const isCurrent = idx === (state?.currentStepIndex ?? -1);
                      const isStepPassed = result?.status === 'passed';
                      const isFailed = result?.status === 'failed';
                      const isPendingStep = result?.status === 'pending';

                      return (
                        <div
                          key={step.id}
                          data-step-index={idx}
                          className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs cursor-pointer hover:bg-muted/50 ${
                            isCurrent ? 'bg-blue-500/10 border border-blue-500/30' : ''
                          }`}
                          onClick={() => {
                            if ((isPaused || isError || isCompleted) && idx !== (state?.currentStepIndex ?? -1)) {
                              sendCmd({ type: 'run_to_step', stepIndex: idx });
                            }
                          }}
                        >
                          {/* Status icon */}
                          <div className="w-4 h-4 flex-shrink-0">
                            {isFailed ? (
                              <XCircle className="h-4 w-4 text-destructive" />
                            ) : isStepPassed ? (
                              <CheckCircle className="h-4 w-4 text-green-500" />
                            ) : isCurrent && (state?.status === 'stepping' || state?.status === 'running') ? (
                              <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                            ) : isCurrent ? (
                              <Play className="h-4 w-4 text-blue-500" />
                            ) : isPendingStep ? (
                              <Clock className="h-4 w-4 text-muted-foreground/40" />
                            ) : (
                              <Pause className="h-4 w-4 text-muted-foreground/40" />
                            )}
                          </div>

                          {/* Step info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-muted-foreground">{idx + 1}.</span>
                              <span className={`truncate ${isCurrent ? 'font-medium' : ''}`}>
                                {step.label}
                              </span>
                              <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 flex-shrink-0">
                                {step.type}
                              </Badge>
                            </div>
                            {isFailed && result?.error && (
                              <p className="text-destructive mt-0.5 truncate font-mono">{result.error}</p>
                            )}
                          </div>

                          {/* Duration */}
                          {result && result.durationMs > 0 && (
                            <span className="text-[10px] text-muted-foreground flex-shrink-0">
                              {result.durationMs}ms
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>

                {/* Keyboard shortcuts hint */}
                <div className="border-t px-3 py-1.5 bg-muted/30">
                  <p className="text-[10px] text-muted-foreground">
                    <kbd className="px-1 py-0.5 bg-muted rounded text-[9px]">Ctrl+Enter</kbd> Step
                    {' '}<kbd className="px-1 py-0.5 bg-muted rounded text-[9px]">Ctrl+Shift+Enter</kbd> Back
                    {' '}<kbd className="px-1 py-0.5 bg-muted rounded text-[9px]">Ctrl+F5</kbd> Run all
                    {' '}<kbd className="px-1 py-0.5 bg-muted rounded text-[9px]">Esc</kbd> Stop
                  </p>
                </div>
              </TabsContent>

              {/* Network Tab */}
              <TabsContent value="network" className="flex flex-col flex-1 min-h-0 mt-0">
                <NetworkPanel entries={state?.networkEntries || []} />
              </TabsContent>

              {/* Console Tab */}
              <TabsContent value="console" className="flex flex-col flex-1 min-h-0 mt-0 overflow-hidden">
                <ConsolePanel entries={state?.consoleEntries || []} />
              </TabsContent>

              {/* Selectors Tab */}
              {streamUrl && (
                <TabsContent value="selectors" className="flex flex-col flex-1 min-h-0 mt-0">
                  <SelectorsPanel
                    inspectedElement={inspectedElement}
                    domSnapshot={domSnapshot}
                    domSnapshotLoading={domSnapshotLoading}
                    search={selectorSearch}
                    onSearchChange={setSelectorSearch}
                    onRequestDomSnapshot={() => {
                      setDomSnapshotLoading(true);
                      browserViewerRef.current?.requestDomSnapshot();
                    }}
                  />
                </TabsContent>
              )}

            </Tabs>
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
    </div>
  );
}

// -------- Editable Code Display Component --------

interface EditableCodeDisplayProps {
  code: string;
  steps: DebugState['steps'];
  currentStepIndex: number;
  stepResults: DebugState['stepResults'];
  onCodeChange: (code: string) => void;
  onClickStep: (idx: number) => void;
  disabled: boolean;
}

function EditableCodeDisplay({ code, steps, currentStepIndex, stepResults, onCodeChange, onClickStep, disabled }: EditableCodeDisplayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);

  // Sync scroll between textarea and highlight layer
  const handleScroll = useCallback(() => {
    if (textareaRef.current && highlightRef.current) {
      highlightRef.current.scrollTop = textareaRef.current.scrollTop;
      highlightRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  }, []);

  return (
    <div ref={containerRef} className="relative flex-1 overflow-hidden">
      {/* Background: highlighted code display (pointer-events-none) */}
      <div
        ref={highlightRef}
        className="absolute inset-0 overflow-hidden pointer-events-none"
      >
        <CodeHighlight
          code={code}
          steps={steps}
          currentStepIndex={currentStepIndex}
          stepResults={stepResults}
        />
      </div>
      {/* Foreground: transparent textarea for editing */}
      <textarea
        ref={textareaRef}
        value={code}
        onChange={(e) => onCodeChange(e.target.value)}
        onScroll={handleScroll}
        readOnly={disabled}
        className="absolute inset-0 w-full h-full font-mono text-xs leading-5 bg-transparent resize-none focus:outline-none pl-12 pr-4 py-0 overflow-auto"
        style={{ color: 'transparent', caretColor: 'var(--foreground)' }}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
      />
      {/* Click overlay for step navigation (only on the gutter area) */}
      <div className="absolute inset-y-0 left-0 w-12">
        {code.split('\n').map((_, lineIdx) => {
          const lineNum = lineIdx + 1;
          const funcMatch = code.match(/export\s+async\s+function\s+test\s*\([^)]*\)\s*\{/);
          const bodyStartLine = funcMatch
            ? code.slice(0, (funcMatch.index ?? 0) + funcMatch[0].length).split('\n').length
            : 0;
          const bodyLineNum = lineNum - bodyStartLine;
          let stepIdx: number | undefined;
          for (const step of steps) {
            if (bodyLineNum >= step.lineStart && bodyLineNum <= step.lineEnd) {
              stepIdx = steps.indexOf(step);
              break;
            }
          }
          if (stepIdx === undefined) return null;
          const sIdx = stepIdx;
          return (
            <div
              key={lineIdx}
              className="h-5 cursor-pointer"
              onClick={() => onClickStep(sIdx)}
            />
          );
        })}
      </div>
    </div>
  );
}

// -------- Code Highlight (read-only rendering layer) --------

interface CodeHighlightProps {
  code: string;
  steps: DebugState['steps'];
  currentStepIndex: number;
  stepResults: DebugState['stepResults'];
}

function CodeHighlight({ code, steps, currentStepIndex, stepResults }: CodeHighlightProps) {
  const lines = code.split('\n');

  // Build line → step mapping
  const lineStepMap = new Map<number, { stepIdx: number; isStart: boolean }>();
  steps.forEach((step, idx) => {
    for (let line = step.lineStart; line <= step.lineEnd; line++) {
      lineStepMap.set(line, { stepIdx: idx, isStart: line === step.lineStart });
    }
  });

  // Find the line offset
  const funcMatch = code.match(/export\s+async\s+function\s+test\s*\([^)]*\)\s*\{/);
  const bodyStartLine = funcMatch
    ? code.slice(0, (funcMatch.index ?? 0) + funcMatch[0].length).split('\n').length
    : 0;

  return (
    <div className="font-mono text-xs leading-5">
      {lines.map((line, lineIdx) => {
        const lineNum = lineIdx + 1;
        const bodyLineNum = lineNum - bodyStartLine;
        const stepInfo = lineStepMap.get(bodyLineNum);
        const stepIdx = stepInfo?.stepIdx;

        const isCurrent = stepIdx !== undefined && stepIdx === currentStepIndex;
        const isPassed = stepIdx !== undefined && stepResults[stepIdx]?.status === 'passed';
        const isFailed = stepIdx !== undefined && stepResults[stepIdx]?.status === 'failed';

        let bgColor = '';
        if (isCurrent) bgColor = 'bg-blue-500/10';
        else if (isFailed) bgColor = 'bg-red-500/5';
        else if (isPassed) bgColor = '';

        let gutterColor = 'text-muted-foreground/40';
        if (isFailed) gutterColor = 'text-red-500';
        else if (isPassed) gutterColor = 'text-green-500';
        else if (isCurrent) gutterColor = 'text-blue-500';

        return (
          <div
            key={lineIdx}
            className={`flex ${bgColor}`}
          >
            {/* Gutter */}
            <div className={`w-12 flex-shrink-0 text-right pr-3 select-none ${gutterColor}`}>
              {isCurrent && stepInfo?.isStart ? '>' : ' '}{lineNum}
            </div>
            {/* Code */}
            <pre className="flex-1 whitespace-pre-wrap break-all pr-4">
              {line}
            </pre>
          </div>
        );
      })}
    </div>
  );
}

// -------- Network Panel Component --------

function NetworkPanel({ entries }: { entries: DebugNetworkEntry[] }) {
  const getStatusColor = (entry: DebugNetworkEntry) => {
    if (entry.failed) return 'text-red-500';
    if (entry.status === null) return 'text-muted-foreground';
    if (entry.status >= 200 && entry.status < 300) return 'text-green-500';
    if (entry.status >= 300 && entry.status < 400) return 'text-yellow-500';
    return 'text-red-500';
  };

  if (entries.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-xs text-muted-foreground">No network requests captured yet.</p>
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1">
      <div className="text-xs">
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-1 border-b bg-muted/30 text-muted-foreground font-medium sticky top-0">
          <span className="w-12">Method</span>
          <span className="flex-1 min-w-0">URL</span>
          <span className="w-10 text-right">Status</span>
          <span className="w-14 text-right">Time</span>
          <span className="w-16">Type</span>
        </div>
        {entries.map((entry) => (
          <div
            key={entry.id}
            className={`flex items-center gap-2 px-3 py-1 border-b border-border/50 hover:bg-muted/30 ${entry.failed ? 'bg-red-500/5' : ''}`}
          >
            <span className="w-12 font-mono font-medium flex-shrink-0">{entry.method}</span>
            <span className="flex-1 min-w-0 truncate font-mono text-muted-foreground" title={entry.url}>
              {truncateUrl(entry.url)}
            </span>
            <span className={`w-10 text-right font-mono flex-shrink-0 ${getStatusColor(entry)}`}>
              {entry.failed ? 'ERR' : entry.status ?? '...'}
            </span>
            <span className="w-14 text-right text-muted-foreground flex-shrink-0">
              {entry.duration !== null ? `${entry.duration}ms` : '...'}
            </span>
            <span className="w-16 truncate text-muted-foreground flex-shrink-0">{entry.resourceType}</span>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

function truncateUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url.length > 80 ? url.slice(0, 80) + '...' : url;
  }
}

// -------- Console Panel Component --------

function ConsolePanel({ entries }: { entries: DebugConsoleEntry[] }) {
  const getTypeColor = (type: string) => {
    switch (type) {
      case 'error': return 'text-red-500 bg-red-500/10';
      case 'warning': return 'text-yellow-500 bg-yellow-500/10';
      case 'info': return 'text-blue-500 bg-blue-500/10';
      default: return 'text-muted-foreground bg-muted/50';
    }
  };

  const getTypeBadge = (type: string) => {
    switch (type) {
      case 'error': return 'ERR';
      case 'warning': return 'WARN';
      case 'info': return 'INFO';
      case 'log': return 'LOG';
      default: return type.toUpperCase().slice(0, 4);
    }
  };

  if (entries.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-xs text-muted-foreground">No console messages captured yet.</p>
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1 h-full">
      <div className="text-xs">
        {entries.map((entry) => (
          <div
            key={entry.id}
            className={`flex items-start gap-2 px-3 py-1 border-b border-border/50 ${
              entry.type === 'error' ? 'bg-red-500/5' : entry.type === 'warning' ? 'bg-yellow-500/5' : ''
            }`}
          >
            <span className={`px-1 py-0.5 rounded text-[10px] font-medium flex-shrink-0 ${getTypeColor(entry.type)}`}>
              {getTypeBadge(entry.type)}
            </span>
            <span className="flex-1 min-w-0 font-mono break-all whitespace-pre-wrap">{entry.text}</span>
            <span className="text-[10px] text-muted-foreground flex-shrink-0">
              s{entry.stepIndex >= 0 ? entry.stepIndex + 1 : '-'}
            </span>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

// -------- Selectors Panel Component --------

interface SelectorsPanelProps {
  inspectedElement: InspectElementResult | null;
  domSnapshot: DomSnapshotResult | null;
  domSnapshotLoading: boolean;
  search: string;
  onSearchChange: (s: string) => void;
  onRequestDomSnapshot: () => void;
}

function SelectorsPanel({ inspectedElement, domSnapshot, domSnapshotLoading, search, onSearchChange, onRequestDomSnapshot }: SelectorsPanelProps) {
  const [expandedIdx, setExpandedIdx] = useState<Set<number>>(new Set());

  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text).then(() => toast.success('Copied'));
  }, []);

  const handleDownloadJson = useCallback(() => {
    if (!domSnapshot) return;
    const blob = new Blob([JSON.stringify(domSnapshot, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dom-selectors-${new Date().toISOString().slice(0, 19)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [domSnapshot]);

  const toggleExpand = useCallback((idx: number) => {
    setExpandedIdx(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  // No data at all
  if (!inspectedElement && !domSnapshot) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-4">
        <Crosshair className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-xs text-muted-foreground text-center">
          Click any element in the Live View to inspect its selectors.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={onRequestDomSnapshot}
          disabled={domSnapshotLoading}
        >
          {domSnapshotLoading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <FileCode className="h-4 w-4 mr-1" />}
          Snapshot All Selectors
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Inspected element result */}
      {inspectedElement && (
        <div className="border-b">
          <div className="px-3 py-2 bg-blue-500/5 border-b">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">
                &lt;{inspectedElement.tag}&gt;
                {inspectedElement.id && <span className="text-muted-foreground ml-1">#{inspectedElement.id}</span>}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {Math.round(inspectedElement.boundingBox.width)}x{Math.round(inspectedElement.boundingBox.height)}
              </span>
            </div>
            {inspectedElement.textContent && (
              <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{inspectedElement.textContent}</p>
            )}
          </div>
          <div className="divide-y">
            {inspectedElement.selectors.map((sel, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted/30">
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 flex-shrink-0 font-mono">
                  {sel.type}
                </Badge>
                <code className="flex-1 min-w-0 text-[11px] font-mono truncate" title={sel.value}>
                  {sel.value}
                </code>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 flex-shrink-0"
                  onClick={() => copyToClipboard(sel.value)}
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* DOM snapshot */}
      {domSnapshot && (
        <div className="flex flex-col flex-1 min-h-0">
          {/* Snapshot header with search + download */}
          <div className="flex items-center gap-2 px-3 py-1.5 border-b bg-muted/30">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Filter selectors..."
                className="h-6 text-xs pl-7 py-0"
              />
            </div>
            <span className="text-[10px] text-muted-foreground flex-shrink-0">
              {domSnapshot.elements.length} elements
            </span>
            <Button variant="outline" size="sm" className="h-6 text-xs px-2" onClick={handleDownloadJson}>
              <Download className="h-3 w-3 mr-1" />
              JSON
            </Button>
          </div>

          {/* Elements list */}
          <ScrollArea className="flex-1">
            <div className="text-xs">
              {domSnapshot.elements
                .filter(el => {
                  if (!search) return true;
                  const q = search.toLowerCase();
                  return (
                    el.tag.includes(q) ||
                    el.id?.toLowerCase().includes(q) ||
                    el.textContent?.toLowerCase().includes(q) ||
                    el.selectors.some(s => s.value.toLowerCase().includes(q) || s.type.toLowerCase().includes(q))
                  );
                })
                .map((el, idx) => {
                  const isExpanded = expandedIdx.has(idx);
                  return (
                    <div key={idx} className="border-b border-border/50">
                      <div
                        className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-muted/30"
                        onClick={() => toggleExpand(idx)}
                      >
                        {isExpanded
                          ? <ChevronDown className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
                          : <ChevronRight className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
                        }
                        <span className="font-mono font-medium">&lt;{el.tag}&gt;</span>
                        {el.id && <span className="text-muted-foreground font-mono">#{el.id}</span>}
                        <span className="flex-1 min-w-0 truncate text-muted-foreground">
                          {el.textContent?.slice(0, 40)}
                        </span>
                        <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 flex-shrink-0">
                          {el.selectors.length}
                        </Badge>
                      </div>
                      {isExpanded && (
                        <div className="divide-y pl-7 bg-muted/20">
                          {el.selectors.map((sel, si) => (
                            <div key={si} className="flex items-center gap-2 px-3 py-1 hover:bg-muted/30">
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 flex-shrink-0 font-mono">
                                {sel.type}
                              </Badge>
                              <code className="flex-1 min-w-0 text-[11px] font-mono truncate" title={sel.value}>
                                {sel.value}
                              </code>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-5 w-5 flex-shrink-0"
                                onClick={(e) => { e.stopPropagation(); copyToClipboard(sel.value); }}
                              >
                                <Copy className="h-3 w-3" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
