/**
 * URL-Diff capture orchestrator.
 *
 * Claims an EB from the pool, queues a synthetic Playwright test that
 * navigates to a single URL, runs axe-core, captures network/DOM, and
 * persists the artefacts under `storage/url-diffs/<jobId>/<side>/`.
 *
 * Two parallel `captureUrl` invocations make up one URL Diff.
 */

import path from 'node:path';
import { promises as fs } from 'node:fs';
import { promisify } from 'node:util';

import { STORAGE_DIRS, STORAGE_ROOT } from '@/lib/storage/paths';
import {
  claimOrProvisionPoolEB,
  releasePoolEB,
} from '@/server/actions/embedded-sessions';
import { queueCommandToDB } from '@/app/api/ws/runner/route';
import {
  getUnacknowledgedResults,
  acknowledgeResults,
} from '@/lib/db/queries';
import type { A11yViolation, DomSnapshotData, WcagScoreSummary } from '@/lib/db/schema';
import { calculateWcagScore } from '@/lib/a11y/wcag-score';
import type { NetworkRequestLike } from '@/lib/diff/network-diff';

export type CaptureSide = 'a' | 'b';
export type PoolTier = 'build' | 'interactive';

export interface CaptureOptions {
  url: string;
  jobId: string;
  side: CaptureSide;
  viewport?: { width: number; height: number };
  poolTier?: PoolTier;
  /** Polling timeout in ms; defaults to 120s. */
  timeoutMs?: number;
}

export interface UrlCapture {
  url: string;
  side: CaptureSide;
  primaryHost: string;
  /** Relative URL path under storage root (e.g. `/url-diffs/<job>/<side>/screenshot.png`). */
  screenshotRelPath: string;
  /** Absolute disk path, used by buildUrlDiff to feed the visual engine. */
  screenshotAbsPath: string;
  domSnapshot: DomSnapshotData | null;
  networkRequests: NetworkRequestLike[];
  a11yViolations: A11yViolation[];
  a11yPassesCount: number;
  wcagScore: WcagScoreSummary;
  capturedAt: number;
  durationMs: number;
}

const sleep = promisify(setTimeout);

const MIN_HEALTHY_BASE64 = 7000; // ~5KB binary PNG floor
const POLL_INTERVAL_MS = 1000;
const DEFAULT_TIMEOUT_MS = 120_000;

const URL_DIFF_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/**
 * Build the synthetic Playwright test body sent to the EB. The EB executes
 * this as `export async function test(page) {...}`. axe-core is loaded at
 * runtime via `@axe-core/playwright`, which must be present in the EB image.
 */
export function buildSyntheticTestBody(targetUrl: string): string {
  const safeUrl = JSON.stringify(targetUrl);
  const tagsJson = JSON.stringify(URL_DIFF_TAGS);
  return `export async function test(page) {
  await page.goto(${safeUrl}, { waitUntil: 'load', timeout: 60000 });
  // Allow background fetches/animations to settle a hair before the captures.
  try { await page.waitForLoadState('networkidle', { timeout: 5000 }); } catch (e) { /* tolerate sites that never go idle */ }
  await page.screenshot({ fullPage: true });
  let accessibilityTree = null;
  try {
    accessibilityTree = await page.accessibility.snapshot({ interestingOnly: false });
  } catch (e) { /* best-effort */ }
  let axeResults = { violations: [], passes: [] };
  try {
    const mod = await import('@axe-core/playwright');
    const AxeBuilder = mod.default || mod.AxeBuilder || mod;
    axeResults = await new AxeBuilder({ page }).withTags(${tagsJson}).analyze();
  } catch (e) {
    /* axe-core unavailable — leave violations empty so capture still completes */
  }
  const harvest = {
    violations: (axeResults.violations || []).map((v) => ({
      id: v.id,
      impact: v.impact || 'moderate',
      description: v.description || '',
      help: v.help || '',
      helpUrl: v.helpUrl || '',
      nodes: Array.isArray(v.nodes) ? v.nodes.length : 0,
      tags: v.tags || [],
    })),
    passes: Array.isArray(axeResults.passes) ? axeResults.passes.length : 0,
    accessibilityTree,
  };
  await page.evaluate((data) => { window.__urlDiffResult = data; }, harvest);
}`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

async function ensureSideDir(jobId: string, side: CaptureSide): Promise<string> {
  const dir = path.join(STORAGE_DIRS['url-diffs'], jobId, side);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

interface ResultRow {
  id: string;
  type: string;
  payload: Record<string, unknown> | null;
}

async function pollForResults(commandId: string, timeoutMs: number): Promise<ResultRow[]> {
  const deadline = Date.now() + timeoutMs;
  let testResultRow: ResultRow | undefined;
  const screenshotRows: ResultRow[] = [];
  while (Date.now() < deadline) {
    const rows = (await getUnacknowledgedResults([commandId])) as unknown as ResultRow[];
    for (const row of rows) {
      if (row.type === 'response:test_result') testResultRow = row;
      if (row.type === 'response:screenshot') screenshotRows.push(row);
    }
    if (testResultRow) {
      // The screenshot uploads happen BEFORE the result message in EB index.ts,
      // so by the time we see the test_result row, all screenshot rows are
      // already inserted. One more fetch in case any landed late.
      const rows2 = (await getUnacknowledgedResults([commandId])) as unknown as ResultRow[];
      const ids = new Set(screenshotRows.map((r) => r.id));
      for (const row of rows2) {
        if (row.type === 'response:screenshot' && !ids.has(row.id)) {
          screenshotRows.push(row);
        }
      }
      return [testResultRow, ...screenshotRows];
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Capture timed out after ${timeoutMs}ms`);
}

/**
 * Capture one URL via the EB pool. Persists artefacts under
 * `storage/url-diffs/<jobId>/<side>/`. Throws on capacity, timeout,
 * blank-PNG, or hard EB error.
 */
export async function captureUrl(opts: CaptureOptions): Promise<UrlCapture> {
  const startedAt = Date.now();
  const viewport = opts.viewport ?? { width: 1280, height: 720 };
  const poolTier = opts.poolTier ?? 'interactive';
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const eb = await claimOrProvisionPoolEB({ purpose: poolTier });
  if (!eb) {
    throw new Error('EB unavailable: pool at capacity');
  }

  const commandId = crypto.randomUUID();
  const testId = `urldiff-${opts.side}`;
  const testRunId = `urldiff-${opts.jobId}-${opts.side}`;
  const code = buildSyntheticTestBody(opts.url);

  try {
    await queueCommandToDB(eb.runnerId, {
      id: commandId,
      type: 'command:run_test',
      timestamp: Date.now(),
      payload: {
        testId,
        testRunId,
        repositoryId: opts.jobId, // synthetic UUID-shaped namespace for screenshot dir
        code,
        codeHash: 'urldiff',
        targetUrl: opts.url,
        timeout: timeoutMs,
        viewport,
        enableA11y: true,
        enableNetworkInterception: false,
        consoleErrorMode: 'ignore',
        networkErrorMode: 'ignore',
        ignoreExternalNetworkErrors: true,
        acceptDownloads: false,
        stabilization: {
          freezeAnimations: true,
          freezeRandomValues: true,
          freezeTimestamps: true,
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const rows = await pollForResults(commandId, timeoutMs);
    await acknowledgeResults(rows.map((r) => r.id));

    const testResult = rows.find((r) => r.type === 'response:test_result');
    if (!testResult || !testResult.payload) {
      throw new Error('Capture produced no test result row');
    }
    const tp = testResult.payload as Record<string, unknown>;
    if (tp.status !== 'passed') {
      const errorObj = tp.error as { message?: string } | undefined;
      const msg = errorObj?.message || (tp.status as string) || 'unknown';
      throw new Error(`Capture failed (${tp.status}): ${msg}`);
    }

    const screenshotRows = rows.filter((r) => r.type === 'response:screenshot');
    if (screenshotRows.length === 0) {
      throw new Error('Capture produced no screenshot');
    }
    // Take the first screenshot row (synthetic body emits exactly one).
    const shotPayload = screenshotRows[0]!.payload as { path?: string; width?: number; height?: number } | null;
    const sourceRel = shotPayload?.path;
    if (!sourceRel) throw new Error('Screenshot result missing path');
    const sourceAbs = path.join(STORAGE_ROOT, sourceRel.replace(/^\/+/, ''));
    const stat = await fs.stat(sourceAbs);
    if (stat.size < MIN_HEALTHY_BASE64 * 0.75) {
      throw new Error('Capture produced suspicious blank screenshot');
    }

    const sideDir = await ensureSideDir(opts.jobId, opts.side);
    const destAbs = path.join(sideDir, 'screenshot.png');
    await fs.copyFile(sourceAbs, destAbs);

    const networkRequests = (Array.isArray(tp.networkRequests) ? tp.networkRequests : []) as NetworkRequestLike[];
    const domSnapshot = (tp.domSnapshot ?? null) as DomSnapshotData | null;
    const a11yViolations = (Array.isArray(tp.a11yViolations) ? tp.a11yViolations : []) as A11yViolation[];
    const a11yPassesCount = typeof tp.a11yPassesCount === 'number' ? tp.a11yPassesCount : 0;
    const accessibilityTree = tp.accessibilityTree ?? null;

    await Promise.all([
      fs.writeFile(path.join(sideDir, 'dom.json'), JSON.stringify(domSnapshot)),
      fs.writeFile(path.join(sideDir, 'network.json'), JSON.stringify(networkRequests)),
      fs.writeFile(
        path.join(sideDir, 'a11y.json'),
        JSON.stringify({ violations: a11yViolations, passesCount: a11yPassesCount }),
      ),
      fs.writeFile(path.join(sideDir, 'a11y-tree.json'), JSON.stringify(accessibilityTree)),
      fs.writeFile(
        path.join(sideDir, 'meta.json'),
        JSON.stringify({ url: opts.url, viewport, capturedAt: Date.now() }),
      ),
    ]);

    const wcagScore = calculateWcagScore(a11yViolations, a11yPassesCount);
    const relScreenshot = `/url-diffs/${opts.jobId}/${opts.side}/screenshot.png`;

    return {
      url: opts.url,
      side: opts.side,
      primaryHost: hostOf(opts.url),
      screenshotRelPath: relScreenshot,
      screenshotAbsPath: destAbs,
      domSnapshot,
      networkRequests,
      a11yViolations,
      a11yPassesCount,
      wcagScore,
      capturedAt: Date.now(),
      durationMs: Date.now() - startedAt,
    };
  } finally {
    await releasePoolEB(eb.runnerId).catch((err) => {
      console.warn(`[url-diff] releasePoolEB failed for ${eb.runnerId}:`, err);
    });
  }
}

/**
 * Reload a previously-captured snapshot from disk (used by /api/v1/diff
 * when the caller passes `snapshotIdA`/`snapshotIdB`).
 */
export async function loadCaptureFromDisk(
  jobOrSnapshotId: string,
  side: CaptureSide,
): Promise<UrlCapture | null> {
  const sideDir = path.join(STORAGE_DIRS['url-diffs'], jobOrSnapshotId, side);
  try {
    const meta = JSON.parse(await fs.readFile(path.join(sideDir, 'meta.json'), 'utf8')) as {
      url: string;
      capturedAt: number;
    };
    const dom = JSON.parse(await fs.readFile(path.join(sideDir, 'dom.json'), 'utf8')) as DomSnapshotData | null;
    const network = JSON.parse(await fs.readFile(path.join(sideDir, 'network.json'), 'utf8')) as NetworkRequestLike[];
    const a11y = JSON.parse(await fs.readFile(path.join(sideDir, 'a11y.json'), 'utf8')) as {
      violations: A11yViolation[];
      passesCount: number;
    };
    const screenshotAbsPath = path.join(sideDir, 'screenshot.png');
    await fs.access(screenshotAbsPath);
    return {
      url: meta.url,
      side,
      primaryHost: hostOf(meta.url),
      screenshotRelPath: `/url-diffs/${jobOrSnapshotId}/${side}/screenshot.png`,
      screenshotAbsPath,
      domSnapshot: dom,
      networkRequests: network,
      a11yViolations: a11y.violations,
      a11yPassesCount: a11y.passesCount,
      wcagScore: calculateWcagScore(a11y.violations, a11y.passesCount),
      capturedAt: meta.capturedAt,
      durationMs: 0,
    };
  } catch {
    return null;
  }
}
