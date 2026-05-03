import { db } from '../index';
import {
  builds,
  testRuns,
  testResults,
  tests,
  testVersions,
  visualDiffs,
  functionalAreas,
} from '../schema';
import type {
  NewBuild,
  BuildStatus,
} from '../schema';
import { eq, desc, and, inArray, sql } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

// Builds
export async function getBuilds(limit = 10) {
  return db.select().from(builds).orderBy(desc(builds.createdAt)).limit(limit);
}

export async function getBuild(id: string) {
  const [row] = await db.select().from(builds).where(eq(builds.id, id));
  return row;
}

export async function getBuildByTestRun(testRunId: string) {
  const [row] = await db.select().from(builds).where(eq(builds.testRunId, testRunId));
  return row;
}

export async function getBuildsByComparisonPairId(pairId: string) {
  return db.select().from(builds).where(eq(builds.comparisonPairId, pairId)).orderBy(builds.createdAt);
}

export async function createBuild(data: Omit<NewBuild, 'id'>) {
  const id = uuid();
  const [row] = await db
    .insert(builds)
    .values({ ...data, id, createdAt: new Date() })
    .returning();
  return row;
}

export async function updateBuild(id: string, data: Partial<NewBuild>) {
  await db.update(builds).set(data).where(eq(builds.id, id));
}

export async function getRecentBuilds(limit = 5) {
  return db.select().from(builds).orderBy(desc(builds.createdAt)).limit(limit);
}

export async function getBuildsByRepo(repositoryId: string, limit = 10) {
  return db
    .select({
      id: builds.id,
      testRunId: builds.testRunId,
      pullRequestId: builds.pullRequestId,
      triggerType: builds.triggerType,
      overallStatus: builds.overallStatus,
      totalTests: builds.totalTests,
      changesDetected: builds.changesDetected,
      flakyCount: builds.flakyCount,
      failedCount: builds.failedCount,
      passedCount: builds.passedCount,
      baseUrl: builds.baseUrl,
      elapsedMs: builds.elapsedMs,
      createdAt: builds.createdAt,
      completedAt: builds.completedAt,
      buildSetupTestId: builds.buildSetupTestId,
      buildSetupScriptId: builds.buildSetupScriptId,
      setupStatus: builds.setupStatus,
      setupError: builds.setupError,
      setupDurationMs: builds.setupDurationMs,
      teardownStatus: builds.teardownStatus,
      teardownError: builds.teardownError,
      teardownDurationMs: builds.teardownDurationMs,
      comparisonMode: builds.comparisonMode,
      codeChangeTestIds: builds.codeChangeTestIds,
      browsers: builds.browsers,
      comparisonPairId: builds.comparisonPairId,
      comparisonRole: builds.comparisonRole,
      comparisonMeta: builds.comparisonMeta,
      scheduleId: builds.scheduleId,
      a11yScore: builds.a11yScore,
      a11yViolationCount: builds.a11yViolationCount,
      a11yCriticalCount: builds.a11yCriticalCount,
      a11yTotalRulesChecked: builds.a11yTotalRulesChecked,
      executorError: builds.executorError,
      executorFailedAt: builds.executorFailedAt,
      gitBranch: testRuns.gitBranch,
      gitCommit: testRuns.gitCommit,
    })
    .from(builds)
    .innerJoin(testRuns, eq(builds.testRunId, testRuns.id))
    .where(eq(testRuns.repositoryId, repositoryId))
    .orderBy(desc(builds.createdAt))
    .limit(limit)
    ;
}

export async function getLastBuildByBranch(repositoryId: string, branch: string) {
  const [row] = await db
    .select({
      id: builds.id,
      testRunId: builds.testRunId,
      pullRequestId: builds.pullRequestId,
      triggerType: builds.triggerType,
      overallStatus: builds.overallStatus,
      totalTests: builds.totalTests,
      changesDetected: builds.changesDetected,
      flakyCount: builds.flakyCount,
      failedCount: builds.failedCount,
      passedCount: builds.passedCount,
      baseUrl: builds.baseUrl,
      elapsedMs: builds.elapsedMs,
      createdAt: builds.createdAt,
      completedAt: builds.completedAt,
      gitBranch: testRuns.gitBranch,
      gitCommit: testRuns.gitCommit,
    })
    .from(builds)
    .innerJoin(testRuns, eq(builds.testRunId, testRuns.id))
    .where(and(
      eq(testRuns.repositoryId, repositoryId),
      eq(testRuns.gitBranch, branch)
    ))
    .orderBy(desc(builds.createdAt))
    .limit(1);
  return row;
}

export async function getBuildTestSummaries(buildId: string) {
  const rows = await db
    .select({
      testId: testResults.testId,
      testName: tests.name,
      functionalAreaName: functionalAreas.name,
      testVersionId: testResults.testVersionId,
      versionNumber: testVersions.version,
      versionReason: testVersions.changeReason,
      status: testResults.status,
    })
    .from(testResults)
    .innerJoin(builds, eq(builds.testRunId, testResults.testRunId))
    .leftJoin(tests, eq(testResults.testId, tests.id))
    .leftJoin(testVersions, eq(testResults.testVersionId, testVersions.id))
    .leftJoin(functionalAreas, eq(tests.functionalAreaId, functionalAreas.id))
    .where(eq(builds.id, buildId))
    ;

  // Get avg diff % per test from visualDiffs
  const diffs = await db
    .select({
      testId: visualDiffs.testId,
      percentageDifference: visualDiffs.percentageDifference,
    })
    .from(visualDiffs)
    .where(eq(visualDiffs.buildId, buildId))
    ;

  const diffMap = new Map<string, number[]>();
  for (const d of diffs) {
    if (!d.testId) continue;
    const pct = typeof d.percentageDifference === 'string'
      ? parseFloat(d.percentageDifference)
      : (d.percentageDifference ?? 0);
    if (!diffMap.has(d.testId)) diffMap.set(d.testId, []);
    diffMap.get(d.testId)!.push(isNaN(pct) ? 0 : pct);
  }

  // For tests without a testVersionId (ran with current code), resolve the latest version number
  const testIdsNeedingLatest = rows
    .filter(r => !r.testVersionId && r.testId)
    .map(r => r.testId!);

  const latestVersionMap = new Map<string, number>();
  if (testIdsNeedingLatest.length > 0) {
    const latestVersions = await db
      .select({
        testId: testVersions.testId,
        maxVersion: sql<number>`max(${testVersions.version})`,
      })
      .from(testVersions)
      .where(inArray(testVersions.testId, testIdsNeedingLatest))
      .groupBy(testVersions.testId)
      ;
    for (const v of latestVersions) {
      latestVersionMap.set(v.testId, v.maxVersion);
    }
  }

  // Also build a set of all max versions to tag "isLatest"
  const allTestIds = rows.filter(r => r.testId).map(r => r.testId!);
  const allMaxVersions = new Map<string, number>();
  if (allTestIds.length > 0) {
    const maxRows = await db
      .select({
        testId: testVersions.testId,
        maxVersion: sql<number>`max(${testVersions.version})`,
      })
      .from(testVersions)
      .where(inArray(testVersions.testId, allTestIds))
      .groupBy(testVersions.testId)
      ;
    for (const v of maxRows) {
      allMaxVersions.set(v.testId, v.maxVersion);
    }
  }

  return rows.map(r => {
    const resolvedVersion = r.versionNumber ?? (r.testId ? latestVersionMap.get(r.testId) ?? null : null);
    const maxVersion = r.testId ? allMaxVersions.get(r.testId) ?? null : null;

    return {
      ...r,
      versionNumber: resolvedVersion,
      isLatest: resolvedVersion !== null && maxVersion !== null && resolvedVersion === maxVersion,
      avgDiffPct: (() => {
        const vals = r.testId ? diffMap.get(r.testId) : undefined;
        if (!vals || vals.length === 0) return null;
        return vals.reduce((a, b) => a + b, 0) / vals.length;
      })(),
    };
  });
}


// Build Summary helpers
export async function computeBuildStatus(buildId: string): Promise<BuildStatus> {
  // Preserve sticky `executor_failed` — that status is set explicitly by
  // runBuildAsync's catch block when no per-test results landed and must not
  // be overwritten by diff-driven recompute.
  const [buildRow] = await db
    .select({ overallStatus: builds.overallStatus })
    .from(builds)
    .where(eq(builds.id, buildId));
  if (buildRow?.overallStatus === 'executor_failed') return 'executor_failed';

  const allDiffs = await db.select().from(visualDiffs).where(eq(visualDiffs.buildId, buildId));

  if (allDiffs.length === 0) return 'safe_to_merge';

  // Filter out diffs from quarantined tests — they don't block builds
  const quarantinedTestIds = new Set(
    (await db.select({ id: tests.id }).from(tests).where(eq(tests.quarantined, true))).map(t => t.id)
  );
  const diffs = allDiffs.filter(d => !d.testId || !quarantinedTestIds.has(d.testId));

  if (diffs.length === 0) return 'safe_to_merge';

  const hasFailed = diffs.some(d => d.status === 'rejected');
  const hasPending = diffs.some(d => d.status === 'pending');
  const hasTodo = diffs.some(d => d.status === 'todo');

  if (hasFailed) return 'blocked';
  if (hasPending) return 'review_required';
  if (hasTodo) return 'has_todos';
  return 'safe_to_merge';
}

/**
 * Count the test_result rows that have been written for a build's testRun.
 * Used by the executor-failure path to distinguish "executor crashed before
 * any test ran" (→ executor_failed) from "executor ran but had errors" (→ blocked).
 */
export async function countTestResultsByBuild(buildId: string): Promise<number> {
  const [build] = await db.select({ testRunId: builds.testRunId }).from(builds).where(eq(builds.id, buildId));
  if (!build?.testRunId) return 0;
  const rows = await db.select({ id: testResults.id }).from(testResults).where(eq(testResults.testRunId, build.testRunId));
  return rows.length;
}

export async function hasApprovedDiffs(repositoryId?: string | null) {
  if (repositoryId) {
    const [row] = await db
      .select({ id: visualDiffs.id })
      .from(visualDiffs)
      .innerJoin(builds, eq(visualDiffs.buildId, builds.id))
      .innerJoin(testRuns, eq(builds.testRunId, testRuns.id))
      .where(and(eq(testRuns.repositoryId, repositoryId), eq(visualDiffs.status, 'approved')))
      .limit(1);
    return !!row;
  }
  const [row] = await db
    .select({ id: visualDiffs.id })
    .from(visualDiffs)
    .where(eq(visualDiffs.status, 'approved'))
    .limit(1);
  return !!row;
}

export async function getBuildCount(repositoryId?: string | null) {
  if (repositoryId) {
    const rows = await db
      .select({ id: builds.id })
      .from(builds)
      .innerJoin(testRuns, eq(builds.testRunId, testRuns.id))
      .where(eq(testRuns.repositoryId, repositoryId))
      ;
    return rows.length;
  }
  const rows = await db.select({ id: builds.id }).from(builds);
  return rows.length;
}

// Get build trends for dashboard sparklines (daily aggregates over last N days)
export async function getBuildTrends(repositoryId: string, days = 30): Promise<{
  date: string;
  passRate: number;
  flakyRate: number;
  totalTests: number;
  failedCount: number;
  passedCount: number;
  flakyCount: number;
}[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const recentBuilds = await db
    .select({
      passedCount: builds.passedCount,
      failedCount: builds.failedCount,
      totalTests: builds.totalTests,
      flakyCount: builds.flakyCount,
      completedAt: builds.completedAt,
    })
    .from(builds)
    .innerJoin(testRuns, eq(builds.testRunId, testRuns.id))
    .where(and(
      eq(testRuns.repositoryId, repositoryId),
      sql`${builds.completedAt} IS NOT NULL`,
    ))
    .orderBy(desc(builds.completedAt))
    ;

  // Group by date
  const byDate = new Map<string, { passed: number; failed: number; total: number; flaky: number; count: number }>();

  for (const b of recentBuilds) {
    if (!b.completedAt) continue;
    const d = new Date(b.completedAt);
    if (d < cutoff) continue;
    const dateKey = d.toISOString().slice(0, 10);
    const entry = byDate.get(dateKey) ?? { passed: 0, failed: 0, total: 0, flaky: 0, count: 0 };
    entry.passed += b.passedCount ?? 0;
    entry.failed += b.failedCount ?? 0;
    entry.total += b.totalTests ?? 0;
    entry.flaky += b.flakyCount ?? 0;
    entry.count++;
    byDate.set(dateKey, entry);
  }

  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => ({
      date,
      passRate: d.total > 0 ? Math.round((d.passed / d.total) * 100) : 0,
      flakyRate: d.total > 0 ? Math.round((d.flaky / d.total) * 100) : 0,
      totalTests: d.total,
      failedCount: d.failed,
      passedCount: d.passed,
      flakyCount: d.flaky,
    }));
}

export async function getA11yScoreTrend(repositoryId: string, limit = 10) {
  const repoBuilds = await db
    .select({
      id: builds.id,
      a11yScore: builds.a11yScore,
      a11yViolationCount: builds.a11yViolationCount,
      a11yCriticalCount: builds.a11yCriticalCount,
      a11yTotalRulesChecked: builds.a11yTotalRulesChecked,
      createdAt: builds.createdAt,
    })
    .from(builds)
    .innerJoin(testRuns, eq(builds.testRunId, testRuns.id))
    .where(and(
      eq(testRuns.repositoryId, repositoryId),
      sql`${builds.a11yScore} IS NOT NULL`,
    ))
    .orderBy(desc(builds.createdAt))
    .limit(limit)
    ;

  return repoBuilds.reverse(); // oldest first for charting
}
