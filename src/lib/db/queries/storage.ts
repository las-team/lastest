import { db } from '../index';
import { teams, testRuns, testResults, visualDiffs, repositories } from '../schema';
import { eq, asc, inArray } from 'drizzle-orm';

export async function getTeamStorageUsage(teamId: string) {
  const [team] = await db
    .select({
      storageQuotaBytes: teams.storageQuotaBytes,
      storageUsedBytes: teams.storageUsedBytes,
      storageLastCalculatedAt: teams.storageLastCalculatedAt,
    })
    .from(teams)
    .where(eq(teams.id, teamId));

  if (!team) return null;

  const quotaBytes = team.storageQuotaBytes ?? 10737418240;
  const usedBytes = team.storageUsedBytes ?? 0;

  return {
    storageQuotaBytes: quotaBytes,
    storageUsedBytes: usedBytes,
    storageLastCalculatedAt: team.storageLastCalculatedAt,
    percentUsed: quotaBytes > 0 ? Math.round((usedBytes / quotaBytes) * 100) : 0,
  };
}

export async function updateTeamStorageUsage(teamId: string, usedBytes: number) {
  await db
    .update(teams)
    .set({
      storageUsedBytes: usedBytes,
      storageLastCalculatedAt: new Date(),
    })
    .where(eq(teams.id, teamId));
}

export async function updateTeamStorageQuota(teamId: string, quotaBytes: number) {
  await db
    .update(teams)
    .set({ storageQuotaBytes: quotaBytes })
    .where(eq(teams.id, teamId));
}

export async function getOldestTestRunsForTeam(teamId: string, limit: number) {
  return db
    .select({
      id: testRuns.id,
      repositoryId: testRuns.repositoryId,
      startedAt: testRuns.startedAt,
    })
    .from(testRuns)
    .innerJoin(repositories, eq(testRuns.repositoryId, repositories.id))
    .where(eq(repositories.teamId, teamId))
    .orderBy(asc(testRuns.startedAt))
    .limit(limit);
}

export async function getTestResultFilePaths(testRunId: string) {
  const results = await db
    .select({
      screenshotPath: testResults.screenshotPath,
      screenshots: testResults.screenshots,
      videoPath: testResults.videoPath,
      diffPath: testResults.diffPath,
      networkBodiesPath: testResults.networkBodiesPath,
      id: testResults.id,
    })
    .from(testResults)
    .where(eq(testResults.testRunId, testRunId));

  const resultIds = results.map((r) => r.id);
  const paths: string[] = [];

  // Collect paths from test results
  for (const r of results) {
    if (r.screenshotPath) paths.push(r.screenshotPath);
    if (r.videoPath) paths.push(r.videoPath);
    if (r.diffPath) paths.push(r.diffPath);
    if (r.networkBodiesPath) paths.push(r.networkBodiesPath);
    if (r.screenshots) {
      for (const s of r.screenshots) {
        if (s.path) paths.push(s.path);
      }
    }
  }

  // Collect paths from visual diffs
  if (resultIds.length > 0) {
    const diffs = await db
      .select({
        baselineImagePath: visualDiffs.baselineImagePath,
        currentImagePath: visualDiffs.currentImagePath,
        diffImagePath: visualDiffs.diffImagePath,
        plannedImagePath: visualDiffs.plannedImagePath,
        plannedDiffImagePath: visualDiffs.plannedDiffImagePath,
        mainBaselineImagePath: visualDiffs.mainBaselineImagePath,
        mainDiffImagePath: visualDiffs.mainDiffImagePath,
      })
      .from(visualDiffs)
      .where(inArray(visualDiffs.testResultId, resultIds));

    for (const d of diffs) {
      if (d.baselineImagePath) paths.push(d.baselineImagePath);
      if (d.currentImagePath) paths.push(d.currentImagePath);
      if (d.diffImagePath) paths.push(d.diffImagePath);
      if (d.plannedImagePath) paths.push(d.plannedImagePath);
      if (d.plannedDiffImagePath) paths.push(d.plannedDiffImagePath);
      if (d.mainBaselineImagePath) paths.push(d.mainBaselineImagePath);
      if (d.mainDiffImagePath) paths.push(d.mainDiffImagePath);
    }
  }

  return paths;
}

export async function deleteTestRunAndResults(testRunId: string) {
  const paths = await getTestResultFilePaths(testRunId);

  // Get result IDs for cascading deletes
  const results = await db
    .select({ id: testResults.id })
    .from(testResults)
    .where(eq(testResults.testRunId, testRunId));

  const resultIds = results.map((r) => r.id);

  // Delete visual diffs first (FK to testResults)
  if (resultIds.length > 0) {
    await db.delete(visualDiffs).where(inArray(visualDiffs.testResultId, resultIds));
  }

  // Delete test results
  await db.delete(testResults).where(eq(testResults.testRunId, testRunId));

  // Delete the test run
  await db.delete(testRuns).where(eq(testRuns.id, testRunId));

  return paths;
}
