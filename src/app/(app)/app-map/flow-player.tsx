"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowDown,
  ChevronLeft,
  ChevronRight,
  ImageOff,
  X,
} from "lucide-react";
import type { AppFlow } from "@/lib/app-map/flows";

/**
 * Step-by-step player for a flow: large current-step screenshot, prev/next +
 * arrow-key navigation, progress dots, the action label rendered between
 * transitions ("action → resulting screen"), and a click-to-jump filmstrip.
 */
export function FlowPlayer({
  flow,
  initialStep = 0,
  onClose,
}: {
  flow: AppFlow;
  initialStep?: number;
  onClose: () => void;
}) {
  // Mounted fresh per (flow, entry step) — the parent keys this component —
  // so the initial step only matters here at mount.
  const clamp = useCallback(
    (i: number) => Math.min(Math.max(i, 0), flow.steps.length - 1),
    [flow.steps.length],
  );
  const [index, setIndex] = useState(() => clamp(initialStep));

  const prev = useCallback(() => setIndex((i) => clamp(i - 1)), [clamp]);
  const next = useCallback(() => setIndex((i) => clamp(i + 1)), [clamp]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") prev();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prev, next, onClose]);

  const step = flow.steps[index]!;

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{flow.name}</div>
          <div className="truncate font-mono text-[11px] text-muted-foreground">
            {step.url}
          </div>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">
          Step {index + 1} of {flow.steps.length}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted"
          title="Close (Esc)"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Main viewer */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center bg-muted/30 p-4">
        <button
          type="button"
          onClick={prev}
          disabled={index === 0}
          className="absolute left-3 z-10 rounded-full border bg-card p-2 shadow-sm hover:bg-muted disabled:opacity-40"
          title="Previous step (←)"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        <div className="flex h-full max-w-4xl flex-col items-center justify-center gap-2">
          {/* action → resulting screen */}
          {step.stepLabel && (
            <div className="flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-xs shadow-sm">
              <span className="font-medium">{step.stepLabel}</span>
              <ArrowDown className="h-3 w-3 text-muted-foreground" />
              <span className="font-mono text-muted-foreground">
                {step.nodeId ?? step.url}
              </span>
            </div>
          )}
          {step.screenshotPath ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/media${step.screenshotPath}`}
              alt={step.stepLabel ?? step.url}
              className="min-h-0 max-h-full max-w-full rounded-lg border object-contain shadow-sm"
            />
          ) : (
            <div className="flex h-64 w-96 flex-col items-center justify-center gap-2 rounded-lg border bg-muted text-muted-foreground">
              <ImageOff className="h-8 w-8" />
              <span className="text-xs">
                No screenshot captured at this step
              </span>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={next}
          disabled={index === flow.steps.length - 1}
          className="absolute right-3 z-10 rounded-full border bg-card p-2 shadow-sm hover:bg-muted disabled:opacity-40"
          title="Next step (→)"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {/* Progress dots */}
      <div className="flex items-center justify-center gap-1.5 py-2">
        {flow.steps.map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setIndex(i)}
            className={`h-2 w-2 rounded-full transition-colors ${
              i === index ? "bg-primary" : "bg-muted-foreground/30"
            }`}
            title={`Step ${i + 1}`}
          />
        ))}
      </div>

      {/* Filmstrip */}
      <div className="flex gap-2 overflow-x-auto border-t bg-card px-4 py-3">
        {flow.steps.map((s, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setIndex(i)}
            className={`shrink-0 overflow-hidden rounded border text-left ${
              i === index ? "ring-2 ring-primary" : ""
            }`}
            title={s.stepLabel ?? s.url}
          >
            <div className="h-16 w-28 bg-muted">
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
                  <ImageOff className="h-4 w-4" />
                </div>
              )}
            </div>
            <div className="max-w-28 truncate px-1 py-0.5 text-[10px] text-muted-foreground">
              {s.stepLabel ?? `Step ${i + 1}`}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
