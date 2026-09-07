/**
 * The only I/O in `vault/` besides the client: writes the human-facing plan
 * files. `plan.json` itself is written by `index.ts`.
 *
 *   vault-plan/<country>/<category>.mdl   MDL steps of the group, in plan order
 *   vault-plan/manual-checklist.md         manual steps grouped by country → category, plus unmapped
 *   vault-plan/unmapped.md                 components with no Vault CRM equivalent
 *   vault-plan/steps.md                    one row per step
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { PlanStep, VaultPlan } from "../model/types";
import { stepGroup } from "./plan";

function cell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function groupSteps(steps: readonly PlanStep[]): Map<string, PlanStep[]> {
  const groups = new Map<string, PlanStep[]>();
  for (const s of steps) {
    const key = stepGroup(s);
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  return new Map([...groups.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

/** MDL of one country/category group, each step preceded by a comment header. */
export function renderMdlGroup(steps: readonly PlanStep[]): string {
  const chunks: string[] = [];
  for (const s of steps) {
    if (s.kind !== "mdl" || !s.mdl) continue;
    const header = [
      `-- step: ${s.id}`,
      `-- ${s.title}`,
      `-- source: ${s.source} → ${s.target}`,
      ...(s.dependsOn.length
        ? [`-- depends on: ${s.dependsOn.join(", ")}`]
        : []),
      ...(s.review
        ? ["-- REVIEW: generated from an unverified grammar/mapping"]
        : []),
      ...(s.notes ? s.notes.split("\n").map((n) => `-- note: ${n}`) : []),
    ];
    chunks.push(`${header.join("\n")}\n${s.mdl.trim()}\n`);
  }
  return chunks.join("\n");
}

export function renderManualChecklist(plan: VaultPlan): string {
  const lines = [
    "# Vault CRM manual checklist",
    "",
    `Plan created ${plan.createdAt} (API ${plan.apiVersion}${plan.vaultDns ? `, ${plan.vaultDns}` : ""}).`,
    "Steps that cannot be automated, grouped by country and rep category. Tick each item once done in the target vault.",
    "",
  ];
  const manual = plan.steps.filter((s) => s.kind === "manual");
  const review = plan.steps.filter((s) => s.kind !== "manual" && s.review);
  if (!manual.length) lines.push("_No manual steps._", "");
  for (const [group, steps] of groupSteps(manual)) {
    const [country = "", category = ""] = group.split("/");
    lines.push(`## ${country} — ${category}`, "");
    for (const s of steps) {
      lines.push(`- [ ] **${s.id}** — ${s.title}`);
      lines.push(`  - source: \`${s.source}\` → target: \`${s.target}\``);
      if (s.dependsOn.length)
        lines.push(
          `  - after: ${s.dependsOn.map((d) => `\`${d}\``).join(", ")}`,
        );
      for (const l of (s.manual ?? "").split("\n").filter(Boolean))
        lines.push(`  - ${l}`);
      if (s.notes)
        for (const n of s.notes.split("\n")) lines.push(`  - note: ${n}`);
    }
    lines.push("");
  }
  if (review.length) {
    lines.push("## Steps flagged for review", "");
    lines.push(
      "Generated from an unverified MDL grammar or an assumed mapping. Apply one to a sandbox, retrieve it with `GET /api/mdl/components/{type}.{name}`, diff, and adjust before running the rest.",
      "",
    );
    for (const s of review)
      lines.push(`- [ ] **${s.id}** (${s.kind}) — ${s.title}`);
    lines.push("");
  }
  if (plan.unmapped.length) {
    lines.push("## No Vault CRM equivalent", "");
    for (const u of plan.unmapped)
      lines.push(`- [ ] \`${u.source}\` — ${u.reason}`);
    lines.push("");
  }
  return lines.join("\n");
}

export function renderUnmapped(plan: VaultPlan): string {
  const lines = [
    "# Components with no Vault CRM equivalent",
    "",
    `${plan.unmapped.length} component${plan.unmapped.length === 1 ? "" : "s"} from the Salesforce org cannot be translated automatically. Each needs a decision: rebuild as Vault configuration, replace, or drop.`,
    "",
    "| Source | Reason |",
    "| --- | --- |",
  ];
  for (const u of plan.unmapped)
    lines.push(`| \`${cell(u.source)}\` | ${cell(u.reason)} |`);
  return lines.join("\n") + "\n";
}

export function renderPlanSummary(plan: VaultPlan): string {
  const counts = { mdl: 0, api: 0, manual: 0, review: 0 };
  for (const s of plan.steps) {
    counts[s.kind]++;
    if (s.review) counts.review++;
  }
  const lines = [
    "# Vault CRM plan steps",
    "",
    `Created ${plan.createdAt}; API ${plan.apiVersion}${plan.vaultDns ? `; vault ${plan.vaultDns}` : ""}.`,
    "",
    `- ${plan.steps.length} steps: ${counts.mdl} MDL, ${counts.api} API, ${counts.manual} manual; ${counts.review} flagged for review`,
    `- ${plan.unmapped.length} unmapped components (see unmapped.md)`,
    "",
    "## Steps per country / category",
    "",
    "| Group | MDL | API | Manual | File |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const [group, steps] of groupSteps(plan.steps)) {
    const n = (k: PlanStep["kind"]) => steps.filter((s) => s.kind === k).length;
    lines.push(
      `| ${group} | ${n("mdl")} | ${n("api")} | ${n("manual")} | ${n("mdl") ? `\`${group}.mdl\`` : ""} |`,
    );
  }
  lines.push(
    "",
    "## All steps (plan order)",
    "",
    "| # | Id | Kind | Country | Category | Title | Source | Target | Review | Depends on |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  );
  plan.steps.forEach((s, i) => {
    lines.push(
      `| ${i + 1} | \`${cell(s.id)}\` | ${s.kind} | ${s.country} | ${s.category} | ${cell(s.title)} | \`${cell(s.source)}\` | \`${cell(s.target)}\` | ${s.review ? "yes" : ""} | ${s.dependsOn.map((d) => `\`${cell(d)}\``).join(", ")} |`,
    );
  });
  return lines.join("\n") + "\n";
}

/**
 * Writes the MDL files, checklist, unmapped list and summary below `dir`
 * (created as needed). Returns the absolute paths written, sorted.
 */
export async function writePlan(
  plan: VaultPlan,
  dir: string,
): Promise<string[]> {
  const root = path.resolve(dir);
  const written: string[] = [];
  const put = async (relative: string, content: string): Promise<void> => {
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content, "utf8");
    written.push(file);
  };
  for (const [group, steps] of groupSteps(plan.steps)) {
    const mdl = renderMdlGroup(steps);
    if (!mdl) continue;
    const [country = "GLOBAL", category = "all"] = group.split("/");
    await put(path.join(country, `${category}.mdl`), mdl);
  }
  await put("manual-checklist.md", renderManualChecklist(plan));
  await put("unmapped.md", renderUnmapped(plan));
  await put("steps.md", renderPlanSummary(plan));
  return written.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
