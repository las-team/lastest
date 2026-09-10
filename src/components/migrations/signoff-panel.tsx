"use client";

/**
 * Stage 9 — Sign-off.
 *
 * The end of a wave is a record, not a state change: what a regulated
 * programme hands an auditor is the run report — config and mapping hashes,
 * per-unit timings, findings, reconciliation, and the ids of anything that
 * failed. This panel is that record plus the one irreversible button in the
 * console.
 *
 * After sign-off the wave's countries are marked frozen in the engine's store
 * and later runs skip them, which is why the confirmation says so rather than
 * asking "are you sure?".
 */

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, FileText, Loader2, Snowflake } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { StatRow } from "./panel-shell";
import { timeAgo } from "@/lib/utils";
import type { MigrationRun, MigrationWave } from "@/lib/db/schema";

export function SignoffPanel({
  wave,
  runs,
  focusedRun,
  frozenCountries,
  pending,
  onSignOff,
  report,
}: {
  wave: MigrationWave | null;
  runs: MigrationRun[];
  focusedRun: MigrationRun | null;
  frozenCountries: Array<{ country: string; frozenAt: string }>;
  pending: boolean;
  onSignOff: (note: string) => void;
  report: React.ReactNode;
}) {
  const [note, setNote] = useState("");
  const signedOff = wave?.status === "signed_off";

  // The wave's own run history — what the sign-off is a statement about.
  const waveRuns = runs.filter((r) => r.waveId === wave?.id);
  const lastCutover = waveRuns.find((r) => r.mode === "final-delta");
  const lastVerify = waveRuns.find((r) => r.mode === "verify");

  return (
    <div className="space-y-5">
      {signedOff && (
        <div className="flex items-start gap-3 rounded-md border border-emerald-500/40 bg-emerald-500/5 px-3 py-2.5">
          <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-emerald-600" />
          <div className="text-sm">
            <p className="font-medium">
              {wave?.label} signed off
              {wave?.signedOffAt && ` · ${timeAgo(wave.signedOffAt)}`}
            </p>
            {wave?.signOffNote && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {wave.signOffNote}
              </p>
            )}
          </div>
        </div>
      )}

      <StatRow
        stats={[
          { label: "Runs in this wave", value: waveRuns.length, tone: "muted" },
          {
            label: "Cutover gate",
            value: lastCutover?.summary?.gate ?? "—",
            tone: lastCutover?.summary?.gate === "pass" ? "good" : undefined,
          },
          {
            label: "Verify",
            value: lastVerify?.status ?? "—",
            tone: lastVerify?.status === "succeeded" ? "good" : undefined,
          },
          {
            label: "Failed rows",
            value: focusedRun?.summary?.rows?.failed ?? 0,
            tone: "bad",
          },
        ]}
      />

      <section className="space-y-2">
        <h3 className="flex items-center gap-1.5 text-sm font-medium">
          <FileText className="h-4 w-4 text-muted-foreground" />
          Run report
        </h3>
        {report}
        {focusedRun?.engineRunId && (
          <p className="text-xs text-muted-foreground font-mono">
            run id {focusedRun.engineRunId}
          </p>
        )}
      </section>

      {frozenCountries.length > 0 && (
        <section className="space-y-2">
          <h3 className="flex items-center gap-1.5 text-sm font-medium">
            <Snowflake className="h-4 w-4 text-muted-foreground" />
            Frozen countries
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {frozenCountries.map((c) => (
              <Badge key={c.country} variant="outline" className="font-mono">
                {c.country}
              </Badge>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Later runs skip these countries — their watermarks are frozen unless
            a run is started with <span className="font-mono">--unfreeze</span>.
          </p>
        </section>
      )}

      {!signedOff && (
        <section className="space-y-3 rounded-lg border p-4">
          <div className="space-y-1.5">
            <Label htmlFor="signoff-note">Sign-off note</Label>
            <Textarea
              id="signoff-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Gate passed at tolerance zero. Documented exclusions: 3 merged accounts, 1 ignored delete on call2."
            />
            <p className="text-xs text-muted-foreground">
              Signing off marks this wave&rsquo;s countries frozen. Migrated
              rows stay identifiable by their legacy id, so a wave can still be
              backed out and re-run.
            </p>
          </div>
          <div className="flex justify-end">
            <Button onClick={() => onSignOff(note)} disabled={pending || !wave}>
              {pending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Sign off {wave?.label ?? "wave"}
            </Button>
          </div>
        </section>
      )}

      {waveRuns.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium">Every run in this wave</h3>
          <ul className="divide-y rounded-md border">
            {waveRuns.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/migrations/${r.projectId}/runs/${r.id}`}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-xs hover:bg-muted transition-colors"
                >
                  <span className="font-mono font-medium">
                    {r.mode}
                    {r.dryRun && (
                      <span className="ml-1.5 text-muted-foreground">
                        dry run
                      </span>
                    )}
                  </span>
                  <span className="font-mono text-muted-foreground truncate">
                    {r.engineRunId ?? "—"}
                  </span>
                  <span className="text-muted-foreground shrink-0">
                    {r.startedAt ? timeAgo(r.startedAt) : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
