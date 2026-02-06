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

export function BuildSummaryHero({ status, prNumber, changesDetected, isRunning = false }: BuildSummaryHeroProps) {
  const effectiveStatus = isRunning ? 'running' : status;
  const config = statusConfig[effectiveStatus];
  const Icon = config.icon;

  return (
    <div className={`p-6 rounded-lg border ${config.bgColor} ${config.borderColor}`}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <Icon className={`w-12 h-12 ${config.iconColor} ${isRunning ? 'animate-spin' : ''}`} />
          <div>
            <h1 className={`text-2xl font-bold ${config.textColor}`}>{config.label}</h1>
            <p className="text-muted-foreground">
              {effectiveStatus === 'review_required'
                ? `${changesDetected} ${config.description}`
                : config.description}
            </p>
          </div>
        </div>
        {prNumber && (
          <div className="text-muted-foreground text-sm">
            PR #{prNumber}
          </div>
        )}
      </div>
    </div>
  );
}
