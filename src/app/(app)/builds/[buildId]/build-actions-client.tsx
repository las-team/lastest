'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { approveAllDiffs, acceptAIApprovals } from '@/server/actions/diffs';
import { CheckCircle, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface BuildActionsClientProps {
  buildId: string;
  hasPendingDiffs: boolean;
  aiApproveCount?: number;
}

export function BuildActionsClient({ buildId, hasPendingDiffs, aiApproveCount = 0 }: BuildActionsClientProps) {
  const router = useRouter();
  const [isApproving, setIsApproving] = useState(false);
  const [isAIApproving, setIsAIApproving] = useState(false);

  const handleApproveAll = async () => {
    if (!hasPendingDiffs) return;

    setIsApproving(true);
    try {
      await approveAllDiffs(buildId);
      router.refresh();
    } catch (error) {
      console.error('Failed to approve all:', error);
    } finally {
      setIsApproving(false);
    }
  };

  const handleAIApprove = async () => {
    setIsAIApproving(true);
    try {
      await acceptAIApprovals(buildId);
      router.refresh();
    } catch (error) {
      console.error('Failed to accept AI approvals:', error);
    } finally {
      setIsAIApproving(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      {aiApproveCount > 0 && (
        <button
          onClick={handleAIApprove}
          disabled={isAIApproving}
          className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Sparkles className="w-4 h-4" />
          {isAIApproving ? 'Approving...' : `Accept AI Approvals (${aiApproveCount})`}
        </button>
      )}
      {hasPendingDiffs && (
        <Button
          onClick={handleApproveAll}
          disabled={isApproving}
        >
          <CheckCircle className="w-4 h-4" />
          {isApproving ? 'Approving...' : 'Approve All Changes'}
        </Button>
      )}
    </div>
  );
}
