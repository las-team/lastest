"use client";

import { useCallback } from "react";
import type { TriageStepLine } from "@/components/triage/types";

const MARKS: Record<TriageStepLine["mark"], { glyph: string; color: string }> =
  {
    pass: { glyph: "✓", color: "var(--tri-ok)" },
    fail: { glyph: "✗", color: "var(--tri-bad)" },
    skip: { glyph: "·", color: "var(--muted-foreground)" },
  };

/**
 * The step log panel: every step with a ✓ / ✗ / · mark, scrolled so the
 * failing step is centred the first time the panel mounts.
 */
export function TriageStepLog({
  steps,
  failingIndex,
  label,
}: {
  steps: TriageStepLine[];
  failingIndex: number | null;
  label: string;
}) {
  // Ref callback rather than an effect: the panel is mounted on expand, and
  // this positions it once, before paint, so there is no visible jump.
  const scrollRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el || failingIndex == null) return;
      const row = el.querySelector<HTMLElement>('[data-fail="1"]');
      if (row) el.scrollTop = Math.max(0, row.offsetTop - el.clientHeight / 2);
    },
    [failingIndex],
  );

  if (steps.length === 0) {
    return (
      <div className="flex h-full min-h-[180px] items-center justify-center rounded-md border border-border bg-card p-4 text-center font-mono text-xs text-muted-foreground">
        No step log was captured for this run.
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      role="log"
      aria-label={`Step log for ${label}`}
      className="h-full min-h-[180px] overflow-y-auto rounded-md border border-border bg-card p-3 font-mono text-xs leading-relaxed"
    >
      {steps.map((s, i) => {
        const m = MARKS[s.mark];
        return (
          <div
            key={i}
            data-fail={s.mark === "fail" ? "1" : undefined}
            className="flex gap-2"
            style={{ color: m.color }}
          >
            <span aria-hidden className="w-3 flex-none">
              {m.glyph}
            </span>
            <span className="min-w-0 break-words">
              <span className="sr-only">{s.mark}: </span>
              {s.text}
            </span>
          </div>
        );
      })}
    </div>
  );
}
