"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpCircle,
  OctagonX,
  TrendingUp,
  X,
  Zap,
} from "lucide-react";
import type { RunUsageBannerState } from "@/lib/billing/run-usage";

interface RunUsageBannerProps {
  state: RunUsageBannerState;
  quota: number;
  projected: number;
  /** YYYY-MM — dismissals reset when the usage month rolls over. */
  usageMonth: string;
  /** Short reset label, e.g. "Aug 1". */
  resetLabel: string;
}

function fmt(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// Approaching + at-limit are dismissible; a dismissal is scoped to the usage
// month AND the state, so escalating (approaching → at_limit → paused) always
// re-surfaces. Paused is never dismissible.
const DISMISSIBLE: RunUsageBannerState[] = ["approaching", "at_limit"];

export function RunUsageBanner({
  state,
  quota,
  projected,
  usageMonth,
  resetLabel,
}: RunUsageBannerProps) {
  const dismissible = DISMISSIBLE.includes(state);
  const storageKey = `lastest:run-usage-banner-dismissed:${usageMonth}:${state}`;
  const [hidden, setHidden] = useState(false);

  // Server renders the banner visible; after mount we hide it if this
  // (month, state) was previously dismissed. Deferred via queueMicrotask so
  // the setState isn't synchronous inside the effect body (matches the
  // convention in run-usage-card-client.tsx and avoids cascading renders).
  useEffect(() => {
    if (!dismissible) return;
    queueMicrotask(() => {
      try {
        if (localStorage.getItem(storageKey) === "1") setHidden(true);
      } catch {
        /* localStorage unavailable — keep the banner visible */
      }
    });
  }, [dismissible, storageKey]);

  if (state === "ok" || hidden) return null;

  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(storageKey, "1");
    } catch {
      /* ignore */
    }
  };

  if (state === "approaching") {
    return (
      <div className="flex items-center gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2.5 md:px-6">
        <TrendingUp className="h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 flex-1 text-[13px]">
          <span className="font-semibold">
            You&apos;re on pace to exceed your run-minutes.
          </span>{" "}
          <span className="text-muted-foreground">
            Projected ~{fmt(projected)} of {fmt(quota)} this month.
          </span>
        </div>
        <Link
          href="/settings#run-usage-analytics"
          className="hidden whitespace-nowrap text-[12.5px] font-medium text-[color:var(--chart-2)] hover:underline sm:inline"
        >
          View usage
        </Link>
        <Link
          href="/settings/billing"
          className="inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md border border-amber-500/50 bg-background px-3 text-[12.5px] font-semibold text-amber-700 shadow-sm dark:text-amber-300"
        >
          <Zap className="h-3.5 w-3.5" />
          Upgrade
        </Link>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={dismiss}
          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-foreground/5"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  if (state === "at_limit") {
    return (
      <div className="flex items-center gap-3 border-b border-destructive/30 bg-destructive/5 px-4 py-2.5 md:px-6">
        <AlertTriangle className="h-4 w-4 flex-shrink-0 text-destructive" />
        <div className="min-w-0 flex-1 text-[13px]">
          <span className="font-semibold">
            You&apos;ve used all {fmt(quota)} run-minutes this month.
          </span>{" "}
          <span className="text-muted-foreground">
            Runs still work — overage may apply on paid plans. Resets{" "}
            {resetLabel}.
          </span>
        </div>
        <Link
          href="/settings/billing"
          className="inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md bg-destructive px-3 text-[12.5px] font-semibold text-white"
        >
          <ArrowUpCircle className="h-3.5 w-3.5" />
          Upgrade plan
        </Link>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={dismiss}
          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-foreground/5"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  // paused — persistent, no dismiss
  return (
    <div className="flex items-center gap-3 border-b border-destructive/40 bg-destructive/10 px-4 py-2.5 md:px-6">
      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-sm bg-destructive text-white">
        <OctagonX className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-destructive">
          Run-minute quota reached — new runs are paused
        </div>
        <div className="text-[12.5px] text-muted-foreground">
          Queued and manual runs won&apos;t start until {resetLabel} (UTC) or
          you upgrade your plan.
        </div>
      </div>
      <Link
        href="/settings/billing"
        className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md bg-destructive px-3.5 text-[12.5px] font-semibold text-white"
      >
        <ArrowUpCircle className="h-3.5 w-3.5" />
        Upgrade plan
      </Link>
    </div>
  );
}
