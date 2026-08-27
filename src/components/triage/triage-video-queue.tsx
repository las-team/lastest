"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Play } from "lucide-react";
import type {
  PlayerSegment,
  VideoPlayerHandle,
} from "@/components/video-player";
import { SyncedVideoPlayer } from "@/components/playback-sync";
import { cn } from "@/lib/utils";

/**
 * One failed case's recording. The queue plays these back-to-back; it never
 * concatenates them — each is a separate file with its own clock, its own
 * step segments and its own case identity.
 */
export interface TriageClip {
  caseId: string;
  testId: string;
  title: string;
  src: string;
  posterSrc?: string | null;
  durationMs?: number | null;
  status: "failed" | "review";
  /** Per-step ticks for the annotated scrubber (the failing step is red). */
  segments?: PlayerSegment[];
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * The failure video queue on the Triage Run Results screen.
 *
 * Deliberately a **queue**, not a reel: the prototype's single "play all N
 * failures" strip is kept as the visual language (one tick per failure,
 * filled as playback advances) but each tick is a distinct recording that is
 * loaded, played and then handed off to the next one on `ended`. There is no
 * server-side stitching and no trimming to the failing moment — the header
 * copy says "N failure recordings" precisely so the strip is never read as
 * one continuous video.
 *
 * Clip duration is forwarded as `durationMsFallback`, not just as display
 * text: Playwright's webm output routinely omits the EBML duration tag, which
 * makes `video.duration` read `Infinity` and silently breaks the scrubber.
 */
export function TriageVideoQueue({
  clips,
  initialIndex = 0,
  onSelectCase,
}: {
  clips: TriageClip[];
  initialIndex?: number;
  onSelectCase?: (caseId: string) => void;
}) {
  const [index, setIndex] = useState(() =>
    Math.min(Math.max(initialIndex, 0), Math.max(clips.length - 1, 0)),
  );
  const [started, setStarted] = useState(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Clamp when the clip list shrinks under us (re-triage replaces cases).
  useEffect(() => {
    setIndex((i) => Math.min(i, Math.max(clips.length - 1, 0)));
  }, [clips.length]);

  useEffect(() => () => cleanupRef.current?.(), []);

  const total = useMemo(() => {
    let sum = 0;
    let known = 0;
    for (const c of clips) {
      if (typeof c.durationMs === "number" && Number.isFinite(c.durationMs)) {
        sum += c.durationMs;
        known++;
      }
    }
    return { sum, known };
  }, [clips]);

  const advance = useCallback(
    (delta: number) => {
      setIndex((i) => {
        const next = i + delta;
        if (next < 0 || next > clips.length - 1) return i;
        return next;
      });
    },
    [clips.length],
  );

  // Auto-advance. `onReady` fires once per mounted <video>, and the player is
  // keyed by clip index, so this attaches exactly one `ended` listener per
  // clip and tears it down when that clip unmounts.
  const handleReady = useCallback(
    (handle: VideoPlayerHandle) => {
      cleanupRef.current?.();
      const el = handle.getElement();
      if (!el) return;
      const onEnded = () => {
        setIndex((i) => (i < clips.length - 1 ? i + 1 : i));
      };
      el.addEventListener("ended", onEnded);
      cleanupRef.current = () => el.removeEventListener("ended", onEnded);
    },
    [clips.length],
  );

  if (clips.length === 0) return null;

  const current = clips[index];
  if (!current) return null;

  const headline =
    `${clips.length} failure recording${clips.length === 1 ? "" : "s"}` +
    (total.known > 0
      ? ` · ${total.known < clips.length ? "≥" : ""}${formatDuration(total.sum)} total`
      : "");

  return (
    <section className="flex flex-col gap-2" aria-label="Failure recordings">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          {headline}
        </h2>
        <span className="font-mono text-[11px] text-muted-foreground/70 tabular-nums">
          {index + 1} of {clips.length}
        </span>
      </div>

      <div className="relative overflow-hidden rounded-lg border bg-black">
        {started ? (
          <SyncedVideoPlayer
            key={`${current.caseId}:${index}`}
            src={current.src}
            poster={current.posterSrc ?? undefined}
            autoPlay
            playsInline
            preload="metadata"
            durationMsFallback={current.durationMs ?? null}
            segments={current.segments}
            onReady={handleReady}
            ariaLabel={`Recording for ${current.title}`}
            className="w-full"
            videoClassName="w-full"
          />
        ) : (
          <button
            type="button"
            onClick={() => setStarted(true)}
            className="group relative flex h-[225px] w-full items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
            aria-label={`Play ${clips.length} failure recordings, starting with ${current.title}`}
          >
            {current.posterSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={current.posterSrc}
                alt=""
                className="absolute inset-0 h-full w-full object-cover object-top opacity-55"
              />
            ) : null}
            <span className="relative flex flex-col items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white transition group-hover:bg-white/25">
                <Play className="h-4 w-4 fill-current" />
              </span>
              <span className="font-mono text-xs text-white/85">
                play {clips.length} failure recording
                {clips.length === 1 ? "" : "s"}
                {total.known > 0
                  ? ` · ${total.known < clips.length ? "≥" : ""}${formatDuration(total.sum)}`
                  : ""}
              </span>
            </span>
          </button>
        )}
      </div>

      {/* Queue rail — one tick per recording. Played ticks fill in, the
          current one is highlighted, click jumps straight to that case's
          recording. */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => advance(-1)}
          disabled={index === 0}
          aria-label="Previous recording"
          className="rounded p-0.5 text-muted-foreground transition hover:text-foreground disabled:opacity-30 disabled:hover:text-muted-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="flex flex-1 gap-[3px]" role="tablist">
          {clips.map((c, i) => (
            <button
              key={c.caseId}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`Recording ${i + 1}: ${c.title}`}
              title={c.title}
              onClick={() => {
                setIndex(i);
                setStarted(true);
              }}
              className="group flex-1 py-1.5"
            >
              <span
                className={cn(
                  "block h-[3px] w-full rounded-full transition-colors",
                  i === index
                    ? "bg-primary"
                    : i < index
                      ? "bg-primary/45"
                      : "bg-muted-foreground/25",
                  "group-hover:bg-primary/70",
                )}
              />
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => advance(1)}
          disabled={index === clips.length - 1}
          aria-label="Next recording"
          className="rounded p-0.5 text-muted-foreground transition hover:text-foreground disabled:opacity-30 disabled:hover:text-muted-foreground"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <button
        type="button"
        onClick={() => onSelectCase?.(current.caseId)}
        disabled={!onSelectCase}
        className="truncate text-left font-mono text-xs text-muted-foreground transition hover:text-foreground disabled:cursor-default disabled:hover:text-muted-foreground"
        title={onSelectCase ? `Go to ${current.title}` : current.title}
      >
        <span
          className={cn(
            "mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle",
            current.status === "failed" ? "bg-destructive" : "bg-amber-500",
          )}
        />
        {current.title}
      </button>
    </section>
  );
}
