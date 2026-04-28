'use client';

import { useMemo, useRef } from 'react';
import {
  CheckCircle2,
  Circle,
  Camera,
  MousePointerClick,
  Compass,
  Eye,
  Hourglass,
  Variable,
  MessageSquare,
  XCircle,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DebugStep } from '@/lib/playwright/debug-parser';

export type StepResultsMap = Record<number, {
  status: 'passed' | 'failed';
  durationMs?: number;
  error?: string;
}>;

interface PlaybackTimelineProps {
  steps: DebugStep[];
  currentStepIndex: number;
  results: StepResultsMap;
  isRunning: boolean;
  className?: string;
  /** Render compact, narrower variant for fullscreen overlay. */
  compact?: boolean;
}

const ITEM_HEIGHT = 64; // px — used to compute the wheel translate

const STEP_TYPE_ICONS: Record<DebugStep['type'], React.ComponentType<{ className?: string }>> = {
  action: MousePointerClick,
  navigation: Compass,
  assertion: Eye,
  screenshot: Camera,
  wait: Hourglass,
  variable: Variable,
  log: MessageSquare,
  other: Circle,
};

export function PlaybackTimeline({
  steps,
  currentStepIndex,
  results,
  isRunning,
  className,
  compact = false,
}: PlaybackTimelineProps) {
  const stripRef = useRef<HTMLDivElement>(null);
  const total = steps.length;

  // Center the active row in the viewport. -1 (no step started yet) means
  // the first upcoming step sits in the center.
  const centerIdx = currentStepIndex < 0 ? 0 : currentStepIndex;

  const translateY = useMemo(() => {
    // viewport center is at half its height; offset so the active row sits there.
    return -(centerIdx * ITEM_HEIGHT);
  }, [centerIdx]);

  // Auto-scroll wheel transform is driven by translateY; nothing else to do.

  if (total === 0) return null;

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl border border-border shadow-sm',
        'bg-card',
        'flex flex-col',
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2 border-b border-border bg-card">
        <div className="flex items-center gap-2">
          {isRunning ? (
            <>
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-60 animate-ping" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
              </span>
              <span className="text-xs font-medium tracking-wide uppercase text-foreground/80">
                Live
              </span>
            </>
          ) : (
            <>
              <span className="h-2 w-2 rounded-full bg-muted-foreground/50" />
              <span className="text-xs font-medium tracking-wide uppercase text-muted-foreground">
                Idle
              </span>
            </>
          )}
        </div>
        <div className="text-xs tabular-nums text-muted-foreground">
          {Math.max(0, currentStepIndex + 1)} / {total}
        </div>
      </div>

      {/* Wheel viewport */}
      <div
        className="relative flex-1 overflow-hidden"
        style={{ minHeight: ITEM_HEIGHT * 5 }}
      >
        <div
          ref={stripRef}
          className="absolute inset-x-0 transition-transform duration-500 ease-out will-change-transform"
          style={{
            top: '50%',
            transform: `translateY(calc(-50% + ${translateY}px))`,
          }}
        >
          {steps.map((step, idx) => (
            <StepRow
              key={step.id ?? idx}
              step={step}
              index={idx}
              currentStepIndex={currentStepIndex}
              result={results[idx]}
              compact={compact}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

interface StepRowProps {
  step: DebugStep;
  index: number;
  currentStepIndex: number;
  result?: StepResultsMap[number];
  compact: boolean;
}

function StepRow({ step, index, currentStepIndex, result, compact }: StepRowProps) {
  const isCurrent = index === currentStepIndex;
  const isCompleted = result !== undefined;
  const isUpcoming = !isCurrent && !isCompleted;
  const isFailed = result?.status === 'failed';

  const Icon = STEP_TYPE_ICONS[step.type] ?? Circle;

  return (
    <div
      data-state={isCurrent ? 'current' : isCompleted ? 'done' : 'upcoming'}
      style={{ height: ITEM_HEIGHT }}
      className={cn(
        'flex items-center gap-3 px-4 transition-all duration-300',
        compact && 'gap-2 px-3',
      )}
    >
      {/* Status badge / icon column */}
      <div
        className={cn(
          'relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors',
          isFailed
            ? 'border-destructive/60 bg-destructive/10 text-destructive'
            : isCurrent
              ? 'border-primary bg-primary/10 text-primary playback-step-active'
              : isCompleted
                ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : 'border-border/60 bg-background/60 text-muted-foreground',
          compact && 'h-7 w-7',
        )}
      >
        {isFailed ? (
          <XCircle className={cn('h-4 w-4', compact && 'h-3.5 w-3.5')} />
        ) : isCurrent ? (
          <Loader2 className={cn('h-4 w-4 animate-spin', compact && 'h-3.5 w-3.5')} />
        ) : isCompleted ? (
          <CheckCircle2 className={cn('h-4 w-4', compact && 'h-3.5 w-3.5')} />
        ) : (
          <Icon className={cn('h-4 w-4', compact && 'h-3.5 w-3.5')} />
        )}
      </div>

      {/* Step text column */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              'text-[10px] font-mono tabular-nums uppercase tracking-wider',
              isCurrent ? 'text-primary' : 'text-muted-foreground/70',
            )}
          >
            {String(index + 1).padStart(2, '0')}
          </span>
          <span
            className={cn(
              'text-[10px] uppercase tracking-wider',
              isCurrent ? 'text-primary/80' : 'text-muted-foreground/60',
            )}
          >
            {step.type}
          </span>
        </div>
        <div
          className={cn(
            'truncate text-sm',
            isCurrent ? 'font-semibold text-foreground' : 'text-foreground/80',
            isUpcoming && 'text-foreground/70',
            compact && 'text-xs',
          )}
          title={step.label}
        >
          {step.label}
        </div>
        {isFailed && result?.error && (
          <div className="truncate text-[10px] text-destructive/80" title={result.error}>
            {result.error}
          </div>
        )}
      </div>

      {/* Duration column */}
      {result?.durationMs !== undefined && (
        <div
          className={cn(
            'text-[10px] tabular-nums text-muted-foreground',
            compact && 'hidden',
          )}
        >
          {formatDuration(result.durationMs)}
        </div>
      )}
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}
