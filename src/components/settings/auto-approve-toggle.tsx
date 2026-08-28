"use client";

import { useOptimistic, useTransition } from "react";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { updateAutoApproveDefaultBranch } from "@/server/actions/repos";

interface AutoApproveToggleProps {
  repositoryId: string;
  enabled: boolean;
  defaultBranch: string;
  /** Set when `REGULATED_LOCKED_POLICY` forces this off. The switch is
   *  rendered visible-but-disabled rather than hidden — a customer who can see
   *  auto-approval is off trusts it more than one who cannot find the switch.
   *  The server action refuses independently; this is presentation. */
  lockedReason?: string;
}

export function AutoApproveToggle({
  repositoryId,
  enabled,
  defaultBranch,
  lockedReason,
}: AutoApproveToggleProps) {
  const [isPending, startTransition] = useTransition();
  const [optimisticEnabled, setOptimisticEnabled] = useOptimistic(enabled);

  function handleToggle(checked: boolean) {
    startTransition(async () => {
      setOptimisticEnabled(checked);
      try {
        await updateAutoApproveDefaultBranch(repositoryId, checked);
        toast.success(
          checked ? "Auto-approve enabled" : "Auto-approve disabled",
        );
      } catch {
        toast.error("Failed to update setting");
      }
    });
  }

  return (
    <div className="flex items-center justify-between">
      <div className="space-y-0.5">
        <span className="text-muted-foreground text-sm">
          Auto-approve default branch
        </span>
        <p className="text-xs text-muted-foreground/70">
          Automatically approve builds on <code>{defaultBranch}</code> and set
          screenshots as baselines
        </p>
        {lockedReason && (
          <p className="text-xs text-muted-foreground/70">{lockedReason}</p>
        )}
      </div>
      <Switch
        checked={lockedReason ? false : optimisticEnabled}
        onCheckedChange={handleToggle}
        disabled={isPending || !!lockedReason}
      />
    </div>
  );
}
