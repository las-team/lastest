"use client";

import { useState } from "react";
import type { TriageRegion } from "@/lib/db/schema";

/**
 * A screenshot with the changed-region boxes drawn over it.
 *
 * Served as a plain `<img>` on purpose: `/screenshots/*` is rewritten to the
 * authenticated `/api/media/*` route, and `next/image` does not forward
 * cookies on its internal fetch — it would 401 every frame.
 *
 * Region coordinates are in the screenshot's own pixel space, so the overlay
 * is an SVG sized to the image's natural dimensions and scaled with it.
 */
export function TriageShot({
  src,
  alt,
  regions,
  tone = "bad",
  height,
  onClick,
  overlayLabel,
}: {
  src: string;
  alt: string;
  regions: TriageRegion[];
  tone?: "bad" | "warn";
  /** CSS height for the frame; omit to size by the image's aspect ratio. */
  height?: number;
  onClick?: () => void;
  /** Rendered as a hover pill in the corner (e.g. "watch recording"). */
  overlayLabel?: string;
}) {
  const [dims, setDims] = useState<{ width: number; height: number } | null>(
    null,
  );
  const stroke =
    tone === "warn" ? "var(--tri-warn-fill)" : "var(--tri-bad-fill)";
  const Frame = onClick ? "button" : "div";

  return (
    <Frame
      {...(onClick
        ? { type: "button" as const, onClick, "aria-label": alt }
        : {})}
      className="triage-shot group relative block w-full overflow-hidden rounded-md border border-border bg-card text-left"
      style={height ? { height } : undefined}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        className="block h-full w-full object-cover object-top"
        onLoad={(e) =>
          setDims({
            width: e.currentTarget.naturalWidth,
            height: e.currentTarget.naturalHeight,
          })
        }
      />
      {dims && regions.length > 0 && (
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox={`0 0 ${dims.width} ${dims.height}`}
          preserveAspectRatio="xMidYMin slice"
          role="img"
          aria-label={`${regions.length} changed ${
            regions.length === 1 ? "region" : "regions"
          } highlighted on ${alt}`}
        >
          {regions.map((r, i) => (
            <rect
              key={i}
              x={r.x}
              y={r.y}
              width={r.width}
              height={r.height}
              fill={stroke}
              fillOpacity={0.12}
              stroke={stroke}
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
              rx={3}
            />
          ))}
        </svg>
      )}
      {overlayLabel && (
        <span className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-2 rounded-full bg-ink/80 px-3 py-1.5 font-mono text-[11px] text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          ▶ {overlayLabel}
        </span>
      )}
    </Frame>
  );
}
