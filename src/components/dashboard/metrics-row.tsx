'use client';

import { FileCheck2, AlertTriangle, XCircle, Clock, RefreshCw, CheckCircle, Sparkles, Flag, GitBranch, Shield } from 'lucide-react';
import type { FilterType } from '@/app/(app)/builds/[buildId]/build-detail-client';
import { cn } from '@/lib/utils';

interface MetricsRowProps {
  totalTests: number;
  changesDetected: number;
  flakyCount: number;
  failedCount: number;
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
}

export function MetricsRow({
  totalTests,
  changesDetected,
  flakyCount,
  failedCount,
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

  return (
    <div className="space-y-4">
      {/* Pass Rate Bar */}
      <div className="p-4 bg-card border rounded-lg">
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
      <div className="grid grid-cols-5 gap-4">
        {metrics.map((metric) => {
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
        })}
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

      {/* Comparison Mode Toggle */}
      {viewMode && onViewModeChange && (
        <div className="grid grid-cols-2 gap-3">
          <div
            onClick={() => onViewModeChange('branch')}
            className={cn(
              'p-3 rounded-lg flex flex-col items-center transition-all cursor-pointer hover:scale-105 hover:shadow-md bg-muted',
              viewMode === 'branch' && 'ring-2 ring-offset-2 ring-primary'
            )}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onViewModeChange('branch');
              }
            }}
          >
            <GitBranch className={cn('w-5 h-5', viewMode === 'branch' ? 'text-primary' : 'text-muted-foreground')} />
            <span className={cn('text-sm font-medium mt-1', viewMode === 'branch' ? 'text-primary' : 'text-muted-foreground')}>
              Branch
            </span>
          </div>
          <div
            onClick={() => onViewModeChange('main')}
            className={cn(
              'p-3 rounded-lg flex flex-col items-center transition-all cursor-pointer hover:scale-105 hover:shadow-md bg-muted',
              viewMode === 'main' && 'ring-2 ring-offset-2 ring-primary'
            )}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onViewModeChange('main');
              }
            }}
          >
            <Shield className={cn('w-5 h-5', viewMode === 'main' ? 'text-primary' : 'text-muted-foreground')} />
            <span className={cn('text-sm font-medium mt-1', viewMode === 'main' ? 'text-primary' : 'text-muted-foreground')}>
              Main
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
