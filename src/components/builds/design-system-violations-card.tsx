"use client";

/**
 * Build-level design-system violation drill-in. Mirrors A11yViolationsCard
 * structure: one collapsible row per off-token value, severity badge,
 * occurrence count, expected→actual swatch (for colors) or px chip (for
 * radii/spacing/font-size), and the first sample test that hit the rule
 * with selector + offending element snippet.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Palette } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { BuildDesignSystemViolationRow } from "@/lib/db/queries/builds";
import type { DesignTokenCategory } from "@/lib/db/schema";

type Severity = "critical" | "serious" | "moderate" | "minor";

interface DesignSystemViolationsCardProps {
  buildId: string;
  rows: BuildDesignSystemViolationRow[];
  /** Embed inside the Verify focus pane (no outer card chrome). */
  embedded?: boolean;
}

const IMPACT_STYLE: Record<Severity, string> = {
  critical: "bg-destructive/15 text-destructive border-destructive/30",
  serious: "bg-destructive/10 text-destructive border-destructive/20",
  moderate: "bg-warning/15 text-warning-foreground border-warning/30",
  minor: "bg-muted text-muted-foreground border-border",
};

const CATEGORY_LABEL: Record<DesignTokenCategory, string> = {
  color: "COLOR",
  "border-radius": "RADIUS",
  "font-family": "FONT",
  "font-size": "TYPE",
  spacing: "SPACING",
};

function ValueChip({
  category,
  value,
}: {
  category: DesignTokenCategory;
  value: string;
}) {
  if (category === "color") {
    return (
      <span className="inline-flex items-center gap-1.5 font-mono text-[11px]">
        <span
          className="inline-block w-3 h-3 rounded-sm border border-border align-middle"
          style={{ backgroundColor: value }}
        />
        {value}
      </span>
    );
  }
  return <span className="font-mono text-[11px]">{value}</span>;
}

export function DesignSystemViolationsCard({
  buildId,
  rows,
  embedded,
}: DesignSystemViolationsCardProps) {
  // buildId currently unused in the rendered UI — kept on the props
  // signature so future links (drill-in routes / CSV download) don't need
  // to plumb the prop again.
  void buildId;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const counts = useMemo(() => {
    const c = { critical: 0, serious: 0, moderate: 0, minor: 0 };
    for (const r of rows) c[r.impact] += 1;
    return c;
  }, [rows]);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const body = (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">
            {rows.length} off-token value{rows.length === 1 ? "" : "s"}
          </span>
          {(["critical", "serious", "moderate", "minor"] as Severity[])
            .filter((s) => counts[s] > 0)
            .map((s) => (
              <Badge
                key={s}
                variant="outline"
                className={cn("text-[10px]", IMPACT_STYLE[s])}
              >
                {counts[s]} {s}
              </Badge>
            ))}
        </div>
      </div>

      <div className="border rounded-md divide-y">
        {rows.map((r) => {
          const isOpen = expanded.has(r.id);
          return (
            <Collapsible
              key={r.id}
              open={isOpen}
              onOpenChange={() => toggle(r.id)}
            >
              <CollapsibleTrigger
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 transition"
                aria-label={`Toggle details for ${r.id}`}
              >
                {isOpen ? (
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                )}
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px] uppercase",
                    IMPACT_STYLE[r.impact],
                  )}
                >
                  {r.impact}
                </Badge>
                <Badge variant="outline" className="text-[10px]">
                  {CATEGORY_LABEL[r.category]}
                </Badge>
                <span
                  className="font-mono text-xs font-medium truncate"
                  title={r.property}
                >
                  {r.property}
                </span>
                <span className="text-muted-foreground text-xs">→</span>
                <ValueChip category={r.category} value={r.actual} />
                {r.expected && (
                  <>
                    <span className="text-muted-foreground text-xs">
                      expected
                    </span>
                    <ValueChip category={r.category} value={r.expected} />
                  </>
                )}
                <span className="text-xs text-muted-foreground shrink-0 ml-auto">
                  {r.totalNodes} node{r.totalNodes === 1 ? "" : "s"}
                </span>
              </CollapsibleTrigger>
              <CollapsibleContent className="px-3 pb-3 pt-1 bg-muted/30 space-y-2">
                {r.expectedName && (
                  <p className="text-xs text-muted-foreground">
                    Closest allowed token:{" "}
                    <span className="font-mono text-foreground">
                      {r.expectedName}
                    </span>
                    {r.expected ? ` (${r.expected})` : ""}
                  </p>
                )}
                {r.samples.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Sample occurrences
                    </div>
                    {r.samples.map((s, i) => (
                      <div
                        key={`${s.testResultId}-${i}`}
                        className="rounded border bg-background px-2 py-1.5 text-xs space-y-1"
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          {s.areaName && (
                            <span className="text-muted-foreground">
                              {s.areaName} ·
                            </span>
                          )}
                          {s.testId ? (
                            <Link
                              href={`/tests/${s.testId}`}
                              className="font-medium text-primary hover:underline truncate"
                              title={s.testName ?? s.testId}
                            >
                              {s.testName ?? s.testId}
                            </Link>
                          ) : (
                            <span className="font-medium truncate">
                              {s.testName ?? "—"}
                            </span>
                          )}
                          <span className="text-muted-foreground ml-auto">
                            {s.nodes} node{s.nodes === 1 ? "" : "s"}
                          </span>
                        </div>
                        {s.sampleNode?.target?.length ? (
                          <div className="font-mono text-[11px] text-foreground/80 break-all">
                            <span className="text-muted-foreground">
                              selector:
                            </span>{" "}
                            {s.sampleNode.target.join(" ")}
                          </div>
                        ) : null}
                        {s.sampleNode?.failureSummary ? (
                          <div className="text-[11px] text-muted-foreground whitespace-pre-line">
                            {s.sampleNode.failureSummary}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </CollapsibleContent>
            </Collapsible>
          );
        })}
      </div>
    </div>
  );

  if (embedded) return body;
  if (rows.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Palette className="h-4 w-4" />
          Off-token values · {rows.length} rule{rows.length === 1 ? "" : "s"}
        </CardTitle>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
