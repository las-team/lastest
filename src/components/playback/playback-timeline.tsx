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
import { extractSelectorArray, type DebugStep } from '@/lib/playwright/debug-parser';
import { hashSelectors, sortSelectorsByStats, type SelectorStatRow } from '@lastest/shared/selector-stats';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card';

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
  /** All `selector_stats` rows for the test backing this timeline. When
   *  present, action steps with a parseable `locateWithFallback` array
   *  show a hover panel with per-candidate success/fail history. */
  selectorStats?: SelectorStatRow[];
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
  selectorStats,
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
              selectorStats={selectorStats}
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
  selectorStats?: SelectorStatRow[];
}

function StepRow({ step, index, currentStepIndex, result, compact, selectorStats }: StepRowProps) {
  const isCurrent = index === currentStepIndex;
  const isCompleted = result !== undefined;
  const isUpcoming = !isCurrent && !isCompleted;
  const isFailed = result?.status === 'failed';

  const Icon = STEP_TYPE_ICONS[step.type] ?? Circle;

  // Parse the locateWithFallback selectors out of the step's source so the
  // hover panel can show per-candidate stats. null when the step isn't a
  // locate call or the array is built dynamically (regex / JSON.parse fail).
  const selectorInfo = useMemo(() => {
    if (step.type !== 'action') return null;
    const parsed = extractSelectorArray(step.code);
    if (!parsed) return null;
    const hash = hashSelectors(parsed.selectors);
    const rows = (selectorStats ?? []).filter((r) => r.hash === hash);
    const ordered = sortSelectorsByStats(parsed.selectors, rows);
    const byKey = new Map<string, SelectorStatRow>();
    for (const r of rows) byKey.set(`${r.type}::${r.value}`, r);
    return { hash, action: parsed.action, ordered, byKey };
  }, [step.type, step.code, selectorStats]);

  const row = (
    <div
      data-state={isCurrent ? 'current' : isCompleted ? 'done' : 'upcoming'}
      style={{ height: ITEM_HEIGHT }}
      className={cn(
        'relative flex items-center gap-3 px-4 transition-all duration-300',
        // Active step — strong, lively highlight so the eye lands here first.
        // Gradient fill, accent bar on the left, soft drop-shadow lift, and
        // an inset/outset ring pulse driven by `step-active-row-pulse`.
        isCurrent && [
          'rounded-md',
          'bg-gradient-to-r from-primary/25 via-primary/15 to-primary/5',
          'shadow-md shadow-primary/20',
          'before:absolute before:inset-y-1 before:left-0 before:w-1 before:rounded-r-full before:bg-primary',
          'playback-step-row-active',
        ],
        compact && 'gap-2 px-3',
        selectorInfo && 'cursor-help',
      )}
    >
      {/* Status badge / icon column */}
      <div
        className={cn(
          'relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors',
          isFailed
            ? 'border-destructive/60 bg-destructive/10 text-destructive'
            : isCurrent
              ? 'border-primary bg-primary text-primary-foreground shadow-sm shadow-primary/30 playback-step-active'
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
          {selectorInfo && (
            <span className="text-[10px] tabular-nums text-muted-foreground/60">
              · {selectorInfo.ordered.length}
            </span>
          )}
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

      {/* Now badge — only on the active row. Tabular-nums + uppercase keeps
          it in the same visual family as the other meta tags. */}
      {isCurrent && (
        <span
          className={cn(
            'shrink-0 rounded-full bg-primary px-1.5 py-0.5',
            'text-[9px] font-semibold uppercase tracking-wider text-primary-foreground',
            'shadow-sm',
            compact && 'px-1 text-[8px]',
          )}
        >
          Now
        </span>
      )}
    </div>
  );

  if (!selectorInfo) return row;

  return (
    <HoverCard openDelay={200} closeDelay={80}>
      <HoverCardTrigger asChild>{row}</HoverCardTrigger>
      <HoverCardContent side="left" align="center" className="w-96 p-3">
        <SelectorStatsPanel
          action={selectorInfo.action}
          hash={selectorInfo.hash}
          ordered={selectorInfo.ordered}
          byKey={selectorInfo.byKey}
        />
      </HoverCardContent>
    </HoverCard>
  );
}

interface SelectorStatsPanelProps {
  action: string;
  hash: string;
  ordered: { type: string; value: string }[];
  byKey: Map<string, SelectorStatRow>;
}

function SelectorStatsPanel({ action, hash, ordered, byKey }: SelectorStatsPanelProps) {
  const totalRows = Array.from(byKey.values()).reduce((s, r) => s + r.totalAttempts, 0);
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-foreground">
          Selector fallback {action}
        </div>
        <code className="text-[10px] font-mono text-muted-foreground" title="Stable hash of the selectors array">
          {hash}
        </code>
      </div>
      <div className="rounded border border-border/60 overflow-hidden">
        <table className="w-full text-[11px] tabular-nums">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th className="text-left px-2 py-1 font-medium">type</th>
              <th className="text-left px-2 py-1 font-medium">selector</th>
              <th className="text-right px-2 py-1 font-medium" title="successCount / totalAttempts">hits</th>
              <th className="text-right px-2 py-1 font-medium">rate</th>
              <th className="text-right px-2 py-1 font-medium" title="avg ms when matched">avg</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((sel, i) => {
              const r = byKey.get(`${sel.type}::${sel.value}`);
              const rate = r && r.totalAttempts > 0 ? Math.round((r.successCount / r.totalAttempts) * 100) : null;
              return (
                <tr key={i} className="border-t border-border/40">
                  <td className="px-2 py-1 text-muted-foreground/90 whitespace-nowrap">{sel.type}</td>
                  <td className="px-2 py-1 font-mono text-foreground/80 truncate max-w-[160px]" title={sel.value}>
                    {sel.value}
                  </td>
                  <td className="px-2 py-1 text-right text-muted-foreground/90">
                    {r ? `${r.successCount}/${r.totalAttempts}` : '—'}
                  </td>
                  <td
                    className={cn(
                      'px-2 py-1 text-right',
                      rate === null
                        ? 'text-muted-foreground/60'
                        : rate >= 80
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : rate <= 20
                            ? 'text-destructive'
                            : 'text-foreground/80',
                    )}
                  >
                    {rate === null ? '—' : `${rate}%`}
                  </td>
                  <td className="px-2 py-1 text-right text-muted-foreground/90">
                    {r?.avgResponseTimeMs != null ? `${r.avgResponseTimeMs}ms` : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="text-[10px] text-muted-foreground/80">
        {totalRows === 0
          ? 'No runs recorded yet — order shown is the captured order.'
          : 'Sorted by success rate · winners promoted on the next run.'}
      </div>
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}
