/**
 * Data-driven coverage queries (P1 / D0).
 *
 * Dimensions, cells, and cell↔run attribution. Attribution is derived from
 * test_results.assignedVariables, which the executor already persists — so
 * historical coverage backfills without any change to test code.
 */

import { db } from "../index";
import {
  coverageCells,
  coverageCellRuns,
  coverageDimensions,
  coverageSnapshots,
  testResults,
  testRuns,
  DEFAULT_COVERAGE_ENVIRONMENT,
  type CoverageCell,
  type CoverageCellStatus,
  type CoverageDimension,
  type CoverageSnapshot,
  type CoverageSnapshotSource,
  type NewCoverageCell,
  type NewCoverageDimension,
  type NewCoverageSnapshot,
  type UrlTrajectoryStep,
} from "../schema";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  notInArray,
  sql,
} from "drizzle-orm";
import { v4 as uuid } from "uuid";

// ── Dimensions ──────────────────────────────────────────────────────────────

export async function getCoverageDimensions(
  repositoryId: string,
  environmentKey: string = DEFAULT_COVERAGE_ENVIRONMENT,
): Promise<CoverageDimension[]> {
  return db
    .select()
    .from(coverageDimensions)
    .where(
      and(
        eq(coverageDimensions.repositoryId, repositoryId),
        eq(coverageDimensions.environmentKey, environmentKey),
      ),
    );
}

/** Upsert on (repo, env, objectType, field). Preserves `enabled` on update —
 *  a re-profile must never silently re-enable a dimension the user turned off,
 *  or turn off one they confirmed. */
export async function upsertCoverageDimension(
  data: Omit<NewCoverageDimension, "id"> & { id?: string },
): Promise<void> {
  const now = new Date();
  await db
    .insert(coverageDimensions)
    .values({
      ...data,
      id: data.id ?? uuid(),
      environmentKey: data.environmentKey ?? DEFAULT_COVERAGE_ENVIRONMENT,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        coverageDimensions.repositoryId,
        coverageDimensions.environmentKey,
        coverageDimensions.objectType,
        coverageDimensions.field,
      ],
      set: {
        label: data.label,
        valueSource: data.valueSource,
        sourceAlias: data.sourceAlias,
        values: data.values,
        cardinality: data.cardinality,
        profiledAt: data.profiledAt ?? now,
        updatedAt: now,
      },
    });
}

/**
 * Enable/disable one dimension.
 *
 * Scoped by `repositoryId` as well as by id. The caller authorizes a
 * repository, so an update keyed on the id ALONE trusts a client-supplied
 * primary key across that boundary — anyone with access to any repo could
 * toggle any other tenant's dimension by guessing (or leaking) its uuid. There
 * is no RLS behind these tables; the WHERE clause is the enforcement.
 * Returns false when nothing matched, i.e. the row is not this repo's.
 */
export async function setCoverageDimensionEnabled(
  repositoryId: string,
  id: string,
  enabled: boolean,
): Promise<boolean> {
  const updated = await db
    .update(coverageDimensions)
    .set({ enabled, updatedAt: new Date() })
    .where(
      and(
        eq(coverageDimensions.id, id),
        eq(coverageDimensions.repositoryId, repositoryId),
      ),
    )
    .returning({ id: coverageDimensions.id });
  return updated.length > 0;
}

/** Repo-scoped for the same reason as `setCoverageDimensionEnabled`. */
export async function deleteCoverageDimension(
  repositoryId: string,
  id: string,
): Promise<boolean> {
  const deleted = await db
    .delete(coverageDimensions)
    .where(
      and(
        eq(coverageDimensions.id, id),
        eq(coverageDimensions.repositoryId, repositoryId),
      ),
    )
    .returning({ id: coverageDimensions.id });
  return deleted.length > 0;
}

/** Every (repo, environment) pair with at least one confirmed dimension —
 *  i.e. the repos that actually have a coverage model to keep fresh. A repo
 *  with only auto-proposed (disabled) dimensions has nothing to re-sync. */
export async function getReposWithEnabledCoverageDimensions(): Promise<
  Array<{ repositoryId: string; environmentKey: string }>
> {
  return db
    .selectDistinct({
      repositoryId: coverageDimensions.repositoryId,
      environmentKey: coverageDimensions.environmentKey,
    })
    .from(coverageDimensions)
    .where(eq(coverageDimensions.enabled, true));
}

// ── Cells ───────────────────────────────────────────────────────────────────

export async function getCoverageCells(
  repositoryId: string,
  opts: { environmentKey?: string; objectType?: string } = {},
): Promise<CoverageCell[]> {
  const conditions = [
    eq(coverageCells.repositoryId, repositoryId),
    eq(
      coverageCells.environmentKey,
      opts.environmentKey ?? DEFAULT_COVERAGE_ENVIRONMENT,
    ),
  ];
  if (opts.objectType) {
    conditions.push(eq(coverageCells.objectType, opts.objectType));
  }
  return db
    .select()
    .from(coverageCells)
    .where(and(...conditions))
    .orderBy(desc(coverageCells.weight));
}

/** Insert cells that do not exist yet; refresh observedCount on ones that do.
 *  Never clobbers status/run counters — those are owned by attribution. */
export async function upsertCoverageCells(
  cells: Array<Omit<NewCoverageCell, "id"> & { id?: string }>,
): Promise<number> {
  if (cells.length === 0) return 0;
  const now = new Date();
  const rows = cells.map((c) => ({
    ...c,
    id: c.id ?? uuid(),
    environmentKey: c.environmentKey ?? DEFAULT_COVERAGE_ENVIRONMENT,
    createdAt: now,
    updatedAt: now,
  }));

  // Chunked: a repo with a wide dimension set can produce thousands of cells,
  // and Postgres caps bind parameters per statement.
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db
      .insert(coverageCells)
      .values(rows.slice(i, i + CHUNK))
      .onConflictDoUpdate({
        target: [
          coverageCells.repositoryId,
          coverageCells.environmentKey,
          coverageCells.objectType,
          coverageCells.coordsKey,
        ],
        set: {
          observedCount: sql`excluded.observed_count`,
          updatedAt: now,
        },
      });
  }
  return rows.length;
}

/**
 * Persist recomputed weights.
 *
 * One statement per chunk, not one per cell. Weighting scores EVERY cell in
 * the model, so the awaited `UPDATE ... WHERE id = $1` loop this replaced cost
 * one network round trip per row — thousands of them, serially, inside the
 * serving process, and it was the longest stage of a coverage sync by a wide
 * margin. The chunked `UPDATE ... FROM (VALUES ...)` form does the same work
 * in one round trip per 500 rows.
 *
 * Every VALUES column is cast explicitly: bind parameters arrive with no type,
 * and Postgres infers a VALUES list's column types from its FIRST row only, so
 * an uncast list either fails outright or silently pins the wrong type.
 *
 * `has_breakdown` preserves the semantics of the drizzle `.set()` it replaced:
 * an OMITTED `weightBreakdown` leaves the stored breakdown alone, while an
 * explicit `null` clears it. Without the flag both collapse to NULL, which
 * would quietly wipe breakdowns for any caller that only wants to restate a
 * weight.
 */
export async function updateCoverageCellWeights(
  updates: Array<{
    id: string;
    weight: number;
    weightBreakdown?: CoverageCell["weightBreakdown"];
  }>,
): Promise<void> {
  if (updates.length === 0) return;
  // ISO-8601, matching what drizzle writes into these `timestamp` columns, so
  // updated_at stays comparable across the two write paths. NOW() would be the
  // database server's clock in its own timezone, which is not the same value.
  const now = new Date().toISOString();

  const CHUNK = 500;
  for (let i = 0; i < updates.length; i += CHUNK) {
    const rows = updates.slice(i, i + CHUNK).map((u) => {
      const hasBreakdown = "weightBreakdown" in u;
      const breakdown =
        hasBreakdown && u.weightBreakdown != null
          ? JSON.stringify(u.weightBreakdown)
          : null;
      return sql`(${u.id}::text, ${u.weight}::double precision, ${breakdown}::jsonb, ${hasBreakdown}::boolean)`;
    });
    await db.execute(sql`
      UPDATE coverage_cells AS c SET
        weight = v.weight,
        weight_breakdown = CASE
          WHEN v.has_breakdown THEN v.weight_breakdown
          ELSE c.weight_breakdown
        END,
        updated_at = ${now}::timestamp
      FROM (VALUES ${sql.join(rows, sql`, `)})
        AS v(id, weight, weight_breakdown, has_breakdown)
      WHERE c.id = v.id
    `);
  }
}

/** Repo-scoped: the caller authorizes a repository, never a bare cell id.
 *  See `setCoverageDimensionEnabled`. Returns false when nothing matched. */
export async function setCoverageCellStatus(
  repositoryId: string,
  id: string,
  status: CoverageCellStatus,
  excludedReason?: string,
): Promise<boolean> {
  const updated = await db
    .update(coverageCells)
    .set({
      status,
      excludedReason: status === "excluded" ? (excludedReason ?? null) : null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(coverageCells.id, id),
        eq(coverageCells.repositoryId, repositoryId),
      ),
    )
    .returning({ id: coverageCells.id });
  return updated.length > 0;
}

/**
 * Drop cells of an object type that are no longer in the derived set.
 *
 * Two things make a cell stale: the enabled dimension set changed (so its
 * coordinates span the wrong fields), or a data refresh means the combination
 * no longer occurs. Both must vacate — a leftover cell inflates the coverage
 * denominator forever and silently corrupts every percentage downstream.
 *
 * Attribution rows cascade away with the cell. That is correct: a combination
 * that no longer exists in the data has no coverage to account for.
 */
export async function pruneCoverageCells(
  repositoryId: string,
  environmentKey: string,
  objectType: string,
  keepCoordsKeys: string[],
): Promise<number> {
  const conditions = [
    eq(coverageCells.repositoryId, repositoryId),
    eq(coverageCells.environmentKey, environmentKey),
    eq(coverageCells.objectType, objectType),
  ];
  if (keepCoordsKeys.length > 0) {
    conditions.push(notInArray(coverageCells.coordsKey, keepCoordsKeys));
  }
  const deleted = await db
    .delete(coverageCells)
    .where(and(...conditions))
    .returning({ id: coverageCells.id });
  return deleted.length;
}

/** Object types that currently have cells — needed to prune object types whose
 *  dimensions were all disabled, which derivation no longer visits at all. */
export async function getCoverageCellObjectTypes(
  repositoryId: string,
  environmentKey: string = DEFAULT_COVERAGE_ENVIRONMENT,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ objectType: coverageCells.objectType })
    .from(coverageCells)
    .where(
      and(
        eq(coverageCells.repositoryId, repositoryId),
        eq(coverageCells.environmentKey, environmentKey),
      ),
    );
  return rows.map((r) => r.objectType);
}

export async function deleteCoverageCellsByRepo(
  repositoryId: string,
  environmentKey: string = DEFAULT_COVERAGE_ENVIRONMENT,
): Promise<void> {
  await db
    .delete(coverageCells)
    .where(
      and(
        eq(coverageCells.repositoryId, repositoryId),
        eq(coverageCells.environmentKey, environmentKey),
      ),
    );
}

// ── Attribution ─────────────────────────────────────────────────────────────

export interface AssignedVariableRun {
  testResultId: string;
  testId: string | null;
  buildId: string | null;
  status: string | null;
  ranAt: Date | null;
  assignedVariables: Record<string, string>;
}

/**
 * Every historical run that carries a resolved assign-mode variable map.
 * This is the raw material for both dimension profiling and cell attribution —
 * no new instrumentation, just data already on the row.
 */
export async function getAssignedVariableRuns(
  repositoryId: string,
  opts: { limit?: number } = {},
): Promise<AssignedVariableRun[]> {
  const rows = await db
    .select({
      testResultId: testResults.id,
      testId: testResults.testId,
      buildId: testRuns.id,
      status: testResults.status,
      ranAt: testRuns.startedAt,
      assignedVariables: testResults.assignedVariables,
    })
    .from(testResults)
    .innerJoin(testRuns, eq(testResults.testRunId, testRuns.id))
    .where(
      and(
        eq(testRuns.repositoryId, repositoryId),
        sql`${testResults.assignedVariables} IS NOT NULL`,
        sql`${testResults.assignedVariables} <> '{}'::jsonb`,
      ),
    )
    .orderBy(desc(testRuns.startedAt))
    .limit(opts.limit ?? 20000);

  return rows
    .filter(
      (r) => r.assignedVariables && Object.keys(r.assignedVariables).length > 0,
    )
    .map((r) => ({
      ...r,
      assignedVariables: r.assignedVariables as Record<string, string>,
    }));
}

/**
 * Results of one run that carry a matrix data-cell coordinate.
 *
 * Matrix runs record their cell on the row directly, and never in
 * `assignedVariables` — so the historical-scan attribution path cannot see
 * them. This is what the build-completion hook attributes from.
 */
export async function getDataCellResults(testRunId: string): Promise<
  Array<{
    testResultId: string;
    testId: string | null;
    buildId: string | null;
    dataCell: string | null;
    status: string | null;
    ranAt: Date | null;
  }>
> {
  const rows = await db
    .select({
      testResultId: testResults.id,
      testId: testResults.testId,
      buildId: testRuns.id,
      dataCell: testResults.dataCell,
      status: testResults.status,
      ranAt: testRuns.startedAt,
    })
    .from(testResults)
    .innerJoin(testRuns, eq(testResults.testRunId, testRuns.id))
    .where(
      and(
        eq(testResults.testRunId, testRunId),
        sql`${testResults.dataCell} IS NOT NULL`,
      ),
    );
  return rows;
}

/** How many (cell, run) attributions the page-attribution pass reads.
 *  A ceiling on a reporting read, not a correctness boundary: the pass keeps
 *  only the newest sighting of each cell on each page, and the rows arrive
 *  newest-first, so a cut tail can only omit older evidence. */
export const DEFAULT_TRAJECTORY_ATTRIBUTION_LIMIT = 5000;

/**
 * Every recorded cell↔run pairing that also carries a URL trajectory.
 *
 * The raw material for page-level attribution: `coverage_cell_runs` says which
 * run exercised which cell, and `test_results.urlTrajectory` says which pages
 * that same run walked through. Joining them on the run is what lets the
 * Coverage canvas answer "which data cells went through *this* page" — a
 * question neither the cell table nor the app map can answer alone.
 *
 * Deliberately not filtered by verdict: a failing run still exercised the
 * combination on that page, and hiding it would overstate the gap.
 */
export async function getCoverageCellRunTrajectories(
  repositoryId: string,
  opts: { environmentKey?: string; limit?: number } = {},
): Promise<
  Array<{
    cellId: string;
    coordsKey: string;
    objectType: string;
    coords: Record<string, string>;
    observedCount: number;
    verdict: string | null;
    ranAt: Date | null;
    urlTrajectory: UrlTrajectoryStep[] | null;
  }>
> {
  // Two queries, not one join, and deliberately so. A trajectory is a jsonb
  // document per RUN, but attribution rows are (cell x run): the single-join
  // version shipped the same document back once per cell the run touched, so a
  // run covering 30 cells transferred and parsed its trajectory 30 times. The
  // pairs are narrow; the documents are fetched once each.
  const pairs = await db
    .select({
      cellId: coverageCells.id,
      coordsKey: coverageCells.coordsKey,
      objectType: coverageCells.objectType,
      coords: coverageCells.coords,
      observedCount: coverageCells.observedCount,
      verdict: coverageCellRuns.verdict,
      ranAt: coverageCellRuns.ranAt,
      testResultId: coverageCellRuns.testResultId,
    })
    .from(coverageCellRuns)
    .innerJoin(coverageCells, eq(coverageCellRuns.cellId, coverageCells.id))
    .where(
      and(
        eq(coverageCells.repositoryId, repositoryId),
        eq(
          coverageCells.environmentKey,
          opts.environmentKey ?? DEFAULT_COVERAGE_ENVIRONMENT,
        ),
      ),
    )
    .orderBy(desc(coverageCellRuns.ranAt))
    .limit(opts.limit ?? DEFAULT_TRAJECTORY_ATTRIBUTION_LIMIT);

  const resultIds = [...new Set(pairs.map((p) => p.testResultId))];
  const trajectories = new Map<string, UrlTrajectoryStep[]>();
  const CHUNK = 500;
  for (let i = 0; i < resultIds.length; i += CHUNK) {
    const rows = await db
      .select({
        id: testResults.id,
        urlTrajectory: testResults.urlTrajectory,
      })
      .from(testResults)
      .where(
        and(
          inArray(testResults.id, resultIds.slice(i, i + CHUNK)),
          isNotNull(testResults.urlTrajectory),
        ),
      );
    for (const r of rows) {
      if (r.urlTrajectory) trajectories.set(r.id, r.urlTrajectory);
    }
  }

  // Runs with no recorded trajectory can be attributed to no page, exactly as
  // the inner join used to drop them.
  return pairs
    .filter((p) => trajectories.has(p.testResultId))
    .map(({ testResultId, ...p }) => ({
      ...p,
      urlTrajectory: trajectories.get(testResultId) ?? null,
    }));
}

/** Record cell↔run attribution. Idempotent per (cell, testResult). */
export async function recordCoverageCellRuns(
  runs: Array<{
    cellId: string;
    testResultId: string;
    testId?: string | null;
    buildId?: string | null;
    verdict?: string | null;
    ranAt?: Date | null;
  }>,
): Promise<number> {
  if (runs.length === 0) return 0;
  const CHUNK = 500;
  for (let i = 0; i < runs.length; i += CHUNK) {
    await db
      .insert(coverageCellRuns)
      .values(
        runs.slice(i, i + CHUNK).map((r) => ({
          ...r,
          id: uuid(),
          recordedAt: new Date(),
        })),
      )
      .onConflictDoNothing({
        target: [coverageCellRuns.cellId, coverageCellRuns.testResultId],
      });
  }
  return runs.length;
}

/**
 * Recompute run/pass/fail counters and status from the attribution table.
 * Derived rather than incremented, so a partial backfill can be re-run safely.
 */
export async function refreshCoverageCellStats(
  repositoryId: string,
  environmentKey: string = DEFAULT_COVERAGE_ENVIRONMENT,
): Promise<void> {
  await db.execute(sql`
    UPDATE coverage_cells c SET
      run_count    = COALESCE(s.run_count, 0),
      pass_count   = COALESCE(s.pass_count, 0),
      fail_count   = COALESCE(s.fail_count, 0),
      last_run_at  = s.last_run_at,
      last_verdict = s.last_verdict,
      status = CASE
        WHEN c.status = 'excluded' THEN 'excluded'
        WHEN COALESCE(s.run_count, 0) = 0 THEN
          CASE WHEN c.status = 'planned' THEN 'planned' ELSE 'uncovered' END
        WHEN s.last_verdict = 'failed' THEN 'failing'
        ELSE 'covered'
      END,
      updated_at = NOW()
    FROM (
      SELECT
        r.cell_id,
        COUNT(*)                                          AS run_count,
        COUNT(*) FILTER (WHERE r.verdict = 'passed')      AS pass_count,
        COUNT(*) FILTER (WHERE r.verdict = 'failed')      AS fail_count,
        MAX(r.ran_at)                                     AS last_run_at,
        (ARRAY_AGG(r.verdict ORDER BY r.ran_at DESC NULLS LAST))[1] AS last_verdict
      FROM coverage_cell_runs r
      GROUP BY r.cell_id
    ) s
    WHERE s.cell_id = c.id
      AND c.repository_id = ${repositoryId}
      AND c.environment_key = ${environmentKey}
  `);

  // Cells with no attribution at all are not touched by the join above.
  await db
    .update(coverageCells)
    .set({ runCount: 0, passCount: 0, failCount: 0 })
    .where(
      and(
        eq(coverageCells.repositoryId, repositoryId),
        eq(coverageCells.environmentKey, environmentKey),
        sql`NOT EXISTS (SELECT 1 FROM coverage_cell_runs r WHERE r.cell_id = ${coverageCells.id})`,
      ),
    );
}

// ── Snapshots (trend) ───────────────────────────────────────────────────────

/**
 * Persist one point on the trend line.
 *
 * Build-scoped snapshots upsert on (repo, env, buildId): the build hook and a
 * later backfill both describe the same build, and a trend that double-counts
 * builds is worse than no trend. Sync snapshots carry a NULL buildId, which
 * Postgres treats as distinct, so each sync appends its own point.
 */
export async function recordCoverageSnapshot(
  data: Omit<NewCoverageSnapshot, "id" | "capturedAt"> & {
    id?: string;
    capturedAt?: Date;
  },
): Promise<void> {
  const now = new Date();
  const row = {
    ...data,
    id: data.id ?? uuid(),
    environmentKey: data.environmentKey ?? DEFAULT_COVERAGE_ENVIRONMENT,
    capturedAt: data.capturedAt ?? now,
    createdAt: now,
  };
  if (!row.buildId) {
    await db.insert(coverageSnapshots).values(row);
    return;
  }
  await db
    .insert(coverageSnapshots)
    .values(row)
    .onConflictDoUpdate({
      target: [
        coverageSnapshots.repositoryId,
        coverageSnapshots.environmentKey,
        coverageSnapshots.buildId,
      ],
      set: {
        source: row.source,
        capturedAt: row.capturedAt,
        totalCells: row.totalCells,
        coveredCells: row.coveredCells,
        excludedCells: row.excludedCells,
        failingCells: row.failingCells,
        cellCoverage: row.cellCoverage,
        tupleCoverage: row.tupleCoverage,
        weightedVolumeCoverage: row.weightedVolumeCoverage,
        dimensionsEnabled: row.dimensionsEnabled,
        strength: row.strength,
        shouldStop: row.shouldStop,
        byObjectType: row.byObjectType,
      },
    });
}

/** Trend, oldest first — the order a chart plots in. */
export async function getCoverageTrend(
  repositoryId: string,
  opts: { environmentKey?: string; limit?: number } = {},
): Promise<CoverageSnapshot[]> {
  const rows = await db
    .select()
    .from(coverageSnapshots)
    .where(
      and(
        eq(coverageSnapshots.repositoryId, repositoryId),
        eq(
          coverageSnapshots.environmentKey,
          opts.environmentKey ?? DEFAULT_COVERAGE_ENVIRONMENT,
        ),
      ),
    )
    .orderBy(desc(coverageSnapshots.capturedAt))
    .limit(opts.limit ?? 100);
  return rows.reverse();
}

/**
 * The most recent snapshot, optionally restricted to how it was produced.
 *
 * `source` matters for freshness: a build writes a snapshot on every run, and
 * a build snapshot measures today's cell set — it does NOT re-profile the data
 * sources. Treating one as "the model was synced then" meant any repo building
 * more often than the staleness window never re-profiled at all, so a new CSV
 * column or a changed value domain stayed invisible indefinitely. Callers
 * asking "when was this model last DERIVED" must pass `source: "sync"`.
 */
export async function getLatestCoverageSnapshot(
  repositoryId: string,
  environmentKey: string = DEFAULT_COVERAGE_ENVIRONMENT,
  opts: { source?: CoverageSnapshotSource } = {},
): Promise<CoverageSnapshot | null> {
  const conditions = [
    eq(coverageSnapshots.repositoryId, repositoryId),
    eq(coverageSnapshots.environmentKey, environmentKey),
  ];
  if (opts.source) {
    conditions.push(eq(coverageSnapshots.source, opts.source));
  }
  const [row] = await db
    .select()
    .from(coverageSnapshots)
    .where(and(...conditions))
    .orderBy(desc(coverageSnapshots.capturedAt))
    .limit(1);
  return row ?? null;
}

/** Builds that already have a snapshot — so a backfill only reconstructs what
 *  is missing instead of rewriting measured history. */
export async function getSnapshottedBuildIds(
  repositoryId: string,
  environmentKey: string = DEFAULT_COVERAGE_ENVIRONMENT,
): Promise<string[]> {
  const rows = await db
    .select({ buildId: coverageSnapshots.buildId })
    .from(coverageSnapshots)
    .where(
      and(
        eq(coverageSnapshots.repositoryId, repositoryId),
        eq(coverageSnapshots.environmentKey, environmentKey),
        sql`${coverageSnapshots.buildId} IS NOT NULL`,
      ),
    );
  return rows.map((r) => r.buildId!).filter(Boolean);
}

/**
 * How many of the most-recent attributed builds a backfill actually writes.
 *
 * Owned here rather than in `backfillCoverageSnapshots` so that the write
 * window and the probe gating it read the same number. They must agree: a
 * probe that asks about a wider window than the backfill ever writes reports
 * a gap forever on any repo holding more builds than the window — which is
 * exactly the large repo the gate was added to spare.
 */
export const DEFAULT_BACKFILL_MAX_BUILDS = 200;

/** Attribution rows one timeline read returns. See
 *  `getCoverageAttributionTimeline`. */
export const COVERAGE_TIMELINE_ROW_LIMIT = 50000;

/**
 * Among the `maxBuilds` most-recent attributed builds, is any one missing its
 * snapshot?
 *
 * The cheap gate in front of `backfillCoverageSnapshots`, which otherwise
 * loads the whole attribution timeline, every cell and every dimension just to
 * discover there is nothing to reconstruct — the normal outcome on every sync
 * after the first.
 *
 * Windowed deliberately, and to the same window: the backfill writes points
 * only for the newest `maxBuilds` builds, walking everything older purely as
 * cumulative input. Asking about *any* un-snapshotted build therefore answered
 * "yes" permanently once a repo passed 200 attributed builds, since the ones
 * beyond the window are never going to be written — the fast path switched
 * itself off on precisely the repos it was for.
 *
 * Ordering matches the backfill's notion of "newest": max `ran_at` per build,
 * descending, nulls first. `getCoverageAttributionTimeline` orders rows
 * `ran_at ASC` (Postgres puts nulls last), so a build with no `ran_at` at all
 * lands at the end of the timeline — the newest end — and must sort first here.
 *
 * The window also stays inside what the backfill can see: `maxBuilds` (200)
 * builds is far below the timeline's `COVERAGE_TIMELINE_ROW_LIMIT` rows, so on
 * any ledger the backfill reads whole, the two sets are identical.
 *
 * One round trip; the outer `LIMIT 1` lets Postgres stop at the first gap.
 */
export async function hasUnsnapshottedCoverageBuilds(
  repositoryId: string,
  environmentKey: string = DEFAULT_COVERAGE_ENVIRONMENT,
  opts: { maxBuilds?: number } = {},
): Promise<boolean> {
  const maxBuilds = opts.maxBuilds ?? DEFAULT_BACKFILL_MAX_BUILDS;

  const recent = db
    .select({ buildId: coverageCellRuns.buildId })
    .from(coverageCellRuns)
    .innerJoin(coverageCells, eq(coverageCellRuns.cellId, coverageCells.id))
    .where(
      and(
        eq(coverageCells.repositoryId, repositoryId),
        eq(coverageCells.environmentKey, environmentKey),
        isNotNull(coverageCellRuns.buildId),
      ),
    )
    .groupBy(coverageCellRuns.buildId)
    .orderBy(sql`max(${coverageCellRuns.ranAt}) desc nulls first`)
    .limit(maxBuilds)
    .as("recent");

  const rows = await db
    .select({ buildId: recent.buildId })
    .from(recent)
    .where(
      sql`NOT EXISTS (
        SELECT 1 FROM ${coverageSnapshots} s
        WHERE s.repository_id = ${repositoryId}
          AND s.environment_key = ${environmentKey}
          AND s.build_id = ${recent.buildId}
      )`,
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Every attribution this repo holds, oldest first, with the build that
 * produced it. This is the raw material the trend is reconstructed from — the
 * ledger already records which run touched which cell, so history exists even
 * though nobody was writing snapshots yet.
 */
export async function getCoverageAttributionTimeline(
  repositoryId: string,
  opts: { environmentKey?: string; limit?: number } = {},
): Promise<
  Array<{
    cellId: string;
    buildId: string;
    ranAt: Date | null;
    verdict: string | null;
  }>
> {
  const rows = await db
    .select({
      cellId: coverageCellRuns.cellId,
      buildId: coverageCellRuns.buildId,
      ranAt: coverageCellRuns.ranAt,
      verdict: coverageCellRuns.verdict,
      recordedAt: coverageCellRuns.recordedAt,
    })
    .from(coverageCellRuns)
    .innerJoin(coverageCells, eq(coverageCellRuns.cellId, coverageCells.id))
    .where(
      and(
        eq(coverageCells.repositoryId, repositoryId),
        eq(
          coverageCells.environmentKey,
          opts.environmentKey ?? DEFAULT_COVERAGE_ENVIRONMENT,
        ),
        sql`${coverageCellRuns.buildId} IS NOT NULL`,
      ),
    )
    .orderBy(asc(coverageCellRuns.ranAt), asc(coverageCellRuns.recordedAt))
    .limit(opts.limit ?? COVERAGE_TIMELINE_ROW_LIMIT);

  return rows.map((r) => ({
    cellId: r.cellId,
    buildId: r.buildId!,
    // ranAt is nullable on the ledger; recordedAt is not, and is the honest
    // fallback for ordering a point on the trend.
    ranAt: r.ranAt ?? r.recordedAt ?? null,
    verdict: r.verdict,
  }));
}

export async function getCoverageCellsByKeys(
  repositoryId: string,
  environmentKey: string,
  objectType: string,
  keys: string[],
): Promise<CoverageCell[]> {
  if (keys.length === 0) return [];
  return db
    .select()
    .from(coverageCells)
    .where(
      and(
        eq(coverageCells.repositoryId, repositoryId),
        eq(coverageCells.environmentKey, environmentKey),
        eq(coverageCells.objectType, objectType),
        inArray(coverageCells.coordsKey, keys),
      ),
    );
}
