"use client";

import { useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, Grid3x3 } from "lucide-react";
import { toast } from "sonner";
import {
  DEFAULT_MATRIX_POLICY,
  type MatrixPolicy,
  type TestVariable,
} from "@/lib/db/schema";
import type {
  CsvDataSource,
  GoogleSheetsDataSource,
} from "@lastest/plugin-data-sources";
import { expandMatrix, matrixVariables } from "@lastest/coverage-model";
import { saveTestMatrixPolicy } from "@/server/actions/tests";

export interface MatrixPolicyCardProps {
  testId: string;
  variables: TestVariable[];
  sheetSources: GoogleSheetsDataSource[];
  csvSources: CsvDataSource[];
  policy: MatrixPolicy | null;
  onSaved?: () => Promise<void> | void;
}

/**
 * Matrix execution controls, plus the expansion this test would actually
 * produce.
 *
 * The preview is the point. `maxRuns` and pairwise reduction both silently
 * change how much of the data a test covers, and a number the user cannot see
 * before saving is a number they will discover from a surprising build.
 */
export function MatrixPolicyCard({
  testId,
  variables,
  sheetSources,
  csvSources,
  policy,
  onSaved,
}: MatrixPolicyCardProps) {
  const effective = { ...DEFAULT_MATRIX_POLICY, ...(policy ?? {}) };
  const [selection, setSelection] = useState(effective.selection);
  const [strength, setStrength] = useState(String(effective.strength));
  const [visual, setVisual] = useState(effective.visual);
  const [maxRuns, setMaxRuns] = useState(String(effective.maxRuns));
  const [saving, setSaving] = useState(false);

  const matrixVars = useMemo(() => matrixVariables(variables), [variables]);

  const draft: MatrixPolicy = useMemo(
    () => ({
      selection,
      strength: Math.max(2, parseInt(strength, 10) || 2),
      visual,
      maxRuns: Math.max(1, parseInt(maxRuns, 10) || 1),
    }),
    [selection, strength, visual, maxRuns],
  );

  // Recomputed against the draft, so the preview answers "what would happen if
  // I save this" rather than "what happened last time".
  const expansion = useMemo(
    () =>
      expandMatrix({
        variables,
        gsheetSources: sheetSources,
        csvSources,
        policy: draft,
      }),
    [variables, sheetSources, csvSources, draft],
  );

  const dirty =
    draft.selection !== effective.selection ||
    draft.strength !== effective.strength ||
    draft.visual !== effective.visual ||
    draft.maxRuns !== effective.maxRuns;

  const save = async () => {
    setSaving(true);
    try {
      await saveTestMatrixPolicy(testId, draft);
      toast.success("Matrix policy saved");
      await onSaved?.();
    } catch (err) {
      toast.error(
        `Save failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setSaving(false);
    }
  };

  if (matrixVars.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Grid3x3 className="h-4 w-4" /> Matrix execution
          </CardTitle>
          <CardDescription>
            No matrix variables yet. Set a CSV or Sheet variable&apos;s row
            strategy to <strong>Matrix</strong> to run this test once per data
            row inside a single build, then tune the fan-out here.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const visualRuns = expansion.runs.filter((r) => r.capturesVisual).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Grid3x3 className="h-4 w-4" /> Matrix execution
        </CardTitle>
        <CardDescription>
          {matrixVars.length === 1
            ? "1 matrix variable"
            : `${matrixVars.length} matrix variables`}{" "}
          ({matrixVars.map((v) => v.name).join(", ")}) fan this test out into
          one run per selected data row, all within a single build.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Row selection</Label>
            <Select
              value={selection}
              onValueChange={(v) =>
                setSelection(v as MatrixPolicy["selection"])
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pairwise">
                  Pairwise (t-way covering set)
                </SelectItem>
                <SelectItem value="all">Every selected row</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Pairwise keeps every pair of values represented for a fraction of
              the runs.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="matrix-strength">Strength (t)</Label>
            <Input
              id="matrix-strength"
              type="number"
              min={2}
              value={strength}
              disabled={selection !== "pairwise"}
              onChange={(e) => setStrength(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              2 = every pair. Raise only for a high-risk slice — cost climbs
              fast.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Visual layer</Label>
            <Select
              value={visual}
              onValueChange={(v) => setVisual(v as MatrixPolicy["visual"])}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="representative">
                  Representative run only
                </SelectItem>
                <SelectItem value="all">Every run</SelectItem>
                <SelectItem value="none">Disabled for matrix runs</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              &quot;Every run&quot; multiplies PNG baselines and review load by
              the number of runs.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="matrix-max-runs">Max runs</Label>
            <Input
              id="matrix-max-runs"
              type="number"
              min={1}
              value={maxRuns}
              onChange={(e) => setMaxRuns(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Ceiling per build, so a data source that grows can&apos;t turn one
              test into thousands of runs.
            </p>
          </div>
        </div>

        <div className="rounded-md border p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">
              {expansion.candidateCount} row combination
              {expansion.candidateCount === 1 ? "" : "s"}
            </Badge>
            <span className="text-muted-foreground text-xs">→</span>
            <Badge>
              {expansion.runs.length} run
              {expansion.runs.length === 1 ? "" : "s"}
            </Badge>
            <Badge variant="outline">
              {visualRuns} with visual baseline
              {expansion.truncated ? " · truncated" : ""}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {expansion.explanation}
          </p>
          {expansion.errors.length > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-400 flex items-start gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>{expansion.errors.join("; ")}</span>
            </p>
          )}
          {expansion.runs.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground text-left">
                    <th className="py-1 pr-3 font-normal">#</th>
                    <th className="py-1 pr-3 font-normal">Data cell</th>
                    <th className="py-1 pr-3 font-normal">Visual</th>
                  </tr>
                </thead>
                <tbody>
                  {expansion.runs.slice(0, 10).map((run) => (
                    <tr key={run.coordsKey + run.index} className="border-t">
                      <td className="py-1 pr-3 text-muted-foreground">
                        {run.index + 1}
                      </td>
                      <td className="py-1 pr-3 font-mono">{run.coordsKey}</td>
                      <td className="py-1 pr-3">
                        {run.capturesVisual ? "yes" : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {expansion.runs.length > 10 && (
                <p className="text-xs text-muted-foreground pt-1">
                  + {expansion.runs.length - 10} more
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <Button size="sm" onClick={save} disabled={!dirty || saving}>
            {saving ? "Saving…" : "Save matrix policy"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
