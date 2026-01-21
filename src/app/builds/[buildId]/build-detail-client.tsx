'use client';

import { useState } from 'react';
import type { VisualDiff } from '@/lib/db/schema';

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

export interface BuildDetailClientProps {
  buildId: string;
  diffs: VisualDiff[];
  metrics: {
    totalTests: number;
    changesDetected: number;
    flakyCount: number;
    failedCount: number;
    elapsedMs: number | null;
  };
  hasPendingDiffs: boolean;
}

export function BuildDetailClient({
  buildId,
  diffs,
  metrics,
  hasPendingDiffs,
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

  const filteredDiffs = filterDiffs(diffs, activeFilter);

  return (
    <div>
      {/* Component content will be implemented in phase 3 */}
    </div>
  );
}
