"use client";

import { useOptimistic, useTransition } from "react";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { updateBuiltInAiEnabled } from "@/server/actions/settings";

interface AiModeToggleProps {
  enabled: boolean;
}

/**
 * Switches the team between MCP mode (default, off) and built-in AI (on). This
 * is the dedicated gate for in-product AI + background AI — it no longer infers
 * availability from whether an AI key/provider is configured.
 */
export function AiModeToggle({ enabled }: AiModeToggleProps) {
  const [isPending, startTransition] = useTransition();
  const [optimisticEnabled, setOptimisticEnabled] = useOptimistic(enabled);

  function handleToggle(checked: boolean) {
    startTransition(async () => {
      setOptimisticEnabled(checked);
      try {
        await updateBuiltInAiEnabled(checked);
        toast.success(checked ? "Built-in AI enabled" : "Switched to MCP mode");
      } catch {
        toast.error("Failed to update setting");
      }
    });
  }

  return (
    <div className="flex items-center justify-between">
      <div className="space-y-0.5">
        <span className="text-sm font-medium">Built-in AI</span>
        <p className="text-xs text-muted-foreground/70">
          {optimisticEnabled
            ? "Lastest runs AI server-side for fixes, triage, and diff review."
            : "MCP mode (default) — drive Lastest's AI from your own agent over MCP."}
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
