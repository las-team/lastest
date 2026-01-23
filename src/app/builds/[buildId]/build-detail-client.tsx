'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle, XCircle, ExternalLink, XIcon } from 'lucide-react';
import type { VisualDiffWithTestStatus } from '@/lib/db/schema';
import { MetricsRow } from '@/components/dashboard/metrics-row';

// Filter type for the build detail page metrics
export type FilterType = 'all' | 'tests' | 'changed' | 'flaky' | 'failed' | 'passed';

// Utility function to filter diffs based on the selected filter type
export function filterDiffs(diffs: VisualDiffWithTestStatus[], filter: FilterType): VisualDiffWithTestStatus[] {
  switch (filter) {
    case 'all':
    case 'tests':
      return diffs;
    case 'changed':
      return diffs.filter((d) => d.classification === 'changed' || (d.pixelDifference && d.pixelDifference > 0 && !d.classification));
    case 'failed':
      // Filter by test execution failure (testResultStatus) OR user-rejected diffs
      return diffs.filter((d) => d.testResultStatus === 'failed' || d.status === 'rejected');
    case 'passed':
      // Filter by test execution passed
      return diffs.filter((d) => d.testResultStatus === 'passed');
    case 'flaky':
      // Filter by flaky classification
      return diffs.filter((d) => d.classification === 'flaky');
    default:
      return diffs;
  }
}

// Status icons for visual diff items
const diffStatusIcons: Record<string, typeof CheckCircle> = {
  pending: AlertTriangle,
  approved: CheckCircle,
  rejected: XCircle,
  auto_approved: CheckCircle,
};

// Status colors for visual diff items
const diffStatusColors: Record<string, string> = {
  pending: 'text-yellow-600 bg-yellow-50',
  approved: 'text-green-600 bg-green-50',
  rejected: 'text-red-600 bg-red-50',
  auto_approved: 'text-blue-600 bg-blue-50',
};

// Filter labels for display
const filterLabels: Record<FilterType, string> = {
  all: 'All',
  tests: 'Tests',
  changed: 'Changed',
  flaky: 'Flaky',
  failed: 'Failed',
  passed: 'Passed',
};

export interface BuildDetailClientProps {
  buildId: string;
  diffs: VisualDiffWithTestStatus[];
  metrics: {
    totalTests: number;
    changesDetected: number;
    flakyCount: number;
    failedCount: number;
    passedCount: number;
    elapsedMs: number | null;
  };
  hasPendingDiffs: boolean;
  isRunning?: boolean;
  completedTests?: number;
}

export function BuildDetailClient({
  buildId,
  diffs,
  metrics,
  isRunning = false,
  completedTests = 0,
}: BuildDetailClientProps) {
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');

  // Toggle filter - clicking active filter clears it
  const handleFilterChange = (filter: FilterType) => {
    if (activeFilter === filter) {
      setActiveFilter('all');
    } else {
      setActiveFilter(filter);
    }
  };

  // Sort diffs: Failed first (execution failures or rejected), then pending, then others
  const failedDiffs = diffs.filter((d) => d.testResultStatus === 'failed' || d.status === 'rejected');
  const pendingDiffs = diffs.filter((d) => d.status === 'pending' && d.testResultStatus !== 'failed');
  const sortedDiffs = [
    ...failedDiffs,
    ...pendingDiffs,
    ...diffs.filter(
      (d) => !failedDiffs.includes(d) && !pendingDiffs.includes(d)
    ),
  ];

  // Apply filter to sorted diffs
  const filteredDiffs = filterDiffs(sortedDiffs, activeFilter);

  // Check if filter is active (not 'all')
  const isFilterActive = activeFilter !== 'all';

  return (
    <div className="space-y-6">
      {/* Metrics Row with Filter Support */}
      <MetricsRow
        totalTests={metrics.totalTests}
        changesDetected={metrics.changesDetected}
        flakyCount={metrics.flakyCount}
        failedCount={metrics.failedCount}
        passedCount={metrics.passedCount}
        elapsedMs={metrics.elapsedMs}
        activeFilter={activeFilter}
        onFilterChange={handleFilterChange}
        isRunning={isRunning}
        completedTests={completedTests}
      />

      {/* Tests for Review Section */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">
            {activeFilter === 'failed' ? 'Failed Tests' : 'Tests for Review'} ({filteredDiffs.length})
          </h2>

          {/* Active Filter Badge with Clear Button */}
          {isFilterActive && (
            <button
              onClick={() => setActiveFilter('all')}
              className="inline-flex items-center gap-1 px-3 py-1 text-sm font-medium text-blue-700 bg-blue-100 rounded-full hover:bg-blue-200 transition-colors"
            >
              <span>Showing: {filterLabels[activeFilter]}</span>
              <XIcon className="w-3 h-3" />
            </button>
          )}
        </div>

        {filteredDiffs.length === 0 ? (
          <div className="text-center py-8 text-gray-500 border rounded-lg">
            {isFilterActive ? (
              <div className="space-y-2">
                <p>No tests match the &quot;{filterLabels[activeFilter]}&quot; filter.</p>
                <button
                  onClick={() => setActiveFilter('all')}
                  className="text-blue-600 hover:text-blue-800 underline"
                >
                  Clear filter to show all tests
                </button>
              </div>
            ) : (
              <p>No visual changes detected in this build.</p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {filteredDiffs.map((diff) => {
              const isExecutionFailed = diff.testResultStatus === 'failed';
              const StatusIcon = isExecutionFailed ? XCircle : diffStatusIcons[diff.status];
              const statusColor = isExecutionFailed ? 'text-red-600 bg-red-50' : diffStatusColors[diff.status];
              const isFailed = isExecutionFailed || diff.status === 'rejected';

              return (
                <Link
                  key={diff.id}
                  href={`/builds/${buildId}/diff/${diff.id}`}
                  className={`flex items-center justify-between p-4 border rounded-lg transition-colors ${
                    isFailed
                      ? 'border-red-200 bg-red-50/50 hover:border-red-400'
                      : 'hover:border-blue-300 hover:bg-blue-50/30'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded ${statusColor}`}>
                      <StatusIcon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className={`font-medium truncate ${isFailed ? 'text-red-800' : ''}`}>
                        {diff.testName || 'Unnamed Test'}
                        {diff.stepLabel && (
                          <span className="text-gray-500 font-normal"> &rsaquo; {diff.stepLabel}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        {diff.functionalAreaName && (
                          <span className="text-blue-600 font-medium">
                            {diff.functionalAreaName}
                          </span>
                        )}
                        <span className="text-gray-400">·</span>
                        <span className={isFailed ? 'text-red-600' : 'text-gray-500'}>
                          {isExecutionFailed
                            ? 'Execution failed'
                            : diff.pixelDifference
                              ? `${diff.pixelDifference.toLocaleString()}px diff`
                              : 'No changes'}
                        </span>
                        <span className="text-gray-300 text-xs font-mono">
                          {diff.testId.slice(0, 8)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    {diff.currentImagePath && (
                      <img
                        src={diff.currentImagePath}
                        alt="Screenshot"
                        className={`w-20 h-12 object-cover rounded border ${
                          isFailed ? 'border-red-200' : ''
                        }`}
                      />
                    )}
                    <ExternalLink className={`w-4 h-4 ${isFailed ? 'text-red-400' : 'text-gray-400'}`} />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
