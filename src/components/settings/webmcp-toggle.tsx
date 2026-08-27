"use client";

import { useOptimistic, useTransition } from "react";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { toggleWebMcp } from "@/server/actions/webmcp";

interface WebMcpToggleProps {
  enabled: boolean;
  /** False when the deployment has not set `WEBMCP_ENABLED=1`. */
  availableOnThisDeployment: boolean;
}

export function WebMcpToggle({
  enabled,
  availableOnThisDeployment,
}: WebMcpToggleProps) {
  const [isPending, startTransition] = useTransition();
  const [optimisticEnabled, setOptimisticEnabled] = useOptimistic(enabled);

  function handleToggle(checked: boolean) {
    startTransition(async () => {
      setOptimisticEnabled(checked);
      try {
        await toggleWebMcp(checked);
        toast.success(
          checked
            ? "Browser AI agents can now use Lastest's tools on this team."
            : "Browser AI agent access disabled",
        );
      } catch {
        toast.error("Failed to update setting");
      }
    });
  }

  return (
    <div className="flex items-center justify-between">
      <div className="space-y-0.5">
        <span className="text-sm font-medium">Browser AI agents (WebMCP)</span>
        <p className="text-xs text-muted-foreground/70">
          Offers Lastest&apos;s tools to the AI agent in your browser —
          Chrome&apos;s WebMCP trial, or the ChatGPT desktop and Codex browser —
          so it can review builds and approve diffs on the page you are looking
          at, as you. Every change still asks you first.
          {!availableOnThisDeployment &&
            " This deployment has not enabled WebMCP (WEBMCP_ENABLED=1), so the toggle has no effect yet."}
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
