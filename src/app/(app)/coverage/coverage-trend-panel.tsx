"use client";

import { useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { CoverageSnapshotSource } from "@/lib/db/schema";

export interface CoverageTrendPoint {
  capturedAt: string;
  buildId: string | null;
  source: CoverageSnapshotSource;
  totalCells: number;
  coveredCells: number;
  excludedCells: number;
  failingCells: number;
  cellCoverage: number;
  tupleCoverage: number;
  weightedVolumeCoverage: number;
}

type Metric = "cellCoverage" | "tupleCoverage" | "weightedVolumeCoverage";

const METRICS: Array<{ key: Metric; label: string; hint: string }> = [
  {
    key: "cellCoverage",
    label: "Cells",
    hint: "Occurring, non-excluded combinations that a run has exercised.",
  },
  {
    key: "tupleCoverage",
    label: "t-way",
    hint: "Value pairs (or t-tuples) present in the data that a run has exercised.",
  },
  {
    key: "weightedVolumeCoverage",
    label: "Weighted volume",
    hint: "Share of observed record volume sitting in covered cells.",
  },
];

const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Coverage over time.
 *
 * The cell ledger is overwritten by every sync, so this is the only view that
 * can answer "is it improving". Reconstructed points are drawn hollow and
 * called out: they are scored against today's cell set, not the one that
 * existed at the time, and presenting them as measurements would overstate
 * what is actually known.
 */
export function CoverageTrendPanel({
  points,
}: {
  points: CoverageTrendPoint[];
}) {
  const [metric, setMetric] = useState<Metric>("cellCoverage");

  const series = useMemo(
    () => points.map((p) => ({ ...p, value: p[metric] })),
    [points, metric],
  );

  if (points.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">No trend yet</CardTitle>
          <CardDescription>
            A point is recorded on every sync and on every completed build, and
            history is reconstructed from run attribution where it exists. Run a
            sync, or a build against a matrix test, and this fills in.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const first = series[0];
  const last = series[series.length - 1];
  const delta = last.value - first.value;
  const backfilled = points.filter((p) => p.source === "backfill").length;

  // Plot geometry. Fixed viewBox with preserveAspectRatio="none" so the chart
  // stretches to the card without needing a measurement pass.
  const W = 600;
  const H = 160;
  const PAD = 8;
  const x = (i: number) =>
    series.length === 1
      ? W / 2
      : PAD + (i * (W - PAD * 2)) / (series.length - 1);
  const y = (v: number) => H - PAD - v * (H - PAD * 2);
  const path = series
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.value)}`)
    .join(" ");
  const area = `${path} L${x(series.length - 1)},${H - PAD} L${x(0)},${H - PAD} Z`;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Coverage over time</CardTitle>
            <CardDescription>
              {series.length} snapshot{series.length === 1 ? "" : "s"} from{" "}
              {formatDate(first.capturedAt)} to {formatDate(last.capturedAt)}.
              {backfilled > 0 && (
                <>
                  {" "}
                  {backfilled} reconstructed from run attribution and scored
                  against today&apos;s cell set — shown hollow.
                </>
              )}
            </CardDescription>
          </div>
          <div className="flex gap-1">
            {METRICS.map((m) => (
              <button
                key={m.key}
                type="button"
                title={m.hint}
                onClick={() => setMetric(m.key)}
                className={cn(
                  "rounded-md border px-2 py-1 text-xs",
                  metric === m.key
                    ? "bg-primary text-primary-foreground border-primary"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-baseline gap-3">
            <div className="text-3xl font-semibold tabular-nums">
              {pct(last.value)}
            </div>
            <div
              className={cn(
                "text-sm tabular-nums",
                delta > 0 && "text-emerald-600 dark:text-emerald-400",
                delta < 0 && "text-red-600 dark:text-red-400",
                delta === 0 && "text-muted-foreground",
              )}
            >
              {delta >= 0 ? "+" : ""}
              {Math.round(delta * 1000) / 10} pts since{" "}
              {formatDate(first.capturedAt)}
            </div>
          </div>

          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="w-full h-40"
            role="img"
            aria-label={`${METRICS.find((m) => m.key === metric)?.label} coverage trend`}
          >
            {[0, 0.5, 1].map((g) => (
              <line
                key={g}
                x1={0}
                x2={W}
                y1={y(g)}
                y2={y(g)}
                className="stroke-border"
                strokeWidth={1}
              />
            ))}
            <path d={area} className="fill-primary/10" />
            <path
              d={path}
              className="stroke-primary"
              strokeWidth={2}
              fill="none"
              vectorEffect="non-scaling-stroke"
            />
            {series.map((p, i) => (
              <circle
                key={`${p.capturedAt}-${i}`}
                cx={x(i)}
                cy={y(p.value)}
                r={3}
                className={cn(
                  "stroke-primary",
                  p.source === "backfill" ? "fill-background" : "fill-primary",
                )}
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
              >
                <title>{`${formatDate(p.capturedAt)} — ${pct(p.value)} (${p.source})`}</title>
              </circle>
            ))}
          </svg>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Snapshots</CardTitle>
          <CardDescription>
            Newest first. A build-scoped point is updated in place, so a re-run
            corrects its own point instead of adding a second one.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="text-left py-2 pr-3">When</th>
                  <th className="text-left py-2 pr-3">Source</th>
                  <th className="text-right py-2 pr-3">Cells</th>
                  <th className="text-right py-2 pr-3">t-way</th>
                  <th className="text-right py-2 pr-3">Weighted</th>
                  <th className="text-right py-2 pr-3">Covered</th>
                  <th className="text-right py-2 pr-3">Failing</th>
                  <th className="text-right py-2">Δ cells</th>
                </tr>
              </thead>
              <tbody>
                {[...points]
                  .map((p, i) => ({
                    p,
                    prev: i > 0 ? points[i - 1] : null,
                  }))
                  .reverse()
                  .map(({ p, prev }) => {
                    const d = prev ? p.cellCoverage - prev.cellCoverage : null;
                    return (
                      <tr
                        key={`${p.capturedAt}-${p.buildId ?? "sync"}`}
                        className="border-b last:border-0"
                      >
                        <td className="py-2 pr-3 whitespace-nowrap">
                          {new Date(p.capturedAt).toLocaleString()}
                        </td>
                        <td className="py-2 pr-3">
                          <Badge
                            variant="outline"
                            className="text-[10px] font-normal"
                          >
                            {p.source}
                          </Badge>
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {pct(p.cellCoverage)}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {pct(p.tupleCoverage)}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {pct(p.weightedVolumeCoverage)}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {p.coveredCells}/{p.totalCells - p.excludedCells}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {p.failingCells}
                        </td>
                        <td
                          className={cn(
                            "py-2 text-right tabular-nums",
                            d !== null &&
                              d > 0 &&
                              "text-emerald-600 dark:text-emerald-400",
                            d !== null &&
                              d < 0 &&
                              "text-red-600 dark:text-red-400",
                          )}
                        >
                          {d === null
                            ? "—"
                            : `${d >= 0 ? "+" : ""}${Math.round(d * 1000) / 10}`}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
