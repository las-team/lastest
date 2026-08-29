"use client";

import { ArrowRight, Grid3x3, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCoverageData } from "./coverage-context";

const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;

/**
 * The data-coverage rail on the Coverage canvas.
 *
 * Two scopes in one column, and the split between them is the point of the
 * merged screen: the top half is the repository's data space (the numbers the
 * old /coverage page led with), the bottom half is *this page's* slice of it,
 * resolved through `page-attribution.ts`.
 *
 * The per-page half is deliberately one-sided — it reports what has run
 * through the page and never a "x of y cells" ratio, because an uncovered cell
 * has no run and therefore no page. See `page-attribution.ts` for why that
 * denominator cannot honestly exist.
 */
export function CoverageRail({
  selectedPath,
  selectedTitle,
  selectedStatus,
  onOpenGaps,
  onOpenData,
}: {
  selectedPath: string | null;
  selectedTitle: string | null;
  selectedStatus: "covered" | "planned" | "uncovered" | null;
  onOpenGaps: () => void;
  onOpenData: () => void;
}) {
  const data = useCoverageData();
  if (!data) return null;

  const page = selectedPath ? (data.pageCoverage[selectedPath] ?? null) : null;

  if (!data.hasModel) {
    return (
      <div className="flex h-full w-full flex-col gap-3 p-3">
        <RailHeading strength={data.strength} />
        <p className="text-xs leading-relaxed text-muted-foreground">
          No data-coverage model yet. Coverage here is measured over the
          application&apos;s data space — the combinations of values that
          actually occur — not over its page count.
        </p>
        <button
          type="button"
          onClick={onOpenData}
          className="flex h-8 items-center justify-center gap-1.5 rounded-md border bg-card px-3 text-xs font-medium hover:bg-muted"
        >
          Set up dimensions <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto">
      {/* ── Repository-wide ─────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2.5 border-b p-3">
        <RailHeading strength={data.strength} />
        <div className="grid grid-cols-2 gap-2">
          <Tile
            value={pct(data.tupleCoverage)}
            label={`${data.strength}-way · target ${pct(data.pairwiseTarget)}`}
            good={data.tupleCoverage >= data.pairwiseTarget}
          />
          <Tile
            value={pct(data.weightedVolumeCoverage)}
            label={`volume · target ${pct(data.weightedVolumeTarget)}`}
            good={data.weightedVolumeCoverage >= data.weightedVolumeTarget}
          />
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {data.coveredCells}/{data.eligibleCells} cells covered ·{" "}
          {data.excludedCells} excluded · {data.skippedAsNonOccurring}{" "}
          combination(s) never occur in the data.
        </p>
      </div>

      {/* ── This page ───────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2.5 border-b bg-primary/5 p-3">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Selected page
        </div>

        {!selectedPath ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            Select a page on the map to see which data combinations have
            actually run through it.
          </p>
        ) : (
          <>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold">
                  {selectedTitle ?? selectedPath}
                </div>
                <div className="truncate font-mono text-[11px] text-muted-foreground">
                  {selectedPath}
                </div>
              </div>
              {selectedStatus ? (
                <span
                  className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium text-white"
                  style={{ backgroundColor: STATUS_COLOR[selectedStatus] }}
                >
                  {STATUS_LABEL[selectedStatus]}
                </span>
              ) : null}
            </div>

            {page ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <Tile
                    value={String(page.cellCount)}
                    label={
                      page.cellCount === 1
                        ? "cell exercised here"
                        : "cells exercised here"
                    }
                    plain
                  />
                  <Tile
                    value={page.records.toLocaleString()}
                    label="records behind them"
                    plain
                  />
                </div>
                {page.failedCells > 0 ? (
                  <p className="text-[11px] text-destructive">
                    {page.failedCells} of them last ran red.
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-xs leading-relaxed text-muted-foreground">
                No run that exercised a data cell has passed through this page
                yet. Coverage here is attributed from runs, so a page only
                appears once a data-driven test walks it.
              </p>
            )}
          </>
        )}
      </div>

      {/* ── Dimensions ──────────────────────────────────────────────────── */}
      {data.dimensions.length > 0 ? (
        <div className="flex flex-col gap-3 border-b p-3">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {page ? "Values seen on this page" : "Dimensions"}
          </div>
          {data.dimensions.map((d) => {
            const seenHere = page?.valuesSeen[d.field] ?? null;
            const hitCount = seenHere
              ? d.values.filter((v) => seenHere.includes(v.value)).length
              : d.values.filter((v) => v.covered).length;
            return (
              <div key={`${d.objectType}.${d.field}`} className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <code className="truncate text-[11px]">{d.field}</code>
                  <span className="shrink-0 tabular-nums text-[11px] text-muted-foreground">
                    {hitCount}/{d.values.length} values
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {d.values.map((v) => {
                    // With a page selected the chips answer "seen *here*";
                    // with none they answer "covered anywhere". Mixing the two
                    // would make a green chip mean two different things.
                    const hit = seenHere
                      ? seenHere.includes(v.value)
                      : v.covered;
                    return (
                      <span
                        key={v.value}
                        title={`${v.recordCount.toLocaleString()} record(s)`}
                        className={cn(
                          "rounded border px-1.5 py-0.5 text-[11px] tabular-nums",
                          hit
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                            : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
                        )}
                      >
                        {v.value}
                        <span className="ml-1 opacity-60">{v.recordCount}</span>
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {/* ── Gap queue ───────────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-center gap-1.5">
          <Target className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Top gaps
          </span>
          <span className="ml-auto text-[11px] text-muted-foreground">
            {Math.min(3, data.outstanding.length)} of {data.outstanding.length}
          </span>
        </div>

        {data.outstanding.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Every occurring combination has been exercised at least once.
          </p>
        ) : (
          data.outstanding.slice(0, 3).map((c) => (
            <div
              key={c.coordsKey}
              className="rounded-md border px-2.5 py-2 text-xs"
            >
              <div className="truncate font-mono text-[11px]">
                {Object.entries(c.coords)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([, v]) => v)
                  .join(" · ")}
              </div>
              <div className="mt-0.5 text-[10px] tabular-nums text-muted-foreground">
                {c.observedCount.toLocaleString()} records · weight{" "}
                {c.weight.toFixed(2)}
              </div>
            </div>
          ))
        )}

        {data.outstanding.length > 0 ? (
          <button
            type="button"
            onClick={onOpenGaps}
            className="mt-auto flex h-8 items-center justify-center gap-1.5 rounded-md border bg-card px-3 text-xs font-medium hover:bg-muted"
          >
            Open all {data.outstanding.length} in Gaps
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

// Mirrors the App Map's node badge colors — the rail and the canvas must never
// disagree about what "covered" looks like.
const STATUS_COLOR: Record<"covered" | "planned" | "uncovered", string> = {
  covered: "#3f9142",
  planned: "#E09836",
  uncovered: "#9ca3af",
};
const STATUS_LABEL: Record<"covered" | "planned" | "uncovered", string> = {
  covered: "Covered",
  planned: "Planned",
  uncovered: "No coverage",
};

function RailHeading({ strength }: { strength: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <Grid3x3 className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="text-sm font-semibold">Data coverage</span>
      <span className="ml-auto text-[11px] text-muted-foreground">
        {strength}-way
      </span>
    </div>
  );
}

function Tile({
  value,
  label,
  good,
  plain,
}: {
  value: string;
  label: string;
  good?: boolean;
  plain?: boolean;
}) {
  return (
    <div className="rounded-md border px-2.5 py-2">
      <div
        className={cn(
          "text-lg font-semibold tabular-nums",
          !plain &&
            (good
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-amber-600 dark:text-amber-400"),
        )}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[10px] leading-tight text-muted-foreground">
        {label}
      </div>
    </div>
  );
}
