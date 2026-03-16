'use client';

import { useState, useRef, useEffect } from 'react';
import Image from 'next/image';

interface DiagramThumbnailProps {
  src: string;
  alt: string;
  width: number;
  height: number;
  className?: string;
}

export function DiagramThumbnail({ src, alt, width, height, className }: DiagramThumbnailProps) {
  const [expanded, setExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!expanded) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setExpanded(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [expanded]);

  return (
    <>
      <div
        ref={containerRef}
        className={`group relative inline-block cursor-pointer ${className ?? ''}`}
        onClick={() => setExpanded(true)}
      >
        <Image
          src={src}
          alt={alt}
          width={width}
          height={height}
          className="rounded border border-border/50 opacity-80 transition-opacity hover:opacity-100"
        />
        <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-xs text-muted-foreground bg-background/60 rounded">
          Click to expand
        </span>
      </div>

      {expanded && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setExpanded(false)}
        >
          <div
            className="relative max-w-[90vw] max-h-[90vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <Image
              src={src}
              alt={alt}
              width={width * 3}
              height={height * 3}
              className="rounded-lg shadow-2xl"
              quality={100}
            />
            <button
              onClick={() => setExpanded(false)}
              className="absolute top-2 right-2 w-8 h-8 rounded-full bg-background/80 flex items-center justify-center text-foreground hover:bg-background transition-colors"
            >
              &times;
            </button>
          </div>
        </div>
      )}
    </>
  );
}
