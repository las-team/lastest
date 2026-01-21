import Link from 'next/link';
import { CheckCircle, AlertTriangle, XCircle, Clock } from 'lucide-react';
import type { Build, BuildStatus } from '@/lib/db/schema';

interface BuildSummaryCardProps {
  build: Build;
}

const statusConfig: Record<BuildStatus, {
  icon: typeof CheckCircle;
  label: string;
  bgColor: string;
  borderColor: string;
  textColor: string;
  iconColor: string;
}> = {
  safe_to_merge: {
    icon: CheckCircle,
    label: 'Safe to Merge',
    bgColor: 'bg-green-50',
    borderColor: 'border-green-200',
    textColor: 'text-green-700',
    iconColor: 'text-green-500',
  },
  review_required: {
    icon: AlertTriangle,
    label: 'Review Required',
    bgColor: 'bg-yellow-50',
    borderColor: 'border-yellow-200',
    textColor: 'text-yellow-700',
    iconColor: 'text-yellow-500',
  },
  blocked: {
    icon: XCircle,
    label: 'Blocked',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
    textColor: 'text-red-700',
    iconColor: 'text-red-500',
  },
};

function formatTime(date: Date | null): string {
  if (!date) return '-';
  return new Date(date).toLocaleString();
}

function formatDuration(elapsedMs: number | null): string {
  if (!elapsedMs) return '-';
  return `${(elapsedMs / 1000).toFixed(1)}s`;
}

export function BuildSummaryCard({ build }: BuildSummaryCardProps) {
  const status = build.overallStatus as BuildStatus;
  const config = statusConfig[status];
  const StatusIcon = config.icon;

  return (
    <Link
      href={`/builds/${build.id}`}
      className={`block p-4 rounded-lg border ${config.borderColor} ${config.bgColor} hover:border-blue-300 hover:bg-blue-50/50 transition-colors`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded ${config.bgColor}`}>
            <StatusIcon className={`w-5 h-5 ${config.iconColor}`} />
          </div>
          <div>
            <div className="font-medium">
              Build {build.id.slice(0, 8)}
            </div>
            <div className="text-sm text-gray-500">
              {build.triggerType} · {formatTime(build.createdAt)}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-6 text-sm">
          <div className="text-center">
            <div className="font-medium">{build.totalTests ?? 0}</div>
            <div className="text-gray-500">Tests</div>
          </div>
          <div className="text-center">
            <div className="font-medium text-yellow-600">
              {build.changesDetected ?? 0}
            </div>
            <div className="text-gray-500">Changed</div>
          </div>
          <div className="text-center">
            <div className="font-medium text-red-600">
              {build.failedCount ?? 0}
            </div>
            <div className="text-gray-500">Failed</div>
          </div>
          <div className="flex items-center gap-1 text-gray-500">
            <Clock className="w-4 h-4" />
            {formatDuration(build.elapsedMs)}
          </div>
        </div>
      </div>
    </Link>
  );
}
