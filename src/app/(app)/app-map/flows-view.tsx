"use client";

import { Film, ImageOff, Loader2 } from "lucide-react";
import type { AppFlow } from "@/lib/app-map/flows";

/**
 * Flows tab — named user journeys derived from test URL trajectories.
 * Selecting a flow opens the step-by-step flow player.
 */
export function FlowsView({
  flows,
  loading,
  onOpenFlow,
}: {
  flows: AppFlow[] | null;
  loading: boolean;
  onOpenFlow: (flowId: string, stepIndex: number) => void;
}) {
  if (loading || flows === null) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Deriving flows…
      </div>
    );
  }

  if (flows.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <Film className="h-8 w-8 text-muted-foreground" />
        <div className="text-sm font-semibold">No flows yet</div>
        <p className="max-w-md text-sm text-muted-foreground">
          Run a test that walks through the app — its URL trajectory becomes a
          named flow you can step through screen by screen.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="space-y-3">
        {flows.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => onOpenFlow(f.id, 0)}
            className="flex w-full flex-col gap-2 rounded-lg border bg-card p-3 text-left shadow-sm transition-shadow hover:shadow-md"
          >
            <div className="flex items-center gap-2">
              <Film className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {f.name}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {f.steps.length} steps
              </span>
              {f.gitBranch && (
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  {f.gitBranch}
                </span>
              )}
            </div>
            {/* thumbnail strip preview */}
            <div className="flex gap-1.5 overflow-x-auto">
              {f.steps.slice(0, 10).map((s, i) => (
                <div
                  key={i}
                  className="h-14 w-24 shrink-0 overflow-hidden rounded border bg-muted"
                  title={s.stepLabel ?? s.url}
                >
                  {s.screenshotPath ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/media${s.screenshotPath}`}
                      alt={s.stepLabel ?? s.url}
                      loading="lazy"
                      className="h-full w-full object-cover object-top"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-muted-foreground">
                      <ImageOff className="h-3.5 w-3.5" />
                    </div>
                  )}
                </div>
              ))}
              {f.steps.length > 10 && (
                <div className="flex h-14 w-24 shrink-0 items-center justify-center rounded border bg-muted text-xs text-muted-foreground">
                  +{f.steps.length - 10}
                </div>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
