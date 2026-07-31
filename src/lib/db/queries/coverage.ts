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
  testResults,
  testRuns,
  DEFAULT_COVERAGE_ENVIRONMENT,
  type CoverageCell,
  type CoverageCellStatus,
  type CoverageDimension,
  type NewCoverageCell,
  type NewCoverageDimension,
} from "../schema";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
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

export async function setCoverageDimensionEnabled(
  id: string,
  enabled: boolean,
): Promise<void> {
  await db
    .update(coverageDimensions)
    .set({ enabled, updatedAt: new Date() })
    .where(eq(coverageDimensions.id, id));
}

export async function deleteCoverageDimension(id: string): Promise<void> {
  await db.delete(coverageDimensions).where(eq(coverageDimensions.id, id));
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

export async function updateCoverageCellWeights(
  updates: Array<{
    id: string;
    weight: number;
    weightBreakdown?: CoverageCell["weightBreakdown"];
  }>,
): Promise<void> {
  const now = new Date();
  for (const u of updates) {
    await db
      .update(coverageCells)
      .set({
        weight: u.weight,
        weightBreakdown: u.weightBreakdown,
        updatedAt: now,
      })
      .where(eq(coverageCells.id, u.id));
  }
}

export async function setCoverageCellStatus(
  id: string,
  status: CoverageCellStatus,
  excludedReason?: string,
): Promise<void> {
  await db
    .update(coverageCells)
    .set({
      status,
      excludedReason: status === "excluded" ? (excludedReason ?? null) : null,
      updatedAt: new Date(),
    })
    .where(eq(coverageCells.id, id));
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
