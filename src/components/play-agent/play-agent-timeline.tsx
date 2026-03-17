'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Play, X, Check, Loader2, Pause, SkipForward, AlertCircle, RotateCcw } from 'lucide-react';
import { PlayAgentStep } from './play-agent-step';
import { usePlayAgent } from './use-play-agent';
import { cn } from '@/lib/utils';
import type { AgentStepState, AgentStepId, PwAgentType } from '@/lib/db/schema';

interface PlayAgentTimelineProps {
  repositoryId?: string | null;
}

const USER_STEPS: Set<AgentStepId> = new Set(['settings_check', 'select_repo', 'env_setup']);

const DEFAULT_STEPS: AgentStepState[] = [
  { id: 'settings_check', status: 'pending', label: 'Settings', description: 'Verify configuration' },
  { id: 'select_repo', status: 'pending', label: 'Repo', description: 'Ensure repo selected' },
  { id: 'scan_and_template', status: 'pending', label: 'Scan', description: 'Scan routes & template' },
  { id: 'discover', status: 'pending', label: 'Discover', description: 'Generate tests' },
  { id: 'env_setup', status: 'pending', label: 'Env Setup', description: 'URL & login setup' },
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
  generator: 'Generator',
  healer: 'Healer',
};

const ROSTER_BADGE_STYLES: Record<PwAgentType, { bg: string; text: string }> = {
  orchestrator: { bg: 'bg-violet-500/15', text: 'text-violet-600 dark:text-violet-400' },
  planner: { bg: 'bg-blue-500/15', text: 'text-blue-600 dark:text-blue-400' },
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
    case 'settings_check': {
      const agents = (r.activeAgents as string[]) ?? [];
      return [
        { label: `GH: ${r.ghAccount}`, ok: true },
        { label: AI_PROVIDER_LABELS[r.aiProvider as string] ?? (r.aiProvider as string), ok: true },
        ...(agents.length > 0
          ? agents.map(a => ({ label: AGENT_LABELS[a] ?? a, ok: true }))
          : [{ label: 'Prompt mode', ok: true }]),
      ];
    }
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
    case 'discover':
      if (r.skipped) return [{ label: r.reason as string, ok: true }];
      return [
        ...(r.specsFound ? [{ label: `${r.specsFound} specs`, ok: true }] : []),
        ...(r.areasCreated ? [{ label: `${r.areasCreated} areas`, ok: true }] : []),
        { label: `${r.testsCreated} tests`, ok: true },
        ...((r.skippedRemaining as number) > 0 ? [{ label: `+${r.skippedRemaining} in bg`, ok: true }] : []),
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
  const { session, loading, isActive, isTerminal, progress, start, resume, cancel, dismiss, skipDiscover } =
    usePlayAgent(repositoryId);

  const steps = session?.steps ?? DEFAULT_STEPS;
  const isRunning = isActive && session?.status === 'active';
  const isPaused = session?.status === 'paused';

  // Extract agent roster from completed settings_check step
  const settingsStep = steps.find(s => s.id === 'settings_check');
  const settingsResult = settingsStep?.status === 'completed' ? settingsStep.result : null;
  const activeAgents = (settingsResult?.activeAgents as string[] | undefined) ?? [];
  const pwAgentEnabled = activeAgents.length > 0;

  const activeStep = session?.steps.find(
    (s) => s.status === 'active' || s.status === 'waiting_user' || s.status === 'failed',
  );

  const handlePlayPause = () => {
    if (isRunning) {
      cancel();
    } else if (isPaused || session?.status === 'failed') {
      resume();
    } else {
      start();
    }
  };

  return (
    <Card className={cn(
      activeStep?.status === 'waiting_user' && 'border-amber-400/50 dark:border-amber-500/30',
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
            {isTerminal && session?.status !== 'cancelled' && (
              <Button size="icon" variant="ghost" className="h-5 w-5 shrink-0" onClick={dismiss} title="Run again">
                <RotateCcw className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>

        {/* Agent roster bar — visible once settings_check completes */}
        {settingsResult && (
          <div className="flex items-center gap-1.5 mb-2.5">
            <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wider font-medium mr-1">
              {pwAgentEnabled ? 'Agents' : 'Mode'}
            </span>
            {pwAgentEnabled ? (
              (['orchestrator', ...activeAgents] as PwAgentType[]).map(agent => {
                const style = ROSTER_BADGE_STYLES[agent];
                return (
                  <span
                    key={agent}
                    className={cn(
                      'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium',
                      style.bg,
                      style.text,
                    )}
                  >
                    {AGENT_LABELS[agent] ?? agent.charAt(0).toUpperCase() + agent.slice(1)}
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
          <button
            onClick={handlePlayPause}
            disabled={loading || !repositoryId || session?.status === 'completed'}
            className={cn(
              'h-8 w-8 rounded-full flex items-center justify-center shrink-0 transition-all mt-3',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              !session && 'bg-primary text-primary-foreground hover:bg-primary/90',
              isRunning && 'bg-amber-500 text-white hover:bg-amber-600',
              isPaused && 'bg-primary text-primary-foreground hover:bg-primary/90',
              session?.status === 'failed' && 'bg-primary text-primary-foreground hover:bg-primary/90',
              session?.status === 'completed' && 'bg-green-500 text-white',
              session?.status === 'cancelled' && 'bg-muted text-muted-foreground',
              (loading || !repositoryId) && 'opacity-50 cursor-not-allowed',
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

          {/* Grid: 4 rows (top-labels, dots, bottom-labels, annotations) x N columns */}
          <div
            className="flex-1 min-w-0 grid gap-y-0.5"
            style={{ gridTemplateColumns: `repeat(${steps.length}, 1fr)` }}
          >
            {/* Row 1: Top labels (automated steps above, placeholder for user steps) */}
            {steps.map((step) => {
              const { isUser, labelClass } = getStepClasses(step);
              return (
                <div key={`top-${step.id}`} className="flex justify-center min-w-0">
                  {!isUser ? (
                    <span className={cn(labelClass, 'truncate')}>{step.label}</span>
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
              return (
                <div key={`dot-${step.id}`} className="relative flex items-center justify-center py-0.5">
                  {/* Left connector (from previous step) */}
                  {i > 0 && (
                    <div
                      className={cn(
                        'absolute top-1/2 -translate-y-1/2 h-0.5 rounded-full',
                        prevCompleted ? 'bg-green-500' : 'bg-muted-foreground/15',
                      )}
                      style={{ left: 0, right: 'calc(50% + 12px)' }}
                    />
                  )}
                  {/* Dot */}
                  <div className={cn(dotClass, 'relative z-10')}>{icon}</div>
                  {/* Right connector (to next step) */}
                  {i < steps.length - 1 && (
                    <div
                      className={cn(
                        'absolute top-1/2 -translate-y-1/2 h-0.5 rounded-full',
                        currCompleted ? 'bg-green-500' : 'bg-muted-foreground/15',
                      )}
                      style={{ left: 'calc(50% + 12px)', right: 0 }}
                    />
                  )}
                </div>
              );
            })}

            {/* Row 3: Bottom labels (user steps below, placeholder for automated) */}
            {steps.map((step) => {
              const { isUser, labelClass } = getStepClasses(step);
              return (
                <div key={`bot-${step.id}`} className="flex justify-center min-w-0">
                  {isUser ? (
                    <span className={cn(labelClass, 'truncate')}>{step.label}</span>
                  ) : (
                    <span className="text-[10px] leading-tight invisible">.</span>
                  )}
                </div>
              );
            })}

            {/* Row 4: Annotations (variable height — isolated from dot alignment) */}
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

        {/* Active / waiting / failed step detail */}
        {activeStep && (
          <div className="mt-3 pt-3 border-t">
            <PlayAgentStep
              step={activeStep}
              stepNumber={steps.findIndex((s) => s.id === activeStep.id) + 1}
              onResume={activeStep.status === 'waiting_user' || activeStep.status === 'failed' ? resume : undefined}
              onSkipDiscover={activeStep.id === 'discover' && activeStep.status === 'active' ? skipDiscover : undefined}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
