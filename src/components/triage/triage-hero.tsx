"use client";

import { Button } from "@/components/ui/button";
import { Loader2, Sparkles } from "lucide-react";
import type { TriageHeroVM } from "@/components/triage/types";

function formatElapsed(ms: number | null): string | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/**
 * The run thesis. When the agent has not produced one — never run, still
 * running, skipped, or failed — the narrative is *absent*, not approximated:
 * the panel says why and offers to run it.
 */
export function TriageHero({
  hero,
  caseCount,
  onRunTriage,
  running,
}: {
  hero: TriageHeroVM;
  caseCount: number;
  onRunTriage: () => void;
  running: boolean;
}) {
  const meta = [
    hero.totalTests != null ? `${hero.totalTests} tests` : null,
    hero.browsers.length > 0
      ? `${hero.browsers.length} ${hero.browsers.length === 1 ? "browser" : "browsers"}`
      : null,
    formatElapsed(hero.elapsedMs),
  ].filter(Boolean);

  const hasNarrative = Boolean(hero.headline || hero.summary);
  const pending = hero.runStatus === "pending" || hero.runStatus === "running";

  return (
    <div className="min-w-[340px] flex-1">
      {meta.length > 0 && (
        <div className="font-mono text-xs tracking-wide text-muted-foreground">
          ✦ {meta.join(" · ")}
        </div>
      )}

      {hasNarrative ? (
        <>
          {hero.headline && (
            <h1 className="mt-4 max-w-[24ch] font-serif text-[30px] font-normal leading-tight text-pretty">
              {hero.headline}
            </h1>
          )}
          {hero.summary && (
            <p className="mt-4 max-w-[58ch] text-sm leading-loose text-pretty text-muted-foreground">
              {hero.summary}
            </p>
          )}
        </>
      ) : (
        <div className="mt-4 max-w-[58ch] rounded-lg border border-dashed border-border p-5">
          <h1 className="font-serif text-2xl font-normal leading-tight">
            {pending
              ? "Triage is still running on this build."
              : hero.runStatus === "failed"
                ? "Triage did not finish on this build."
                : hero.runStatus === "skipped"
                  ? "Triage was skipped for this build."
                  : "This build has not been triaged."}
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {hero.skippedReason
              ? hero.skippedReason
              : pending
                ? "Reload in a moment — the agent writes its narrative when it finishes clustering."
                : caseCount > 0
                  ? `${caseCount} ${caseCount === 1 ? "case is" : "cases are"} listed below, ungrouped, until the agent clusters them by root cause.`
                  : "Run the agent to cluster this build's failures by root cause and get a run narrative."}
          </p>
          {!pending && (
            <Button
              className="mt-4"
              size="sm"
              onClick={onRunTriage}
              disabled={running}
            >
              {running ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              Triage this run
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
