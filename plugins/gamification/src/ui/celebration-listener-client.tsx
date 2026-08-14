"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

/**
 * The one activity event this component reads.
 *
 * Narrowed rather than imported: the real type belongs to the app's activity
 * feed, which a plugin may not reach (recipe §6.1, "narrow, don't promote" —
 * it is not this feature's type). `src/components/activity-feed/celebration-listener-client.tsx`
 * carries the `satisfies` clause that fails to compile if the shapes drift.
 */
export interface CelebrationEvent {
  id: string;
  eventType: string;
  summary: string;
  detail: unknown;
}

/**
 * Fires celebratory sonner toasts on gamification events. Duplicates are
 * deduped via the event id.
 *
 * Takes the event stream as props rather than reading the app's
 * `ActivityFeedProvider` context directly — the plugin owns *which events are
 * worth celebrating and how they read*, the app owns the SSE connection they
 * arrive on. That split is why this could move at all; the thin wrapper that
 * supplies the context stays in the app beside the provider it belongs to.
 */
export function CelebrationToasts({
  events,
  historyLoaded,
}: {
  events: readonly CelebrationEvent[];
  historyLoaded: boolean;
}) {
  const seenIds = useRef<Set<string>>(new Set());
  const initialSeedDone = useRef(false);

  useEffect(() => {
    if (!historyLoaded) return; // wait until history is loaded before seeding

    // On the first run, seed seenIds with all existing events (history loaded on mount)
    // so we don't replay old toasts. Only show toasts for events arriving after this point.
    if (!initialSeedDone.current) {
      initialSeedDone.current = true;
      for (const event of events) {
        seenIds.current.add(event.id);
      }
      return;
    }

    for (const event of events) {
      if (seenIds.current.has(event.id)) continue;
      seenIds.current.add(event.id);

      // Only react to gamification event types
      switch (event.eventType) {
        case "score:awarded": {
          const delta = Number(
            (event.detail as Record<string, unknown> | null)?.delta ?? 0,
          );
          if (delta <= 0) break;
          toast.success(
            <span className="font-mono tracking-wider">
              <span className="text-primary font-bold">+{delta}</span> ★{" "}
              {event.summary.replace(/ \([^)]+\)$/, "")}
            </span>,
            { duration: 3500 },
          );
          break;
        }
        case "score:penalty": {
          const delta = Number(
            (event.detail as Record<string, unknown> | null)?.delta ?? 0,
          );
          toast(
            <span className="font-mono tracking-wider text-orange-600 dark:text-orange-400">
              {delta} · {event.summary.replace(/ \([^)]+\)$/, "")}
            </span>,
            { duration: 2500 },
          );
          break;
        }
        case "achievement:unlocked": {
          toast.success(
            <span className="font-mono tracking-wider">
              🏆 <span className="font-bold">ACHIEVEMENT UNLOCKED</span>
              <div className="text-xs opacity-80">{event.summary}</div>
            </span>,
            { duration: 5000 },
          );
          break;
        }
        case "beat_the_bot": {
          const detail = (event.detail as Record<string, unknown> | null) ?? {};
          const botName = String(detail.botName ?? "Bot");
          const beatBy = Number(detail.beatBy ?? 0);
          toast.success(
            <span className="font-mono tracking-wider">
              ★{" "}
              <span className="font-bold">
                YOU BEAT {botName.toUpperCase()}
              </span>
              <div className="text-xs opacity-80">by {beatBy} points</div>
            </span>,
            {
              duration: 8000,
              action: {
                label: "Share",
                onClick: () => {
                  const text = `I beat ${botName} by ${beatBy} points on Lastest ★`;
                  navigator.clipboard.writeText(text).then(
                    () => toast.success("Copied to clipboard"),
                    () => toast.error("Could not copy"),
                  );
                },
              },
            },
          );
          break;
        }
        case "season:started":
        case "blitz:started": {
          toast(
            <span className="font-mono tracking-wider">{event.summary}</span>,
            { duration: 5000 },
          );
          break;
        }
      }
    }
  }, [events, historyLoaded]);

  return null;
}
