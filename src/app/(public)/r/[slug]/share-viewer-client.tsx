'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

interface ShareViewerClientProps {
  heroBaseline: string | null;
  heroCurrent: string | null;
  heroDiff: string | null;
  heroScreenshot: string | null;
  videoUrl: string | null;
  gallery: Array<{ src: string; label: string }>;
  claimLink: string;
}

type HeroView = 'slider' | 'diff' | 'current' | 'baseline';

export function ShareViewerClient({
  heroBaseline,
  heroCurrent,
  heroDiff,
  heroScreenshot,
  videoUrl,
  gallery,
  claimLink,
}: ShareViewerClientProps) {
  const hasBothSides = !!heroBaseline && !!heroCurrent;
  const [view, setView] = useState<HeroView>(hasBothSides ? 'slider' : 'current');
  const [lightbox, setLightbox] = useState<string | null>(null);

  return (
    <>
      <section className="space-y-3">
        {hasBothSides ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold text-lg">Visual change</h2>
              <div className="inline-flex rounded-md border border-border overflow-hidden text-xs">
                <ViewToggle label="Slider" active={view === 'slider'} onClick={() => setView('slider')} />
                <ViewToggle label="After" active={view === 'current'} onClick={() => setView('current')} />
                <ViewToggle label="Before" active={view === 'baseline'} onClick={() => setView('baseline')} />
                {heroDiff && (
                  <ViewToggle label="Diff" active={view === 'diff'} onClick={() => setView('diff')} />
                )}
              </div>
            </div>
            {view === 'slider' && (
              <BeforeAfterSlider baseline={heroBaseline!} current={heroCurrent!} />
            )}
            {view === 'current' && <ImageFrame src={heroCurrent!} label="After" />}
            {view === 'baseline' && <ImageFrame src={heroBaseline!} label="Before" />}
            {view === 'diff' && heroDiff && <ImageFrame src={heroDiff} label="Diff" />}
          </>
        ) : heroScreenshot ? (
          <>
            <h2 className="font-semibold text-lg">Latest render</h2>
            <ImageFrame src={heroScreenshot} label="Captured page" />
          </>
        ) : (
          <div className="rounded-xl border border-dashed border-border p-12 text-center text-muted-foreground">
            No screenshots captured.
          </div>
        )}
      </section>

      {videoUrl && (
        <section className="space-y-3">
          <h2 className="font-semibold text-lg">Test recording</h2>
          <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
            {/* eslint-disable-next-line @next/next/no-sync-scripts */}
            <video
              src={videoUrl}
              controls
              playsInline
              muted
              preload="metadata"
              className="w-full max-h-[80vh] bg-black"
            />
          </div>
        </section>
      )}

      {gallery.length > 1 && (
        <section className="space-y-3">
          <h2 className="font-semibold text-lg">All screenshots</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {gallery.map((g, i) => (
              <button
                type="button"
                key={i}
                onClick={() => setLightbox(g.src)}
                className="group relative aspect-[4/3] overflow-hidden rounded-lg border border-border bg-card hover:border-primary/50 transition-colors"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={g.src}
                  alt={g.label}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover object-top group-hover:scale-[1.02] transition-transform"
                />
                <span className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent text-white text-[10px] font-medium px-2 py-1 truncate">
                  {g.label}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}

      {/* Sticky mobile CTA */}
      <div className="sm:hidden fixed inset-x-0 bottom-0 z-30 p-3 bg-background/95 backdrop-blur border-t border-border shadow-lg">
        <a
          href={claimLink}
          className="flex items-center justify-center rounded-md bg-primary text-primary-foreground font-semibold px-5 py-3 hover:bg-primary/90"
        >
          Claim this test — free
        </a>
      </div>
    </>
  );
}

function ViewToggle({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 transition-colors ${
        active ? 'bg-foreground text-background' : 'bg-background text-muted-foreground hover:bg-muted'
      }`}
    >
      {label}
    </button>
  );
}

function ImageFrame({ src, label }: { src: string; label: string }) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={label} className="w-full max-h-[80vh] object-contain bg-[color:oklch(0.97_0_0)]" />
    </div>
  );
}

function BeforeAfterSlider({ baseline, current }: { baseline: string; current: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pct, setPct] = useState(50);
  const [width, setWidth] = useState<number | null>(null);
  const dragging = useRef(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setWidth(el.getBoundingClientRect().width);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const setFromClientX = useCallback((clientX: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ratio = ((clientX - rect.left) / rect.width) * 100;
    setPct(Math.max(0, Math.min(100, ratio)));
  }, []);

  useEffect(() => {
    function onMove(e: PointerEvent) {
      if (!dragging.current) return;
      setFromClientX(e.clientX);
    }
    function onUp() {
      dragging.current = false;
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [setFromClientX]);

  return (
    <div
      ref={containerRef}
      className="relative rounded-xl border border-border bg-card overflow-hidden select-none shadow-sm"
      onPointerDown={(e) => {
        dragging.current = true;
        setFromClientX(e.clientX);
      }}
    >
      {/* After (current) — full */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={current} alt="After" className="w-full max-h-[80vh] object-contain bg-[color:oklch(0.97_0_0)]" />
      {/* Before (baseline) — clipped to left */}
      <div
        className="absolute inset-0 overflow-hidden pointer-events-none"
        style={{ width: `${pct}%` }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={baseline}
          alt="Before"
          className="max-h-[80vh] object-contain bg-[color:oklch(0.97_0_0)] absolute top-0 left-0"
          style={{ width: width ? `${width}px` : '100%' }}
        />
      </div>
      {/* Handle */}
      <div
        className="absolute top-0 bottom-0 w-px bg-primary shadow-[0_0_0_1px_oklch(1_0_0)] pointer-events-none"
        style={{ left: `${pct}%` }}
      >
        <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 flex items-center justify-center w-9 h-9 rounded-full bg-primary text-primary-foreground shadow-md ring-2 ring-background">
          <span className="text-xs font-semibold">↔</span>
        </div>
      </div>
      {/* Labels */}
      <span className="absolute top-3 left-3 text-[10px] font-semibold tracking-wider uppercase px-2 py-0.5 rounded bg-background/90 border border-border">
        Before
      </span>
      <span className="absolute top-3 right-3 text-[10px] font-semibold tracking-wider uppercase px-2 py-0.5 rounded bg-background/90 border border-border">
        After
      </span>
    </div>
  );
}

function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" className="max-w-full max-h-full object-contain" />
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 rounded-md bg-background/90 border border-border px-3 py-1.5 text-sm"
      >
        Close
      </button>
    </div>
  );
}
