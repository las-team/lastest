'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
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
} from 'lucide-react';
import { startDebugSession, getDebugState, sendDebugCommand, stopDebugSession } from '@/server/actions/debug';
import { toast } from 'sonner';
import type { Test } from '@/lib/db/schema';
import type { DebugState } from '@/lib/playwright/debug-runner';

interface DebugClientProps {
  test: Test;
  repositoryId: string | null;
}

export function DebugClient({ test, repositoryId }: DebugClientProps) {
  const router = useRouter();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [state, setState] = useState<DebugState | null>(null);
  const [editedCode, setEditedCode] = useState<string>(test.code || '');
  const [isEditing, setIsEditing] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const spaceHeldRef = useRef(false);
  const fastForwardRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const codeAreaRef = useRef<HTMLTextAreaElement>(null);
  const stepListRef = useRef<HTMLDivElement>(null);

  // Start session on mount
  useEffect(() => {
    let cancelled = false;
    async function init() {
      const result = await startDebugSession(test.id, repositoryId);
      if (cancelled) return;
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setSessionId(result.sessionId);
    }
    init();
    return () => {
      cancelled = true;
    };
  }, [test.id, repositoryId]);

  // Poll for state
  useEffect(() => {
    if (!sessionId) return;

    const poll = async () => {
      const s = await getDebugState(sessionId);
      if (s) setState(s);
    };

    // Initial fetch
    poll();

    pollingRef.current = setInterval(poll, 250);

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [sessionId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (sessionId) {
        stopDebugSession(sessionId).catch(() => {});
      }
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
    if (sessionId) {
      await stopDebugSession(sessionId);
    }
    router.push(`/tests/${test.id}`);
  }, [sessionId, router, test.id]);

  const handleCodeSave = useCallback(() => {
    if (!sessionId || !isEditing) return;
    sendCmd({ type: 'update_code', code: editedCode });
    setIsEditing(false);
  }, [sessionId, isEditing, editedCode, sendCmd]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle shortcuts while editing code
      if (isEditing && (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;

      if (e.key === 'Enter' || e.key === 'F10') {
        e.preventDefault();
        if (e.shiftKey) {
          sendCmd({ type: 'step_back' });
        } else {
          sendCmd({ type: 'step_forward' });
        }
      } else if (e.key === 'F9') {
        e.preventDefault();
        sendCmd({ type: 'step_back' });
      } else if (e.key === 'F5') {
        e.preventDefault();
        sendCmd({ type: 'run_to_end' });
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleStop();
      } else if (e.key === ' ' && !spaceHeldRef.current) {
        e.preventDefault();
        spaceHeldRef.current = true;
        // Start fast-forward
        fastForwardRef.current = setInterval(() => {
          sendCmd({ type: 'step_forward' });
        }, 200);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        spaceHeldRef.current = false;
        if (fastForwardRef.current) {
          clearInterval(fastForwardRef.current);
          fastForwardRef.current = null;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      if (fastForwardRef.current) clearInterval(fastForwardRef.current);
    };
  }, [sendCmd, handleStop, isEditing]);

  const isPaused = state?.status === 'paused';
  const isError = state?.status === 'error';
  const isCompleted = state?.status === 'completed';
  const isInitializing = state?.status === 'initializing' || !state;

  const statusColor = {
    initializing: 'bg-yellow-500',
    paused: 'bg-blue-500',
    stepping: 'bg-yellow-500',
    running: 'bg-green-500',
    completed: 'bg-green-600',
    error: 'bg-red-500',
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-2 bg-background">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.push(`/tests/${test.id}`)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-sm font-medium">Debug: {test.name}</h1>
          <Badge
            variant="secondary"
            className={`text-white ${statusColor[state?.status || 'initializing']}`}
          >
            {state?.status || 'initializing'}
          </Badge>
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
            disabled={!isPaused && !isError || (state?.currentStepIndex ?? 0) <= 0}
            title="Step Back (Shift+Enter / F9)"
          >
            <SkipBack className="h-4 w-4" />
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={() => sendCmd({ type: 'step_forward' })}
            disabled={!isPaused && !isError}
            title="Step Forward (Enter / F10)"
          >
            <StepForward className="h-4 w-4 mr-1" />
            Step
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => sendCmd({ type: 'run_to_end' })}
            disabled={!isPaused && !isError}
            title="Run to End (F5)"
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
        <ResizablePanelGroup orientation="horizontal" className="flex-1">
          {/* Left Panel — Code */}
          <ResizablePanel defaultSize={60} minSize={30}>
            <div className="flex flex-col h-full">
              <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/50">
                <span className="text-xs font-medium text-muted-foreground">Test Code</span>
                {isPaused && (
                  <div className="flex items-center gap-1">
                    {isEditing ? (
                      <>
                        <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => { setIsEditing(false); setEditedCode(state?.code || test.code || ''); }}>
                          Cancel
                        </Button>
                        <Button variant="default" size="sm" className="h-6 text-xs" onClick={handleCodeSave}>
                          Apply
                        </Button>
                      </>
                    ) : (
                      <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => { setEditedCode(state?.code || test.code || ''); setIsEditing(true); }}>
                        Edit
                      </Button>
                    )}
                  </div>
                )}
              </div>
              <ScrollArea className="flex-1">
                {isEditing ? (
                  <textarea
                    ref={codeAreaRef}
                    value={editedCode}
                    onChange={e => setEditedCode(e.target.value)}
                    className="w-full h-full min-h-[600px] p-3 font-mono text-xs bg-background resize-none focus:outline-none"
                    spellCheck={false}
                  />
                ) : (
                  <CodeDisplay
                    code={state?.code || test.code || ''}
                    steps={state?.steps || []}
                    currentStepIndex={state?.currentStepIndex ?? -1}
                    stepResults={state?.stepResults || []}
                    onClickStep={(idx) => {
                      if (isPaused && idx > (state?.currentStepIndex ?? -1)) {
                        sendCmd({ type: 'run_to_step', stepIndex: idx });
                      }
                    }}
                  />
                )}
              </ScrollArea>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* Right Panel — Steps & Results */}
          <ResizablePanel defaultSize={40} minSize={20}>
            <div className="flex flex-col h-full">
              <div className="px-3 py-1.5 border-b bg-muted/50">
                <span className="text-xs font-medium text-muted-foreground">Steps</span>
              </div>

              {/* Error banner */}
              {isError && state?.error && (
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

              <ScrollArea className="flex-1">
                <div ref={stepListRef} className="p-2 space-y-1">
                  {(state?.steps || []).map((step, idx) => {
                    const result = state?.stepResults?.[idx];
                    const isCurrent = idx === (state?.currentStepIndex ?? -1);
                    const isPassed = result?.status === 'passed';
                    const isFailed = result?.status === 'failed';
                    const isPending = result?.status === 'pending';

                    return (
                      <div
                        key={step.id}
                        data-step-index={idx}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs cursor-pointer hover:bg-muted/50 ${
                          isCurrent ? 'bg-blue-500/10 border border-blue-500/30' : ''
                        }`}
                        onClick={() => {
                          if (isPaused && idx > (state?.currentStepIndex ?? -1)) {
                            sendCmd({ type: 'run_to_step', stepIndex: idx });
                          }
                        }}
                      >
                        {/* Status icon */}
                        <div className="w-4 h-4 flex-shrink-0">
                          {isFailed ? (
                            <XCircle className="h-4 w-4 text-destructive" />
                          ) : isPassed ? (
                            <CheckCircle className="h-4 w-4 text-green-500" />
                          ) : isCurrent && (state?.status === 'stepping' || state?.status === 'running') ? (
                            <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                          ) : isCurrent ? (
                            <Play className="h-4 w-4 text-blue-500" />
                          ) : isPending ? (
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
                  <kbd className="px-1 py-0.5 bg-muted rounded text-[9px]">Enter</kbd> Step
                  {' '}<kbd className="px-1 py-0.5 bg-muted rounded text-[9px]">Shift+Enter</kbd> Back
                  {' '}<kbd className="px-1 py-0.5 bg-muted rounded text-[9px]">F5</kbd> Run all
                  {' '}<kbd className="px-1 py-0.5 bg-muted rounded text-[9px]">Space</kbd> Fast-forward
                  {' '}<kbd className="px-1 py-0.5 bg-muted rounded text-[9px]">Esc</kbd> Stop
                </p>
              </div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
    </div>
  );
}

// -------- Code Display Component --------

interface CodeDisplayProps {
  code: string;
  steps: DebugState['steps'];
  currentStepIndex: number;
  stepResults: DebugState['stepResults'];
  onClickStep: (idx: number) => void;
}

function CodeDisplay({ code, steps, currentStepIndex, stepResults, onClickStep }: CodeDisplayProps) {
  const lines = code.split('\n');

  // Build line → step mapping
  const lineStepMap = new Map<number, { stepIdx: number; isStart: boolean }>();
  steps.forEach((step, idx) => {
    for (let line = step.lineStart; line <= step.lineEnd; line++) {
      lineStepMap.set(line, { stepIdx: idx, isStart: line === step.lineStart });
    }
  });

  // Find the line offset — test body starts after the function signature
  // Steps use 1-based line numbers relative to the function body
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
            className={`flex ${bgColor} hover:bg-muted/30 cursor-pointer`}
            onClick={() => {
              if (stepIdx !== undefined) onClickStep(stepIdx);
            }}
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
