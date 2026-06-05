"use client";

import { useState, useEffect } from "react";
import { Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useActivityFeedContextSafe } from "./activity-feed-provider-client";
import { cn } from "@/lib/utils";

export function ActivityFeedIndicator() {
  const ctx = useActivityFeedContextSafe();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Hydration guard: defer SSR-sensitive UI until after client mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  if (!ctx) return null;
  const { setIsOpen, activeSessionCount, events, isConnected } = ctx;

  // Reserve identical layout on server + first client render to keep
  // hydration deterministic; fill in state-derived attrs after mount.
  if (!mounted) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="relative gap-1.5 h-8"
        onClick={() => setIsOpen(true)}
        aria-label="Activity feed"
        suppressHydrationWarning
      >
        <Radio className="h-4 w-4 text-muted-foreground" />
      </Button>
    );
  }

  const hasActive = activeSessionCount > 0;
  const hasEvents = events.length > 0;

  return (
    <Button
      variant="ghost"
      size="sm"
      className="relative gap-1.5 h-8"
      onClick={() => setIsOpen(true)}
      aria-label={
        isConnected
          ? "Activity feed (connected)"
          : "Activity feed (disconnected)"
      }
      title={
        isConnected
          ? "Activity Feed (connected)"
          : "Activity Feed (disconnected)"
      }
    >
      <Radio
        className={cn(
          "h-4 w-4",
          hasActive
            ? "text-violet-500 animate-pulse"
            : hasEvents
              ? "text-primary"
              : "text-muted-foreground",
        )}
      />
      {hasActive && (
        <span className="text-xs font-medium text-violet-500">
          {activeSessionCount}
        </span>
      )}
      {!hasActive && hasEvents && (
        <span className="text-xs text-muted-foreground">{events.length}</span>
      )}
    </Button>
  );
}
