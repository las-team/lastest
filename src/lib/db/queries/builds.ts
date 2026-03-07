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
  return db.select().from(builds).orderBy(desc(builds.createdAt)).limit(limit).all();
}

export async function getBuild(id: string) {
  return db.select().from(builds).where(eq(builds.id, id)).get();
}

export async function getBuildByTestRun(testRunId: string) {
  return db.select().from(builds).where(eq(builds.testRunId, testRunId)).get();
}

export async function createBuild(data: Omit<NewBuild, 'id'>) {
  const id = uuid();
  await db.insert(builds).values({ ...data, id, createdAt: new Date() });
  return { id, ...data, createdAt: new Date() };
}

export async function updateBuild(id: string, data: Partial<NewBuild>) {
  await db.update(builds).set(data).where(eq(builds.id, id));
}

export async function getRecentBuilds(limit = 5) {
  return db.select().from(builds).orderBy(desc(builds.createdAt)).limit(limit).all();
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
      gitBranch: testRuns.gitBranch,
      gitCommit: testRuns.gitCommit,
    })
    .from(builds)
    .innerJoin(testRuns, eq(builds.testRunId, testRuns.id))
    .where(eq(testRuns.repositoryId, repositoryId))
    .orderBy(desc(builds.createdAt))
    .limit(limit)
    .all();
}

export async function getLastBuildByBranch(repositoryId: string, branch: string) {
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
    .limit(1)
    .get();
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
    .all();

  // Get avg diff % per test from visualDiffs
  const diffs = await db
    .select({
      testId: visualDiffs.testId,
      percentageDifference: visualDiffs.percentageDifference,
    })
    .from(visualDiffs)
    .where(eq(visualDiffs.buildId, buildId))
    .all();

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
      .all();
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
      .all();
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
  const diffs = await db.select().from(visualDiffs).where(eq(visualDiffs.buildId, buildId)).all();

  if (diffs.length === 0) return 'safe_to_merge';

  const hasFailed = diffs.some(d => d.status === 'rejected');
  const hasPending = diffs.some(d => d.status === 'pending');
  const hasTodo = diffs.some(d => d.status === 'todo');

  if (hasFailed) return 'blocked';
  if (hasPending) return 'review_required';
  if (hasTodo) return 'has_todos';
  return 'safe_to_merge';
}

export async function hasApprovedDiffs(repositoryId?: string | null) {
  if (repositoryId) {
    const row = await db
      .select({ id: visualDiffs.id })
      .from(visualDiffs)
      .innerJoin(builds, eq(visualDiffs.buildId, builds.id))
      .innerJoin(testRuns, eq(builds.testRunId, testRuns.id))
      .where(and(eq(testRuns.repositoryId, repositoryId), eq(visualDiffs.status, 'approved')))
      .limit(1)
      .get();
    return !!row;
  }
  const row = await db
    .select({ id: visualDiffs.id })
    .from(visualDiffs)
    .where(eq(visualDiffs.status, 'approved'))
    .limit(1)
    .get();
  return !!row;
}

export async function getBuildCount(repositoryId?: string | null) {
  if (repositoryId) {
    const rows = await db
      .select({ id: builds.id })
      .from(builds)
      .innerJoin(testRuns, eq(builds.testRunId, testRuns.id))
      .where(eq(testRuns.repositoryId, repositoryId))
      .all();
    return rows.length;
  }
  const rows = await db.select({ id: builds.id }).from(builds).all();
  return rows.length;
}
