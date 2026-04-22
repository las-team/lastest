'use client';

import { FileCheck2, AlertTriangle, XCircle, Clock, RefreshCw, CheckCircle, Sparkles, Flag, GitBranch, Shield, Layers, Bug, ListTree } from 'lucide-react';
import type { FilterType } from '@/app/(app)/builds/[buildId]/build-detail-client';
import { cn } from '@/lib/utils';

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
}: MetricsRowProps) {
  const formatTime = (ms: number | null) => {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  const passRate = totalTests > 0 ? Math.round((passedCount / totalTests) * 100) : 0;
  const progress = totalTests > 0 ? Math.round((completedTests / totalTests) * 100) : 0;

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
      color: passedCount > 0 ? 'text-green-600' : 'text-muted-foreground/50',
      bgColor: passedCount > 0 ? 'bg-green-50' : 'bg-muted',
      filterKey: 'passed',
    },
    {
      label: 'Failed',
      value: failedCount,
      icon: XCircle,
      color: failedCount > 0 ? 'text-red-600' : 'text-muted-foreground/50',
      bgColor: failedCount > 0 ? 'bg-red-50' : 'bg-muted',
      filterKey: 'failed',
    },
    {
      label: 'Errors',
      value: errorsCount,
      icon: Bug,
      color: errorsCount > 0 ? 'text-orange-600' : 'text-muted-foreground/50',
      bgColor: errorsCount > 0 ? 'bg-orange-50' : 'bg-muted',
      filterKey: 'errors',
    },
    {
      label: 'Changed',
      value: changesDetected,
      icon: AlertTriangle,
      color: changesDetected > 0 ? 'text-yellow-600' : 'text-muted-foreground/50',
      bgColor: changesDetected > 0 ? 'bg-yellow-50' : 'bg-muted',
      filterKey: 'changed',
    },
    {
      label: 'Flaky',
      value: flakyCount,
      icon: RefreshCw,
      color: flakyCount > 0 ? 'text-orange-600' : 'text-muted-foreground/50',
      bgColor: flakyCount > 0 ? 'bg-orange-50' : 'bg-muted',
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
      color: aiSafeCount > 0 ? 'text-green-600' : 'text-gray-400',
      bgColor: aiSafeCount > 0 ? 'bg-green-50' : 'bg-gray-50',
      filterKey: 'ai-approve',
    },
    {
      label: 'AI Review',
      value: aiReviewCount,
      icon: AlertTriangle,
      color: aiReviewCount > 0 ? 'text-yellow-600' : 'text-gray-400',
      bgColor: aiReviewCount > 0 ? 'bg-yellow-50' : 'bg-gray-50',
      filterKey: 'ai-review',
    },
    {
      label: 'AI Flag',
      value: aiFlagCount,
      icon: Flag,
      color: aiFlagCount > 0 ? 'text-red-600' : 'text-gray-400',
      bgColor: aiFlagCount > 0 ? 'bg-red-50' : 'bg-gray-50',
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
      {/* Pass Rate Bar */}
      <div className="p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-foreground">
            {isRunning ? 'Progress' : 'Pass Rate'}
          </span>
          <span className={cn(
            'text-lg font-bold',
            isRunning ? 'text-primary' :
            passRate === 100 ? 'text-green-600' :
            passRate >= 80 ? 'text-yellow-600' : 'text-red-600'
          )}>
            {isRunning ? `${completedTests}/${totalTests}` : `${passRate}%`}
          </span>
        </div>
        <div className="w-full h-3 bg-muted rounded-full overflow-hidden">
          {isRunning ? (
            <div
              className="h-full bg-primary transition-all duration-300 relative overflow-hidden"
              style={{ width: `${progress}%` }}
            >
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer" />
            </div>
          ) : (
            <div className="h-full flex">
              <div
                className="bg-green-500 transition-all"
                style={{ width: `${passRate}%` }}
              />
              <div
                className="bg-red-500 transition-all"
                style={{ width: `${100 - passRate}%` }}
              />
            </div>
          )}
        </div>
        {!isRunning && totalTests > 0 && (
          <div className="flex justify-between mt-1 text-xs text-muted-foreground">
            <span>{passedCount} passed</span>
            <span>{failedCount} failed</span>
          </div>
        )}
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
