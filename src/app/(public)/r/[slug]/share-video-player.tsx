'use client';

import { useEffect, useRef } from 'react';
import { VideoPlayer, type VideoPlayerHandle } from '@/components/video-player';

interface ShareVideoPlayerProps {
  sources: string[];
}

export function ShareVideoPlayer({ sources }: ShareVideoPlayerProps) {
  const handlesRef = useRef<(VideoPlayerHandle | null)[]>([]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const seekEl = target?.closest('[data-seek]') as HTMLElement | null;
      if (!seekEl) return;
      const sec = parseFloat(seekEl.getAttribute('data-seek') || '');
      if (!Number.isFinite(sec)) return;
      handlesRef.current[0]?.seekAndPlay(sec);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  return (
    <>
      {sources.map((src, i) => (
        <VideoPlayer
          key={i}
          src={src}
          autoPlay
          loop
          playsInline
          preload="metadata"
          className="share-video w-full aspect-video rounded-md border bg-black"
          onReady={(h) => {
            handlesRef.current[i] = h;
          }}
        />
      ))}
    </>
  );
}
