'use client';

import { useOptimistic, useTransition } from 'react';
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
        <span className="text-sm font-medium">Early Adopter Mode</span>
        <p className="text-xs text-muted-foreground/70">
          Enable experimental features like Compose, Suites, and Compare
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
