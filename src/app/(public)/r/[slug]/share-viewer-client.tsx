'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Play, AlertTriangle, XCircle, Film, Images, GitCompareArrows } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

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
  slug: string;
  videos: Array<{ src: string; testName: string; durationMs: number | null }>;
  testGroups: ClientTestGroup[];
  catalog: Array<{ src: string; label: string; testName: string }>;
  claimLink: string;
  signInLink: string;
  domain: string;
  totals: { total: number; passed: number; changed: number; failed: number };
}

type LightboxPayload =
  | { kind: 'image'; src: string; caption?: string }
  | {
      kind: 'compare';
      baseline: string;
      current: string;
      diff: string | null;
      testName: string;
      stepLabel: string | null;
    };

export function ShareViewer({
  slug,
  videos,
  testGroups,
  catalog,
  claimLink,
}: ShareViewerProps) {
  const [lightbox, setLightbox] = useState<LightboxPayload | null>(null);

  // Beacon a view count once per mount (page uses ISR, so server-side counting
  // wouldn't fire on cached renders).
  useEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon(`/api/share/${slug}/view`);
    } else {
      fetch(`/api/share/${slug}/view`, { method: 'POST', keepalive: true }).catch(() => {});
    }
  }, [slug]);

  const totalDiffs = testGroups.reduce((acc, g) => acc + g.diffs.length, 0);

  return (
    <>
      {/* Video hero */}
      {videos.length > 0 && (
        <Card>
          <CardHeader className="border-b">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Film className="w-4 h-4 text-muted-foreground" />
                Test recording
              </CardTitle>
              <span className="text-xs text-muted-foreground">
                {videos.length === 1 ? '1 recording' : `${videos.length} recordings`}
              </span>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            {videos.map((v, i) => (
              <VideoPanel
                key={i}
                src={v.src}
                testName={v.testName}
                durationMs={v.durationMs}
                autoplay={i === 0}
              />
            ))}
          </CardContent>
        </Card>
      )}

      {/* Diff report */}
      {testGroups.length > 0 && (
        <Card>
          <CardHeader className="border-b">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <GitCompareArrows className="w-4 h-4 text-muted-foreground" />
                Visual changes
              </CardTitle>
              <span className="text-xs text-muted-foreground">
                {totalDiffs} {totalDiffs === 1 ? 'change' : 'changes'} across {testGroups.length}{' '}
                {testGroups.length === 1 ? 'test' : 'tests'}
              </span>
            </div>
          </CardHeader>
          <CardContent className="pt-6 space-y-6">
            {testGroups.map((group) => (
              <TestBlock
                key={group.testId}
                group={group}
                onOpen={(payload) => setLightbox(payload)}
              />
            ))}
          </CardContent>
        </Card>
      )}

      {/* Screenshot catalog */}
      {catalog.length > 0 && (
        <Card>
          <CardHeader className="border-b">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Images className="w-4 h-4 text-muted-foreground" />
                Screenshots
              </CardTitle>
              <span className="text-xs text-muted-foreground">
                {catalog.length} {catalog.length === 1 ? 'image' : 'images'}
              </span>
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {catalog.map((c, i) => (
                <button
                  type="button"
                  key={i}
                  onClick={() =>
                    setLightbox({ kind: 'image', src: c.src, caption: c.label })
                  }
                  className="group relative aspect-[4/3] overflow-hidden rounded-lg border bg-card hover:border-primary/50 transition-colors"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={c.src}
                    alt={c.label}
                    loading="lazy"
                    decoding="async"
                    className="absolute inset-0 h-full w-full object-cover object-top group-hover:scale-[1.02] transition-transform duration-300"
                  />
                  <span className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent text-white text-[11px] font-medium px-2 py-1.5 truncate">
                    {c.label}
                  </span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Sticky mobile CTA */}
      <div className="sm:hidden fixed inset-x-0 bottom-0 z-30 p-3 bg-background/95 backdrop-blur border-t">
        <Button asChild size="lg" className="w-full">
          <Link href={claimLink}>Sign up and claim this test</Link>
        </Button>
      </div>

      {lightbox && <Lightbox payload={lightbox} onClose={() => setLightbox(null)} />}
    </>
  );
}

function VideoPanel({
  src,
  testName,
  durationMs,
  autoplay,
}: {
  src: string;
  testName: string;
  durationMs: number | null;
  autoplay: boolean;
}) {
  const duration = durationMs ? `${(durationMs / 1000).toFixed(1)}s` : null;
  return (
    <figure className="space-y-2">
      <div className="relative rounded-lg border bg-black overflow-hidden">
        <video
          src={src}
          autoPlay={autoplay}
          loop
          muted
          playsInline
          controls
          className="w-full aspect-video object-contain bg-black"
        />
        <Badge className="absolute top-3 left-3 gap-1.5 bg-red-500/90 text-white hover:bg-red-500/90 border-transparent">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
          REC
        </Badge>
        {duration && (
          <Badge
            variant="secondary"
            className="absolute top-3 right-3 bg-black/70 text-white hover:bg-black/70 border-transparent"
          >
            {duration}
          </Badge>
        )}
      </div>
      <figcaption className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span className="truncate">
          <span className="text-foreground font-medium">{testName}</span>
        </span>
        <span>Muted · Loop</span>
      </figcaption>
    </figure>
  );
}

function TestBlock({
  group,
  onOpen,
}: {
  group: ClientTestGroup;
  onOpen: (p: LightboxPayload) => void;
}) {
  const failed = group.diffs.filter(
    (d) => d.testResultStatus === 'failed' || d.status === 'rejected',
  ).length;
  const changed = group.diffs.filter((d) => (d.pixelDifference ?? 0) > 0).length;

  return (
    <section className="space-y-3">
      <header className="flex items-center justify-between gap-3">
        <h3 className="font-semibold text-base">{group.testName}</h3>
        <div className="flex items-center gap-2 text-xs">
          {failed > 0 && (
            <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 gap-1">
              <XCircle className="w-3 h-3" />
              {failed} failed
            </Badge>
          )}
          {changed > 0 && (
            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 gap-1">
              <AlertTriangle className="w-3 h-3" />
              {changed} changed
            </Badge>
          )}
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        {group.diffs.map((d) => (
          <DiffCard key={d.id} diff={d} group={group} onOpen={onOpen} />
        ))}
      </div>
    </section>
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
  const failed = diff.testResultStatus === 'failed' || diff.status === 'rejected';
  const pct = diff.percentageDifference ? parseFloat(diff.percentageDifference) : null;

  const fallback = diff.current ?? diff.baseline ?? null;

  const label =
    diff.stepLabel ||
    (failed ? 'Execution failed' : diff.classification === 'changed' ? 'Visual change' : 'Capture');

  return (
    <button
      type="button"
      onClick={() => {
        if (hasBoth) {
          onOpen({
            kind: 'compare',
            baseline: diff.baseline!,
            current: diff.current!,
            diff: diff.diff,
            testName: group.testName,
            stepLabel: diff.stepLabel,
          });
        } else if (fallback) {
          onOpen({ kind: 'image', src: fallback, caption: label });
        }
      }}
      className={`group text-left overflow-hidden rounded-lg border bg-card hover:border-primary/50 hover:shadow-sm transition-all ${
        failed ? 'border-red-300/60' : 'border-border'
      }`}
    >
      {hasBoth ? (
        <div className="grid grid-cols-2 aspect-[16/10] bg-muted">
          <div className="relative overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={diff.baseline!}
              alt=""
              loading="lazy"
              className="absolute inset-0 w-full h-full object-cover object-top"
            />
            <Badge
              variant="secondary"
              className="absolute top-2 left-2 bg-background/85 text-foreground"
            >
              Before
            </Badge>
          </div>
          <div className="relative overflow-hidden border-l">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={diff.current!}
              alt=""
              loading="lazy"
              className="absolute inset-0 w-full h-full object-cover object-top"
            />
            <Badge className="absolute top-2 left-2">After</Badge>
          </div>
        </div>
      ) : (
        <div className="aspect-[16/10] bg-muted relative overflow-hidden">
          {fallback && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={fallback}
              alt=""
              loading="lazy"
              className="absolute inset-0 w-full h-full object-cover object-top"
            />
          )}
          <Badge className="absolute top-2 left-2" variant="secondary">
            {diff.current ? 'New' : diff.baseline ? 'Removed' : 'Missing'}
          </Badge>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 px-3 py-2.5 border-t text-sm">
        <span className="font-medium truncate">{label}</span>
        <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
          {(diff.pixelDifference ?? 0) > 0 && (
            <span className="tabular-nums text-foreground">
              {diff.pixelDifference.toLocaleString()} px
            </span>
          )}
          {pct !== null && pct > 0 && (
            <span className="tabular-nums">{pct.toFixed(2)}%</span>
          )}
          {hasBoth && (
            <span className="text-primary group-hover:underline underline-offset-2">
              Compare
            </span>
          )}
        </div>
      </div>
    </button>
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
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 sm:p-8"
      onClick={onClose}
    >
      {payload.kind === 'image' ? (
        <div className="relative" onClick={(e) => e.stopPropagation()}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={payload.src}
            alt={payload.caption ?? ''}
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-md"
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={onClose}
            className="absolute top-2 right-2"
          >
            Close
          </Button>
        </div>
      ) : (
        <div className="w-full max-w-6xl max-h-full space-y-3" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between gap-3 text-sm text-white/90">
            <div className="min-w-0">
              <div className="font-medium truncate">{payload.testName}</div>
              {payload.stepLabel && (
                <div className="text-xs text-white/60 truncate">{payload.stepLabel}</div>
              )}
            </div>
            <Button variant="secondary" size="sm" onClick={onClose}>
              Close
            </Button>
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
  const dragging = useRef(false);

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

  // Both images rendered at identical bounds; baseline is revealed on the
  // left via clip-path. No resize happens during drag.
  return (
    <div
      ref={containerRef}
      className="relative rounded-lg border bg-muted overflow-hidden select-none"
      onPointerDown={(e) => {
        dragging.current = true;
        setFromClientX(e.clientX);
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={current}
        alt="After"
        draggable={false}
        className="block w-full max-h-[85vh] object-contain"
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={baseline}
        alt="Before"
        draggable={false}
        className="absolute inset-0 w-full h-full object-contain pointer-events-none"
        style={{ clipPath: `inset(0 ${100 - pct}% 0 0)` }}
      />
      <div
        className="absolute top-0 bottom-0 w-px bg-primary pointer-events-none"
        style={{ left: `${pct}%` }}
      >
        <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-9 h-9 rounded-full bg-primary text-primary-foreground ring-2 ring-background shadow-md flex items-center justify-center">
          <Play className="w-3.5 h-3.5 rotate-180 -ml-0.5" />
          <Play className="w-3.5 h-3.5 -ml-1" />
        </div>
      </div>
      <Badge className="absolute top-3 left-3 bg-background/90 text-foreground hover:bg-background/90 border">
        Before
      </Badge>
      <Badge className="absolute top-3 right-3">After</Badge>
    </div>
  );
}
