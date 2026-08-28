"use client";

import { useOptimistic, useTransition } from "react";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { toggleRegulatedMode } from "@/server/actions/regulated-mode";

interface RegulatedModeToggleProps {
  enabled: boolean;
}

export function RegulatedModeToggle({ enabled }: RegulatedModeToggleProps) {
  const [isPending, startTransition] = useTransition();
  const [optimisticEnabled, setOptimisticEnabled] = useOptimistic(enabled);

  function handleToggle(checked: boolean) {
    startTransition(async () => {
      setOptimisticEnabled(checked);
      try {
        const res = await toggleRegulatedMode(checked);
        toast.success(
          checked
            ? // Say what actually happened to the links that already exist:
              // the action revokes them, and the old copy ("are now refused")
              // read as "they are gone" without being true of them.
              res.revokedShares > 0
              ? `Regulated mode on — ${res.revokedShares} live share link${
                  res.revokedShares === 1 ? "" : "s"
                } revoked, and new ones are refused.`
              : "Regulated mode on — public share links are refused."
            : "Regulated mode off",
        );
      } catch {
        toast.error("Failed to update setting");
      }
    });
  }

  return (
    <div className="flex items-center justify-between">
      <div className="space-y-0.5">
        <span className="text-sm font-medium">Regulated mode</span>
        <p className="text-xs text-muted-foreground/70">
          For validated systems. Hides the leaderboard, agents and repo
          integrations, and refuses public share links. Turning it on does not
          re-tune check layers on projects that already exist.
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
