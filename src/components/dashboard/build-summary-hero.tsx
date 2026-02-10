'use client';

import { CheckCircle, AlertTriangle, XCircle, Loader2 } from 'lucide-react';
import type { BuildStatus } from '@/lib/db/schema';

interface BuildSummaryHeroProps {
  status: BuildStatus;
  prNumber?: number;
  changesDetected: number;
  isRunning?: boolean;
}

const statusConfig = {
  running: {
    icon: Loader2,
    label: 'RUNNING',
    description: 'Tests are being executed...',
    bgColor: 'bg-primary/5',
    borderColor: 'border-primary/20',
    textColor: 'text-primary',
    iconColor: 'text-primary',
  },
  safe_to_merge: {
    icon: CheckCircle,
    label: 'SAFE TO MERGE',
    description: 'No changes require review',
    bgColor: 'bg-green-50',
    borderColor: 'border-green-200',
    textColor: 'text-green-700',
    iconColor: 'text-green-500',
  },
  review_required: {
    icon: AlertTriangle,
    label: 'REVIEW REQUIRED',
    description: 'changes need your attention',
    bgColor: 'bg-yellow-50',
    borderColor: 'border-yellow-200',
    textColor: 'text-yellow-700',
    iconColor: 'text-yellow-500',
  },
  blocked: {
    icon: XCircle,
    label: 'BLOCKED',
    description: 'Build has failures that must be resolved',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
    textColor: 'text-red-700',
    iconColor: 'text-red-500',
  },
};

export function BuildSummaryHero({ status, changesDetected, isRunning = false }: BuildSummaryHeroProps) {
  const effectiveStatus = isRunning ? 'running' : status;
  const config = statusConfig[effectiveStatus];
  const Icon = config.icon;

  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md border text-sm font-semibold ${config.bgColor} ${config.borderColor} ${config.textColor}`}>
      <Icon className={`w-4 h-4 ${config.iconColor} ${isRunning ? 'animate-spin' : ''}`} />
      <span>{config.label}</span>
      {effectiveStatus === 'review_required' && changesDetected > 0 && (
        <span className="text-xs font-normal opacity-70">({changesDetected})</span>
      )}
    </div>
  );
}
