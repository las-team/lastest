'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle, XCircle, ExternalLink, XIcon } from 'lucide-react';
import type { VisualDiff } from '@/lib/db/schema';
import { MetricsRow } from '@/components/dashboard/metrics-row';

// Filter type for the build detail page metrics
export type FilterType = 'all' | 'tests' | 'changed' | 'flaky' | 'failed';

// Utility function to filter diffs based on the selected filter type
export function filterDiffs(diffs: VisualDiff[], filter: FilterType): VisualDiff[] {
  switch (filter) {
    case 'all':
    case 'tests':
      return diffs;
    case 'changed':
      return diffs.filter((d) => d.pixelDifference && d.pixelDifference > 0);
    case 'failed':
      return diffs.filter((d) => d.status === 'rejected');
    case 'flaky':
      // Future: implement flaky detection
      return diffs;
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
};

export interface BuildDetailClientProps {
  buildId: string;
  diffs: VisualDiff[];
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

  // Sort diffs: Failed first, then pending, then others
  const failedDiffs = diffs.filter((d) => d.status === 'rejected');
  const pendingDiffs = diffs.filter((d) => d.status === 'pending');
  const sortedDiffs = [
    ...failedDiffs,
    ...pendingDiffs.filter((d) => !failedDiffs.includes(d)),
    ...diffs.filter(
      (d) => !failedDiffs.includes(d) && !pendingDiffs.includes(d)
    ),
  ];

  // Apply filter to sorted diffs
  const filteredDiffs = filterDiffs(sortedDiffs, activeFilter);

  // Check if filter is active (not 'all')
  const isFilterActive = activeFilter !== 'all';

  // Separate failed tests for prominent display
  const rejectedDiffs = diffs.filter((d) => d.status === 'rejected');
  const hasFailures = metrics.failedCount > 0 || rejectedDiffs.length > 0;

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

      {/* Failed Tests Alert Section - Only show if not filtered and has failures */}
      {hasFailures && activeFilter === 'all' && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
          <div className="flex items-start gap-3">
            <XCircle className="w-6 h-6 text-red-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-semibold text-red-800">
                {metrics.failedCount} Test{metrics.failedCount !== 1 ? 's' : ''} Failed
              </h3>
              <p className="text-sm text-red-600 mt-1">
                These tests require immediate attention before merging.
              </p>
              {rejectedDiffs.length > 0 && (
                <div className="mt-3 space-y-2">
                  {rejectedDiffs.slice(0, 3).map((diff) => (
                    <Link
                      key={diff.id}
                      href={`/builds/${buildId}/diff/${diff.id}`}
                      className="flex items-center gap-3 p-3 bg-white border border-red-200 rounded-lg hover:border-red-400 transition-colors"
                    >
                      <XCircle className="w-4 h-4 text-red-500" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-red-800 truncate">
                          Test {diff.testId.slice(0, 8)}
                        </div>
                        <div className="text-xs text-red-600">
                          {diff.pixelDifference
                            ? `${diff.pixelDifference.toLocaleString()} pixels changed`
                            : 'Rejected'}
                        </div>
                      </div>
                      {diff.currentImagePath && (
                        <img
                          src={diff.currentImagePath}
                          alt="Failed screenshot"
                          className="w-16 h-10 object-cover rounded border border-red-200"
                        />
                      )}
                    </Link>
                  ))}
                  {rejectedDiffs.length > 3 && (
                    <button
                      onClick={() => setActiveFilter('failed')}
                      className="text-sm text-red-600 hover:text-red-800 underline"
                    >
                      View all {rejectedDiffs.length} failed tests
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

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
              const StatusIcon = diffStatusIcons[diff.status];
              const statusColor = diffStatusColors[diff.status];
              const isFailed = diff.status === 'rejected';

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
                    <div>
                      <div className={`font-medium ${isFailed ? 'text-red-800' : ''}`}>
                        Test {diff.testId.slice(0, 8)}
                      </div>
                      <div className={`text-sm ${isFailed ? 'text-red-600' : 'text-gray-500'}`}>
                        {diff.pixelDifference
                          ? `${diff.pixelDifference.toLocaleString()} pixels changed (${diff.percentageDifference}%)`
                          : 'No changes detected'}
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
