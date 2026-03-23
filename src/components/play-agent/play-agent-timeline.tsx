'use client';

import { useState, useCallback, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Play, X, Check, Loader2, Pause, SkipForward, AlertCircle, RotateCcw, ChevronDown, ScrollText, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { PlayAgentStep } from './play-agent-step';
import { PlayAgentStepDetail } from './play-agent-step-detail';
import { usePlayAgent } from './use-play-agent';
import { cn } from '@/lib/utils';
import { rollbackAllAreaPlans } from '@/server/actions/areas';
import { toast } from 'sonner';
import type { AgentStepState, AgentStepId, PwAgentType } from '@/lib/db/schema';

interface PlayAgentTimelineProps {
  repositoryId?: string | null;
}

const USER_STEPS: Set<AgentStepId> = new Set(['settings_check', 'select_repo', 'env_setup', 'review']);
const AI_STEPS: Set<AgentStepId> = new Set(['scan_and_template', 'plan', 'review', 'generate', 'run_tests', 'fix_tests', 'rerun_tests', 'summary']);

const DEFAULT_STEPS: AgentStepState[] = [
  { id: 'settings_check', status: 'pending', label: 'Settings', description: 'Verify configuration' },
  { id: 'select_repo', status: 'pending', label: 'Repo', description: 'Ensure repo selected' },
  { id: 'env_setup', status: 'pending', label: 'Env Setup', description: 'URL & login setup' },
  { id: 'scan_and_template', status: 'pending', label: 'Scan', description: 'Scan routes & template' },
  { id: 'plan', status: 'pending', label: 'Plan', description: 'Discover test areas' },
  { id: 'review', status: 'pending', label: 'Review', description: 'Approve test plan' },
  { id: 'generate', status: 'pending', label: 'Generate', description: 'Create tests' },
  { id: 'run_tests', status: 'pending', label: 'Run', description: 'Run build' },
  { id: 'fix_tests', status: 'pending', label: 'Fix', description: 'AI-fix tests' },
  { id: 'rerun_tests', status: 'pending', label: 'Re-run', description: 'Re-run build' },
  { id: 'summary', status: 'pending', label: 'Done', description: 'Results' },
];

const AI_PROVIDER_LABELS: Record<string, string> = {
  'claude-cli': 'Claude CLI',
  'openrouter': 'OpenRouter',
  'claude-agent-sdk': 'Claude SDK',
  'anthropic-direct': 'Anthropic Direct',
};

const AGENT_LABELS: Record<string, string> = {
  orchestrator: 'Orchestrator',
  planner: 'Planner',
  scout: 'Scout',
  diver: 'Diver',
  generator: 'Generator',
  healer: 'Healer',
};

const ROSTER_BADGE_STYLES: Record<PwAgentType, { bg: string; text: string }> = {
  orchestrator: { bg: 'bg-violet-500/15', text: 'text-violet-600 dark:text-violet-400' },
  planner: { bg: 'bg-blue-500/15', text: 'text-blue-600 dark:text-blue-400' },
  scout: { bg: 'bg-cyan-500/15', text: 'text-cyan-600 dark:text-cyan-400' },
  diver: { bg: 'bg-indigo-500/15', text: 'text-indigo-600 dark:text-indigo-400' },
  generator: { bg: 'bg-emerald-500/15', text: 'text-emerald-600 dark:text-emerald-400' },
  healer: { bg: 'bg-amber-500/15', text: 'text-amber-600 dark:text-amber-400' },
};

// ============================================
// Annotations
// ============================================

interface Annotation {
  label: string;
  ok: boolean;
}

function getAnnotations(step: AgentStepState): Annotation[] | null {
  if (step.status !== 'completed' && step.status !== 'skipped') return null;
  const r = step.result;
  if (!r) return null;

  switch (step.id) {
    case 'settings_check':
      return [
        { label: `GH: ${r.ghAccount}`, ok: true },
        { label: AI_PROVIDER_LABELS[r.aiProvider as string] ?? (r.aiProvider as string), ok: true },
      ];
    case 'select_repo':
      return [
        { label: r.repoFullName as string, ok: true },
        { label: r.branch as string, ok: true },
      ];
    case 'scan_and_template':
      return [
        { label: `${r.routesFound} routes`, ok: true },
        ...(r.framework ? [{ label: r.framework as string, ok: true }] : []),
        { label: `Template: ${r.templateApplied}`, ok: true },
      ];
    case 'plan':
      if (r.cached) return [{ label: 'Using cached tests', ok: true }];
      return [
        ...(r.areasFound ? [{ label: `${r.areasFound} areas`, ok: true }] : []),
        ...(r.sourcesUsed ? [{ label: `${r.sourcesUsed} sources`, ok: true }] : []),
      ];
    case 'review':
      if (r.skipped) return [{ label: r.reason as string, ok: true }];
      if (r.autoApproved) return [{ label: 'Auto-approved', ok: true }];
      return [{ label: 'Approved', ok: true }];
    case 'generate':
      return [
        { label: `${r.testsCreated} tests`, ok: true },
      ];
    case 'env_setup':
      return [
        { label: r.url as string, ok: true },
        ...(r.responseTime ? [{ label: `${r.responseTime}ms`, ok: true }] : []),
        ...(r.loginRequired === false ? [{ label: 'No login', ok: true }] : []),
        ...(r.loginSetup ? [{ label: 'Login setup', ok: true }] : []),
      ];
    case 'run_tests':
      return [
        { label: `${r.passedCount} passed`, ok: (r.passedCount as number) > 0 },
        ...((r.failedCount as number) > 0 ? [{ label: `${r.failedCount} failed`, ok: false }] : []),
      ];
    case 'fix_tests':
      if (r.skipped) return [{ label: r.reason as string, ok: true }];
      return [
        ...((r.fixedCount as number) > 0 ? [{ label: `${r.fixedCount} fixed`, ok: true }] : []),
        ...((r.unfixableCount as number) > 0 ? [{ label: `${r.unfixableCount} unfixable`, ok: false }] : []),
        ...((r.fixedCount as number) === 0 && (r.unfixableCount as number) === 0 ? [{ label: 'No fixes needed', ok: true }] : []),
      ];
    case 'rerun_tests':
      return [
        { label: `${r.passedCount} passed`, ok: (r.passedCount as number) > 0 },
        ...((r.failedCount as number) > 0 ? [{ label: `${r.failedCount} failed`, ok: false }] : []),
      ];
    default:
      return null;
  }
}

// ============================================
// Step style helpers
// ============================================

function getStepClasses(step: AgentStepState) {
  const isUser = USER_STEPS.has(step.id);
  const isWaiting = step.status === 'waiting_user';

  const dotClass = cn(
    'h-5 w-5 rounded-full flex items-center justify-center text-[9px] font-semibold transition-all border-2 shrink-0',
    step.status === 'completed' && 'bg-green-500 border-green-500 text-white',
    step.status === 'active' && !isUser && 'bg-blue-500 border-blue-500 text-white',
    step.status === 'active' && isUser && 'bg-amber-500 border-amber-500 text-white',
    isWaiting && 'bg-amber-100 border-amber-400 text-amber-700 dark:bg-amber-900/50 dark:border-amber-400 dark:text-amber-300 ring-2 ring-amber-400/50 ring-offset-1 ring-offset-background',
    step.status === 'failed' && 'bg-red-500 border-red-500 text-white',
    step.status === 'skipped' && 'bg-muted border-muted-foreground/20 text-muted-foreground',
    step.status === 'pending' && isUser && 'bg-background border-amber-300/50 text-amber-500/60 dark:border-amber-500/30 dark:text-amber-400/40',
    step.status === 'pending' && !isUser && 'bg-background border-blue-300/50 text-blue-500/60 dark:border-blue-400/30 dark:text-blue-400/40',
  );

  const labelClass = cn(
    'text-[10px] leading-tight font-medium whitespace-nowrap transition-colors',
    step.status === 'completed' && 'text-green-600 dark:text-green-400',
    step.status === 'active' && !isUser && 'text-blue-600 dark:text-blue-400 font-semibold',
    step.status === 'active' && isUser && 'text-amber-600 dark:text-amber-400 font-semibold',
    isWaiting && 'text-amber-600 dark:text-amber-400 font-semibold',
    step.status === 'failed' && 'text-red-600 dark:text-red-400 font-semibold',
    step.status === 'skipped' && 'text-muted-foreground/60',
    step.status === 'pending' && isUser && 'text-amber-400/70 dark:text-amber-500/50',
    step.status === 'pending' && !isUser && 'text-blue-400/70 dark:text-blue-500/50',
  );

  return { isUser, isWaiting, dotClass, labelClass };
}

function getDotIcon(step: AgentStepState) {
  const isWaiting = step.status === 'waiting_user';
  return step.status === 'completed' ? <Check className="h-2.5 w-2.5" /> :
    step.status === 'active' ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> :
    isWaiting ? <Pause className="h-2.5 w-2.5" /> :
    step.status === 'failed' ? <AlertCircle className="h-2.5 w-2.5" /> :
    step.status === 'skipped' ? <SkipForward className="h-2 w-2" /> :
    null;
}

// ============================================
// Main timeline
// ============================================

export function PlayAgentTimeline({ repositoryId }: PlayAgentTimelineProps) {
  const { session, loading, isActive, isTerminal, progress, start, resume, cancel, dismiss, approvePlan, rerunPlanner, skipSettings } =
    usePlayAgent(repositoryId);

  const [expandedStepId, setExpandedStepId] = useState<AgentStepId | null>(null);
  const [showRepoPrompt, setShowRepoPrompt] = useState(false);

  const steps = session?.steps ?? DEFAULT_STEPS;
  const isRunning = isActive && session?.status === 'active';
  const isPaused = session?.status === 'paused';
  const manualMode = session?.metadata?.manualMode === true;

  // Extract agent roster from completed settings_check step
  const settingsStep = steps.find(s => s.id === 'settings_check');
  const settingsResult = settingsStep?.status === 'completed' ? settingsStep.result : null;
  const activeAgents = (settingsResult?.activeAgents as string[] | undefined) ?? [];
  const pwAgentEnabled = activeAgents.length > 0;

  const activeStep = session?.steps.find(
    (s) => s.status === 'active' || s.status === 'waiting_user' || s.status === 'failed',
  );

  // Determine which agent is currently running and parallel counts
  const runningAgents = new Set<string>();
  const doneAgents = new Set<string>();
  const agentParallelCount: Record<string, number> = {};
  // Scan all steps for running/done agents (reruns update completed step substeps)
  for (const s of steps) {
    if (!s.substeps) continue;
    for (const sub of s.substeps) {
      if (sub.agent && sub.status === 'running') {
        runningAgents.add(sub.agent);
        const countMatch = sub.detail?.match(/^(\d+)\s+\w+\s+in parallel$/);
        if (countMatch) agentParallelCount[sub.agent] = parseInt(countMatch[1], 10);
      }
      if (sub.agent && (sub.status === 'done' || s.status === 'completed')) {
        doneAgents.add(sub.agent);
      }
    }
  }

  const pingRepoSelector = useCallback(() => {
    const trigger = document.querySelector('[data-slot="select-trigger"]') as HTMLElement | null;
    if (!trigger) return;
    trigger.classList.add('ring-2', 'ring-amber-400', 'ring-offset-2', 'ring-offset-background', 'animate-pulse');
    setTimeout(() => {
      trigger.classList.remove('ring-2', 'ring-amber-400', 'ring-offset-2', 'ring-offset-background', 'animate-pulse');
    }, 3000);
  }, []);

  // Auto-start when repo becomes available after user was prompted
  const [prevRepoId, setPrevRepoId] = useState(repositoryId);
  if (repositoryId !== prevRepoId) {
    setPrevRepoId(repositoryId);
    if (!prevRepoId && repositoryId && showRepoPrompt && !session) {
      setShowRepoPrompt(false);
      // Defer start to avoid cascading render
      queueMicrotask(() => start());
    }
  }

  const handlePlayPause = () => {
    if (!repositoryId && !session) {
      setShowRepoPrompt(true);
      pingRepoSelector();
      return;
    }
    setShowRepoPrompt(false);
    if (isRunning) {
      cancel();
    } else if (isPaused || session?.status === 'failed') {
      resume();
    } else {
      start();
    }
  };

  const handleStepClick = (stepId: AgentStepId) => {
    const step = steps.find(s => s.id === stepId);
    if (!step || step.status === 'pending') return;
    if (step.richResult || step.status === 'completed') {
      setExpandedStepId(prev => prev === stepId ? null : stepId);
    }
  };

  return (
    <Card className={cn(
      (activeStep?.status === 'waiting_user' || showRepoPrompt) && 'border-amber-400/50 dark:border-amber-500/30',
    )}>
      <CardContent className="py-4 px-4">
        {/* Title row */}
        <div className="flex items-center justify-between mb-3">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            Onboarding
          </span>
          <div className="flex items-center gap-1">
            {isActive && (
              <span className="text-[11px] text-muted-foreground tabular-nums">{progress}%</span>
            )}
            {session && (
              <Button size="icon" variant="ghost" className="h-5 w-5 shrink-0" onClick={dismiss} title="Restart">
                <RotateCcw className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>

        {/* Agent roster bar */}
        {settingsResult && (
          <div className="flex items-center gap-1.5 mb-2.5">
            <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wider font-medium mr-1">
              {pwAgentEnabled ? 'Agents' : 'Mode'}
            </span>
            {pwAgentEnabled ? (
              (['orchestrator', ...activeAgents] as PwAgentType[]).map(agent => {
                const isRunning = runningAgents.has(agent);
                const isDone = doneAgents.has(agent);
                const isActiveAgent = isRunning || isDone;
                const style = ROSTER_BADGE_STYLES[agent];
                const count = agentParallelCount[agent];
                return (
                  <span
                    key={agent}
                    className={cn(
                      'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors',
                      isActiveAgent ? [style.bg, style.text] : 'bg-muted/60 text-muted-foreground/50',
                    )}
                  >
                    {isRunning && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
                    {isDone && !isRunning && <Check className="h-2.5 w-2.5" />}
                    {AGENT_LABELS[agent] ?? agent.charAt(0).toUpperCase() + agent.slice(1)}
                    {isRunning && count && count > 1 && (
                      <span className="text-[9px] opacity-75">x{count}</span>
                    )}
                  </span>
                );
              })
            ) : (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground">
                Prompt
              </span>
            )}
          </div>
        )}

        {/* Play/Pause button + grid timeline */}
        <div className="flex items-start gap-3">
          <div className="relative shrink-0 mt-3">
            {!session && !loading && (
              <span className="absolute inset-0 rounded-full bg-primary/30 animate-ping" />
            )}
            <button
              onClick={handlePlayPause}
              disabled={loading || session?.status === 'completed'}
              className={cn(
                'relative h-8 w-8 rounded-full flex items-center justify-center transition-all',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                !session && 'bg-primary text-primary-foreground hover:bg-primary/90',
                isRunning && 'bg-amber-500 text-white hover:bg-amber-600',
                isPaused && 'bg-primary text-primary-foreground hover:bg-primary/90',
                session?.status === 'failed' && 'bg-primary text-primary-foreground hover:bg-primary/90',
                session?.status === 'completed' && 'bg-green-500 text-white',
                session?.status === 'cancelled' && 'bg-muted text-muted-foreground',
                loading && 'opacity-50 cursor-not-allowed',
              )}
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : isRunning ? (
                <Pause className="h-3.5 w-3.5 fill-current" />
              ) : session?.status === 'completed' ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <Play className="h-3.5 w-3.5 ml-0.5 fill-current" />
              )}
            </button>
          </div>

          {/* Grid: 4 rows x N columns */}
          <div
            className="flex-1 min-w-0 grid gap-y-0.5"
            style={{ gridTemplateColumns: `repeat(${steps.length}, 1fr)` }}
          >
            {/* Row 1: Top labels (automated steps above) */}
            {steps.map((step) => {
              const { isUser, labelClass } = getStepClasses(step);
              const dimmed = manualMode && AI_STEPS.has(step.id);
              return (
                <div key={`top-${step.id}`} className={cn('flex justify-center min-w-0', dimmed && 'opacity-25')}>
                  {!isUser ? (
                    <span className={cn(labelClass, 'truncate', dimmed && 'line-through')}>{step.label}</span>
                  ) : (
                    <span className="text-[10px] leading-tight invisible">.</span>
                  )}
                </div>
              );
            })}

            {/* Row 2: Dots + connector lines */}
            {steps.map((step, i) => {
              const { dotClass } = getStepClasses(step);
              const icon = getDotIcon(step);
              const prevCompleted = i > 0 && steps[i - 1].status === 'completed';
              const currCompleted = step.status === 'completed';
              const hasDetail = step.richResult || (step.status === 'completed' && step.result);
              const dimmed = manualMode && AI_STEPS.has(step.id);
              return (
                <div key={`dot-${step.id}`} className={cn('relative flex items-center justify-center py-0.5', dimmed && 'opacity-25')}>
                  {i > 0 && (
                    <div
                      className={cn(
                        'absolute top-1/2 -translate-y-1/2 h-0.5 rounded-full',
                        prevCompleted ? 'bg-green-500' : 'bg-muted-foreground/15',
                      )}
                      style={{ left: 0, right: 'calc(50% + 12px)' }}
                    />
                  )}
                  <button
                    onClick={() => handleStepClick(step.id)}
                    className={cn(
                      dotClass, 'relative z-10',
                      hasDetail && 'cursor-pointer hover:ring-2 hover:ring-primary/30',
                      showRepoPrompt && step.id === 'select_repo' && 'ring-2 ring-amber-400 ring-offset-1 ring-offset-background animate-pulse',
                    )}
                    disabled={!hasDetail}
                  >
                    {icon}
                  </button>
                  {i < steps.length - 1 && (
                    <div
                      className={cn(
                        'absolute top-1/2 -translate-y-1/2 h-0.5 rounded-full',
                        currCompleted ? 'bg-green-500' : 'bg-muted-foreground/15',
                      )}
                      style={{ left: 'calc(50% + 12px)', right: 0 }}
                    />
                  )}
                  {/* Expand indicator */}
                  {hasDetail && expandedStepId === step.id && (
                    <ChevronDown className="absolute -bottom-1.5 h-2 w-2 text-muted-foreground" />
                  )}
                </div>
              );
            })}

            {/* Row 3: Bottom labels (user steps below) */}
            {steps.map((step) => {
              const { isUser, labelClass } = getStepClasses(step);
              const dimmed = manualMode && AI_STEPS.has(step.id);
              return (
                <div key={`bot-${step.id}`} className={cn('flex justify-center min-w-0', dimmed && 'opacity-25')}>
                  {isUser ? (
                    <span className={cn(labelClass, 'truncate', dimmed && 'line-through')}>{step.label}</span>
                  ) : (
                    <span className="text-[10px] leading-tight invisible">.</span>
                  )}
                </div>
              );
            })}

            {/* Row 4: Annotations */}
            {steps.map((step) => {
              const annotations = getAnnotations(step);
              return (
                <div key={`ann-${step.id}`} className="flex flex-col items-center min-w-0">
                  {annotations && annotations.length > 0 && (
                    <div className="mt-1 space-y-px">
                      {annotations.map((a, i) => (
                        <div key={i} className="flex items-center gap-0.5 justify-center">
                          {a.ok ? (
                            <Check className="h-2 w-2 text-green-500 shrink-0" />
                          ) : (
                            <X className="h-2 w-2 text-red-500 shrink-0" />
                          )}
                          <span className="text-[9px] text-muted-foreground truncate max-w-[72px]">{a.label}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Manual mode label */}
        {manualMode && (
          <div className="flex justify-center mt-1">
            <span className="text-[9px] text-muted-foreground/50 italic">
              AI steps require GitHub + AI provider
            </span>
          </div>
        )}

        {/* Expanded step detail panel */}
        {expandedStepId && (() => {
          const step = steps.find(s => s.id === expandedStepId);
          if (!step) return null;
          return (
            <div className="mt-3 pt-3 border-t">
              <PlayAgentStepDetail
                step={step}
                sessionId={session?.id}
                onApprovePlan={step.id === 'review' ? approvePlan : undefined}
                onRerunPlanner={(step.id === 'plan' || step.id === 'review') ? rerunPlanner : undefined}
              />
            </div>
          );
        })()}

        {/* No-repo prompt — guide new users through setup */}
        {showRepoPrompt && !session && (
          <div className="mt-3 pt-3 border-t space-y-2">
            <div className="flex items-center gap-2.5">
              <div className="h-5 w-5 rounded-full bg-amber-500 flex items-center justify-center shrink-0">
                <AlertCircle className="h-3 w-3 text-white" />
              </div>
              <span className="text-sm font-medium text-amber-600 dark:text-amber-400">
                Get started
              </span>
            </div>
            <div className="ml-7 space-y-1.5">
              <div className="flex items-center gap-2 text-xs">
                <X className="h-3 w-3 text-red-500 shrink-0" />
                <span className="text-muted-foreground">Select a repository from the sidebar</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="h-3 w-3 flex items-center justify-center text-muted-foreground/50 shrink-0">—</span>
                <Link href="/settings?highlight=github" className="text-muted-foreground hover:text-foreground transition-colors">
                  Connect GitHub account
                </Link>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="h-3 w-3 flex items-center justify-center text-muted-foreground/50 shrink-0">—</span>
                <Link href="/settings?highlight=ai-settings" className="text-muted-foreground hover:text-foreground transition-colors">
                  Configure AI provider
                </Link>
              </div>
              <p className="text-[10px] text-muted-foreground/60 mt-1">
                Pick a repo to begin — settings will be checked automatically.
              </p>
            </div>
          </div>
        )}

        {/* Active / waiting / failed step detail */}
        {activeStep && expandedStepId !== activeStep.id && (
          <div className="mt-3 pt-3 border-t">
            <PlayAgentStep
              step={activeStep}
              stepNumber={steps.findIndex((s) => s.id === activeStep.id) + 1}
              onResume={activeStep.status === 'waiting_user' || activeStep.status === 'failed' ? resume : undefined}
              onSkip={activeStep.id === 'settings_check' && activeStep.status === 'waiting_user' ? skipSettings : undefined}
              onApprovePlan={activeStep.id === 'review' && activeStep.status === 'waiting_user' ? approvePlan : undefined}
            />
          </div>
        )}

        {/* Manual mode steps — appear after env_setup completes */}
        {manualMode && (() => {
          const envStep = steps.find(s => s.id === 'env_setup');
          const envDone = envStep?.status === 'completed';
          if (!envDone) return null;
          return (
            <div className="mt-3 pt-3 border-t space-y-2">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Manual Setup
              </span>
              <ManualStep
                number={1}
                label="Record a test"
                description="Open the recorder and interact with your app"
                href="/record"
                buttonLabel="Go to Recorder"
                delay={0}
              />
              <ManualStep
                number={2}
                label="Run your test"
                description="Execute the recorded test and view results"
                href="/run"
                buttonLabel="Go to Builds"
                delay={600}
              />
            </div>
          );
        })()}

        {/* Post-completion actions */}
        {session?.status === 'completed' && (
          <div className="mt-3 pt-3 border-t flex items-center justify-center gap-4">
            <Link
              href="/areas?tab=plan"
              className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
            >
              <ScrollText className="h-3.5 w-3.5" />
              View Testing Plan
            </Link>
            {repositoryId && (
              <RollbackAllButton repositoryId={repositoryId} />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ManualStep({ number, label, description, href, buttonLabel, delay }: {
  number: number;
  label: string;
  description: string;
  href: string;
  buttonLabel: string;
  delay: number;
}) {
  const [visible, setVisible] = useState(delay === 0);
  useEffect(() => {
    if (delay > 0) {
      const timer = setTimeout(() => setVisible(true), delay);
      return () => clearTimeout(timer);
    }
  }, [delay]);

  return (
    <div
      className={cn(
        'flex items-center gap-2.5 py-1.5 transition-all duration-500',
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2',
      )}
    >
      <div className="h-5 w-5 rounded-full border-2 border-primary/50 flex items-center justify-center shrink-0">
        <span className="text-[10px] font-semibold text-primary">{number}</span>
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium">{label}</span>
        <p className="text-[10px] text-muted-foreground">{description}</p>
      </div>
      <Link
        href={href}
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shrink-0"
      >
        {buttonLabel}
      </Link>
    </div>
  );
}

function RollbackAllButton({ repositoryId }: { repositoryId: string }) {
  const [rolling, setRolling] = useState(false);
  const [done, setDone] = useState(false);

  const handleRollback = async () => {
    if (!confirm('This will rollback all area plans from the latest agent run and delete generated tests. Continue?')) return;
    setRolling(true);
    try {
      const count = await rollbackAllAreaPlans(repositoryId);
      toast.success(`Rolled back ${count} area${count !== 1 ? 's' : ''}`);
      setDone(true);
    } catch {
      toast.error('Failed to rollback');
    } finally {
      setRolling(false);
    }
  };

  if (done) return null;

  return (
    <button
      onClick={handleRollback}
      disabled={rolling}
      className="inline-flex items-center gap-1.5 text-xs text-destructive hover:underline disabled:opacity-50"
    >
      {rolling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
      Rollback All
    </button>
  );
}
