"use client";

import { Button } from "@/components/ui/button";
import { TRIAGE_VERDICTS } from "@/components/triage/verdicts";
import type { TriageVerdict } from "@/lib/db/schema";

/**
 * The verdict row. `variant="bulk"` is the denser form used in the sticky
 * per-group bar, where the buttons apply to every case in the cluster.
 */
export function TriageVerdictButtons({
  current,
  onVerdict,
  disabled,
  variant = "case",
  idPrefix,
}: {
  current?: TriageVerdict | null;
  onVerdict: (verdict: TriageVerdict) => void;
  disabled?: boolean;
  variant?: "case" | "bulk";
  /** Prefix for the aria-describedby hint ids, so labels stay unique. */
  idPrefix: string;
}) {
  const bulk = variant === "bulk";
  return (
    <div className="flex flex-wrap items-center gap-2">
      {TRIAGE_VERDICTS.map((v) => {
        const active = current === v.verdict;
        return (
          <Button
            key={v.verdict}
            type="button"
            size="sm"
            variant={
              active
                ? "default"
                : !bulk && v.destructive
                  ? "destructive"
                  : "outline"
            }
            disabled={disabled}
            aria-pressed={active}
            aria-keyshortcuts={bulk ? undefined : v.key}
            onClick={(e) => {
              e.stopPropagation();
              onVerdict(v.verdict);
            }}
            id={`${idPrefix}-${v.verdict}`}
          >
            {bulk ? v.short : v.label}
            {!bulk && (
              <span
                aria-hidden
                className="ml-1.5 font-mono text-[10px] opacity-60"
              >
                {v.key}
              </span>
            )}
          </Button>
        );
      })}
    </div>
  );
}
