'use server';

import path from 'path';
import fs from 'fs';
import * as queries from '@/lib/db/queries';
import { requireTestOwnership, requireTestResultOwnership } from '@/lib/auth/ownership';
import { generateDiff } from '@/lib/diff/generator';
import { STORAGE_ROOT, STORAGE_DIRS, toRelativePath } from '@/lib/storage/paths';

export type RunCompareCandidate = {
  id: string;
  testRunId: string | null;
  status: string | null;
  durationMs: number | null;
  viewport: string | null;
  browser: string | null;
  startedAt: Date | null;
  gitBranch: string | null;
  gitCommit: string | null;
  hasScreenshot: boolean;
};

/**
 * Lightweight list of every prior run for `testId`. Powers the run-picker on
 * the compare-runs page — no screenshots, no diffs, just enough to label a row.
 * Authoritative ordering: most recent run first.
 */
export async function listTestRunsForCompare(testId: string): Promise<RunCompareCandidate[]> {
  await requireTestOwnership(testId);
  const rows = await queries.getTestResultsForCompare(testId);
  return rows.map((r) => ({
    id: r.id,
    testRunId: r.testRunId,
    status: r.status,
    durationMs: r.durationMs,
    viewport: r.viewport,
    browser: r.browser,
    startedAt: r.startedAt,
    gitBranch: r.gitBranch,
    gitCommit: r.gitCommit,
    hasScreenshot: !!r.hasScreenshot,
  }));
}

export interface ScreenshotPair {
  label: string;
  fromPath: string | null;
  toPath: string | null;
  diffPath: string | null;
  pixelDifference: number | null;
  percentageDifference: number | null;
  error: string | null;
}

export interface RunComparisonResult {
  testId: string;
  fromResultId: string;
  toResultId: string;
  fromMeta: {
    runId: string | null;
    startedAt: Date | null;
    status: string | null;
    durationMs: number | null;
    gitBranch: string | null;
    gitCommit: string | null;
    consoleErrorCount: number;
    networkRequestCount: number;
    a11yViolationCount: number;
    errorMessage: string | null;
  };
  toMeta: {
    runId: string | null;
    startedAt: Date | null;
    status: string | null;
    durationMs: number | null;
    gitBranch: string | null;
    gitCommit: string | null;
    consoleErrorCount: number;
    networkRequestCount: number;
    a11yViolationCount: number;
    errorMessage: string | null;
  };
  pairs: ScreenshotPair[];
  /** Console errors that exist only in the "to" run (regressions). */
  newConsoleErrors: string[];
  /** Console errors that existed only in the "from" run (resolved). */
  resolvedConsoleErrors: string[];
}

interface CapturedShot {
  path: string;
  label?: string;
}

/**
 * Pull a list of {label,path} pairs for a result, deduped. Falls back to the
 * legacy single `screenshotPath` column when the modern array is empty so
 * older runs still compare.
 */
function collectScreenshots(result: {
  screenshotPath: string | null;
  screenshots: CapturedShot[] | null;
}): Array<{ label: string; urlPath: string }> {
  const out: Array<{ label: string; urlPath: string }> = [];
  const seen = new Set<string>();

  if (Array.isArray(result.screenshots)) {
    for (let i = 0; i < result.screenshots.length; i++) {
      const s = result.screenshots[i];
      if (!s?.path || seen.has(s.path)) continue;
      seen.add(s.path);
      out.push({ label: s.label || `step ${i + 1}`, urlPath: s.path });
    }
  }

  if (result.screenshotPath && !seen.has(result.screenshotPath)) {
    seen.add(result.screenshotPath);
    out.push({ label: 'final', urlPath: result.screenshotPath });
  }

  return out;
}

/**
 * Build a label key that's stable across runs so the same step's screenshots
 * line up. The captured `label` (e.g. "step 1: open menu") is the strongest
 * signal; fall back to filename so legacy runs still align reasonably.
 */
function pairKey(label: string, urlPath: string): string {
  if (label && label !== 'final') return label.toLowerCase().trim();
  // Strip path + the trailing -<runid>.png suffix the executor adds so two
  // runs of "step_3.png" line up.
  const file = path.basename(urlPath);
  return file.replace(/-[a-f0-9-]{6,}\.png$/i, '').replace(/\.png$/i, '').toLowerCase();
}

function urlToFsPath(urlPath: string | null | undefined): string | null {
  if (!urlPath) return null;
  // Reject anything that doesn't live under STORAGE_ROOT.
  const cleaned = urlPath.replace(/^\/+/, '');
  if (cleaned.includes('..')) return null;
  const abs = path.join(STORAGE_ROOT, cleaned);
  if (!abs.startsWith(STORAGE_ROOT)) return null;
  return abs;
}

/**
 * Compare two existing test results for the same test by re-using their
 * stored screenshots — no test execution, no build creation.
 *
 * For every screenshot label that appears in both runs we run pixelmatch on
 * the fly and write the diff PNG into `storage/diffs/`. Screenshots that only
 * exist on one side get returned as one-sided pairs so the UI can flag them
 * as "missing in baseline" / "missing in current".
 */
export async function compareTwoRuns(
  testId: string,
  fromResultId: string,
  toResultId: string,
): Promise<RunComparisonResult> {
  if (!fromResultId || !toResultId) {
    throw new Error('Both fromResultId and toResultId are required');
  }
  if (fromResultId === toResultId) {
    throw new Error('Pick two different runs to compare');
  }

  await requireTestOwnership(testId);
  const { result: fromResult } = await requireTestResultOwnership(fromResultId);
  const { result: toResult } = await requireTestResultOwnership(toResultId);

  if (fromResult.testId !== testId || toResult.testId !== testId) {
    throw new Error('Selected results do not belong to this test');
  }

  const [fromRun, toRun] = await Promise.all([
    fromResult.testRunId ? queries.getTestRun(fromResult.testRunId) : Promise.resolve(null),
    toResult.testRunId ? queries.getTestRun(toResult.testRunId) : Promise.resolve(null),
  ]);

  // Build label -> shot maps and walk the union so single-sided shots show up.
  const fromShots = collectScreenshots(fromResult);
  const toShots = collectScreenshots(toResult);

  const fromByKey = new Map<string, { label: string; urlPath: string }>();
  for (const s of fromShots) fromByKey.set(pairKey(s.label, s.urlPath), s);
  const toByKey = new Map<string, { label: string; urlPath: string }>();
  for (const s of toShots) toByKey.set(pairKey(s.label, s.urlPath), s);

  const allKeys = new Set<string>([...fromByKey.keys(), ...toByKey.keys()]);

  if (!fs.existsSync(STORAGE_DIRS.diffs)) {
    fs.mkdirSync(STORAGE_DIRS.diffs, { recursive: true });
  }

  const pairs: ScreenshotPair[] = [];
  for (const key of allKeys) {
    const a = fromByKey.get(key) ?? null;
    const b = toByKey.get(key) ?? null;
    const label = a?.label ?? b?.label ?? key;

    let diffPath: string | null = null;
    let pixelDifference: number | null = null;
    let percentageDifference: number | null = null;
    let error: string | null = null;

    if (a && b) {
      const aFs = urlToFsPath(a.urlPath);
      const bFs = urlToFsPath(b.urlPath);
      if (!aFs || !bFs) {
        error = 'Screenshot path resolved outside storage root';
      } else if (!fs.existsSync(aFs) || !fs.existsSync(bFs)) {
        error = 'Screenshot file missing on disk';
      } else {
        try {
          const result = await generateDiff(aFs, bFs, STORAGE_DIRS.diffs);
          diffPath = toRelativePath(result.diffImagePath);
          pixelDifference = result.pixelDifference;
          percentageDifference = result.percentageDifference;
        } catch (e) {
          error = e instanceof Error ? e.message : String(e);
        }
      }
    }

    pairs.push({
      label,
      fromPath: a?.urlPath ?? null,
      toPath: b?.urlPath ?? null,
      diffPath,
      pixelDifference,
      percentageDifference,
      error,
    });
  }

  // Stable order: shots in both runs first (largest diff %), then one-sided.
  pairs.sort((x, y) => {
    const xBoth = x.fromPath && x.toPath ? 1 : 0;
    const yBoth = y.fromPath && y.toPath ? 1 : 0;
    if (xBoth !== yBoth) return yBoth - xBoth;
    const xPct = x.percentageDifference ?? -1;
    const yPct = y.percentageDifference ?? -1;
    if (xPct !== yPct) return yPct - xPct;
    return x.label.localeCompare(y.label);
  });

  const fromConsole = fromResult.consoleErrors ?? [];
  const toConsole = toResult.consoleErrors ?? [];
  const fromConsoleSet = new Set(fromConsole);
  const toConsoleSet = new Set(toConsole);
  const newConsoleErrors = toConsole.filter((m) => !fromConsoleSet.has(m));
  const resolvedConsoleErrors = fromConsole.filter((m) => !toConsoleSet.has(m));

  return {
    testId,
    fromResultId,
    toResultId,
    fromMeta: {
      runId: fromResult.testRunId,
      startedAt: fromRun?.startedAt ?? null,
      status: fromResult.status,
      durationMs: fromResult.durationMs,
      gitBranch: fromRun?.gitBranch ?? null,
      gitCommit: fromRun?.gitCommit ?? null,
      consoleErrorCount: fromConsole.length,
      networkRequestCount: fromResult.networkRequests?.length ?? 0,
      a11yViolationCount: fromResult.a11yViolations?.length ?? 0,
      errorMessage: fromResult.errorMessage,
    },
    toMeta: {
      runId: toResult.testRunId,
      startedAt: toRun?.startedAt ?? null,
      status: toResult.status,
      durationMs: toResult.durationMs,
      gitBranch: toRun?.gitBranch ?? null,
      gitCommit: toRun?.gitCommit ?? null,
      consoleErrorCount: toConsole.length,
      networkRequestCount: toResult.networkRequests?.length ?? 0,
      a11yViolationCount: toResult.a11yViolations?.length ?? 0,
      errorMessage: toResult.errorMessage,
    },
    pairs,
    newConsoleErrors,
    resolvedConsoleErrors,
  };
}
