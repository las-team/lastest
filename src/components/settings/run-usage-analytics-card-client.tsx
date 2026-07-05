"use client";

import { useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import {
  Activity,
  AlertTriangle,
  ArrowUpCircle,
  ArrowUpRight,
  BarChart3,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  FileCode,
  Minus,
  TrendingUp,
} from "lucide-react";
import type {
  RunUsageAnalytics,
  RunUsageAnalyticsRepo,
} from "@/lib/db/queries/storage";
import {
  RUN_ANALYTICS_OTHER_ID,
  type RunUsageProjection,
} from "@/lib/billing/run-usage";

interface RunUsageAnalyticsCardProps {
  analytics: RunUsageAnalytics;
  projection: RunUsageProjection;
}

// Maps to --chart-1..5 in globals.css (teal / blue / amber / red / ink),
// the same palette the source design used. Repos are colored by rank; the
// aggregated "Other" bucket always lands on the last (neutral) slot.
const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

const MONTHS_ABBR = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// Deterministic formatters (no toLocaleString) to avoid SSR/CSR mismatch.
function fmt(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
function fmt1(n: number): string {
  return n.toFixed(1);
}
function monthDay(isoDay: string): string {
  const [, m, d] = isoDay.split("-").map(Number);
  if (!m || !d) return isoDay;
  return `${MONTHS_ABBR[m - 1]} ${d}`;
}

const CHART_HEIGHT = 150;

// Tests shown per project before the "Show all" toggle reveals the rest.
const TESTS_PREVIEW_COUNT = 5;

export function RunUsageAnalyticsCard({
  analytics,
  projection,
}: RunUsageAnalyticsCardProps) {
  const { repos, series, totalMinutes } = analytics;
  const colorFor = (repoId: string, index: number) =>
    repoId === RUN_ANALYTICS_OTHER_ID
      ? CHART_COLORS[CHART_COLORS.length - 1]
      : CHART_COLORS[index % CHART_COLORS.length];

  const firstExpandable = repos.find(
    (r) => r.id !== RUN_ANALYTICS_OTHER_ID && r.tests.length > 0,
  );
  const [expanded, setExpanded] = useState<string | null>(
    firstExpandable?.id ?? null,
  );
  const [hoverIndex, setHoverIndex] = useState(-1);

  const isEmpty = totalMinutes <= 0 || repos.length === 0;

  return (
    <Card className="overflow-hidden py-0 gap-0">
      {/* header */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b p-5">
        <div>
          <div className="flex items-center gap-2 text-base font-semibold">
            <Activity className="h-[18px] w-[18px]" />
            Run usage analytics
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            Where your run-minutes go this billing cycle by project — drill in
            to per-test cost.
          </p>
        </div>
        <div className="flex items-center gap-1.5 whitespace-nowrap pt-0.5 font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
          <Calendar className="h-3 w-3" />
          {monthDay(analytics.rangeStart)} – {monthDay(analytics.rangeEnd)},{" "}
          {analytics.rangeEnd.slice(0, 4)}
        </div>
      </div>

      {isEmpty ? (
        <EmptyState />
      ) : (
        <>
          <ChartSection
            repos={repos}
            series={series}
            totalMinutes={totalMinutes}
            colorFor={colorFor}
            hoverIndex={hoverIndex}
            setHoverIndex={setHoverIndex}
          />
          <ProjectionPanel projection={projection} />
          <Breakdown
            repos={repos}
            totalMinutes={totalMinutes}
            colorFor={colorFor}
            expanded={expanded}
            setExpanded={setExpanded}
          />
        </>
      )}

      <div className="border-t p-3 px-5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground/70">
        ★ Billing metric · sum(test_results.duration_ms) over completed runs
      </div>
    </Card>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-2.5 px-5 py-14 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-muted">
        <BarChart3 className="h-5 w-5 text-muted-foreground" />
      </div>
      <div className="text-sm font-medium text-muted-foreground">
        No runtime data yet for this period
      </div>
      <div className="max-w-xs text-[12.5px] text-muted-foreground/80">
        Run some tests and your per-project run-minute breakdown will appear
        here.
      </div>
    </div>
  );
}

function ChartSection({
  repos,
  series,
  totalMinutes,
  colorFor,
  hoverIndex,
  setHoverIndex,
}: {
  repos: RunUsageAnalyticsRepo[];
  series: RunUsageAnalytics["series"];
  totalMinutes: number;
  colorFor: (id: string, i: number) => string;
  hoverIndex: number;
  setHoverIndex: (i: number) => void;
}) {
  const dayTotals = series.map((d) =>
    repos.reduce((s, r) => s + (d.minutesByRepo[r.id] ?? 0), 0),
  );
  const rawMax = Math.max(0, ...dayTotals);
  const yMax = Math.ceil(rawMax / 5) * 5 || 5;
  const n = series.length;
  const mid = Math.floor((n - 1) / 2);

  const hovered = hoverIndex >= 0 && hoverIndex < n ? series[hoverIndex] : null;
  const tooltipRows = hovered
    ? repos
        .map((r, i) => ({
          name: r.name,
          color: colorFor(r.id, i),
          minN: hovered.minutesByRepo[r.id] ?? 0,
        }))
        .filter((r) => r.minN >= 0.05)
        .sort((a, b) => b.minN - a.minN)
    : [];
  const hoveredTotal = hovered ? (dayTotals[hoverIndex] ?? 0) : 0;
  const tooltipLeft = hovered ? ((hoverIndex + 0.5) / n) * 100 : 0;
  const tooltipTransform =
    hoverIndex < 8
      ? "translateX(-8px)"
      : hoverIndex > n - 8
        ? "translateX(calc(-100% + 8px))"
        : "translateX(-50%)";

  return (
    <div className="px-5 pb-2 pt-5">
      <div className="mb-3.5 flex items-baseline justify-between">
        <div className="font-mono text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">
          Daily run-minutes
        </div>
        <div className="text-xs text-muted-foreground">
          <span className="font-semibold tabular-nums text-foreground">
            {fmt(totalMinutes)}
          </span>{" "}
          min total ·{" "}
          <span className="tabular-nums">{fmt1(totalMinutes / n)}</span>/day avg
        </div>
      </div>

      <div className="flex gap-2.5">
        {/* y axis */}
        <div className="flex h-[170px] w-[34px] flex-shrink-0 flex-col items-end justify-between pb-5 font-mono text-[10px] text-muted-foreground/60">
          <span>{yMax}</span>
          <span>{Math.round(yMax / 2)}</span>
          <span>0</span>
        </div>
        {/* bars */}
        <div className="relative flex-1">
          {/* gridlines */}
          <div className="pointer-events-none absolute inset-x-0 bottom-5 top-0 flex flex-col justify-between">
            <div className="border-t border-border" />
            <div className="border-t border-dashed border-border" />
            <div className="border-t border-border" style={{ opacity: 0.5 }} />
          </div>
          <div
            className="relative flex items-end gap-0.5"
            style={{ height: CHART_HEIGHT }}
            onMouseLeave={() => setHoverIndex(-1)}
          >
            {series.map((day, i) => (
              <div
                key={day.date}
                className="flex h-full flex-1 cursor-default flex-col justify-end"
                onMouseEnter={() => setHoverIndex(i)}
              >
                {repos.map((repo, ri) => {
                  const min = day.minutesByRepo[repo.id] ?? 0;
                  if (min <= 0) return null;
                  return (
                    <div
                      key={repo.id}
                      style={{
                        height: `${((min / yMax) * CHART_HEIGHT).toFixed(1)}px`,
                        background: colorFor(repo.id, ri),
                      }}
                    />
                  );
                })}
              </div>
            ))}

            {hovered && tooltipRows.length > 0 && (
              <div
                className="pointer-events-none absolute z-10 min-w-[150px] rounded-md px-2.5 py-2 text-[11.5px] shadow-lg"
                style={{
                  top: -8,
                  left: `${tooltipLeft}%`,
                  transform: tooltipTransform,
                  background: "var(--chart-5, #1f2a33)",
                  color: "#fff",
                }}
              >
                <div className="mb-1.5 font-mono text-[9.5px] uppercase tracking-wide text-white/55">
                  {monthDay(hovered.date)}
                </div>
                {tooltipRows.map((r) => (
                  <div
                    key={r.name}
                    className="mt-0.5 flex items-center gap-1.5"
                  >
                    <span
                      className="h-2 w-2 flex-shrink-0 rounded-sm"
                      style={{ background: r.color }}
                    />
                    <span className="flex-1 text-white/75">{r.name}</span>
                    <span className="font-mono tabular-nums">
                      {fmt1(r.minN)}
                    </span>
                  </div>
                ))}
                <div className="mt-1.5 flex justify-between border-t border-white/15 pt-1.5 font-semibold">
                  <span>Total</span>
                  <span className="font-mono tabular-nums">
                    {fmt1(hoveredTotal)} min
                  </span>
                </div>
              </div>
            )}
          </div>
          {/* x labels */}
          <div className="mt-1.5 flex justify-between font-mono text-[10px] text-muted-foreground/60">
            <span>{monthDay(series[0].date)}</span>
            <span>{monthDay(series[mid].date)}</span>
            <span>{monthDay(series[n - 1].date)}</span>
          </div>
        </div>
      </div>

      {/* legend */}
      <div className="mt-2 flex flex-wrap gap-x-3.5 gap-y-2 pl-11">
        {repos.map((repo, i) => (
          <div key={repo.id} className="flex items-center gap-1.5 text-xs">
            <span
              className="h-2.5 w-2.5 flex-shrink-0 rounded-sm"
              style={{ background: colorFor(repo.id, i) }}
            />
            <span className="text-muted-foreground">{repo.name}</span>
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground/60">
              {fmt(repo.minutes)}m
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProjectionPanel({ projection }: { projection: RunUsageProjection }) {
  const { used, quota, projected, projectedPct } = projection;
  const usedW = quota > 0 ? Math.min(100, (used / quota) * 100) : 0;
  const projW = quota > 0 ? (Math.max(0, projected - used) / quota) * 100 : 0;

  let tone: {
    icon: typeof TrendingUp;
    border: string;
    bg: string;
    iconWrap: string;
    title: string;
    detail: string;
    projFill: string;
    showUpgrade: boolean;
  };

  if (projectedPct >= 1) {
    tone = {
      icon: AlertTriangle,
      border: "border-destructive/30",
      bg: "bg-destructive/5",
      iconWrap: "bg-destructive/10 text-destructive",
      title: "Projected to exceed quota — consider upgrading",
      detail: `At the current pace you'll hit ~${fmt(projected)} run-minutes by month end, past your ${fmt(quota)}-minute quota. Overage may apply on paid plans.`,
      projFill: "var(--chart-4)",
      showUpgrade: true,
    };
  } else if (projectedPct >= 0.8) {
    tone = {
      icon: TrendingUp,
      border: "border-amber-500/30",
      bg: "bg-amber-500/5",
      iconWrap: "bg-amber-500/10 text-amber-600",
      title: `Projected to reach ${Math.round(projectedPct * 100)}% of quota`,
      detail: `On pace for ~${fmt(projected)} of ${fmt(quota)} run-minutes this month. Worth keeping an eye on.`,
      projFill: "var(--chart-3)",
      showUpgrade: false,
    };
  } else {
    tone = {
      icon: CheckCircle2,
      border: "border-border",
      bg: "bg-muted/40",
      iconWrap: "bg-primary/10 text-primary",
      title: `On track for ${fmt(projected)} / ${fmt(quota)} run-minutes this month`,
      detail: "Comfortably within quota at the current pace.",
      projFill: "var(--chart-1)",
      showUpgrade: false,
    };
  }

  const ToneIcon = tone.icon;

  return (
    <div
      className={`mx-5 mb-1 mt-4 flex items-start gap-3 rounded-md border p-4 ${tone.border} ${tone.bg}`}
    >
      <div
        className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-sm ${tone.iconWrap}`}
      >
        <ToneIcon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-semibold">{tone.title}</div>
        <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
          {tone.detail}
        </div>
        {/* projection meter */}
        <div className="relative mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-primary"
            style={{ width: `${usedW.toFixed(1)}%` }}
          />
          <div
            className="absolute inset-y-0 rounded-full opacity-40"
            style={{
              left: `${usedW.toFixed(1)}%`,
              width: `${projW.toFixed(1)}%`,
              background: tone.projFill,
            }}
          />
          <div
            className="absolute -top-0.5 -bottom-0.5 w-0.5 bg-foreground"
            style={{ left: "100%" }}
          />
        </div>
        <div className="mt-1.5 flex justify-between font-mono text-[10px] text-muted-foreground/60">
          <span>{fmt(used)} USED</span>
          <span>PROJECTED {fmt(projected)}</span>
          <span>QUOTA {fmt(quota)}</span>
        </div>
      </div>
      {tone.showUpgrade && (
        <Link
          href="/settings/billing"
          className="flex h-8 flex-shrink-0 items-center gap-1.5 self-center whitespace-nowrap rounded-md bg-destructive px-3 text-[12.5px] font-semibold text-white"
        >
          <ArrowUpCircle className="h-3.5 w-3.5" />
          Upgrade
        </Link>
      )}
    </div>
  );
}

function Breakdown({
  repos,
  totalMinutes,
  colorFor,
  expanded,
  setExpanded,
}: {
  repos: RunUsageAnalyticsRepo[];
  totalMinutes: number;
  colorFor: (id: string, i: number) => string;
  expanded: string | null;
  setExpanded: (id: string | null) => void;
}) {
  // Per-project ids whose full test list is revealed (default: preview only).
  const [showAllTests, setShowAllTests] = useState<Set<string>>(
    () => new Set(),
  );
  const toggleShowAll = (id: string) =>
    setShowAllTests((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="px-5 pb-2 pt-4">
      <div className="mb-2.5 font-mono text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">
        Breakdown by project
      </div>
      <div className="overflow-hidden rounded-md border">
        {repos.map((repo, i) => {
          const expandable =
            repo.id !== RUN_ANALYTICS_OTHER_ID && repo.tests.length > 0;
          const isOpen = expandable && expanded === repo.id;
          const share = totalMinutes > 0 ? repo.minutes / totalMinutes : 0;
          const color = colorFor(repo.id, i);
          const allShown = showAllTests.has(repo.id);
          const hasMoreTests = repo.tests.length > TESTS_PREVIEW_COUNT;
          const visibleTests =
            hasMoreTests && !allShown
              ? repo.tests.slice(0, TESTS_PREVIEW_COUNT)
              : repo.tests;
          return (
            <div key={repo.id} className={i === 0 ? "" : "border-t"}>
              <div
                onClick={() =>
                  expandable && setExpanded(isOpen ? null : repo.id)
                }
                className={`grid grid-cols-[16px_1fr_110px_auto] items-center gap-3 px-4 py-3 transition-colors ${
                  expandable ? "cursor-pointer" : "cursor-default"
                } ${isOpen ? "bg-muted/50" : ""}`}
              >
                {expandable ? (
                  isOpen ? (
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  )
                ) : (
                  <Minus className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <div className="flex min-w-0 items-center gap-2.5">
                  <span
                    className="h-2.5 w-2.5 flex-shrink-0 rounded-sm"
                    style={{ background: color }}
                  />
                  <span className="truncate text-[13.5px] font-medium">
                    {repo.name}
                  </span>
                  <span className="whitespace-nowrap font-mono text-[10.5px] text-muted-foreground/60">
                    {repo.id === RUN_ANALYTICS_OTHER_ID
                      ? "aggregated"
                      : `${repo.testCount} test${repo.testCount === 1 ? "" : "s"}`}
                  </span>
                </div>
                <div className="h-[5px] overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(share * 100).toFixed(1)}%`,
                      background: color,
                    }}
                  />
                </div>
                <div className="whitespace-nowrap text-right">
                  <span className="text-[13.5px] font-semibold tabular-nums">
                    {fmt(repo.minutes)}
                  </span>
                  <span className="text-xs text-muted-foreground"> min</span>{" "}
                  <span className="ml-0.5 font-mono text-[11px] text-muted-foreground/60">
                    {Math.round(share * 100)}%
                  </span>
                </div>
              </div>

              {isOpen && (
                <div className="border-t bg-muted/30">
                  {visibleTests.map((t, ti) => (
                    <Link
                      key={t.id}
                      href={`/tests/${t.id}`}
                      className={`grid grid-cols-[16px_1fr_auto_auto] items-center gap-3 px-4 py-2.5 text-foreground ${
                        ti === 0 ? "" : "border-t"
                      }`}
                    >
                      <span className="mx-auto h-[5px] w-[5px] rounded-full bg-border" />
                      <div className="flex min-w-0 items-center gap-1.5">
                        <FileCode className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/60" />
                        <span
                          className="truncate text-[13px]"
                          style={{ color: "var(--chart-2)" }}
                        >
                          {t.name}
                        </span>
                        <ArrowUpRight className="h-3 w-3 flex-shrink-0 text-muted-foreground/60" />
                      </div>
                      <div className="whitespace-nowrap text-right font-mono text-[11.5px] text-muted-foreground">
                        {fmt(t.runs)} runs
                      </div>
                      <div className="whitespace-nowrap text-right tabular-nums">
                        <span className="text-[13px] font-semibold">
                          {fmt1(t.minutes)}
                        </span>
                        <span className="text-[11.5px] text-muted-foreground">
                          {" "}
                          min
                        </span>
                      </div>
                    </Link>
                  ))}
                  {hasMoreTests && (
                    <button
                      type="button"
                      onClick={() => toggleShowAll(repo.id)}
                      className="flex w-full items-center justify-center gap-1.5 border-t px-4 py-2.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted/50"
                    >
                      {allShown ? (
                        <>
                          <ChevronUp className="h-3.5 w-3.5" />
                          Show less
                        </>
                      ) : (
                        <>
                          <ChevronDown className="h-3.5 w-3.5" />
                          Show all {repo.testCount} tests
                        </>
                      )}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="mx-0.5 mt-2.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground/60">
        Click a project to see its tests · test names link to /tests/[id]
      </div>
    </div>
  );
}
