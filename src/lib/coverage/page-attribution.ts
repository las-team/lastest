import "server-only";

import { canonicalPath } from "@lastest/url-canonical";
import { getCoverageCellRunTrajectories } from "@/lib/db/queries";

/**
 * Page-level coverage attribution — the join the merged Coverage screen is
 * built on.
 *
 * The data model already knows two things separately: which run exercised
 * which data cell (`coverage_cell_runs`), and which pages a run walked through
 * (`test_results.urlTrajectory`). Neither table knows the other's half, so
 * until now "which data combinations went through /checkout?" had no answer —
 * the App Map could only say a page had *some* test, and Coverage could only
 * say a cell had *some* run.
 *
 * Joining on the run closes that. A cell is attributed to a page when one run
 * both exercised the cell and visited the page, which is as strong a claim as
 * the recorded evidence supports: it is observed co-occurrence, not a promise
 * that the page is what validated the combination.
 *
 * ### What this deliberately cannot tell you
 *
 * Only *covered* cells can be attributed. An uncovered cell has no run, a run
 * is the only thing carrying a trajectory, so there is no page to attribute it
 * to. That asymmetry is real and the UI states it rather than papering over it
 * with a plausible-looking denominator — a "3 of 8 cells on this page" figure
 * would be inventing the 8.
 */

export interface PageCoverageEntry {
  /** Canonical path, matching the App Map node id. */
  path: string;
  /** Distinct cells exercised by a run that passed through this page. */
  cellCount: number;
  /** Sum of `observedCount` over those cells — records behind them. */
  records: number;
  /** How many of those cells last ran green here. */
  passedCells: number;
  failedCells: number;
  /** Dimension field -> values seen on this page, most-recent-run first. */
  valuesSeen: Record<string, string[]>;
  /** Object types whose cells were exercised here. */
  objectTypes: string[];
  lastRunAt: string | null;
}

export type PageCoverageMap = Record<string, PageCoverageEntry>;

/** Every canonical path a single run's trajectory touched, redirects included. */
function pathsInTrajectory(
  steps: Array<{ finalUrl: string; redirectChain: string[] }> | null,
): string[] {
  if (!steps || steps.length === 0) return [];
  const out = new Set<string>();
  for (const step of steps) {
    for (const raw of [step.finalUrl, ...(step.redirectChain ?? [])]) {
      // No base and no origin restriction: trajectory URLs are absolute and
      // already the app's own, and a restriction list here would silently drop
      // pages served from a second origin (auth hosts, checkout domains).
      const path = canonicalPath(raw, "", null);
      if (path) out.add(path);
    }
  }
  return [...out];
}

/**
 * Short-lived process-local memo of the attribution pass.
 *
 * The Coverage screen is `force-dynamic` and every mutation on it calls
 * `router.refresh()`, so switching tabs or excluding one cell re-ran the whole
 * attribution scan. The pass is a read model over data that only changes when
 * a build or a sync writes attributions, so both of those invalidate it
 * explicitly; the TTL is the backstop for writes from another process.
 */
const ATTRIBUTION_TTL_MS = 60_000;
const attributionCache = new Map<
  string,
  { at: number; value: PageCoverageMap }
>();

const cacheKey = (repositoryId: string, environmentKey?: string) =>
  `${repositoryId}::${environmentKey ?? ""}`;

/** Drop the memo for a repo. Called wherever attributions are written. */
export function invalidatePageCoverageAttribution(repositoryId: string): void {
  for (const key of attributionCache.keys()) {
    if (key.startsWith(`${repositoryId}::`)) attributionCache.delete(key);
  }
}

export async function buildPageCoverageAttribution(
  repositoryId: string,
  opts: { environmentKey?: string; limit?: number } = {},
): Promise<PageCoverageMap> {
  // Only the default read is memoized — a caller passing its own `limit` is
  // asking a different question and must not be served another one's answer.
  const memoKey =
    opts.limit === undefined
      ? cacheKey(repositoryId, opts.environmentKey)
      : null;
  if (memoKey) {
    const hit = attributionCache.get(memoKey);
    if (hit && Date.now() - hit.at < ATTRIBUTION_TTL_MS) return hit.value;
  }
  const rows = await getCoverageCellRunTrajectories(repositoryId, opts);

  // path -> cellId -> the best-known facts about that cell on that page.
  const byPath = new Map<
    string,
    Map<
      string,
      {
        records: number;
        verdict: string | null;
        coords: Record<string, string>;
        objectType: string;
        ranAt: Date | null;
      }
    >
  >();

  for (const row of rows) {
    const paths = pathsInTrajectory(row.urlTrajectory);
    if (paths.length === 0) continue;
    for (const path of paths) {
      let cells = byPath.get(path);
      if (!cells) {
        cells = new Map();
        byPath.set(path, cells);
      }
      const existing = cells.get(row.cellId);
      // Rows arrive newest-first, so the first sighting of a cell on a page is
      // its most recent run — later (older) rows must not overwrite the verdict.
      if (!existing) {
        cells.set(row.cellId, {
          records: row.observedCount,
          verdict: row.verdict,
          coords: row.coords,
          objectType: row.objectType,
          ranAt: row.ranAt,
        });
      }
    }
  }

  const out: PageCoverageMap = {};
  for (const [path, cells] of byPath) {
    let records = 0;
    let passedCells = 0;
    let failedCells = 0;
    let lastRunAt: Date | null = null;
    const valuesSeen: Record<string, Set<string>> = {};
    const objectTypes = new Set<string>();

    for (const cell of cells.values()) {
      records += cell.records;
      if (cell.verdict === "passed") passedCells += 1;
      if (cell.verdict === "failed") failedCells += 1;
      if (cell.ranAt && (!lastRunAt || cell.ranAt > lastRunAt)) {
        lastRunAt = cell.ranAt;
      }
      objectTypes.add(cell.objectType);
      for (const [field, value] of Object.entries(cell.coords)) {
        (valuesSeen[field] ??= new Set()).add(value);
      }
    }

    out[path] = {
      path,
      cellCount: cells.size,
      records,
      passedCells,
      failedCells,
      valuesSeen: Object.fromEntries(
        Object.entries(valuesSeen).map(([f, vs]) => [f, [...vs].sort()]),
      ),
      objectTypes: [...objectTypes].sort(),
      lastRunAt: lastRunAt ? lastRunAt.toISOString() : null,
    };
  }
  if (memoKey) attributionCache.set(memoKey, { at: Date.now(), value: out });
  return out;
}
