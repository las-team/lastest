"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { VideoPlayer } from "@/components/video-player";
import { TriageShot } from "@/components/triage/triage-shot";
import { TriageStepLog } from "@/components/triage/triage-step-log";
import { TriageSparkline } from "@/components/triage/triage-sparkline";
import type { TriagePassingVM } from "@/components/triage/types";

const PAGE = 40;

function formatMs(ms: number | null): string | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  return `${(ms / 1000).toFixed(1)}s`;
}

function PassingDetail({ vm }: { vm: TriagePassingVM }) {
  const [playing, setPlaying] = useState(false);
  return (
    <div className="flex flex-col gap-4 bg-muted/40 px-6 py-5 pl-13">
      <div className="flex flex-wrap items-center gap-4 font-mono text-xs text-muted-foreground">
        {vm.areaName && <span>{vm.areaName}</span>}
        {vm.browsers.length > 0 && <span>{vm.browsers.join(", ")}</span>}
        <TriageSparkline history={vm.history} />
        <span className="ml-auto" style={{ color: "var(--tri-ok)" }}>
          ✓ matched baseline
        </span>
      </div>
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
          ) : vm.screenshotSrc ? (
            <TriageShot
              src={vm.screenshotSrc}
              alt={`Screenshot of ${vm.title}`}
              regions={[]}
              height={260}
              onClick={vm.recording ? () => setPlaying(true) : undefined}
              overlayLabel={vm.recording ? "watch recording" : undefined}
            />
          ) : (
            <div className="flex h-[260px] items-center justify-center rounded-md border border-dashed border-border text-center font-mono text-xs text-muted-foreground">
              No screenshot was captured.
            </div>
          )}
        </div>
        <div className="min-h-[262px] min-w-[300px] flex-1">
          <TriageStepLog
            steps={vm.steps}
            failingIndex={null}
            label={vm.title}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Passing tests, collapsed by default and rendered in pages of 40 as the
 * sentinel scrolls into view — a full suite can be several thousand rows and
 * mounting them all would stall the triage loop above.
 */
export function TriagePassingSection({
  passing,
  scrollRootId,
}: {
  passing: TriagePassingVM[];
  scrollRootId: string;
}) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [openId, setOpenId] = useState<string | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  const sentinelRef = useCallback(
    (el: HTMLDivElement | null) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      if (!el) return;
      const io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            setShown((s) => Math.min(passing.length, s + PAGE));
          }
        },
        {
          root: document.getElementById(scrollRootId),
          rootMargin: "400px",
        },
      );
      io.observe(el);
      observerRef.current = io;
    },
    [passing.length, scrollRootId],
  );

  if (passing.length === 0) return null;

  const visible = passing.slice(0, shown);
  const remaining = passing.length - shown;

  return (
    <section id="grp-passing" className="rounded-xl border border-transparent">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-start gap-5 p-5 text-left hover:bg-muted/30"
      >
        <span
          aria-hidden
          className="bg-success mt-1.5 h-2 w-2 flex-none rounded-full"
        />
        <span className="flex flex-wrap items-baseline gap-2.5">
          <span className="text-base font-semibold">Passing tests</span>
          <span className="font-mono text-xs text-muted-foreground">
            {passing.length} passed · nothing to resolve
          </span>
        </span>
        <span className="flex-1" />
        <span
          aria-hidden
          className="mt-0.5 flex-none text-sm text-muted-foreground"
        >
          {open ? "▾" : "▸"}
        </span>
      </button>

      {open && (
        <div className="border-t border-border">
          {visible.map((p, i) => {
            const isLast = i === visible.length - 1 && remaining <= 0;
            const isOpen = openId === p.id;
            return (
              <div
                key={p.id}
                className="border-b border-border last:border-b-0"
              >
                <button
                  type="button"
                  onClick={() => setOpenId(isOpen ? null : p.id)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center gap-3 py-2.5 pl-7 pr-6 text-left hover:bg-muted/40"
                >
                  <span
                    aria-hidden
                    className="relative -my-2.5 w-3.5 flex-none self-stretch"
                  >
                    <span
                      className="absolute left-0 top-0 w-px bg-[var(--tri-connector)]"
                      style={{ bottom: isLast ? "50%" : 0 }}
                    />
                    <span className="absolute left-0 right-0.5 top-1/2 h-px bg-[var(--tri-connector)]" />
                  </span>
                  <span
                    aria-hidden
                    className="bg-success h-1.5 w-1.5 flex-none rounded-full"
                  />
                  <span className="min-w-0 truncate text-sm">{p.title}</span>
                  <span className="flex-1" />
                  {p.areaName && (
                    <span className="hidden flex-none font-mono text-xs text-muted-foreground sm:inline">
                      {p.areaName}
                    </span>
                  )}
                  <span className="w-14 flex-none text-right font-mono text-xs text-muted-foreground">
                    {formatMs(p.durationMs)}
                  </span>
                  <span
                    aria-hidden
                    className="w-3 flex-none text-center text-xs text-muted-foreground"
                  >
                    {isOpen ? "▾" : "▸"}
                  </span>
                </button>
                {isOpen && (
                  <div className="border-t border-border">
                    <PassingDetail vm={p} />
                  </div>
                )}
              </div>
            );
          })}
          {remaining > 0 && (
            <div
              ref={sentinelRef}
              className="px-6 py-3 pl-13 font-mono text-xs text-muted-foreground"
            >
              loading {remaining} more…
            </div>
          )}
        </div>
      )}
    </section>
  );
}
