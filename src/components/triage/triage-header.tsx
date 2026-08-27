"use client";

import { Button } from "@/components/ui/button";
import { Loader2, RotateCcw } from "lucide-react";
import { AgentBreadcrumb } from "@/components/agents/agent-breadcrumb";
import type { TriageHeaderVM } from "@/components/triage/types";

function formatTime(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Run identity plus the one destructive-ish action the screen offers. */
export function TriageHeader({
  header,
  failedCount,
  onRerunFailed,
  rerunning,
}: {
  header: TriageHeaderVM;
  failedCount: number;
  onRerunFailed: () => void;
  rerunning: boolean;
}) {
  const finished = formatTime(header.finishedAt);
  const bits: string[] = [];
  if (header.branch) bits.push(header.branch);
  if (header.runPosition && header.runTotal)
    bits.push(`run ${header.runPosition} of ${header.runTotal}`);
  if (finished) bits.push(`finished ${finished}`);

  return (
    <header className="flex h-14 flex-none items-center gap-3 border-b border-border px-6">
      <AgentBreadcrumb current="Triage" />
      <span className="text-sm font-semibold">{header.repoName}</span>
      <span className="hidden text-sm text-muted-foreground sm:inline">
        {header.commit && (
          <>
            <span className="font-mono">{header.commit.slice(0, 7)}</span>
            {bits.length > 0 ? " · " : null}
          </>
        )}
        {bits.join(" · ")}
      </span>
      <div className="flex-1" />
      {failedCount > 0 && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onRerunFailed}
          disabled={rerunning}
        >
          {rerunning ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RotateCcw className="h-3.5 w-3.5" />
          )}
          Re-run failed
        </Button>
      )}
    </header>
  );
}
