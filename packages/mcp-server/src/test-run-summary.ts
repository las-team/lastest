/**
 * Projection for `lastest_get_test_run`.
 *
 * The raw `/api/v1/runs/:id` payload carries every per-result diagnostic blob
 * the web UI renders: the full network log, DOM snapshots, per-step web-vitals,
 * URL trajectories and execution logs. For a 25-test run that is ~2.9MB of
 * pretty-printed JSON — almost all of it noise when an agent only wants to know
 * what changed / what failed.
 *
 * By default we return the *changes* only: pass/fail status, the failure signal
 * (error, soft errors, triage) and the deviations each check layer flagged
 * (failed network requests, console errors, a11y + design-system violations).
 * Heavy raw context is opt-in per section via `include`.
 */

export type IncludeFlag =
  | "network"
  | "dom"
  | "vitals"
  | "trajectory"
  | "logs"
  | "storage"
  | "all";

type Rec = Record<string, unknown>;

/** A request counts as a "change" if it failed or returned a 0/4xx/5xx status. */
function isFailedRequest(req: unknown): boolean {
  if (req === null || typeof req !== "object") return false;
  const r = req as Rec;
  if (r.failed === true) return true;
  const status = r.status;
  return typeof status === "number" && (status === 0 || status >= 400);
}

/** A page can flag dozens of repeated violations / failed requests; cap each list and report the rest as a count. */
const MAX_VIOLATIONS = 10;
const MAX_FAILED_REQUESTS = 20;

/**
 * Trim a violations array to the fields that describe the change, dropping
 * static reference data (axe `tags`/`helpUrl`/`description`, design token
 * usage) and the bulky per-node captured HTML. One representative locator +
 * failure summary is lifted from the first sample node; the full DOM context
 * is available via `include: ["all"]`. The array is capped at MAX_VIOLATIONS
 * with an `omittedCount` so a noisy page can't blow the payload back up.
 */
function trimViolations(list: unknown, keep: string[]): unknown {
  if (!Array.isArray(list)) return list;
  const trimmed = list.slice(0, MAX_VIOLATIONS).map((v) => {
    const item = (v ?? {}) as Rec;
    const out: Rec = {};
    for (const k of keep) if (item[k] !== undefined) out[k] = item[k];
    const first = Array.isArray(item.sampleNodes)
      ? (item.sampleNodes[0] as Rec | undefined)
      : undefined;
    if (first) {
      if (first.target !== undefined) out.target = first.target;
      if (first.failureSummary !== undefined)
        out.summary = first.failureSummary;
    }
    return out;
  });
  if (list.length > MAX_VIOLATIONS) {
    trimmed.push({ omittedCount: list.length - MAX_VIOLATIONS });
  }
  return trimmed;
}

/** Drop passing assertions (only failures are a change); keep a pass count. */
function trimAssertions(list: unknown): unknown {
  if (!Array.isArray(list)) return list;
  const failures = list.filter((a) => (a as Rec)?.status !== "passed");
  const passed = list.length - failures.length;
  if (failures.length === 0) return passed > 0 ? { passed } : list;
  return passed > 0 ? { passed, failures } : { failures };
}

const A11Y_KEEP = ["id", "impact", "help", "nodes"];
const DESIGN_KEEP = [
  "id",
  "category",
  "property",
  "impact",
  "actual",
  "expected",
  "expectedName",
  "nodes",
];

/** Project a single test result down to changes + opt-in raw sections. */
export function projectResult(result: Rec, include: IncludeFlag[]): Rec {
  const want = (flag: IncludeFlag) => include.includes(flag);

  const net = Array.isArray(result.networkRequests)
    ? (result.networkRequests as unknown[])
    : [];
  const allFailed = net.filter(isFailedRequest);
  const failedNetworkRequests = allFailed.slice(0, MAX_FAILED_REQUESTS);
  const failedNetworkOmitted = allFailed.length - failedNetworkRequests.length;

  const out: Rec = {
    // identity / status
    id: result.id,
    testId: result.testId,
    status: result.status,
    isFlaky: result.isFlaky,
    durationMs: result.durationMs,
    viewport: result.viewport,
    browser: result.browser,
    totalSteps: result.totalSteps,
    lastReachedStep: result.lastReachedStep,
    // visual-change pointers
    screenshotPath: result.screenshotPath,
    screenshots: result.screenshots,
    diffPath: result.diffPath,
    // failure / change signal
    errorMessage: result.errorMessage,
    softErrors: result.softErrors,
    triage: result.triage,
    evaluationOutcome: result.evaluationOutcome,
    consoleErrors: result.consoleErrors,
    assertionResults: trimAssertions(result.assertionResults),
    extractedVariables: result.extractedVariables,
    // check-layer deviations (trimmed to the change, not the full DOM)
    a11yPassesCount: result.a11yPassesCount,
    a11yViolations: trimViolations(result.a11yViolations, A11Y_KEEP),
    designSystemViolations: trimViolations(
      result.designSystemViolations,
      DESIGN_KEEP,
    ),
    // network: failures are a change; the full firehose is opt-in
    networkRequestCount: net.length,
    failedNetworkRequestCount: allFailed.length,
    failedNetworkRequests,
    ...(failedNetworkOmitted > 0 ? { failedNetworkOmitted } : {}),
  };

  if (want("network")) out.networkRequests = result.networkRequests;
  if (want("dom")) out.domSnapshot = result.domSnapshot;
  if (want("vitals")) out.webVitals = result.webVitals;
  if (want("trajectory")) out.urlTrajectory = result.urlTrajectory;
  if (want("logs")) out.logs = result.logs;
  if (want("storage")) out.storageStateSnapshot = result.storageStateSnapshot;

  return out;
}

/**
 * Summarize a raw `/api/v1/runs/:id` payload. `include: ["all"]` is the
 * power-user escape hatch that returns the full payload untouched (still
 * compact-serialized by the caller).
 */
export function summarizeTestRun(data: Rec, include: IncludeFlag[] = []): Rec {
  if (include.includes("all")) return data;
  const results = Array.isArray(data.results) ? (data.results as Rec[]) : [];
  return {
    run: data.run,
    results: results.map((r) => projectResult(r, include)),
  };
}
