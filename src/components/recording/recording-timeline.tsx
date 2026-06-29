"use client";

import { TooltipProvider } from "@/components/ui/tooltip";
import { StepCard, type StepCardEvent } from "@/components/recording/step-card";
import {
  getEventDescription,
  isActionReplayable,
  type TimelineEvent,
} from "@/lib/recording/timeline-events";

interface RecordingTimelineProps {
  events: StepCardEvent[];
  repositoryId?: string | null;
  /** Parent owns event state; lets a card optimistically reflect a promoted
   *  selector before the runner round-trips back. Omit in read-only contexts
   *  (e.g. the debug recording view, where the buffer is server-driven). */
  onPromoteOptimistic?: (actionId: string, selectorValue: string) => void;
  /** Forwarded to the scrollable list so the parent can auto-scroll on append. */
  scrollRef?: React.Ref<HTMLDivElement>;
}

/**
 * The recording "Timeline" panel: a fixed-width list of per-action StepCards.
 * Shared between the /record flow and the test debug "record from here" view.
 */
export function RecordingTimeline({
  events,
  repositoryId,
  onPromoteOptimistic,
  scrollRef,
}: RecordingTimelineProps) {
  return (
    <div className="h-full bg-card border-l border-border overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border w-72">
        <span className="text-sm font-medium text-foreground">Timeline</span>
        <span className="text-xs text-muted-foreground">
          {events.length} events
        </span>
      </div>
      <TooltipProvider delayDuration={120}>
        <div
          ref={scrollRef}
          className="overflow-y-auto overflow-x-hidden p-2.5 space-y-1 w-72"
          style={{ maxHeight: "calc(100% - 41px)" }}
        >
          {events.length === 0 ? (
            <div className="text-center py-4 text-muted-foreground text-sm">
              Waiting for interactions...
            </div>
          ) : (
            events.map((event) => (
              <StepCard
                key={event.sequence}
                event={event}
                description={getEventDescription(event as TimelineEvent)}
                replayStatus={isActionReplayable(event as TimelineEvent)}
                repositoryId={repositoryId}
                onPromoteOptimistic={onPromoteOptimistic}
              />
            ))
          )}
        </div>
      </TooltipProvider>
    </div>
  );
}
