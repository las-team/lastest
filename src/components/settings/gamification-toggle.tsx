'use client';

import { useOptimistic, useTransition } from 'react';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { toggleGamification } from '@/server/actions/gamification';

interface GamificationToggleProps {
  enabled: boolean;
}

export function GamificationToggle({ enabled }: GamificationToggleProps) {
  const [isPending, startTransition] = useTransition();
  const [optimisticEnabled, setOptimisticEnabled] = useOptimistic(enabled);

  function handleToggle(checked: boolean) {
    startTransition(async () => {
      setOptimisticEnabled(checked);
      try {
        await toggleGamification(checked);
        toast.success(
          checked ? '🕹️ Gamification enabled — the bots are watching.' : 'Gamification disabled',
        );
      } catch {
        toast.error('Failed to update setting');
      }
    });
  }

  return (
    <div className="flex items-center justify-between">
      <div className="space-y-0.5">
        <span className="text-sm font-medium">Gamification</span>
        <p className="text-xs text-muted-foreground/70">
          Beat-the-bot scoring, seasons, and a team leaderboard. Opt-in per team.
        </p>
      </div>
      <Switch
        checked={optimisticEnabled}
        onCheckedChange={handleToggle}
        disabled={isPending}
      />
    </div>
  );
}
