'use client';

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import * as SliderPrimitive from '@radix-ui/react-slider';
import {
  Check,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

const RATE_OPTIONS = [0.5, 1, 1.5, 2, 3, 4] as const;
const VOLUME_KEY = 'lastest:videoplayer:volume';
const MUTED_KEY = 'lastest:videoplayer:muted';

export interface VideoPlayerHandle {
  play: () => Promise<void>;
  pause: () => void;
  seek: (seconds: number) => void;
  seekAndPlay: (seconds: number) => Promise<void>;
  getElement: () => HTMLVideoElement | null;
}

export interface VideoPlayerProps {
  src: string;
  className?: string;
  videoClassName?: string;
  poster?: string;
  defaultPlaybackRate?: number;
  autoPlay?: boolean;
  loop?: boolean;
  muted?: boolean;
  playsInline?: boolean;
  preload?: 'none' | 'metadata' | 'auto';
  controlsTimeoutMs?: number;
  onReady?: (handle: VideoPlayerHandle) => void;
  ariaLabel?: string;
}

function formatTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const total = Math.floor(s);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}

function computeBufferedEnd(video: HTMLVideoElement, currentTime: number): number {
  for (let i = 0; i < video.buffered.length; i++) {
    if (video.buffered.start(i) <= currentTime && video.buffered.end(i) >= currentTime) {
      return video.buffered.end(i);
    }
  }
  return 0;
}

function formatRate(rate: number): string {
  return `${rate}x`;
}

export const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(function VideoPlayer(
  {
    src,
    className,
    videoClassName,
    poster,
    defaultPlaybackRate = 2,
    autoPlay = false,
    loop = false,
    muted: mutedProp,
    playsInline = true,
    preload = 'metadata',
    controlsTimeoutMs = 2200,
    onReady,
    ariaLabel,
  },
  ref,
) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrubberRef = useRef<HTMLDivElement | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const wasPlayingBeforeScrubRef = useRef(false);
  const latestPreviewTimeRef = useRef<number | null>(null);
  const previewSeekRafRef = useRef<number | null>(null);
  const onReadyRef = useRef(onReady);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [volume, setVolume] = useState(1);
  const initialMuted = mutedProp ?? true;
  const [muted, setMuted] = useState(initialMuted);
  const [playbackRate, setPlaybackRate] = useState(defaultPlaybackRate);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [hoverPreview, setHoverPreview] = useState<{ x: number; time: number; ready: boolean } | null>(null);
  const [scrubberWidth, setScrubberWidth] = useState(0);

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    try {
      const v = window.localStorage.getItem(VOLUME_KEY);
      if (v !== null) {
        const n = parseFloat(v);
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (Number.isFinite(n)) setVolume(clamp(n, 0, 1));
      }
      if (mutedProp === undefined) {
        const m = window.localStorage.getItem(MUTED_KEY);
        if (m !== null) setMuted(m === '1');
      }
    } catch {
      // localStorage unavailable; fall back to defaults.
    }
  }, [mutedProp]);

  useEffect(() => {
    const v = videoRef.current;
    if (v) {
      v.volume = volume;
      v.muted = muted;
    }
    try {
      window.localStorage.setItem(VOLUME_KEY, String(volume));
      window.localStorage.setItem(MUTED_KEY, muted ? '1' : '0');
    } catch {
      // noop
    }
  }, [volume, muted]);

  useEffect(() => {
    const v = videoRef.current;
    if (v) v.playbackRate = playbackRate;
  }, [playbackRate]);

  const handle = useMemo<VideoPlayerHandle>(
    () => ({
      play: () => videoRef.current?.play() ?? Promise.resolve(),
      pause: () => {
        videoRef.current?.pause();
      },
      seek: (s) => {
        const v = videoRef.current;
        if (!v) return;
        v.currentTime = clamp(s, 0, Number.isFinite(v.duration) ? v.duration : s);
      },
      seekAndPlay: async (s) => {
        const v = videoRef.current;
        if (!v) return;
        v.currentTime = clamp(s, 0, Number.isFinite(v.duration) ? v.duration : s);
        try {
          await v.play();
        } catch {
          // autoplay rejection is fine here.
        }
      },
      getElement: () => videoRef.current,
    }),
    [],
  );

  useImperativeHandle(ref, () => handle, [handle]);

  useEffect(() => {
    onReadyRef.current?.(handle);
  }, [handle]);

  const scheduleHide = useCallback(() => {
    if (hideTimerRef.current != null) {
      window.clearTimeout(hideTimerRef.current);
    }
    hideTimerRef.current = window.setTimeout(() => {
      const v = videoRef.current;
      if (v && !v.paused) {
        setControlsVisible(false);
      }
    }, controlsTimeoutMs);
  }, [controlsTimeoutMs]);

  const wakeControls = useCallback(() => {
    setControlsVisible(true);
    scheduleHide();
  }, [scheduleHide]);

  useEffect(() => {
    return () => {
      if (hideTimerRef.current != null) window.clearTimeout(hideTimerRef.current);
      if (previewSeekRafRef.current != null) cancelAnimationFrame(previewSeekRafRef.current);
    };
  }, []);

  useEffect(() => {
    const onChange = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    let raf: number | null = null;
    const flush = () => {
      raf = null;
      setCurrentTime(v.currentTime);
      setBufferedEnd(computeBufferedEnd(v, v.currentTime));
    };
    const schedule = () => {
      if (raf == null) raf = window.requestAnimationFrame(flush);
    };
    const onPlay = () => {
      setIsPlaying(true);
      scheduleHide();
    };
    const onPause = () => {
      setIsPlaying(false);
      setControlsVisible(true);
    };
    const onEnded = () => {
      setIsPlaying(false);
      setControlsVisible(true);
    };
    const onMeta = () => {
      setDuration(Number.isFinite(v.duration) ? v.duration : 0);
      v.playbackRate = playbackRate;
    };

    v.addEventListener('timeupdate', schedule);
    v.addEventListener('progress', schedule);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('ended', onEnded);
    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('durationchange', onMeta);
    return () => {
      v.removeEventListener('timeupdate', schedule);
      v.removeEventListener('progress', schedule);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('ended', onEnded);
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('durationchange', onMeta);
      if (raf != null) cancelAnimationFrame(raf);
    };
  }, [playbackRate, scheduleHide]);

  useEffect(() => {
    const pv = previewVideoRef.current;
    if (!pv) return;
    pv.load();
    const onSeeked = () => {
      setHoverPreview((prev) => (prev ? { ...prev, ready: true } : prev));
      const target = latestPreviewTimeRef.current;
      if (target != null && Math.abs(pv.currentTime - target) > 0.05) {
        try {
          pv.currentTime = target;
        } catch {
          // ignore
        }
      }
    };
    pv.addEventListener('seeked', onSeeked);
    return () => pv.removeEventListener('seeked', onSeeked);
  }, [src]);

  useEffect(() => {
    const el = scrubberRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      setScrubberWidth(el.clientWidth);
    });
    ro.observe(el);
    setScrubberWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const seekFromClientX = useCallback(
    (clientX: number): number | null => {
      const v = videoRef.current;
      if (!v) return null;
      const rect = scrubberRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return null;
      const dur = Number.isFinite(v.duration) ? v.duration : duration;
      if (!dur || dur <= 0) return null;
      const x = clamp(clientX - rect.left, 0, rect.width);
      const t = (x / rect.width) * dur;
      v.currentTime = t;
      setCurrentTime(t);
      return t;
    },
    [duration],
  );

  const onScrubberPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!duration) return;
      const rect = scrubberRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return;
      const x = clamp(e.clientX - rect.left, 0, rect.width);
      const t = (x / rect.width) * duration;
      setHoverPreview((prev) => ({ x, time: t, ready: prev?.ready ?? false }));
      latestPreviewTimeRef.current = t;
      if (isScrubbing) {
        const v = videoRef.current;
        if (v) {
          v.currentTime = t;
          setCurrentTime(t);
        }
      }
      if (previewSeekRafRef.current == null) {
        previewSeekRafRef.current = window.requestAnimationFrame(() => {
          previewSeekRafRef.current = null;
          const target = latestPreviewTimeRef.current;
          const pv = previewVideoRef.current;
          if (target == null || !pv) return;
          try {
            pv.currentTime = target;
          } catch {
            // ignore
          }
        });
      }
    },
    [duration, isScrubbing],
  );

  const onScrubberPointerLeave = useCallback(() => {
    setHoverPreview(null);
    latestPreviewTimeRef.current = null;
    if (previewSeekRafRef.current != null) {
      cancelAnimationFrame(previewSeekRafRef.current);
      previewSeekRafRef.current = null;
    }
  }, []);

  const onScrubberPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const v = videoRef.current;
      if (!v) return;
      wasPlayingBeforeScrubRef.current = !v.paused;
      if (!v.paused) v.pause();
      setIsScrubbing(true);
      seekFromClientX(e.clientX);
    },
    [seekFromClientX],
  );

  useEffect(() => {
    if (!isScrubbing) return;
    const onUp = () => {
      setIsScrubbing(false);
      if (wasPlayingBeforeScrubRef.current) {
        videoRef.current?.play().catch(() => {});
      }
    };
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [isScrubbing]);

  const onSliderValueChange = useCallback((val: number[]) => {
    const v = videoRef.current;
    if (!v) return;
    const t = val[0] ?? 0;
    v.currentTime = t;
    setCurrentTime(t);
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((m) => !m);
  }, []);

  const skip = useCallback((delta: number) => {
    const v = videoRef.current;
    if (!v) return;
    const max = Number.isFinite(v.duration) ? v.duration : v.currentTime + delta;
    v.currentTime = clamp(v.currentTime + delta, 0, max);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement === el) {
      document.exitFullscreen?.().catch(() => {});
    } else {
      el.requestFullscreen?.().catch(() => {});
    }
  }, []);

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      const v = videoRef.current;
      if (!v) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          skip(-5);
          break;
        case 'ArrowRight':
          e.preventDefault();
          skip(5);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setMuted(false);
          setVolume((x) => clamp(x + 0.1, 0, 1));
          break;
        case 'ArrowDown':
          e.preventDefault();
          setVolume((x) => clamp(x - 0.1, 0, 1));
          break;
        case 'm':
        case 'M':
          e.preventDefault();
          toggleMute();
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          toggleFullscreen();
          break;
        default:
          if (e.key >= '0' && e.key <= '9' && Number.isFinite(v.duration)) {
            e.preventDefault();
            const pct = parseInt(e.key, 10) / 10;
            v.currentTime = v.duration * pct;
          }
      }
      wakeControls();
    },
    [skip, toggleFullscreen, toggleMute, togglePlay, wakeControls],
  );

  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const showControls = !isPlaying || isScrubbing || controlsVisible;
  const previewWidth = 160;
  const previewLeftRaw = (hoverPreview?.x ?? 0) - previewWidth / 2;
  const previewLeft = clamp(previewLeftRaw, 0, Math.max(0, scrubberWidth - previewWidth));
  const safeDuration = duration > 0 ? duration : 0;
  const bufferedPct = safeDuration > 0 ? clamp((bufferedEnd / safeDuration) * 100, 0, 100) : 0;

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      role="region"
      aria-label={ariaLabel ?? 'Video player'}
      data-visible={showControls ? 'true' : 'false'}
      onKeyDown={onKeyDown}
      onPointerMove={wakeControls}
      onPointerLeave={() => {
        if (videoRef.current && !videoRef.current.paused && !isScrubbing) {
          setControlsVisible(false);
        }
      }}
      className={cn(
        'group/player relative isolate overflow-hidden rounded-md bg-black outline-none focus-visible:ring-2 focus-visible:ring-primary',
        className,
      )}
    >
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        autoPlay={autoPlay}
        loop={loop}
        playsInline={playsInline}
        preload={preload}
        muted={muted}
        onClick={togglePlay}
        className={cn('block h-full w-full object-contain', videoClassName)}
      />

      {!isPlaying && duration > 0 && (
        <button
          type="button"
          onClick={togglePlay}
          aria-label="Play"
          className="absolute inset-0 m-auto flex h-16 w-16 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.25),0_4px_24px_-4px_rgba(0,0,0,0.5)] backdrop-blur-xl backdrop-saturate-150 transition-transform hover:scale-105"
        >
          <Play className="h-7 w-7 translate-x-0.5 fill-current" />
        </button>
      )}

      <div
        data-visible={showControls ? 'true' : 'false'}
        className={cn(
          'pointer-events-auto absolute inset-x-2 bottom-2 flex flex-col gap-2 rounded-xl px-3 py-2',
          'border border-white/20 bg-black/40 ring-1 ring-black/10',
          'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.25),0_4px_24px_-4px_rgba(0,0,0,0.5)]',
          'backdrop-blur-xl backdrop-saturate-150',
          'text-white text-xs [text-shadow:0_1px_2px_rgba(0,0,0,0.5)]',
          'transition-all duration-150',
          'data-[visible=false]:pointer-events-none data-[visible=false]:translate-y-2 data-[visible=false]:opacity-0',
          'data-[visible=true]:translate-y-0 data-[visible=true]:opacity-100',
        )}
      >
        <div
          ref={scrubberRef}
          className="relative flex h-4 items-center"
          onPointerMove={onScrubberPointerMove}
          onPointerLeave={onScrubberPointerLeave}
          onPointerDown={onScrubberPointerDown}
        >
          {/* Single preview video, always mounted so its decoder stays warm. */}
          <div
            className={cn(
              'pointer-events-none absolute z-10 flex flex-col items-center gap-1 transition-opacity duration-100',
              hoverPreview && safeDuration > 0 ? 'opacity-100' : 'opacity-0',
            )}
            style={{ left: previewLeft, bottom: 'calc(100% + 8px)' }}
          >
            <div className="overflow-hidden rounded-md border border-white/15 bg-black/80 shadow-lg backdrop-blur-md backdrop-saturate-150">
              <video
                ref={previewVideoRef}
                src={src}
                muted
                playsInline
                preload="auto"
                aria-hidden="true"
                className={cn(
                  'block h-[90px] w-[160px] object-cover transition-opacity duration-100',
                  hoverPreview?.ready ? 'opacity-100' : 'opacity-40',
                )}
              />
            </div>
            <span className="rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-white">
              {formatTime(hoverPreview?.time ?? 0)}
            </span>
          </div>

          <SliderPrimitive.Root
            min={0}
            max={safeDuration || 1}
            step={0.05}
            value={[clamp(currentTime, 0, safeDuration || 1)]}
            onValueChange={onSliderValueChange}
            disabled={safeDuration === 0}
            className="relative flex h-4 w-full grow touch-none select-none items-center"
          >
            <SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden rounded-full bg-white/20">
              <div
                className="absolute h-full bg-white/30"
                style={{ width: `${bufferedPct}%` }}
              />
              <SliderPrimitive.Range className="absolute h-full bg-white" />
            </SliderPrimitive.Track>
            <SliderPrimitive.Thumb className="block h-3 w-3 rounded-full bg-white shadow-md outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-white/50 data-[disabled]:opacity-0" />
          </SliderPrimitive.Root>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={togglePlay}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            className="flex h-7 w-7 items-center justify-center rounded-md text-white transition-colors hover:bg-white/15"
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={() => skip(-10)}
            aria-label="Back 10 seconds"
            className="flex h-7 w-7 items-center justify-center rounded-md text-white transition-colors hover:bg-white/15"
          >
            <SkipBack className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => skip(10)}
            aria-label="Forward 10 seconds"
            className="flex h-7 w-7 items-center justify-center rounded-md text-white transition-colors hover:bg-white/15"
          >
            <SkipForward className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={toggleMute}
            aria-label={muted ? 'Unmute' : 'Mute'}
            title={muted ? 'Unmute' : 'Mute'}
            className="flex h-7 w-7 items-center justify-center rounded-md text-white transition-colors hover:bg-white/15"
          >
            <VolumeIcon className="h-4 w-4" />
          </button>

          <span className="ml-1 font-mono tabular-nums text-[11px] opacity-80">
            {formatTime(currentTime)} / {formatTime(safeDuration)}
          </span>

          <div className="flex-1" />

          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={`Playback speed: ${formatRate(playbackRate)}`}
                className="flex h-6 items-center rounded-full border border-white/15 bg-white/15 px-2.5 font-mono text-[11px] tabular-nums text-white transition-colors hover:bg-white/25"
              >
                {formatRate(playbackRate)}
              </button>
            </PopoverTrigger>
            <PopoverContent
              side="top"
              align="end"
              className="w-auto min-w-0 border-white/15 bg-black/70 p-1 text-white shadow-xl backdrop-blur-xl backdrop-saturate-150"
            >
              <ul className="flex min-w-[88px] flex-col">
                {RATE_OPTIONS.map((rate) => {
                  const active = rate === playbackRate;
                  return (
                    <li key={rate}>
                      <button
                        type="button"
                        onClick={() => setPlaybackRate(rate)}
                        className={cn(
                          'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left font-mono text-[11px] tabular-nums transition-colors hover:bg-white/15',
                          active && 'font-semibold',
                        )}
                      >
                        <span>{formatRate(rate)}</span>
                        {active ? <Check className="h-3 w-3" /> : <span className="h-3 w-3" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </PopoverContent>
          </Popover>

          <button
            type="button"
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            className="flex h-7 w-7 items-center justify-center rounded-md text-white transition-colors hover:bg-white/15"
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
});
