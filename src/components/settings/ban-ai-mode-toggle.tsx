'use client';

import { useOptimistic, useTransition } from 'react';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { updateBanAiMode } from '@/server/actions/settings';

interface BanAiModeToggleProps {
  enabled: boolean;
}

export function BanAiModeToggle({ enabled }: BanAiModeToggleProps) {
  const [isPending, startTransition] = useTransition();
  const [optimisticEnabled, setOptimisticEnabled] = useOptimistic(enabled);

  function handleToggle(checked: boolean) {
    startTransition(async () => {
      setOptimisticEnabled(checked);
      try {
        await updateBanAiMode(checked);
        toast.success(checked ? 'Ban AI mode enabled' : 'Ban AI mode disabled');
      } catch {
        toast.error('Failed to update setting');
      }
    });
  }

  return (
    <div className="flex items-center justify-between">
      <div className="space-y-0.5">
        <span className="text-sm font-medium">Ban AI Mode</span>
        <p className="text-xs text-muted-foreground/70">
          Hide all AI and GenAI features from the interface
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
