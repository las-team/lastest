"use client";

import { forwardRef } from "react";
import { TriageCaseDetail } from "@/components/triage/triage-case-detail";
import { verdictLabel } from "@/components/triage/verdicts";
import type { TriageCaseVM } from "@/components/triage/types";
import type { TriageVerdict } from "@/lib/db/schema";

/**
 * One case in a group: tree connector, status dot, title, verdict badge and
 * chevron — with the detail panel underneath when expanded.
 *
 * The row is a real `<button>` so the keyboard loop never has to trap focus:
 * j/k move the selection, but Tab still walks the page normally.
 */
export const TriageCaseRow = forwardRef<
  HTMLDivElement,
  {
    vm: TriageCaseVM;
    isLast: boolean;
    isOpen: boolean;
    onToggle: () => void;
    verdict: TriageVerdict | null;
    note: string;
    onNoteChange: (value: string) => void;
    onVerdict: (verdict: TriageVerdict) => void;
    onSnooze: () => void;
    pending: boolean;
  }
>(function TriageCaseRow(
  {
    vm,
    isLast,
    isOpen,
    onToggle,
    verdict,
    note,
    onNoteChange,
    onVerdict,
    onSnooze,
    pending,
  },
  ref,
) {
  const decided = Boolean(verdict);
  const dot =
    vm.status === "review" ? "var(--tri-warn-fill)" : "var(--tri-bad-fill)";

  return (
    <div
      ref={ref}
      id={`case-${vm.id}`}
      className="border-b border-border last:border-b-0"
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={`case-panel-${vm.id}`}
        className="flex w-full items-center gap-3 py-2.5 pl-7 pr-6 text-left hover:bg-muted/40"
        style={{ opacity: decided ? 0.7 : 1 }}
      >
        {/* Tree connector */}
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
          className="h-1.5 w-1.5 flex-none rounded-full"
          style={{ background: dot }}
        />
        <span
          className="min-w-0 truncate text-sm"
          style={{
            textDecoration: decided ? "line-through" : "none",
            color: decided ? "var(--muted-foreground)" : undefined,
          }}
        >
          {vm.title}
          {vm.stepLabel ? (
            <span className="text-muted-foreground"> › {vm.stepLabel}</span>
          ) : null}
        </span>
        {verdict && (
          <span
            className="flex-none font-mono text-xs"
            style={{ color: "var(--tri-ok)" }}
          >
            ✓ {verdictLabel(verdict)}
          </span>
        )}
        <span className="flex-1" />
        <span
          aria-hidden
          className="w-3 flex-none text-center text-xs text-muted-foreground"
        >
          {isOpen ? "▾" : "▸"}
        </span>
      </button>
      {isOpen && (
        <div
          id={`case-panel-${vm.id}`}
          className="relative border-t border-border"
        >
          {!isLast && (
            <span
              aria-hidden
              className="absolute bottom-0 left-[30px] top-0 w-px bg-[var(--tri-connector)]"
            />
          )}
          <TriageCaseDetail
            vm={vm}
            verdict={verdict}
            note={note}
            onNoteChange={onNoteChange}
            onVerdict={onVerdict}
            onSnooze={onSnooze}
            pending={pending}
          />
        </div>
      )}
    </div>
  );
});
