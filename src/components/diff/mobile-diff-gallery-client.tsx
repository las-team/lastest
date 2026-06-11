"use client";

import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// Mobile / touch / narrow-viewport replacement for the desktop hover-wipe
// `DiffSlider`. The wipe slider sets `touch-action: none` + captures the
// touch pointer, which traps page scroll on phones. This renders each diff as
// a horizontally-swipeable mini-gallery of Before / After / Diff frames with
// floating labels, plus preset-opacity chips on the Diff frame — all native
// scroll, so vertical page scroll is never hijacked.

interface Frame {
  key: string;
  src: string;
  label: string;
  badgeClass: string;
  overlay: string | null;
}

const OPACITY_PRESETS: { label: string; value: number }[] = [
  { label: "Off", value: 0 },
  { label: "50%", value: 0.5 },
  { label: "Full", value: 1 },
];

export function MobileDiffGallery({
  baseline,
  current,
  diff,
  stepLabel,
  pixelDifference,
  className,
}: {
  baseline: string;
  current: string;
  diff: string | null;
  stepLabel: string | null;
  pixelDifference: number;
  className?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  // Diff-heatmap overlay strength. Defaults to Full so the at-a-glance view
  // matches the desktop idle state (heatmap on top).
  const [overlayOpacity, setOverlayOpacity] = useState(1);

  const frames: Frame[] = [
    {
      key: "before",
      src: baseline,
      label: "Before",
      badgeClass: "bg-background/85 text-foreground border",
      overlay: null,
    },
    {
      key: "after",
      src: current,
      label: "After",
      badgeClass: "bg-primary text-primary-foreground",
      overlay: null,
    },
  ];
  if (diff) {
    frames.push({
      key: "diff",
      src: current,
      label: "Diff",
      badgeClass: "bg-rose-500 text-white",
      overlay: diff,
    });
  }

  // Active-frame detection by nearest child centre — robust to flex gaps.
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const centre = el.scrollLeft + el.clientWidth / 2;
    let best = 0;
    let bestDist = Infinity;
    Array.from(el.children).forEach((child, i) => {
      const c = child as HTMLElement;
      const childCentre = c.offsetLeft + c.offsetWidth / 2;
      const dist = Math.abs(childCentre - centre);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    });
    setActive(best);
  }, []);

  const goTo = (i: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const child = el.children[i] as HTMLElement | undefined;
    if (child) el.scrollTo({ left: child.offsetLeft, behavior: "smooth" });
  };

  return (
    <figure className={cn("space-y-2 scroll-mt-20", className)}>
      <header className="flex items-center justify-between gap-3 text-xs">
        <span className="font-medium text-foreground truncate">
          {stepLabel || "Visual diff"}
        </span>
        {pixelDifference > 0 && (
          <span className="tabular-nums text-muted-foreground">
            {pixelDifference.toLocaleString()} px changed
          </span>
        )}
      </header>

      {/* Native horizontal scroll-snap carousel. No `touch-action` override —
          the browser routes vertical drags to the page and horizontal drags
          to the carousel, so page scroll is never trapped. */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        role="group"
        aria-roledescription="carousel"
        aria-label={
          stepLabel
            ? `${stepLabel} — before, after and diff`
            : "Before, after and diff comparison"
        }
        className="flex gap-3 overflow-x-auto snap-x snap-mandatory [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {frames.map((frame) => (
          <div
            key={frame.key}
            role="group"
            aria-roledescription="slide"
            aria-label={frame.label}
            className="relative grid min-w-full snap-center grid-cols-1 grid-rows-1 overflow-hidden rounded-md border bg-muted"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={frame.src}
              alt={frame.label}
              loading="lazy"
              decoding="async"
              draggable={false}
              className="col-start-1 row-start-1 block h-auto w-full select-none self-start"
            />
            {frame.overlay && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={frame.overlay}
                alt=""
                aria-hidden
                loading="lazy"
                decoding="async"
                draggable={false}
                style={{ opacity: overlayOpacity }}
                className="col-start-1 row-start-1 block h-auto w-full select-none self-start pointer-events-none transition-opacity duration-150"
              />
            )}

            {/* Top bar: floating label + (diff only) preset-opacity chips. Kept
                at the top so they're reachable the instant you swipe to the
                frame, even on a tall full-page screenshot. */}
            <div className="pointer-events-none absolute inset-x-2 top-2 z-10 flex items-start justify-between gap-2">
              <span
                className={cn(
                  "pointer-events-auto rounded px-2 py-0.5 text-[11px] font-medium",
                  frame.badgeClass,
                )}
              >
                {frame.label}
              </span>
              {frame.overlay && (
                <div
                  role="group"
                  aria-label="Diff overlay strength"
                  className="pointer-events-auto flex items-center gap-0.5 rounded-full border bg-background/85 p-0.5 backdrop-blur"
                >
                  {OPACITY_PRESETS.map((preset) => {
                    const selected = overlayOpacity === preset.value;
                    return (
                      <button
                        key={preset.label}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setOverlayOpacity(preset.value)}
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors",
                          selected
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Dot indicator doubles as tap-to-jump between frames. */}
      <div className="flex items-center justify-center gap-1.5">
        {frames.map((frame, i) => (
          <button
            key={frame.key}
            type="button"
            onClick={() => goTo(i)}
            aria-label={`Show ${frame.label}`}
            aria-current={active === i}
            className={cn(
              "h-1.5 rounded-full transition-all",
              active === i ? "w-4 bg-primary" : "w-1.5 bg-muted-foreground/40",
            )}
          />
        ))}
      </div>
    </figure>
  );
}
