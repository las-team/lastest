'use client';

import { Loader2, CheckCircle2, XCircle, Clock, X, Layers } from 'lucide-react';
import type { BackgroundJob } from '@/lib/db/schema';
import { cancelJob } from '@/server/actions/jobs';
import { useTransition } from 'react';
import { Badge } from '@/components/ui/badge';

const TYPE_LABELS: Record<string, string> = {
  ai_scan: 'AI Scan',
  spec_analysis: 'Spec Analysis',
  build_tests: 'Build Tests',
  test_run: 'Test Run',
  build_run: 'Build',
};

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'running':
      return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
    case 'completed':
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case 'failed':
      return <XCircle className="h-4 w-4 text-red-500" />;
    default:
      return <Clock className="h-4 w-4 text-muted-foreground" />;
  }
}

export function QueueJobItem({ job }: { job: BackgroundJob }) {
  const [isPending, startTransition] = useTransition();
  const typeLabel = TYPE_LABELS[job.type] || job.type;
  const isActive = job.status === 'running' || job.status === 'pending';

  // Extract parallel execution info from metadata
  const metadata = job.metadata as { activeCount?: number; activeTests?: string[] } | null;
  const activeCount = metadata?.activeCount ?? 0;
  const activeTests = metadata?.activeTests ?? [];
  const isParallel = activeCount > 1;

  const handleCancel = () => {
    startTransition(async () => {
      await cancelJob(job.id, job.repositoryId);
    });
  };

  return (
    <div className="flex items-center gap-3 px-3 py-2 group">
      <StatusIcon status={job.status} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">{typeLabel}</span>
          {isActive && isParallel && (
            <Badge variant="outline" className="text-xs px-1.5 py-0">
              <Layers className="w-3 h-3 mr-1" />
              {activeCount}x
            </Badge>
          )}
        </div>
        <p className="text-sm truncate">{job.label}</p>
        {isActive && isParallel && activeTests.length > 0 && (
          <p className="text-xs text-muted-foreground truncate">
            Running: {activeTests.slice(0, 3).join(', ')}{activeTests.length > 3 ? ` +${activeTests.length - 3} more` : ''}
          </p>
        )}
        {isActive && (
          <div className="mt-1 h-1.5 w-full bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-300"
              style={{ width: `${job.progress ?? 0}%` }}
            />
          </div>
        )}
        {job.status === 'failed' && job.error && (
          <p className="text-xs text-red-500 truncate mt-0.5">{job.error}</p>
        )}
      </div>
      {isActive && job.totalSteps && (
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {job.completedSteps}/{job.totalSteps}
        </span>
      )}
      {isActive && (
        <button
          onClick={handleCancel}
          disabled={isPending}
          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-muted rounded transition-opacity"
          title="Cancel job"
        >
          <X className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
        </button>
      )}
    </div>
  );
}
