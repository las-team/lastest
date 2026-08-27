"use client";

import { useState } from "react";
import { VideoPlayer } from "@/components/video-player";
import { TriageShot } from "@/components/triage/triage-shot";
import { TriageStepLog } from "@/components/triage/triage-step-log";
import { TriageSparkline } from "@/components/triage/triage-sparkline";
import { TriageVerdictButtons } from "@/components/triage/triage-verdict-buttons";
import { SNOOZE_DAYS } from "@/components/triage/verdicts";
import type { TriageCaseVM } from "@/components/triage/types";
import type { TriageVerdict } from "@/lib/db/schema";

function formatDuration(ms: number | null): string | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * The expanded panel under a case row: meta line, evidence (screenshot with
 * the changed regions, or the recording), step log, the agent's note, the
 * verdict buttons and a reviewer note.
 */
export function TriageCaseDetail({
  vm,
  verdict,
  note,
  onNoteChange,
  onVerdict,
  onSnooze,
  pending,
}: {
  vm: TriageCaseVM;
  verdict: TriageVerdict | null;
  note: string;
  onNoteChange: (value: string) => void;
  onVerdict: (verdict: TriageVerdict) => void;
  onSnooze: () => void;
  pending: boolean;
}) {
  const [playing, setPlaying] = useState(false);
  const tone = vm.status === "review" ? "warn" : "bad";
  const duration = formatDuration(vm.recording?.durationMs ?? null);

  const diffStat =
    vm.diffPct != null
      ? `diff · ${vm.diffPct.toFixed(1)}%` +
        (vm.regionCount > 0
          ? ` · ${vm.regionCount} ${vm.regionCount === 1 ? "region" : "regions"}`
          : "")
      : vm.regionCount > 0
        ? `${vm.regionCount} changed ${vm.regionCount === 1 ? "region" : "regions"}`
        : null;

  return (
    <div className="flex flex-col gap-4 bg-muted/40 px-6 py-5 pl-13">
      {/* Meta line */}
      <div className="flex flex-wrap items-center gap-4 font-mono text-xs text-muted-foreground">
        {vm.areaName && <span>{vm.areaName}</span>}
        <span>{vm.title}</span>
        {vm.browsers.length > 0 && <span>{vm.browsers.join(", ")}</span>}
        <TriageSparkline history={vm.history} />
        {diffStat && (
          <span
            className="ml-auto"
            style={{
              color: tone === "warn" ? "var(--tri-warn)" : "var(--tri-bad)",
            }}
          >
            {diffStat}
          </span>
        )}
      </div>

      {/* Evidence + step log */}
      <div className="flex flex-wrap gap-3">
        <div className="min-w-[300px] flex-[0_0_420px]">
          {playing && vm.recording ? (
            <VideoPlayer
              src={vm.recording.src}
              poster={vm.recording.posterSrc ?? undefined}
              durationMsFallback={vm.recording.durationMs}
              autoPlay
              preload="metadata"
              ariaLabel={`Recording of ${vm.title}`}
              className="w-full overflow-hidden rounded-md border border-border"
            />
          ) : vm.current ? (
            <TriageShot
              src={vm.current.src}
              alt={`Current screenshot of ${vm.title}`}
              regions={vm.current.regions}
              tone={tone}
              height={260}
              onClick={vm.recording ? () => setPlaying(true) : undefined}
              overlayLabel={
                vm.recording
                  ? `watch recording${duration ? ` · ${duration}` : ""}`
                  : undefined
              }
            />
          ) : vm.recording ? (
            <VideoPlayer
              src={vm.recording.src}
              poster={vm.recording.posterSrc ?? undefined}
              durationMsFallback={vm.recording.durationMs}
              preload="metadata"
              ariaLabel={`Recording of ${vm.title}`}
              className="w-full overflow-hidden rounded-md border border-border"
            />
          ) : (
            <div className="flex h-[260px] items-center justify-center rounded-md border border-dashed border-border text-center font-mono text-xs text-muted-foreground">
              No screenshot or recording was captured.
            </div>
          )}
          {vm.baseline && (
            <details className="mt-2">
              <summary className="cursor-pointer font-mono text-xs text-muted-foreground">
                compare with baseline
              </summary>
              <div className="mt-2">
                <TriageShot
                  src={vm.baseline.src}
                  alt={`Baseline screenshot of ${vm.title}`}
                  regions={[]}
                  height={200}
                />
                <div className="mt-1 text-center font-mono text-xs text-muted-foreground">
                  baseline
                </div>
              </div>
            </details>
          )}
        </div>
        <div className="min-h-[262px] min-w-[300px] flex-1">
          <TriageStepLog
            steps={vm.steps}
            failingIndex={vm.failingStepIndex}
            label={vm.title}
          />
        </div>
      </div>

      {vm.note && (
        <p className="m-0 font-mono text-xs text-muted-foreground">
          ✦ {vm.note}
        </p>
      )}

      {/* Verdicts */}
      <div className="flex flex-wrap items-center gap-2">
        <TriageVerdictButtons
          current={verdict}
          onVerdict={onVerdict}
          disabled={pending}
          idPrefix={`case-${vm.id}`}
        />
        <div className="flex-1" />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSnooze();
          }}
          disabled={pending}
          className="rounded px-1.5 py-0.5 font-mono text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          snooze {SNOOZE_DAYS}d
        </button>
      </div>

      <label className="flex flex-col gap-1">
        <span className="font-mono text-xs text-muted-foreground">
          reviewer note
        </span>
        <textarea
          value={note}
          onChange={(e) => onNoteChange(e.target.value)}
          rows={2}
          placeholder="Saved with the next verdict you record on this case."
          className="w-full resize-y rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>
    </div>
  );
}
