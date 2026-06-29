"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Play,
  Pause,
  Camera,
  CheckCircle2,
  ChevronDown,
  Download,
  CalendarClock,
  Timer,
  ListFilter,
  Maximize2,
  Minimize2,
  Square,
  Loader2,
} from "lucide-react";
import type {
  WaitType,
  WaitSelectorCondition,
  WaitParams,
  AssertionType,
} from "@/lib/playwright/types";

export type AssertionKind = AssertionType;

interface WaitPopoverBodyProps {
  mode: WaitType;
  setMode: (m: WaitType) => void;
  durationMs: string;
  setDurationMs: (v: string) => void;
  selector: string;
  setSelector: (v: string) => void;
  condition: WaitSelectorCondition;
  setCondition: (c: WaitSelectorCondition) => void;
  timeoutMs: string;
  setTimeoutMs: (v: string) => void;
  onInsert: () => void;
}

function WaitPopoverBody({
  mode,
  setMode,
  durationMs,
  setDurationMs,
  selector,
  setSelector,
  condition,
  setCondition,
  timeoutMs,
  setTimeoutMs,
  onInsert,
}: WaitPopoverBodyProps) {
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <div className="text-sm font-medium">Insert Wait</div>
        <div className="text-xs text-muted-foreground">
          Pause the test at this point — useful for slow async UIs.
        </div>
      </div>
      <div className="flex gap-2 text-xs">
        <button
          type="button"
          onClick={() => setMode("duration")}
          className={`px-2 py-1 rounded border ${mode === "duration" ? "bg-primary text-primary-foreground border-primary" : "bg-muted/40 border-border"}`}
        >
          Duration
        </button>
        <button
          type="button"
          onClick={() => setMode("selector")}
          className={`px-2 py-1 rounded border ${mode === "selector" ? "bg-primary text-primary-foreground border-primary" : "bg-muted/40 border-border"}`}
        >
          Wait for selector
        </button>
      </div>
      {mode === "duration" ? (
        <div className="space-y-1">
          <label className="text-xs font-medium">Duration (ms)</label>
          <Input
            type="number"
            min={0}
            value={durationMs}
            onChange={(e) => setDurationMs(e.target.value)}
            placeholder="3000"
          />
          <div className="text-xs text-muted-foreground">
            e.g. <code>180000</code> = 3 minutes
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="space-y-1">
            <label className="text-xs font-medium">Selector</label>
            <Input
              value={selector}
              onChange={(e) => setSelector(e.target.value)}
              placeholder="#status, .build-done, [data-state='ready']"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-xs font-medium">Condition</label>
              <select
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                value={condition}
                onChange={(e) =>
                  setCondition(e.target.value as WaitSelectorCondition)
                }
              >
                <option value="visible">visible</option>
                <option value="hidden">hidden</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Timeout (ms)</label>
              <Input
                type="number"
                min={0}
                value={timeoutMs}
                onChange={(e) => setTimeoutMs(e.target.value)}
                placeholder="30000"
              />
            </div>
          </div>
        </div>
      )}
      <div className="flex justify-end">
        <Button size="sm" onClick={onInsert}>
          Insert
        </Button>
      </div>
    </div>
  );
}

export interface RecordingControlsProps {
  isPaused: boolean;
  onScreenshot: () => void;
  onAssertion: (kind: AssertionKind) => void;
  onFlagDownload: () => void;
  onInsertTimestamp: () => void;
  onInsertWait: (params: WaitParams) => void;
  onStop: () => void;
  stopDisabled?: boolean;
  stopBusy?: boolean;
  /** When provided, renders the pause/resume button (record flow only — debug
   *  recording has no recorder-level pause). */
  onTogglePause?: () => void;
  /** When provided, renders the fullscreen toggle (record flow only). */
  onToggleFullscreen?: () => void;
  isFullscreen?: boolean;
  /** When provided, renders the show/hide-timeline toggle (record flow only —
   *  debug always shows the timeline). `timelineOpen` drives the active state. */
  onToggleTimeline?: () => void;
  timelineOpen?: boolean;
}

/**
 * Floating recording control pill (bottom-center). Shared between the /record
 * flow and the test debug "record from here" view. The timeline-toggle button
 * from the original record-only menu is intentionally omitted.
 */
export function RecordingControls({
  isPaused,
  onScreenshot,
  onAssertion,
  onFlagDownload,
  onInsertTimestamp,
  onInsertWait,
  onStop,
  stopDisabled,
  stopBusy,
  onTogglePause,
  onToggleFullscreen,
  isFullscreen,
  onToggleTimeline,
  timelineOpen,
}: RecordingControlsProps) {
  const [waitPopoverOpen, setWaitPopoverOpen] = useState(false);
  const [waitMode, setWaitMode] = useState<WaitType>("duration");
  const [waitDurationMs, setWaitDurationMs] = useState("3000");
  const [waitSelector, setWaitSelector] = useState("");
  const [waitCondition, setWaitCondition] =
    useState<WaitSelectorCondition>("visible");
  const [waitTimeoutMs, setWaitTimeoutMs] = useState("30000");

  const handleInsertWait = () => {
    const params: WaitParams =
      waitMode === "duration"
        ? { waitType: "duration", durationMs: Number(waitDurationMs) }
        : {
            waitType: "selector",
            selector: waitSelector.trim(),
            condition: waitCondition,
            timeoutMs: Number(waitTimeoutMs),
          };
    onInsertWait(params);
    setWaitPopoverOpen(false);
  };

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 layer-playback-controls flex items-center gap-1.5 px-3 py-1.5 bg-card/95 backdrop-blur-sm border border-border rounded-full shadow-2xl">
      <div className="flex items-center gap-2 px-1">
        <div
          className={`h-2.5 w-2.5 rounded-full ${isPaused ? "bg-yellow-500" : "bg-red-500 animate-pulse"}`}
        />
        <span className="text-sm font-medium text-foreground">
          {isPaused ? "Paused" : "Recording"}
        </span>
      </div>
      <div className="w-px h-5 bg-border" />
      {onTogglePause && (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onTogglePause}
          title={isPaused ? "Resume recording" : "Pause recording"}
        >
          {isPaused ? (
            <Play className="h-4 w-4" />
          ) : (
            <Pause className="h-4 w-4" />
          )}
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={onScreenshot}
        title="Screenshot"
        data-tutorial-target="screenshot"
      >
        <Camera className="h-4 w-4" />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1 px-2"
            data-tutorial-target="assertion"
          >
            <CheckCircle2 className="h-4 w-4" />
            <ChevronDown className="h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={() => onAssertion("pageLoad")}>
            Page Load
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onAssertion("networkIdle")}>
            Network Idle
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onAssertion("urlMatch")}>
            URL Match
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onAssertion("domContentLoaded")}>
            DOM Content Loaded
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={onFlagDownload}
        title="Wait for Download"
        data-tutorial-target="download"
      >
        <Download className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={onInsertTimestamp}
        title="Insert Timestamp"
      >
        <CalendarClock className="h-4 w-4" />
      </Button>
      <Popover open={waitPopoverOpen} onOpenChange={setWaitPopoverOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            title="Insert Wait"
          >
            <Timer className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="center" className="w-80">
          <WaitPopoverBody
            mode={waitMode}
            setMode={setWaitMode}
            durationMs={waitDurationMs}
            setDurationMs={setWaitDurationMs}
            selector={waitSelector}
            setSelector={setWaitSelector}
            condition={waitCondition}
            setCondition={setWaitCondition}
            timeoutMs={waitTimeoutMs}
            setTimeoutMs={setWaitTimeoutMs}
            onInsert={handleInsertWait}
          />
        </PopoverContent>
      </Popover>
      {(onToggleTimeline || onToggleFullscreen) && (
        <div className="w-px h-5 bg-border" />
      )}
      {onToggleTimeline && (
        <Button
          variant="ghost"
          size="icon"
          className={`h-8 w-8 ${timelineOpen ? "bg-muted" : ""}`}
          onClick={onToggleTimeline}
          title="Toggle timeline"
          data-tutorial-target="timeline"
        >
          <ListFilter className="h-4 w-4" />
        </Button>
      )}
      {onToggleFullscreen && (
        <>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onToggleFullscreen}
            title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          >
            {isFullscreen ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </Button>
        </>
      )}
      <div className="w-px h-5 bg-border" />
      <Button
        onClick={onStop}
        disabled={stopDisabled}
        className="h-8 bg-red-600 hover:bg-red-700 text-white rounded-full px-3 gap-1.5"
      >
        {stopBusy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Square className="h-3.5 w-3.5" />
        )}
        Stop
      </Button>
    </div>
  );
}
