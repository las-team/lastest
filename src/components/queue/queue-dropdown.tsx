'use client';

import type { BackgroundJob } from '@/lib/db/schema';
import { QueueJobItem } from './queue-job-item';

export function QueueDropdown({ jobs }: { jobs: BackgroundJob[] }) {
  const active = jobs.filter(j => j.status === 'running' || j.status === 'pending');
  const completed = jobs.filter(j => j.status === 'completed' || j.status === 'failed');

  if (jobs.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-muted-foreground">
        No active jobs
      </div>
    );
  }

  return (
    <div className="max-h-80 overflow-y-auto">
      {active.length > 0 && (
        <div>
          <div className="px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Active
          </div>
          {active.map(job => (
            <QueueJobItem key={job.id} job={job} />
          ))}
        </div>
      )}
      {completed.length > 0 && (
        <div>
          <div className="px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider border-t">
            Recent
          </div>
          {completed.map(job => (
            <QueueJobItem key={job.id} job={job} />
          ))}
        </div>
      )}
    </div>
  );
}
