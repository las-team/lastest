/**
 * Server-side derivations for the Run Results screen.
 *
 * The triage tables carry the agent's judgement; everything the screen shows
 * *around* that judgement (titles, browsers, diff stats, screenshots,
 * recordings, step logs, per-area health) is folded here out of the rows that
 * already exist. Nothing in this module invents a value: a missing datum
 * becomes `null` and the component omits the element.
 */

import type {
  Build,
  CapturedScreenshot,
  FunctionalArea,
  Test,
  TestResult,
  TestRun,
  TriageRegion,
  VisualDiff,
} from "@/lib/db/schema";
import { triageVerdictKey, type TriageRunView } from "@/lib/db/queries/triage";
import type {
  TriageAreaHealthVM,
  TriageCaseVM,
  TriageGroupVM,
  TriageHistoryMark,
  TriagePassingVM,
  TriageRecording,
  TriageScreenVM,
  TriageShot,
  TriageStepLine,
} from "@/components/triage/types";

/** A prior run's outcomes, oldest first — powers the last-3-runs sparkline. */
export interface PriorRunOutcomes {
  runId: string;
  results: Array<{ testId: string | null; status: string | null }>;
}

export interface DeriveInput {
  build: Build;
  testRun: TestRun | null;
  repoName: string;
  repositoryId: string | null;
  /** Position of `testRun` among the branch's runs, oldest = 1. */
  runPosition: number | null;
  runTotal: number | null;
  triage: TriageRunView | null;
  results: TestResult[];
  diffs: VisualDiff[];
  tests: Test[];
  areas: FunctionalArea[];
  priorRuns: PriorRunOutcomes[];
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function parsePct(value: string | null | undefined): number | null {
  if (value == null) return null;
  const n = typeof value === "string" ? parseFloat(value) : Number(value);
  return Number.isFinite(n) ? n : null;
}

function historyMark(status: string | null): TriageHistoryMark {
  if (status === "passed") return "passed";
  if (status === "failed") return "failed";
  return "other";
}

/** The most recent (non-superseded) result per test in this build's run. */
function indexResults(results: TestResult[]): Map<string, TestResult[]> {
  const superseded = new Set<string>();
  for (const r of results) if (r.retryOf) superseded.add(r.retryOf);
  const byTest = new Map<string, TestResult[]>();
  for (const r of results) {
    if (superseded.has(r.id) || !r.testId) continue;
    const bucket = byTest.get(r.testId);
    if (bucket) bucket.push(r);
    else byTest.set(r.testId, [r]);
  }
  return byTest;
}

function browsersOf(results: TestResult[]): string[] {
  const set = new Set<string>();
  for (const r of results) if (r.browser) set.add(r.browser);
  return [...set];
}

function firstScreenshotPath(result: TestResult | undefined): string | null {
  if (!result) return null;
  const shots = (result.screenshots ?? []) as CapturedScreenshot[];
  return shots[0]?.path ?? result.screenshotPath ?? null;
}

function recordingOf(result: TestResult | undefined): TriageRecording | null {
  if (!result?.videoPath) return null;
  return {
    src: result.videoPath,
    durationMs: result.durationMs ?? null,
    posterSrc: firstScreenshotPath(result),
  };
}

function shotOf(
  src: string | null | undefined,
  regions: TriageRegion[],
): TriageShot | null {
  return src ? { src, regions } : null;
}

// ---------------------------------------------------------------------------
// Step log
// ---------------------------------------------------------------------------

/**
 * Build the per-case step log.
 *
 * Preference order, all real data:
 *  1. `screenshots[]` — the captured checkpoints, which is what the reviewer
 *     recognises. `lastReachedStep` marks where a failed run stopped.
 *  2. `logs[]` — the EB executor's own lines, when there were no checkpoints.
 * Assertion results and the error message are appended in both cases.
 */
export function buildStepLog(result: TestResult | undefined): {
  lines: TriageStepLine[];
  failingIndex: number | null;
} {
  if (!result) return { lines: [], failingIndex: null };

  const lines: TriageStepLine[] = [];
  const shots = (result.screenshots ?? []) as CapturedScreenshot[];
  const failed = result.status === "failed";
  const stopAt = result.lastReachedStep;

  if (shots.length > 0) {
    shots.forEach((shot, i) => {
      const label = shot.title ?? shot.label ?? `Step ${i + 1}`;
      let mark: TriageStepLine["mark"] = "pass";
      if (failed && typeof stopAt === "number") {
        if (i === stopAt) mark = "fail";
        else if (i > stopAt) mark = "skip";
      }
      lines.push({ text: label, mark });
    });
  } else {
    for (const entry of result.logs ?? []) {
      lines.push({
        text: entry.message,
        mark: entry.level === "error" ? "fail" : "pass",
      });
    }
  }

  for (const a of result.assertionResults ?? []) {
    lines.push({
      text: a.errorMessage
        ? `${a.assertionId} — ${a.errorMessage}`
        : a.assertionId,
      mark:
        a.status === "failed"
          ? "fail"
          : a.status === "skipped"
            ? "skip"
            : "pass",
    });
  }

  if (result.errorMessage) {
    lines.push({ text: result.errorMessage.split("\n")[0], mark: "fail" });
  }

  const failingIndex = lines.findIndex((l) => l.mark === "fail");
  return { lines, failingIndex: failingIndex === -1 ? null : failingIndex };
}

// ---------------------------------------------------------------------------
// The whole screen
// ---------------------------------------------------------------------------

export function deriveTriageScreen(input: DeriveInput): TriageScreenVM {
  const {
    build,
    testRun,
    repoName,
    repositoryId,
    runPosition,
    runTotal,
    triage,
    results,
    diffs,
    tests,
    areas,
    priorRuns,
  } = input;

  const testById = new Map(tests.map((t) => [t.id, t]));
  const areaById = new Map(areas.map((a) => [a.id, a]));
  const resultsByTest = indexResults(results);

  // Diffs, addressable both by id and by (testId, stepLabel).
  const diffById = new Map(diffs.map((d) => [d.id, d]));
  const diffByStep = new Map<string, VisualDiff>();
  for (const d of diffs) {
    diffByStep.set(triageVerdictKey(d.testId, d.stepLabel), d);
  }

  // Last-3-runs sparkline, oldest first.
  const history = new Map<string, TriageHistoryMark[]>();
  for (const prior of priorRuns) {
    for (const r of prior.results) {
      if (!r.testId) continue;
      const marks = history.get(r.testId) ?? [];
      marks.push(historyMark(r.status));
      history.set(r.testId, marks);
    }
  }

  const caseVM = (c: TriageRunView["cases"][number]): TriageCaseVM => {
    const test = testById.get(c.testId);
    const area = test?.functionalAreaId
      ? (areaById.get(test.functionalAreaId) ?? null)
      : null;
    const testResults = resultsByTest.get(c.testId) ?? [];
    const result =
      testResults.find((r) => r.id === c.testResultId) ?? testResults[0];
    const diff =
      (c.visualDiffId ? diffById.get(c.visualDiffId) : undefined) ??
      diffByStep.get(triageVerdictKey(c.testId, c.stepLabel));
    const regions = diff?.metadata?.changedRegions ?? [];
    const { lines, failingIndex } = buildStepLog(result);

    return {
      id: c.id,
      testId: c.testId,
      stepLabel: c.stepLabel,
      verdictKey: triageVerdictKey(c.testId, c.stepLabel),
      status: c.status,
      title: test?.name ?? c.stepLabel ?? c.testId,
      areaId: area?.id ?? null,
      areaName: area?.name ?? null,
      note: c.note,
      suggestedVerdict: c.suggestedVerdict,
      groupId: c.triageGroupId,
      browsers: browsersOf(testResults),
      history: (history.get(c.testId) ?? []).slice(-3),
      diffPct: parsePct(diff?.percentageDifference),
      regionCount: regions.length,
      baseline: shotOf(diff?.baselineImagePath, []),
      current: shotOf(
        diff?.currentImagePath ?? firstScreenshotPath(result),
        regions,
      ),
      recording: recordingOf(result),
      steps: lines,
      failingStepIndex: failingIndex,
      errorMessage: result?.errorMessage ?? null,
    };
  };

  const caseVMs = new Map<string, TriageCaseVM>();
  for (const c of triage?.cases ?? []) caseVMs.set(c.id, caseVM(c));

  const groups: TriageGroupVM[] = (triage?.groups ?? []).map((g) => {
    const cases = g.cases
      .map((c) => caseVMs.get(c.id))
      .filter((c): c is TriageCaseVM => Boolean(c));
    // Card thumbnails: the first case that actually has both images.
    const withPair = cases.find((c) => c.baseline && c.current);
    return {
      id: g.id,
      slug: g.slug,
      headline: g.headline,
      note: g.note,
      kind: g.kind,
      risk: g.risk,
      suggestedVerdict: g.suggestedVerdict,
      confidence: g.confidence,
      orderIndex: g.orderIndex,
      functionalAreaId: g.functionalAreaId,
      evidence: g.evidence,
      githubIssueUrl: g.githubIssueUrl,
      githubIssueNumber: g.githubIssueNumber,
      githubIssueState: g.githubIssueState,
      githubIssueKind: g.githubIssueKind,
      cases,
      baseline:
        withPair?.baseline ?? cases.find((c) => c.baseline)?.baseline ?? null,
      current:
        withPair?.current ?? cases.find((c) => c.current)?.current ?? null,
    };
  });

  const ungrouped = (triage?.ungrouped ?? [])
    .map((c) => caseVMs.get(c.id))
    .filter((c): c is TriageCaseVM => Boolean(c));

  // ── Passing section ─────────────────────────────────────────────────────
  const caseTestIds = new Set((triage?.cases ?? []).map((c) => c.testId));
  const passing: TriagePassingVM[] = [];
  for (const [testId, rows] of resultsByTest) {
    if (caseTestIds.has(testId)) continue;
    const passed = rows.filter((r) => r.status === "passed");
    if (passed.length === 0) continue;
    const result = passed[0];
    const test = testById.get(testId);
    const area = test?.functionalAreaId
      ? (areaById.get(test.functionalAreaId) ?? null)
      : null;
    passing.push({
      id: result.id,
      testId,
      title: test?.name ?? testId,
      areaId: area?.id ?? null,
      areaName: area?.name ?? null,
      browsers: browsersOf(passed),
      durationMs: result.durationMs ?? null,
      history: (history.get(testId) ?? []).slice(-3),
      screenshotSrc: firstScreenshotPath(result),
      recording: recordingOf(result),
      steps: buildStepLog(result).lines,
    });
  }
  passing.sort((a, b) => a.title.localeCompare(b.title));

  // ── Per-area health ─────────────────────────────────────────────────────
  const caseStatusByTest = new Map<string, "failed" | "review">();
  for (const c of triage?.cases ?? []) {
    // A test with any hard failure counts as failed, even if another of its
    // steps only needs review.
    if (c.status === "failed" || !caseStatusByTest.has(c.testId)) {
      caseStatusByTest.set(
        c.testId,
        c.status === "failed" ? "failed" : "review",
      );
    }
  }

  const areaHealth = new Map<string, TriageAreaHealthVM>();
  for (const [testId, rows] of resultsByTest) {
    const test = testById.get(testId);
    const area = test?.functionalAreaId
      ? (areaById.get(test.functionalAreaId) ?? null)
      : null;
    const key = area?.id ?? "__none__";
    const row =
      areaHealth.get(key) ??
      ({
        id: area?.id ?? null,
        name: area?.name ?? "Uncategorised",
        tests: 0,
        passed: 0,
        failed: 0,
        review: 0,
      } satisfies TriageAreaHealthVM);
    row.tests += 1;
    const triaged = caseStatusByTest.get(testId);
    if (triaged === "failed") row.failed += 1;
    else if (triaged === "review") row.review += 1;
    else if (rows.some((r) => r.status === "failed")) row.failed += 1;
    else row.passed += 1;
    areaHealth.set(key, row);
  }
  const areaRows = [...areaHealth.values()].sort(
    (a, b) => b.failed + b.review - (a.failed + a.review) || b.tests - a.tests,
  );

  // ── Verdicts ────────────────────────────────────────────────────────────
  const verdicts: TriageScreenVM["verdicts"] = {};
  for (const [key, row] of Object.entries(triage?.verdicts ?? {})) {
    verdicts[key] = {
      verdict: row.verdict,
      note: row.note,
      snoozedUntil: row.snoozedUntil ? row.snoozedUntil.toISOString() : null,
    };
  }

  const failedTestIds = [
    ...new Set(
      (triage?.cases ?? [])
        .filter((c) => c.status === "failed")
        .map((c) => c.testId),
    ),
  ];

  return {
    buildId: build.id,
    repositoryId,
    header: {
      repoName,
      branch: testRun?.gitBranch ?? null,
      commit: testRun?.gitCommit ?? null,
      runPosition,
      runTotal,
      finishedAt:
        (testRun?.completedAt ?? build.completedAt)?.toISOString() ?? null,
    },
    hero: {
      totalTests: build.totalTests ?? null,
      browsers: build.browsers ?? [],
      elapsedMs: build.elapsedMs ?? null,
      headline: triage?.run.headline ?? null,
      summary: triage?.run.summary ?? null,
      runStatus: triage?.run.status ?? null,
      skippedReason: triage?.run.skippedReason ?? null,
      computedAt: triage?.run.computedAt?.toISOString() ?? null,
    },
    counts: {
      passed: build.passedCount ?? null,
      failed: build.failedCount ?? null,
      review: build.changesDetected ?? null,
    },
    areas: areaRows,
    groups,
    ungrouped,
    passing,
    verdicts,
    failedTestIds,
  };
}
