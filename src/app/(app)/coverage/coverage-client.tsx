"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Copy,
  Database,
  Loader2,
  RefreshCw,
  Ban,
  RotateCcw,
  Upload,
  FileSpreadsheet,
  AlertTriangle,
  Target,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { CoverageDimension } from "@/lib/db/schema";
import type { CoverageSpec, SpecCell } from "@/lib/coverage/spec";
import type { CoverageMetrics, StopReason } from "@/lib/coverage/stop";
import {
  syncCoverageAction,
  setCoverageDimensionEnabledAction,
  setCoverageCellStatusAction,
  getCoverageSpecAction,
} from "@/server/actions/coverage";
import { uploadCsvSource } from "@/server/actions/csv-sources";

interface SourceSummary {
  kind: "csv" | "sheet";
  alias: string;
  /** Rows the source has in total. */
  rows: number;
  /** Rows the coverage numbers were actually computed from. */
  profiledRows: number;
  truncated: boolean;
  columns: string[];
}

interface CoverageClientProps {
  repositoryId: string;
  environmentKey: string;
  spec: CoverageSpec;
  stop: {
    shouldStop: boolean;
    reasons: StopReason[];
    metrics: CoverageMetrics;
    explanation: string;
  };
  dimensions: CoverageDimension[];
  sources: SourceSummary[];
}

const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;

function StatCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "good" | "warn";
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div
          className={cn(
            "text-2xl font-semibold mt-1 tabular-nums",
            tone === "good" && "text-emerald-600 dark:text-emerald-400",
            tone === "warn" && "text-amber-600 dark:text-amber-400",
          )}
        >
          {value}
        </div>
        {hint ? (
          <div className="text-xs text-muted-foreground mt-1">{hint}</div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function statusBadge(status: SpecCell["status"]) {
  const map: Record<SpecCell["status"], { label: string; className: string }> =
    {
      covered: {
        label: "covered",
        className:
          "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
      },
      failing: {
        label: "failing",
        className:
          "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30",
      },
      planned: {
        label: "planned",
        className:
          "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30",
      },
      excluded: {
        label: "excluded",
        className: "bg-muted text-muted-foreground border-border",
      },
      uncovered: {
        label: "uncovered",
        className:
          "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30",
      },
    };
  const s = map[status];
  return (
    <Badge variant="outline" className={cn("text-[10px]", s.className)}>
      {s.label}
    </Badge>
  );
}

export function CoverageClient({
  repositoryId,
  environmentKey,
  spec,
  stop,
  dimensions,
  sources,
}: CoverageClientProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [matrixStatus, setMatrixStatus] = useState<"all" | SpecCell["status"]>(
    "all",
  );
  const [matrixQuery, setMatrixQuery] = useState("");
  const [excludeTarget, setExcludeTarget] = useState<{
    cellId: string;
    coords: Record<string, string>;
  } | null>(null);
  const [excludeReason, setExcludeReason] = useState("");
  const [markdown, setMarkdown] = useState<string | null>(null);

  const refresh = () => startTransition(() => router.refresh());

  const runSync = async () => {
    setBusy("sync");
    try {
      const r = await syncCoverageAction(repositoryId, { environmentKey });
      toast.success(
        `Profiled ${r.dimensionsProposed} dimension(s), ${r.cellsUpserted} cell(s), ${r.attributionsRecorded} run attribution(s)` +
          (r.cellsPruned > 0 ? `, pruned ${r.cellsPruned} stale` : ""),
      );
      if (r.dimensionsRejected.length > 0) {
        toast.info(
          `${r.dimensionsRejected.length} column(s) rejected as non-dimensions — see the Dimensions tab.`,
        );
      }
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setBusy(null);
    }
  };

  const toggleDimension = async (id: string, enabled: boolean) => {
    setBusy(id);
    try {
      await setCoverageDimensionEnabledAction(repositoryId, id, enabled);
      // Enabling changes the field set, so cells must be re-derived — doing it
      // here keeps the grid from showing a stale generation.
      await syncCoverageAction(repositoryId, { environmentKey });
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  };

  const submitExclude = async () => {
    if (!excludeTarget || !excludeReason.trim()) return;
    setBusy("exclude");
    try {
      await setCoverageCellStatusAction(
        repositoryId,
        excludeTarget.cellId,
        "excluded",
        excludeReason.trim(),
      );
      toast.success("Cell excluded — the reason is recorded in the spec.");
      setExcludeTarget(null);
      setExcludeReason("");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  };

  const reinstate = async (cellId: string) => {
    setBusy(cellId);
    try {
      await setCoverageCellStatusAction(repositoryId, cellId, "uncovered");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  };

  const loadMarkdown = async () => {
    setBusy("spec");
    try {
      const { markdown } = await getCoverageSpecAction(repositoryId, {
        environmentKey,
      });
      setMarkdown(markdown);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  };

  const onUpload = async (file: File | null | undefined) => {
    if (!file) return;
    setBusy("upload");
    try {
      // Alias must start with a letter and contain only word chars/hyphens —
      // the same rule the CSV settings card enforces.
      const alias =
        file.name
          .replace(/\.csv$/i, "")
          .replace(/[^A-Za-z0-9_-]/g, "_")
          .replace(/^[^A-Za-z]+/, "") || "dataset";
      const bytes = new Uint8Array(await file.arrayBuffer());
      const res = await uploadCsvSource(repositoryId, alias, bytes, file.name);
      if (!res?.success) throw new Error(res?.error ?? "Upload failed");
      toast.success("Uploaded — profiling columns…");
      await syncCoverageAction(repositoryId, { environmentKey });
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(null);
    }
  };

  const enabledDims = dimensions.filter((d) => d.enabled);
  const proposedDims = dimensions.filter((d) => !d.enabled);
  const anyProfiled = dimensions.some((d) => d.valueSource === "profiled");

  // The gap set: every occurring combination no run has exercised, ranked by
  // weight, plus the dimension values never exercised at all. `spec.outstanding`
  // is already the agent's work queue, so the screen and the agent cannot
  // disagree about what is missing.
  const untestedCells = spec.outstanding;
  const untestedRecords = untestedCells.reduce(
    (a, c) => a + c.observedCount,
    0,
  );
  const totalRecords = spec.sections.reduce(
    (a, s) => a + s.totals.totalRecords,
    0,
  );
  const untestedValues = spec.sections.flatMap((sec) =>
    sec.dimensions
      .map((d) => ({
        objectType: sec.objectType,
        field: d.field,
        valueSource: d.valueSource,
        values: d.values
          .filter((v) => !v.covered)
          .sort((a, b) => b.recordCount - a.recordCount),
        total: d.values.length,
      }))
      .filter((d) => d.values.length > 0),
  );
  const truncatedSources = sources.filter((s) => s.truncated);
  const cellById = new Map(
    spec.sections.flatMap((sec) =>
      sec.cells.map((c) => [c.coordsKey, sec.objectType] as const),
    ),
  );

  return (
    <div className="p-6 space-y-6 overflow-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Data Coverage</h1>
          <p className="text-sm text-muted-foreground max-w-3xl mt-1">
            Coverage measured over the application&apos;s data space, not its
            page count. A <strong>cell</strong> is a combination of dimension
            values that actually occurs in the data — combinations that never
            occur are never planned and never counted against you.
          </p>
        </div>
        <div className="flex gap-2">
          <label>
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => onUpload(e.target.files?.[0])}
            />
            <Button variant="outline" asChild disabled={busy !== null}>
              <span className="cursor-pointer">
                {busy === "upload" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                Upload data
              </span>
            </Button>
          </label>
          <Button onClick={runSync} disabled={busy !== null || pending}>
            {busy === "sync" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Re-profile
          </Button>
        </div>
      </div>

      {truncatedSources.length > 0 ? (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="pt-6 flex gap-2 text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
            <span>
              {truncatedSources
                .map(
                  (s) =>
                    `${s.alias}: ${s.profiledRows.toLocaleString()}/${s.rows.toLocaleString()} rows`,
                )
                .join(" · ")}{" "}
              — the original upload is no longer on disk, so profiling fell back
              to the cached preview. Re-upload the file to measure the full data
              set.
            </span>
          </CardContent>
        </Card>
      ) : null}

      {spec.caveats.length > 0 ? (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="pt-6 space-y-2">
            {spec.caveats.map((c, i) => (
              <div key={i} className="flex gap-2 text-sm">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                <span>{c}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={`${spec.acceptance.strength}-way coverage`}
          value={pct(stop.metrics.tupleCoverage)}
          hint={`${stop.metrics.coveredTuples}/${stop.metrics.totalTuples} combinations · target ${pct(spec.acceptance.pairwiseTarget)}`}
          tone={
            stop.metrics.tupleCoverage >= spec.acceptance.pairwiseTarget
              ? "good"
              : "warn"
          }
        />
        <StatCard
          label="Weighted volume"
          value={pct(stop.metrics.weightedVolumeCoverage)}
          hint={`target ${pct(spec.acceptance.weightedVolumeTarget)}${anyProfiled ? "" : " · counts are not production volume"}`}
          tone={
            stop.metrics.weightedVolumeCoverage >=
            spec.acceptance.weightedVolumeTarget
              ? "good"
              : "warn"
          }
        />
        <StatCard
          label="Cells covered"
          value={`${stop.metrics.coveredCells}/${stop.metrics.eligibleCells}`}
          hint={`${stop.metrics.excludedCells} excluded`}
        />
        <StatCard
          label="Correctly untested"
          value={String(spec.scope.skippedAsNonOccurring)}
          hint="cartesian combinations that do not occur in the data"
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {stop.shouldStop ? "Stop criteria met" : "Work remaining"}
          </CardTitle>
          <CardDescription>{stop.explanation}</CardDescription>
        </CardHeader>
      </Card>

      <Tabs defaultValue="breakdown">
        <TabsList>
          <TabsTrigger value="breakdown">Breakdown</TabsTrigger>
          <TabsTrigger value="gaps">
            Gaps
            {untestedCells.length > 0 ? (
              <Badge variant="secondary" className="ml-1.5">
                {untestedCells.length}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="dimensions">
            Dimensions{" "}
            <Badge variant="secondary" className="ml-1.5">
              {enabledDims.length}/{dimensions.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="matrix">Coverage matrix</TabsTrigger>
          <TabsTrigger value="spec">Specification</TabsTrigger>
          <TabsTrigger value="sources">Data sources</TabsTrigger>
        </TabsList>

        {/* ── Breakdown: per object type, per dimension ─────────────────── */}
        <TabsContent value="breakdown" className="space-y-4 mt-4">
          {spec.sections.length === 0 ? (
            <EmptyState onSync={runSync} busy={busy === "sync"} />
          ) : (
            spec.sections.map((s) => (
              <Card key={s.objectType}>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Database className="h-4 w-4" />
                    <code>{s.objectType}</code>
                  </CardTitle>
                  <CardDescription>
                    {s.totals.covered}/{s.totals.cells} cells covered ·{" "}
                    {pct(s.totals.tupleCoverage)} {spec.acceptance.strength}-way
                    · {s.totals.failing} failing · {s.totals.excluded} excluded
                    · {s.totals.cartesianCombinations} cartesian combinations,{" "}
                    {s.totals.skippedAsNonOccurring} of which do not occur
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {s.sample ? (
                    <div
                      className={cn(
                        "text-xs rounded-md border px-2.5 py-1.5",
                        s.sample.truncated
                          ? "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400"
                          : "text-muted-foreground",
                      )}
                    >
                      {s.sample.truncated ? (
                        <>
                          Sampled: these numbers come from{" "}
                          {s.sample.profiledRows.toLocaleString()} of{" "}
                          {s.sample.totalRows.toLocaleString()} source rows.
                          Combinations that only occur past that point are
                          missing.
                        </>
                      ) : (
                        <>
                          Profiled from all{" "}
                          {s.sample.totalRows.toLocaleString()} source rows.
                        </>
                      )}
                    </div>
                  ) : null}
                  <Progress value={s.totals.cellCoverage * 100} />
                  <div className="space-y-3">
                    {s.dimensions.map((d) => {
                      const cov = d.values.filter((v) => v.covered).length;
                      return (
                        <div key={d.field} className="space-y-1.5">
                          <div className="flex items-center justify-between text-sm">
                            <span className="font-medium">
                              <code>{d.field}</code>
                              <Badge
                                variant="outline"
                                className="ml-2 text-[10px]"
                              >
                                {d.valueSource}
                                {d.volumeIsReal ? " · real volume" : ""}
                              </Badge>
                            </span>
                            <span className="tabular-nums text-muted-foreground">
                              {cov}/{d.values.length} values
                              {cov < d.values.length ? (
                                <span className="ml-1.5 text-amber-600 dark:text-amber-400">
                                  · {d.values.length - cov} untested
                                </span>
                              ) : null}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {d.values.map((v) => (
                              <span
                                key={v.value}
                                title={`${v.recordCount} record(s) · ${pct(v.share)} of this dimension`}
                                className={cn(
                                  "text-[11px] px-1.5 py-0.5 rounded border tabular-nums",
                                  v.covered
                                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400"
                                    : "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400",
                                )}
                              >
                                {v.value}
                                <span className="opacity-60 ml-1">
                                  {v.recordCount}
                                </span>
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* ── Gaps: what is not tested, ranked ─────────────────────────── */}
        <TabsContent value="gaps" className="space-y-4 mt-4">
          {untestedCells.length === 0 && untestedValues.length === 0 ? (
            <Card>
              <CardContent className="pt-6 text-sm text-muted-foreground">
                {spec.sections.length === 0
                  ? "No coverage model yet — enable dimensions on the Dimensions tab, then press Re-profile."
                  : "Every occurring combination has been exercised at least once."}
              </CardContent>
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Target className="h-4 w-4" />
                    {untestedCells.length} untested combination(s)
                  </CardTitle>
                  <CardDescription>
                    Covering {untestedRecords.toLocaleString()} of{" "}
                    {totalRecords.toLocaleString()} records
                    {totalRecords > 0
                      ? ` (${pct(untestedRecords / totalRecords)} of the data)`
                      : ""}
                    . This is exactly the queue the QA agent plans from, highest
                    weight first.
                  </CardDescription>
                </CardHeader>
              </Card>

              {untestedValues.length > 0 ? (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">
                      Values never exercised
                    </CardTitle>
                    <CardDescription>
                      No test has ever run against these. A value here means a
                      whole slice of the data space is unseen, not just one
                      combination.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {untestedValues.map((d) => (
                      <div
                        key={`${d.objectType}.${d.field}`}
                        className="space-y-1.5"
                      >
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium">
                            <code>{d.objectType}</code>.<code>{d.field}</code>
                          </span>
                          <span className="tabular-nums text-muted-foreground">
                            {d.values.length}/{d.total} values untested
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {d.values.map((v) => (
                            <span
                              key={v.value}
                              title={`${v.recordCount} record(s) · ${pct(v.share)} of this dimension`}
                              className="text-[11px] px-1.5 py-0.5 rounded border tabular-nums bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400"
                            >
                              {v.value}
                              <span className="opacity-60 ml-1">
                                {v.recordCount}
                              </span>
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              ) : null}

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">
                    Untested combinations, ranked
                  </CardTitle>
                  <CardDescription>
                    Weight = volume × criticality × failure history × vendor
                    churn, minus redundancy with what is already covered.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                          <th className="py-2 pr-4 font-medium">Combination</th>
                          <th className="py-2 pr-4 font-medium text-right">
                            Records
                          </th>
                          <th className="py-2 pr-4 font-medium text-right">
                            Weight
                          </th>
                          <th className="py-2 font-medium" />
                        </tr>
                      </thead>
                      <tbody>
                        {untestedCells.slice(0, 200).map((c) => (
                          <tr
                            key={c.coordsKey}
                            className="border-b last:border-0 hover:bg-muted/40"
                          >
                            <td className="py-2 pr-4">
                              <div className="flex flex-wrap gap-1">
                                {Object.entries(c.coords)
                                  .sort(([a], [b]) => a.localeCompare(b))
                                  .map(([k, v]) => (
                                    <span
                                      key={k}
                                      className="text-[11px] px-1.5 py-0.5 rounded border bg-muted"
                                    >
                                      <span className="opacity-60">{k}=</span>
                                      {v}
                                    </span>
                                  ))}
                              </div>
                              <div className="text-[11px] text-muted-foreground mt-0.5">
                                <code>{cellById.get(c.coordsKey) ?? ""}</code>
                              </div>
                            </td>
                            <td className="py-2 pr-4 text-right tabular-nums">
                              {c.observedCount.toLocaleString()}
                            </td>
                            <td className="py-2 pr-4 text-right tabular-nums">
                              {c.weight.toFixed(3)}
                            </td>
                            <td className="py-2 text-right">
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={busy !== null}
                                title="Exclude — record why this is deliberately not tested"
                                onClick={() =>
                                  setExcludeTarget({
                                    cellId: c.id,
                                    coords: c.coords,
                                  })
                                }
                              >
                                <Ban className="h-3.5 w-3.5" />
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {untestedCells.length > 200 ? (
                      <p className="text-xs text-muted-foreground mt-2">
                        Showing the top 200 of {untestedCells.length}.
                      </p>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* ── Dimensions: confirm / reject auto-detected columns ────────── */}
        <TabsContent value="dimensions" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Enabled dimensions</CardTitle>
              <CardDescription>
                Only enabled dimensions form cells. Auto-detected columns start
                disabled on purpose — one free-text column enabled by accident
                turns into thousands of meaningless cells.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {dimensions.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nothing profiled yet. Upload a CSV or press Re-profile.
                </p>
              ) : (
                [...enabledDims, ...proposedDims].map((d) => (
                  <div
                    key={d.id}
                    className="flex items-center justify-between gap-4 border rounded-md px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">
                        <code>{d.objectType}</code>.<code>{d.field}</code>
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {d.cardinality} distinct value(s) · {d.valueSource}
                        {d.values.length > 0
                          ? ` · e.g. ${d.values
                              .slice(0, 4)
                              .map((v) => v.value)
                              .join(", ")}`
                          : ""}
                      </div>
                    </div>
                    <Switch
                      checked={d.enabled}
                      disabled={busy !== null}
                      onCheckedChange={(v) => toggleDimension(d.id, v)}
                    />
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Coverage matrix: the cell grid ────────────────────────────── */}
        <TabsContent value="matrix" className="space-y-4 mt-4">
          <div className="flex flex-wrap items-center gap-2">
            {(
              ["all", "uncovered", "covered", "failing", "excluded"] as const
            ).map((st) => (
              <Button
                key={st}
                size="sm"
                variant={matrixStatus === st ? "default" : "outline"}
                onClick={() => setMatrixStatus(st)}
              >
                {st}
              </Button>
            ))}
            <div className="relative ml-auto">
              <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={matrixQuery}
                onChange={(e) => setMatrixQuery(e.target.value)}
                placeholder="Filter by value, e.g. DE"
                className="pl-7 h-8 w-56"
              />
            </div>
          </div>
          {spec.sections.map((s) => {
            const fields = s.dimensions.map((d) => d.field);
            const q = matrixQuery.trim().toLowerCase();
            const rows = s.cells.filter(
              (c) =>
                (matrixStatus === "all" || c.status === matrixStatus) &&
                (!q ||
                  Object.entries(c.coords).some(
                    ([k, v]) =>
                      v.toLowerCase().includes(q) ||
                      k.toLowerCase().includes(q),
                  )),
            );
            return (
              <Card key={s.objectType}>
                <CardHeader>
                  <CardTitle className="text-base">
                    <code>{s.objectType}</code> — {rows.length}
                    {rows.length === s.cells.length
                      ? ""
                      : ` of ${s.cells.length}`}{" "}
                    occurring combination(s)
                  </CardTitle>
                  <CardDescription>
                    Ranked by weight: volume × criticality × failure history ×
                    vendor churn, minus redundancy with already-covered cells.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                          {fields.map((f) => (
                            <th key={f} className="py-2 pr-4 font-medium">
                              {f}
                            </th>
                          ))}
                          <th className="py-2 pr-4 font-medium text-right">
                            Records
                          </th>
                          <th className="py-2 pr-4 font-medium text-right">
                            Weight
                          </th>
                          <th className="py-2 pr-4 font-medium">Status</th>
                          <th className="py-2 pr-4 font-medium text-right">
                            Runs
                          </th>
                          <th className="py-2 font-medium" />
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((c) => (
                          <tr
                            key={c.coordsKey}
                            className="border-b last:border-0 hover:bg-muted/40"
                          >
                            {fields.map((f) => (
                              <td key={f} className="py-2 pr-4">
                                {c.coords[f] ?? (
                                  <span className="text-muted-foreground">
                                    —
                                  </span>
                                )}
                              </td>
                            ))}
                            <td className="py-2 pr-4 text-right tabular-nums">
                              {c.observedCount}
                            </td>
                            <td className="py-2 pr-4 text-right tabular-nums">
                              {c.weight.toFixed(3)}
                            </td>
                            <td className="py-2 pr-4">
                              {statusBadge(c.status)}
                              {c.excludedReason ? (
                                <div className="text-[11px] text-muted-foreground mt-0.5 max-w-48 truncate">
                                  {c.excludedReason}
                                </div>
                              ) : null}
                            </td>
                            <td className="py-2 pr-4 text-right tabular-nums">
                              {c.runCount > 0
                                ? `${c.passCount}/${c.runCount}`
                                : "—"}
                            </td>
                            <td className="py-2 text-right">
                              {c.status === "excluded" ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={busy !== null}
                                  onClick={() => reinstate(c.id)}
                                >
                                  <RotateCcw className="h-3.5 w-3.5" />
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={busy !== null}
                                  onClick={() =>
                                    setExcludeTarget({
                                      cellId: c.id,
                                      coords: c.coords,
                                    })
                                  }
                                >
                                  <Ban className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        {/* ── Specification: what it contains, how it is built ──────────── */}
        <TabsContent value="spec" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                How this specification is built
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-2">
              <ol className="list-decimal ml-5 space-y-1.5">
                <li>
                  <strong>Profile</strong> — every column of every connected
                  data source, plus the resolved variables of every historical
                  run, is scanned for bounded value domains. Identifier-like and
                  free-text columns are rejected and listed.
                </li>
                <li>
                  <strong>Derive</strong> — the combinations that{" "}
                  <em>actually occur</em> become cells. The cartesian product is
                  computed only to report what was skipped.
                </li>
                <li>
                  <strong>Attribute</strong> — each run is matched to its cell
                  via the variable values it resolved, so coverage is measured
                  from execution, not asserted.
                </li>
                <li>
                  <strong>Weight</strong> — volume, criticality, failure
                  history, and vendor churn, minus redundancy with covered
                  neighbours.
                </li>
                <li>
                  <strong>Stop</strong> — {spec.acceptance.strength}-way
                  coverage ≥ {pct(spec.acceptance.pairwiseTarget)} and weighted
                  volume ≥ {pct(spec.acceptance.weightedVolumeTarget)}, or the
                  next-best cell scores under{" "}
                  {spec.acceptance.marginalWeightEpsilon}.
                </li>
              </ol>
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Documented exclusions ({spec.exclusions.length})
                </CardTitle>
                <CardDescription>
                  What will deliberately not be tested, and why. This is the
                  record that lets the agent justify what it skipped.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {spec.exclusions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    None. Exclude a cell from the Coverage matrix tab.
                  </p>
                ) : (
                  spec.exclusions.map((e, i) => (
                    <div key={i} className="text-sm border rounded-md p-2">
                      <code className="text-xs">
                        {Object.entries(e.coords)
                          .sort(([a], [b]) => a.localeCompare(b))
                          .map(([k, v]) => `${k}=${v}`)
                          .join(", ")}
                      </code>
                      <div className="text-muted-foreground text-xs mt-1">
                        {e.reason}
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Outstanding work ({spec.outstanding.length})
                </CardTitle>
                <CardDescription>
                  The QA agent&apos;s queue, highest weight first.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {spec.outstanding.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nothing outstanding.
                  </p>
                ) : (
                  spec.outstanding.slice(0, 15).map((c) => (
                    <div
                      key={c.coordsKey}
                      className="flex items-center justify-between text-sm gap-2"
                    >
                      <span className="truncate">
                        {Object.entries(c.coords)
                          .sort(([a], [b]) => a.localeCompare(b))
                          .map(([, v]) => v)
                          .join(" / ")}
                      </span>
                      <span className="tabular-nums text-muted-foreground shrink-0">
                        {c.weight.toFixed(3)} · {c.observedCount} rec
                      </span>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex-row items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">Exportable document</CardTitle>
                <CardDescription>
                  Scope, acceptance criteria, per-object coverage matrix,
                  exclusions — the same structure a PQ test protocol needs.
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={loadMarkdown}
                  disabled={busy !== null}
                >
                  {busy === "spec" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : null}
                  Generate
                </Button>
                {markdown ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      navigator.clipboard.writeText(markdown);
                      toast.success("Specification copied");
                    }}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
            </CardHeader>
            {markdown ? (
              <CardContent>
                <pre className="text-xs bg-muted rounded-md p-3 overflow-x-auto max-h-[28rem] whitespace-pre">
                  {markdown}
                </pre>
              </CardContent>
            ) : null}
          </Card>
        </TabsContent>

        {/* ── Data sources ─────────────────────────────────────────────── */}
        <TabsContent value="sources" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Connected data</CardTitle>
              <CardDescription>
                Dimensions are profiled from these. Upload a CSV to analyse a
                new data set.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {sources.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No data sources connected.
                </p>
              ) : (
                sources.map((s) => (
                  <div
                    key={`${s.kind}:${s.alias}`}
                    className="flex items-center gap-3 border rounded-md px-3 py-2"
                  >
                    <FileSpreadsheet className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">
                        {s.alias}{" "}
                        <Badge variant="secondary" className="ml-1 text-[10px]">
                          {s.kind}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {s.truncated ? (
                          <span className="text-amber-600 dark:text-amber-400">
                            {s.profiledRows.toLocaleString()} of{" "}
                            {s.rows.toLocaleString()} row(s) profiled
                          </span>
                        ) : (
                          <>{s.rows.toLocaleString()} row(s)</>
                        )}{" "}
                        · {s.columns.join(", ")}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog
        open={!!excludeTarget}
        onOpenChange={(o) => !o && setExcludeTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Exclude this combination</DialogTitle>
            <DialogDescription>
              A reason is required. It is recorded in the specification so the
              exclusion is defensible rather than an unexplained gap.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <code className="text-xs block bg-muted rounded p-2">
              {excludeTarget
                ? Object.entries(excludeTarget.coords)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([k, v]) => `${k}=${v}`)
                    .join(", ")
                : ""}
            </code>
            <Input
              autoFocus
              placeholder="e.g. market not launched; combination unreachable in the UI"
              value={excludeReason}
              onChange={(e) => setExcludeReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setExcludeTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={submitExclude}
              disabled={!excludeReason.trim() || busy !== null}
            >
              Exclude
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmptyState({ onSync, busy }: { onSync: () => void; busy: boolean }) {
  return (
    <Card>
      <CardContent className="py-12 text-center space-y-3">
        <Database className="h-8 w-8 mx-auto text-muted-foreground" />
        <div className="text-sm text-muted-foreground max-w-md mx-auto">
          No coverage model yet. Upload a CSV of representative data (or connect
          a Google Sheet), then profile it — the columns with bounded value
          domains become the dimensions coverage is measured over.
        </div>
        <Button onClick={onSync} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Profile now
        </Button>
      </CardContent>
    </Card>
  );
}
