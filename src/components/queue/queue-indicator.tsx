'use client';

import { useState, useRef, useEffect } from 'react';
import { Activity } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useJobPollingContext } from './job-polling-context';
import { QueueDropdown } from './queue-dropdown';

export function QueueIndicator() {
  const { jobs } = useJobPollingContext();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const activeJobs = jobs.filter(j => j.status === 'running' || j.status === 'pending');
  const hasActive = activeJobs.length > 0;

  // Close on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Aggregate progress for the indicator bar
  const avgProgress = hasActive
    ? Math.round(activeJobs.reduce((sum, j) => sum + (j.progress ?? 0), 0) / activeJobs.length)
    : 100;

  return (
    <div className="relative" ref={ref}>
      <Button
        variant="ghost"
        size="sm"
        className="relative gap-2"
        onClick={() => setOpen(!open)}
      >
        <Activity className={`h-4 w-4 ${hasActive ? 'text-blue-500' : 'text-muted-foreground'}`} />
        {hasActive && (
          <>
            <span className="text-xs">{activeJobs.length}</span>
            <div className="absolute bottom-0 left-1 right-1 h-0.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-300"
                style={{ width: `${avgProgress}%` }}
              />
            </div>
          </>
        )}
      </Button>

      {open && (
        <div className="absolute left-full bottom-0 ml-1 w-80 bg-popover border rounded-md shadow-md z-50">
          <QueueDropdown jobs={jobs} />
        </div>
      )}
    </div>
  );
}
