"use client";

import { useEffect, useRef } from "react";
import { VideoPlayer, type VideoPlayerHandle } from "@/components/video-player";

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
}

/**
 * Shared replay player used by both the public share page and the in-app
 * test detail page. Wraps `<VideoPlayer>` with autoplay + loop defaults and
 * a document-level `[data-seek]` click listener that drives
 * `VideoPlayerHandle.seekAndPlay()` on the primary instance. Keeping a
 * single component means scrubber, hover-preview, and step-seek behavior
 * stay aligned across surfaces.
 */
export function ReplayPlayer({ clips, className }: ReplayPlayerProps) {
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

  return (
    <>
      {clips.map((clip, i) => (
        <VideoPlayer
          key={i}
          src={clip.src}
          poster={clip.poster ?? undefined}
          durationMsFallback={clip.durationMs ?? null}
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
