'use client';

import { CheckCircle, AlertTriangle, XCircle, ListTodo, Loader2 } from 'lucide-react';
import type { BuildStatus } from '@/lib/db/schema';

interface BuildSummaryHeroProps {
  status: BuildStatus;
  prNumber?: number;
  changesDetected: number;
  isRunning?: boolean;
  errorMessage?: string | null;
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
    bgColor: 'bg-success/10',
    borderColor: 'border-success/30',
    textColor: 'text-success',
    iconColor: 'text-success',
  },
  review_required: {
    icon: AlertTriangle,
    label: 'REVIEW REQUIRED',
    description: 'changes need your attention',
    bgColor: 'bg-warning/10',
    borderColor: 'border-warning/30',
    textColor: 'text-warning',
    iconColor: 'text-warning',
  },
  blocked: {
    icon: XCircle,
    label: 'BLOCKED',
    description: 'Build has failures that must be resolved',
    bgColor: 'bg-destructive/10',
    borderColor: 'border-destructive/30',
    textColor: 'text-destructive',
    iconColor: 'text-destructive',
  },
  has_todos: {
    icon: ListTodo,
    label: 'HAS TODOS',
    description: 'Review todos need to be resolved',
    bgColor: 'bg-warning/10',
    borderColor: 'border-warning/30',
    textColor: 'text-warning',
    iconColor: 'text-warning',
  },
  executor_failed: {
    icon: XCircle,
    label: 'EXECUTOR FAILED',
    description: 'Build orchestrator crashed before any test ran',
    bgColor: 'bg-destructive/10',
    borderColor: 'border-destructive/40',
    textColor: 'text-destructive',
    iconColor: 'text-destructive',
  },
};

export function BuildSummaryHero({ status, changesDetected, isRunning = false, errorMessage }: BuildSummaryHeroProps) {
  const effectiveStatus = isRunning ? 'running' : status;
  const config = statusConfig[effectiveStatus];
  const Icon = config.icon;

  return (
    <div className="inline-flex flex-col gap-1">
      <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md border text-sm font-semibold ${config.bgColor} ${config.borderColor} ${config.textColor}`}>
        <Icon className={`w-4 h-4 ${config.iconColor} ${isRunning ? 'animate-spin' : ''}`} />
        <span>{config.label}</span>
        {effectiveStatus === 'review_required' && changesDetected > 0 && (
          <span className="text-xs font-normal opacity-70">({changesDetected})</span>
        )}
      </div>
      {effectiveStatus === 'blocked' && errorMessage && (
        <span className="text-xs text-destructive truncate max-w-md" title={errorMessage}>
          {errorMessage}
        </span>
      )}
    </div>
  );
}
