'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Play, Square, X, Check, Loader2, Pause, SkipForward, AlertCircle } from 'lucide-react';
import { PlayAgentStep } from './play-agent-step';
import { usePlayAgent } from './use-play-agent';
import { cn } from '@/lib/utils';
import type { AgentStepState, AgentStepId } from '@/lib/db/schema';

interface PlayAgentTimelineProps {
  repositoryId?: string | null;
}

// Steps that may require user action
const USER_STEPS: Set<AgentStepId> = new Set(['settings_check', 'select_repo', 'url_check']);

const DEFAULT_STEPS: AgentStepState[] = [
  { id: 'settings_check', status: 'pending', label: 'Settings', description: 'Verify configuration' },
  { id: 'select_repo', status: 'pending', label: 'Repo', description: 'Ensure repo selected' },
  { id: 'scan_and_template', status: 'pending', label: 'Scan', description: 'Scan routes & template' },
  { id: 'discover', status: 'pending', label: 'Discover', description: 'Generate tests' },
  { id: 'url_check', status: 'pending', label: 'URL', description: 'Verify server' },
  { id: 'run_tests', status: 'pending', label: 'Run', description: 'Run build' },
  { id: 'fix_tests', status: 'pending', label: 'Fix', description: 'AI-fix tests' },
  { id: 'rerun_tests', status: 'pending', label: 'Re-run', description: 'Re-run build' },
  { id: 'summary', status: 'pending', label: 'Done', description: 'Results' },
];

function StepNode({ step, isLast }: { step: AgentStepState; isLast: boolean }) {
  const isUser = USER_STEPS.has(step.id);
  const isWaiting = step.status === 'waiting_user';

  // Color logic for the dot
  const dotClass = cn(
    'h-5 w-5 rounded-full flex items-center justify-center text-[9px] font-semibold transition-all border-2 shrink-0',
    // Completed
    step.status === 'completed' && !isUser && 'bg-green-500 border-green-500 text-white',
    step.status === 'completed' && isUser && 'bg-green-500 border-green-500 text-white',
    // Active
    step.status === 'active' && !isUser && 'bg-blue-500 border-blue-500 text-white',
    step.status === 'active' && isUser && 'bg-amber-500 border-amber-500 text-white',
    // Waiting user
    isWaiting && 'bg-amber-100 border-amber-400 text-amber-700 dark:bg-amber-900/50 dark:border-amber-400 dark:text-amber-300 ring-2 ring-amber-400/50 ring-offset-1 ring-offset-background',
    // Failed
    step.status === 'failed' && 'bg-red-500 border-red-500 text-white',
    // Skipped
    step.status === 'skipped' && 'bg-muted border-muted-foreground/20 text-muted-foreground',
    // Pending
    step.status === 'pending' && isUser && 'bg-background border-amber-300/50 text-amber-500/60 dark:border-amber-500/30 dark:text-amber-400/40',
    step.status === 'pending' && !isUser && 'bg-background border-blue-300/50 text-blue-500/60 dark:border-blue-400/30 dark:text-blue-400/40',
  );

  // Label color
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

  // Connector color
  const lineClass = cn(
    'h-0.5 rounded-full transition-all',
    step.status === 'completed' ? 'bg-green-500' : 'bg-muted-foreground/15',
  );

  const dotIcon =
    step.status === 'completed' ? <Check className="h-2.5 w-2.5" /> :
    step.status === 'active' ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> :
    isWaiting ? <Pause className="h-2.5 w-2.5" /> :
    step.status === 'failed' ? <AlertCircle className="h-2.5 w-2.5" /> :
    step.status === 'skipped' ? <SkipForward className="h-2 w-2" /> :
    null;

  return (
    <div className="flex items-center flex-1 last:flex-none">
      <div className="flex flex-col items-center gap-0.5 relative">
        {/* Label above (automated) or placeholder */}
        {!isUser ? (
          <span className={labelClass}>{step.label}</span>
        ) : (
          <span className="text-[10px] leading-tight invisible">.</span>
        )}

        {/* Dot */}
        <div className={dotClass}>
          {dotIcon}
        </div>

        {/* Label below (user) or placeholder */}
        {isUser ? (
          <span className={labelClass}>{step.label}</span>
        ) : (
          <span className="text-[10px] leading-tight invisible">.</span>
        )}
      </div>

      {/* Connector */}
      {!isLast && (
        <div className="flex-1 mx-0.5 self-center">
          <div className={lineClass} />
        </div>
      )}
    </div>
  );
}

export function PlayAgentTimeline({ repositoryId }: PlayAgentTimelineProps) {
  const { session, loading, isActive, isTerminal, progress, start, resume, cancel, dismiss } =
    usePlayAgent(repositoryId);

  const steps = session?.steps ?? DEFAULT_STEPS;
  const isRunning = isActive && session?.status === 'active';
  const isPaused = session?.status === 'paused';

  // Find step needing attention
  const activeStep = session?.steps.find(
    (s) => s.status === 'active' || s.status === 'waiting_user' || s.status === 'failed',
  );

  const summaryStep = session?.steps.find((s) => s.id === 'summary');
  const summaryResult = summaryStep?.result;

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
        <div className="flex items-center gap-3">
          {/* Play / Stop button */}
          <button
            onClick={handlePlayPause}
            disabled={loading || !repositoryId || session?.status === 'completed'}
            className={cn(
              'h-8 w-8 rounded-full flex items-center justify-center shrink-0 transition-all',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              !session && 'bg-primary text-primary-foreground hover:bg-primary/90',
              isRunning && 'bg-red-500 text-white hover:bg-red-600',
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
              <Square className="h-3 w-3 fill-current" />
            ) : session?.status === 'completed' ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Play className="h-3.5 w-3.5 ml-0.5 fill-current" />
            )}
          </button>

          {/* Timeline */}
          <div className="flex items-center flex-1 min-w-0">
            {steps.map((step, i) => (
              <StepNode
                key={step.id}
                step={step}
                isLast={i === steps.length - 1}
              />
            ))}
          </div>

          {/* Dismiss for terminal states */}
          {isTerminal && session?.status !== 'cancelled' && (
            <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={dismiss} title="Dismiss">
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        {/* Active step detail area */}
        {activeStep && (
          <div className="mt-3 pt-3 border-t">
            <PlayAgentStep
              step={activeStep}
              stepNumber={steps.findIndex((s) => s.id === activeStep.id) + 1}
              onResume={activeStep.status === 'waiting_user' || activeStep.status === 'failed' ? resume : undefined}
            />
          </div>
        )}

        {/* Summary results */}
        {session?.status === 'completed' && summaryResult && (
          <div className="mt-3 pt-3 border-t">
            <div className="grid grid-cols-4 gap-3 text-xs">
              <div>
                <span className="text-muted-foreground block">Tests</span>
                <span className="font-semibold">{summaryResult.testsCreated as number}</span>
              </div>
              <div>
                <span className="text-muted-foreground block">Builds</span>
                <span className="font-semibold">{(summaryResult.buildIds as string[])?.length ?? 0}</span>
              </div>
              <div>
                <span className="text-muted-foreground block">Initial</span>
                <span className={cn(
                  'font-semibold',
                  (summaryResult.initialFailed as number) > 0 ? 'text-red-600' : 'text-green-600',
                )}>
                  {summaryResult.initialPassed as number}P / {summaryResult.initialFailed as number}F
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block">Final</span>
                <span className={cn(
                  'font-semibold',
                  (summaryResult.finalFailed as number) > 0 ? 'text-red-600' : 'text-green-600',
                )}>
                  {summaryResult.finalPassed as number}P / {summaryResult.finalFailed as number}F
                </span>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
