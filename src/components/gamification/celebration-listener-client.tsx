"use client";

import {
  CelebrationToasts,
  type CelebrationEvent,
} from "@lastest/plugin-gamification/ui/celebration-listener";

import { useActivityFeedContextSafe } from "@/components/activity-feed/activity-feed-provider-client";

/**
 * App-side glue between the activity feed and the gamification plugin's
 * celebration toasts.
 *
 * The plugin cannot read `ActivityFeedProvider`'s React context — a plugin may
 * not import app code — and it should not: which events exist and how they
 * arrive is the feed's business. What *is* the plugin's business is which of
 * them deserve a toast and what that toast says, and that is what
 * `CelebrationToasts` owns.
 *
 * Mount inside <ActivityFeedProvider> so it shares the SSE connection — no
 * extra polling or websocket needed.
 */
export function CelebrationListener() {
  const ctx = useActivityFeedContextSafe();
  if (!ctx) return null;
  // The assertion that the narrowed `CelebrationEvent` in the plugin still
  // matches the feed's real event shape. If the feed's type drifts, this stops
  // compiling here rather than silently mis-rendering there.
  const events = ctx.events satisfies readonly CelebrationEvent[];
  return (
    <CelebrationToasts events={events} historyLoaded={ctx.historyLoaded} />
  );
}
