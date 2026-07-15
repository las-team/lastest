"use client";

import { useEffect, useRef } from "react";
import {
  VideoPlayer,
  type PlayerSegment,
  type VideoPlayerHandle,
  type VideoTextTrack,
} from "@/components/video-player";

/** Document event dispatched (throttled) with the primary clip's playback
 *  position. Detail: `{ ms: number }`. Lets server-rendered islands (e.g. the
 *  share page's ChapterRail) follow playback without a shared React context —
 *  the client-component analogue is `usePlaybackSync`. */
export const PLAYBACK_TIME_EVENT = "lastest:playback-time";

export interface ReplayClip {
  src: string;
  /**
   * Recorded duration in milliseconds (typically `test_results.duration_ms`).
   * Used as a fallback when the webm file's EBML header lacks the duration
   * tag — without it Playwright recordings report `video.duration = Infinity`
   * and the scrubber misbehaves.
   */
  durationMs?: number | null;
  /**
   * First-frame thumbnail (the test's first captured screenshot). Painted by
   * the `<video>` element while the webm buffers, so the autoplaying hero clip
   * shows a frame instead of black on load. Also serves as the
   * GSC-recommended `<video poster>` thumbnail.
   */
  poster?: string | null;
}

export interface ReplayPlayerProps {
  /**
   * One or more clips to render. Each gets its own player. The first player
   * is the seek target for `[data-seek]` clicks anywhere in the document
   * (used by the public share page's step strip; harmless on pages that
   * don't render `[data-seek]` elements).
   */
  clips: ReplayClip[];
  className?: string;
  /**
   * Subtitle tracks for the recording. Attached to the FIRST clip only (the
   * hero/primary player) — the share page's caption track describes the
   * primary test result's run.
   */
  tracks?: VideoTextTrack[];
  /**
   * Per-step scrubber segments for the FIRST clip (see PlayerSegment) —
   * derive via `resolveStepSegments` from the result's stepTimings.
   */
  segments?: PlayerSegment[];
}

/**
 * Shared replay player used by both the public share page and the in-app
 * test detail page. Wraps `<VideoPlayer>` with autoplay + loop defaults and
 * a document-level `[data-seek]` click listener that drives
 * `VideoPlayerHandle.seekAndPlay()` on the primary instance. Keeping a
 * single component means scrubber, hover-preview, and step-seek behavior
 * stay aligned across surfaces.
 */
export function ReplayPlayer({
  clips,
  className,
  tracks,
  segments,
}: ReplayPlayerProps) {
  const handlesRef = useRef<(VideoPlayerHandle | null)[]>([]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const seekEl = target?.closest("[data-seek]") as HTMLElement | null;
      if (!seekEl) return;
      const sec = parseFloat(seekEl.getAttribute("data-seek") || "");
      if (!Number.isFinite(sec)) return;
      handlesRef.current[0]?.seekAndPlay(sec);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // Broadcast the primary clip's position so sibling islands (chapter rail,
  // step strips) can highlight along without a shared React context.
  useEffect(() => {
    const el = handlesRef.current[0]?.getElement();
    if (!el) return;
    let lastDispatch = 0;
    const onTimeUpdate = () => {
      const now = performance.now();
      if (now - lastDispatch < 250) return;
      lastDispatch = now;
      document.dispatchEvent(
        new CustomEvent(PLAYBACK_TIME_EVENT, {
          detail: { ms: el.currentTime * 1000 },
        }),
      );
    };
    el.addEventListener("timeupdate", onTimeUpdate);
    return () => el.removeEventListener("timeupdate", onTimeUpdate);
  }, [clips.length]);

  return (
    <>
      {clips.map((clip, i) => (
        <VideoPlayer
          key={i}
          src={clip.src}
          poster={clip.poster ?? undefined}
          durationMsFallback={clip.durationMs ?? null}
          tracks={i === 0 ? tracks : undefined}
          captionsDefaultOn={i === 0 && !!tracks && tracks.length > 0}
          segments={i === 0 ? segments : undefined}
          autoPlay
          loop
          playsInline
          preload="metadata"
          className={
            className ??
            "share-video w-full aspect-video rounded-md border bg-black"
          }
          onReady={(h) => {
            handlesRef.current[i] = h;
          }}
        />
      ))}
    </>
  );
}
