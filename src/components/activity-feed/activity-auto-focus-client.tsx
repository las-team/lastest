'use client';

import { useEffect } from 'react';
import { useActivityFeedContextSafe } from './activity-feed-provider-client';

/**
 * Renders nothing — opens the Activity Feed panel on mount.
 * Used by the dashboard when navigating from onboarding's play-agent path
 * (`?focusActivity=1`) so the user immediately sees the agent at work.
 */
export function ActivityAutoFocus() {
  const ctx = useActivityFeedContextSafe();
  useEffect(() => {
    ctx?.setIsOpen(true);
  }, [ctx]);
  return null;
}
