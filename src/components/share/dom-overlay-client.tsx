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

const TONE_STYLE: Record<
  Tone,
  {
    box: string;
    chip: string;
    chipBg: string;
    ring: string;
    popBorder: string;
    sign: string;
  }
> = {
  added: {
    box: "border-emerald-500 bg-emerald-500/25",
    chip: "text-emerald-700 dark:text-emerald-300",
    chipBg: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    ring: "ring-emerald-500/40",
    popBorder: "border-emerald-500",
    sign: "+",
  },
  removed: {
    box: "border-rose-500 bg-rose-500/25",
    chip: "text-rose-700 dark:text-rose-300",
    chipBg: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
    ring: "ring-rose-500/40",
    popBorder: "border-rose-500",
    sign: "−",
  },
  changed: {
    box: "border-amber-500 bg-amber-500/25",
    chip: "text-amber-700 dark:text-amber-300",
    chipBg: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    ring: "ring-amber-500/40",
    popBorder: "border-amber-500",
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
  const [hovered, setHovered] = useState<number | null>(null);

  // Read the image's intrinsic size and recompute the overlay. Driven by BOTH
  // a ref callback and onLoad: a cached/already-decoded <img> finishes loading
  // before React attaches the onLoad handler, so the load event never fires —
  // the ref callback's `complete` check is what guarantees `size` gets set in
  // that case (otherwise every rect collapsed to nothing and the boxes were
  // invisible). The guard avoids redundant state churn / render loops.
  const measure = (img: HTMLImageElement | null) => {
    if (!img || !img.complete || img.naturalWidth === 0) return;
    setSize((s) =>
      s && s.w === img.naturalWidth && s.h === img.naturalHeight
        ? s
        : { w: img.naturalWidth, h: img.naturalHeight },
    );
  };

  const added = dom.added ?? [];
  const removed = dom.removed ?? [];
  const changed = dom.changed ?? [];

  const allRects: Rect[] = [];
  if (size) {
    for (const el of removed)
      allRects.push(rectFor(el, "removed", size.w, size.h));
    for (const el of added) allRects.push(rectFor(el, "added", size.w, size.h));
    for (const c of changed)
      allRects.push(rectFor(c.current, "changed", size.w, size.h));
  }
  // DOM snapshots cover the whole document, but the compared screenshot is
  // frequently just the viewport — so a change below the fold has a bounding
  // box past the image bottom and would render as an invisible div positioned
  // at e.g. top:181%. Keep only boxes that overlap the captured frame; count
  // the rest so the figure can say so instead of looking empty.
  const rects = allRects.filter(
    (r) => r.x < 100 && r.y < 100 && r.x + r.w > 0 && r.y + r.h > 0,
  );
  const offFrameCount = allRects.length - rects.length;
  // Once measured, if every change is off-frame there's nothing to annotate —
  // hide the (redundant, identical-to-the-slider) screenshot and let the
  // footnote carry the count. Kept mounted (display:none, not unmounted) so the
  // measured size sticks and there's no re-measure flicker.
  const hideFrame = size != null && rects.length === 0;

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
      <div
        className={`relative rounded-md border bg-muted overflow-hidden ${
          hideFrame ? "hidden" : ""
        }`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={measure}
          src={screenshotSrc}
          alt={stepLabel ? `DOM changes for ${stepLabel}` : "DOM changes"}
          loading="lazy"
          decoding="async"
          onLoad={(e) => measure(e.currentTarget)}
          className="block w-full h-auto select-none"
        />
        <div className="absolute inset-0 pointer-events-none">
          {rects.map((r, i) => {
            const t = TONE_STYLE[r.tone];
            const isHovered = hovered === i;
            // Flip the popover to whichever side has more room so it never
            // clips: rect on the left half → popover to the right, else left.
            const pinRight = r.x < 50;
            return (
              <div
                key={i}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered((h) => (h === i ? null : h))}
                className={`absolute rounded-[2px] border-2 pointer-events-auto ${t.box} ${
                  isHovered
                    ? `ring-2 ${t.ring} z-20`
                    : "ring-1 ring-black/25 z-10"
                }`}
                style={{
                  left: `${r.x}%`,
                  top: `${r.y}%`,
                  width: `${r.w}%`,
                  height: `${r.h}%`,
                }}
              >
                {isHovered && (
                  <div
                    className={`absolute top-0 z-30 min-w-[220px] max-w-[320px] rounded-md border bg-card text-foreground p-2 text-[11px] leading-relaxed shadow-lg pointer-events-none ${t.popBorder} ${
                      pinRight ? "left-full ml-1.5" : "right-full mr-1.5"
                    }`}
                  >
                    <div className="mb-1 flex items-center gap-1.5">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${t.chipBg}`}
                      >
                        {r.tone}
                      </span>
                      <span className="font-mono text-muted-foreground">
                        {`<${r.tag}>`}
                      </span>
                    </div>
                    {r.selector && (
                      <div className="font-mono break-all text-[10.5px]">
                        {r.selector}
                      </div>
                    )}
                    {r.text && (
                      <div className="mt-1 italic break-words text-muted-foreground">
                        {r.text.length > 240
                          ? r.text.slice(0, 237) + "…"
                          : r.text}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {offFrameCount > 0 && (
        <figcaption className="text-[11px] text-muted-foreground">
          {offFrameCount} {rects.length > 0 ? "more " : ""}change
          {offFrameCount === 1 ? "" : "s"} below the captured frame
        </figcaption>
      )}
    </figure>
  );
}
