"use client";

/**
 * One run, rendered from the engine's own records.
 *
 * The column set follows the run's MODE rather than a single generic table:
 * a delta's interesting numbers (hash skips, routed deletes) are not an init's,
 * and a table that showed every column for every mode would be mostly zeros.
 */

import {
  FailedRowsTable,
  FindingsTable,
  UnitTable,
  WatermarkTable,
} from "./migration-tables";
import { RunStatusBadge, StatRow, runProduced } from "./panel-shell";
import { Badge } from "@lastest/ui";
import type { MigrationRun } from "../schema";
import type {
  ReconciliationRow,
  RowResult,
  StoredFinding,
  Watermark,
} from "@lastest/veeva-migration";

export function RunDetail({
  run,
  waveLabel,
  findings,
  reconciliation,
  failedRows,
  watermarks,
}: {
  run: MigrationRun;
  waveLabel: string | null;
  findings: StoredFinding[];
  reconciliation: ReconciliationRow[];
  failedRows: RowResult[];
  watermarks: Watermark[];
}) {
  const variant =
    run.mode === "delta" || run.mode === "final-delta"
      ? "delta"
      : run.mode === "verify"
        ? "verify"
        : "load";
  const rows = run.summary?.rows;
  // A run whose engine state has been reset (or which died before writing any)
  // has empty tables, and "no findings" would read as a clean bill of health.
  const produced = runProduced(run);
  const emptyUnits = produced
    ? "No per-unit numbers were recorded for this run."
    : "This run did not reach the point of loading anything.";
  const emptyFindings = produced
    ? "No findings were recorded for this run."
    : "This run did not reach the point of producing findings.";

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight font-mono">
            {run.mode}
          </h1>
          {run.dryRun && <Badge variant="outline">dry run</Badge>}
          <RunStatusBadge status={run.status} />
          {run.summary?.gate && (
            <Badge
              className={
                run.summary.gate === "pass"
                  ? "bg-emerald-600 hover:bg-emerald-600"
                  : run.summary.gate === "fail"
                    ? "bg-destructive hover:bg-destructive"
                    : ""
              }
              variant={run.summary.gate === "pending" ? "outline" : "default"}
            >
              gate {run.summary.gate}
            </Badge>
          )}
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground font-mono">
          <Item label="run id" value={run.engineRunId ?? "—"} />
          {waveLabel && <Item label="wave" value={waveLabel} />}
          <Item label="countries" value={run.countries.join(", ") || "—"} />
          {typeof run.summary?.exitCode === "number" && (
            <Item label="exit" value={String(run.summary.exitCode)} />
          )}
          <Item
            label="started"
            value={run.startedAt ? new Date(run.startedAt).toISOString() : "—"}
          />
          {run.finishedAt && (
            <Item
              label="finished"
              value={new Date(run.finishedAt).toISOString()}
            />
          )}
        </dl>
        {run.error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs">
            {run.error}
          </p>
        )}
        {run.justification && (
          <p className="text-xs text-muted-foreground">
            Operator note: {run.justification}
          </p>
        )}
      </header>

      {rows && (
        <StatRow
          stats={[
            { label: "Extracted", value: rows.extracted },
            { label: "Created", value: rows.created },
            { label: "Updated", value: rows.updated },
            { label: "Unchanged", value: rows.unchanged, tone: "muted" },
            { label: "Skipped", value: rows.skipped, tone: "muted" },
            { label: "Pending FK", value: rows.pendingFk, tone: "bad" },
            { label: "Deleted", value: rows.deleted },
            { label: "Failed", value: rows.failed, tone: "bad" },
          ]}
        />
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Units</h2>
        <UnitTable rows={reconciliation} variant={variant} empty={emptyUnits} />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Findings</h2>
        <FindingsTable findings={findings} empty={emptyFindings} />
      </section>

      {failedRows.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">
            Failed rows
            <span className="ml-2 font-normal text-xs text-muted-foreground">
              first {failedRows.length}
            </span>
          </h2>
          <FailedRowsTable rows={failedRows} />
        </section>
      )}

      {variant === "delta" && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">Watermarks</h2>
          <WatermarkTable watermarks={watermarks} />
        </section>
      )}
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-muted-foreground/70">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
