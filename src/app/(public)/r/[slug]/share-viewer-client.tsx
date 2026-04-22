'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';

export interface ClientDiff {
  id: string;
  stepLabel: string | null;
  baseline: string | null;
  current: string | null;
  diff: string | null;
  pixelDifference: number;
  percentageDifference: string | null;
  classification: string | null;
  status: string | null;
  testResultStatus: string | null;
}

export interface ClientTestGroup {
  testId: string;
  testName: string;
  diffs: ClientDiff[];
}

export interface ShareViewerProps {
  videos: Array<{ src: string; testName: string; durationMs: number | null }>;
  testGroups: ClientTestGroup[];
  catalog: Array<{ src: string; label: string; testName: string }>;
  claimLink: string;
  signInLink: string;
  domain: string;
}

type LightboxPayload =
  | { kind: 'image'; src: string }
  | { kind: 'compare'; baseline: string; current: string; diff: string | null; testName: string; stepLabel: string | null };

export function ShareViewer({
  videos,
  testGroups,
  catalog,
  claimLink,
  domain,
}: ShareViewerProps) {
  const [lightbox, setLightbox] = useState<LightboxPayload | null>(null);

  const totalDiffs = useMemo(
    () => testGroups.reduce((acc, g) => acc + g.diffs.length, 0),
    [testGroups],
  );
  const changedCount = useMemo(
    () =>
      testGroups.reduce(
        (acc, g) =>
          acc +
          g.diffs.filter(
            (d) => d.classification === 'changed' || (d.pixelDifference ?? 0) > 0,
          ).length,
        0,
      ),
    [testGroups],
  );

  return (
    <>
      {/* Video evidence */}
      {videos.length > 0 && (
        <section className="mt-14 sm:mt-20">
          <SectionHeader index="01" label="Evidence tape" aside={`${videos.length} ${videos.length === 1 ? 'recording' : 'recordings'}`} />
          <div className="mt-4 space-y-6">
            {videos.map((v, i) => (
              <VideoEvidence
                key={i}
                src={v.src}
                testName={v.testName}
                durationMs={v.durationMs}
                autoplay={i === 0}
                domain={domain}
              />
            ))}
          </div>
        </section>
      )}

      {/* Diff report */}
      {testGroups.length > 0 && (
        <section className="mt-14 sm:mt-20">
          <SectionHeader
            index="02"
            label="Diff report"
            aside={
              totalDiffs === 0
                ? 'No observations'
                : `${totalDiffs} ${totalDiffs === 1 ? 'case' : 'cases'} · ${changedCount} with visual change`
            }
          />

          <div className="mt-4 divide-y divide-foreground/10 border-y border-foreground/10">
            {testGroups.map((group, i) => (
              <TestBlock
                key={group.testId}
                index={i + 1}
                total={testGroups.length}
                group={group}
                onOpen={(payload) => setLightbox(payload)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Screenshot catalog */}
      {catalog.length > 0 && (
        <section className="mt-14 sm:mt-20">
          <SectionHeader
            index={testGroups.length > 0 ? '03' : '02'}
            label="Capture catalog"
            aside={`${catalog.length} ${catalog.length === 1 ? 'image' : 'images'}`}
          />
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
            {catalog.map((c, i) => (
              <button
                type="button"
                key={i}
                onClick={() => setLightbox({ kind: 'image', src: c.src })}
                className="group relative aspect-[4/3] overflow-hidden border border-foreground/10 hover:border-foreground/40 transition-colors bg-card"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={c.src}
                  alt={c.label}
                  loading="lazy"
                  decoding="async"
                  className="absolute inset-0 h-full w-full object-cover object-top group-hover:scale-[1.015] transition-transform duration-300"
                />
                <div className="absolute top-2 left-2 font-mono text-[9px] tracking-[0.2em] uppercase bg-background/85 text-foreground px-1.5 py-0.5 border border-foreground/10">
                  #{String(i + 1).padStart(2, '0')} {c.label}
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Sticky mobile CTA */}
      <div className="sm:hidden fixed inset-x-0 bottom-0 z-30 p-3 bg-background/95 backdrop-blur border-t border-foreground/15">
        <Link
          href={claimLink}
          className="flex items-center justify-center gap-2 bg-foreground text-background font-mono text-[11px] tracking-[0.25em] uppercase px-5 py-3.5"
        >
          Sign up — claim this test
          <ArrowTiny />
        </Link>
      </div>

      {lightbox && <Lightbox payload={lightbox} onClose={() => setLightbox(null)} />}
    </>
  );
}

function SectionHeader({
  index,
  label,
  aside,
}: {
  index: string;
  label: string;
  aside?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-foreground/15 pb-2">
      <h2 className="font-mono text-[11px] tracking-[0.35em] uppercase text-foreground">
        <span className="text-muted-foreground">{index}</span>
        <span className="mx-2 text-muted-foreground">·</span>
        {label}
      </h2>
      {aside && (
        <span className="font-mono text-[10px] tracking-[0.25em] uppercase text-muted-foreground">
          {aside}
        </span>
      )}
    </div>
  );
}

function VideoEvidence({
  src,
  testName,
  durationMs,
  autoplay,
  domain,
}: {
  src: string;
  testName: string;
  durationMs: number | null;
  autoplay: boolean;
  domain: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(autoplay);

  const duration = durationMs ? `${(durationMs / 1000).toFixed(1)}s` : null;

  return (
    <figure className="space-y-2">
      <div className="relative bg-black border border-foreground/15 overflow-hidden group">
        <video
          ref={ref}
          src={src}
          autoPlay={autoplay}
          loop
          muted
          playsInline
          controls
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          className="w-full aspect-video object-contain bg-black"
        />

        {/* Overlay stamps */}
        <div className="pointer-events-none absolute top-3 left-3 flex items-center gap-2">
          <span className="font-mono text-[10px] tracking-[0.25em] uppercase bg-primary text-primary-foreground px-2 py-0.5 flex items-center gap-1.5">
            <RecDot playing={playing} />
            REC
          </span>
          {duration && (
            <span className="font-mono text-[10px] tracking-[0.25em] uppercase bg-black/70 text-white/90 px-2 py-0.5 border border-white/10">
              {duration}
            </span>
          )}
        </div>
        <div className="pointer-events-none absolute top-3 right-3">
          <span className="font-mono text-[10px] tracking-[0.25em] uppercase bg-black/70 text-white/90 px-2 py-0.5 border border-white/10 max-w-[50ch] truncate">
            {domain}
          </span>
        </div>
      </div>
      <figcaption className="flex items-center justify-between gap-4 font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">
        <span className="truncate">Run of <span className="text-foreground">{testName}</span></span>
        <span>Muted · loop</span>
      </figcaption>
    </figure>
  );
}

function RecDot({ playing }: { playing: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-block w-1.5 h-1.5 rounded-full bg-current ${
        playing ? 'animate-pulse' : 'opacity-50'
      }`}
    />
  );
}

function TestBlock({
  index,
  total,
  group,
  onOpen,
}: {
  index: number;
  total: number;
  group: ClientTestGroup;
  onOpen: (p: LightboxPayload) => void;
}) {
  const changed = group.diffs.filter((d) => (d.pixelDifference ?? 0) > 0).length;
  const failed = group.diffs.filter(
    (d) => d.testResultStatus === 'failed' || d.status === 'rejected',
  ).length;

  return (
    <article className="py-8 sm:py-10">
      <header className="flex flex-wrap items-baseline gap-x-6 gap-y-2 mb-5">
        <span className="font-mono text-[10px] tracking-[0.35em] uppercase text-muted-foreground shrink-0">
          Fig {String(index).padStart(2, '0')} / {String(total).padStart(2, '0')}
        </span>
        <h3 className="font-[family-name:var(--font-display)] text-2xl sm:text-3xl leading-tight">
          {group.testName}
        </h3>
        <div className="ml-auto flex items-center gap-3 font-mono text-[10px] tracking-[0.25em] uppercase">
          {failed > 0 ? (
            <span className="text-red-600">{failed} FAIL</span>
          ) : changed > 0 ? (
            <span className="text-amber-600">{changed} CHANGED</span>
          ) : (
            <span className="text-muted-foreground">BASELINE</span>
          )}
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        {group.diffs.map((d) => (
          <DiffCard key={d.id} diff={d} group={group} onOpen={onOpen} />
        ))}
      </div>
    </article>
  );
}

function DiffCard({
  diff,
  group,
  onOpen,
}: {
  diff: ClientDiff;
  group: ClientTestGroup;
  onOpen: (p: LightboxPayload) => void;
}) {
  const hasBoth = !!diff.baseline && !!diff.current;
  const hasOnlyCurrent = !hasBoth && !!diff.current;
  const hasOnlyBaseline = !hasBoth && !!diff.baseline;

  const canCompare = hasBoth;
  const failed = diff.testResultStatus === 'failed' || diff.status === 'rejected';
  const pct = diff.percentageDifference ? parseFloat(diff.percentageDifference) : null;

  const label =
    diff.stepLabel ||
    (failed ? 'Execution failed' : diff.classification === 'changed' ? 'Visual change' : 'Capture');

  return (
    <button
      type="button"
      onClick={() => {
        if (canCompare) {
          onOpen({
            kind: 'compare',
            baseline: diff.baseline!,
            current: diff.current!,
            diff: diff.diff,
            testName: group.testName,
            stepLabel: diff.stepLabel,
          });
        } else if (diff.current) {
          onOpen({ kind: 'image', src: diff.current });
        } else if (diff.baseline) {
          onOpen({ kind: 'image', src: diff.baseline });
        }
      }}
      className={`group text-left overflow-hidden border bg-card hover:border-foreground/40 transition-colors ${
        failed ? 'border-red-500/40' : 'border-foreground/15'
      }`}
    >
      {canCompare ? (
        <div className="grid grid-cols-2 aspect-[16/10] bg-[oklch(0.97_0_0)]">
          <div className="relative overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={diff.baseline!}
              alt=""
              loading="lazy"
              className="absolute inset-0 w-full h-full object-cover object-top"
            />
            <span className="absolute top-2 left-2 font-mono text-[9px] tracking-[0.25em] uppercase bg-black/75 text-white px-1.5 py-0.5">
              Before
            </span>
          </div>
          <div className="relative overflow-hidden border-l border-foreground/15">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={diff.current!}
              alt=""
              loading="lazy"
              className="absolute inset-0 w-full h-full object-cover object-top"
            />
            <span className="absolute top-2 left-2 font-mono text-[9px] tracking-[0.25em] uppercase bg-primary text-primary-foreground px-1.5 py-0.5">
              After
            </span>
          </div>
        </div>
      ) : (
        <div className="aspect-[16/10] bg-[oklch(0.97_0_0)] relative overflow-hidden">
          {(hasOnlyCurrent || hasOnlyBaseline) && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={(diff.current || diff.baseline)!}
              alt=""
              loading="lazy"
              className="absolute inset-0 w-full h-full object-cover object-top"
            />
          )}
          <span className="absolute top-2 left-2 font-mono text-[9px] tracking-[0.25em] uppercase bg-foreground text-background px-1.5 py-0.5">
            {hasOnlyCurrent ? 'New' : hasOnlyBaseline ? 'Removed' : 'Missing capture'}
          </span>
        </div>
      )}

      <div className="flex items-center justify-between gap-4 border-t border-foreground/10 px-3 py-2">
        <span className="font-mono text-[11px] tracking-[0.15em] uppercase text-foreground truncate">
          {label}
        </span>
        <div className="flex items-center gap-3 font-mono text-[10px] tracking-wider text-muted-foreground">
          {(diff.pixelDifference ?? 0) > 0 && (
            <span className="tabular-nums text-foreground">
              {diff.pixelDifference!.toLocaleString()} px
            </span>
          )}
          {pct !== null && pct > 0 && (
            <span className="tabular-nums">{pct.toFixed(2)}%</span>
          )}
          {canCompare && (
            <span className="text-muted-foreground group-hover:text-foreground transition-colors">
              Open ↗
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function ArrowTiny() {
  return (
    <svg width="14" height="8" viewBox="0 0 14 8" fill="none">
      <path d="M0 4H13M13 4L10 1M13 4L10 7" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

/* --- Lightbox --------------------------------------------------------- */

function Lightbox({
  payload,
  onClose,
}: {
  payload: LightboxPayload;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 sm:p-8"
      onClick={onClose}
    >
      {payload.kind === 'image' ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={payload.src} alt="" className="max-w-full max-h-full object-contain" />
      ) : (
        <div className="w-full max-w-6xl max-h-full" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-baseline justify-between gap-4 mb-3 font-mono text-[10px] tracking-[0.25em] uppercase text-white/80">
            <span>
              {payload.testName}
              {payload.stepLabel && (
                <span className="text-white/50 ml-2">· {payload.stepLabel}</span>
              )}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1 border border-white/20 hover:bg-white/10"
            >
              Close (esc)
            </button>
          </div>
          <BeforeAfterSlider baseline={payload.baseline} current={payload.current} />
        </div>
      )}
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
      className="relative bg-[oklch(0.97_0_0)] border border-white/10 overflow-hidden select-none"
      style={{ maxHeight: '85vh' }}
      onPointerDown={(e) => {
        dragging.current = true;
        setFromClientX(e.clientX);
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={current} alt="After" className="block w-full max-h-[85vh] object-contain" />
      <div
        className="absolute inset-0 overflow-hidden pointer-events-none"
        style={{ width: `${pct}%` }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={baseline}
          alt="Before"
          className="block max-h-[85vh] object-contain absolute top-0 left-0"
          style={{ width: width ? `${width}px` : '100%' }}
        />
      </div>
      <div
        className="absolute top-0 bottom-0 w-px bg-primary shadow-[0_0_0_1px_oklch(1_0_0_/_0.3)] pointer-events-none"
        style={{ left: `${pct}%` }}
      >
        <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-9 h-9 rounded-full bg-primary text-primary-foreground ring-2 ring-black/40 flex items-center justify-center font-mono text-xs">
          ↔
        </div>
      </div>
      <span className="absolute top-3 left-3 font-mono text-[9px] tracking-[0.25em] uppercase bg-black/80 text-white px-1.5 py-0.5 border border-white/20">
        Before
      </span>
      <span className="absolute top-3 right-3 font-mono text-[9px] tracking-[0.25em] uppercase bg-primary text-primary-foreground px-1.5 py-0.5">
        After
      </span>
    </div>
  );
}
