/**
 * Coverage trend — the movement, not the snapshot.
 *
 * `coverage_cells` is overwritten in place by every sync, so the ledger can
 * only ever answer "where are we now". A release regression programme is run
 * against the other question — "is this getting better, and since which build"
 * — and that needs points in time.
 *
 * Two ways a point gets written:
 *   - measured  — a sync or a completed build snapshots the model as it stands
 *   - backfill  — reconstructed from `coverage_cell_runs`, which already
 *                 records which run touched which cell, so history exists
 *                 even though nobody was writing snapshots yet
 *
 * A backfilled point is scored against TODAY's cell set and weights, because
 * the cell set it was actually measured against no longer exists. That makes
 * it "how much of the current model had been exercised by then" rather than a
 * measurement taken at the time, and every row carries `source` so the UI can
 * say which it is instead of implying a precision it does not have.
 */

import type { CoverageCell, CoverageDimension } from "@/lib/db/schema";
import {
  DEFAULT_COVERAGE_ENVIRONMENT,
  DEFAULT_COVERAGE_STOP_POLICY,
  type CoverageSnapshotObjectType,
  type CoverageSnapshotSource,
} from "@/lib/db/schema";
import * as queries from "@/lib/db/queries";
import {
  computeMetrics,
  type StopCell,
  isCovered,
} from "@lastest/coverage-model";

/** The numbers one snapshot row carries, independent of how they were sourced. */
export interface CoverageTotals {
  totalCells: number;
  coveredCells: number;
  excludedCells: number;
  failingCells: number;
  cellCoverage: number;
  tupleCoverage: number;
  weightedVolumeCoverage: number;
  byObjectType: CoverageSnapshotObjectType[];
}

/**
 * Roll a cell set up into snapshot totals.
 *
 * `coveredOverride` lets a reconstructed point say "these were the cells
 * covered as of build X" without mutating the ledger; when absent the cell's
 * own persisted status is used, which is what a live measurement wants.
 */
export function summarizeCoverage(
  cells: CoverageCell[],
  opts: {
    strength?: number;
    coveredCellIds?: ReadonlySet<string>;
    failingCellIds?: ReadonlySet<string>;
  } = {},
): CoverageTotals {
  const strength = opts.strength ?? DEFAULT_COVERAGE_STOP_POLICY.strength;
  const covered = (c: CoverageCell) =>
    opts.coveredCellIds ? opts.coveredCellIds.has(c.id) : isCovered(c);
  const failing = (c: CoverageCell) =>
    opts.failingCellIds
      ? opts.failingCellIds.has(c.id)
      : c.status === "failing";

  const toStop = (c: CoverageCell): StopCell => ({
    objectType: c.objectType,
    coordsKey: c.coordsKey,
    coords: c.coords,
    observedCount: c.observedCount,
    weight: c.weight,
    covered: covered(c),
    excluded: c.status === "excluded",
    excludedReason: c.excludedReason ?? undefined,
  });

  const metrics = computeMetrics(cells.map(toStop), strength);

  const objectTypes = [...new Set(cells.map((c) => c.objectType))].sort();
  const byObjectType: CoverageSnapshotObjectType[] = objectTypes.map((ot) => {
    const group = cells.filter((c) => c.objectType === ot);
    const eligible = group.filter((c) => c.status !== "excluded");
    const coveredCount = eligible.filter(covered).length;
    return {
      objectType: ot,
      totalCells: group.length,
      coveredCells: coveredCount,
      excludedCells: group.length - eligible.length,
      cellCoverage: eligible.length > 0 ? coveredCount / eligible.length : 0,
    };
  });

  return {
    totalCells: cells.length,
    coveredCells: metrics.coveredCells,
    excludedCells: metrics.excludedCells,
    failingCells: cells.filter(failing).length,
    cellCoverage:
      metrics.eligibleCells > 0
        ? metrics.coveredCells / metrics.eligibleCells
        : 0,
    tupleCoverage: metrics.tupleCoverage,
    weightedVolumeCoverage: metrics.weightedVolumeCoverage,
    byObjectType,
  };
}

/**
 * Snapshot the model as it currently stands.
 *
 * Best-effort by contract: coverage reporting must never be the reason a build
 * or a sync fails, so callers are expected to let this throw only into a catch.
 */
export async function captureCoverageSnapshot(
  repositoryId: string,
  opts: {
    environmentKey?: string;
    buildId?: string | null;
    source?: CoverageSnapshotSource;
    strength?: number;
    shouldStop?: boolean;
    capturedAt?: Date;
    /** Rows the caller already holds. `syncCoverage` calls this immediately
     *  after writing both tables and would otherwise re-read what it just
     *  wrote; a build hook has nothing in hand and omits them. Passing stale
     *  rows snapshots a stale model, so only a caller that just derived them
     *  should. */
    cells?: CoverageCell[];
    dimensions?: CoverageDimension[];
  } = {},
): Promise<CoverageTotals | null> {
  const environmentKey = opts.environmentKey ?? DEFAULT_COVERAGE_ENVIRONMENT;
  const strength = opts.strength ?? DEFAULT_COVERAGE_STOP_POLICY.strength;
  const [cells, dimensions] = await Promise.all([
    opts.cells ?? queries.getCoverageCells(repositoryId, { environmentKey }),
    opts.dimensions ??
      queries.getCoverageDimensions(repositoryId, environmentKey),
  ]);
  // No cells means no model. Writing a 0% point would render as a cliff on the
  // chart for a repo that simply never profiled anything.
  if (cells.length === 0) return null;

  const totals = summarizeCoverage(cells, { strength });
  await queries.recordCoverageSnapshot({
    repositoryId,
    environmentKey,
    buildId: opts.buildId ?? null,
    source: opts.source ?? "sync",
    capturedAt: opts.capturedAt ?? new Date(),
    strength,
    dimensionsEnabled: dimensions.filter((d) => d.enabled).length,
    shouldStop: opts.shouldStop ?? false,
    ...totals,
  });
  return totals;
}

export interface BackfillResult {
  buildsSeen: number;
  written: number;
  skippedExisting: number;
}

/**
 * Reconstruct the trend for builds that ran before snapshots existed.
 *
 * Coverage is cumulative: a cell stays covered once some build has exercised
 * it, so each point is "distinct cells touched up to and including this build"
 * — the same definition the live report uses, replayed over the ledger.
 *
 * Builds that already hold a snapshot are left alone. A measured point always
 * outranks a reconstructed one.
 */
export async function backfillCoverageSnapshots(
  repositoryId: string,
  opts: {
    environmentKey?: string;
    strength?: number;
    /** Only write the most recent N builds — the earlier ones are cumulative
     *  inputs, not points anyone reads. */
    maxBuilds?: number;
  } = {},
): Promise<BackfillResult> {
  const environmentKey = opts.environmentKey ?? DEFAULT_COVERAGE_ENVIRONMENT;
  const strength = opts.strength ?? DEFAULT_COVERAGE_STOP_POLICY.strength;
  const maxBuilds = opts.maxBuilds ?? queries.DEFAULT_BACKFILL_MAX_BUILDS;

  // Fast path. Reconstruction below reads the ENTIRE attribution timeline (up
  // to COVERAGE_TIMELINE_ROW_LIMIT rows) plus every cell and dimension, and
  // then rolls a summary up per build — all of it thrown away when every build
  // already holds a snapshot, which is the normal case on the second and every
  // later sync. One short-circuiting existence probe answers "is there
  // anything to write?" first.
  //
  // The probe is given the SAME window this call writes. Asked about the whole
  // ledger it would report a gap forever on any repo past `maxBuilds` builds —
  // the ones below `writeFrom` are walked but never written, so their gap is
  // permanent — and the fast path would never engage on the large repos it
  // exists for. Failing open (do the work) is the safe direction: a probe that
  // errors must not silently skip a real backfill.
  const hasGap = await queries
    .hasUnsnapshottedCoverageBuilds(repositoryId, environmentKey, { maxBuilds })
    .catch(() => true);
  if (!hasGap) {
    // Nothing was examined, so nothing is reported — `buildsSeen` counts what
    // this call actually walked, not what the ledger holds.
    return { buildsSeen: 0, written: 0, skippedExisting: 0 };
  }

  const [cells, dimensions, timeline, existing] = await Promise.all([
    queries.getCoverageCells(repositoryId, { environmentKey }),
    queries.getCoverageDimensions(repositoryId, environmentKey),
    queries.getCoverageAttributionTimeline(repositoryId, { environmentKey }),
    queries.getSnapshottedBuildIds(repositoryId, environmentKey),
  ]);
  if (cells.length === 0 || timeline.length === 0) {
    return { buildsSeen: 0, written: 0, skippedExisting: 0 };
  }

  // Group chronologically. The timeline is already ordered oldest first, so
  // first-seen order IS build order.
  const builds: Array<{
    buildId: string;
    at: Date | null;
    rows: typeof timeline;
  }> = [];
  const byId = new Map<string, (typeof builds)[number]>();
  for (const row of timeline) {
    let bucket = byId.get(row.buildId);
    if (!bucket) {
      bucket = { buildId: row.buildId, at: row.ranAt, rows: [] };
      byId.set(row.buildId, bucket);
      builds.push(bucket);
    }
    if (row.ranAt && (!bucket.at || row.ranAt > bucket.at))
      bucket.at = row.ranAt;
    bucket.rows.push(row);
  }

  const existingIds = new Set(existing);
  const writeFrom = Math.max(0, builds.length - maxBuilds);
  const dimensionsEnabled = dimensions.filter((d) => d.enabled).length;

  const coveredIds = new Set<string>();
  const lastVerdict = new Map<string, string | null>();
  let written = 0;
  let skippedExisting = 0;

  for (let i = 0; i < builds.length; i++) {
    const build = builds[i];
    for (const row of build.rows) {
      coveredIds.add(row.cellId);
      lastVerdict.set(row.cellId, row.verdict);
    }
    if (i < writeFrom) continue;
    if (existingIds.has(build.buildId)) {
      skippedExisting += 1;
      continue;
    }

    const failingIds = new Set(
      [...lastVerdict.entries()]
        .filter(([, v]) => v === "failed")
        .map(([id]) => id),
    );
    const totals = summarizeCoverage(cells, {
      strength,
      coveredCellIds: coveredIds,
      failingCellIds: failingIds,
    });
    await queries.recordCoverageSnapshot({
      repositoryId,
      environmentKey,
      buildId: build.buildId,
      source: "backfill",
      capturedAt: build.at ?? new Date(),
      strength,
      dimensionsEnabled,
      shouldStop: false,
      ...totals,
    });
    written += 1;
  }

  return { buildsSeen: builds.length, written, skippedExisting };
}
