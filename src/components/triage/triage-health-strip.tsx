"use client";

import type {
  TriageAreaHealthVM,
  TriageCountsVM,
} from "@/components/triage/types";

function pct(part: number, total: number): number {
  return total > 0 ? (part / total) * 100 : 0;
}

/**
 * Passed / failed / review counters, a stacked ratio bar, and — once expanded
 * — a per-functional-area breakdown.
 *
 * Unlike the design prototype, each area row is a real filter: clicking it
 * narrows the groups and cases below to that area. The screen has no other
 * filtering affordance, and an expandable panel that only restates the numbers
 * already on the strip would not earn its click.
 */
export function TriageHealthStrip({
  counts,
  totalTests,
  browsers,
  areas,
  open,
  onToggle,
  activeAreaId,
  onSelectArea,
}: {
  counts: TriageCountsVM;
  totalTests: number | null;
  browsers: string[];
  areas: TriageAreaHealthVM[];
  open: boolean;
  onToggle: () => void;
  /** `undefined` = no filter; `null` = the "Uncategorised" bucket. */
  activeAreaId: string | null | undefined;
  onSelectArea: (areaId: string | null | undefined) => void;
}) {
  const passed = counts.passed ?? 0;
  const failed = counts.failed ?? 0;
  const review = counts.review ?? 0;
  const total = passed + failed + review;

  const tiles: Array<{ n: number | null; label: string; color: string }> = [
    { n: counts.passed, label: "passed", color: "var(--tri-ok)" },
    { n: counts.failed, label: "failed", color: "var(--tri-bad)" },
    { n: counts.review, label: "review_required", color: "var(--tri-warn)" },
  ];

  return (
    <div className="mt-10">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-7 rounded-lg py-2 text-left hover:bg-muted/30"
        title="Show per-area breakdown"
      >
        {tiles.map(
          (t) =>
            t.n != null && (
              <span key={t.label} className="flex items-center gap-2">
                <span
                  className="font-mono text-3xl font-semibold leading-none"
                  style={{ color: t.color }}
                >
                  {t.n}
                </span>
                <span className="text-xs text-muted-foreground">{t.label}</span>
              </span>
            ),
        )}
        {total > 0 && (
          <span
            className="flex h-2.5 min-w-[200px] flex-1 gap-0.5 overflow-hidden rounded-full"
            role="img"
            aria-label={`${passed} passed, ${failed} failed, ${review} needing review`}
          >
            <span
              className="bg-success"
              style={{ width: `${pct(passed, total)}%` }}
            />
            <span
              className="bg-danger"
              style={{ width: `${pct(failed, total)}%` }}
            />
            <span
              className="bg-warning"
              style={{ width: `${pct(review, total)}%` }}
            />
          </span>
        )}
        <span className="flex-none font-mono text-xs text-muted-foreground">
          {totalTests != null ? `${totalTests} tests` : null}
          {totalTests != null && browsers.length > 0 ? " · " : null}
          {browsers.length > 0
            ? `${browsers.length} ${browsers.length === 1 ? "browser" : "browsers"}`
            : null}
        </span>
        <span aria-hidden className="flex-none text-xs text-muted-foreground">
          {open ? "▾" : "▸"}
        </span>
      </button>

      {open && (
        <div className="mt-3 flex flex-col">
          {activeAreaId !== undefined && (
            <button
              type="button"
              onClick={() => onSelectArea(undefined)}
              className="self-start rounded px-1.5 py-1 font-mono text-xs"
              style={{ color: "var(--tri-ok)" }}
            >
              ← clear area filter
            </button>
          )}
          {areas.length === 0 && (
            <p className="py-2 text-sm text-muted-foreground">
              No functional areas are attached to this run&apos;s tests.
            </p>
          )}
          {areas.map((a) => {
            const bad = a.failed + a.review;
            const active = activeAreaId === a.id;
            return (
              <button
                key={a.id ?? "__none__"}
                type="button"
                aria-pressed={active}
                onClick={() => onSelectArea(active ? undefined : a.id)}
                className={`flex items-center gap-3 rounded px-1.5 py-1.5 text-left hover:bg-muted/50 ${
                  active ? "bg-muted" : ""
                }`}
              >
                <span className="w-[170px] flex-none truncate text-sm text-muted-foreground">
                  {a.name}
                </span>
                <span className="w-[60px] flex-none text-right font-mono text-xs text-muted-foreground">
                  {a.tests}
                </span>
                <span
                  className="flex h-[5px] flex-1 gap-px overflow-hidden rounded-full"
                  style={{ opacity: bad ? 1 : 0.35 }}
                  aria-hidden
                >
                  <span
                    className="bg-success"
                    style={{ width: `${pct(a.passed, a.tests)}%` }}
                  />
                  <span
                    className="bg-danger"
                    style={{ width: `${pct(a.failed, a.tests)}%` }}
                  />
                  <span
                    className="bg-warning"
                    style={{ width: `${pct(a.review, a.tests)}%` }}
                  />
                </span>
                <span
                  className="w-[160px] flex-none text-right font-mono text-xs"
                  style={{
                    color: a.failed
                      ? "var(--tri-bad)"
                      : a.review
                        ? "var(--tri-warn)"
                        : "var(--tri-ok)",
                  }}
                >
                  {a.failed
                    ? `${a.failed} failed${a.review ? ` · ${a.review} review` : ""}`
                    : a.review
                      ? `${a.review} review_required`
                      : "all passed"}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
