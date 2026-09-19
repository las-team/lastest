"use client";

/**
 * Stage 2 — Plan.
 *
 * Two things, on one screen, because they are the same question asked at two
 * zoom levels: WHICH units will run and in what order, and WHAT each unit will
 * do to each field. Both are computed offline from the config — no credentials,
 * no API call — which is exactly why this stage sits before Preflight: you can
 * inspect the whole migration before anyone hands over a Vault password.
 */

import { useState } from "react";
import { Waves, Plus, Trash2, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@lastest/ui";
import { Badge } from "@lastest/ui";
import { Input } from "@lastest/ui";
import { Label } from "@lastest/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@lastest/ui";
import { LoadOrderTable, MappingTable, SeverityPill } from "./migration-tables";
import { createWave, deleteWave } from "../actions";
import type { PlanFailure, PlanResult } from "../plan";
import type { MigrationWave } from "../schema";

export function PlanPanel({
  projectId,
  waves,
  activeWaveId,
  plan,
}: {
  projectId: string;
  waves: MigrationWave[];
  activeWaveId: string | null;
  plan: PlanResult | PlanFailure | null;
}) {
  const [selectedUnit, setSelectedUnit] = useState<string | null>(null);

  const mapping =
    plan?.ok && selectedUnit
      ? (plan.mappings.find((m) => m.unitId === selectedUnit) ?? null)
      : plan?.ok
        ? (plan.mappings[0] ?? null)
        : null;

  return (
    <div className="space-y-6">
      <WaveEditor
        projectId={projectId}
        waves={waves}
        activeWaveId={activeWaveId}
      />

      {!plan ? (
        <p className="text-sm text-muted-foreground">
          Add a wave with at least one country to build the plan.
        </p>
      ) : !plan.ok ? (
        <div className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-destructive" />
          <div className="min-w-0 space-y-1">
            <p className="font-medium">The configuration is not valid yet.</p>
            <pre className="whitespace-pre-wrap font-mono text-xs text-muted-foreground">
              {plan.error}
            </pre>
          </div>
        </div>
      ) : (
        <>
          <section className="space-y-2">
            <div className="flex items-baseline justify-between gap-4">
              <h3 className="text-sm font-medium">
                Load order
                <span className="ml-2 font-normal text-muted-foreground">
                  FK-topological · cycles broken in a second pass
                </span>
              </h3>
              <p className="text-xs text-muted-foreground font-mono">
                {plan.units.length} unit{plan.units.length === 1 ? "" : "s"} ·{" "}
                {plan.steps.length} step{plan.steps.length === 1 ? "" : "s"} ·
                mapping {plan.planMappingHash.slice(0, 12)}
              </p>
            </div>
            <LoadOrderTable units={plan.units} />
          </section>

          <section className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-sm font-medium">Materialised mapping</h3>
              <Select
                value={mapping?.unitId ?? ""}
                onValueChange={setSelectedUnit}
              >
                <SelectTrigger className="w-[260px]">
                  <SelectValue placeholder="Select a unit" />
                </SelectTrigger>
                <SelectContent>
                  {plan.mappings.map((m) => (
                    <SelectItem key={m.unitId} value={m.unitId}>
                      {m.unitId}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {mapping && (
              <>
                <p className="text-xs text-muted-foreground font-mono">
                  {mapping.sourceObject} → {mapping.targetObject} · legacy id{" "}
                  {mapping.legacyIdField ?? "—"} · mapping hash{" "}
                  {mapping.mappingHash.slice(0, 12)}
                </p>
                {mapping.findings.length > 0 && (
                  <ul className="space-y-1 text-xs">
                    {mapping.findings.map((f, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <SeverityPill severity={f.severity} />
                        <span className="font-mono font-medium">{f.code}</span>
                        <span className="text-muted-foreground">
                          {f.detail}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <MappingTable fields={mapping.fields} />
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}

/**
 * Waves — the scheduling unit over (object, country).
 *
 * Countries are typed as a comma-separated list rather than picked from a
 * dropdown of 249: a migration lead knows their ISO codes, the field validates
 * them on save, and a picker of every country on earth is slower for the five
 * they need.
 */
function WaveEditor({
  projectId,
  waves,
  activeWaveId,
}: {
  projectId: string;
  waves: MigrationWave[];
  activeWaveId: string | null;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [countries, setCountries] = useState("");

  const submit = async () => {
    setBusy("new");
    try {
      await createWave(projectId, {
        key,
        label: label || key,
        countries: countries.split(/[,\s]+/).filter(Boolean),
      });
      toast.success("Wave added");
      setKey("");
      setLabel("");
      setCountries("");
      setAdding(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add wave");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string) => {
    setBusy(id);
    try {
      await deleteWave(id);
      toast.success("Wave removed");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove wave");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Waves className="h-4 w-4 text-muted-foreground" />
          Waves
        </h3>
        {!adding && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Add wave
          </Button>
        )}
      </div>

      {waves.length === 0 && !adding && (
        <p className="text-xs text-muted-foreground">
          No waves yet. A wave is the set of countries that cut over together;
          global objects are included in every wave automatically.
        </p>
      )}

      <ul className="space-y-2">
        {waves.map((wave) => (
          <li
            key={wave.id}
            className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium flex items-center gap-2">
                {wave.label}
                <span className="font-mono text-xs text-muted-foreground">
                  {wave.key}
                </span>
                {wave.id === activeWaveId && (
                  <Badge variant="secondary" className="text-[10px]">
                    active
                  </Badge>
                )}
                <WaveStatusBadge status={wave.status} />
              </p>
              <p className="text-xs text-muted-foreground font-mono truncate">
                {wave.countries.join(" · ") || "no countries"}
                {wave.freezeAt &&
                  ` · frozen ${wave.freezeAt.toISOString?.() ?? wave.freezeAt}`}
              </p>
            </div>
            {wave.status !== "signed_off" && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => remove(wave.id)}
                disabled={busy === wave.id}
                aria-label={`Remove wave ${wave.label}`}
              >
                {busy === wave.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
              </Button>
            )}
          </li>
        ))}
      </ul>

      {adding && (
        <div className="rounded-md border p-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="wave-key" className="text-xs">
                Key
              </Label>
              <Input
                id="wave-key"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="eu1"
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wave-label" className="text-xs">
                Label
              </Label>
              <Input
                id="wave-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="EU wave 1"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wave-countries" className="text-xs">
                Countries
              </Label>
              <Input
                id="wave-countries"
                value={countries}
                onChange={(e) => setCountries(e.target.value)}
                placeholder="DE, FR, IT"
                className="font-mono"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={submit}
              disabled={busy === "new" || !key.trim() || !countries.trim()}
            >
              {busy === "new" && (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              )}
              Add wave
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

export function WaveStatusBadge({
  status,
}: {
  status: MigrationWave["status"];
}) {
  if (status === "signed_off")
    return (
      <Badge className="bg-emerald-600 hover:bg-emerald-600 text-[10px]">
        signed off
      </Badge>
    );
  if (status === "frozen")
    return (
      <Badge className="bg-amber-500 hover:bg-amber-500 text-[10px]">
        frozen
      </Badge>
    );
  if (status === "in_progress")
    return (
      <Badge variant="secondary" className="text-[10px]">
        in progress
      </Badge>
    );
  return (
    <Badge variant="outline" className="text-[10px]">
      planned
    </Badge>
  );
}
