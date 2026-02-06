'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, CheckCircle, AlertTriangle, Flag, X, Loader2 } from 'lucide-react';
import { acceptAIApprovals, acceptSelectedAIApprovals, discardAIRecommendations } from '@/server/actions/diffs';
import type { AIDiffAnalysis, VisualDiffWithTestStatus } from '@/lib/db/schema';

type AITab = 'approve' | 'review' | 'flag';

interface AIEvaluationPanelProps {
  buildId: string;
  diffs: VisualDiffWithTestStatus[];
}

export function AIEvaluationPanel({ buildId, diffs }: AIEvaluationPanelProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<AITab>('approve');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isProcessing, setIsProcessing] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // Filter diffs that have AI analysis
  const analyzedDiffs = diffs.filter(d => d.aiRecommendation);
  const pendingAnalysis = diffs.filter(d =>
    d.aiAnalysisStatus === 'pending' || d.aiAnalysisStatus === 'running'
  );
  const failedAnalysis = diffs.filter(d => d.aiAnalysisStatus === 'failed');
  const totalAnalyzable = diffs.filter(d => d.classification !== 'unchanged').length;

  const approveDiffs = analyzedDiffs.filter(d => d.aiRecommendation === 'approve' && d.status === 'pending');
  const reviewDiffs = analyzedDiffs.filter(d => d.aiRecommendation === 'review');
  const flagDiffs = analyzedDiffs.filter(d => d.aiRecommendation === 'flag');

  // Don't show panel if no AI analysis at all or dismissed
  if (dismissed || (analyzedDiffs.length === 0 && pendingAnalysis.length === 0 && failedAnalysis.length === 0)) {
    return null;
  }

  const currentDiffs = activeTab === 'approve' ? approveDiffs
    : activeTab === 'review' ? reviewDiffs
    : flagDiffs;

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === currentDiffs.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(currentDiffs.map(d => d.id)));
    }
  };

  const handleAcceptAllSafe = async () => {
    setIsProcessing(true);
    try {
      await acceptAIApprovals(buildId);
      router.refresh();
    } catch (error) {
      console.error('Failed to accept AI approvals:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAcceptSelected = async () => {
    if (selectedIds.size === 0) return;
    setIsProcessing(true);
    try {
      await acceptSelectedAIApprovals(Array.from(selectedIds));
      setSelectedIds(new Set());
      router.refresh();
    } catch (error) {
      console.error('Failed to accept selected:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDiscard = async () => {
    setIsProcessing(true);
    try {
      await discardAIRecommendations(buildId);
      setDismissed(true);
      router.refresh();
    } catch (error) {
      console.error('Failed to discard:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="border border-purple-200 bg-purple-50/50 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-purple-200">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-purple-600" />
          <span className="font-medium text-purple-900">
            AI Analysis ({analyzedDiffs.length}/{totalAnalyzable} analyzed)
          </span>
          {pendingAnalysis.length > 0 && (
            <span className="flex items-center gap-1 text-xs text-purple-500">
              <Loader2 className="w-3 h-3 animate-spin" />
              {pendingAnalysis.length} analyzing...
            </span>
          )}
          {failedAnalysis.length > 0 && (
            <span className="text-xs text-red-500">
              {failedAnalysis.length} failed
            </span>
          )}
        </div>
        <button
          onClick={handleDiscard}
          disabled={isProcessing}
          className="text-xs text-purple-500 hover:text-purple-700 flex items-center gap-1"
        >
          <X className="w-3 h-3" />
          Discard
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-purple-200">
        <button
          onClick={() => { setActiveTab('approve'); setSelectedIds(new Set()); }}
          className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'approve'
              ? 'border-green-500 text-green-700 bg-green-50/50'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <CheckCircle className="w-3.5 h-3.5" />
          Safe to Approve ({approveDiffs.length})
        </button>
        <button
          onClick={() => { setActiveTab('review'); setSelectedIds(new Set()); }}
          className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'review'
              ? 'border-yellow-500 text-yellow-700 bg-yellow-50/50'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <AlertTriangle className="w-3.5 h-3.5" />
          Needs Review ({reviewDiffs.length})
        </button>
        <button
          onClick={() => { setActiveTab('flag'); setSelectedIds(new Set()); }}
          className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'flag'
              ? 'border-red-500 text-red-700 bg-red-50/50'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Flag className="w-3.5 h-3.5" />
          Flagged ({flagDiffs.length})
        </button>
      </div>

      {/* Action Bar */}
      <div className="flex items-center gap-2 px-4 py-2 bg-white/50 border-b border-purple-100">
        {activeTab === 'approve' && approveDiffs.length > 0 && (
          <button
            onClick={handleAcceptAllSafe}
            disabled={isProcessing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50"
          >
            {isProcessing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
            Accept All Safe ({approveDiffs.length})
          </button>
        )}
        {selectedIds.size > 0 && (
          <button
            onClick={handleAcceptSelected}
            disabled={isProcessing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-purple-700 bg-purple-100 rounded-md hover:bg-purple-200 disabled:opacity-50"
          >
            Accept Selected ({selectedIds.size})
          </button>
        )}
        {currentDiffs.length > 0 && (
          <button
            onClick={toggleSelectAll}
            className="text-xs text-gray-500 hover:text-gray-700 ml-auto"
          >
            {selectedIds.size === currentDiffs.length ? 'Deselect All' : 'Select All'}
          </button>
        )}
      </div>

      {/* Diff List */}
      <div className="max-h-64 overflow-y-auto">
        {currentDiffs.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-gray-500">
            No diffs in this category.
          </div>
        ) : (
          currentDiffs.map(diff => {
            const analysis = diff.aiAnalysis as AIDiffAnalysis | null;
            return (
              <label
                key={diff.id}
                className="flex items-start gap-3 px-4 py-2.5 hover:bg-purple-50/50 cursor-pointer border-b border-purple-100 last:border-0"
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(diff.id)}
                  onChange={() => toggleSelect(diff.id)}
                  className="mt-0.5 rounded border-purple-300 text-purple-600 focus:ring-purple-500"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900 truncate">
                    {diff.testName || 'Unnamed Test'}
                    {diff.stepLabel && (
                      <span className="text-gray-500 font-normal"> &rsaquo; {diff.stepLabel}</span>
                    )}
                  </div>
                  {analysis && (
                    <div className="text-xs text-gray-500 truncate mt-0.5">
                      &ldquo;{analysis.summary}&rdquo;
                      <span className="ml-2 text-gray-400">
                        ({Math.round(analysis.confidence * 100)}% confidence)
                      </span>
                    </div>
                  )}
                </div>
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}
