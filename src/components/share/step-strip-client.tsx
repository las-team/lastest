"use client";

import { useState } from "react";
import { Maximize2 } from "lucide-react";
import { ScreenshotViewer } from "@/components/tests/screenshot-viewer";

type Step = { src: string; label: string };

/**
 * The "N steps captured" strip on the public share page. Each thumbnail opens
 * the same fullscreen viewer the authenticated tests page uses (reused as-is;
 * with only a captured image it degrades to a plain lightbox with prev/next +
 * arrow-key/Escape nav — no plan/baseline/diff modes). Clicking a thumbnail
 * replaces the old scroll-to-slider jump.
 */
export function StepStripClient({ steps }: { steps: Step[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-muted-foreground">
        {steps.length} step{steps.length === 1 ? "" : "s"} captured
        <span className="ml-2 text-xs font-normal text-muted-foreground/70">
          · click to enlarge
        </span>
      </h2>
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {steps.map((s, i) => (
          <button
            type="button"
            key={s.src + i}
            onClick={() => setOpenIndex(i)}
            className="group relative shrink-0 w-28 rounded-md border bg-card p-1 text-left hover:border-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
            aria-label={`View step ${i + 1}: ${s.label} fullscreen`}
          >
            <div className="relative aspect-[4/3] rounded-sm bg-muted overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={s.src}
                alt=""
                loading="lazy"
                decoding="async"
                className="absolute inset-0 w-full h-full object-cover object-top"
              />
              <span className="absolute top-1 left-1 rounded bg-background/85 px-1 text-[10px] font-mono border">
                {i + 1}
              </span>
              <span className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover:bg-black/30 group-hover:opacity-100">
                <Maximize2 className="h-5 w-5 text-white drop-shadow" />
              </span>
            </div>
            <div
              className="mt-1 text-[11px] truncate text-muted-foreground group-hover:text-foreground"
              title={s.label}
            >
              {s.label}
            </div>
          </button>
        ))}
      </div>
      {openIndex != null && steps[openIndex] && (
        <ScreenshotViewer
          open
          imageSrc={steps[openIndex].src}
          planSrc={null}
          baselineSrc={null}
          diffSrc={null}
          mode="captured"
          hasNext={openIndex < steps.length - 1}
          hasPrev={openIndex > 0}
          onClose={() => setOpenIndex(null)}
          onNext={() =>
            setOpenIndex((idx) =>
              idx == null ? idx : Math.min(steps.length - 1, idx + 1),
            )
          }
          onPrev={() =>
            setOpenIndex((idx) => (idx == null ? idx : Math.max(0, idx - 1)))
          }
          onCycleMode={() => {}}
        />
      )}
    </section>
  );
}
