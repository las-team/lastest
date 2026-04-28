'use client';

import { FileCheck2, AlertTriangle, XCircle, Clock, RefreshCw, CheckCircle, Sparkles, Flag, GitBranch, Shield, Layers, Bug, ListTree } from 'lucide-react';
import type { FilterType } from '@/app/(app)/builds/[buildId]/build-detail-client';
import type { VisualDiffWithTestStatus } from '@/lib/db/schema';
import { cn } from '@/lib/utils';

type TileStatus = 'passed' | 'failed' | 'changed' | 'pending';

function deriveTestTileStatus(diffs: VisualDiffWithTestStatus[]): TileStatus {
  const hasFailed = diffs.some(
    (d) => d.testResultStatus === 'failed' || d.status === 'rejected' || !!d.errorMessage,
  );
  if (hasFailed) return 'failed';
  const hasChanged = diffs.some(
    (d) =>
      d.classification === 'changed' ||
      (d.status === 'pending' && (d.pixelDifference ?? 0) > 0),
  );
  if (hasChanged) return 'changed';
  const allResolved = diffs.every(
    (d) =>
      d.status === 'approved' ||
      d.status === 'auto_approved' ||
      d.classification === 'unchanged' ||
      (d.pixelDifference ?? 0) === 0,
  );
  if (allResolved && diffs.some((d) => d.testResultStatus === 'passed')) return 'passed';
  if (allResolved) return 'passed';
  return 'pending';
}

interface MetricsRowProps {
  totalTests: number;
  changesDetected: number;
  flakyCount: number;
  failedCount: number;
  errorsCount?: number;
  passedCount?: number;
  elapsedMs: number | null;
  activeFilter?: FilterType;
  onFilterChange?: (filter: FilterType) => void;
  isRunning?: boolean;
  completedTests?: number;
  aiSafeCount?: number;
  aiReviewCount?: number;
  aiFlagCount?: number;
  viewMode?: 'branch' | 'main';
  onViewModeChange?: (mode: 'branch' | 'main') => void;
  groupByArea?: boolean;
  onGroupByAreaChange?: (v: boolean) => void;
  groupByTest?: boolean;
  onGroupByTestChange?: (v: boolean) => void;
  diffs?: VisualDiffWithTestStatus[];
}

export function MetricsRow({
  totalTests,
  changesDetected,
  flakyCount,
  failedCount,
  errorsCount = 0,
  passedCount = 0,
  elapsedMs,
  activeFilter,
  onFilterChange,
  isRunning = false,
  completedTests = 0,
  aiSafeCount = 0,
  aiReviewCount = 0,
  aiFlagCount = 0,
  viewMode,
  onViewModeChange,
  groupByArea = false,
  onGroupByAreaChange,
  groupByTest = true,
  onGroupByTestChange,
  diffs,
}: MetricsRowProps) {
  const formatTime = (ms: number | null) => {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  const passRate = totalTests > 0 ? Math.round((passedCount / totalTests) * 100) : 0;

  const hasAIMetrics = aiSafeCount + aiReviewCount + aiFlagCount > 0;

  const metrics: {
    label: string;
    value: number | string;
    icon: typeof FileCheck2;
    color: string;
    bgColor: string;
    filterKey: FilterType | null;
    isTime?: boolean;
  }[] = [
    {
      label: 'Passed',
      value: passedCount,
      icon: CheckCircle,
      color: passedCount > 0 ? 'text-success' : 'text-muted-foreground/50',
      bgColor: passedCount > 0 ? 'bg-success/10' : 'bg-muted',
      filterKey: 'passed',
    },
    {
      label: 'Failed',
      value: failedCount,
      icon: XCircle,
      color: failedCount > 0 ? 'text-destructive' : 'text-muted-foreground/50',
      bgColor: failedCount > 0 ? 'bg-destructive/10' : 'bg-muted',
      filterKey: 'failed',
    },
    {
      label: 'Errors',
      value: errorsCount,
      icon: Bug,
      color: errorsCount > 0 ? 'text-destructive' : 'text-muted-foreground/50',
      bgColor: errorsCount > 0 ? 'bg-destructive/10' : 'bg-muted',
      filterKey: 'errors',
    },
    {
      label: 'Changed',
      value: changesDetected,
      icon: AlertTriangle,
      color: changesDetected > 0 ? 'text-warning' : 'text-muted-foreground/50',
      bgColor: changesDetected > 0 ? 'bg-warning/10' : 'bg-muted',
      filterKey: 'changed',
    },
    {
      label: 'Flaky',
      value: flakyCount,
      icon: RefreshCw,
      color: flakyCount > 0 ? 'text-warning' : 'text-muted-foreground/50',
      bgColor: flakyCount > 0 ? 'bg-warning/10' : 'bg-muted',
      filterKey: 'flaky',
    },
    {
      label: 'Time',
      value: formatTime(elapsedMs),
      icon: Clock,
      color: 'text-muted-foreground',
      bgColor: 'bg-muted',
      filterKey: null,
      isTime: true,
    },
  ];

  const aiMetrics: {
    label: string;
    value: number;
    icon: typeof Sparkles;
    color: string;
    bgColor: string;
    filterKey: FilterType;
  }[] = [
    {
      label: 'AI Safe',
      value: aiSafeCount,
      icon: Sparkles,
      color: aiSafeCount > 0 ? 'text-success' : 'text-muted-foreground/50',
      bgColor: aiSafeCount > 0 ? 'bg-success/10' : 'bg-muted',
      filterKey: 'ai-approve',
    },
    {
      label: 'AI Review',
      value: aiReviewCount,
      icon: AlertTriangle,
      color: aiReviewCount > 0 ? 'text-warning' : 'text-muted-foreground/50',
      bgColor: aiReviewCount > 0 ? 'bg-warning/10' : 'bg-muted',
      filterKey: 'ai-review',
    },
    {
      label: 'AI Flag',
      value: aiFlagCount,
      icon: Flag,
      color: aiFlagCount > 0 ? 'text-destructive' : 'text-muted-foreground/50',
      bgColor: aiFlagCount > 0 ? 'bg-destructive/10' : 'bg-muted',
      filterKey: 'ai-flag',
    },
  ];

  const handleClick = (filterKey: FilterType | null) => {
    if (filterKey && onFilterChange) {
      onFilterChange(filterKey);
    }
  };

  const renderCard = (metric: (typeof metrics)[number]) => {
    const Icon = metric.icon;
    const isClickable = metric.filterKey !== null;
    const isActive = activeFilter && metric.filterKey === activeFilter;

    return (
      <div
        key={metric.label}
        onClick={() => handleClick(metric.filterKey)}
        className={cn(
          'p-4 rounded-lg flex flex-col items-center transition-all',
          metric.bgColor,
          isClickable && 'cursor-pointer hover:scale-105 hover:shadow-md',
          isActive && 'ring-2 ring-offset-2 ring-primary'
        )}
        role={isClickable ? 'button' : undefined}
        tabIndex={isClickable ? 0 : undefined}
        onKeyDown={
          isClickable
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleClick(metric.filterKey);
                }
              }
            : undefined
        }
      >
        <div className={`text-3xl font-bold ${metric.color}`}>
          {metric.value}
        </div>
        <div className="flex items-center gap-1 text-muted-foreground text-sm mt-1">
          <Icon className="w-4 h-4" />
          {metric.label}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Per-test tile bar (replaces the legacy progress / pass-rate bar) */}
      <div className="p-4">
        {(() => {
          const byTest = new Map<string, VisualDiffWithTestStatus[]>();
          for (const d of diffs ?? []) {
            const arr = byTest.get(d.testId) ?? [];
            arr.push(d);
            byTest.set(d.testId, arr);
          }
          const testIdsInOrder = Array.from(byTest.keys());
          const testTiles: { testId: string; name: string; status: TileStatus }[] = testIdsInOrder.map((tid) => {
            const group = byTest.get(tid)!;
            return {
              testId: tid,
              name: group[0]?.testName ?? 'unnamed test',
              status: deriveTestTileStatus(group),
            };
          });
          const pendingTiles = Math.max(0, totalTests - testTiles.length);

          const tileBg: Record<TileStatus, string> = {
            passed: 'bg-success',
            failed: 'bg-destructive',
            changed: 'bg-warning',
            pending: 'bg-muted',
          };

          const runningTests = isRunning
            ? testTiles
                .filter((t) => {
                  const group = byTest.get(t.testId) ?? [];
                  const hasFinalResult = group.some(
                    (d) => d.testResultStatus === 'passed' || d.testResultStatus === 'failed',
                  );
                  return !hasFinalResult;
                })
                .map((t) => {
                  const group = byTest.get(t.testId) ?? [];
                  const recent = group
                    .filter((d) => d.createdAt)
                    .sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime())[0];
                  return {
                    testId: t.testId,
                    name: t.name,
                    stepLabel: recent?.stepLabel ?? null,
                  };
                })
            : [];

          const VISIBLE_LIMIT = 5;
          const visibleRunning = runningTests.slice(0, VISIBLE_LIMIT);
          const overflow = Math.max(0, runningTests.length - VISIBLE_LIMIT);

          const headerLabel = isRunning ? 'Progress' : 'Result';
          const headerValue = isRunning ? `${completedTests}/${totalTests}` : `${passRate}%`;
          const headerValueClass = isRunning
            ? 'text-primary'
            : passRate === 100
              ? 'text-success'
              : passRate >= 80
                ? 'text-warning'
                : 'text-destructive';

          return (
            <>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-foreground">{headerLabel}</span>
                <span className={cn('text-lg font-bold tabular-nums', headerValueClass)}>
                  {headerValue}
                </span>
              </div>

              <div className="flex w-full h-3 rounded overflow-hidden border border-border">
                {testTiles.map((t, i) => (
                  <div
                    key={`tile-${t.testId}-${i}`}
                    title={`${t.name} · ${t.status}`}
                    className={cn(
                      'flex-1 min-w-[2px] border-r border-background last:border-r-0',
                      tileBg[t.status],
                    )}
                  />
                ))}
                {Array.from({ length: pendingTiles }).map((_, i) => (
                  <div
                    key={`pending-${i}`}
                    title="pending"
                    className="flex-1 min-w-[2px] border-r border-background last:border-r-0 border-y border-dashed border-muted-foreground/40 bg-muted"
                  />
                ))}
              </div>

              {!isRunning && totalTests > 0 && (
                <div className="flex justify-between mt-1 text-xs text-muted-foreground">
                  <span>{passedCount} passed</span>
                  <span>{failedCount} failed</span>
                </div>
              )}

              {isRunning && (
                <div className="mt-2 rounded bg-muted/50 px-2 py-1.5">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                    <span className="font-medium text-foreground">
                      now running
                      {runningTests.length > 1 && (
                        <span className="ml-1 text-muted-foreground tabular-nums">({runningTests.length})</span>
                      )}
                    </span>
                  </div>
                  {visibleRunning.length === 0 ? (
                    <div className="font-mono text-xs text-muted-foreground mt-1 ml-3.5">running…</div>
                  ) : (
                    <ul className="mt-1 space-y-0.5">
                      {visibleRunning.map((r) => (
                        <li
                          key={r.testId}
                          className="ml-3.5 font-mono text-xs text-muted-foreground truncate"
                        >
                          <span className="text-foreground">{r.name}</span>
                          {r.stepLabel && (
                            <span className="text-muted-foreground/70"> · {r.stepLabel}</span>
                          )}
                          <span className="text-muted-foreground/70"> · capturing…</span>
                        </li>
                      ))}
                      {overflow > 0 && (
                        <li className="ml-3.5 font-mono text-xs text-muted-foreground/70">
                          + {overflow} more
                        </li>
                      )}
                    </ul>
                  )}
                </div>
              )}
            </>
          );
        })()}
      </div>

      {/* Metrics Grid */}
      <div className="flex items-start gap-4">
        {/* Tests section */}
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">Tests</div>
          <div className="grid grid-cols-2 gap-4">
            {metrics.slice(0, 2).map(renderCard)}
          </div>
        </div>

        {/* Vertical Divider */}
        <div className="w-px bg-border self-stretch min-h-[80px]" />

        {/* Cases section */}
        <div className="flex-1">
          <div className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">Cases</div>
          <div className="grid grid-cols-4 gap-4">
            {metrics.slice(2).map(renderCard)}
          </div>
        </div>
      </div>

      {/* AI Metrics Row */}
      {hasAIMetrics && (
        <div className="grid grid-cols-3 gap-3 p-3 bg-purple-50/50 rounded-lg border border-purple-100">
          {aiMetrics.map((metric) => {
            const Icon = metric.icon;
            const isActive = activeFilter && metric.filterKey === activeFilter;

            return (
              <div
                key={metric.label}
                onClick={() => handleClick(metric.filterKey)}
                className={cn(
                  'p-3 rounded-lg flex flex-col items-center transition-all cursor-pointer hover:scale-105 hover:shadow-md bg-white/80',
                  isActive && 'ring-2 ring-offset-2 ring-purple-500'
                )}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleClick(metric.filterKey);
                  }
                }}
              >
                <div className={`text-2xl font-bold ${metric.color}`}>
                  {metric.value}
                </div>
                <div className="flex items-center gap-1 text-purple-600 text-xs mt-1">
                  <Icon className="w-3.5 h-3.5" />
                  {metric.label}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Controls Row */}
      {(viewMode && onViewModeChange || onGroupByAreaChange || onGroupByTestChange) && (
        <div className="flex items-center gap-3">
          {/* Comparison Mode Toggle — segmented control */}
          {viewMode && onViewModeChange && (
            <div className="inline-flex rounded-lg border bg-muted p-1">
              <button
                onClick={() => onViewModeChange('branch')}
                className={cn(
                  'inline-flex items-center gap-2 px-4 py-1.5 text-sm font-medium rounded-md transition-colors',
                  viewMode === 'branch'
                    ? 'bg-accent text-accent-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <GitBranch className="w-4 h-4" />
                Branch
              </button>
              <button
                onClick={() => onViewModeChange('main')}
                className={cn(
                  'inline-flex items-center gap-2 px-4 py-1.5 text-sm font-medium rounded-md transition-colors',
                  viewMode === 'main'
                    ? 'bg-accent text-accent-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Shield className="w-4 h-4" />
                Main
              </button>
            </div>
          )}

          {/* Group by Test Toggle */}
          {onGroupByTestChange && (
            <button
              onClick={() => onGroupByTestChange(!groupByTest)}
              className={cn(
                'inline-flex items-center gap-2 px-4 py-1.5 text-sm font-medium rounded-lg border transition-colors',
                groupByTest
                  ? 'bg-accent text-accent-foreground border-accent'
                  : 'bg-muted text-muted-foreground border-transparent hover:text-foreground'
              )}
            >
              <ListTree className="w-4 h-4" />
              Group by Test
            </button>
          )}

          {/* Group by Area Toggle */}
          {onGroupByAreaChange && (
            <button
              onClick={() => onGroupByAreaChange(!groupByArea)}
              className={cn(
                'inline-flex items-center gap-2 px-4 py-1.5 text-sm font-medium rounded-lg border transition-colors',
                groupByArea
                  ? 'bg-accent text-accent-foreground border-accent'
                  : 'bg-muted text-muted-foreground border-transparent hover:text-foreground'
              )}
            >
              <Layers className="w-4 h-4" />
              Group by Area
            </button>
          )}
        </div>
      )}
    </div>
  );
}
