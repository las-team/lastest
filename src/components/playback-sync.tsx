"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import {
  VideoPlayer,
  type VideoPlayerHandle,
  type VideoPlayerProps,
} from "@/components/video-player";

// Bidirectional playback↔evidence sync bus. A mounted player publishes its
// position (video-clock ms) and evidence panes (step lists, network tables,
// perf crosshairs, chapter rails) subscribe; panes call seekTo() to drive the
// player. This is the React-side replacement for the document-level
// `[data-seek]` click pattern in replay-player.tsx — that data-attribute path
// stays for server-rendered share HTML; this bus layers on top for client
// components.

export interface PlaybackSyncApi {
  /** Player side: register the imperative handle. Returns unregister. */
  registerPlayer: (handle: VideoPlayerHandle) => () => void;
  /** Player side: publish the current position (ms). Throttled to consumers. */
  publishTime: (ms: number) => void;
  /** Pane side: seek the mounted player. play=true also starts playback. */
  seekTo: (ms: number, opts?: { play?: boolean }) => void;
  /** Pane side: subscribe to time updates (~4 Hz). Returns unsubscribe. */
  onTime: (fn: (ms: number) => void) => () => void;
  /** Last published position (ms) for late subscribers. */
  getTimeMs: () => number;
  /** True when a player is currently registered on this bus. */
  hasPlayer: () => boolean;
}

const TIME_THROTTLE_MS = 250;

const PlaybackSyncContext = createContext<PlaybackSyncApi | null>(null);

export function PlaybackSyncProvider({ children }: { children: ReactNode }) {
  const playerRef = useRef<VideoPlayerHandle | null>(null);
  const listenersRef = useRef<Set<(ms: number) => void>>(new Set());
  const lastTimeMsRef = useRef(0);
  const lastNotifyAtRef = useRef(0);

  const registerPlayer = useCallback((handle: VideoPlayerHandle) => {
    playerRef.current = handle;
    return () => {
      if (playerRef.current === handle) playerRef.current = null;
    };
  }, []);

  const publishTime = useCallback((ms: number) => {
    lastTimeMsRef.current = ms;
    const now = performance.now();
    if (now - lastNotifyAtRef.current < TIME_THROTTLE_MS) return;
    lastNotifyAtRef.current = now;
    listenersRef.current.forEach((fn) => fn(ms));
  }, []);

  const seekTo = useCallback((ms: number, opts?: { play?: boolean }) => {
    const player = playerRef.current;
    if (!player) return;
    const seconds = ms / 1000;
    if (opts?.play) void player.seekAndPlay(seconds);
    else player.seek(seconds);
    // Reflect the jump to subscribers immediately — a paused seek fires no
    // timeupdate until the next play.
    lastTimeMsRef.current = ms;
    listenersRef.current.forEach((fn) => fn(ms));
  }, []);

  const onTime = useCallback((fn: (ms: number) => void) => {
    listenersRef.current.add(fn);
    return () => {
      listenersRef.current.delete(fn);
    };
  }, []);

  const api = useMemo<PlaybackSyncApi>(
    () => ({
      registerPlayer,
      publishTime,
      seekTo,
      onTime,
      getTimeMs: () => lastTimeMsRef.current,
      hasPlayer: () => playerRef.current !== null,
    }),
    [registerPlayer, publishTime, seekTo, onTime],
  );

  return (
    <PlaybackSyncContext.Provider value={api}>
      {children}
    </PlaybackSyncContext.Provider>
  );
}

/** Null outside a provider so surfaces without sync render unchanged. */
export function usePlaybackSync(): PlaybackSyncApi | null {
  return useContext(PlaybackSyncContext);
}

/**
 * VideoPlayer wired into the enclosing PlaybackSyncProvider: registers its
 * handle for seekTo() and publishes timeupdate positions. Renders a plain
 * VideoPlayer when no provider is mounted.
 */
export function SyncedVideoPlayer(props: VideoPlayerProps) {
  const sync = usePlaybackSync();
  const cleanupRef = useRef<(() => void) | null>(null);
  const { onReady, ...rest } = props;

  useEffect(() => () => cleanupRef.current?.(), []);

  const handleReady = useCallback(
    (handle: VideoPlayerHandle) => {
      onReady?.(handle);
      if (!sync) return;
      cleanupRef.current?.();
      const unregister = sync.registerPlayer(handle);
      const el = handle.getElement();
      const onTimeUpdate = () => {
        const v = handle.getElement();
        if (v) sync.publishTime(v.currentTime * 1000);
      };
      el?.addEventListener("timeupdate", onTimeUpdate);
      cleanupRef.current = () => {
        el?.removeEventListener("timeupdate", onTimeUpdate);
        unregister();
      };
    },
    [onReady, sync],
  );

  return <VideoPlayer {...rest} onReady={handleReady} />;
}
