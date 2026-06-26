"use client";

/* eslint-disable @next/next/no-img-element -- auth-protected dynamic media;
   next/image's optimizer can't forward the session cookie (Next >=16.2). */

/**
 * Interactive Root Cause Analysis panel (Percy-style).
 *
 * Renders the RCA verdict's element-level {@link RcaRegionCause}s: the current
 * screenshot with clickable purple boxes over each changed region, paired with
 * a list of the DOM element + CSS-property deltas that caused each one. Hover or
 * click links a box to its list entry and back.
 *
 * Degrades gracefully: when no region causes were correlated (e.g. DOM diff was
 * off, or the change had no DOM cause — a canvas/video/animation), it shows a
 * short explanation instead of an empty box.
 */

import { useState } from "react";
import type { RcaVerdict } from "@/lib/db/schema";
import { Search } from "lucide-react";

const CHANGE_LABEL: Record<string, string> = {
  text: "text",
  position: "moved",
  size: "resized",
  selector: "attrs/class",
  added: "added",
  removed: "removed",
};

export function RcaPanel({
  rca,
  currentImageSrc,
}: {
  rca: RcaVerdict | null | undefined;
  currentImageSrc?: string | null;
}) {
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const causes = rca?.regionCauses ?? [];

  if (!rca) return null;

  return (
    <details
      className="rounded-lg border border-purple-200 bg-purple-50/40"
      open
    >
      <summary className="flex cursor-pointer select-none items-center gap-3 p-4">
        <Search className="h-5 w-5 flex-shrink-0 text-purple-600" />
        <span className="font-medium text-purple-900">Root Cause Analysis</span>
        {causes.length > 0 && (
          <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
            {causes.length} element{causes.length === 1 ? "" : "s"}
          </span>
        )}
      </summary>

      <div className="space-y-4 px-4 pb-4">
        {rca.narrative && (
          <p className="text-sm italic text-purple-900">
            &ldquo;{rca.narrative}&rdquo;
          </p>
        )}

        {causes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No element-level cause was correlated for this diff. This is
            expected when DOM diff is disabled, or when the change has no DOM
            cause (e.g. a canvas, video, animation frame, or anti-aliasing) —
            consistent with a test-noise verdict.
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {/* Image with purple region boxes */}
            <div className="relative self-start overflow-hidden rounded border bg-white">
              {currentImageSrc ? (
                <>
                  <img
                    src={currentImageSrc}
                    alt="Current screenshot"
                    className="block w-full"
                    onLoad={(e) =>
                      setDims({
                        w: e.currentTarget.naturalWidth,
                        h: e.currentTarget.naturalHeight,
                      })
                    }
                  />
                  {dims && (
                    <svg
                      className="absolute inset-0 h-full w-full"
                      viewBox={`0 0 ${dims.w} ${dims.h}`}
                      preserveAspectRatio="none"
                    >
                      {causes.map((c, i) => (
                        <rect
                          key={i}
                          x={c.region.x}
                          y={c.region.y}
                          width={c.region.width}
                          height={c.region.height}
                          fill={active === i ? "rgba(168,85,247,0.25)" : "none"}
                          stroke="rgba(168,85,247,0.9)"
                          strokeWidth={active === i ? 3 : 2}
                          vectorEffect="non-scaling-stroke"
                          className="cursor-pointer"
                          onMouseEnter={() => setActive(i)}
                          onMouseLeave={() => setActive(null)}
                        />
                      ))}
                    </svg>
                  )}
                </>
              ) : (
                <div className="p-6 text-sm text-muted-foreground">
                  No current screenshot available.
                </div>
              )}
            </div>

            {/* Cause list */}
            <ul className="space-y-2">
              {causes.map((c, i) => (
                <li
                  key={i}
                  onMouseEnter={() => setActive(i)}
                  onMouseLeave={() => setActive(null)}
                  className={`rounded-md border p-2 text-sm transition-colors ${
                    active === i
                      ? "border-purple-400 bg-purple-100/60"
                      : "border-border bg-white"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-purple-200 text-xs font-semibold text-purple-800">
                      {i + 1}
                    </span>
                    <code
                      className="truncate font-mono text-xs"
                      title={c.selector}
                    >
                      {c.selector}
                    </code>
                    <div className="ml-auto flex flex-wrap gap-1">
                      {c.changeType.map((t) => (
                        <span
                          key={t}
                          className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                        >
                          {CHANGE_LABEL[t] ?? t}
                        </span>
                      ))}
                    </div>
                  </div>

                  {c.cssDeltas && c.cssDeltas.length > 0 && (
                    <table className="mt-2 w-full text-[11px]">
                      <tbody>
                        {c.cssDeltas.map((d) => (
                          <tr key={d.property}>
                            <td className="pr-2 font-mono text-muted-foreground">
                              {d.property}
                            </td>
                            <td className="pr-1 font-mono text-red-600 line-through">
                              {d.baseline}
                            </td>
                            <td className="font-mono text-green-700">
                              {d.current}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  );
}
