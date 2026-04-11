'use client';

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useActivityFeedContextSafe } from '@/components/activity-feed/activity-feed-provider-client';

/**
 * Subscribes to the existing activity-feed event stream and fires celebratory
 * sonner toasts on gamification events. Duplicates are deduped via the event id.
 *
 * Mount this inside <ActivityFeedProvider> so it shares the SSE connection —
 * no extra polling or websocket needed.
 */
export function CelebrationListener() {
  const ctx = useActivityFeedContextSafe();
  const seenIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!ctx) return;
    for (const event of ctx.events) {
      if (seenIds.current.has(event.id)) continue;
      seenIds.current.add(event.id);

      // Only react to gamification event types
      switch (event.eventType) {
        case 'score:awarded': {
          const delta = Number((event.detail as Record<string, unknown> | null)?.delta ?? 0);
          if (delta <= 0) break;
          toast.success(
            <span className="font-mono tracking-wider">
              <span className="text-primary font-bold">+{delta}</span> ★ {event.summary.replace(/ \([^)]+\)$/, '')}
            </span>,
            { duration: 3500 },
          );
          break;
        }
        case 'score:penalty': {
          const delta = Number((event.detail as Record<string, unknown> | null)?.delta ?? 0);
          toast(
            <span className="font-mono tracking-wider text-orange-600 dark:text-orange-400">
              {delta} · {event.summary.replace(/ \([^)]+\)$/, '')}
            </span>,
            { duration: 2500 },
          );
          break;
        }
        case 'achievement:unlocked': {
          toast.success(
            <span className="font-mono tracking-wider">
              🏆 <span className="font-bold">ACHIEVEMENT UNLOCKED</span>
              <div className="text-xs opacity-80">{event.summary}</div>
            </span>,
            { duration: 5000 },
          );
          break;
        }
        case 'beat_the_bot': {
          const detail = (event.detail as Record<string, unknown> | null) ?? {};
          const botName = String(detail.botName ?? 'Bot');
          const beatBy = Number(detail.beatBy ?? 0);
          toast.success(
            <span className="font-mono tracking-wider">
              ★ <span className="font-bold">YOU BEAT {botName.toUpperCase()}</span>
              <div className="text-xs opacity-80">by {beatBy} points</div>
            </span>,
            {
              duration: 8000,
              action: {
                label: 'Share',
                onClick: () => {
                  const text = `I beat ${botName} by ${beatBy} points on Lastest ★`;
                  navigator.clipboard.writeText(text).then(
                    () => toast.success('Copied to clipboard'),
                    () => toast.error('Could not copy'),
                  );
                },
              },
            },
          );
          break;
        }
        case 'season:started':
        case 'blitz:started': {
          toast(
            <span className="font-mono tracking-wider">{event.summary}</span>,
            { duration: 5000 },
          );
          break;
        }
      }
    }
  }, [ctx, ctx?.events]);

  return null;
}
