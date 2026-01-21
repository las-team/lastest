'use client';

import { FileCheck2, AlertTriangle, XCircle, Clock, RefreshCw } from 'lucide-react';
import type { FilterType } from '@/app/builds/[buildId]/build-detail-client';
import { cn } from '@/lib/utils';

interface MetricsRowProps {
  totalTests: number;
  changesDetected: number;
  flakyCount: number;
  failedCount: number;
  elapsedMs: number | null;
  activeFilter?: FilterType;
  onFilterChange?: (filter: FilterType) => void;
}

export function MetricsRow({
  totalTests,
  changesDetected,
  flakyCount,
  failedCount,
  elapsedMs,
  activeFilter,
  onFilterChange,
}: MetricsRowProps) {
  const formatTime = (ms: number | null) => {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

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
      label: 'Tests',
      value: totalTests,
      icon: FileCheck2,
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
      filterKey: 'tests',
    },
    {
      label: 'Changed',
      value: changesDetected,
      icon: AlertTriangle,
      color: changesDetected > 0 ? 'text-yellow-600' : 'text-gray-400',
      bgColor: changesDetected > 0 ? 'bg-yellow-50' : 'bg-gray-50',
      filterKey: 'changed',
    },
    {
      label: 'Flaky',
      value: flakyCount,
      icon: RefreshCw,
      color: flakyCount > 0 ? 'text-orange-600' : 'text-gray-400',
      bgColor: flakyCount > 0 ? 'bg-orange-50' : 'bg-gray-50',
      filterKey: 'flaky',
    },
    {
      label: 'Failed',
      value: failedCount,
      icon: XCircle,
      color: failedCount > 0 ? 'text-red-600' : 'text-gray-400',
      bgColor: failedCount > 0 ? 'bg-red-50' : 'bg-gray-50',
      filterKey: 'failed',
    },
    {
      label: 'Time',
      value: formatTime(elapsedMs),
      icon: Clock,
      color: 'text-gray-600',
      bgColor: 'bg-gray-50',
      filterKey: null, // Time is not filterable
      isTime: true,
    },
  ];

  const handleClick = (filterKey: FilterType | null) => {
    if (filterKey && onFilterChange) {
      onFilterChange(filterKey);
    }
  };

  return (
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
              isActive && 'ring-2 ring-offset-2 ring-blue-500'
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
            <div className="flex items-center gap-1 text-gray-600 text-sm mt-1">
              <Icon className="w-4 h-4" />
              {metric.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}
