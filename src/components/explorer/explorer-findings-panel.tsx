"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  AgentFinding,
  ExplorerReport,
  ExplorerSeverity,
} from "@/lib/db/schema";
import { setFindingStatus } from "@/server/actions/explorer-agent";
import { Bug, Sparkles } from "lucide-react";
import { toast } from "sonner";

const SEVERITY_STYLES: Record<ExplorerSeverity, string> = {
  critical: "bg-red-600 text-white",
  high: "bg-red-500/15 text-red-600 border-red-500/30",
  medium: "bg-amber-500/15 text-amber-600 border-amber-500/30",
  low: "bg-blue-500/15 text-blue-600 border-blue-500/30",
  info: "bg-muted text-muted-foreground",
};

const SEVERITY_ORDER: ExplorerSeverity[] = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
];

function FindingRow({
  finding,
  onStatusChange,
}: {
  finding: AgentFinding;
  onStatusChange: (id: string, status: "dismissed" | "triaged") => void;
}) {
  return (
    <div className="rounded-md border p-3 space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Badge className={SEVERITY_STYLES[finding.severity]}>
            {finding.severity}
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            {finding.kind}
          </Badge>
          <span className="text-sm font-medium truncate">{finding.title}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {finding.status === "open" ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs"
                onClick={() => onStatusChange(finding.id, "triaged")}
              >
                Triage
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs text-muted-foreground"
                onClick={() => onStatusChange(finding.id, "dismissed")}
              >
                Dismiss
              </Button>
            </>
          ) : (
            <Badge variant="outline" className="text-[10px]">
              {finding.status}
            </Badge>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground whitespace-pre-line break-words">
        {finding.description}
      </p>
      {finding.url && (
        <p className="text-[11px] text-muted-foreground/70 truncate">
          {finding.url}
        </p>
      )}
      {(finding.evidence?.consoleErrors?.length ?? 0) > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            Console errors ({finding.evidence!.consoleErrors!.length})
          </summary>
          <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-red-600/80">
            {finding.evidence!.consoleErrors!.slice(0, 8).map((e, i) => (
              <li key={i} className="truncate">
                {e}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export function ExplorerFindingsPanel({
  findings,
  report,
}: {
  findings: AgentFinding[];
  report?: ExplorerReport;
}) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const visible = useMemo(
    () => findings.filter((f) => !hidden.has(f.id)),
    [findings, hidden],
  );

  const handleStatus = async (id: string, status: "dismissed" | "triaged") => {
    try {
      await setFindingStatus(id, status);
      if (status === "dismissed") {
        setHidden((prev) => new Set(prev).add(id));
      }
      toast.success(
        status === "dismissed" ? "Finding dismissed" : "Marked triaged",
      );
    } catch {
      toast.error("Could not update the finding");
    }
  };

  if (findings.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bug className="h-4 w-4" />
            Findings
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          No findings yet — defects and UX issues the explorer observes will
          appear here as it works.
        </CardContent>
      </Card>
    );
  }

  const byId = new Map(visible.map((f) => [f.id, f]));
  const clustered = new Set(
    (report?.clusters ?? []).flatMap((c) => c.findingIds),
  );
  const unclustered = visible.filter((f) => !clustered.has(f.id));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Bug className="h-4 w-4" />
          Findings
          <span className="text-xs font-normal text-muted-foreground">
            {visible.length} total
            {report ? ` in ${report.clusters.length} root-cause clusters` : ""}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {report?.assessment && (
          <div className="rounded-md bg-muted/50 p-3 text-sm flex gap-2">
            <Sparkles className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
            <p>{report.assessment}</p>
          </div>
        )}
        {report
          ? [...report.clusters]
              .sort(
                (a, b) =>
                  SEVERITY_ORDER.indexOf(a.severity) -
                  SEVERITY_ORDER.indexOf(b.severity),
              )
              .map((cluster, i) => {
                const rows = cluster.findingIds
                  .map((id) => byId.get(id))
                  .filter((f): f is AgentFinding => Boolean(f));
                if (rows.length === 0) return null;
                return (
                  <div key={i} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge className={SEVERITY_STYLES[cluster.severity]}>
                        {cluster.severity}
                      </Badge>
                      <span className="text-sm font-semibold">
                        {cluster.rootCause}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {rows.length} finding{rows.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    {cluster.summary && (
                      <p className="text-xs text-muted-foreground">
                        {cluster.summary}
                      </p>
                    )}
                    <div className="space-y-2">
                      {rows.map((f) => (
                        <FindingRow
                          key={f.id}
                          finding={f}
                          onStatusChange={handleStatus}
                        />
                      ))}
                    </div>
                  </div>
                );
              })
          : null}
        {(report ? unclustered : visible).length > 0 && (
          <div className="space-y-2">
            {report && (
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Not yet clustered
              </span>
            )}
            {(report ? unclustered : visible).map((f) => (
              <FindingRow
                key={f.id}
                finding={f}
                onStatusChange={handleStatus}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
