"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Clock, Loader2, PlugZap } from "lucide-react";
import { getMcpConnectionStatus } from "@/server/actions/api-tokens";
import { cn } from "@/lib/utils";

function relativeTime(iso: string): string {
  const secs = Math.max(
    0,
    Math.round((Date.now() - new Date(iso).getTime()) / 1000),
  );
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

type Status =
  | { kind: "loading" }
  | { kind: "connected"; lastUsedAt: string | null }
  | { kind: "waiting" } // key created, never authenticated a call
  | { kind: "none" }; // no key generated yet

/**
 * Persistent, at-a-glance confirmation of whether an MCP agent has actually
 * authenticated with one of the user's API keys. Three explicit states so the
 * user can tell "no key yet" from "key made but never used" from "live":
 *   - connected: a key has authenticated a request (optionally shows last-active)
 *   - waiting:   a key exists but no call has hit it yet
 *   - none:      no key has been generated
 * Re-checks on a light interval so a fresh connection lights up without reload.
 */
export function McpStatusBadge({ className }: { className?: string }) {
  const [status, setStatus] = useState<Status>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const s = await getMcpConnectionStatus();
        if (cancelled) return;
        if (s.connected)
          setStatus({ kind: "connected", lastUsedAt: s.lastUsedAt });
        else if (s.hasKey) setStatus({ kind: "waiting" });
        else setStatus({ kind: "none" });
      } catch {
        /* keep last known state */
      }
    };
    check();
    const id = setInterval(check, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const base =
    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium whitespace-nowrap";

  if (status.kind === "loading") {
    return (
      <span className={cn(base, "text-muted-foreground", className)}>
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Checking agent…
      </span>
    );
  }

  if (status.kind === "connected") {
    return (
      <span
        className={cn(
          base,
          "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400",
          className,
        )}
      >
        <CheckCircle2 className="h-3.5 w-3.5" />
        Agent connected
        {status.lastUsedAt && (
          <span className="font-normal opacity-80">
            · last active {relativeTime(status.lastUsedAt)}
          </span>
        )}
      </span>
    );
  }

  if (status.kind === "waiting") {
    return (
      <span
        className={cn(
          base,
          "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
          className,
        )}
      >
        <Clock className="h-3.5 w-3.5" />
        Key created · waiting for first call
      </span>
    );
  }

  return (
    <span
      className={cn(
        base,
        "border-muted-foreground/20 text-muted-foreground",
        className,
      )}
    >
      <PlugZap className="h-3.5 w-3.5" />
      No agent connected yet
    </span>
  );
}
