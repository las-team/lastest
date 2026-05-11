'use client';

import { useOptimistic, useTransition } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { updateEarlyAdopterMode } from '@/server/actions/settings';

interface EarlyAdopterToggleProps {
  enabled: boolean;
}

export function EarlyAdopterToggle({ enabled }: EarlyAdopterToggleProps) {
  const [isPending, startTransition] = useTransition();
  const [optimisticEnabled, setOptimisticEnabled] = useOptimistic(enabled);

  function handleToggle(checked: boolean) {
    startTransition(async () => {
      setOptimisticEnabled(checked);
      try {
        await updateEarlyAdopterMode(checked);
        toast.success(checked ? 'Early adopter mode enabled' : 'Early adopter mode disabled');
      } catch {
        toast.error('Failed to update setting');
      }
    });
  }

  return (
    <div className="flex items-center justify-between">
      <div className="space-y-0.5">
        <span className="text-sm font-medium flex items-center gap-1.5">
          <AlertTriangle className="size-3.5 text-amber-500" />
          Early Adopter Mode
        </span>
        <p className="text-xs text-muted-foreground/70">
          Experimental features (Compose, Compare) — may be unstable
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
