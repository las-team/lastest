'use client';

import { FileCheck2, AlertTriangle, XCircle, Clock, RefreshCw } from 'lucide-react';

interface MetricsRowProps {
  totalTests: number;
  changesDetected: number;
  flakyCount: number;
  failedCount: number;
  elapsedMs: number | null;
}

export function MetricsRow({
  totalTests,
  changesDetected,
  flakyCount,
  failedCount,
  elapsedMs,
}: MetricsRowProps) {
  const formatTime = (ms: number | null) => {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  const metrics = [
    {
      label: 'Tests',
      value: totalTests,
      icon: FileCheck2,
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
    },
    {
      label: 'Changed',
      value: changesDetected,
      icon: AlertTriangle,
      color: changesDetected > 0 ? 'text-yellow-600' : 'text-gray-400',
      bgColor: changesDetected > 0 ? 'bg-yellow-50' : 'bg-gray-50',
    },
    {
      label: 'Flaky',
      value: flakyCount,
      icon: RefreshCw,
      color: flakyCount > 0 ? 'text-orange-600' : 'text-gray-400',
      bgColor: flakyCount > 0 ? 'bg-orange-50' : 'bg-gray-50',
    },
    {
      label: 'Failed',
      value: failedCount,
      icon: XCircle,
      color: failedCount > 0 ? 'text-red-600' : 'text-gray-400',
      bgColor: failedCount > 0 ? 'bg-red-50' : 'bg-gray-50',
    },
    {
      label: 'Time',
      value: formatTime(elapsedMs),
      icon: Clock,
      color: 'text-gray-600',
      bgColor: 'bg-gray-50',
      isTime: true,
    },
  ];

  return (
    <div className="grid grid-cols-5 gap-4">
      {metrics.map((metric) => {
        const Icon = metric.icon;
        return (
          <div
            key={metric.label}
            className={`p-4 rounded-lg ${metric.bgColor} flex flex-col items-center`}
          >
            <div className={`text-3xl font-bold ${metric.color}`}>
              {metric.isTime ? metric.value : metric.value}
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
