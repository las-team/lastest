import { db } from '../index';
import {
  functionalAreas,
  tests,
  testRuns,
  testResults,
  testVersions,
  repositories,
  suites,
  builds,
  routes,
  routeTestSuggestions,
  ignoreRegions,
  baselines,
  visualDiffs,
  setupScripts,
} from '../schema';
import type {
  NewFunctionalArea,
  NewTest,
  NewTestRun,
  NewTestResult,
  NewTestVersion,
  TestChangeReason,
} from '../schema';
import { eq, desc, and, inArray, isNull, isNotNull, sql } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

// Functional Areas
export async function getFunctionalAreas() {
  return db.select().from(functionalAreas).where(isNull(functionalAreas.deletedAt)).all();
}

export async function getFunctionalArea(id: string) {
  return db.select().from(functionalAreas).where(and(eq(functionalAreas.id, id), isNull(functionalAreas.deletedAt))).get();
}

export async function createFunctionalArea(data: Omit<NewFunctionalArea, 'id'>) {
  const id = uuid();
  await db.insert(functionalAreas).values({ ...data, id });
  return { id, deletedAt: null, ...data };
}

export async function updateFunctionalArea(id: string, data: Partial<NewFunctionalArea>) {
  await db.update(functionalAreas).set(data).where(eq(functionalAreas.id, id));
}

export async function deleteFunctionalArea(id: string) {
  await db.update(functionalAreas).set({ deletedAt: new Date() }).where(eq(functionalAreas.id, id));
}

// Get or create functional area with case-insensitive name matching within a repo
export async function getOrCreateFunctionalAreaByRepo(
  repositoryId: string,
  name: string,
  description?: string
) {
  const areas = await getFunctionalAreasByRepo(repositoryId);
  const existing = areas.find(a => a.name.toLowerCase() === name.toLowerCase());

  if (existing) {
    // Optionally merge description if provided and existing is empty
    if (description && !existing.description) {
      await updateFunctionalArea(existing.id, { description });
      return { ...existing, description };
    }
    return existing;
  }

  return createFunctionalArea({ repositoryId, name, description });
}

// Tests
export async function getTests() {
  return db.select().from(tests).where(isNull(tests.deletedAt)).orderBy(desc(tests.createdAt)).all();
}

export async function getTestsByFunctionalArea(functionalAreaId: string) {
  return db.select().from(tests).where(and(eq(tests.functionalAreaId, functionalAreaId), isNull(tests.deletedAt))).all();
}

export async function getTest(id: string) {
  return db.select().from(tests).where(eq(tests.id, id)).get();
}

export async function createTest(data: Omit<NewTest, 'id' | 'createdAt' | 'updatedAt'>, branch?: string | null, viewport?: { width?: number; height?: number } | null) {
  const id = uuid();
  const now = new Date();
  await db.insert(tests).values({ ...data, id, createdAt: now, updatedAt: now });

  // Create initial version (version 1)
  await db.insert(testVersions).values({
    id: uuid(),
    testId: id,
    version: 1,
    code: data.code,
    name: data.name,
    targetUrl: data.targetUrl ?? null,
    changeReason: 'initial',
    branch: branch ?? null,
    viewportWidth: viewport?.width ?? null,
    viewportHeight: viewport?.height ?? null,
    createdAt: now,
  });

  return { id, ...data, createdAt: now, updatedAt: now };
}

export async function updateTest(id: string, data: Partial<NewTest>) {
  await db.update(tests).set({ ...data, updatedAt: new Date() }).where(eq(tests.id, id));
}

export async function softDeleteTest(id: string) {
  // Fetch the test before deleting so we can update route coverage
  const deletingTest = await db.select({ functionalAreaId: tests.functionalAreaId })
    .from(tests).where(eq(tests.id, id)).get();

  // Clear setup test references so other tests don't reference a deleted test
  await db.update(tests)
    .set({ setupTestId: null })
    .where(eq(tests.setupTestId, id));
  await db.update(repositories)
    .set({ defaultSetupTestId: null })
    .where(eq(repositories.defaultSetupTestId, id));
  await db.update(suites)
    .set({ setupTestId: null })
    .where(eq(suites.setupTestId, id));
  await db.update(builds)
    .set({ buildSetupTestId: null })
    .where(eq(builds.buildSetupTestId, id));

  // Clean up setupOverrides that reference this test in extraSteps
  const testsWithOverrides = await db.select()
    .from(tests)
    .where(isNotNull(tests.setupOverrides));
  for (const test of testsWithOverrides) {
    if (test.setupOverrides && test.setupOverrides.extraSteps) {
      const filteredSteps = test.setupOverrides.extraSteps.filter(
        step => step.stepType !== 'test' || step.testId !== id
      );
      if (filteredSteps.length !== test.setupOverrides.extraSteps.length) {
        await db.update(tests)
          .set({ setupOverrides: { ...test.setupOverrides, extraSteps: filteredSteps } })
          .where(eq(tests.id, test.id));
      }
    }
  }

  // Set deletedAt timestamp (soft delete)
  await db.update(tests).set({ deletedAt: new Date() }).where(eq(tests.id, id));

  // Reset hasTest on routes whose functional area no longer has active tests
  if (deletingTest?.functionalAreaId) {
    const activeTestsInArea = await db.select({ id: tests.id })
      .from(tests)
      .where(and(
        eq(tests.functionalAreaId, deletingTest.functionalAreaId),
        isNull(tests.deletedAt),
      ))
      .limit(1)
      .all();

    if (activeTestsInArea.length === 0) {
      await db.update(routes)
        .set({ hasTest: false })
        .where(eq(routes.functionalAreaId, deletingTest.functionalAreaId));
    }
  }
}

export async function restoreTest(id: string) {
  await db.update(tests).set({ deletedAt: null }).where(eq(tests.id, id));

  // Re-mark routes as having a test when restoring
  const restoredTest = await db.select({ functionalAreaId: tests.functionalAreaId })
    .from(tests).where(eq(tests.id, id)).get();
  if (restoredTest?.functionalAreaId) {
    await db.update(routes)
      .set({ hasTest: true })
      .where(eq(routes.functionalAreaId, restoredTest.functionalAreaId));
  }
}

export async function getDeletedTests(repositoryId?: string) {
  if (repositoryId) {
    return db.select().from(tests)
      .where(and(eq(tests.repositoryId, repositoryId), isNotNull(tests.deletedAt)))
      .orderBy(desc(tests.deletedAt))
      .all();
  }
  return db.select().from(tests)
    .where(isNotNull(tests.deletedAt))
    .orderBy(desc(tests.deletedAt))
    .all();
}

export async function permanentlyDeleteTest(id: string) {
  // Delete related records first (cascade)
  await db.delete(routeTestSuggestions).where(eq(routeTestSuggestions.matchedTestId, id));
  await db.delete(ignoreRegions).where(eq(ignoreRegions.testId, id));
  await db.delete(baselines).where(eq(baselines.testId, id));
  await db.delete(visualDiffs).where(eq(visualDiffs.testId, id));
  await db.delete(testResults).where(eq(testResults.testId, id));

  // Clear setup test references before deletion
  await db.update(tests)
    .set({ setupTestId: null })
    .where(eq(tests.setupTestId, id));
  await db.update(repositories)
    .set({ defaultSetupTestId: null })
    .where(eq(repositories.defaultSetupTestId, id));
  await db.update(suites)
    .set({ setupTestId: null })
    .where(eq(suites.setupTestId, id));
  await db.update(builds)
    .set({ buildSetupTestId: null })
    .where(eq(builds.buildSetupTestId, id));

  // Clean up setupOverrides that reference this test in extraSteps
  const testsWithOverrides = await db.select()
    .from(tests)
    .where(isNotNull(tests.setupOverrides));

  for (const test of testsWithOverrides) {
    if (test.setupOverrides && test.setupOverrides.extraSteps) {
      const filteredSteps = test.setupOverrides.extraSteps.filter(
        step => step.stepType !== 'test' || step.testId !== id
      );

      // Only update if we actually removed steps
      if (filteredSteps.length !== test.setupOverrides.extraSteps.length) {
        await db.update(tests)
          .set({
            setupOverrides: {
              ...test.setupOverrides,
              extraSteps: filteredSteps
            }
          })
          .where(eq(tests.id, test.id));
      }
    }
  }

  // Now delete the test
  await db.delete(tests).where(eq(tests.id, id));
}

// Clean up orphaned setup references (setup tests/scripts that no longer exist)
export async function cleanupOrphanedSetupReferences() {
  const allTests = await db.select({ id: sql<string>`${tests.id}` }).from(tests);
  const testIds = new Set(allTests.map(t => t.id));

  const allScripts = await db.select({ id: sql<string>`${setupScripts.id}` }).from(setupScripts);
  const scriptIds = new Set(allScripts.map(s => s.id));

  let cleanedCount = 0;

  // 1. Clean tests.setupTestId
  const testsWithSetup = await db.select().from(tests).where(isNotNull(tests.setupTestId));
  for (const test of testsWithSetup) {
    if (test.setupTestId && !testIds.has(test.setupTestId)) {
      await db.update(tests).set({ setupTestId: null }).where(eq(tests.id, test.id));
      cleanedCount++;
    }
  }

  // 2. Clean tests.setupScriptId
  const testsWithScript = await db.select().from(tests).where(isNotNull(tests.setupScriptId));
  for (const test of testsWithScript) {
    if (test.setupScriptId && !scriptIds.has(test.setupScriptId)) {
      await db.update(tests).set({ setupScriptId: null }).where(eq(tests.id, test.id));
      cleanedCount++;
    }
  }

  // 3. Clean repositories.defaultSetupTestId
  const reposWithSetupTest = await db.select().from(repositories).where(isNotNull(repositories.defaultSetupTestId));
  for (const repo of reposWithSetupTest) {
    if (repo.defaultSetupTestId && !testIds.has(repo.defaultSetupTestId)) {
      await db.update(repositories).set({ defaultSetupTestId: null }).where(eq(repositories.id, repo.id));
      cleanedCount++;
    }
  }

  // 4. Clean repositories.defaultSetupScriptId
  const reposWithSetupScript = await db.select().from(repositories).where(isNotNull(repositories.defaultSetupScriptId));
  for (const repo of reposWithSetupScript) {
    if (repo.defaultSetupScriptId && !scriptIds.has(repo.defaultSetupScriptId)) {
      await db.update(repositories).set({ defaultSetupScriptId: null }).where(eq(repositories.id, repo.id));
      cleanedCount++;
    }
  }

  // 5. Clean suites.setupTestId
  const suitesWithSetupTest = await db.select().from(suites).where(isNotNull(suites.setupTestId));
  for (const suite of suitesWithSetupTest) {
    if (suite.setupTestId && !testIds.has(suite.setupTestId)) {
      await db.update(suites).set({ setupTestId: null }).where(eq(suites.id, suite.id));
      cleanedCount++;
    }
  }

  // 6. Clean suites.setupScriptId
  const suitesWithSetupScript = await db.select().from(suites).where(isNotNull(suites.setupScriptId));
  for (const suite of suitesWithSetupScript) {
    if (suite.setupScriptId && !scriptIds.has(suite.setupScriptId)) {
      await db.update(suites).set({ setupScriptId: null }).where(eq(suites.id, suite.id));
      cleanedCount++;
    }
  }

  // 7. Clean builds.buildSetupTestId
  const buildsWithSetupTest = await db.select().from(builds).where(isNotNull(builds.buildSetupTestId));
  for (const build of buildsWithSetupTest) {
    if (build.buildSetupTestId && !testIds.has(build.buildSetupTestId)) {
      await db.update(builds).set({ buildSetupTestId: null }).where(eq(builds.id, build.id));
      cleanedCount++;
    }
  }

  // 8. Clean builds.buildSetupScriptId
  const buildsWithSetupScript = await db.select().from(builds).where(isNotNull(builds.buildSetupScriptId));
  for (const build of buildsWithSetupScript) {
    if (build.buildSetupScriptId && !scriptIds.has(build.buildSetupScriptId)) {
      await db.update(builds).set({ buildSetupScriptId: null }).where(eq(builds.id, build.id));
      cleanedCount++;
    }
  }

  // 9. Clean setupOverrides.extraSteps
  const testsWithOverrides = await db.select().from(tests).where(isNotNull(tests.setupOverrides));
  for (const test of testsWithOverrides) {
    if (test.setupOverrides && test.setupOverrides.extraSteps) {
      const filteredSteps = test.setupOverrides.extraSteps.filter(step => {
        if (step.stepType === 'test' && step.testId && !testIds.has(step.testId)) return false;
        if (step.stepType === 'script' && step.scriptId && !scriptIds.has(step.scriptId)) return false;
        return true;
      });

      if (filteredSteps.length !== test.setupOverrides.extraSteps.length) {
        await db.update(tests)
          .set({ setupOverrides: { ...test.setupOverrides, extraSteps: filteredSteps } })
          .where(eq(tests.id, test.id));
        cleanedCount++;
      }
    }
  }

  // Note: defaultSetupSteps cascade deletes automatically via FK

  return { cleanedCount };
}

// Upsert test by targetUrl within a functional area (for auto-generated tests)
export async function upsertTestByTargetUrl(
  data: Omit<NewTest, 'id' | 'createdAt' | 'updatedAt'>
) {
  if (!data.targetUrl || !data.functionalAreaId) {
    // Without targetUrl or functionalAreaId, just create new test
    return createTest(data);
  }

  // Find existing test with same targetUrl in same functional area
  const existing = await db
    .select()
    .from(tests)
    .where(
      and(
        eq(tests.functionalAreaId, data.functionalAreaId),
        eq(tests.targetUrl, data.targetUrl),
        isNull(tests.deletedAt)
      )
    )
    .get();

  if (existing) {
    // Update existing test
    await updateTest(existing.id, data);
    return { ...existing, ...data, updatedAt: new Date() };
  }

  return createTest(data);
}

// Test Runs
export async function getTestRuns() {
  return db.select().from(testRuns).orderBy(desc(testRuns.startedAt)).all();
}

export async function getTestRun(id: string) {
  return db.select().from(testRuns).where(eq(testRuns.id, id)).get();
}

export async function getTestRunsByIds(ids: string[]) {
  if (ids.length === 0) return [];
  return db.select().from(testRuns).where(inArray(testRuns.id, ids)).all();
}

export async function createTestRun(data: Omit<NewTestRun, 'id'>) {
  const id = uuid();
  await db.insert(testRuns).values({ ...data, id });
  return { id, ...data };
}

export async function updateTestRun(id: string, data: Partial<NewTestRun>) {
  await db.update(testRuns).set(data).where(eq(testRuns.id, id));
}

// Test Results
export async function getTestResultById(id: string) {
  return db.select().from(testResults).where(eq(testResults.id, id)).get();
}

export async function getTestResultsByRun(testRunId: string) {
  return db.select().from(testResults).where(eq(testResults.testRunId, testRunId)).all();
}

export async function getTestResultsByTest(testId: string) {
  // Join with testRuns to sort by startedAt descending (latest first)
  return db
    .select({
      id: testResults.id,
      testRunId: testResults.testRunId,
      testId: testResults.testId,
      status: testResults.status,
      screenshotPath: testResults.screenshotPath,
      screenshots: testResults.screenshots,
      diffPath: testResults.diffPath,
      errorMessage: testResults.errorMessage,
      durationMs: testResults.durationMs,
      viewport: testResults.viewport,
      browser: testResults.browser,
      consoleErrors: testResults.consoleErrors,
      networkRequests: testResults.networkRequests,
      videoPath: testResults.videoPath,
      a11yViolations: testResults.a11yViolations,
      softErrors: testResults.softErrors,
      startedAt: testRuns.startedAt,
    })
    .from(testResults)
    .innerJoin(testRuns, eq(testResults.testRunId, testRuns.id))
    .where(eq(testResults.testId, testId))
    .orderBy(desc(testRuns.startedAt))
    .all();
}

export async function createTestResult(data: Omit<NewTestResult, 'id'>) {
  const id = uuid();
  await db.insert(testResults).values({ ...data, id });
  return { id, ...data };
}

export async function updateTestResult(id: string, data: Partial<NewTestResult>) {
  await db.update(testResults).set(data).where(eq(testResults.id, id));
}

// Get tests with their latest result status
export async function getTestsWithStatus() {
  const allTests = await getTests();
  const areas = await getFunctionalAreas();
  const areaMap = new Map(areas.map(a => [a.id, a]));

  return Promise.all(
    allTests.map(async (test) => {
      const results = await getTestResultsByTest(test.id);
      // Results are already sorted by startedAt desc, so first is latest
      const latestResult = results[0];

      return {
        ...test,
        area: test.functionalAreaId ? areaMap.get(test.functionalAreaId) : null,
        latestStatus: latestResult?.status || null,
      };
    })
  );
}

// Get tests with status filtered by repo
export async function getTestsWithStatusByRepo(repositoryId: string) {
  const allTests = await getTestsByRepo(repositoryId);
  const areas = await getFunctionalAreasByRepo(repositoryId);
  const areaMap = new Map(areas.map(a => [a.id, a]));

  return Promise.all(
    allTests.map(async (test) => {
      const results = await getTestResultsByTest(test.id);
      // Results are already sorted by startedAt desc, so first is latest
      const latestResult = results[0];

      return {
        ...test,
        area: test.functionalAreaId ? areaMap.get(test.functionalAreaId) : null,
        latestStatus: latestResult?.status || null,
      };
    })
  );
}

// Repo-filtered queries
export async function getFunctionalAreasByRepo(repositoryId: string) {
  return db.select().from(functionalAreas).where(and(eq(functionalAreas.repositoryId, repositoryId), isNull(functionalAreas.deletedAt))).all();
}

export async function getTestsByRepo(repositoryId: string) {
  return db.select().from(tests).where(and(eq(tests.repositoryId, repositoryId), isNull(tests.deletedAt))).orderBy(desc(tests.createdAt)).all();
}

export async function getUncategorizedTests() {
  return db.select().from(tests).where(and(isNull(tests.repositoryId), isNull(tests.deletedAt))).orderBy(desc(tests.createdAt)).all();
}

export async function getUncategorizedTestsWithStatus() {
  const allTests = await getUncategorizedTests();

  return Promise.all(
    allTests.map(async (test) => {
      const results = await getTestResultsByTest(test.id);
      const latestResult = results[0];

      return {
        ...test,
        area: null,
        latestStatus: latestResult?.status || null,
      };
    })
  );
}

export async function getDeletedUncategorizedTests() {
  return db.select().from(tests)
    .where(and(isNull(tests.repositoryId), isNotNull(tests.deletedAt)))
    .orderBy(desc(tests.deletedAt))
    .all();
}

export async function getTestRunsByRepo(repositoryId: string) {
  return db.select().from(testRuns).where(eq(testRuns.repositoryId, repositoryId)).orderBy(desc(testRuns.startedAt)).all();
}

// Get latest test run for a specific branch
export async function getLatestRunByBranch(branch: string, repositoryId?: string) {
  const conditions = [eq(testRuns.gitBranch, branch)];
  if (repositoryId) {
    conditions.push(eq(testRuns.repositoryId, repositoryId));
  }

  return db
    .select()
    .from(testRuns)
    .where(and(...conditions))
    .orderBy(desc(testRuns.startedAt))
    .limit(1)
    .get();
}

// Get test results with test info for a run
export async function getTestResultsWithTestInfo(testRunId: string) {
  const results = await db
    .select({
      id: testResults.id,
      testId: testResults.testId,
      status: testResults.status,
      screenshotPath: testResults.screenshotPath,
      errorMessage: testResults.errorMessage,
      durationMs: testResults.durationMs,
      testName: tests.name,
    })
    .from(testResults)
    .innerJoin(tests, eq(testResults.testId, tests.id))
    .where(eq(testResults.testRunId, testRunId))
    .all();

  return results;
}

// Get all tests for a repository with their status from a specific run
export async function getTestsWithRunStatus(repositoryId: string, testRunId?: string) {
  const allTests = await getTestsByRepo(repositoryId);
  const areas = await getFunctionalAreasByRepo(repositoryId);
  const areaMap = new Map(areas.map(a => [a.id, a]));

  // If no testRunId provided, return all tests with null status
  if (!testRunId) {
    return allTests.map(test => ({
      ...test,
      area: test.functionalAreaId ? areaMap.get(test.functionalAreaId) : null,
      status: null as string | null,
      screenshotPath: null as string | null,
      errorMessage: null as string | null,
      durationMs: null as number | null,
    }));
  }

  // Get results for this specific run
  const results = await getTestResultsByRun(testRunId);
  const resultMap = new Map(results.map(r => [r.testId, r]));

  return allTests.map(test => {
    const result = resultMap.get(test.id);
    return {
      ...test,
      area: test.functionalAreaId ? areaMap.get(test.functionalAreaId) : null,
      status: result?.status || null,
      screenshotPath: result?.screenshotPath || null,
      errorMessage: result?.errorMessage || null,
      durationMs: result?.durationMs || null,
    };
  });
}

// Test Versions
export async function getTestVersions(testId: string) {
  return db
    .select()
    .from(testVersions)
    .where(eq(testVersions.testId, testId))
    .orderBy(desc(testVersions.version))
    .all();
}

export async function getTestVersion(testId: string, version: number) {
  return db
    .select()
    .from(testVersions)
    .where(and(eq(testVersions.testId, testId), eq(testVersions.version, version)))
    .get();
}

export async function getLatestVersionNumber(testId: string): Promise<number> {
  const latest = await db
    .select({ version: testVersions.version })
    .from(testVersions)
    .where(eq(testVersions.testId, testId))
    .orderBy(desc(testVersions.version))
    .limit(1)
    .get();
  return latest?.version ?? 0;
}

export async function getRecordingViewport(testId: string) {
  return db
    .select({ viewportWidth: testVersions.viewportWidth, viewportHeight: testVersions.viewportHeight })
    .from(testVersions)
    .where(eq(testVersions.testId, testId))
    .orderBy(desc(testVersions.version))
    .limit(1)
    .get();
}

export async function createTestVersion(data: Omit<NewTestVersion, 'id'>) {
  const id = uuid();
  await db.insert(testVersions).values({ ...data, id, createdAt: new Date() });
  return { id, ...data, createdAt: new Date() };
}

// Stamp the first build that executed this version (idempotent — only sets if not already set)
export async function stampFirstBuild(
  testVersionId: string,
  buildId: string,
  branch: string | null,
  commit: string | null
) {
  await db
    .update(testVersions)
    .set({
      firstBuildId: buildId,
      firstBuildBranch: branch,
      firstBuildCommit: commit,
    })
    .where(
      and(
        eq(testVersions.id, testVersionId),
        isNull(testVersions.firstBuildId)
      )
    );
}

// Get a single test version by its ID
export async function getTestVersionById(versionId: string) {
  return db
    .select()
    .from(testVersions)
    .where(eq(testVersions.id, versionId))
    .get();
}

// Get test versions created on a specific branch
export async function getTestVersionsByBranch(testId: string, branch: string) {
  return db
    .select()
    .from(testVersions)
    .where(and(eq(testVersions.testId, testId), eq(testVersions.branch, branch)))
    .orderBy(desc(testVersions.version))
    .all();
}

// For each test in a repo, get the latest version on a given branch
export async function getLatestBranchVersions(repositoryId: string, branch: string) {
  const repoTests = await getTestsByRepo(repositoryId);
  const results: { testId: string; version: typeof testVersions.$inferSelect }[] = [];

  for (const test of repoTests) {
    const latest = await db
      .select()
      .from(testVersions)
      .where(and(eq(testVersions.testId, test.id), eq(testVersions.branch, branch)))
      .orderBy(desc(testVersions.version))
      .limit(1)
      .get();
    if (latest) {
      results.push({ testId: test.id, version: latest });
    }
  }
  return results;
}

// Update test with versioning - saves current state before updating
export async function updateTestWithVersion(
  id: string,
  data: Partial<NewTest>,
  changeReason?: TestChangeReason | string,
  branch?: string,
  viewport?: { width?: number; height?: number } | null
) {
  const test = await getTest(id);
  if (!test) throw new Error('Test not found');

  // Get next version number
  const nextVersion = (await getLatestVersionNumber(id)) + 1;

  // Save current state as a version
  await createTestVersion({
    testId: id,
    version: nextVersion,
    code: test.code,
    name: test.name,
    targetUrl: test.targetUrl,
    changeReason: changeReason ?? 'manual_edit',
    branch: branch ?? null,
    viewportWidth: viewport?.width ?? null,
    viewportHeight: viewport?.height ?? null,
  });

  // Update the test
  await db.update(tests).set({ ...data, updatedAt: new Date() }).where(eq(tests.id, id));
}
