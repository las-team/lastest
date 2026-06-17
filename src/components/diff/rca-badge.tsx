"use client";

/**
 * RCA badge — answers "is this visual diff the TEST or the CODE?" at a glance.
 *
 * Reads the {@link RcaVerdict} that `src/lib/rca/` stored in `DiffMetadata.rca`.
 * The headline drives the color; hovering reveals the rich-taxonomy signals
 * (category · reason) and, for code verdicts, the build's changed files.
 */

import type { RcaCategory, RcaVerdict } from "@/lib/db/schema";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Code2, FlaskConical, HelpCircle, FileCode } from "lucide-react";

const HEADLINE: Record<
  RcaVerdict["headline"],
  { label: string; className: string; Icon: typeof Code2 }
> = {
  code: {
    label: "Code change",
    className: "bg-amber-100 text-amber-800 border border-amber-200",
    Icon: Code2,
  },
  test: {
    label: "Test noise",
    className: "bg-sky-100 text-sky-700 border border-sky-200",
    Icon: FlaskConical,
  },
  uncertain: {
    label: "Unclear source",
    className: "bg-muted text-muted-foreground border border-border",
    Icon: HelpCircle,
  },
};

const CATEGORY_LABEL: Record<RcaCategory, string> = {
  "code:structural": "Structural (DOM)",
  "code:style": "Style / layout",
  "code:content": "Content edit",
  "test:flake": "Flake",
  "test:dynamic-data": "Dynamic data",
  "test:animation": "Animation / render",
  "test:environment": "Environment",
  "test:never-passed": "Never passed",
  uncertain: "Inconclusive",
};

/** Size scale. `xs` matches the dense verify-board micro-chips (9px); `sm` the
 *  build-list / focus-bar chips; `md` the standalone diff-viewer header. */
const SIZE: Record<"md" | "sm" | "xs", { wrap: string; icon: string }> = {
  md: { wrap: "gap-1.5 px-3 py-1 text-sm", icon: "h-4 w-4" },
  sm: { wrap: "gap-1.5 px-2 py-0.5 text-[11px]", icon: "h-3 w-3" },
  xs: { wrap: "gap-1 px-1.5 py-0.5 text-[9px]", icon: "h-2.5 w-2.5" },
};

export function RcaBadge({
  rca,
  size = "md",
}: {
  rca: RcaVerdict | null | undefined;
  size?: "md" | "sm" | "xs";
}) {
  if (!rca) return null;
  const h = HEADLINE[rca.headline];
  const top = rca.signals[0];
  const sz = SIZE[size];

  return (
    <HoverCard openDelay={120}>
      <HoverCardTrigger asChild>
        <span
          className={`inline-flex items-center rounded-full font-medium ${h.className} ${sz.wrap}`}
        >
          <h.Icon className={sz.icon} />
          {h.label}
        </span>
      </HoverCardTrigger>
      <HoverCardContent className="w-80 space-y-3" align="start">
        <div className="flex items-center gap-2">
          <h.Icon className="h-4 w-4" />
          <span className="font-semibold">{h.label}</span>
          {top && (
            <span className="ml-auto text-xs text-muted-foreground">
              {Math.round(top.confidence * 100)}% confident
            </span>
          )}
        </div>

        <ul className="space-y-2">
          {rca.signals.map((s, i) => (
            <li key={i} className="text-sm">
              <span className="font-medium">{CATEGORY_LABEL[s.category]}</span>
              <span className="text-muted-foreground"> — {s.reason}</span>
            </li>
          ))}
        </ul>

        {rca.changedFiles.length > 0 && (
          <div className="border-t pt-2">
            <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <FileCode className="h-3 w-3" />
              Changed files in this build
            </div>
            <ul className="space-y-0.5">
              {rca.changedFiles.slice(0, 6).map((f) => (
                <li
                  key={f}
                  className="truncate font-mono text-xs text-muted-foreground"
                  title={f}
                >
                  {f}
                </li>
              ))}
              {rca.changedFiles.length > 6 && (
                <li className="text-xs text-muted-foreground">
                  +{rca.changedFiles.length - 6} more
                </li>
              )}
            </ul>
          </div>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}

/** Lightweight headline accessor for filtering/sorting in list UIs. */
export function rcaHeadline(
  metadata: { rca?: RcaVerdict } | null | undefined,
): RcaVerdict["headline"] | null {
  return metadata?.rca?.headline ?? null;
}
