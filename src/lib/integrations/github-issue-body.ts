/**
 * Shared GitHub issue body composer.
 *
 * Two surfaces both render the same enriched markdown:
 *  - `buildVisualDiffBody`    for `submitDiffAsIssue` (one diff, no reviewer)
 *  - `buildVerifyCaseBody`    for `createIssueForCase` (verify board, can filter
 *                             evidence layers via the "Include evidence (X/Y)"
 *                             selector)
 *
 * The body has these sections, each optional based on data presence and the
 * caller's `includedLayers` set:
 *  1. Header (test, step, verdict)
 *  2. Context table (repo, branch, commit, build, browser, viewport, URL, steps)
 *  3. Reviewer note (verify only)
 *  4. Top-line evidence chips
 *  5. Per-layer drill-downs (visual / console / network / dom / a11y / url / perf)
 *  6. AI triage + AI diff recommendation
 *  7. Resources (open in Lastest, baseline/current/diff images, video)
 *
 * The composer is pure (no DB / fetch). Callers gather the inputs and pass them in.
 */

import type {
  A11yDiffSummary,
  A11yViolation,
  AIDiffAnalysis,
  Build,
  ConsoleDiffSummary,
  DomDiffResult,
  EvidenceItem,
  EvidenceLayer,
  NetworkDiffSummary,
  NetworkRequest,
  PerfDiffSummary,
  StepComparison,
  StepComparisonEvidence,
  Test,
  TestResult,
  TestRun,
  TriageResult,
  UrlTrajectoryDiffSummary,
  UrlTrajectoryStep,
  VisualDiff,
} from "@/lib/db/schema";

// ── shared helpers ─────────────────────────────────────────────────────────

export function shortSha(sha: string | null | undefined): string {
  if (!sha) return "unknown";
  return sha.length > 8 ? sha.slice(0, 8) : sha;
}

function mediaUrl(
  baseUrl: string,
  relativePath: string | null | undefined,
): string | null {
  if (!relativePath) return null;
  const clean = relativePath.replace(/^\/+/, "");
  return `${baseUrl.replace(/\/+$/, "")}/api/media/${clean}`;
}

function trimBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `… (+${text.length - max} chars)`;
}

function escapeTableCell(text: string): string {
  // GitHub markdown tables break on `|` and newlines.
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function isFailingStatus(status: number): boolean {
  return status >= 400 || status === 0;
}

// ── section: header ────────────────────────────────────────────────────────

interface HeaderInput {
  scope: "visual" | "verify";
  testName: string;
  stepLabel: string | null;
  functionalAreaName: string | null;
  verdict: StepComparison["verdict"] | null;
  pctDiff: string | null; // visual scope only
  classification: string | null; // visual scope only
}

function renderHeader(input: HeaderInput): string[] {
  const lines: string[] = [];
  const title =
    input.scope === "visual" ? "## Visual diff review" : "## Verify case";
  lines.push(title, "");
  lines.push(
    `**Test:** ${input.testName}${input.functionalAreaName ? ` _(area: ${input.functionalAreaName})_` : ""}`,
  );
  if (input.stepLabel) lines.push(`**Step:** \`${input.stepLabel}\``);
  if (input.verdict) lines.push(`**Verdict:** \`${input.verdict}\``);
  if (input.classification)
    lines.push(`**Classification:** \`${input.classification}\``);
  if (input.pctDiff) lines.push(`**Pixel diff:** ${input.pctDiff}`);
  lines.push("");
  return lines;
}

// ── section: context table ─────────────────────────────────────────────────

interface ContextInput {
  repoFullName: string;
  buildId: string;
  branch: string | null;
  commit: string | null;
  browser: string | null;
  viewport: string | null;
  durationMs: number | null;
  targetUrl: string | null;
  stepsAchieved: number | null;
  stepsTotal: number | null;
  reporterEmail: string | null;
  baseUrl: string;
  buildUrl: string;
}

function renderContext(input: ContextInput): string[] {
  const lines: string[] = [];
  lines.push("### Context", "");
  lines.push("| Field | Value |");
  lines.push("|-------|-------|");
  lines.push(`| Repo | \`${input.repoFullName}\` |`);
  lines.push(
    `| Build | [\`${input.buildId.slice(0, 8)}\`](${input.buildUrl}) |`,
  );
  lines.push(`| Branch | \`${input.branch ?? "unknown"}\` |`);
  lines.push(`| Commit | \`${shortSha(input.commit)}\` |`);
  if (input.targetUrl) lines.push(`| URL | ${input.targetUrl} |`);
  if (input.browser) lines.push(`| Browser | ${input.browser} |`);
  if (input.viewport) lines.push(`| Viewport | ${input.viewport} |`);
  if (input.durationMs != null)
    lines.push(`| Duration | ${(input.durationMs / 1000).toFixed(2)}s |`);
  if (input.stepsTotal != null) {
    const achieved = input.stepsAchieved ?? input.stepsTotal;
    lines.push(
      `| Steps achieved | ${achieved} / ${input.stepsTotal}${achieved < input.stepsTotal ? " (test cut short)" : ""} |`,
    );
  }
  if (input.reporterEmail) lines.push(`| Reporter | ${input.reporterEmail} |`);
  lines.push("");
  return lines;
}

// ── section: reviewer note (verify only) ───────────────────────────────────

function renderReviewerNote(note: string | null): string[] {
  if (!note || note.trim().length === 0) return [];
  return ["### Reviewer note", "", note.trim(), ""];
}

// ── section: evidence top-line chips ───────────────────────────────────────

function renderEvidenceChips(
  evidence: EvidenceItem[],
  included: Set<EvidenceLayer>,
): string[] {
  const picked = evidence.filter((e) => included.has(e.layer));
  if (picked.length === 0) return [];
  const lines: string[] = ["### Issues found", ""];
  for (const e of picked) {
    const badge =
      e.signal === "high" ? "🔴" : e.signal === "medium" ? "🟡" : "🔵";
    lines.push(`- ${badge} **${e.layer}** (${e.signal}): ${e.summary}`);
  }
  lines.push("");
  return lines;
}

// ── section: visual diff drill ─────────────────────────────────────────────

interface VisualDrillInput {
  diff: Pick<
    VisualDiff,
    | "pixelDifference"
    | "percentageDifference"
    | "classification"
    | "metadata"
    | "baselineImagePath"
    | "currentImagePath"
    | "diffImagePath"
    | "aiAnalysis"
    | "aiRecommendation"
  >;
  baseUrl: string;
}

function renderVisualDrill(input: VisualDrillInput): string[] {
  const d = input.diff;
  const trimmed = trimBase(input.baseUrl);
  const lines: string[] = ["### Visual diff", ""];
  lines.push(
    `- Pixel diff: **${d.percentageDifference ?? "0"}%** (${d.pixelDifference ?? 0} px)`,
  );
  if (d.classification) lines.push(`- Classification: \`${d.classification}\``);
  const meta = d.metadata;
  if (meta?.changeCategories && meta.changeCategories.length > 0) {
    lines.push(`- Change categories: ${meta.changeCategories.join(", ")}`);
  }
  if (meta?.pageShift?.detected) {
    lines.push(
      `- Page shift: Δy=${meta.pageShift.deltaY}px (confidence ${(meta.pageShift.confidence * 100).toFixed(0)}%)`,
    );
  }
  if (meta?.textDiffSummary) {
    lines.push(
      `- Text diff: +${meta.textDiffSummary.added} / -${meta.textDiffSummary.removed}`,
    );
  }
  if (meta?.baselineSourceBranch) {
    lines.push(
      `- Baseline sourced from \`${meta.baselineSourceBranch}\` (cross-branch comparison)`,
    );
  }
  const ai = d.aiAnalysis as AIDiffAnalysis | null | undefined;
  if (d.aiRecommendation || ai?.summary) {
    lines.push("");
    if (d.aiRecommendation)
      lines.push(`**AI recommendation:** \`${d.aiRecommendation}\``);
    if (ai?.summary) lines.push("", ai.summary);
  }
  const diffImg = mediaUrl(trimmed, d.diffImagePath);
  const baseImg = mediaUrl(trimmed, d.baselineImagePath);
  const currImg = mediaUrl(trimmed, d.currentImagePath);
  if (diffImg || baseImg || currImg) {
    lines.push("");
    lines.push("_Login to Lastest required to view image bytes._");
    if (diffImg) lines.push(`- [Diff](${diffImg})`);
    if (baseImg) lines.push(`- [Baseline](${baseImg})`);
    if (currImg) lines.push(`- [Current](${currImg})`);
  }
  lines.push("");
  return lines;
}

// ── section: console errors drill ──────────────────────────────────────────

function renderConsoleDrill(
  raw: string[] | null | undefined,
  diff: ConsoleDiffSummary | undefined,
): string[] {
  const hasRaw = (raw?.length ?? 0) > 0;
  const hasDiff =
    diff && (diff.newFingerprints.length > 0 || diff.disappeared.length > 0);
  if (!hasRaw && !hasDiff) return [];

  const lines: string[] = ["### Console errors", ""];

  if (diff && diff.newFingerprints.length > 0) {
    lines.push(`**New since baseline** (${diff.newFingerprints.length}):`);
    lines.push("");
    for (const fp of diff.newFingerprints.slice(0, 15)) {
      lines.push(`- ×${fp.count} \`${truncate(fp.sample, 200)}\``);
    }
    if (diff.newFingerprints.length > 15)
      lines.push(`- _… ${diff.newFingerprints.length - 15} more_`);
    lines.push("");
  }

  if (diff && diff.disappeared.length > 0) {
    lines.push(
      `<details><summary>Resolved since baseline (${diff.disappeared.length})</summary>`,
    );
    lines.push("");
    for (const fp of diff.disappeared.slice(0, 10)) {
      lines.push(`- ×${fp.count} \`${truncate(fp.sample, 200)}\``);
    }
    lines.push("</details>", "");
  }

  if (hasRaw) {
    const errors = raw!;
    lines.push(
      `<details><summary>All console errors this run (${errors.length})</summary>`,
    );
    lines.push("");
    lines.push("```");
    lines.push(
      errors
        .slice(0, 30)
        .map((e) => truncate(e, 600))
        .join("\n"),
    );
    if (errors.length > 30)
      lines.push(`… ${errors.length - 30} more not shown`);
    lines.push("```");
    lines.push("</details>", "");
  }
  return lines;
}

// ── section: network errors drill ──────────────────────────────────────────

function renderNetworkDrill(
  requests: NetworkRequest[] | null | undefined,
  diff: NetworkDiffSummary | undefined,
): string[] {
  const failedRaw = (requests ?? []).filter(
    (r) => r.failed || isFailingStatus(r.status),
  );
  const hasDiff =
    diff &&
    (diff.newClientErrors.length > 0 ||
      diff.newServerErrors.length > 0 ||
      diff.statusFlips.length > 0 ||
      diff.added > 0 ||
      diff.removed > 0);
  if (failedRaw.length === 0 && !hasDiff) return [];

  const lines: string[] = ["### Network", ""];

  if (diff) {
    lines.push(
      `Added: **${diff.added}** · Removed: **${diff.removed}** · Changed: **${diff.changed}** · New error responses: **${diff.newErrorCount}**`,
    );
    lines.push("");
  }

  if (
    diff &&
    (diff.newClientErrors.length > 0 || diff.newServerErrors.length > 0)
  ) {
    const errs = [...diff.newServerErrors, ...diff.newClientErrors];
    lines.push(`**New 4xx / 5xx since baseline** (${errs.length}):`);
    lines.push("");
    lines.push("| Method | Status | URL |");
    lines.push("|--------|--------|-----|");
    for (const r of errs.slice(0, 20)) {
      lines.push(
        `| ${r.method} | ${r.status} | ${escapeTableCell(truncate(r.url, 180))} |`,
      );
    }
    if (errs.length > 20) lines.push(`| _… ${errs.length - 20} more_ | | |`);
    lines.push("");
  }

  if (diff && diff.statusFlips.length > 0) {
    lines.push(
      `<details><summary>Status flips (${diff.statusFlips.length})</summary>`,
    );
    lines.push("");
    lines.push("| Method | From | To | URL |");
    lines.push("|--------|------|----|-----|");
    for (const f of diff.statusFlips.slice(0, 30)) {
      lines.push(
        `| ${f.method} | ${f.from} | ${f.to} | ${escapeTableCell(truncate(f.url, 160))} |`,
      );
    }
    lines.push("</details>", "");
  }

  if (failedRaw.length > 0) {
    lines.push(
      `<details><summary>All failing requests this run (${failedRaw.length})</summary>`,
    );
    lines.push("");
    lines.push("| Method | Status | Type | Duration | URL | Error |");
    lines.push("|--------|--------|------|----------|-----|-------|");
    for (const r of failedRaw.slice(0, 30)) {
      const err = r.errorText
        ? escapeTableCell(truncate(r.errorText, 100))
        : "";
      lines.push(
        `| ${r.method} | ${r.status} | ${r.resourceType} | ${r.duration}ms | ${escapeTableCell(truncate(r.url, 160))} | ${err} |`,
      );
    }
    if (failedRaw.length > 30)
      lines.push(`| _… ${failedRaw.length - 30} more_ | | | | | |`);
    lines.push("</details>", "");
  }
  return lines;
}

// ── section: DOM diff drill ────────────────────────────────────────────────

function renderDomDrill(dom: DomDiffResult | undefined): string[] {
  if (!dom) return [];
  const added = dom.added.length;
  const removed = dom.removed.length;
  const changed = dom.changed.length;
  if (added === 0 && removed === 0 && changed === 0) return [];

  const lines: string[] = ["### DOM changes", ""];
  lines.push(
    `Added: **${added}** · Removed: **${removed}** · Changed: **${changed}** · Unchanged: ${dom.unchangedCount}`,
  );
  lines.push("");

  const elementDesc = (el: (typeof dom.added)[number]) => {
    const sel =
      el.selectors.find((s) => s.type === "data-testid" || s.type === "id")
        ?.value ||
      el.selectors[0]?.value ||
      "(no selector)";
    const text = el.textContent ? ` "${truncate(el.textContent, 60)}"` : "";
    return `\`${el.tag}\`${text} — \`${truncate(sel, 120)}\``;
  };

  if (added > 0) {
    lines.push(`<details><summary>Added elements (${added})</summary>`);
    lines.push("");
    for (const el of dom.added.slice(0, 20)) lines.push(`- ${elementDesc(el)}`);
    if (added > 20) lines.push(`- _… ${added - 20} more_`);
    lines.push("</details>", "");
  }
  if (removed > 0) {
    lines.push(`<details><summary>Removed elements (${removed})</summary>`);
    lines.push("");
    for (const el of dom.removed.slice(0, 20))
      lines.push(`- ${elementDesc(el)}`);
    if (removed > 20) lines.push(`- _… ${removed - 20} more_`);
    lines.push("</details>", "");
  }
  if (changed > 0) {
    lines.push(`<details><summary>Changed elements (${changed})</summary>`);
    lines.push("");
    for (const c of dom.changed.slice(0, 20)) {
      lines.push(
        `- ${elementDesc(c.current)} — fields: ${c.changes.join(", ")}`,
      );
    }
    if (changed > 20) lines.push(`- _… ${changed - 20} more_`);
    lines.push("</details>", "");
  }
  return lines;
}

// ── section: accessibility drill ───────────────────────────────────────────

function renderA11yDrill(
  violations: A11yViolation[] | null | undefined,
  diff: A11yDiffSummary | undefined,
): string[] {
  const v = violations ?? [];
  const newOnes = diff?.newViolations ?? [];
  if (v.length === 0 && newOnes.length === 0) return [];

  const lines: string[] = ["### Accessibility (WCAG 2.2 AA)", ""];

  if (diff && diff.newViolations.length > 0) {
    const s = diff.newBySeverity;
    lines.push(
      `New since baseline: 🔴 critical ${s.critical} · 🟠 serious ${s.serious} · 🟡 moderate ${s.moderate} · 🔵 minor ${s.minor}`,
    );
    lines.push("");
    for (const w of diff.newViolations.slice(0, 15)) {
      lines.push(
        `- **${w.id}** (${w.impact}, WCAG ${w.wcagLevel ?? "?"}) × ${w.nodes} node(s): ${w.help ?? w.description}`,
      );
      if (w.helpUrl) lines.push(`  - [Reference](${w.helpUrl})`);
    }
    if (diff.newViolations.length > 15)
      lines.push(`- _… ${diff.newViolations.length - 15} more new_`);
    lines.push("");
  }

  if (v.length > 0) {
    lines.push(
      `<details><summary>All violations this run (${v.length})</summary>`,
    );
    lines.push("");
    for (const w of v.slice(0, 30)) {
      lines.push(
        `- **${w.id}** (${w.impact}, WCAG ${w.wcagLevel ?? "?"}) × ${w.nodes} node(s): ${w.help ?? w.description}`,
      );
    }
    if (v.length > 30) lines.push(`- _… ${v.length - 30} more_`);
    lines.push("</details>", "");
  }
  return lines;
}

// ── section: url trajectory drill ──────────────────────────────────────────

function renderUrlDrill(diff: UrlTrajectoryDiffSummary | undefined): string[] {
  if (!diff || diff.divergedSteps.length === 0) return [];
  const lines: string[] = ["### URL trajectory divergence", ""];
  lines.push(
    `Diverged steps: **${diff.divergedSteps.length}** of ${diff.totalStepsCompared} compared`,
  );
  lines.push("");
  lines.push("| Step | Baseline URL | Current URL | Redirect chain changed |");
  lines.push("|------|--------------|-------------|------------------------|");
  for (const d of diff.divergedSteps.slice(0, 20)) {
    const label = d.stepLabel
      ? `${d.stepIndex} (${d.stepLabel})`
      : `${d.stepIndex}`;
    lines.push(
      `| ${label} | ${escapeTableCell(truncate(d.baselineUrl, 100))} | ${escapeTableCell(truncate(d.currentUrl, 100))} | ${d.redirectChainChanged ? "yes" : "no"} |`,
    );
  }
  lines.push("");
  return lines;
}

// ── section: perf drill ────────────────────────────────────────────────────

function renderPerfDrill(diff: PerfDiffSummary | undefined): string[] {
  if (!diff) return [];
  const breached = diff.deltas.filter((d) => d.budgetBreached || d.drifted);
  if (breached.length === 0) return [];
  const lines: string[] = ["### Web Vitals", ""];
  lines.push(
    "| Step | Metric | Baseline | Current | Δ | Budget breached | Drifted |",
  );
  lines.push(
    "|------|--------|----------|---------|---|-----------------|---------|",
  );
  for (const d of breached.slice(0, 20)) {
    const label = d.stepLabel
      ? `${d.stepIndex ?? "?"} (${d.stepLabel})`
      : `${d.stepIndex ?? "?"}`;
    lines.push(
      `| ${label} | ${d.metric.toUpperCase()} | ${d.baseline} | ${d.current} | ${d.delta > 0 ? "+" : ""}${d.delta} | ${d.budgetBreached ? "🔴" : ""} | ${d.drifted ? "🟡" : ""} |`,
    );
  }
  lines.push("");
  return lines;
}

// ── section: triage ────────────────────────────────────────────────────────

function renderTriage(
  triage: TriageResult | undefined | null,
  errorMessage: string | null,
): string[] {
  const lines: string[] = [];
  if (errorMessage) {
    lines.push(
      "### Test error",
      "",
      "```",
      truncate(errorMessage, 4000),
      "```",
      "",
    );
  }
  if (triage) {
    lines.push("### AI failure triage", "");
    lines.push(
      `**Classification:** \`${triage.classification}\` (confidence ${(triage.confidence * 100).toFixed(0)}%)`,
    );
    if (triage.actionTaken)
      lines.push(`**Action taken:** ${triage.actionTaken}`);
    if (triage.reasoning) lines.push("", triage.reasoning);
    lines.push("");
  }
  return lines;
}

// ── section: resources / footer ────────────────────────────────────────────

interface ResourcesInput {
  baseUrl: string;
  buildId: string;
  diffId: string | null;
  testId: string | null;
  videoPath: string | null;
  networkBodiesPath: string | null;
  scope: "visual" | "verify";
}

function renderResources(input: ResourcesInput): string[] {
  const trimmed = trimBase(input.baseUrl);
  const lines: string[] = ["---", ""];
  if (input.diffId && input.scope === "visual") {
    lines.push(
      `👉 [Open diff in Lastest](${trimmed}/builds/${input.buildId}/diff/${input.diffId})`,
    );
  } else {
    lines.push(
      `👉 [Open build in Lastest](${trimmed}/builds/${input.buildId})`,
    );
    if (input.scope === "verify") {
      lines.push(`👉 [Open verify board](${trimmed}/verify/${input.buildId})`);
    }
  }
  if (input.testId)
    lines.push(`👉 [Open test definition](${trimmed}/tests/${input.testId})`);
  const video = mediaUrl(trimmed, input.videoPath);
  if (video) lines.push(`👉 [Recorded video](${video})`);
  const bodies = mediaUrl(trimmed, input.networkBodiesPath);
  if (bodies) lines.push(`👉 [Network bodies archive](${bodies})`);
  lines.push("");
  return lines;
}

// ── helper: derive URL for the step from urlTrajectory ─────────────────────

function pickTargetUrl(
  trajectory: UrlTrajectoryStep[] | null | undefined,
  stepIndex: number | null,
  stepLabel: string | null,
  fallback: string | null,
): string | null {
  if (trajectory && trajectory.length > 0) {
    if (stepIndex != null) {
      const match = trajectory.find((t) => t.stepIndex === stepIndex);
      if (match) return match.finalUrl;
    }
    if (stepLabel) {
      const match = trajectory.find((t) => t.stepLabel === stepLabel);
      if (match) return match.finalUrl;
    }
    // Fall back to last entry — best-effort "where the test ended up".
    return trajectory[trajectory.length - 1].finalUrl;
  }
  return fallback;
}

// ── top-level: visual diff body ────────────────────────────────────────────

export interface VisualDiffBodyInput {
  diff: VisualDiff;
  test: Pick<Test, "id" | "name" | "targetUrl"> | null;
  functionalAreaName: string | null;
  build: Pick<Build, "id">;
  testRun: Pick<TestRun, "gitBranch" | "gitCommit"> | null;
  testResult: TestResult | null;
  stepComparison: StepComparison | null;
  repoFullName: string;
  reporterEmail: string;
  baseUrl: string;
}

export function buildVisualDiffBody(input: VisualDiffBodyInput): {
  title: string;
  body: string;
  labels: string[];
} {
  const {
    diff,
    test,
    functionalAreaName,
    build,
    testRun,
    testResult,
    stepComparison,
    repoFullName,
    reporterEmail,
    baseUrl,
  } = input;

  const testName = test?.name ?? "Visual diff";
  const pct = diff.percentageDifference
    ? `${diff.percentageDifference}%`
    : "0%";
  const title = `Visual diff: ${testName}${diff.stepLabel ? ` — ${diff.stepLabel}` : ""} (${pct})`;
  const trimmed = trimBase(baseUrl);

  const targetUrl = pickTargetUrl(
    testResult?.urlTrajectory ?? null,
    stepComparison?.stepIndex ?? null,
    diff.stepLabel ?? null,
    test?.targetUrl ?? null,
  );

  const layers = (stepComparison?.layers ?? {}) as StepComparisonEvidence;
  const evidence = stepComparison?.evidence ?? [];
  // No selector on visual path: include every layer that *might* have content,
  // either because evidence flagged it or because the testResult carries raw
  // signal (so pre-step-comparison diffs still surface console / network).
  const includedLayers = new Set<EvidenceLayer>([
    ...evidence.map((e) => e.layer),
    ...((testResult?.consoleErrors?.length ?? 0) > 0
      ? ["console" as EvidenceLayer]
      : []),
    ...((testResult?.networkRequests?.length ?? 0) > 0
      ? ["network" as EvidenceLayer]
      : []),
    ...((testResult?.a11yViolations?.length ?? 0) > 0
      ? ["a11y" as EvidenceLayer]
      : []),
  ]);

  const lines: string[] = [];
  lines.push(
    ...renderHeader({
      scope: "visual",
      testName,
      stepLabel: diff.stepLabel,
      functionalAreaName,
      verdict: stepComparison?.verdict ?? null,
      pctDiff: pct,
      classification: diff.classification,
    }),
  );
  lines.push(
    ...renderContext({
      repoFullName,
      buildId: build.id,
      branch: testRun?.gitBranch ?? null,
      commit: testRun?.gitCommit ?? null,
      browser: diff.browser ?? testResult?.browser ?? null,
      viewport: testResult?.viewport ?? null,
      durationMs: testResult?.durationMs ?? null,
      targetUrl,
      stepsAchieved:
        testResult?.lastReachedStep != null
          ? testResult.lastReachedStep + 1
          : null,
      stepsTotal: testResult?.totalSteps ?? null,
      reporterEmail,
      baseUrl,
      buildUrl: `${trimmed}/builds/${build.id}`,
    }),
  );
  if (evidence.length > 0)
    lines.push(...renderEvidenceChips(evidence, includedLayers));

  lines.push(
    ...renderTriage(testResult?.triage, testResult?.errorMessage ?? null),
  );

  // Visual is always emitted for the diff path — that's the whole point.
  lines.push(...renderVisualDrill({ diff, baseUrl }));

  if (includedLayers.has("console")) {
    lines.push(
      ...renderConsoleDrill(testResult?.consoleErrors, layers.consoleDiff),
    );
  }
  if (includedLayers.has("network")) {
    lines.push(
      ...renderNetworkDrill(testResult?.networkRequests, layers.network),
    );
  }
  if (includedLayers.has("dom")) {
    lines.push(...renderDomDrill(layers.dom ?? diff.metadata?.domDiff));
  }
  if (includedLayers.has("a11y")) {
    lines.push(...renderA11yDrill(testResult?.a11yViolations, layers.a11y));
  }
  if (includedLayers.has("url")) {
    lines.push(...renderUrlDrill(layers.url));
  }
  if (includedLayers.has("perf")) {
    lines.push(...renderPerfDrill(layers.perf));
  }

  lines.push(
    ...renderResources({
      baseUrl,
      buildId: build.id,
      diffId: diff.id,
      testId: test?.id ?? null,
      videoPath: testResult?.videoPath ?? null,
      networkBodiesPath: testResult?.networkBodiesPath ?? null,
      scope: "visual",
    }),
  );

  return {
    title,
    body: lines.join("\n"),
    labels: ["lastest", "visual-diff"],
  };
}

// ── top-level: verify case body ────────────────────────────────────────────

export interface VerifyCaseBodyInput {
  step: StepComparison;
  diff: VisualDiff | null;
  test: Pick<Test, "id" | "name" | "targetUrl"> | null;
  functionalAreaName: string | null;
  build: Pick<Build, "id">;
  testRun: Pick<TestRun, "gitBranch" | "gitCommit"> | null;
  testResult: TestResult | null;
  repoFullName: string;
  reporterEmail: string | null;
  baseUrl: string;
  /** Subset of evidence layers to render. If null, every layer with evidence is included. */
  includedLayers: EvidenceLayer[] | null;
  /** Free-text reviewer note. Prepended to the body. */
  reviewerNote: string | null;
  /** First non-empty line of reviewer note becomes the title hint. */
  titleHint?: string | null;
}

export function buildVerifyCaseBody(input: VerifyCaseBodyInput): {
  title: string;
  body: string;
  labels: string[];
} {
  const {
    step,
    diff,
    test,
    functionalAreaName,
    build,
    testRun,
    testResult,
    repoFullName,
    reporterEmail,
    baseUrl,
    reviewerNote,
  } = input;

  const testName = test?.name ?? "verify case";
  const titleBase = `[Verify] ${testName}${step.stepLabel ? ` — ${step.stepLabel}` : ""}`;
  const titleHint =
    input.titleHint?.trim() ||
    reviewerNote?.trim().split(/\r?\n/, 1)[0]?.slice(0, 60) ||
    "";
  const title = titleHint ? `${titleBase}: ${titleHint}` : titleBase;
  const trimmed = trimBase(baseUrl);

  const evidence = step.evidence ?? [];
  const layers = (step.layers ?? {}) as StepComparisonEvidence;
  const includedLayers = new Set<EvidenceLayer>(
    input.includedLayers ?? evidence.map((e) => e.layer),
  );

  const targetUrl = pickTargetUrl(
    testResult?.urlTrajectory ?? null,
    step.stepIndex,
    step.stepLabel,
    test?.targetUrl ?? null,
  );

  const lines: string[] = [];
  lines.push(
    ...renderHeader({
      scope: "verify",
      testName,
      stepLabel: step.stepLabel,
      functionalAreaName,
      verdict: step.verdict,
      pctDiff: diff?.percentageDifference
        ? `${diff.percentageDifference}%`
        : null,
      classification: diff?.classification ?? null,
    }),
  );
  lines.push(...renderReviewerNote(reviewerNote));
  lines.push(
    ...renderContext({
      repoFullName,
      buildId: build.id,
      branch: testRun?.gitBranch ?? null,
      commit: testRun?.gitCommit ?? null,
      browser: diff?.browser ?? testResult?.browser ?? null,
      viewport: testResult?.viewport ?? null,
      durationMs: testResult?.durationMs ?? null,
      targetUrl,
      stepsAchieved:
        testResult?.lastReachedStep != null
          ? testResult.lastReachedStep + 1
          : null,
      stepsTotal: testResult?.totalSteps ?? null,
      reporterEmail,
      baseUrl,
      buildUrl: `${trimmed}/builds/${build.id}`,
    }),
  );
  if (evidence.length > 0)
    lines.push(...renderEvidenceChips(evidence, includedLayers));

  if (includedLayers.has("visual") && diff) {
    lines.push(...renderVisualDrill({ diff, baseUrl }));
  }
  if (includedLayers.has("console")) {
    lines.push(
      ...renderConsoleDrill(testResult?.consoleErrors, layers.consoleDiff),
    );
  }
  if (includedLayers.has("network")) {
    lines.push(
      ...renderNetworkDrill(testResult?.networkRequests, layers.network),
    );
  }
  if (includedLayers.has("dom")) {
    lines.push(...renderDomDrill(layers.dom ?? diff?.metadata?.domDiff));
  }
  if (includedLayers.has("a11y")) {
    lines.push(...renderA11yDrill(testResult?.a11yViolations, layers.a11y));
  }
  if (includedLayers.has("url")) {
    lines.push(...renderUrlDrill(layers.url));
  }
  if (includedLayers.has("perf")) {
    lines.push(...renderPerfDrill(layers.perf));
  }

  lines.push(
    ...renderTriage(testResult?.triage, testResult?.errorMessage ?? null),
  );

  lines.push(
    ...renderResources({
      baseUrl,
      buildId: build.id,
      diffId: diff?.id ?? null,
      testId: test?.id ?? null,
      videoPath: testResult?.videoPath ?? null,
      networkBodiesPath: testResult?.networkBodiesPath ?? null,
      scope: "verify",
    }),
  );

  return {
    title,
    body: lines.join("\n"),
    labels: ["lastest", "verify"],
  };
}
