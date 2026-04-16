'use client';

import { useState, useEffect } from 'react';
import { Radio } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useActivityFeedContextSafe } from './activity-feed-provider-client';
import { cn } from '@/lib/utils';

export function ActivityFeedIndicator() {
  const ctx = useActivityFeedContextSafe();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!ctx) return null;
  const { setIsOpen, activeSessionCount, events, isConnected } = ctx;

  const hasActive = mounted && activeSessionCount > 0;
  const hasEvents = mounted && events.length > 0;
  const connected = mounted && isConnected;

  return (
    <Button
      variant="ghost"
      size="sm"
      className="relative gap-1.5 h-8"
      onClick={() => setIsOpen(true)}
      title={connected ? 'Activity Feed (connected)' : 'Activity Feed (disconnected)'}
    >
      <Radio
        className={cn(
          'h-4 w-4',
          hasActive ? 'text-violet-500 animate-pulse' : hasEvents ? 'text-primary' : 'text-muted-foreground',
        )}
      />
      {hasActive && (
        <span className="text-xs font-medium text-violet-500">
          {activeSessionCount}
        </span>
      )}
      {!hasActive && hasEvents && (
        <span className="text-xs text-muted-foreground">
          {events.length}
        </span>
      )}
    </Button>
  );
}
