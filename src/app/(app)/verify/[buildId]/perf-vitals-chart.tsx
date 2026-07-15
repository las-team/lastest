"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { WebVitalsSample } from "@/lib/db/schema";

// Per-step Web Vitals time series for the verify Perf pane. One axis (ms) for
// the timing metrics; CLS is unitless so it gets its own mini-chart instead of
// a second y-scale. Series hues follow the validated categorical order from
// the dataviz reference palette (adjacent-pair CVD-safe on light surfaces);
// identity is never color-alone — chips + direct end-labels name the series.
const MS_SERIES = [
  { key: "lcp", label: "LCP", color: "#2a78d6" },
  { key: "fcp", label: "FCP", color: "#008300" },
  { key: "inp", label: "INP", color: "#e87ba4" },
  { key: "tbt", label: "TBT", color: "#eda100" },
  { key: "ttfb", label: "TTFB", color: "#1baf7a" },
] as const;
const CLS_COLOR = "#eb6834";

type MsKey = (typeof MS_SERIES)[number]["key"];

interface PerfDelta {
  metric: string;
  baseline: number;
  current: number;
  delta: number;
  budgetBreached?: boolean;
  drifted?: boolean;
}

interface ChartPoint {
  stepIndex: number;
  stepLabel: string | null;
  values: Partial<Record<MsKey | "cls", number>>;
}

function fmtMs(v: number): string {
  return v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`;
}

export function PerfVitalsChart({
  samples,
  deltas,
}: {
  samples: WebVitalsSample[];
  deltas: PerfDelta[] | null;
}) {
  const points = useMemo<ChartPoint[]>(() => {
    const rows = samples.map((s, i) => ({
      stepIndex: s.stepIndex ?? i,
      stepLabel: s.stepLabel ?? null,
      values: {
        lcp: s.lcp,
        fcp: s.fcp,
        inp: s.inp,
        tbt: s.tbt,
        ttfb: s.ttfb,
        cls: s.cls,
      } as ChartPoint["values"],
    }));
    rows.sort((a, b) => a.stepIndex - b.stepIndex);
    return rows;
  }, [samples]);

  const present = useMemo(
    () =>
      MS_SERIES.filter((s) =>
        points.some((p) => typeof p.values[s.key] === "number"),
      ),
    [points],
  );
  const hasCls = points.some((p) => typeof p.values.cls === "number");

  const [enabled, setEnabled] = useState<Set<MsKey>>(
    () => new Set(present.map((s) => s.key)),
  );
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(560);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const active = present.filter((s) => enabled.has(s.key));
  const baselineFor = (metric: string) =>
    deltas?.find((d) => d.metric === metric)?.baseline ?? null;

  const yMax = useMemo(() => {
    let max = 0;
    for (const p of points)
      for (const s of active) {
        const v = p.values[s.key];
        if (typeof v === "number" && v > max) max = v;
      }
    for (const s of active) {
      const b = baselineFor(s.key);
      if (b != null && b > max) max = b;
    }
    return max > 0 ? max * 1.08 : 1;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, active, deltas]);

  const peaks = useMemo(
    () =>
      active
        .map((s) => {
          let best: { v: number; p: ChartPoint } | null = null;
          for (const p of points) {
            const v = p.values[s.key];
            if (typeof v === "number" && (!best || v > best.v)) best = { v, p };
          }
          return best ? { series: s, ...best } : null;
        })
        .filter(Boolean) as Array<{
        series: (typeof MS_SERIES)[number];
        v: number;
        p: ChartPoint;
      }>,
    [active, points],
  );

  if (points.length < 2 || present.length === 0) return null;

  const H = 190;
  const PAD = { top: 10, right: 64, bottom: 22, left: 44 };
  const plotW = Math.max(80, width - PAD.left - PAD.right);
  const plotH = H - PAD.top - PAD.bottom;
  const x = (i: number) =>
    PAD.left + (points.length === 1 ? 0 : (i / (points.length - 1)) * plotW);
  const y = (v: number) => PAD.top + plotH - (v / yMax) * plotH;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left - PAD.left;
    const idx = Math.round((px / plotW) * (points.length - 1));
    setHoverIdx(Math.max(0, Math.min(points.length - 1, idx)));
  };

  const hover = hoverIdx != null ? points[hoverIdx] : null;
  const ticks = [0, yMax / 2, yMax];

  return (
    <div className="v-card" style={{ padding: 12 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          flexWrap: "wrap",
          marginBottom: 6,
        }}
      >
        <span className="label" style={{ fontSize: 10 }}>
          Web Vitals per step
        </span>
        <span style={{ flex: 1 }} />
        {present.map((s) => {
          const on = enabled.has(s.key);
          return (
            <button
              key={s.key}
              type="button"
              onClick={() =>
                setEnabled((prev) => {
                  const next = new Set(prev);
                  if (next.has(s.key)) next.delete(s.key);
                  else next.add(s.key);
                  return next;
                })
              }
              className="v-chip"
              aria-pressed={on}
              style={{
                cursor: "pointer",
                fontSize: 9,
                padding: "1px 6px",
                opacity: on ? 1 : 0.45,
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: s.color,
                }}
              />
              {s.label}
            </button>
          );
        })}
      </div>

      {/* Peak badges — worst value per enabled series with its step. */}
      {peaks.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 4,
            marginBottom: 6,
          }}
        >
          {peaks.map(({ series, v, p }) => (
            <span
              key={series.key}
              className="v-chip"
              style={{ fontSize: 9, padding: "1px 6px" }}
              title={p.stepLabel ?? undefined}
            >
              Peak {series.label} {fmtMs(v)} @ step {p.stepIndex + 1}
            </span>
          ))}
        </div>
      )}

      <div ref={wrapRef} style={{ position: "relative" }}>
        <svg
          width="100%"
          height={H}
          role="img"
          aria-label="Web Vitals per step line chart"
          onMouseMove={onMove}
          onMouseLeave={() => setHoverIdx(null)}
          style={{ display: "block" }}
        >
          {/* Grid + y ticks */}
          {ticks.map((t, i) => (
            <g key={i}>
              <line
                x1={PAD.left}
                x2={PAD.left + plotW}
                y1={y(t)}
                y2={y(t)}
                stroke="var(--border)"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 6}
                y={y(t) + 3}
                textAnchor="end"
                fontSize={9}
                fill="var(--fg-3)"
              >
                {fmtMs(t)}
              </text>
            </g>
          ))}
          {/* x labels: step numbers (sparse when crowded) */}
          {points.map((p, i) => {
            const every = Math.ceil(points.length / 12);
            if (i % every !== 0) return null;
            return (
              <text
                key={i}
                x={x(i)}
                y={H - 6}
                textAnchor="middle"
                fontSize={9}
                fill="var(--fg-3)"
              >
                {p.stepIndex + 1}
              </text>
            );
          })}
          {/* Baseline overlays: dashed line at the baseline-run value. */}
          {active.map((s) => {
            const b = baselineFor(s.key);
            if (b == null) return null;
            return (
              <line
                key={`b-${s.key}`}
                x1={PAD.left}
                x2={PAD.left + plotW}
                y1={y(b)}
                y2={y(b)}
                stroke={s.color}
                strokeWidth={1}
                strokeDasharray="4 3"
                opacity={0.5}
              />
            );
          })}
          {/* Series lines + points + direct end-labels */}
          {active.map((s) => {
            const pts = points
              .map((p, i) =>
                typeof p.values[s.key] === "number"
                  ? { i, v: p.values[s.key] as number }
                  : null,
              )
              .filter(Boolean) as Array<{ i: number; v: number }>;
            if (pts.length === 0) return null;
            const d = pts
              .map((pt, k) => `${k === 0 ? "M" : "L"}${x(pt.i)},${y(pt.v)}`)
              .join(" ");
            const last = pts[pts.length - 1];
            return (
              <g key={s.key}>
                <path d={d} fill="none" stroke={s.color} strokeWidth={2} />
                {pts.map((pt) => (
                  <circle
                    key={pt.i}
                    cx={x(pt.i)}
                    cy={y(pt.v)}
                    r={hoverIdx === pt.i ? 4 : 2.5}
                    fill={s.color}
                    stroke="var(--c-white)"
                    strokeWidth={1}
                  />
                ))}
                <text
                  x={x(last.i) + 6}
                  y={y(last.v) + 3}
                  fontSize={9}
                  fill="var(--fg-2)"
                >
                  {s.label} {fmtMs(last.v)}
                </text>
              </g>
            );
          })}
          {/* Crosshair */}
          {hover && (
            <line
              x1={x(hoverIdx!)}
              x2={x(hoverIdx!)}
              y1={PAD.top}
              y2={PAD.top + plotH}
              stroke="var(--fg-3)"
              strokeWidth={1}
              strokeDasharray="2 2"
            />
          )}
        </svg>
        {/* Tooltip */}
        {hover && (
          <div
            style={{
              position: "absolute",
              left: Math.min(
                Math.max(x(hoverIdx!) - 70, 0),
                Math.max(0, width - 150),
              ),
              top: 0,
              pointerEvents: "none",
              background: "var(--c-white)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "6px 8px",
              boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
              fontSize: 10,
              minWidth: 120,
              zIndex: 2,
            }}
          >
            <div
              style={{ fontWeight: 600, color: "var(--fg-1)", marginBottom: 2 }}
            >
              Step {hover.stepIndex + 1}
              {hover.stepLabel ? ` · ${hover.stepLabel}` : ""}
            </div>
            {active.map((s) => {
              const v = hover.values[s.key];
              return (
                <div
                  key={s.key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    color: "var(--fg-2)",
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      background: s.color,
                    }}
                  />
                  <span style={{ width: 34 }}>{s.label}</span>
                  <span className="mono">
                    {typeof v === "number" ? fmtMs(v) : "—"}
                  </span>
                </div>
              );
            })}
            {typeof hover.values.cls === "number" && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  color: "var(--fg-2)",
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: CLS_COLOR,
                  }}
                />
                <span style={{ width: 34 }}>CLS</span>
                <span className="mono">{hover.values.cls.toFixed(3)}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* CLS is unitless — its own mini-chart instead of a second y-axis. */}
      {hasCls && (
        <ClsMiniChart
          points={points}
          width={width}
          baseline={baselineFor("cls")}
        />
      )}
    </div>
  );
}

function ClsMiniChart({
  points,
  width,
  baseline,
}: {
  points: ChartPoint[];
  width: number;
  baseline: number | null;
}) {
  const H = 70;
  const PAD = { top: 8, right: 64, bottom: 4, left: 44 };
  const plotW = Math.max(80, width - PAD.left - PAD.right);
  const plotH = H - PAD.top - PAD.bottom;
  const vals = points
    .map((p, i) =>
      typeof p.values.cls === "number" ? { i, v: p.values.cls } : null,
    )
    .filter(Boolean) as Array<{ i: number; v: number }>;
  if (vals.length === 0) return null;
  const max =
    Math.max(...vals.map((v) => v.v), baseline ?? 0, 0.01) * 1.15 || 0.01;
  const x = (i: number) =>
    PAD.left + (points.length === 1 ? 0 : (i / (points.length - 1)) * plotW);
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const d = vals
    .map((pt, k) => `${k === 0 ? "M" : "L"}${x(pt.i)},${y(pt.v)}`)
    .join(" ");
  const last = vals[vals.length - 1];
  return (
    <svg
      width="100%"
      height={H}
      role="img"
      aria-label="Cumulative Layout Shift per step"
      style={{ display: "block", marginTop: 4 }}
    >
      <line
        x1={PAD.left}
        x2={PAD.left + plotW}
        y1={y(0)}
        y2={y(0)}
        stroke="var(--border)"
        strokeWidth={1}
      />
      {baseline != null && (
        <line
          x1={PAD.left}
          x2={PAD.left + plotW}
          y1={y(baseline)}
          y2={y(baseline)}
          stroke={CLS_COLOR}
          strokeWidth={1}
          strokeDasharray="4 3"
          opacity={0.5}
        />
      )}
      <path d={d} fill="none" stroke={CLS_COLOR} strokeWidth={2} />
      {vals.map((pt) => (
        <circle
          key={pt.i}
          cx={x(pt.i)}
          cy={y(pt.v)}
          r={2.5}
          fill={CLS_COLOR}
          stroke="var(--c-white)"
          strokeWidth={1}
        />
      ))}
      <text x={x(last.i) + 6} y={y(last.v) + 3} fontSize={9} fill="var(--fg-2)">
        CLS {last.v.toFixed(3)}
      </text>
      <text
        x={PAD.left - 6}
        y={y(max / 1.15) + 3}
        textAnchor="end"
        fontSize={9}
        fill="var(--fg-3)"
      >
        {(max / 1.15).toFixed(2)}
      </text>
    </svg>
  );
}
