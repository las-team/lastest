import type {
  ExplorerActionLog,
  ExplorerFindingEvidence,
  ExplorerFindingKind,
  ExplorerReportCluster,
  ExplorerScenario,
  ExplorerSeverity,
} from "../types";

/**
 * The markdown an explorer finding becomes when it is filed as an issue.
 *
 * A pure function, in `domain/` with the rest of the plugin's reasoning, for
 * the same reason core keeps `buildVerifyCaseBody` out of its server action:
 * the composition is the part worth testing, and it has no business touching
 * a database or a GitHub token to do its job.
 *
 * The shape deliberately mirrors core's verify body — header line, context
 * table, evidence in collapsed `<details>`, resource links, a footer marker —
 * so an assignee who has read one Lastest issue can read this one. What
 * differs is what an explorer finding actually knows: there is no baseline to
 * diff against and no build to link, but there *is* a scenario the agent
 * planned and an action log of what it did, which together are the
 * reproduction steps a human would otherwise have to reconstruct from a
 * one-line description.
 */

const SEVERITY_BADGE: Record<ExplorerSeverity, string> = {
  critical: "🔴 Critical",
  high: "🟠 High",
  medium: "🟡 Medium",
  low: "🔵 Low",
  info: "⚪ Info",
};

export interface FindingIssueFinding {
  id: string;
  title: string;
  description: string;
  severity: ExplorerSeverity;
  kind: ExplorerFindingKind;
  url: string | null;
  rootCauseCluster: string | null;
  pageStateHash: string | null;
  scenario: ExplorerScenario | null;
  evidence: ExplorerFindingEvidence | null;
  createdAt: Date | null;
}

export interface FindingIssueInput {
  finding: FindingIssueFinding;
  /** The run the finding came from. Null only if the row outlived its session. */
  session: {
    id: string;
    targetUrl: string | null;
    /** Execution log for this finding's scenario, when one was recorded. */
    actionLog: ExplorerActionLog | null;
  } | null;
  /** The analyst's root-cause cluster this finding landed in, if any. */
  cluster: ExplorerReportCluster | null;
  repoFullName: string | null;
  reporterEmail: string | null;
  /** Lastest's own base URL, for the back-link. */
  appBaseUrl: string;
  /** Free-text note the reviewer typed in the file-issue dialog. */
  note: string | null;
  /** Reviewer-edited title. Falls back to the finding's own. */
  titleOverride?: string | null;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Pipes and newlines break a markdown table row; nothing else here does. */
function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function trimBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function renderSteps(
  scenario: ExplorerScenario | null,
  log: ExplorerActionLog | null,
): string[] {
  const lines: string[] = [];
  const planned = scenario?.steps ?? [];
  const performed = log?.steps ?? [];
  if (planned.length === 0 && performed.length === 0) return lines;

  lines.push("### Steps to reproduce", "");
  if (planned.length > 0) {
    lines.push(...planned.map((step, i) => `${i + 1}. ${step}`), "");
  }
  if (scenario?.expectedOutcome) {
    lines.push(`**Expected:** ${scenario.expectedOutcome}`, "");
  }
  if (performed.length > 0) {
    lines.push(
      `<details><summary>What the explorer actually did (${performed.length} action${performed.length === 1 ? "" : "s"})</summary>`,
      "",
      "| # | Intent | Action | Target | Result |",
      "|---|--------|--------|--------|--------|",
      ...performed.map((step, i) => {
        const target = [step.selector, step.value ? `= ${step.value}` : null]
          .filter(Boolean)
          .join(" ");
        const result =
          step.result === "ok"
            ? "ok"
            : `**${step.result}**${step.note ? ` — ${step.note}` : ""}`;
        return `| ${i + 1} | ${cell(truncate(step.intent, 80))} | \`${cell(step.action)}\` | ${target ? `\`${cell(truncate(target, 80))}\`` : "—"} | ${cell(result)} |`;
      }),
      "",
      "</details>",
      "",
    );
  }
  return lines;
}

function renderConsole(errors: string[] | undefined): string[] {
  if (!errors || errors.length === 0) return [];
  return [
    `<details><summary>Console errors (${errors.length})</summary>`,
    "",
    "```",
    ...errors.slice(0, 25).map((e) => truncate(e, 500)),
    ...(errors.length > 25 ? [`… ${errors.length - 25} more`] : []),
    "```",
    "",
    "</details>",
    "",
  ];
}

function renderRequests(
  requests: Array<{ url: string; status: number; method: string }> | undefined,
): string[] {
  if (!requests || requests.length === 0) return [];
  return [
    `<details><summary>Failed requests (${requests.length})</summary>`,
    "",
    "| Method | URL | Status |",
    "|--------|-----|--------|",
    ...requests
      .slice(0, 25)
      .map(
        (r) =>
          `| ${cell(r.method)} | ${cell(truncate(r.url, 200))} | ${r.status} |`,
      ),
    "",
    ...(requests.length > 25 ? [`… ${requests.length - 25} more`, ""] : []),
    "</details>",
    "",
  ];
}

export function buildFindingIssueBody(input: FindingIssueInput): {
  title: string;
  body: string;
  labels: string[];
} {
  const { finding, session, cluster, repoFullName, reporterEmail, note } =
    input;
  const base = trimBase(input.appBaseUrl);

  // The reviewer's edit wins verbatim; the default carries the `[Explorer]`
  // prefix so a filed finding is identifiable in an issue list, the same way
  // core prefixes a verify case.
  const title = truncate(
    input.titleOverride?.trim() ||
      `[Explorer] ${finding.title.trim() || "finding"}`,
    240,
  );

  const lines: string[] = [];

  lines.push(
    `**${SEVERITY_BADGE[finding.severity]}** · ${finding.kind === "ux" ? "UX issue" : "Defect"} · found by the Lastest Explorer`,
    "",
  );

  if (note?.trim()) {
    lines.push("### Reviewer note", "", note.trim(), "");
  }

  lines.push("### What the explorer saw", "", finding.description.trim(), "");

  // Everything an assignee needs to place the finding, in one table so it
  // stays scannable however many rows end up applying.
  const context: Array<[string, string | null]> = [
    ["Repository", repoFullName],
    ["Page", finding.url ?? session?.targetUrl ?? null],
    ["Target app", session?.targetUrl ?? null],
    ["Scenario", finding.scenario?.title ?? null],
    ["Style", finding.scenario?.style ?? null],
    [
      "Outcome",
      session?.actionLog?.status ? `\`${session.actionLog.status}\`` : null,
    ],
    ["Root cause", cluster?.rootCause ?? finding.rootCauseCluster],
    [
      "Page state",
      finding.pageStateHash ? `\`${finding.pageStateHash}\`` : null,
    ],
    ["Observed", finding.createdAt ? finding.createdAt.toISOString() : null],
    ["Filed by", reporterEmail],
  ];
  const rows = context.filter((row): row is [string, string] =>
    Boolean(row[1]),
  );
  if (rows.length > 0) {
    lines.push(
      "### Context",
      "",
      "| Field | Value |",
      "|-------|-------|",
      ...rows.map(([k, v]) => `| ${k} | ${cell(v)} |`),
      "",
    );
  }

  if (finding.scenario?.rationale) {
    lines.push(`> ${cell(finding.scenario.rationale)}`, "");
  }

  lines.push(...renderSteps(finding.scenario, session?.actionLog ?? null));

  const consoleErrors =
    finding.evidence?.consoleErrors ?? session?.actionLog?.consoleErrors;
  const failedRequests =
    finding.evidence?.failedRequests ?? session?.actionLog?.failedRequests;
  const evidence = [
    ...renderConsole(consoleErrors),
    ...renderRequests(failedRequests),
  ];
  if (evidence.length > 0) lines.push("### Evidence", "", ...evidence);

  if (cluster?.summary) {
    lines.push("### Root-cause cluster", "", cluster.summary, "");
  }

  lines.push(
    "### Resources",
    "",
    `- [Open the Explorer in Lastest](${base}/explorer)`,
    ...(session ? [`- Explorer session: \`${session.id}\``] : []),
    "",
    "---",
    `_Filed from the Lastest Explorer · finding \`${finding.id}\`_`,
  );

  return {
    title,
    body: lines.join("\n"),
    labels: ["lastest", "explorer", `severity:${finding.severity}`],
  };
}
