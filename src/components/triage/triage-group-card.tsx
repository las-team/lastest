"use client";

import { TriageCaseRow } from "@/components/triage/triage-case-row";
import { TriageShot } from "@/components/triage/triage-shot";
import { TriageVerdictButtons } from "@/components/triage/triage-verdict-buttons";
import { TriageIssueActions } from "@/components/triage/triage-issue-actions";
import type { TriageCaseVM, TriageGroupVM } from "@/components/triage/types";
import type { TriageVerdict } from "@/lib/db/schema";

function countLabel(cases: TriageCaseVM[]): string {
  const failed = cases.filter((c) => c.status === "failed").length;
  const review = cases.length - failed;
  const parts: string[] = [];
  if (failed) parts.push(`${failed} failed`);
  if (review) parts.push(`${review} to review`);
  return parts.join(" · ");
}

/**
 * One root-cause cluster. Collapsed it is a headline, the agent's note and a
 * baseline/current thumbnail pair; expanded it adds a sticky bulk bar (which
 * applies one verdict to the whole cluster) and the case rows.
 *
 * There is deliberately no run-wide "resolve all" — bulk resolution is scoped
 * to a cluster, because a cluster is the unit the agent claims shares a cause.
 */
export function TriageGroupCard({
  group,
  cases,
  isOpen,
  onToggle,
  openCaseId,
  onToggleCase,
  verdicts,
  notes,
  onNoteChange,
  onVerdict,
  onSnooze,
  onBulkVerdict,
  pendingKeys,
  bulkPending,
}: {
  group: TriageGroupVM;
  cases: TriageCaseVM[];
  isOpen: boolean;
  onToggle: () => void;
  openCaseId: string | null;
  onToggleCase: (caseId: string) => void;
  verdicts: Record<string, { verdict: TriageVerdict } | undefined>;
  notes: Record<string, string>;
  onNoteChange: (key: string, value: string) => void;
  onVerdict: (vm: TriageCaseVM, verdict: TriageVerdict) => void;
  onSnooze: (vm: TriageCaseVM) => void;
  onBulkVerdict: (group: TriageGroupVM, verdict: TriageVerdict) => void;
  pendingKeys: Set<string>;
  bulkPending: boolean;
}) {
  const resolved = cases.filter((c) => verdicts[c.verdictKey]).length;
  const anyFailed = cases.some((c) => c.status === "failed");
  const tone = anyFailed ? "bad" : "warn";
  const dot = anyFailed ? "var(--tri-bad-fill)" : "var(--tri-warn-fill)";

  return (
    <section
      id={`group-${group.slug}`}
      className="overflow-clip rounded-xl border border-border bg-card shadow-sm"
      aria-labelledby={`group-heading-${group.slug}`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="flex w-full items-start gap-5 p-5 text-left hover:bg-muted/30"
      >
        <span
          aria-hidden
          className="mt-1.5 h-2 w-2 flex-none rounded-full"
          style={{ background: dot }}
        />
        <span className="flex min-w-0 flex-1 flex-col items-start gap-2">
          <span className="flex flex-wrap items-baseline gap-2.5">
            <span
              id={`group-heading-${group.slug}`}
              className="text-base font-semibold"
            >
              {group.headline}
            </span>
            <span className="font-mono text-xs text-muted-foreground">
              {countLabel(cases)}
            </span>
          </span>
          <span className="m-0 max-w-[48ch] text-sm leading-relaxed text-muted-foreground">
            {group.note}
          </span>
          {resolved > 0 && (
            <span
              className="font-mono text-xs"
              style={{ color: "var(--tri-ok)" }}
            >
              ✓ {resolved} of {cases.length} resolved
            </span>
          )}
        </span>
        {(group.baseline || group.current) && (
          <span className="hidden flex-none gap-3 self-center lg:flex">
            {group.baseline && (
              <span className="block w-[180px]">
                <TriageShot
                  src={group.baseline.src}
                  alt={`Baseline for ${group.headline}`}
                  regions={[]}
                  height={120}
                />
                <span className="mt-1 block text-center font-mono text-xs text-muted-foreground">
                  baseline
                </span>
              </span>
            )}
            {group.current && (
              <span className="block w-[180px]">
                <TriageShot
                  src={group.current.src}
                  alt={`This run for ${group.headline}`}
                  regions={group.current.regions}
                  tone={tone}
                  height={120}
                />
                <span
                  className="mt-1 block text-center font-mono text-xs"
                  style={{
                    color:
                      tone === "warn" ? "var(--tri-warn)" : "var(--tri-bad)",
                  }}
                >
                  this run
                </span>
              </span>
            )}
          </span>
        )}
        <span
          aria-hidden
          className="mt-0.5 flex-none text-sm text-muted-foreground"
        >
          {isOpen ? "▾" : "▸"}
        </span>
      </button>

      {isOpen && (
        <div className="border-t border-border">
          <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-border bg-muted px-6 py-3">
            {resolved < cases.length && (
              <span
                className="font-mono text-xs font-semibold"
                style={{ color: "var(--tri-ok)" }}
              >
                resolve all {cases.length} below →
              </span>
            )}
            <TriageIssueActions
              group={{
                id: group.id,
                headline: group.headline,
                githubIssueUrl: group.githubIssueUrl,
                githubIssueNumber: group.githubIssueNumber,
                githubIssueState: group.githubIssueState,
                githubIssueKind: group.githubIssueKind,
              }}
              caseCount={cases.length}
            />
            <div className="flex-1" />
            {resolved < cases.length && (
              <TriageVerdictButtons
                variant="bulk"
                onVerdict={(v) => onBulkVerdict(group, v)}
                disabled={bulkPending}
                idPrefix={`group-${group.slug}`}
              />
            )}
          </div>
          {cases.map((c, i) => (
            <TriageCaseRow
              key={c.id}
              vm={c}
              isLast={i === cases.length - 1}
              isOpen={openCaseId === c.id}
              onToggle={() => onToggleCase(c.id)}
              verdict={verdicts[c.verdictKey]?.verdict ?? null}
              note={notes[c.verdictKey] ?? ""}
              onNoteChange={(v) => onNoteChange(c.verdictKey, v)}
              onVerdict={(v) => onVerdict(c, v)}
              onSnooze={() => onSnooze(c)}
              pending={pendingKeys.has(c.verdictKey)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
