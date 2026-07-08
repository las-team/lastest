"use client";

import Link from "next/link";
import type {
  QaGeneratedTest,
  QaSummaryData,
  QaTestGroup,
  QaTestPlan,
} from "@/lib/db/schema";
import { QA_GROUPS } from "@/lib/qa-agent/plan";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CheckCircle2,
  ExternalLink,
  FileCheck,
  FileCode,
  Loader2,
  Wrench,
  XCircle,
} from "lucide-react";

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

export function QaSummaryPanel({
  summary,
  plan,
}: {
  summary: QaSummaryData;
  plan: QaTestPlan | undefined;
}) {
  const groupRows = QA_GROUPS.filter((g) => summary.byGroup[g.id]);
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <CheckCircle2 className="h-4 w-4" />
          Coverage summary
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

        {groupRows.length > 0 && (
          <div className="space-y-1">
            <h4 className="text-sm font-medium">By group</h4>
            <div className="rounded-md border divide-y">
              {groupRows.map((group) => {
                const row = summary.byGroup[group.id]!;
                return (
                  <div
                    key={group.id}
                    className="flex items-center justify-between px-3 py-1.5 text-sm"
                  >
                    <span>{group.label}</span>
                    <span className="text-muted-foreground text-xs">
                      {(row.covered ?? 0) > 0 && `${row.covered} covered · `}
                      {row.generated}/{row.planned} generated · {row.passed}{" "}
                      passing
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
