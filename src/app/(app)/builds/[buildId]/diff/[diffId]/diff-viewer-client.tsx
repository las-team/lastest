'use client';

import { useState, useEffect, useCallback, useLayoutEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { SliderComparison, type FocusRegionRect } from '@/components/diff/slider-comparison';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { approveDiff, undoApproval, addDiffTodo, addFocusRegion, removeFocusRegion } from '@/server/actions/diffs';
import type { VisualDiff, Test, DiffMetadata, AIDiffAnalysis, A11yViolation, NetworkRequest, DownloadRecord, DomDiffResult, VisualDiffWithTestStatus } from '@/lib/db/schema';

type StripStatus = 'failed' | 'changed' | 'todo' | 'approved';

function deriveStripStatus(d: VisualDiffWithTestStatus): StripStatus {
  if (d.testResultStatus === 'failed' || d.status === 'rejected' || d.errorMessage) return 'failed';
  if (d.status === 'todo') return 'todo';
  if (d.status === 'approved' || d.status === 'auto_approved') return 'approved';
  if (d.classification === 'unchanged' || (d.pixelDifference ?? 0) === 0) return 'approved';
  if (d.status === 'pending' && (d.pixelDifference ?? 0) > 0) return 'changed';
  return 'changed';
}

const stripStatusBar: Record<StripStatus, string> = {
  failed: 'bg-red-500',
  changed: 'bg-yellow-500',
  todo: 'bg-amber-500',
  approved: 'bg-green-500',
};

const STRIP_TILE_WIDTH = 96;
const STRIP_TILE_HEIGHT = 64;
const STRIP_TILE_GAP = 6;
const STRIP_STEP = STRIP_TILE_WIDTH + STRIP_TILE_GAP;

function DiffStrip({
  allDiffs,
  currentDiffId,
  buildDiffUrl,
}: {
  allDiffs: VisualDiffWithTestStatus[];
  currentDiffId: string;
  buildDiffUrl: (id: string) => string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [transitionEnabled, setTransitionEnabled] = useState(false);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setContainerWidth(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? el.clientWidth;
      setContainerWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const id = requestAnimationFrame(() => setTransitionEnabled(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const currentIndex = Math.max(0, allDiffs.findIndex((d) => d.id === currentDiffId));
  const totalWidth = allDiffs.length * STRIP_STEP - STRIP_TILE_GAP;
  const maxOffset = Math.max(0, totalWidth - containerWidth);
  const desiredOffset = currentIndex * STRIP_STEP - (containerWidth - STRIP_TILE_WIDTH) / 2;
  const offset = containerWidth > 0 ? Math.max(0, Math.min(maxOffset, desiredOffset)) : 0;

  return (
    <div ref={containerRef} className="relative w-full overflow-hidden pb-2">
      <div
        className="flex"
        style={{
          gap: `${STRIP_TILE_GAP}px`,
          transform: `translate3d(${-offset}px, 0, 0)`,
          transition: transitionEnabled ? 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)' : 'none',
          willChange: 'transform',
        }}
      >
        {allDiffs.map((d, i) => {
          const status = deriveStripStatus(d);
          const isCurrent = d.id === currentDiffId;
          return (
            <Link
              key={d.id}
              href={buildDiffUrl(d.id)}
              title={`${d.testName ?? 'unnamed'} · ${d.stepLabel ?? `step ${i + 1}`} · ${status}`}
              style={{ width: STRIP_TILE_WIDTH }}
              className={`flex-none rounded overflow-hidden border border-border bg-card transition ${
                isCurrent ? 'ring-2 ring-primary' : 'hover:opacity-80'
              }`}
            >
              {d.currentImagePath ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={d.currentImagePath}
                  alt=""
                  style={{ height: STRIP_TILE_HEIGHT }}
                  className="w-full object-cover"
                />
              ) : (
                <div style={{ height: STRIP_TILE_HEIGHT }} className="w-full bg-muted" />
              )}
              <div className={`h-1 w-full ${stripStatusBar[status]}`} />
              <div className="text-center font-mono text-[10px] py-0.5 text-muted-foreground">
                {i + 1}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
import { A11yViolationsPanel } from '@/components/builds/a11y-violations-panel';
import { RuntimeErrorsPanel, stripRuntimeErrorsFromMessage } from '@/components/builds/runtime-errors-panel';
import { CheckCircle, ListTodo, SkipForward, Eye, Image as ImageIcon, Sparkles, Loader2, ArrowUpDown, Bug, ChevronDown, Code2, Crosshair } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';

interface DiffViewerClientProps {
  diff: VisualDiff & { test: Test | null; errorMessage?: string | null; a11yViolations?: A11yViolation[] | null; consoleErrors?: string[] | null; networkRequests?: NetworkRequest[] | null; networkBodiesPath?: string | null; downloads?: DownloadRecord[] | null };
  buildId: string;
  prevDiffId?: string;
  nextDiffId?: string;
  banAiMode?: boolean;
  initialFocusRegions?: FocusRegionRect[];
  allDiffs?: VisualDiffWithTestStatus[];
}

export function DiffViewerClient({ diff, buildId, prevDiffId, nextDiffId, banAiMode = false, initialFocusRegions = [], allDiffs = [] }: DiffViewerClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const viewParam = searchParams.get('view') as 'slider' | 'side-by-side' | 'overlay' | 'three-way' | 'planned-vs-actual' | 'shift-compare' | null;
  const [isProcessing, setIsProcessing] = useState(false);
  const [showUndo, setShowUndo] = useState(false);
  const [undoTimeout, setUndoTimeout] = useState<NodeJS.Timeout | null>(null);
  const [showTodoInput, setShowTodoInput] = useState(false);
  const [todoDescription, setTodoDescription] = useState('');
  const todoInputRef = useRef<HTMLInputElement>(null);
  const currentViewMode = useRef(viewParam);

  const buildDiffUrl = useCallback((diffId: string) => {
    const base = `/builds/${buildId}/diff/${diffId}`;
    return currentViewMode.current ? `${base}?view=${currentViewMode.current}` : base;
  }, [buildId]);

  const handleViewModeChange = useCallback((mode: string) => {
    currentViewMode.current = mode as typeof viewParam;
    const url = new URL(window.location.href);
    url.searchParams.set('view', mode);
    window.history.replaceState(null, '', url.toString());
  }, []);

  const handleApprove = useCallback(async () => {
    if (isProcessing || diff.status === 'approved') return;

    setIsProcessing(true);
    try {
      await approveDiff(diff.id);
      setShowUndo(true);

      // Auto-hide undo after 10 seconds
      const timeout = setTimeout(() => {
        setShowUndo(false);
      }, 10000);
      setUndoTimeout(timeout);

      router.refresh();

      // Navigate to next diff if available
      if (nextDiffId) {
        setTimeout(() => {
          router.push(buildDiffUrl(nextDiffId));
        }, 500);
      }
    } catch (error) {
      console.error('Failed to approve:', error);
    } finally {
      setIsProcessing(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diff.id, diff.status, isProcessing, nextDiffId, buildId, router, buildDiffUrl]);

  const handleAddTodo = useCallback(async () => {
    if (!todoDescription.trim()) return;
    if (isProcessing || diff.status === 'todo') return;

    setIsProcessing(true);
    try {
      await addDiffTodo(diff.id, todoDescription.trim());
      setShowTodoInput(false);
      setTodoDescription('');
      router.refresh();
    } catch (error) {
      console.error('Failed to add todo:', error);
    } finally {
      setIsProcessing(false);
    }
  }, [diff.id, diff.status, isProcessing, todoDescription, router]);

  const handleShowTodoInput = useCallback(() => {
    setShowTodoInput(true);
    setTimeout(() => todoInputRef.current?.focus(), 50);
  }, []);

  const handleUndo = async () => {
    if (undoTimeout) clearTimeout(undoTimeout);
    setShowUndo(false);

    try {
      await undoApproval(diff.id);
      router.refresh();
    } catch (error) {
      console.error('Failed to undo:', error);
    }
  };

  const handleSkip = useCallback(() => {
    if (nextDiffId) {
      router.push(buildDiffUrl(nextDiffId));
    }
  }, [nextDiffId, buildDiffUrl, router]);

  const handlePrev = useCallback(() => {
    if (prevDiffId) {
      router.push(buildDiffUrl(prevDiffId));
    }
  }, [prevDiffId, buildDiffUrl, router]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.key) {
        case 'e':
        case 'E':
          e.preventDefault();
          handleApprove();
          break;
        case 't':
        case 'T':
          e.preventDefault();
          handleShowTodoInput();
          break;
        case 's':
        case 'S':
          e.preventDefault();
          handleSkip();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          handlePrev();
          break;
        case 'ArrowRight':
          e.preventDefault();
          handleSkip();
          break;
        case 'Escape':
          if (showTodoInput) {
            setShowTodoInput(false);
            setTodoDescription('');
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleApprove, handleShowTodoInput, handleSkip, handlePrev, showTodoInput]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (undoTimeout) clearTimeout(undoTimeout);
    };
  }, [undoTimeout]);

  const metadata = diff.metadata as DiffMetadata | null;
  const aiAnalysis = diff.aiAnalysis as AIDiffAnalysis | null;
  const aiStatus = diff.aiAnalysisStatus;
  const [showRegions, setShowRegions] = useState(false);
  const [showDomOverlay, setShowDomOverlay] = useState(false);
  const [drawFocusMode, setDrawFocusMode] = useState(false);
  const [focusRegions, setFocusRegions] = useState<FocusRegionRect[]>(initialFocusRegions);
  const [focusPending, setFocusPending] = useState(false);

  // Sync if server reloads with new focus regions (e.g. after router.refresh)
  useEffect(() => { setFocusRegions(initialFocusRegions); }, [initialFocusRegions]);

  const handleFocusDrawn = useCallback(async (rect: { x: number; y: number; width: number; height: number }) => {
    if (focusPending) return;
    setFocusPending(true);
    try {
      const created = await addFocusRegion(diff.id, rect);
      setFocusRegions(prev => [...prev, { id: created.id, x: rect.x, y: rect.y, width: rect.width, height: rect.height }]);
      setDrawFocusMode(false);
      router.refresh();
    } catch (error) {
      console.error('Failed to add focus region:', error);
    } finally {
      setFocusPending(false);
    }
  }, [diff.id, focusPending, router]);

  const handleFocusDelete = useCallback(async (regionId: string) => {
    if (focusPending) return;
    setFocusPending(true);
    setFocusRegions(prev => prev.filter(r => r.id !== regionId));
    try {
      await removeFocusRegion(regionId, diff.id);
      router.refresh();
    } catch (error) {
      console.error('Failed to remove focus region:', error);
    } finally {
      setFocusPending(false);
    }
  }, [diff.id, focusPending, router]);
  const changedRegions = metadata?.changedRegions;
  const domDiff = metadata?.domDiff;
  const hasDomChanges = domDiff && (domDiff.added.length > 0 || domDiff.removed.length > 0 || domDiff.changed.length > 0);

  // Build DOM overlay regions from DOM diff bounding boxes
  const domOverlayRegions = showDomOverlay && domDiff ? [
    ...domDiff.removed.map(el => ({ ...el.boundingBox, color: 'rgba(239, 68, 68, 0.25)' as const, border: '#ef4444' })),
    ...domDiff.added.map(el => ({ ...el.boundingBox, color: 'rgba(34, 197, 94, 0.25)' as const, border: '#22c55e' })),
    ...domDiff.changed.map(c => ({ ...c.current.boundingBox, color: 'rgba(234, 179, 8, 0.25)' as const, border: '#eab308' })),
  ] : [];

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-4">
          {/* Status Badge */}
          <div className="flex items-center gap-4 flex-wrap">
            <div
              className={`px-3 py-1 rounded-full text-sm font-medium ${
                diff.status === 'approved' || diff.status === 'auto_approved'
                  ? 'bg-green-100 text-green-700'
                  : diff.status === 'rejected'
                    ? 'bg-destructive/10 text-destructive'
                    : diff.status === 'todo'
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-yellow-100 text-yellow-700'
              }`}
            >
              {diff.status === 'auto_approved' ? 'Auto-Approved (Carry-Forward)' : diff.status === 'todo' ? 'Todo' : diff.status}
            </div>

            {diff.pixelDifference !== null && diff.pixelDifference > 0 && (
              <div className="text-sm text-muted-foreground">
                {diff.pixelDifference.toLocaleString()} pixels changed ({diff.percentageDifference}%)
              </div>
            )}

            {/* Main baseline drift indicator (for vs_both comparison) */}
            {diff.mainBaselineImagePath && (
              <div className="flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium bg-purple-100 text-purple-700">
                vs Main
                {diff.mainPercentageDifference && parseFloat(diff.mainPercentageDifference) > 0 ? (
                  <span className="text-purple-500">
                    ({diff.mainPercentageDifference}% drift)
                  </span>
                ) : (
                  <span className="text-purple-500">(no drift)</span>
                )}
              </div>
            )}

            {/* Planned screenshot indicator */}
            {diff.plannedImagePath && (
              <div className="flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium bg-primary/10 text-primary">
                <ImageIcon className="w-4 h-4" />
                Has Planned
                {diff.plannedPercentageDifference && (
                  <span className="text-primary/70">
                    ({diff.plannedPercentageDifference}% from design)
                  </span>
                )}
              </div>
            )}

            {/* Page shift indicator */}
            {metadata?.pageShift?.detected && (
              <div className="flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-700">
                <ArrowUpDown className="w-4 h-4" />
                Page Shift {metadata.pageShift.deltaY > 0 ? '+' : ''}{metadata.pageShift.deltaY}px
              </div>
            )}
          </div>

          {/* Execution Error Banner (collapsed by default) */}
          {diff.errorMessage && (() => {
            const cleaned = stripRuntimeErrorsFromMessage(diff.errorMessage);
            return cleaned ? (
              <details className="border border-orange-200 bg-orange-50 rounded-lg">
                <summary className="flex items-center gap-3 p-4 cursor-pointer select-none">
                  <Bug className="w-5 h-5 text-orange-600 flex-shrink-0" />
                  <span className="font-medium text-orange-800">Execution Error</span>
                  <ChevronDown className="w-4 h-4 text-orange-400 ml-auto transition-transform [[open]>&]:rotate-180" />
                </summary>
                <div className="px-4 pb-4">
                  <pre className="text-sm text-orange-700 whitespace-pre-wrap break-words">{cleaned}</pre>
                </div>
              </details>
            ) : null;
          })()}

          <RuntimeErrorsPanel consoleErrors={diff.consoleErrors} networkRequests={diff.networkRequests} networkBodiesPath={diff.networkBodiesPath} downloads={diff.downloads} />

          {/* AI Analysis */}
          {!banAiMode && (aiAnalysis || aiStatus === 'running' || aiStatus === 'pending') && (
            <div className="border border-purple-200 bg-purple-50/50 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <Sparkles className="w-5 h-5 text-purple-600 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  {aiStatus === 'running' || aiStatus === 'pending' ? (
                    <div className="flex items-center gap-2 text-sm text-purple-600">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      AI analysis in progress...
                    </div>
                  ) : aiAnalysis ? (
                    <>
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          aiAnalysis.classification === 'insignificant' ? 'bg-green-100 text-green-700'
                            : aiAnalysis.classification === 'noise' ? 'bg-blue-100 text-blue-700'
                            : 'bg-yellow-100 text-yellow-700'
                        }`}>
                          {aiAnalysis.classification}
                        </span>
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          aiAnalysis.recommendation === 'approve' ? 'bg-green-100 text-green-700'
                            : aiAnalysis.recommendation === 'flag' ? 'bg-red-100 text-red-700'
                            : 'bg-yellow-100 text-yellow-700'
                        }`}>
                          {aiAnalysis.recommendation}
                        </span>
                        <span className="text-xs text-gray-400">
                          {Math.round(aiAnalysis.confidence * 100)}% confidence
                        </span>
                      </div>
                      <p className="text-sm text-gray-700">{aiAnalysis.summary}</p>
                      {aiAnalysis.recommendation === 'approve' && diff.status === 'pending' && (
                        <button
                          onClick={handleApprove}
                          disabled={isProcessing}
                          className="mt-2 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-purple-600 rounded-md hover:bg-purple-700 disabled:opacity-50"
                        >
                          <CheckCircle className="w-3.5 h-3.5" />
                          Mark as Expected Change
                        </button>
                      )}
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          )}

          <A11yViolationsPanel violations={diff.a11yViolations ?? []} />

          {/* DOM Changes Panel */}
          {metadata?.domDiff && (metadata.domDiff.added.length > 0 || metadata.domDiff.removed.length > 0 || metadata.domDiff.changed.length > 0) && (
            <DomChangesPanel domDiff={metadata.domDiff} />
          )}

          {/* Diff Comparison */}
          {diff.currentImagePath ? (
            (() => {
              // On main branch (no mainBaselineImagePath), only show one tab
              const isMainBranch = !diff.mainBaselineImagePath && diff.baselineImagePath;

              type TabDef = { id: string; label: string; pct: string | null; baseline: string | null; diffImg: string | null | undefined; leftLabel?: string; alignedBaseline?: string; alignedCurrent?: string; alignedDiffImage?: string; alignmentSegments?: import('@/lib/db/schema').AlignmentSegment[] };
              const tabs: TabDef[] = [];

              // Branch tab — always present
              tabs.push({
                id: 'branch', label: isMainBranch ? 'vs Baseline' : 'vs Branch',
                pct: diff.baselineImagePath ? diff.percentageDifference : null,
                baseline: diff.baselineImagePath,
                diffImg: diff.diffImagePath,
                alignedBaseline: metadata?.pageShift?.alignedBaselineImagePath ?? undefined,
                alignedCurrent: metadata?.pageShift?.alignedCurrentImagePath ?? undefined,
                alignedDiffImage: metadata?.pageShift?.alignedDiffImagePath ?? undefined,
                alignmentSegments: metadata?.pageShift?.alignmentSegments ?? undefined,
              });

              // Main tab — present on feature branches
              if (!isMainBranch) {
                tabs.push({
                  id: 'main', label: 'vs Main',
                  pct: diff.mainBaselineImagePath ? diff.mainPercentageDifference : null,
                  baseline: diff.mainBaselineImagePath,
                  diffImg: diff.mainDiffImagePath,
                });
              }

              // Planned tab — only when planned screenshot exists
              if (diff.plannedImagePath) {
                tabs.push({
                  id: 'planned', label: 'vs Planned',
                  pct: diff.plannedPercentageDifference,
                  baseline: diff.plannedImagePath,
                  diffImg: diff.plannedDiffImagePath,
                  leftLabel: 'Planned',
                });
              }

              // Find first tab with data for default selection
              const defaultTab = tabs.find(t => t.id === 'main' && t.baseline) || tabs.find(t => t.baseline) || tabs[0];

              if (tabs.length <= 1) {
                const tab = tabs[0];
                return tab?.baseline ? (
                  <SliderComparison
                    baselineImage={tab.baseline}
                    currentImage={diff.currentImagePath!}
                    diffImage={tab.diffImg || undefined}
                    leftLabel={tab.leftLabel}
                    alignedBaselineImage={tab.alignedBaseline}
                    alignedCurrentImage={tab.alignedCurrent}
                    alignedDiffImage={tab.alignedDiffImage}
                    alignmentSegments={tab.alignmentSegments}
                    changedRegions={changedRegions}
                    domOverlayRegions={domOverlayRegions}
                    showRegions={showRegions}
                    focusRegions={focusRegions}
                    drawFocusMode={drawFocusMode}
                    onFocusRegionDrawn={handleFocusDrawn}
                    onFocusRegionDelete={handleFocusDelete}
                    initialViewMode={viewParam || undefined}
                    onViewModeChange={handleViewModeChange}
                  />
                ) : (
                  <div className="p-4">
                    <div className="text-sm text-muted-foreground mb-2">New Screenshot (No Baseline)</div>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={diff.currentImagePath!}
                      alt="Current screenshot"
                      className="w-full rounded"
                    />
                  </div>
                );
              }

              return (
                <Tabs defaultValue={defaultTab.id} className="w-full">
                  <TabsList>
                    {tabs.map((tab) => (
                      <TabsTrigger key={tab.id} value={tab.id}>
                        {tab.label}
                        {tab.baseline && tab.pct && parseFloat(tab.pct) > 0 ? (
                          <span className="ml-1 text-muted-foreground">({parseFloat(tab.pct).toFixed(1)}%)</span>
                        ) : !tab.baseline ? (
                          <span className="ml-1 text-muted-foreground/50">n/a</span>
                        ) : null}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  {tabs.map((tab) => (
                    <TabsContent key={tab.id} value={tab.id}>
                      {tab.baseline ? (
                        <SliderComparison
                          baselineImage={tab.baseline}
                          currentImage={diff.currentImagePath!}
                          diffImage={tab.diffImg || undefined}
                          leftLabel={tab.leftLabel}
                          alignedBaselineImage={tab.alignedBaseline}
                          alignedCurrentImage={tab.alignedCurrent}
                          alignedDiffImage={tab.alignedDiffImage}
                          alignmentSegments={tab.alignmentSegments}
                          changedRegions={changedRegions}
                          domOverlayRegions={domOverlayRegions}
                          showRegions={showRegions}
                          initialViewMode={viewParam || undefined}
                          onViewModeChange={handleViewModeChange}
                        />
                      ) : (
                        <div className="p-8 text-center text-muted-foreground space-y-2">
                          <p className="font-medium">
                            {tab.id === 'branch' ? 'No branch baseline yet' : 'No main baseline yet'}
                          </p>
                          <p className="text-sm">
                            {tab.id === 'branch'
                              ? 'A branch baseline will be created when you approve a diff on this branch.'
                              : 'Run and approve a build on the default branch to create a main baseline.'}
                          </p>
                          <div className="pt-2">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={diff.currentImagePath!}
                              alt="Current screenshot"
                              className="w-full rounded opacity-60"
                            />
                          </div>
                        </div>
                      )}
                    </TabsContent>
                  ))}
                </Tabs>
              );
            })()
          ) : (
            <div className="p-8 text-center text-muted-foreground">
              No screenshot available
            </div>
          )}

          {/* Color-coded thumbnail queue strip */}
          {allDiffs.length > 0 && (
            <DiffStrip
              allDiffs={allDiffs}
              currentDiffId={diff.id}
              buildDiffUrl={buildDiffUrl}
            />
          )}

          {/* Action Bar */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button
                onClick={handleApprove}
                disabled={isProcessing || diff.status === 'approved' || diff.status === 'auto_approved'}
              >
                <CheckCircle className="w-4 h-4" />
                Expected Change
              </Button>

              {showTodoInput ? (
                <div className="flex items-center gap-2">
                  <Input
                    ref={todoInputRef}
                    value={todoDescription}
                    onChange={(e) => setTodoDescription(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAddTodo();
                      if (e.key === 'Escape') { setShowTodoInput(false); setTodoDescription(''); }
                    }}
                    placeholder="Describe what needs fixing..."
                    className="w-64 h-9"
                  />
                  <Button
                    size="sm"
                    onClick={handleAddTodo}
                    disabled={isProcessing || !todoDescription.trim()}
                    className="bg-amber-600 hover:bg-amber-700 text-white"
                  >
                    Add
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => { setShowTodoInput(false); setTodoDescription(''); }}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  onClick={handleShowTodoInput}
                  disabled={isProcessing || diff.status === 'todo'}
                  className="border-amber-300 text-amber-700 hover:bg-amber-50"
                >
                  <ListTodo className="w-4 h-4" />
                  Add to Todo
                </Button>
              )}

              <Button
                variant="outline"
                onClick={handleSkip}
                disabled={!nextDiffId}
              >
                <SkipForward className="w-4 h-4" />
                Skip
              </Button>

              <Button
                variant={drawFocusMode ? 'default' : 'outline'}
                onClick={() => setDrawFocusMode(prev => !prev)}
                disabled={focusPending}
                className={drawFocusMode ? 'bg-green-600 hover:bg-green-700 text-white' : 'border-green-300 text-green-700 hover:bg-green-50'}
                title="Click and drag on the screenshot to define a focus region. Diff ignores everything outside the union of focus regions."
              >
                <Crosshair className="w-4 h-4" />
                {drawFocusMode ? 'Drawing — click + drag' : focusRegions.length > 0 ? `Focus (${focusRegions.length})` : 'Draw Focus Region'}
              </Button>
            </div>

            {/* Metadata Panel Toggle */}
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              {metadata && metadata.changedRegions.length > 0 && (
                <>
                  <button
                    onClick={() => setShowRegions(!showRegions)}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-colors ${
                      showRegions
                        ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                        : 'bg-muted hover:bg-muted/80'
                    }`}
                  >
                    <Eye className="w-3 h-3" />
                    {showRegions ? 'Hide' : 'Show'} Regions
                  </button>
                  <span>
                    {metadata.changedRegions.length} region(s) changed
                    {metadata.affectedComponents && metadata.affectedComponents.length > 0 && (
                      <span> · {metadata.affectedComponents.join(', ')}</span>
                    )}
                  </span>
                </>
              )}
              {hasDomChanges && (
                <button
                  onClick={() => setShowDomOverlay(!showDomOverlay)}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-colors ${
                    showDomOverlay
                      ? 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400'
                      : 'bg-muted hover:bg-muted/80'
                  }`}
                >
                  <Code2 className="w-3 h-3" />
                  {showDomOverlay ? 'Hide' : 'Show'} DOM
                </button>
              )}
              {metadata?.pageShift?.detected && (
                <span className="ml-3 text-blue-600">
                  · Shift: {metadata.pageShift.insertedRows ?? 0} rows added, {metadata.pageShift.deletedRows ?? 0} removed
                </span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Undo Toast */}
      {showUndo && (
        <div className="fixed bottom-4 right-4 bg-foreground text-background px-4 py-3 rounded-lg shadow-lg flex items-center gap-4">
          <span>Diff approved</span>
          <button
            onClick={handleUndo}
            className="text-primary hover:text-primary/80 font-medium"
          >
            Undo
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DOM Changes Panel — shows added/removed/changed elements from DOM diff
// ---------------------------------------------------------------------------

function DomChangesPanel({ domDiff }: { domDiff: DomDiffResult }) {
  const [expanded, setExpanded] = useState(false);
  const totalChanges = domDiff.added.length + domDiff.removed.length + domDiff.changed.length;

  return (
    <details
      className="border border-cyan-200 bg-cyan-50/50 dark:border-cyan-800 dark:bg-cyan-950/30 rounded-lg"
      open={expanded}
      onToggle={(e) => setExpanded((e.target as HTMLDetailsElement).open)}
    >
      <summary className="flex items-center gap-3 p-4 cursor-pointer select-none">
        <Code2 className="w-5 h-5 text-cyan-600 dark:text-cyan-400 flex-shrink-0" />
        <span className="font-medium text-cyan-800 dark:text-cyan-200">
          DOM Changes
        </span>
        <span className="text-xs text-cyan-600 dark:text-cyan-400">
          {domDiff.removed.length > 0 && <span className="text-red-600 dark:text-red-400 mr-2">-{domDiff.removed.length} removed</span>}
          {domDiff.added.length > 0 && <span className="text-green-600 dark:text-green-400 mr-2">+{domDiff.added.length} added</span>}
          {domDiff.changed.length > 0 && <span className="text-yellow-600 dark:text-yellow-400">~{domDiff.changed.length} changed</span>}
        </span>
        <span className="text-xs text-muted-foreground ml-auto mr-2">
          {domDiff.unchangedCount} unchanged
        </span>
        <ChevronDown className="w-4 h-4 text-cyan-400 transition-transform [[open]>&]:rotate-180" />
      </summary>
      <div className="px-4 pb-4 space-y-3 max-h-80 overflow-y-auto">
        {/* Removed elements */}
        {domDiff.removed.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-red-700 dark:text-red-400 mb-1">Removed ({domDiff.removed.length})</div>
            <div className="space-y-1">
              {domDiff.removed.slice(0, 20).map((el, i) => (
                <DomElementRow key={`r-${i}`} element={el} variant="removed" />
              ))}
              {domDiff.removed.length > 20 && (
                <div className="text-xs text-muted-foreground pl-2">... and {domDiff.removed.length - 20} more</div>
              )}
            </div>
          </div>
        )}
        {/* Added elements */}
        {domDiff.added.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-green-700 dark:text-green-400 mb-1">Added ({domDiff.added.length})</div>
            <div className="space-y-1">
              {domDiff.added.slice(0, 20).map((el, i) => (
                <DomElementRow key={`a-${i}`} element={el} variant="added" />
              ))}
              {domDiff.added.length > 20 && (
                <div className="text-xs text-muted-foreground pl-2">... and {domDiff.added.length - 20} more</div>
              )}
            </div>
          </div>
        )}
        {/* Changed elements */}
        {domDiff.changed.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-yellow-700 dark:text-yellow-400 mb-1">Changed ({domDiff.changed.length})</div>
            <div className="space-y-1">
              {domDiff.changed.slice(0, 20).map((c, i) => (
                <div key={`c-${i}`} className="flex items-start gap-2 text-xs bg-yellow-50/50 dark:bg-yellow-900/10 rounded px-2 py-1">
                  <span className="font-mono text-yellow-700 dark:text-yellow-400">&lt;{c.current.tag}&gt;</span>
                  <span className="text-muted-foreground truncate flex-1">
                    {c.current.selectors[0]?.value ?? ''}
                  </span>
                  <div className="flex gap-1 flex-shrink-0">
                    {c.changes.map(ch => (
                      <span key={ch} className="px-1 py-0.5 rounded bg-yellow-100 dark:bg-yellow-800/30 text-yellow-800 dark:text-yellow-300 text-[10px]">
                        {ch}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
              {domDiff.changed.length > 20 && (
                <div className="text-xs text-muted-foreground pl-2">... and {domDiff.changed.length - 20} more</div>
              )}
            </div>
          </div>
        )}
      </div>
    </details>
  );
}

function DomElementRow({ element, variant }: { element: import('@/lib/db/schema').DomSnapshotElement; variant: 'added' | 'removed' }) {
  const color = variant === 'added'
    ? 'bg-green-50/50 dark:bg-green-900/10 text-green-700 dark:text-green-400'
    : 'bg-red-50/50 dark:bg-red-900/10 text-red-700 dark:text-red-400';
  const sign = variant === 'added' ? '+' : '-';

  return (
    <div className={`flex items-center gap-2 text-xs rounded px-2 py-1 ${color}`}>
      <span className="font-mono flex-shrink-0">{sign} &lt;{element.tag}&gt;</span>
      <span className="text-muted-foreground truncate flex-1">
        {element.selectors[0]?.value ?? element.textContent?.slice(0, 40) ?? ''}
      </span>
      {element.textContent && (
        <span className="text-muted-foreground/60 truncate max-w-32 text-[10px]">
          {element.textContent.slice(0, 30)}
        </span>
      )}
    </div>
  );
}
