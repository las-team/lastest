"use client";

import { useMemo, useState } from "react";
import { ImageOff } from "lucide-react";
import type { AppMapNode } from "@/lib/app-map/build-map";
import { COVERAGE_COLOR, COVERAGE_LABEL } from "./app-map-shared";

/**
 * Screens tab — a flat responsive gallery of every map node with a
 * screenshot. Placeholder cards for screenshot-less nodes are opt-in.
 */
export function ScreensGallery({
  nodes,
  onSelect,
}: {
  nodes: AppMapNode[];
  onSelect: (node: AppMapNode) => void;
}) {
  const [includeMissing, setIncludeMissing] = useState(false);

  const shown = useMemo(() => {
    const withShot = nodes.filter((n) => n.screenshot);
    const withoutShot = nodes.filter((n) => !n.screenshot);
    const list = includeMissing ? [...withShot, ...withoutShot] : withShot;
    return { list, missingCount: withoutShot.length };
  }, [nodes, includeMissing]);

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">
          {shown.list.length} screen{shown.list.length === 1 ? "" : "s"}
        </div>
        {shown.missingCount > 0 && (
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={includeMissing}
              onChange={(e) => setIncludeMissing(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            Include {shown.missingCount} page
            {shown.missingCount === 1 ? "" : "s"} without a screenshot
          </label>
        )}
      </div>

      {shown.list.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
          <ImageOff className="h-8 w-8" />
          <p className="text-sm">No screens captured yet</p>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
          {shown.list.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => onSelect(n)}
              className="overflow-hidden rounded-lg border bg-card text-left shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="relative aspect-video w-full bg-muted">
                {n.screenshot ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/media${n.screenshot.path}`}
                    alt={n.title ?? n.path}
                    loading="lazy"
                    className="h-full w-full object-cover object-top"
                  />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-1 text-muted-foreground">
                    <ImageOff className="h-5 w-5" />
                    <span className="text-[10px]">No screenshot</span>
                  </div>
                )}
                <span
                  className="absolute top-1.5 right-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium text-white"
                  style={{ backgroundColor: COVERAGE_COLOR[n.coverageStatus] }}
                >
                  {COVERAGE_LABEL[n.coverageStatus]}
                </span>
              </div>
              <div className="space-y-0.5 p-2">
                <div
                  className="truncate text-xs font-medium"
                  title={n.title ?? n.path}
                >
                  {n.title ?? n.path}
                </div>
                <div
                  className="truncate font-mono text-[11px] text-muted-foreground"
                  title={n.path}
                >
                  {n.path}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
