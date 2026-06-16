"use client";

import { useState } from "react";
import type { DomDiffResult, DomSnapshotElement } from "@/lib/db/schema";

// Ported from the authenticated Verify > DOM tab (focus-view.tsx DomLayerPane):
// draws each changed element's bounding box on the step's current screenshot.
// Bounding boxes are in the screenshot's native pixel space, so we measure the
// image's natural dimensions on load and position the boxes as percentages —
// the overlay then scales with the responsive <img>. Self-contained (no app CSS
// vars) so it renders correctly on the public share page.

type Tone = "added" | "removed" | "changed";

const TONE_STYLE: Record<Tone, { box: string; chip: string; sign: string }> = {
  added: {
    box: "border-emerald-500 bg-emerald-500/15",
    chip: "text-emerald-700 dark:text-emerald-300",
    sign: "+",
  },
  removed: {
    box: "border-rose-500 bg-rose-500/15",
    chip: "text-rose-700 dark:text-rose-300",
    sign: "−",
  },
  changed: {
    box: "border-amber-500 bg-amber-500/15",
    chip: "text-amber-700 dark:text-amber-300",
    sign: "~",
  },
};

type Rect = {
  x: number;
  y: number;
  w: number;
  h: number;
  tone: Tone;
  tag: string;
  selector: string;
  text: string;
};

function rectFor(
  el: DomSnapshotElement,
  tone: Tone,
  vw: number,
  vh: number,
): Rect {
  const b = el.boundingBox ?? { x: 0, y: 0, width: 0, height: 0 };
  return {
    x: vw > 0 ? (b.x / vw) * 100 : 0,
    y: vh > 0 ? (b.y / vh) * 100 : 0,
    w: vw > 0 ? (b.width / vw) * 100 : 0,
    h: vh > 0 ? (b.height / vh) * 100 : 0,
    tone,
    tag: el.tag,
    selector: el.selectors?.[0]?.value ?? "",
    text: (el.textContent ?? "").trim(),
  };
}

export function DomOverlay({
  screenshotSrc,
  dom,
  stepLabel,
}: {
  screenshotSrc: string;
  dom: DomDiffResult;
  stepLabel: string | null;
}) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  const added = dom.added ?? [];
  const removed = dom.removed ?? [];
  const changed = dom.changed ?? [];

  const rects: Rect[] = [];
  if (size) {
    for (const el of removed)
      rects.push(rectFor(el, "removed", size.w, size.h));
    for (const el of added) rects.push(rectFor(el, "added", size.w, size.h));
    for (const c of changed)
      rects.push(rectFor(c.current, "changed", size.w, size.h));
  }

  return (
    <figure className="space-y-2">
      <header className="flex flex-wrap items-center gap-2 text-xs">
        {stepLabel && (
          <span className="font-medium text-foreground truncate">
            {stepLabel}
          </span>
        )}
        <span className={`font-mono ${TONE_STYLE.added.chip}`}>
          +{added.length} added
        </span>
        <span className={`font-mono ${TONE_STYLE.removed.chip}`}>
          −{removed.length} removed
        </span>
        <span className={`font-mono ${TONE_STYLE.changed.chip}`}>
          ~{changed.length} changed
        </span>
      </header>
      <div className="relative rounded-md border bg-muted overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={screenshotSrc}
          alt={stepLabel ? `DOM changes for ${stepLabel}` : "DOM changes"}
          loading="lazy"
          decoding="async"
          onLoad={(e) =>
            setSize({
              w: e.currentTarget.naturalWidth,
              h: e.currentTarget.naturalHeight,
            })
          }
          className="block w-full h-auto select-none"
        />
        <div className="absolute inset-0 pointer-events-none">
          {rects.map((r, i) => (
            <div
              key={i}
              className={`absolute border-2 ${TONE_STYLE[r.tone].box}`}
              style={{
                left: `${r.x}%`,
                top: `${r.y}%`,
                width: `${r.w}%`,
                height: `${r.h}%`,
              }}
              title={`${TONE_STYLE[r.tone].sign} <${r.tag}>${
                r.selector ? ` ${r.selector}` : ""
              }${r.text ? ` — "${r.text.slice(0, 60)}"` : ""}`}
            />
          ))}
        </div>
      </div>
    </figure>
  );
}
