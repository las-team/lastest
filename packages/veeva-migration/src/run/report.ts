/**
 * §8.5 run report: `{runDir}/report.md` + `report.json` — findings table,
 * per-unit reconciliation table, failed rows by error type, unmapped users /
 * picklist values with counts, ignored deletes, timings. `report --run <id>`
 * rebuilds it from the store.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { StateStore } from "../store/types";
import { unitId, type Finding, type ReconciliationRow, type RunRecord, type Unit } from "../types";
import type { RunSummary } from "./types";

export interface UnitTiming {
  unit: Unit;
  status: RunSummary["units"][number]["status"];
  reason?: string;
  elapsedMs?: number;
  extractMs?: number;
  transformMs?: number;
  loadMs?: number;
  batches?: number;
}

export interface RunReportInput {
  run: RunRecord;
  exitCode: number;
  units: UnitTiming[];
  findings: Finding[];
  reconciliation: ReconciliationRow[];
  /** Per unit: ignored deletes with reasons (for review). */
  ignoredDeletes?: Record<string, Record<string, number>>;
  /** Per unit: unresolved FK targets with sample ids. */
  pendingTargets?: Record<string, Record<string, string[]>>;
  sampleDiffs?: Record<string, number>;
  generatedAt: string;
}

export interface RunReport {
  markdown: string;
  json: Record<string, unknown>;
}

const SEV = { blocking: 0, warning: 1, info: 2 } as const;

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function table(headers: string[], rows: unknown[][]): string {
  if (!rows.length) return "_none_\n";
  const line = (cells: unknown[]) => `| ${cells.map(cell).join(" | ")} |`;
  return [line(headers), `| ${headers.map(() => "---").join(" | ")} |`, ...rows.map(line)].join("\n") + "\n";
}

function countsByCode(findings: readonly Finding[], code: string): Array<[string, number]> {
  const out = new Map<string, number>();
  for (const f of findings) {
    if (f.code !== code) continue;
    const key = typeof f.detail === "string" ? f.detail : (f.detail as { value?: string; user?: string; sfdcId?: string }).value ?? (f.detail as { user?: string }).user ?? (f.detail as { sfdcId?: string }).sfdcId ?? cell(f.detail);
    out.set(key, (out.get(key) ?? 0) + (f.count ?? 1));
  }
  return [...out].sort((a, b) => b[1] - a[1]);
}

export function renderReport(input: RunReportInput): RunReport {
  const { run } = input;
  const findings = [...input.findings].sort((a, b) => SEV[a.severity] - SEV[b.severity] || a.code.localeCompare(b.code));
  const summary = {
    blocking: findings.filter((f) => f.severity === "blocking").length,
    warning: findings.filter((f) => f.severity === "warning").length,
    info: findings.filter((f) => f.severity === "info").length,
  };
  const md: string[] = [];
  md.push(`# Migration run ${run.runId}`, "");
  md.push(`- mode: **${run.mode}**${run.dryRun ? " (dry-run)" : ""}${run.wave ? ` · wave: ${run.wave}` : ""} · countries: ${run.countries.join(", ") || "—"}`);
  md.push(`- status: **${run.status}** · exit code: ${input.exitCode} · started ${run.startedAt}${run.finishedAt ? ` · finished ${run.finishedAt}` : ""}`);
  md.push(`- tool ${run.toolVersion} · config ${run.configHash.slice(0, 12)} · mapping ${run.mappingHash?.slice(0, 12) ?? "—"}`);
  md.push(`- source org ${run.sourceOrgId ?? "—"} (API ${run.sourceApiVersion ?? "—"}) · target ${run.targetVaultDns ?? "—"} (API ${run.targetApiVersion ?? "—"}) · sfdc_now ${run.sfdcNowAtStart ?? "—"}${run.freezeAt ? ` · freeze_at ${run.freezeAt}` : ""}`);
  md.push("", `## Findings (${summary.blocking} blocking, ${summary.warning} warning, ${summary.info} info)`, "");
  md.push(table(["severity", "code", "object", "country", "field", "count", "detail"], findings.map((f) => [f.severity, f.code, f.objectKey, f.country, f.field, f.count, f.detail])));
  md.push("## Units", "");
  md.push(table(["unit", "status", "reason", "elapsed ms", "extract ms", "transform ms", "load ms", "batches"], input.units.map((u) => [unitId(u.unit), u.status, u.reason, u.elapsedMs, u.extractMs, u.transformMs, u.loadMs, u.batches])));
  md.push("## Reconciliation", "");
  md.push(
    table(
      ["unit", "status", "sfdc scope", "extracted", "closure", "transformed", "skipped", "pending_fk", "created", "updated", "unchanged", "failed", "deleted (applied/ignored/pending)", "vault count", "agg src", "agg tgt"],
      input.reconciliation.map((r) => [
        `${r.objectKey}:${r.country}`, r.status, r.sfdcScopeCount, r.extracted, r.closure, r.transformed, r.skipped, r.pendingFk, r.created, r.updated, r.unchanged, r.failed,
        `${r.deleted} (${r.deletedApplied ?? 0}/${r.deletedIgnored ?? 0}/${r.deletedPending ?? 0})`, r.vaultCount, r.aggHashSrc, r.aggHashTgt,
      ]),
    ),
  );
  const failed = input.reconciliation.flatMap((r) => Object.entries(r.failedByType ?? {}).map(([t, n]) => [`${r.objectKey}:${r.country}`, t, n]));
  md.push("## Failed rows by error type", "", table(["unit", "error type", "rows"], failed));
  const skipped = input.reconciliation.flatMap((r) => Object.entries(r.skippedByReason ?? {}).map(([t, n]) => [`${r.objectKey}:${r.country}`, t, n]));
  md.push("## Skipped rows by reason", "", table(["unit", "reason", "rows"], skipped));
  const users = countsByCode(findings, "UNMAPPED_USER");
  md.push("## Unmapped users", "", table(["user", "referencing rows"], users));
  const picklists = [...countsByCode(findings, "VT_PICKLIST_VALUE_MISSING"), ...countsByCode(findings, "UNMAPPED_PICKLIST")];
  md.push("## Unmapped picklist values", "", table(["value", "rows"], picklists));
  if (input.pendingTargets && Object.keys(input.pendingTargets).length)
    md.push("## Unresolved references", "", table(["unit", "target object", "sample ids"], Object.entries(input.pendingTargets).flatMap(([u, t]) => Object.entries(t).map(([k, ids]) => [u, k, ids.join(", ")]))));
  if (input.ignoredDeletes && Object.keys(input.ignoredDeletes).length)
    md.push("## Deletes not applied (review)", "", table(["unit", "reason", "rows"], Object.entries(input.ignoredDeletes).flatMap(([u, r]) => Object.entries(r).map(([k, n]) => [u, k, n]))));
  if (input.sampleDiffs && Object.keys(input.sampleDiffs).length)
    md.push("## Sample read-back differences", "", table(["unit", "differences"], Object.entries(input.sampleDiffs)));
  md.push("", `_generated ${input.generatedAt}_`, "");
  const json = {
    runId: run.runId,
    mode: run.mode,
    dryRun: Boolean(run.dryRun),
    wave: run.wave ?? null,
    countries: run.countries,
    status: run.status,
    exitCode: input.exitCode,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt ?? null,
    toolVersion: run.toolVersion,
    configHash: run.configHash,
    mappingHash: run.mappingHash ?? null,
    source: { orgId: run.sourceOrgId ?? null, apiVersion: run.sourceApiVersion ?? null, now: run.sfdcNowAtStart ?? null },
    target: { vaultDns: run.targetVaultDns ?? null, vaultId: run.targetVaultId ?? null, apiVersion: run.targetApiVersion ?? null },
    freezeAt: run.freezeAt ?? null,
    summary,
    findings,
    units: input.units.map((u) => ({ ...u, unit: unitId(u.unit) })),
    reconciliation: input.reconciliation,
    unmappedUsers: Object.fromEntries(users),
    unmappedPicklists: Object.fromEntries(picklists),
    pendingTargets: input.pendingTargets ?? {},
    ignoredDeletes: input.ignoredDeletes ?? {},
    sampleDiffs: input.sampleDiffs ?? {},
    generatedAt: input.generatedAt,
  };
  return { markdown: md.join("\n"), json };
}

export async function writeReport(runDir: string, report: RunReport): Promise<{ markdown: string; json: string }> {
  await fs.mkdir(runDir, { recursive: true });
  const markdown = path.join(runDir, "report.md");
  const json = path.join(runDir, "report.json");
  await fs.writeFile(markdown, report.markdown, "utf8");
  await fs.writeFile(json, JSON.stringify(report.json, null, 2), "utf8");
  return { markdown, json };
}

/** Rebuild a report from the store (`report --run <id>`). */
export async function reportFromStore(store: StateStore, runId: string, now = new Date()): Promise<RunReportInput | undefined> {
  const run = await store.runs.get(runId);
  if (!run) return undefined;
  const findings = await store.findings.list(runId);
  const reconciliation = await store.reconciliation.list(runId);
  const units: UnitTiming[] = reconciliation.map((r) => ({ unit: { objectKey: r.objectKey, country: r.country }, status: r.status === "fail" ? "failed" : "succeeded" }));
  const exitCode = run.status === "blocked" ? 2 : run.status === "failed" ? 3 : 0;
  return { run, exitCode, units, findings, reconciliation, generatedAt: now.toISOString() };
}
