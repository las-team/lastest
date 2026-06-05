"use client";

import { useOptimistic, useTransition } from "react";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { toggleVerifyPhase } from "@/server/actions/verify-phase";

interface VerifyPhaseToggleProps {
  enabled: boolean;
}

export function VerifyPhaseToggle({ enabled }: VerifyPhaseToggleProps) {
  const [isPending, startTransition] = useTransition();
  const [optimisticEnabled, setOptimisticEnabled] = useOptimistic(enabled);

  function handleToggle(checked: boolean) {
    startTransition(async () => {
      setOptimisticEnabled(checked);
      try {
        await toggleVerifyPhase(checked);
        toast.success(
          checked
            ? "Verify phase enabled — /verify is now your primary surface."
            : "Verify phase disabled",
        );
      } catch {
        toast.error("Failed to update setting");
      }
    });
  }

  return (
    <div className="flex items-center justify-between">
      <div className="space-y-0.5">
        <span className="text-sm font-medium">Verify phase</span>
        <p className="text-xs text-muted-foreground/70">
          Adds the /verify surface (Change Map + regression/intent gates +
          per-layer feedback). Demotes /run from the sidebar and redirects
          /review to /verify.
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
