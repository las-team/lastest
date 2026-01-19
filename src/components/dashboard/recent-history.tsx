'use client';

import Link from 'next/link';
import type { Build } from '@/lib/db/schema';

interface RecentHistoryProps {
  builds: Build[];
}

const statusColors: Record<string, string> = {
  safe_to_merge: 'bg-green-500',
  review_required: 'bg-yellow-500',
  blocked: 'bg-red-500',
};

export function RecentHistory({ builds }: RecentHistoryProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-gray-500">Last 5 builds:</span>
      <div className="flex gap-1">
        {builds.slice(0, 5).map((build) => (
          <Link
            key={build.id}
            href={`/builds/${build.id}`}
            className={`w-6 h-6 rounded ${statusColors[build.overallStatus]} hover:ring-2 hover:ring-offset-1 hover:ring-gray-400 transition-all`}
            title={`Build ${build.id.slice(0, 8)} - ${build.overallStatus.replace('_', ' ')}`}
          />
        ))}
        {builds.length === 0 && (
          <span className="text-gray-400 text-sm">No builds yet</span>
        )}
      </div>
    </div>
  );
}
