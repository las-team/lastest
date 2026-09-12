"use client";

/**
 * The tables the console shows, one per thing the engine records.
 *
 * These are deliberately the SAME tables the CLI prints (and the demo
 * screencast walks) — load order, mapping, unit results, watermarks, findings,
 * crosswalk. An operator who has read a run report should recognise every
 * column here, and someone who has only used the console should be able to
 * read a report. Column names therefore track the engine's vocabulary
 * (`extracted`, `unchanged`, `pending FK`) rather than being softened.
 */

import { cn } from "@lastest/ui";
import { Badge } from "@lastest/ui";
import { AlertTriangle, Ban, Check, Info, Minus } from "lucide-react";
import type {
  ReconciliationRow,
  RowResult,
  StoredFinding,
  Watermark,
} from "@lastest/veeva-migration";
import type { PlanFieldRow, PlanUnitRow } from "../plan";

/** A monospaced, horizontally scrollable table. Every table here uses it. */
export function DataTable({
  head,
  children,
  empty,
  isEmpty,
  /** Cap the height and scroll inside, with a sticky header. A wave of five
   *  countries plans ~200 units; letting that table set the page height buries
   *  everything under it. */
  capHeight,
}: {
  head: React.ReactNode;
  children: React.ReactNode;
  empty: string;
  isEmpty: boolean;
  capHeight?: boolean;
}) {
  if (isEmpty) {
    return (
      <p className="text-xs text-muted-foreground py-6 text-center border border-dashed rounded-md">
        {empty}
      </p>
    );
  }
  return (
    // Tables are the one thing allowed to be wider than the panel: a unit grid
    // with ten count columns does not fold, and wrapping it would make the
    // numbers unreadable rather than merely off-screen.
    <div
      className={cn(
        "overflow-x-auto rounded-md border",
        capHeight && "max-h-[26rem] overflow-y-auto",
      )}
    >
      <table className="w-full text-xs">
        <thead className={cn("bg-muted/50", capHeight && "sticky top-0 z-10")}>
          <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left [&>th]:font-medium [&>th]:whitespace-nowrap">
            {head}
          </tr>
        </thead>
        <tbody className="[&>tr]:border-t [&>tr>td]:px-3 [&>tr>td]:py-1.5 [&>tr>td]:whitespace-nowrap">
          {children}
        </tbody>
      </table>
    </div>
  );
}

function Num({
  value,
  muted,
}: {
  value: number | null | undefined;
  muted?: boolean;
}) {
  const n = value ?? 0;
  return (
    <td
      className={cn(
        "font-mono tabular-nums text-right",
        (n === 0 || muted) && "text-muted-foreground",
      )}
    >
      {n}
    </td>
  );
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export function LoadOrderTable({ units }: { units: PlanUnitRow[] }) {
  return (
    <DataTable
      capHeight
      isEmpty={units.length === 0}
      empty="No units — the wave has no countries, or every object is out of scope."
      head={
        <>
          <th>#</th>
          <th>unit</th>
          <th>source object</th>
          <th>vault object</th>
          <th>depends on</th>
          <th>step</th>
          <th>mapping hash</th>
        </>
      }
    >
      {units.map((u) => (
        <tr key={u.unitId}>
          <td className="font-mono text-muted-foreground">{u.index}</td>
          <td className="font-mono font-medium">{u.unitId}</td>
          <td className="font-mono">{u.sourceObject}</td>
          <td className="font-mono">{u.targetObject}</td>
          <td className="font-mono text-muted-foreground">
            {u.dependsOn.length ? u.dependsOn.join(", ") : "—"}
          </td>
          <td className="font-mono text-muted-foreground">{u.step}</td>
          <td className="font-mono text-muted-foreground">
            {u.mappingHash ? u.mappingHash.slice(0, 12) : "—"}
            {u.secondPass.length > 0 && (
              <span
                className="ml-2 text-[10px] uppercase tracking-wide text-amber-600"
                title={`Self-references patched in a second pass: ${u.secondPass.join(", ")}`}
              >
                pass 2
              </span>
            )}
          </td>
        </tr>
      ))}
    </DataTable>
  );
}

export function MappingTable({ fields }: { fields: PlanFieldRow[] }) {
  return (
    <DataTable
      capHeight
      isEmpty={fields.length === 0}
      empty="This unit has no mapped fields."
      head={
        <>
          <th>salesforce field</th>
          <th>vault field</th>
          <th>transform</th>
          <th className="text-center">req</th>
        </>
      }
    >
      {fields.map((f, i) => (
        <tr key={`${f.target}-${i}`}>
          <td className="font-mono">
            {f.source || <span className="text-muted-foreground">—</span>}
          </td>
          <td className="font-mono">{f.target}</td>
          <td className="font-mono text-muted-foreground">{f.transform}</td>
          <td className="text-center font-mono">
            {f.requirement === "K" ? (
              <span title="Legacy-id key — the upsert is keyed on this field">
                K
              </span>
            ) : f.requirement === "Y" ? (
              <span title="Required">Y</span>
            ) : (
              <span className="text-muted-foreground" title="Optional">
                n
              </span>
            )}
          </td>
        </tr>
      ))}
    </DataTable>
  );
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

const SEVERITY_STYLE = {
  blocking: {
    icon: Ban,
    className: "text-destructive",
    badge: "bg-destructive/10 text-destructive ring-destructive/20",
  },
  warning: {
    icon: AlertTriangle,
    className: "text-amber-600",
    badge:
      "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-400",
  },
  info: {
    icon: Info,
    className: "text-muted-foreground",
    badge: "bg-muted text-muted-foreground ring-border",
  },
} as const;

export function SeverityPill({ severity }: { severity: string }) {
  const style =
    SEVERITY_STYLE[severity as keyof typeof SEVERITY_STYLE] ??
    SEVERITY_STYLE.info;
  const Icon = style.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1",
        style.badge,
      )}
    >
      <Icon className="h-2.5 w-2.5" />
      {severity}
    </span>
  );
}

export interface FindingRow extends StoredFinding {
  /** Present in this run but not the previous one — the thing today changed. */
  isNew?: boolean;
  /** Accepted by a human, with the reason they gave. */
  ack?: { id: string; justification: string } | null;
}

export function FindingsTable({
  findings,
  onAccept,
  onRevoke,
  empty = "No findings — the plan matches live metadata on both sides.",
}: {
  findings: FindingRow[];
  onAccept?: (f: FindingRow) => void;
  onRevoke?: (ackId: string) => void;
  /** Overridden when the run failed: emptiness then means "never got there". */
  empty?: string;
}) {
  return (
    <DataTable
      capHeight
      isEmpty={findings.length === 0}
      empty={empty}
      head={
        <>
          <th>severity</th>
          <th>code</th>
          <th>object</th>
          <th>country</th>
          <th>field</th>
          <th className="text-right">count</th>
          <th>detail</th>
          {(onAccept || onRevoke) && <th />}
        </>
      }
    >
      {findings.map((f, i) => (
        <tr key={`${f.code}-${f.objectKey ?? ""}-${f.country ?? ""}-${i}`}>
          <td>
            <span className="inline-flex items-center gap-1.5">
              <SeverityPill severity={f.severity} />
              {f.isNew && (
                <span
                  className="text-[10px] font-semibold uppercase tracking-wide text-primary"
                  title="Not present in the previous run"
                >
                  new
                </span>
              )}
            </span>
          </td>
          <td className="font-mono font-medium">{f.code}</td>
          <td className="font-mono text-muted-foreground">
            {f.objectKey ?? "—"}
          </td>
          <td className="font-mono text-muted-foreground">
            {f.country ?? "—"}
          </td>
          <td className="font-mono text-muted-foreground">{f.field ?? "—"}</td>
          <Num value={f.count} />
          <td className="max-w-[28rem] truncate" title={detailText(f.detail)}>
            {detailText(f.detail)}
          </td>
          {(onAccept || onRevoke) && (
            <td className="text-right">
              {f.ack ? (
                <button
                  type="button"
                  className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2"
                  title={f.ack.justification}
                  onClick={() => onRevoke?.(f.ack!.id)}
                >
                  accepted
                </button>
              ) : (
                onAccept && (
                  <button
                    type="button"
                    className="text-[11px] text-primary hover:underline underline-offset-2"
                    onClick={() => onAccept(f)}
                  >
                    accept
                  </button>
                )
              )}
            </td>
          )}
        </tr>
      ))}
    </DataTable>
  );
}

export function detailText(detail: unknown): string {
  return typeof detail === "string" ? detail : JSON.stringify(detail);
}

// ---------------------------------------------------------------------------
// Unit results
// ---------------------------------------------------------------------------

function UnitStatus({ status }: { status: ReconciliationRow["status"] }) {
  if (status === "pass")
    return (
      <span className="inline-flex items-center gap-1 text-emerald-600 font-medium">
        <Check className="h-3 w-3" />
        pass
      </span>
    );
  if (status === "fail")
    return (
      <span className="inline-flex items-center gap-1 text-destructive font-medium">
        <Ban className="h-3 w-3" />
        fail
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      <Minus className="h-3 w-3" />
      pending
    </span>
  );
}

/** Column sets per mode — the demo prints a different table for init vs delta. */
export type UnitTableVariant = "load" | "delta" | "verify";

export function UnitTable({
  rows,
  variant,
  empty = "No per-unit numbers yet — they are written as each unit finishes.",
}: {
  rows: ReconciliationRow[];
  variant: UnitTableVariant;
  empty?: string;
}) {
  const head =
    variant === "delta" ? (
      <>
        <th>unit</th>
        <th>status</th>
        <th className="text-right">extracted</th>
        <th className="text-right">unchanged</th>
        <th className="text-right">created</th>
        <th className="text-right">updated</th>
        <th className="text-right">deleted</th>
        <th className="text-right">applied</th>
        <th className="text-right">ignored</th>
        <th className="text-right">failed</th>
      </>
    ) : variant === "verify" ? (
      <>
        <th>unit</th>
        <th>status</th>
        <th className="text-right">sfdc scope</th>
        <th className="text-right">extracted</th>
        <th className="text-right">vault count</th>
        <th className="text-right">pending FK</th>
        <th className="text-right">failed</th>
      </>
    ) : (
      <>
        <th>unit</th>
        <th>status</th>
        <th className="text-right">extracted</th>
        <th className="text-right">transformed</th>
        <th className="text-right">created</th>
        <th className="text-right">updated</th>
        <th className="text-right">unchanged</th>
        <th className="text-right">skipped</th>
        <th className="text-right">pending FK</th>
        <th className="text-right">failed</th>
        <th className="text-right">in vault</th>
      </>
    );

  return (
    <DataTable capHeight isEmpty={rows.length === 0} empty={empty} head={head}>
      {rows.map((r) => (
        <tr key={`${r.objectKey}:${r.country}`}>
          <td className="font-mono font-medium">
            {r.objectKey}:{r.country}
          </td>
          <td>
            <UnitStatus status={r.status} />
          </td>
          {variant === "delta" ? (
            <>
              <Num value={r.extracted} />
              <Num value={r.unchanged} />
              <Num value={r.created} />
              <Num value={r.updated} />
              <Num value={r.deleted} />
              <Num value={r.deletedApplied} />
              <Num value={r.deletedIgnored} />
              <Num value={r.failed} />
            </>
          ) : variant === "verify" ? (
            <>
              <Num value={r.sfdcScopeCount} />
              <Num value={r.extracted} />
              <Num value={r.vaultCount} />
              <Num value={r.pendingFk} />
              <Num value={r.failed} />
            </>
          ) : (
            <>
              <Num value={r.extracted} />
              <Num value={r.transformed} />
              <Num value={r.created} />
              <Num value={r.updated} />
              <Num value={r.unchanged} />
              <Num value={r.skipped} />
              <Num value={r.pendingFk} />
              <Num value={r.failed} />
              <Num value={r.vaultCount} />
            </>
          )}
        </tr>
      ))}
    </DataTable>
  );
}

// ---------------------------------------------------------------------------
// Watermarks, failures
// ---------------------------------------------------------------------------

export function WatermarkTable({ watermarks }: { watermarks: Watermark[] }) {
  return (
    <DataTable
      capHeight
      isEmpty={watermarks.length === 0}
      empty="No watermarks yet — they are set when a unit completes."
      head={
        <>
          <th>object</th>
          <th>country</th>
          <th>kind</th>
          <th>watermark</th>
          <th>run</th>
        </>
      }
    >
      {watermarks.map((w, i) => (
        <tr key={`${w.objectKey}-${w.country}-${w.kind}-${i}`}>
          <td className="font-mono">{w.objectKey}</td>
          <td className="font-mono text-muted-foreground">{w.country}</td>
          <td className="font-mono text-muted-foreground">{w.kind}</td>
          <td className="font-mono">{w.value ?? "—"}</td>
          <td className="font-mono text-muted-foreground truncate max-w-[16rem]">
            {w.runId ?? "—"}
          </td>
        </tr>
      ))}
    </DataTable>
  );
}

export function FailedRowsTable({ rows }: { rows: RowResult[] }) {
  return (
    <DataTable
      capHeight
      isEmpty={rows.length === 0}
      empty="No failed rows."
      head={
        <>
          <th>unit</th>
          <th>salesforce id</th>
          <th>error type</th>
          <th>message</th>
          <th className="text-right">attempt</th>
        </>
      }
    >
      {rows.map((r, i) => (
        <tr key={`${r.sfdcId}-${i}`}>
          <td className="font-mono">
            {r.objectKey}:{r.country}
          </td>
          <td className="font-mono">{r.sfdcId}</td>
          <td className="font-mono">
            <Badge variant="outline" className="font-mono text-[10px]">
              {r.errorType ?? "unknown"}
            </Badge>
          </td>
          <td className="max-w-[32rem] truncate" title={r.errorMessage ?? ""}>
            {r.errorMessage ?? "—"}
          </td>
          <Num value={r.attempt} />
        </tr>
      ))}
    </DataTable>
  );
}
