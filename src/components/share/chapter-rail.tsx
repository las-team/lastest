"use client";

import { useEffect, useRef, useState } from "react";
import { Maximize2, Play } from "lucide-react";
import { ScreenshotViewer } from "@/components/tests/screenshot-viewer";
import { PLAYBACK_TIME_EVENT } from "@/components/replay-player";

export type Chapter = {
  src: string;
  label: string;
  /** Offset into the recording, in seconds. null when unknown (no seek). */
  atSec: number | null;
};

function formatTime(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * The "In this video" chapter rail on the public share page — the Pageflows-style
 * pairing of the recording with a labelled, timestamped list of each captured
 * step. Clicking a chapter seeks the recording to that moment: each seek target
 * carries a `data-seek="<seconds>"` attribute that the page's <ReplayPlayer>
 * picks up via a document-level click listener (so the seek needs no wiring
 * here — the player owns it). A separate enlarge button opens the same
 * fullscreen viewer the in-app tests page uses.
 *
 * Replaces the old "N steps captured" strip: same thumbnails, now with
 * timecodes + click-to-seek.
 */
export function ChapterRail({ chapters }: { chapters: Chapter[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  // Chapter containing the current playback position (ReplayPlayer broadcasts
  // it as a document event — see PLAYBACK_TIME_EVENT). null until playback.
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const listRef = useRef<HTMLOListElement | null>(null);
  const userScrolledAtRef = useRef(0);
  const programmaticScrollAtRef = useRef(0);

  useEffect(() => {
    if (openIndex == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenIndex(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openIndex]);

  useEffect(() => {
    const onTime = (e: Event) => {
      const ms = (e as CustomEvent<{ ms: number }>).detail?.ms;
      if (!Number.isFinite(ms)) return;
      const sec = ms / 1000;
      let idx: number | null = null;
      for (let i = 0; i < chapters.length; i++) {
        const at = chapters[i]!.atSec;
        if (at != null && at <= sec) idx = i;
      }
      setActiveIndex(idx);
    };
    document.addEventListener(PLAYBACK_TIME_EVENT, onTime);
    return () => document.removeEventListener(PLAYBACK_TIME_EVENT, onTime);
  }, [chapters]);

  // Follow playback with a horizontal scroll — but yield to the user for a
  // few seconds after they scroll the rail themselves.
  useEffect(() => {
    if (activeIndex == null) return;
    if (performance.now() - userScrolledAtRef.current < 4000) return;
    const el = listRef.current?.children[activeIndex] as
      | HTMLElement
      | undefined;
    if (el) {
      programmaticScrollAtRef.current = performance.now();
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [activeIndex]);

  if (chapters.length === 0) return null;
  const anySeekable = chapters.some((c) => c.atSec != null);

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-muted-foreground">
        In this video
        <span className="ml-2 text-xs font-normal text-muted-foreground/70">
          {anySeekable ? "· click a step to jump to it" : "· click to enlarge"}
        </span>
      </h2>
      <ol
        ref={listRef}
        onScroll={() => {
          // scrollIntoView also fires onScroll — only count human scrolls.
          if (performance.now() - programmaticScrollAtRef.current > 300) {
            userScrolledAtRef.current = performance.now();
          }
        }}
        className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1"
      >
        {chapters.map((c, i) => {
          const seekable = c.atSec != null;
          const isActive = i === activeIndex;
          return (
            <li key={c.src + i} className="shrink-0">
              <div
                className={
                  "group relative w-40 rounded-md border bg-card p-1 transition-shadow" +
                  (isActive ? " border-primary/60 ring-2 ring-primary/40" : "")
                }
              >
                {/* Seek target — carries data-seek so <ReplayPlayer> seeks the
                    recording on click. Falls back to opening the lightbox when
                    the chapter has no known offset. */}
                <button
                  type="button"
                  {...(seekable
                    ? { "data-seek": String(c.atSec) }
                    : { onClick: () => setOpenIndex(i) })}
                  className="block w-full text-left focus:outline-none focus:ring-2 focus:ring-primary/50 rounded-sm"
                  aria-label={
                    seekable
                      ? `Jump to ${c.label} at ${formatTime(c.atSec as number)}`
                      : `View ${c.label}`
                  }
                >
                  <div className="relative aspect-[4/3] rounded-sm bg-muted overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={c.src}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="absolute inset-0 w-full h-full object-cover object-top"
                    />
                    <span className="absolute top-1 left-1 rounded bg-background/85 px-1 text-[10px] font-mono border">
                      {i + 1}
                    </span>
                    {seekable && (
                      <span className="absolute bottom-1 right-1 inline-flex items-center gap-0.5 rounded bg-black/75 text-white px-1 text-[10px] font-mono tabular-nums">
                        <Play className="h-2.5 w-2.5 fill-current" />
                        {formatTime(c.atSec as number)}
                      </span>
                    )}
                    {seekable && (
                      <span className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover:bg-black/25 group-hover:opacity-100">
                        <Play className="h-6 w-6 text-white drop-shadow fill-current" />
                      </span>
                    )}
                  </div>
                  <div
                    className="mt-1 text-[11px] truncate text-muted-foreground group-hover:text-foreground"
                    title={c.label}
                  >
                    {c.label}
                  </div>
                </button>
                {/* Enlarge → fullscreen viewer (sibling button, not nested).
                    Always visible (not hover-gated) so the fullscreen
                    affordance is discoverable on desktop and on touch, where
                    there's no hover. */}
                <button
                  type="button"
                  onClick={() => setOpenIndex(i)}
                  aria-label={`View ${c.label} fullscreen`}
                  className="absolute top-1 right-1 rounded-md bg-background/90 border shadow-sm p-1 text-foreground/80 transition hover:bg-background hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  <Maximize2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          );
        })}
      </ol>
      {openIndex != null && chapters[openIndex] && (
        <ScreenshotViewer
          open
          imageSrc={chapters[openIndex].src}
          planSrc={null}
          baselineSrc={null}
          diffSrc={null}
          mode="captured"
          hasNext={openIndex < chapters.length - 1}
          hasPrev={openIndex > 0}
          onClose={() => setOpenIndex(null)}
          onNext={() =>
            setOpenIndex((idx) =>
              idx == null ? idx : Math.min(chapters.length - 1, idx + 1),
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
