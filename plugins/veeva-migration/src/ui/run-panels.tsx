"use client";

/**
 * Stages 3-6 and 8 — the ones that run an engine mode and show what it did.
 *
 * They differ only in which columns the unit table gets and which extra block
 * sits beside it, so they share one body and vary by `variant`. Resisting a
 * bespoke panel per stage is deliberate: the numbers mean the same thing in
 * every mode, and an operator reading `failed` on a delta should not have to
 * re-learn where it lives.
 */

import { useState } from "react";
import { ExternalLink, Snowflake, Search } from "lucide-react";
import { Button } from "@lastest/ui";
import { Input } from "@lastest/ui";
import { Label } from "@lastest/ui";
import { Textarea } from "@lastest/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@lastest/ui";
import {
  FailedRowsTable,
  FindingsTable,
  UnitTable,
  WatermarkTable,
  type FindingRow,
  type UnitTableVariant,
} from "./migration-tables";
import { LastRunLine, StatRow, runProduced } from "./panel-shell";
import type { MigrationRun } from "../schema";
import type {
  ReconciliationRow,
  RowResult,
  StoredFinding,
  Watermark,
} from "@lastest/veeva-migration";

export interface RunPanelData {
  run: MigrationRun | null;
  reconciliation: ReconciliationRow[];
  findings: StoredFinding[];
  previousFindings: StoredFinding[];
  failedRows: RowResult[];
  watermarks: Watermark[];
}

/** Totals across a run's units — the strip above the table. */
function totals(rows: ReconciliationRow[]) {
  const sum = (pick: (r: ReconciliationRow) => number | null | undefined) =>
    rows.reduce((n, r) => n + (pick(r) ?? 0), 0);
  return {
    extracted: sum((r) => r.extracted),
    created: sum((r) => r.created),
    updated: sum((r) => r.updated),
    unchanged: sum((r) => r.unchanged),
    skipped: sum((r) => r.skipped),
    failed: sum((r) => r.failed),
    pendingFk: sum((r) => r.pendingFk),
    deleted: sum((r) => r.deleted),
    vault: sum((r) => r.vaultCount),
  };
}

export function PreflightPanel({
  data,
  acks,
  onAccept,
  onRevoke,
}: {
  data: RunPanelData;
  acks: Array<{
    id: string;
    code: string;
    objectKey: string;
    country: string;
    justification: string;
  }>;
  onAccept: (input: {
    code: string;
    objectKey?: string;
    country?: string;
    justification: string;
  }) => Promise<void>;
  onRevoke: (ackId: string) => Promise<void>;
}) {
  const [pendingFinding, setPendingFinding] = useState<FindingRow | null>(null);
  const [justification, setJustification] = useState("");
  const [saving, setSaving] = useState(false);

  const previousCodes = new Set(
    data.previousFindings.map((f) => findingKey(f)),
  );
  const rows: FindingRow[] = data.findings.map((f) => ({
    ...f,
    isNew: !previousCodes.has(findingKey(f)),
    ack:
      acks.find(
        (a) =>
          a.code === f.code &&
          (a.objectKey === (f.objectKey ?? "") || a.objectKey === "") &&
          (a.country === (f.country ?? "") || a.country === ""),
      ) ?? null,
  }));

  const counts = {
    blocking: rows.filter((f) => f.severity === "blocking").length,
    warning: rows.filter((f) => f.severity === "warning").length,
    info: rows.filter((f) => f.severity === "info").length,
  };

  return (
    <div className="space-y-4">
      <LastRunLine run={data.run} />
      <StatRow
        stats={[
          { label: "Blocking", value: counts.blocking, tone: "bad" },
          { label: "Warning", value: counts.warning },
          { label: "Info", value: counts.info, tone: "muted" },
          {
            label: "Units resolved",
            value: data.reconciliation.length,
            tone: "muted",
          },
        ]}
      />
      {counts.blocking > 0 && (
        <p className="text-xs text-destructive">
          Blocking findings stop a run with exit code 2. Fix the mapping or the
          target metadata — accepting one records the decision but does not
          unblock the engine.
        </p>
      )}
      <FindingsTable
        findings={rows}
        empty={
          runProduced(data.run)
            ? "No findings — the plan matches live metadata on both sides."
            : data.run
              ? "This run did not reach the point of producing findings."
              : "Run preflight to check the plan against both orgs."
        }
        onAccept={(f) => {
          setPendingFinding(f);
          setJustification("");
        }}
        onRevoke={(id) => void onRevoke(id)}
      />

      <Dialog
        open={Boolean(pendingFinding)}
        onOpenChange={(v) => !saving && !v && setPendingFinding(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Accept finding</DialogTitle>
            <DialogDescription>
              Recorded against{" "}
              <span className="font-mono">{pendingFinding?.code}</span> and kept
              across future preflights, so a known-good warning is not
              re-triaged on every rehearsal.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="ack-reason">Reason</Label>
            <Textarea
              id="ack-reason"
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="Reviewed with the data steward — the field is intentionally unmapped for this programme."
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPendingFinding(null)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              disabled={!justification.trim() || saving}
              onClick={async () => {
                if (!pendingFinding) return;
                setSaving(true);
                try {
                  await onAccept({
                    code: pendingFinding.code,
                    objectKey: pendingFinding.objectKey?.toString(),
                    country: pendingFinding.country,
                    justification,
                  });
                  setPendingFinding(null);
                } finally {
                  setSaving(false);
                }
              }}
            >
              Accept
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function findingKey(f: StoredFinding): string {
  return `${f.code}|${f.objectKey ?? ""}|${f.country ?? ""}|${f.field ?? ""}`;
}

export function LoadPanel({
  data,
  variant,
  dryRun,
  onRetryFailed,
  retryPending,
}: {
  data: RunPanelData;
  variant: UnitTableVariant;
  dryRun?: boolean;
  onRetryFailed?: () => void;
  retryPending?: boolean;
}) {
  const t = totals(data.reconciliation);
  return (
    <div className="space-y-4">
      <LastRunLine run={data.run} />
      {dryRun && (
        <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
          Extract and transform ran for real; the load was simulated. Nothing
          was written to Vault and no watermark moved.
        </p>
      )}
      <StatRow
        stats={
          variant === "delta"
            ? [
                { label: "Extracted", value: t.extracted },
                { label: "Unchanged", value: t.unchanged, tone: "muted" },
                { label: "Created", value: t.created },
                { label: "Updated", value: t.updated },
                { label: "Failed", value: t.failed, tone: "bad" },
              ]
            : variant === "verify"
              ? [
                  { label: "Extracted", value: t.extracted },
                  { label: "In vault", value: t.vault },
                  { label: "Pending FK", value: t.pendingFk, tone: "bad" },
                  { label: "Failed", value: t.failed, tone: "bad" },
                ]
              : [
                  { label: "Extracted", value: t.extracted },
                  { label: "Created", value: t.created },
                  { label: "Updated", value: t.updated },
                  { label: "Skipped", value: t.skipped, tone: "muted" },
                  { label: "Failed", value: t.failed, tone: "bad" },
                ]
        }
      />
      <UnitTable
        rows={data.reconciliation}
        variant={variant}
        empty={
          runProduced(data.run)
            ? "No per-unit numbers yet — they are written as each unit finishes."
            : data.run
              ? "This run did not reach the point of loading anything."
              : "Nothing has run for this step yet."
        }
      />

      {data.failedRows.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium">
              Failed rows
              <span className="ml-2 font-normal text-muted-foreground">
                first {data.failedRows.length}; the run report has the full list
              </span>
            </h3>
            {onRetryFailed && (
              <Button
                size="sm"
                variant="outline"
                onClick={onRetryFailed}
                disabled={retryPending}
              >
                Retry failed rows
              </Button>
            )}
          </div>
          <FailedRowsTable rows={data.failedRows} />
        </section>
      )}

      {variant === "delta" && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium">
            Watermarks
            <span className="ml-2 font-normal text-muted-foreground">
              advance only when a unit fully succeeds — an interrupted run
              resumes its window
            </span>
          </h3>
          <WatermarkTable watermarks={data.watermarks} />
        </section>
      )}
    </div>
  );
}

/**
 * Stage 7 — Cutover.
 *
 * The freeze timestamp is a real-world event (profiles set read-only, feeds
 * paused), so recording it here is what starts cutover; there is no separate
 * "begin cutover" button that would mean something different from the freeze.
 */
export function CutoverPanel({
  data,
  freezeAt,
  freezeAtIso,
  onFreeze,
  freezePending,
  waveSignedOff,
}: {
  data: RunPanelData;
  /** `datetime-local` value (`YYYY-MM-DDTHH:mm`) for the input. */
  freezeAt: string | null;
  /** The stored instant, for the line that states what `wm_hi` will be. */
  freezeAtIso: string | null;
  onFreeze: (value: string | null) => void;
  freezePending: boolean;
  waveSignedOff: boolean;
}) {
  const [value, setValue] = useState(freezeAt ?? "");
  const t = totals(data.reconciliation);
  const gate = data.run?.summary?.gate;

  return (
    <div className="space-y-5">
      <div className="rounded-lg border p-4 space-y-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-muted">
            <Snowflake className="h-4 w-4 text-muted-foreground" />
          </span>
          <div>
            <p className="text-sm font-medium leading-tight">
              Salesforce freeze
            </p>
            <p className="text-[11px] text-muted-foreground">
              Read this timestamp from Salesforce after profiles go read-only
              and scheduled jobs and feeds are paused.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="freeze-at" className="text-xs">
              Freeze timestamp (UTC)
            </Label>
            <Input
              id="freeze-at"
              type="datetime-local"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              disabled={waveSignedOff}
              className="font-mono w-[260px]"
            />
          </div>
          <Button
            variant="outline"
            disabled={freezePending || waveSignedOff || !value}
            onClick={() => onFreeze(new Date(value).toISOString())}
          >
            Record freeze
          </Button>
          {freezeAt && !waveSignedOff && (
            <Button
              variant="ghost"
              disabled={freezePending}
              onClick={() => {
                setValue("");
                onFreeze(null);
              }}
            >
              Clear
            </Button>
          )}
        </div>
        {freezeAtIso && (
          <p className="text-xs text-muted-foreground font-mono">
            wm_hi = {freezeAtIso} for every unit of this wave
          </p>
        )}
      </div>

      <LastRunLine run={data.run} />

      {gate && (
        <div
          className={
            gate === "pass"
              ? "rounded-md border border-emerald-500/40 bg-emerald-500/5 px-3 py-2.5 text-sm"
              : gate === "fail"
                ? "rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm"
                : "rounded-md border px-3 py-2.5 text-sm"
          }
        >
          <p className="font-medium">
            Reconciliation gate:{" "}
            {gate === "pass"
              ? "passed"
              : gate === "fail"
                ? "failed"
                : "pending"}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Tolerance zero — every unit must reconcile, with no failed rows and
            no unresolved foreign keys. A failed gate means the wave is not
            signed off; rows in triage are loaded during hypercare with an audit
            note.
          </p>
        </div>
      )}

      <StatRow
        stats={[
          { label: "Extracted", value: t.extracted },
          { label: "Created", value: t.created },
          { label: "Updated", value: t.updated },
          { label: "Pending FK", value: t.pendingFk, tone: "bad" },
          { label: "Failed", value: t.failed, tone: "bad" },
        ]}
      />
      <UnitTable rows={data.reconciliation} variant="delta" />
    </div>
  );
}

/** A run's report links, shown on the Sign-off stage. */
export function ReportLinks({ run }: { run: MigrationRun | null }) {
  if (!run?.summary?.reportPath) {
    return (
      <p className="text-xs text-muted-foreground">
        The report is written at the end of every run, next to the run
        directory.
      </p>
    );
  }
  return (
    <p className="text-xs text-muted-foreground font-mono break-all inline-flex items-center gap-1.5">
      <ExternalLink className="h-3 w-3 shrink-0" />
      {run.summary.reportPath}
    </p>
  );
}

/** Crosswalk lookup — the console's version of `veeva-migration id-map`. */
export function CrosswalkLookup({
  objectKeys,
  onLookup,
}: {
  objectKeys: string[];
  onLookup: (objectKey: string, id: string) => Promise<string | null>;
}) {
  const [objectKey, setObjectKey] = useState(objectKeys[0] ?? "account");
  const [id, setId] = useState("");
  // `looked` is separate from `result` because a MISS is a null result and
  // still has to say something — rendering on `result !== null` alone made a
  // "not found" look identical to "you have not searched yet".
  const [result, setResult] = useState<string | null>(null);
  const [looked, setLooked] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-muted">
          <Search className="h-4 w-4 text-muted-foreground" />
        </span>
        <div>
          <p className="text-sm font-medium leading-tight">ID crosswalk</p>
          <p className="text-[11px] text-muted-foreground">
            Every migrated row is recorded here. Foreign keys are only ever
            resolved through it — never guessed.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Input
          value={objectKey}
          onChange={(e) => setObjectKey(e.target.value)}
          className="font-mono w-[180px]"
          aria-label="Object key"
          list="migration-object-keys"
        />
        <datalist id="migration-object-keys">
          {objectKeys.map((k) => (
            <option key={k} value={k} />
          ))}
        </datalist>
        <Input
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder="001000000000001AAA or V0U000000001001"
          className="font-mono flex-1 min-w-[240px]"
          aria-label="Salesforce or Vault id"
        />
        <Button
          variant="outline"
          disabled={!id.trim() || busy}
          onClick={async () => {
            setBusy(true);
            try {
              setResult(await onLookup(objectKey, id.trim()));
              setLooked(true);
            } finally {
              setBusy(false);
            }
          }}
        >
          Look up
        </Button>
      </div>
      {looked && (
        <p className="font-mono text-xs">
          {result ?? (
            <span className="text-muted-foreground">
              not in the crosswalk — this row has not been migrated
            </span>
          )}
        </p>
      )}
    </div>
  );
}
