'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TooltipProvider } from '@/components/ui/tooltip';
import { StepCard, type StepCardEvent, type StepCardSelectorMatch } from '@/components/recording/step-card';
import { ChevronLeft, ChevronRight, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface TraceScrubProps {
  events: StepCardEvent[];
  /** Pre-computed `getEventDescription(event)` so the scrub doesn't need to
   *  duplicate the host's labelling logic. */
  describe: (event: StepCardEvent) => string;
  /** Pre-computed `isActionReplayable(event)` for pill fallback when match
   *  counts haven't arrived. */
  replayStatusOf: (event: StepCardEvent) => { replayable: boolean; reason?: 'valid-selectors' | 'coords-only' | 'no-selectors' };
  repositoryId?: string | null;
  /** Mirror of recording-client's optimistic update so promotions reflect
   *  immediately in the scrub view. */
  onPromoteOptimistic?: (actionId: string, selectorValue: string) => void;
}

/**
 * Post-stop scrubbable preview of the just-recorded session. Built from
 * state already captured during recording (per-step thumbnails + selector
 * matches) so it costs nothing extra at runtime — no second browser, no
 * shadow-replay, no race with the auto headed playback that fires next.
 *
 * Mounted on the saving page above the generated-code preview so users can
 * confirm each step looks right before committing the test.
 */
export function TraceScrub({
  events,
  describe,
  replayStatusOf,
  repositoryId,
  onPromoteOptimistic,
}: TraceScrubProps) {
  const actionEvents = useMemo(
    () => events.filter(e => e.type === 'action' || e.type === 'navigation' || e.type === 'screenshot' || e.type === 'assertion'),
    [events],
  );
  const [focusIdx, setFocusIdx] = useState(0);
  const focused = actionEvents[focusIdx];
  const listRef = useRef<HTMLDivElement>(null);

  // Keyboard scrub: ↑/↓ / j/k navigate, Home/End jump.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (actionEvents.length === 0) return;
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (e.key === 'ArrowDown' || e.key === 'j') {
        setFocusIdx(i => Math.min(i + 1, actionEvents.length - 1));
        e.preventDefault();
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        setFocusIdx(i => Math.max(i - 1, 0));
        e.preventDefault();
      } else if (e.key === 'Home') {
        setFocusIdx(0); e.preventDefault();
      } else if (e.key === 'End') {
        setFocusIdx(actionEvents.length - 1); e.preventDefault();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actionEvents.length]);

  // Scroll focused row into view.
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-scrub-idx="${focusIdx}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focusIdx]);

  const counts = useMemo(() => {
    let unique = 0, ambiguous = 0, fragile = 0, repaired = 0;
    for (const e of events) {
      if (e.type !== 'action') continue;
      const m = e.verification?.selectorMatches as StepCardSelectorMatch[] | undefined;
      if (e.verification?.autoRepaired) repaired++;
      if (!m || m.length === 0) {
        if (!replayStatusOf(e).replayable) fragile++;
        continue;
      }
      const chosen = m.find(x => x.value === e.verification?.chosenSelector) ?? m[0];
      if (chosen?.count === 1 || chosen?.count === -1) unique++;
      else if (chosen && chosen.count > 1) ambiguous++;
      else fragile++;
    }
    return { unique, ambiguous, fragile, repaired };
  }, [events, replayStatusOf]);

  if (actionEvents.length === 0) return null;
  const focusedThumb = focused?.data.thumbnailPath;
  const focusedMatches = focused?.verification?.selectorMatches as StepCardSelectorMatch[] | undefined;
  const chosenSelector = focused?.verification?.chosenSelector ?? focused?.data.selector;

  return (
    <TooltipProvider delayDuration={120}>
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-sm">Scrub recorded steps</CardTitle>
            <div className="flex items-center gap-1.5 text-[11px]">
              <span className="px-1.5 py-0 rounded-full border border-green-500/40 bg-green-500/10 text-green-600 dark:text-green-400">
                {counts.unique} unique
              </span>
              {counts.ambiguous > 0 && (
                <span className="px-1.5 py-0 rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400">
                  {counts.ambiguous} ambiguous
                </span>
              )}
              {counts.fragile > 0 && (
                <span className="px-1.5 py-0 rounded-full border border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400">
                  {counts.fragile} fragile
                </span>
              )}
              {counts.repaired > 0 && (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0 rounded-full border border-blue-500/40 bg-blue-500/10 text-blue-600 dark:text-blue-400">
                  <Wand2 className="h-2.5 w-2.5" />
                  {counts.repaired} auto-repaired
                </span>
              )}
            </div>
          </div>
          <div className="text-[11px] text-muted-foreground">
            ↑/↓ to scrub · click a step to focus its thumbnail and alternatives
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div ref={listRef} className="max-h-72 overflow-y-auto space-y-1 pr-1">
              {actionEvents.map((event, i) => (
                <div
                  role="button"
                  tabIndex={0}
                  key={`${event.sequence}-${i}`}
                  data-scrub-idx={i}
                  onClick={() => setFocusIdx(i)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setFocusIdx(i);
                    }
                  }}
                  className={`w-full text-left rounded-md cursor-pointer ${i === focusIdx ? 'bg-muted/60 ring-1 ring-primary/40' : ''}`}
                >
                  <StepCard
                    event={event}
                    description={describe(event)}
                    replayStatus={replayStatusOf(event)}
                    repositoryId={repositoryId}
                    onPromoteOptimistic={onPromoteOptimistic}
                  />
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-2">
              <div className="rounded-md border border-border bg-background min-h-32 flex items-center justify-center overflow-hidden">
                {focusedThumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={focusedThumb} alt="focused step" className="max-h-72 max-w-full" />
                ) : (
                  <div className="text-xs text-muted-foreground p-6 text-center">
                    {focused?.type === 'navigation' ? 'Navigation step (no element thumbnail)' : 'No thumbnail captured for this step'}
                  </div>
                )}
              </div>
              {focused && (
                <div className="text-xs space-y-1">
                  <div className="font-medium text-sm">{describe(focused)}</div>
                  {chosenSelector && (
                    <div className="font-mono text-[11px] truncate" title={chosenSelector}>
                      {chosenSelector}
                    </div>
                  )}
                  {focusedMatches && focusedMatches.length > 0 && (
                    <div className="text-muted-foreground">
                      {focusedMatches.length} candidate{focusedMatches.length > 1 ? 's' : ''} ·
                      {' '}
                      {focusedMatches.filter(m => m.count === 1).length} unique
                    </div>
                  )}
                </div>
              )}
              <div className="flex items-center gap-1 mt-auto">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={focusIdx === 0}
                  onClick={() => setFocusIdx(i => Math.max(0, i - 1))}
                >
                  <ChevronLeft className="h-3 w-3" />
                  Prev
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={focusIdx >= actionEvents.length - 1}
                  onClick={() => setFocusIdx(i => Math.min(actionEvents.length - 1, i + 1))}
                >
                  Next
                  <ChevronRight className="h-3 w-3" />
                </Button>
                <span className="ml-2 text-xs text-muted-foreground tabular-nums">
                  {focusIdx + 1} / {actionEvents.length}
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}
