/**
 * Preflight report (§5, §8.10): a markdown rendering and a JSON findings
 * table with the blocking summary, the "new since last run" diff, legacy-id
 * selections, probe results and any MDL snippets the customer must apply.
 * Exit code semantics: `2` when preflight blocks (any global blocking
 * finding, or — in `preflight` mode — any blocking finding at all).
 */
import {
  GLOBAL_COUNTRY,
  unitId,
  type Finding,
  type RunMode,
  type Unit,
} from "../types";
import type { PreflightResult } from "./types";
import { findingKey, isGlobalBlocking, newSinceLastRun } from "./findings";

export const PREFLIGHT_EXIT_BLOCKING = 2;

export interface FindingSummary {
  blocking: number;
  warning: number;
  info: number;
  byCode: Record<string, number>;
}

export function summariseFindings(
  findings: readonly Finding[],
): FindingSummary {
  const s: FindingSummary = { blocking: 0, warning: 0, info: 0, byCode: {} };
  for (const f of findings) {
    s[f.severity]++;
    s.byCode[f.code] = (s.byCode[f.code] ?? 0) + 1;
  }
  return s;
}

/** §8.10: `0` success, `2` blocking preflight findings. */
export function preflightExitCode(
  result: PreflightResult,
  mode: RunMode,
): 0 | 2 {
  if (result.blocking) return PREFLIGHT_EXIT_BLOCKING;
  if (
    mode === "preflight" &&
    result.findings.some((f) => f.severity === "blocking")
  )
    return PREFLIGHT_EXIT_BLOCKING;
  return 0;
}

export interface ReportOptions {
  mode?: RunMode;
  /** Findings of the previous run (`store.findings.previous(runId)`). */
  previous?: readonly Finding[];
  now?: Date;
}

export interface ReportJson {
  runId: string;
  mode?: RunMode;
  generatedAt: string;
  exitCode: 0 | 2;
  blocking: boolean;
  summary: FindingSummary;
  source: PreflightResult["source"];
  blockedUnits: string[];
  findings: Array<Finding & { new: boolean; key: string }>;
  newSinceLastRun: number;
  legacyIds: Array<{
    objectKey: string;
    targetObject: string;
    legacyIdField?: string;
    format: string;
  }>;
  mdl: Array<{ code: string; objectKey?: string; field?: string; mdl: string }>;
  probes: Array<Record<string, unknown>>;
  countries: Record<
    string,
    Array<{ iso2: string; sfdcId?: string; vaultId?: string; name?: string }>
  >;
}

export interface PreflightReport {
  markdown: string;
  json: ReportJson;
  exitCode: 0 | 2;
}

const SEVERITY_ORDER = { blocking: 0, warning: 1, info: 2 } as const;

function detailText(detail: Finding["detail"]): string {
  if (typeof detail === "string") return detail;
  const { mdl: _mdl, ...rest } = detail;
  return JSON.stringify(rest);
}

function cell(v: unknown): string {
  return String(v ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ");
}

function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const s = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (s) return s;
    const o = (a.objectKey ?? "").localeCompare(b.objectKey ?? "");
    if (o) return o;
    const c = (a.country ?? "").localeCompare(b.country ?? "");
    if (c) return c;
    return a.code.localeCompare(b.code);
  });
}

/** Build the markdown + JSON report for a preflight result. */
export function buildReport(
  result: PreflightResult,
  opts: ReportOptions = {},
): PreflightReport {
  const mode = opts.mode ?? "preflight";
  const now = opts.now ?? new Date();
  const exitCode = preflightExitCode(result, mode);
  const previous = opts.previous ?? [];
  const fresh = new Set(
    newSinceLastRun(result.findings, previous).map(findingKey),
  );
  const sorted = sortFindings(result.findings);
  const summary = summariseFindings(result.findings);

  const mdl: ReportJson["mdl"] = [];
  const probes: ReportJson["probes"] = [];
  for (const f of result.findings) {
    if (typeof f.detail === "object" && typeof f.detail.mdl === "string")
      mdl.push({
        code: f.code,
        objectKey: f.objectKey,
        field: f.field,
        mdl: f.detail.mdl,
      });
    if (f.code === "PROBE_RESULT" && typeof f.detail === "object")
      probes.push(f.detail);
  }
  const legacyIds = [...result.resolvedTargets.values()].map((t) => ({
    objectKey: t.objectKey,
    targetObject: t.targetObject,
    legacyIdField: t.legacyIdField,
    format: t.metadata.legacyIdFormat,
  }));
  const countries: ReportJson["countries"] = {};
  for (const [dns, list] of result.countries) countries[dns] = list;

  const json: ReportJson = {
    runId: result.runId,
    mode,
    generatedAt: now.toISOString(),
    exitCode,
    blocking: result.blocking,
    summary,
    source: result.source,
    blockedUnits: result.blockedUnits.map(unitId),
    findings: sorted.map((f) => ({
      ...f,
      key: findingKey(f),
      new: fresh.has(findingKey(f)),
    })),
    newSinceLastRun: fresh.size,
    legacyIds,
    mdl,
    probes,
    countries,
  };

  const lines: string[] = [];
  lines.push(`# Preflight report — run ${result.runId}`, "");
  lines.push(`- Mode: \`${mode}\` · generated ${json.generatedAt}`);
  lines.push(
    `- Source org: \`${result.source.orgId}\` (API ${result.source.apiVersion}, sfdc_now ${result.source.now})` +
      ` · multi-currency: ${result.source.multiCurrency} · person accounts: ${result.source.personAccounts} · Territory2: ${result.source.territory2}`,
  );
  lines.push(
    `- Result: **${exitCode === 0 ? "OK" : "BLOCKED"}** (exit code ${exitCode}) — ${summary.blocking} blocking, ${summary.warning} warning, ${summary.info} info` +
      (previous.length ? `; ${fresh.size} new since last run` : ""),
  );
  if (result.blocking) {
    lines.push("", "## Global blocking findings", "");
    for (const f of result.findings.filter(isGlobalBlocking))
      lines.push(`- \`${f.code}\` ${cell(detailText(f.detail))}`);
  }
  lines.push("", "## Blocked units", "");
  if (result.blockedUnits.length)
    for (const u of result.blockedUnits) lines.push(`- \`${unitId(u)}\``);
  else lines.push("_none_");

  lines.push("", "## Legacy-id fields (§3.2)", "");
  lines.push("| Object | Target | Field | Format |", "|---|---|---|---|");
  for (const l of legacyIds)
    lines.push(
      `| ${l.objectKey} | ${l.targetObject} | ${l.legacyIdField ?? "**MISSING**"} | \`${l.format}\` |`,
    );

  lines.push("", "## Findings", "");
  lines.push(
    "| Sev | Code | Object | Country | Field | Count | New | Detail |",
    "|---|---|---|---|---|---|---|---|",
  );
  for (const f of sorted)
    lines.push(
      `| ${f.severity} | \`${f.code}\` | ${cell(f.objectKey)} | ${cell(f.country)} | ${cell(f.field)} | ${cell(f.count)} | ${fresh.has(findingKey(f)) ? "yes" : ""} | ${cell(detailText(f.detail))} |`,
    );

  if (probes.length) {
    lines.push("", "## Probe results (§5.3)", "");
    for (const p of probes)
      lines.push(`- \`${cell(p.probe)}\`: ${cell(JSON.stringify(p))}`);
  }
  if (mdl.length) {
    lines.push("", "## MDL to apply (never executed without --allow-mdl)", "");
    for (const m of mdl) {
      lines.push(
        `### ${m.code}${m.objectKey ? ` — ${m.objectKey}` : ""}${m.field ? ` (${m.field})` : ""}`,
        "",
        "```",
        m.mdl,
        "```",
        "",
      );
    }
  }
  if (result.countries.size) {
    lines.push("", "## Country crosswalk (§3.4)", "");
    for (const [dns, list] of result.countries) {
      lines.push(
        `### ${dns}`,
        "",
        "| ISO | SFDC id | Vault id | Name |",
        "|---|---|---|---|",
      );
      for (const c of list)
        lines.push(
          `| ${c.iso2} | ${cell(c.sfdcId)} | ${cell(c.vaultId)} | ${cell(c.name)} |`,
        );
      lines.push("");
    }
  }
  return { markdown: lines.join("\n") + "\n", json, exitCode };
}

/** Units of a result grouped per country for the report (GLOBAL first). */
export function unitsByCountry(units: readonly Unit[]): Map<string, Unit[]> {
  const out = new Map<string, Unit[]>();
  for (const u of [...units].sort((a, b) =>
    a.country === GLOBAL_COUNTRY
      ? -1
      : b.country === GLOBAL_COUNTRY
        ? 1
        : a.country.localeCompare(b.country),
  ))
    out.set(u.country, [...(out.get(u.country) ?? []), u]);
  return out;
}
