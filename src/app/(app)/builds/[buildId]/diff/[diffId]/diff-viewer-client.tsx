'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { SliderComparison } from '@/components/diff/slider-comparison';
import { approveDiff, rejectDiff, undoApproval } from '@/server/actions/diffs';
import type { VisualDiff, Test, DiffMetadata } from '@/lib/db/schema';
import { CheckCircle, XCircle, SkipForward, Eye, Image as ImageIcon } from 'lucide-react';

interface DiffViewerClientProps {
  diff: VisualDiff & { test: Test | null };
  buildId: string;
  nextDiffId?: string;
}

export function DiffViewerClient({ diff, buildId, nextDiffId }: DiffViewerClientProps) {
  const router = useRouter();
  const [isProcessing, setIsProcessing] = useState(false);
  const [showUndo, setShowUndo] = useState(false);
  const [undoTimeout, setUndoTimeout] = useState<NodeJS.Timeout | null>(null);

  const handleApprove = useCallback(async () => {
    if (isProcessing || diff.status === 'approved') return;

    setIsProcessing(true);
    try {
      await approveDiff(diff.id);
      setShowUndo(true);

      // Auto-hide undo after 10 seconds
      const timeout = setTimeout(() => {
        setShowUndo(false);
      }, 10000);
      setUndoTimeout(timeout);

      router.refresh();

      // Navigate to next diff if available
      if (nextDiffId) {
        setTimeout(() => {
          router.push(`/builds/${buildId}/diff/${nextDiffId}`);
        }, 500);
      }
    } catch (error) {
      console.error('Failed to approve:', error);
    } finally {
      setIsProcessing(false);
    }
  }, [diff.id, diff.status, isProcessing, nextDiffId, buildId, router]);

  const handleReject = useCallback(async () => {
    if (isProcessing || diff.status === 'rejected') return;

    setIsProcessing(true);
    try {
      await rejectDiff(diff.id);
      router.refresh();
    } catch (error) {
      console.error('Failed to reject:', error);
    } finally {
      setIsProcessing(false);
    }
  }, [diff.id, diff.status, isProcessing, router]);

  const handleUndo = async () => {
    if (undoTimeout) clearTimeout(undoTimeout);
    setShowUndo(false);

    try {
      await undoApproval(diff.id);
      router.refresh();
    } catch (error) {
      console.error('Failed to undo:', error);
    }
  };

  const handleSkip = () => {
    if (nextDiffId) {
      router.push(`/builds/${buildId}/diff/${nextDiffId}`);
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.key.toLowerCase()) {
        case 'a':
          e.preventDefault();
          handleApprove();
          break;
        case 'r':
          e.preventDefault();
          handleReject();
          break;
        case 's':
          e.preventDefault();
          handleSkip();
          break;
        case 'arrowleft':
          // Navigate to prev (handled by link)
          break;
        case 'arrowright':
          // Navigate to next (handled by link)
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleApprove, handleReject, handleSkip]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (undoTimeout) clearTimeout(undoTimeout);
    };
  }, [undoTimeout]);

  const metadata = diff.metadata as DiffMetadata | null;

  return (
    <div className="space-y-4">
      {/* Status Badge */}
      <div className="flex items-center gap-4 flex-wrap">
        <div
          className={`px-3 py-1 rounded-full text-sm font-medium ${
            diff.status === 'approved' || diff.status === 'auto_approved'
              ? 'bg-green-100 text-green-700'
              : diff.status === 'rejected'
                ? 'bg-red-100 text-red-700'
                : 'bg-yellow-100 text-yellow-700'
          }`}
        >
          {diff.status === 'auto_approved' ? 'Auto-Approved (Carry-Forward)' : diff.status}
        </div>

        {diff.pixelDifference !== null && diff.pixelDifference > 0 && (
          <div className="text-sm text-gray-500">
            {diff.pixelDifference.toLocaleString()} pixels changed ({diff.percentageDifference}%)
          </div>
        )}

        {/* Planned screenshot indicator */}
        {diff.plannedImagePath && (
          <div className="flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium bg-purple-100 text-purple-700">
            <ImageIcon className="w-4 h-4" />
            Has Planned
            {diff.plannedPercentageDifference && (
              <span className="text-purple-500">
                ({diff.plannedPercentageDifference}% from design)
              </span>
            )}
          </div>
        )}
      </div>

      {/* Diff Comparison */}
      {diff.baselineImagePath && diff.currentImagePath ? (
        <SliderComparison
          baselineImage={diff.baselineImagePath}
          currentImage={diff.currentImagePath}
          diffImage={diff.diffImagePath || undefined}
          plannedImage={diff.plannedImagePath || undefined}
          plannedDiffImage={diff.plannedDiffImagePath || undefined}
          className="border rounded-lg"
        />
      ) : diff.currentImagePath ? (
        <div className="border rounded-lg p-4">
          <div className="text-sm text-gray-500 mb-2">New Screenshot (No Baseline)</div>
          <img
            src={diff.currentImagePath}
            alt="Current screenshot"
            className="w-full rounded"
          />
          {/* Show planned comparison even for new screenshots */}
          {diff.plannedImagePath && (
            <div className="mt-4 pt-4 border-t">
              <div className="text-sm text-purple-600 font-medium mb-2">
                <ImageIcon className="w-4 h-4 inline mr-1" />
                Planned (Design) Comparison
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs text-gray-500 mb-1">Current</div>
                  <img src={diff.currentImagePath} alt="Current" className="w-full border rounded" />
                </div>
                <div>
                  <div className="text-xs text-purple-500 mb-1">Planned</div>
                  <img src={diff.plannedImagePath} alt="Planned" className="w-full border-2 border-purple-300 rounded" />
                </div>
              </div>
              {diff.plannedDiffImagePath && (
                <div className="mt-2">
                  <div className="text-xs text-purple-500 mb-1">Diff from Design</div>
                  <img src={diff.plannedDiffImagePath} alt="Planned Diff" className="w-full border border-purple-300 rounded" />
                </div>
              )}
              {diff.plannedPercentageDifference && (
                <div className="mt-2 text-sm text-purple-600">
                  {diff.plannedPixelDifference?.toLocaleString()} pixels different from design ({diff.plannedPercentageDifference}%)
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="border rounded-lg p-8 text-center text-gray-500">
          No screenshot available
        </div>
      )}

      {/* Action Bar */}
      <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
        <div className="flex items-center gap-2">
          <button
            onClick={handleApprove}
            disabled={isProcessing || diff.status === 'approved' || diff.status === 'auto_approved'}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <CheckCircle className="w-4 h-4" />
            Approve
          </button>

          <button
            onClick={handleReject}
            disabled={isProcessing || diff.status === 'rejected'}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <XCircle className="w-4 h-4" />
            Reject
          </button>

          <button
            onClick={handleSkip}
            disabled={!nextDiffId}
            className="flex items-center gap-2 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <SkipForward className="w-4 h-4" />
            Skip
          </button>
        </div>

        {/* Metadata Panel Toggle */}
        {metadata && metadata.changedRegions.length > 0 && (
          <div className="text-sm text-gray-500">
            <Eye className="w-4 h-4 inline mr-1" />
            {metadata.changedRegions.length} region(s) changed
            {metadata.affectedComponents && metadata.affectedComponents.length > 0 && (
              <span> · {metadata.affectedComponents.join(', ')}</span>
            )}
          </div>
        )}
      </div>

      {/* Undo Toast */}
      {showUndo && (
        <div className="fixed bottom-4 right-4 bg-gray-900 text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-4">
          <span>Diff approved</span>
          <button
            onClick={handleUndo}
            className="text-blue-400 hover:text-blue-300 font-medium"
          >
            Undo
          </button>
        </div>
      )}
    </div>
  );
}
