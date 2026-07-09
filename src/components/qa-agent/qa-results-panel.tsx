"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type {
  QaGeneratedTest,
  QaPrCoverageEntry,
  QaSummaryData,
  QaTestGroup,
  QaTestPlan,
} from "@/lib/db/schema";
import { QA_GROUPS } from "@/lib/qa-agent/plan";
import { timeAgo } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CheckCircle2,
  CircleDashed,
  ExternalLink,
  FileCheck,
  FileCode,
  GitBranch,
  LayoutDashboard,
  Loader2,
  Plus,
  TrendingUp,
  Wrench,
  XCircle,
} from "lucide-react";

/** Hint passed to the "ask the agent to increase coverage" CTAs — a specific
 *  matrix gap (area × group) or blank for a general fill-gaps request. */
export interface CoverageRequestHint {
  area?: string;
  group?: QaTestGroup;
}

const STATUS_META: Record<
  QaGeneratedTest["status"],
  { label: string; className: string; icon: typeof CheckCircle2 }
> = {
  generating: {
    label: "Generating",
    className: "bg-info/10 text-info border-info/30",
    icon: Loader2,
  },
  generated: {
    label: "Generated",
    className: "bg-muted text-muted-foreground border-border",
    icon: FileCode,
  },
  generation_failed: {
    label: "Gen failed",
    className: "bg-destructive/10 text-destructive border-destructive/30",
    icon: XCircle,
  },
  covered: {
    label: "Covered",
    className: "bg-info/10 text-info border-info/30",
    icon: FileCheck,
  },
  passed: {
    label: "Passed",
    className: "bg-success/10 text-success border-success/30",
    icon: CheckCircle2,
  },
  failed: {
    label: "Failed",
    className: "bg-destructive/10 text-destructive border-destructive/30",
    icon: XCircle,
  },
  healed: {
    label: "Healed",
    className: "bg-success/10 text-success border-success/30",
    icon: Wrench,
  },
};

export function QaGeneratedTestsPanel({
  generated,
}: {
  generated: QaGeneratedTest[];
}) {
  if (generated.length === 0) return null;
  const byGroup = new Map<QaTestGroup, QaGeneratedTest[]>();
  for (const test of generated) {
    const list = byGroup.get(test.group) ?? [];
    list.push(test);
    byGroup.set(test.group, list);
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <FileCode className="h-4 w-4" />
          Generated tests
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {QA_GROUPS.filter((g) => byGroup.has(g.id)).map((group) => (
          <div key={group.id} className="space-y-1.5">
            <h4 className="text-sm font-medium">
              {group.label}{" "}
              <span className="text-xs font-normal text-muted-foreground">
                ({byGroup.get(group.id)!.length})
              </span>
            </h4>
            <div className="space-y-1">
              {byGroup.get(group.id)!.map((test) => {
                const meta = STATUS_META[test.status];
                const Icon = meta.icon;
                return (
                  <div
                    key={test.planItemId}
                    className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm"
                  >
                    <Badge
                      variant="outline"
                      className={`text-[10px] px-1.5 shrink-0 gap-1 ${meta.className}`}
                    >
                      <Icon
                        className={`h-3 w-3 ${test.status === "generating" ? "animate-spin" : ""}`}
                      />
                      {meta.label}
                    </Badge>
                    <span className="truncate flex-1">{test.name}</span>
                    {test.error && (
                      <span
                        className="text-xs text-destructive truncate max-w-[200px]"
                        title={test.error}
                      >
                        {test.error}
                      </span>
                    )}
                    {test.testId && (
                      <Link
                        href={`/tests/${test.testId}`}
                        className="text-muted-foreground hover:text-foreground shrink-0"
                        title="Open test"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

const PR_STATUS_META: Record<
  QaPrCoverageEntry["status"],
  { label: string; className: string; icon: typeof CheckCircle2 }
> = {
  passed: {
    label: "Passing",
    className: "bg-success/10 text-success border-success/30",
    icon: CheckCircle2,
  },
  covered: {
    label: "Covered",
    className: "bg-info/10 text-info border-info/30",
    icon: FileCheck,
  },
  generated: {
    label: "Test created",
    className: "bg-info/10 text-info border-info/30",
    icon: FileCode,
  },
  planned: {
    label: "Planned only",
    className: "bg-warning/10 text-warning border-warning/30",
    icon: CircleDashed,
  },
  uncovered: {
    label: "Uncovered",
    className: "bg-destructive/10 text-destructive border-destructive/30",
    icon: XCircle,
  },
};

const PR_CHANGE_LABEL: Record<QaPrCoverageEntry["change"], string> = {
  added: "new",
  modified: "changed",
  removed: "removed",
};

/** Per-change coverage of the branch diff — which functions/endpoints the
 *  working branch touched and whether a test now exercises each one. */
function QaPrCoverageSection({
  prCoverage,
}: {
  prCoverage: NonNullable<QaSummaryData["prCoverage"]>;
}) {
  if (prCoverage.entries.length === 0) return null;
  const total = prCoverage.entries.length;
  return (
    <div className="space-y-1">
      <h4 className="flex items-center gap-1.5 text-sm font-medium">
        <GitBranch className="h-3.5 w-3.5" />
        Branch changes coverage{" "}
        <span className="text-xs font-normal text-muted-foreground">
          — <code>{prCoverage.headBranch}</code> vs{" "}
          <code>{prCoverage.baseBranch}</code>:{" "}
          <span
            className={
              prCoverage.coveredCount === total
                ? "text-success"
                : "text-warning"
            }
          >
            {prCoverage.coveredCount}/{total}
          </span>{" "}
          changed functions & endpoints have tests
        </span>
      </h4>
      <div className="rounded-md border divide-y">
        {prCoverage.entries.map((entry) => {
          const meta = PR_STATUS_META[entry.status];
          const Icon = meta.icon;
          return (
            <div
              key={`${entry.kind}:${entry.ref}`}
              className="flex items-center gap-2 px-3 py-1.5 text-sm"
            >
              <Badge
                variant="outline"
                className={`text-[10px] px-1.5 shrink-0 gap-1 ${meta.className}`}
              >
                <Icon className="h-3 w-3" />
                {meta.label}
              </Badge>
              <code className="truncate text-xs">{entry.ref}</code>
              <span className="text-[10px] text-muted-foreground shrink-0">
                {PR_CHANGE_LABEL[entry.change]}{" "}
                {entry.kind === "endpoint" ? "endpoint" : "function"}
              </span>
              <span
                className="ml-auto truncate text-[10px] text-muted-foreground max-w-[220px]"
                title={entry.file}
              >
                {entry.file}
              </span>
              {entry.testIds[0] && (
                <Link
                  href={`/tests/${entry.testIds[0]}`}
                  className="text-muted-foreground hover:text-foreground shrink-0"
                  title={
                    entry.testIds.length > 1
                      ? `Open test (1 of ${entry.testIds.length})`
                      : "Open test"
                  }
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function QaSummaryPanel({
  summary,
  plan,
  persistent = false,
  updatedAt,
  onRequestCoverage,
  requestPending = false,
}: {
  summary: QaSummaryData;
  plan: QaTestPlan | undefined;
  /** Render as the always-current coverage dashboard (vs a per-run summary). */
  persistent?: boolean;
  /** When the summary was produced (persistent framing). */
  updatedAt?: Date | string | null;
  /** Queue an "increase coverage" task for the agent — header button and
   *  per-gap-cell CTAs render only when provided. */
  onRequestCoverage?: (hint: CoverageRequestHint) => void;
  requestPending?: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // Hydration guard: timeAgo() drifts between server render and client mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);
  const groupRows = QA_GROUPS.filter((g) => summary.byGroup[g.id]);
  const gaps = Math.max(
    0,
    summary.planned - (summary.covered ?? 0) - summary.generated,
  );
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          {persistent ? (
            <LayoutDashboard className="h-4 w-4" />
          ) : (
            <CheckCircle2 className="h-4 w-4" />
          )}
          {persistent ? "Coverage dashboard" : "Coverage summary"}
          {persistent && updatedAt && mounted && (
            <span className="text-xs font-normal text-muted-foreground">
              — updated {timeAgo(new Date(updatedAt))}
            </span>
          )}
          {onRequestCoverage && (
            <Button
              size="sm"
              variant="outline"
              className="ml-auto"
              disabled={requestPending}
              title={
                gaps > 0
                  ? `Queue a task to close the ${gaps} remaining gap${gaps === 1 ? "" : "s"}`
                  : "Queue a task to broaden coverage"
              }
              onClick={() => onRequestCoverage({})}
            >
              <TrendingUp className="h-3.5 w-3.5" />
              Increase coverage
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: "Planned", value: summary.planned },
            { label: "Covered", value: summary.covered ?? 0 },
            { label: "Generated", value: summary.generated },
            { label: "Passing", value: summary.passed },
            {
              label: "Gaps",
              value: Math.max(
                0,
                summary.planned - (summary.covered ?? 0) - summary.generated,
              ),
            },
          ].map((stat) => (
            <div key={stat.label} className="rounded-md border p-3 text-center">
              <div className="text-2xl font-semibold">{stat.value}</div>
              <div className="text-xs text-muted-foreground">{stat.label}</div>
            </div>
          ))}
        </div>

        {summary.prCoverage && (
          <QaPrCoverageSection prCoverage={summary.prCoverage} />
        )}

        {summary.matrix && Object.keys(summary.matrix).length > 0 && (
          <div className="space-y-1">
            <h4 className="text-sm font-medium">
              Coverage matrix{" "}
              <span className="text-xs font-normal text-muted-foreground">
                — business area × test group (covered+generated / planned, ✓
                passing this run; a multi-group test counts in every column it
                covers)
              </span>
            </h4>
            <div className="rounded-md border overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="w-full text-left px-3 py-1.5 font-medium">
                      Business area
                    </th>
                    {QA_GROUPS.filter((g) =>
                      Object.values(summary.matrix!).some((row) => row[g.id]),
                    ).map((g) => (
                      <th
                        key={g.id}
                        className="w-14 text-center px-1.5 py-1.5 font-medium text-xs whitespace-nowrap"
                        title={`${g.label} — ${g.description}`}
                      >
                        {g.short}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {Object.entries(summary.matrix).map(([area, row]) => (
                    <tr key={area}>
                      <td className="px-3 py-1.5 font-medium whitespace-nowrap">
                        {area}
                      </td>
                      {QA_GROUPS.filter((g) =>
                        Object.values(summary.matrix!).some((r) => r[g.id]),
                      ).map((g) => {
                        const cell = row[g.id];
                        if (!cell || cell.planned === 0) {
                          return (
                            <td
                              key={g.id}
                              className="text-center px-2 py-1.5 text-muted-foreground/40"
                            >
                              —
                            </td>
                          );
                        }
                        const done = cell.covered + cell.generated;
                        const complete =
                          cell.covered + cell.passed === cell.planned;
                        const hasGap = done < cell.planned;
                        return (
                          <td
                            key={g.id}
                            className={`text-center px-2 py-1.5 whitespace-nowrap ${
                              complete
                                ? "text-success"
                                : hasGap
                                  ? "text-warning"
                                  : ""
                            }`}
                            title={`planned ${cell.planned} · covered ${cell.covered} · generated ${cell.generated} · passing ${cell.passed}`}
                          >
                            {done}/{cell.planned}
                            {cell.passed > 0 && (
                              <span className="text-xs text-success">
                                {" "}
                                {cell.passed}✓
                              </span>
                            )}
                            {hasGap && onRequestCoverage && (
                              <button
                                type="button"
                                className="ml-1 inline-flex align-[-2px] rounded border border-warning/40 text-warning hover:bg-warning/10 disabled:opacity-50"
                                title={`Ask the agent to cover the ${area} × ${g.label} gap`}
                                disabled={requestPending}
                                onClick={() =>
                                  onRequestCoverage({ area, group: g.id })
                                }
                              >
                                <Plus className="h-3 w-3" />
                              </button>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {groupRows.length > 0 && (
          <div className="space-y-1">
            <h4 className="text-sm font-medium">
              By group{" "}
              <span className="text-xs font-normal text-muted-foreground">
                — covered+generated / planned (a multi-group test counts in
                every group it covers, so these rows sum higher than the totals
                above)
              </span>
            </h4>
            <div className="rounded-md border divide-y">
              {groupRows.map((group) => {
                const row = summary.byGroup[group.id]!;
                const covered = row.covered ?? 0;
                const done = covered + row.generated;
                const gap = Math.max(0, row.planned - done);
                const complete = gap === 0;
                const composition = [
                  covered > 0 && `${covered} existing`,
                  row.generated > 0 && `${row.generated} new`,
                  row.passed > 0 && `${row.passed} passing`,
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <div
                    key={group.id}
                    className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm"
                  >
                    <span>{group.label}</span>
                    <span className="flex items-center gap-2 text-xs">
                      {composition && (
                        <span className="text-muted-foreground">
                          {composition}
                        </span>
                      )}
                      <span
                        className={`font-medium ${
                          complete ? "text-success" : "text-warning"
                        }`}
                        title={
                          complete
                            ? "Fully covered — existing tests satisfy the rest, so nothing needed generating"
                            : `${gap} planned ${gap === 1 ? "test" : "tests"} not yet covered or generated`
                        }
                      >
                        {done}/{row.planned}
                      </span>
                      {gap > 0 && onRequestCoverage && (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded border border-warning/40 px-1.5 py-0.5 text-warning hover:bg-warning/10 disabled:opacity-50"
                          title={`Plan & generate ${gap} more ${gap === 1 ? "test" : "tests"} to complete ${group.label} coverage`}
                          disabled={requestPending}
                          onClick={() => onRequestCoverage({ group: group.id })}
                        >
                          <Plus className="h-3 w-3" />
                          Plan &amp; generate
                        </button>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {plan && plan.journeys.length > 0 && (
          <div className="space-y-1">
            <h4 className="text-sm font-medium">Journey traceability</h4>
            <div className="rounded-md border divide-y">
              {plan.journeys.map((journey) => {
                const testIds = summary.journeyCoverage[journey.id] ?? [];
                return (
                  <div
                    key={journey.id}
                    className="flex items-center justify-between px-3 py-1.5 text-sm gap-2"
                  >
                    <span className="truncate">{journey.title}</span>
                    <span
                      className={`text-xs shrink-0 ${testIds.length > 0 ? "text-success" : "text-warning"}`}
                    >
                      {testIds.length > 0
                        ? `${testIds.length} test${testIds.length === 1 ? "" : "s"}`
                        : "uncovered"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
