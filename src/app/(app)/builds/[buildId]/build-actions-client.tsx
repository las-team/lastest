'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { approveAllDiffs } from '@/server/actions/diffs';
import { CheckCircle } from 'lucide-react';

interface BuildActionsClientProps {
  buildId: string;
  hasPendingDiffs: boolean;
}

export function BuildActionsClient({ buildId, hasPendingDiffs }: BuildActionsClientProps) {
  const router = useRouter();
  const [isApproving, setIsApproving] = useState(false);

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

  return (
    <div className="flex items-center gap-2">
      {hasPendingDiffs && (
        <button
          onClick={handleApproveAll}
          disabled={isApproving}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <CheckCircle className="w-4 h-4" />
          {isApproving ? 'Approving...' : 'Approve All Changes'}
        </button>
      )}
    </div>
  );
}
