'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';

interface ScreenshotViewerProps {
  open: boolean;
  imageSrc: string;
  planSrc: string | null;
  mode: 'captured' | 'plan';
  hasNext: boolean;
  hasPrev: boolean;
  onClose: () => void;
  onNext: () => void;
  onPrev: () => void;
  onToggleMode: () => void;
}

export function ScreenshotViewer({
  open,
  imageSrc,
  planSrc,
  mode,
  hasNext,
  hasPrev,
  onClose,
  onNext,
  onPrev,
  onToggleMode,
}: ScreenshotViewerProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // Focus the dialog so keyboard events route here on the very first press.
    dialogRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  const src = mode === 'plan' && planSrc ? planSrc : imageSrc;

  return createPortal(
    <div
      ref={dialogRef}
      tabIndex={-1}
      className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center animate-in fade-in-0 outline-none"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        } else if (e.key === 'ArrowRight' && hasNext) {
          e.preventDefault();
          onNext();
        } else if (e.key === 'ArrowLeft' && hasPrev) {
          e.preventDefault();
          onPrev();
        } else if (e.key === ' ' && planSrc) {
          e.preventDefault();
          onToggleMode();
        }
      }}
      role="dialog"
      aria-modal="true"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={mode === 'plan' ? 'Planned screenshot' : 'Captured screenshot'}
        className="max-w-[95vw] max-h-[95vh] object-contain select-none"
        onClick={(e) => e.stopPropagation()}
        draggable={false}
      />

      <button
        type="button"
        className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label="Close"
      >
        <X className="h-5 w-5" />
      </button>

      {hasPrev && (
        <button
          type="button"
          className="absolute left-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            onPrev();
          }}
          aria-label="Previous screenshot"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
      )}

      {hasNext && (
        <button
          type="button"
          className="absolute right-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            onNext();
          }}
          aria-label="Next screenshot"
        >
          <ChevronRight className="h-6 w-6" />
        </button>
      )}

      {planSrc && (
        <button
          type="button"
          className="absolute bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-white text-sm transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            onToggleMode();
          }}
        >
          {mode === 'captured' ? 'Show plan (Space)' : 'Show captured (Space)'}
        </button>
      )}
    </div>,
    document.body,
  );
}
