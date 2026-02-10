'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle, XCircle, ExternalLink, XIcon, Sparkles, Flag, Loader2 } from 'lucide-react';
import type { AIDiffAnalysis, VisualDiffWithTestStatus } from '@/lib/db/schema';
import { MetricsRow } from '@/components/dashboard/metrics-row';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { batchApproveDiffs, batchRejectDiffs, acceptAIApprovals } from '@/server/actions/diffs';

// Filter type for the build detail page metrics
export type FilterType = 'all' | 'tests' | 'changed' | 'flaky' | 'failed' | 'passed' | 'ai-approve' | 'ai-review' | 'ai-flag';

// Utility function to filter diffs based on the selected filter type
export function filterDiffs(diffs: VisualDiffWithTestStatus[], filter: FilterType): VisualDiffWithTestStatus[] {
  switch (filter) {
    case 'all':
    case 'tests':
      return diffs;
    case 'changed':
      return diffs.filter((d) => d.classification === 'changed' || (d.pixelDifference && d.pixelDifference > 0 && !d.classification));
    case 'failed':
      return diffs.filter((d) => d.testResultStatus === 'failed' || d.status === 'rejected');
    case 'passed':
      return diffs.filter((d) => d.testResultStatus === 'passed');
    case 'flaky':
      return diffs.filter((d) => d.classification === 'flaky');
    case 'ai-approve':
      return diffs.filter((d) => d.aiRecommendation === 'approve');
    case 'ai-review':
      return diffs.filter((d) => d.aiRecommendation === 'review');
    case 'ai-flag':
      return diffs.filter((d) => d.aiRecommendation === 'flag');
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
  auto_approved: 'text-primary bg-primary/10',
};

// Filter labels for display
const filterLabels: Record<FilterType, string> = {
  all: 'All',
  tests: 'Tests',
  changed: 'Changed',
  flaky: 'Flaky',
  failed: 'Failed',
  passed: 'Passed',
  'ai-approve': 'AI: Safe',
  'ai-review': 'AI: Review',
  'ai-flag': 'AI: Flagged',
};

// AI recommendation badge config
const aiRecommendationBadge: Record<string, { label: string; className: string; Icon: typeof CheckCircle }> = {
  approve: { label: 'AI: Safe', className: 'bg-green-100 text-green-700', Icon: CheckCircle },
  review: { label: 'AI: Review', className: 'bg-yellow-100 text-yellow-700', Icon: AlertTriangle },
  flag: { label: 'AI: Flagged', className: 'bg-red-100 text-red-700', Icon: Flag },
};

// Branch status for each diff (derived from comparison data)
export type BranchStatus = 'baseline' | 'branch_accepted' | 'new_change' | 'new_test';

function deriveBranchStatus(diff: VisualDiffWithTestStatus): BranchStatus {
  if (diff.metadata && (diff.metadata as { isNewTest?: boolean }).isNewTest) return 'new_test';
  if (diff.status === 'approved') return 'branch_accepted';
  if (diff.classification === 'unchanged' || diff.status === 'auto_approved') return 'baseline';
  return 'new_change';
}

const branchStatusConfig: Record<BranchStatus, { label: string; className: string }> = {
  baseline: { label: 'Baseline', className: 'bg-gray-100 text-gray-600' },
  branch_accepted: { label: 'Branch Accepted', className: 'bg-blue-100 text-blue-700' },
  new_change: { label: 'New Change', className: 'bg-yellow-100 text-yellow-700' },
  new_test: { label: 'New Test', className: 'bg-purple-100 text-purple-700' },
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isProcessing, setIsProcessing] = useState(false);
  const router = useRouter();

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

  // AI counts
  const aiSafeCount = diffs.filter(d => d.aiRecommendation === 'approve').length;
  const aiReviewCount = diffs.filter(d => d.aiRecommendation === 'review').length;
  const aiFlagCount = diffs.filter(d => d.aiRecommendation === 'flag').length;
  const analyzedCount = diffs.filter(d => d.aiRecommendation).length;
  const analyzingCount = diffs.filter(d => d.aiAnalysisStatus === 'running' || d.aiAnalysisStatus === 'pending').length;
  const failedAnalysisCount = diffs.filter(d => d.aiAnalysisStatus === 'failed').length;
  const pendingSafeCount = diffs.filter(d => d.aiRecommendation === 'approve' && d.status === 'pending').length;
  const hasAIActivity = analyzedCount > 0 || analyzingCount > 0 || failedAnalysisCount > 0;
  const totalAnalyzable = diffs.filter(d => d.classification !== 'unchanged').length;

  // Multi-select helpers
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allFilteredSelected = filteredDiffs.length > 0 && filteredDiffs.every(d => selectedIds.has(d.id));

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredDiffs.map(d => d.id)));
    }
  };

  // Bulk action handlers
  const handleBulkApprove = async () => {
    if (selectedIds.size === 0) return;
    setIsProcessing(true);
    try {
      await batchApproveDiffs(Array.from(selectedIds));
      setSelectedIds(new Set());
      router.refresh();
    } catch (error) {
      console.error('Failed to batch approve:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleBulkReject = async () => {
    if (selectedIds.size === 0) return;
    setIsProcessing(true);
    try {
      await batchRejectDiffs(Array.from(selectedIds));
      setSelectedIds(new Set());
      router.refresh();
    } catch (error) {
      console.error('Failed to batch reject:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAcceptAllSafe = async () => {
    setIsProcessing(true);
    try {
      await acceptAIApprovals(buildId);
      setSelectedIds(new Set());
      router.refresh();
    } catch (error) {
      console.error('Failed to accept AI approvals:', error);
    } finally {
      setIsProcessing(false);
    }
  };

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
        aiSafeCount={aiSafeCount}
        aiReviewCount={aiReviewCount}
        aiFlagCount={aiFlagCount}
      />

      {/* Tests for Review Section */}
      <div>
        {/* Section Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Checkbox
              checked={allFilteredSelected}
              onCheckedChange={toggleSelectAll}
              aria-label="Select all"
            />
            <div>
              <h2 className="text-lg font-semibold">
                {activeFilter === 'failed' ? 'Failed Tests' : 'Tests for Review'} ({filteredDiffs.length})
              </h2>
              {hasAIActivity && (
                <div className="flex items-center gap-2 text-xs text-purple-600">
                  <Sparkles className="w-3 h-3" />
                  <span>{analyzedCount}/{totalAnalyzable} analyzed</span>
                  {analyzingCount > 0 && (
                    <span className="flex items-center gap-1 text-purple-500">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      {analyzingCount} analyzing
                    </span>
                  )}
                  {failedAnalysisCount > 0 && (
                    <span className="text-red-500">{failedAnalysisCount} failed</span>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {pendingSafeCount > 0 && (
              <button
                onClick={handleAcceptAllSafe}
                disabled={isProcessing}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-purple-600 rounded-md hover:bg-purple-700 disabled:opacity-50"
              >
                {isProcessing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                Accept All Safe ({pendingSafeCount})
              </button>
            )}

            {isFilterActive && (
              <Badge
                className="cursor-pointer gap-1 bg-primary/10 text-primary border-primary/20 hover:bg-primary/20"
                onClick={() => setActiveFilter('all')}
              >
                <span>Showing: {filterLabels[activeFilter]}</span>
                <XIcon className="w-3 h-3" />
              </Badge>
            )}
          </div>
        </div>

        {/* Bulk Action Bar */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-3 mb-3 px-4 py-2.5 bg-blue-50 border border-blue-200 rounded-lg">
            <span className="text-sm font-medium text-blue-700">
              {selectedIds.size} selected
            </span>
            <button
              onClick={handleBulkApprove}
              disabled={isProcessing}
              className="flex items-center gap-1 px-3 py-1 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50"
            >
              {isProcessing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
              Approve
            </button>
            <button
              onClick={handleBulkReject}
              disabled={isProcessing}
              className="flex items-center gap-1 px-3 py-1 text-sm font-medium text-red-700 border border-red-300 rounded-md hover:bg-red-50 disabled:opacity-50"
            >
              <XCircle className="w-3.5 h-3.5" />
              Reject
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="ml-auto text-sm text-gray-500 hover:text-gray-700"
            >
              Clear
            </button>
          </div>
        )}

        {filteredDiffs.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground border rounded-lg">
            {isFilterActive ? (
              <div className="space-y-2">
                <p>No tests match the &quot;{filterLabels[activeFilter]}&quot; filter.</p>
                <button
                  onClick={() => setActiveFilter('all')}
                  className="text-primary hover:text-primary/80 underline"
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
              const aiBadge = diff.aiRecommendation ? aiRecommendationBadge[diff.aiRecommendation] : null;
              const analysis = diff.aiAnalysis as AIDiffAnalysis | null;
              const isSelected = selectedIds.has(diff.id);
              const isAnalyzing = diff.aiAnalysisStatus === 'running' || diff.aiAnalysisStatus === 'pending';
              const isAIFailed = diff.aiAnalysisStatus === 'failed';
              const branchStatus = deriveBranchStatus(diff);
              const bsConfig = branchStatusConfig[branchStatus];
              const hasMainDrift = diff.mainPercentageDifference && parseFloat(diff.mainPercentageDifference) > 0;

              return (
                <div
                  key={diff.id}
                  onClick={() => router.push(`/builds/${buildId}/diff/${diff.id}`)}
                  className={`flex items-center justify-between p-4 border rounded-lg transition-colors cursor-pointer ${
                    isSelected
                      ? 'border-primary/40 bg-primary/5'
                      : isFailed
                        ? 'border-destructive/30 bg-destructive/5 hover:border-destructive/50'
                        : 'hover:border-primary/30 hover:bg-primary/5'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleSelect(diff.id)}
                      />
                    </div>
                    <div className={`p-2 rounded ${statusColor}`}>
                      <StatusIcon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className={`font-medium truncate ${isFailed ? 'text-red-800' : ''}`}>
                        {diff.testName || 'Unnamed Test'}
                        {diff.stepLabel && (
                          <span className="text-muted-foreground font-normal"> &rsaquo; {diff.stepLabel}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        {diff.functionalAreaName && (
                          <span className="text-primary font-medium">
                            {diff.functionalAreaName}
                          </span>
                        )}
                        <span className="text-muted-foreground/50">·</span>
                        <span className={isFailed ? 'text-destructive' : 'text-muted-foreground'}>
                          {isExecutionFailed
                            ? 'Execution failed'
                            : diff.pixelDifference
                              ? `${diff.pixelDifference.toLocaleString()}px diff`
                              : 'No changes'}
                        </span>
                        <span className="text-muted-foreground/40 text-xs font-mono">
                          {diff.testId.slice(0, 8)}
                        </span>
                      </div>
                      {analysis && (
                        <div className="text-xs text-gray-400 italic mt-0.5 truncate max-w-md">
                          &ldquo;{analysis.summary}&rdquo;
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    {/* Branch Status Badge */}
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${bsConfig.className}`}>
                      {bsConfig.label}
                    </span>
                    {/* Main baseline drift */}
                    {hasMainDrift && (
                      <span className="text-[10px] text-muted-foreground font-mono" title="Drift from main baseline">
                        main: {parseFloat(diff.mainPercentageDifference!).toFixed(1)}%
                      </span>
                    )}
                    {/* AI Badge */}
                    {isAnalyzing && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Analyzing...
                      </span>
                    )}
                    {aiBadge && (
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${aiBadge.className}`}>
                        <Sparkles className="w-3 h-3" />
                        {aiBadge.label}
                        {analysis && (
                          <span className="opacity-70">{Math.round(analysis.confidence * 100)}%</span>
                        )}
                      </span>
                    )}
                    {isAIFailed && !aiBadge && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-600">
                        AI Failed
                      </span>
                    )}
                    {diff.currentImagePath && (
                      <img
                        src={diff.currentImagePath}
                        alt="Screenshot"
                        className={`w-20 h-12 object-cover rounded border ${
                          isFailed ? 'border-red-200' : ''
                        }`}
                      />
                    )}
                    <ExternalLink className={`w-4 h-4 ${isFailed ? 'text-destructive/60' : 'text-muted-foreground/50'}`} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
