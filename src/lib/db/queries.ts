import { db } from './index';
import {
  functionalAreas,
  tests,
  testRuns,
  testResults,
  builds,
  visualDiffs,
  baselines,
  ignoreRegions,
  pullRequests,
  githubAccounts,
  repositories,
  playwrightSettings,
  routes,
  routeTestSuggestions,
  scanStatus,
  environmentConfigs,
  diffSensitivitySettings,
  aiSettings,
  aiPromptLogs,
  backgroundJobs,
} from './schema';
import {
  DEFAULT_SELECTOR_PRIORITY,
  DEFAULT_DIFF_THRESHOLDS,
  DEFAULT_AI_SETTINGS,
} from './schema';
import type {
  NewFunctionalArea,
  NewTest,
  NewTestRun,
  NewTestResult,
  NewBuild,
  NewVisualDiff,
  NewBaseline,
  NewIgnoreRegion,
  NewPullRequest,
  NewGithubAccount,
  NewRepository,
  NewPlaywrightSettings,
  NewRoute,
  NewRouteTestSuggestion,
  NewScanStatus,
  NewEnvironmentConfig,
  NewDiffSensitivitySettings,
  NewAISettings,
  NewAIPromptLog,
  NewBackgroundJob,
  BuildStatus,
  SelectorConfig,
  AIProvider,
  BackgroundJobType,
  BackgroundJobStatus,
} from './schema';

export { DEFAULT_SELECTOR_PRIORITY, DEFAULT_DIFF_THRESHOLDS, DEFAULT_AI_SETTINGS };
import { eq, desc, and, inArray, or, gte } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

// Functional Areas
export async function getFunctionalAreas() {
  return db.select().from(functionalAreas).all();
}

export async function getFunctionalArea(id: string) {
  return db.select().from(functionalAreas).where(eq(functionalAreas.id, id)).get();
}

export async function createFunctionalArea(data: Omit<NewFunctionalArea, 'id'>) {
  const id = uuid();
  await db.insert(functionalAreas).values({ ...data, id });
  return { id, ...data };
}

export async function updateFunctionalArea(id: string, data: Partial<NewFunctionalArea>) {
  await db.update(functionalAreas).set(data).where(eq(functionalAreas.id, id));
}

export async function deleteFunctionalArea(id: string) {
  await db.delete(functionalAreas).where(eq(functionalAreas.id, id));
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
  return db.select().from(tests).orderBy(desc(tests.createdAt)).all();
}

export async function getTestsByFunctionalArea(functionalAreaId: string) {
  return db.select().from(tests).where(eq(tests.functionalAreaId, functionalAreaId)).all();
}

export async function getTest(id: string) {
  return db.select().from(tests).where(eq(tests.id, id)).get();
}

export async function createTest(data: Omit<NewTest, 'id' | 'createdAt' | 'updatedAt'>) {
  const id = uuid();
  const now = new Date();
  await db.insert(tests).values({ ...data, id, createdAt: now, updatedAt: now });
  return { id, ...data, createdAt: now, updatedAt: now };
}

export async function updateTest(id: string, data: Partial<NewTest>) {
  await db.update(tests).set({ ...data, updatedAt: new Date() }).where(eq(tests.id, id));
}

export async function deleteTest(id: string) {
  // Delete related records first (cascade)
  await db.delete(routeTestSuggestions).where(eq(routeTestSuggestions.matchedTestId, id));
  await db.delete(ignoreRegions).where(eq(ignoreRegions.testId, id));
  await db.delete(baselines).where(eq(baselines.testId, id));
  await db.delete(visualDiffs).where(eq(visualDiffs.testId, id));
  await db.delete(testResults).where(eq(testResults.testId, id));
  // Now delete the test
  await db.delete(tests).where(eq(tests.id, id));
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
        eq(tests.targetUrl, data.targetUrl)
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

export async function createTestRun(data: Omit<NewTestRun, 'id'>) {
  const id = uuid();
  await db.insert(testRuns).values({ ...data, id });
  return { id, ...data };
}

export async function updateTestRun(id: string, data: Partial<NewTestRun>) {
  await db.update(testRuns).set(data).where(eq(testRuns.id, id));
}

// Test Results
export async function getTestResultsByRun(testRunId: string) {
  return db.select().from(testResults).where(eq(testResults.testRunId, testRunId)).all();
}

export async function getTestResultsByTest(testId: string) {
  return db.select().from(testResults).where(eq(testResults.testId, testId)).all();
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
      const latestResult = results.sort((a, b) =>
        (b.durationMs || 0) - (a.durationMs || 0)
      )[0];

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
      const latestResult = results.sort((a, b) =>
        (b.durationMs || 0) - (a.durationMs || 0)
      )[0];

      return {
        ...test,
        area: test.functionalAreaId ? areaMap.get(test.functionalAreaId) : null,
        latestStatus: latestResult?.status || null,
      };
    })
  );
}

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
      gitBranch: testRuns.gitBranch,
    })
    .from(builds)
    .innerJoin(testRuns, eq(builds.testRunId, testRuns.id))
    .where(eq(testRuns.repositoryId, repositoryId))
    .orderBy(desc(builds.createdAt))
    .limit(limit)
    .all();
}

// Visual Diffs
export async function getVisualDiffsByBuild(buildId: string) {
  return db.select().from(visualDiffs).where(eq(visualDiffs.buildId, buildId)).all();
}

// Get visual diffs with test result status for proper filtering
export async function getVisualDiffsWithTestStatus(buildId: string) {
  const diffs = await db
    .select({
      id: visualDiffs.id,
      buildId: visualDiffs.buildId,
      testResultId: visualDiffs.testResultId,
      testId: visualDiffs.testId,
      stepLabel: visualDiffs.stepLabel,
      baselineImagePath: visualDiffs.baselineImagePath,
      currentImagePath: visualDiffs.currentImagePath,
      diffImagePath: visualDiffs.diffImagePath,
      status: visualDiffs.status,
      pixelDifference: visualDiffs.pixelDifference,
      percentageDifference: visualDiffs.percentageDifference,
      classification: visualDiffs.classification,
      metadata: visualDiffs.metadata,
      approvedBy: visualDiffs.approvedBy,
      approvedAt: visualDiffs.approvedAt,
      createdAt: visualDiffs.createdAt,
      testResultStatus: testResults.status,
      testName: tests.name,
      functionalAreaName: functionalAreas.name,
    })
    .from(visualDiffs)
    .leftJoin(testResults, eq(visualDiffs.testResultId, testResults.id))
    .leftJoin(tests, eq(visualDiffs.testId, tests.id))
    .leftJoin(functionalAreas, eq(tests.functionalAreaId, functionalAreas.id))
    .where(eq(visualDiffs.buildId, buildId))
    .all();

  return diffs;
}

export async function getVisualDiff(id: string) {
  return db.select().from(visualDiffs).where(eq(visualDiffs.id, id)).get();
}

export async function getPendingDiffsByBuild(buildId: string) {
  return db
    .select()
    .from(visualDiffs)
    .where(and(eq(visualDiffs.buildId, buildId), eq(visualDiffs.status, 'pending')))
    .all();
}

export async function createVisualDiff(data: Omit<NewVisualDiff, 'id'>) {
  const id = uuid();
  await db.insert(visualDiffs).values({ ...data, id, createdAt: new Date() });
  return { id, ...data, createdAt: new Date() };
}

export async function updateVisualDiff(id: string, data: Partial<NewVisualDiff>) {
  await db.update(visualDiffs).set(data).where(eq(visualDiffs.id, id));
}

export async function batchUpdateVisualDiffs(ids: string[], data: Partial<NewVisualDiff>) {
  await db.update(visualDiffs).set(data).where(inArray(visualDiffs.id, ids));
}

// Baselines
export async function getActiveBaseline(testId: string, branch: string, stepLabel?: string | null) {
  const conditions = [
    eq(baselines.testId, testId),
    eq(baselines.branch, branch),
    eq(baselines.isActive, true),
  ];
  if (stepLabel) {
    conditions.push(eq(baselines.stepLabel, stepLabel));
  }
  return db
    .select()
    .from(baselines)
    .where(and(...conditions))
    .get();
}

export async function getBaselineByHash(testId: string, imageHash: string, stepLabel?: string | null) {
  const conditions = [
    eq(baselines.testId, testId),
    eq(baselines.imageHash, imageHash),
    eq(baselines.isActive, true),
  ];
  if (stepLabel) {
    conditions.push(eq(baselines.stepLabel, stepLabel));
  }
  return db
    .select()
    .from(baselines)
    .where(and(...conditions))
    .get();
}

export async function createBaseline(data: Omit<NewBaseline, 'id'>) {
  const id = uuid();
  await db.insert(baselines).values({ ...data, id, createdAt: new Date() });
  return { id, ...data, createdAt: new Date() };
}

export async function deactivateBaselines(testId: string, branch: string, stepLabel?: string | null) {
  const conditions = [eq(baselines.testId, testId), eq(baselines.branch, branch)];
  if (stepLabel) {
    conditions.push(eq(baselines.stepLabel, stepLabel));
  }
  await db
    .update(baselines)
    .set({ isActive: false })
    .where(and(...conditions));
}

// Ignore Regions
export async function getIgnoreRegions(testId: string) {
  return db.select().from(ignoreRegions).where(eq(ignoreRegions.testId, testId)).all();
}

export async function createIgnoreRegion(data: Omit<NewIgnoreRegion, 'id'>) {
  const id = uuid();
  await db.insert(ignoreRegions).values({ ...data, id, createdAt: new Date() });
  return { id, ...data, createdAt: new Date() };
}

export async function deleteIgnoreRegion(id: string) {
  await db.delete(ignoreRegions).where(eq(ignoreRegions.id, id));
}

// Pull Requests
export async function getPullRequest(id: string) {
  return db.select().from(pullRequests).where(eq(pullRequests.id, id)).get();
}

export async function getPullRequestByBranch(headBranch: string) {
  return db
    .select()
    .from(pullRequests)
    .where(and(eq(pullRequests.headBranch, headBranch), eq(pullRequests.status, 'open')))
    .get();
}

export async function createPullRequest(data: Omit<NewPullRequest, 'id'>) {
  const id = uuid();
  await db.insert(pullRequests).values({ ...data, id, createdAt: new Date() });
  return { id, ...data, createdAt: new Date() };
}

export async function updatePullRequest(id: string, data: Partial<NewPullRequest>) {
  await db.update(pullRequests).set({ ...data, updatedAt: new Date() }).where(eq(pullRequests.id, id));
}

// GitHub Accounts
export async function getGithubAccount() {
  return db.select().from(githubAccounts).get();
}

export async function createGithubAccount(data: Omit<NewGithubAccount, 'id'>) {
  const id = uuid();
  await db.insert(githubAccounts).values({ ...data, id, createdAt: new Date() });
  return { id, ...data, createdAt: new Date() };
}

export async function updateGithubAccount(id: string, data: Partial<NewGithubAccount>) {
  await db.update(githubAccounts).set(data).where(eq(githubAccounts.id, id));
}

export async function deleteGithubAccount(id: string) {
  await db.delete(githubAccounts).where(eq(githubAccounts.id, id));
}

// Build Summary helpers
export async function computeBuildStatus(buildId: string): Promise<BuildStatus> {
  const diffs = await getVisualDiffsByBuild(buildId);

  if (diffs.length === 0) return 'safe_to_merge';

  const hasFailed = diffs.some(d => d.status === 'rejected');
  const hasPending = diffs.some(d => d.status === 'pending');

  if (hasFailed) return 'blocked';
  if (hasPending) return 'review_required';
  return 'safe_to_merge';
}

// Repositories
export async function getRepositories() {
  return db.select().from(repositories).orderBy(desc(repositories.createdAt)).all();
}

export async function getRepository(id: string) {
  return db.select().from(repositories).where(eq(repositories.id, id)).get();
}

export async function getRepositoryByGithubId(githubRepoId: number) {
  return db.select().from(repositories).where(eq(repositories.githubRepoId, githubRepoId)).get();
}

export async function createRepository(data: Omit<NewRepository, 'id'>) {
  const id = uuid();
  await db.insert(repositories).values({ ...data, id, createdAt: new Date() });
  return { id, ...data, createdAt: new Date() };
}

export async function updateRepository(id: string, data: Partial<NewRepository>) {
  await db.update(repositories).set(data).where(eq(repositories.id, id));
}

export async function deleteRepository(id: string) {
  await db.delete(repositories).where(eq(repositories.id, id));
}

// Repo-filtered queries
export async function getFunctionalAreasByRepo(repositoryId: string) {
  return db.select().from(functionalAreas).where(eq(functionalAreas.repositoryId, repositoryId)).all();
}

export async function getTestsByRepo(repositoryId: string) {
  return db.select().from(tests).where(eq(tests.repositoryId, repositoryId)).orderBy(desc(tests.createdAt)).all();
}

export async function getTestRunsByRepo(repositoryId: string) {
  return db.select().from(testRuns).where(eq(testRuns.repositoryId, repositoryId)).orderBy(desc(testRuns.startedAt)).all();
}

export async function getBaselinesByRepo(repositoryId: string) {
  return db.select().from(baselines).where(eq(baselines.repositoryId, repositoryId)).all();
}

// Update selected repo for github account
export async function updateSelectedRepository(accountId: string, repositoryId: string | null) {
  await db.update(githubAccounts).set({ selectedRepositoryId: repositoryId }).where(eq(githubAccounts.id, accountId));
}

export async function getSelectedRepository() {
  const account = await getGithubAccount();
  if (!account?.selectedRepositoryId) return null;
  const repo = await getRepository(account.selectedRepositoryId);
  return repo || null;
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

// Playwright Settings
export async function getPlaywrightSettings(repositoryId?: string | null) {
  if (repositoryId) {
    const settings = await db
      .select()
      .from(playwrightSettings)
      .where(eq(playwrightSettings.repositoryId, repositoryId))
      .get();
    if (settings) return settings;
  }

  // Return global settings (no repositoryId) or defaults
  const globalSettings = await db
    .select()
    .from(playwrightSettings)
    .where(eq(playwrightSettings.repositoryId, ''))
    .get();

  if (globalSettings) return globalSettings;

  // Return default settings object (not saved)
  return {
    id: '',
    repositoryId: null,
    selectorPriority: DEFAULT_SELECTOR_PRIORITY,
    browser: 'chromium' as const,
    viewportWidth: 1280,
    viewportHeight: 720,
    headless: false,
    navigationTimeout: 30000,
    actionTimeout: 5000,
    createdAt: null,
    updatedAt: null,
  };
}

export async function createPlaywrightSettings(data: Omit<NewPlaywrightSettings, 'id' | 'createdAt' | 'updatedAt'>) {
  const id = uuid();
  const now = new Date();
  await db.insert(playwrightSettings).values({
    ...data,
    id,
    selectorPriority: data.selectorPriority || DEFAULT_SELECTOR_PRIORITY,
    createdAt: now,
    updatedAt: now,
  });
  return { id, ...data, createdAt: now, updatedAt: now };
}

export async function updatePlaywrightSettings(id: string, data: Partial<NewPlaywrightSettings>) {
  await db.update(playwrightSettings).set({ ...data, updatedAt: new Date() }).where(eq(playwrightSettings.id, id));
}

export async function upsertPlaywrightSettings(repositoryId: string | null, data: Partial<NewPlaywrightSettings>) {
  const repoIdValue = repositoryId || '';
  const existing = await db
    .select()
    .from(playwrightSettings)
    .where(eq(playwrightSettings.repositoryId, repoIdValue))
    .get();

  if (existing) {
    await updatePlaywrightSettings(existing.id, data);
    return { ...existing, ...data, updatedAt: new Date() };
  } else {
    return createPlaywrightSettings({ ...data, repositoryId: repoIdValue });
  }
}

export async function deletePlaywrightSettings(id: string) {
  await db.delete(playwrightSettings).where(eq(playwrightSettings.id, id));
}

// Routes
export async function getRoutesByRepo(repositoryId: string) {
  return db.select().from(routes).where(eq(routes.repositoryId, repositoryId)).all();
}

export async function getRoute(id: string) {
  return db.select().from(routes).where(eq(routes.id, id)).get();
}

export async function getRoutesByIds(ids: string[]) {
  if (ids.length === 0) return [];
  return db.select().from(routes).where(inArray(routes.id, ids)).all();
}

export async function createRoute(data: Omit<NewRoute, 'id'>) {
  const id = uuid();
  await db.insert(routes).values({ ...data, id });
  return { id, ...data };
}

export async function createRoutes(routeData: Omit<NewRoute, 'id'>[]) {
  const routesWithIds = routeData.map(r => ({ ...r, id: uuid() }));
  if (routesWithIds.length > 0) {
    await db.insert(routes).values(routesWithIds);
  }
  return routesWithIds;
}

export async function updateRoute(id: string, data: Partial<NewRoute>) {
  await db.update(routes).set(data).where(eq(routes.id, id));
}

export async function deleteRoutesByRepo(repositoryId: string) {
  await db.delete(routes).where(eq(routes.repositoryId, repositoryId));
}

export async function getRouteCoverageStats(repositoryId: string) {
  const allRoutes = await getRoutesByRepo(repositoryId);
  const total = allRoutes.length;

  // Get functional areas that have tests
  const repoTests = await getTestsByRepo(repositoryId);
  const areasWithTests = new Set(
    repoTests.map(t => t.functionalAreaId).filter(Boolean)
  );

  // Route has coverage if its functional area has tests OR hasTest flag is true
  const withTests = allRoutes.filter(r =>
    r.hasTest || (r.functionalAreaId && areasWithTests.has(r.functionalAreaId))
  ).length;

  const percentage = total > 0 ? Math.round((withTests / total) * 100) : 0;
  return { total, withTests, percentage };
}

export async function linkRouteToFunctionalArea(routeId: string, functionalAreaId: string) {
  await db.update(routes).set({ functionalAreaId }).where(eq(routes.id, routeId));
}

// Scan Status
export async function getScanStatus(repositoryId: string) {
  return db.select().from(scanStatus).where(eq(scanStatus.repositoryId, repositoryId)).get();
}

export async function createScanStatus(data: Omit<NewScanStatus, 'id'>) {
  const id = uuid();
  await db.insert(scanStatus).values({ ...data, id });
  return { id, ...data };
}

export async function updateScanStatus(id: string, data: Partial<NewScanStatus>) {
  await db.update(scanStatus).set(data).where(eq(scanStatus.id, id));
}

export async function deleteScanStatus(repositoryId: string) {
  await db.delete(scanStatus).where(eq(scanStatus.repositoryId, repositoryId));
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

// Environment Configs
export async function getEnvironmentConfig(repositoryId?: string | null) {
  if (repositoryId) {
    const config = await db
      .select()
      .from(environmentConfigs)
      .where(eq(environmentConfigs.repositoryId, repositoryId))
      .get();
    if (config) return config;
  }

  // Return global config (no repositoryId) or defaults
  const globalConfig = await db
    .select()
    .from(environmentConfigs)
    .where(eq(environmentConfigs.repositoryId, ''))
    .get();

  if (globalConfig) return globalConfig;

  // Return default config object (not saved)
  return {
    id: '',
    repositoryId: null,
    mode: 'manual' as const,
    baseUrl: 'http://localhost:3000',
    startCommand: null,
    healthCheckUrl: null,
    healthCheckTimeout: 60000,
    reuseExistingServer: true,
    createdAt: null,
    updatedAt: null,
  };
}

export async function createEnvironmentConfig(data: Omit<NewEnvironmentConfig, 'id' | 'createdAt' | 'updatedAt'>) {
  const id = uuid();
  const now = new Date();
  await db.insert(environmentConfigs).values({
    ...data,
    id,
    createdAt: now,
    updatedAt: now,
  });
  return { id, ...data, createdAt: now, updatedAt: now };
}

export async function updateEnvironmentConfig(id: string, data: Partial<NewEnvironmentConfig>) {
  await db.update(environmentConfigs).set({ ...data, updatedAt: new Date() }).where(eq(environmentConfigs.id, id));
}

export async function upsertEnvironmentConfig(repositoryId: string | null, data: Partial<NewEnvironmentConfig>) {
  const repoIdValue = repositoryId || '';
  const existing = await db
    .select()
    .from(environmentConfigs)
    .where(eq(environmentConfigs.repositoryId, repoIdValue))
    .get();

  if (existing) {
    await updateEnvironmentConfig(existing.id, data);
    return { ...existing, ...data, updatedAt: new Date() };
  } else {
    return createEnvironmentConfig({ ...data, repositoryId: repoIdValue });
  }
}

export async function deleteEnvironmentConfig(id: string) {
  await db.delete(environmentConfigs).where(eq(environmentConfigs.id, id));
}

// Diff Sensitivity Settings
export async function getDiffSensitivitySettings(repositoryId?: string | null) {
  if (repositoryId) {
    const settings = await db
      .select()
      .from(diffSensitivitySettings)
      .where(eq(diffSensitivitySettings.repositoryId, repositoryId))
      .get();
    if (settings) return settings;
  }

  // Return global settings (no repositoryId) or defaults
  const globalSettings = await db
    .select()
    .from(diffSensitivitySettings)
    .where(eq(diffSensitivitySettings.repositoryId, ''))
    .get();

  if (globalSettings) return globalSettings;

  // Return default settings object (not saved)
  return {
    id: '',
    repositoryId: null,
    unchangedThreshold: DEFAULT_DIFF_THRESHOLDS.unchangedThreshold,
    flakyThreshold: DEFAULT_DIFF_THRESHOLDS.flakyThreshold,
    createdAt: null,
    updatedAt: null,
  };
}

export async function createDiffSensitivitySettings(data: Omit<NewDiffSensitivitySettings, 'id' | 'createdAt' | 'updatedAt'>) {
  const id = uuid();
  const now = new Date();
  await db.insert(diffSensitivitySettings).values({
    ...data,
    id,
    createdAt: now,
    updatedAt: now,
  });
  return { id, ...data, createdAt: now, updatedAt: now };
}

export async function updateDiffSensitivitySettings(id: string, data: Partial<NewDiffSensitivitySettings>) {
  await db.update(diffSensitivitySettings).set({ ...data, updatedAt: new Date() }).where(eq(diffSensitivitySettings.id, id));
}

export async function upsertDiffSensitivitySettings(repositoryId: string | null, data: Partial<NewDiffSensitivitySettings>) {
  const repoIdValue = repositoryId || '';
  const existing = await db
    .select()
    .from(diffSensitivitySettings)
    .where(eq(diffSensitivitySettings.repositoryId, repoIdValue))
    .get();

  if (existing) {
    await updateDiffSensitivitySettings(existing.id, data);
    return { ...existing, ...data, updatedAt: new Date() };
  } else {
    return createDiffSensitivitySettings({ ...data, repositoryId: repoIdValue });
  }
}

export async function deleteDiffSensitivitySettings(id: string) {
  await db.delete(diffSensitivitySettings).where(eq(diffSensitivitySettings.id, id));
}

// AI Settings
export async function getAISettings(repositoryId?: string | null) {
  if (repositoryId) {
    const settings = await db
      .select()
      .from(aiSettings)
      .where(eq(aiSettings.repositoryId, repositoryId))
      .get();
    if (settings) return settings;
  }

  // Return global settings (no repositoryId) or defaults
  const globalSettings = await db
    .select()
    .from(aiSettings)
    .where(eq(aiSettings.repositoryId, ''))
    .get();

  if (globalSettings) return globalSettings;

  // Return default settings object (not saved)
  return {
    id: '',
    repositoryId: null,
    provider: DEFAULT_AI_SETTINGS.provider as AIProvider,
    openrouterApiKey: null,
    openrouterModel: DEFAULT_AI_SETTINGS.openrouterModel,
    customInstructions: null,
    createdAt: null,
    updatedAt: null,
  };
}

export async function createAISettings(data: Omit<NewAISettings, 'id' | 'createdAt' | 'updatedAt'>) {
  const id = uuid();
  const now = new Date();
  await db.insert(aiSettings).values({
    ...data,
    id,
    createdAt: now,
    updatedAt: now,
  });
  return { id, ...data, createdAt: now, updatedAt: now };
}

export async function updateAISettings(id: string, data: Partial<NewAISettings>) {
  await db.update(aiSettings).set({ ...data, updatedAt: new Date() }).where(eq(aiSettings.id, id));
}

export async function upsertAISettings(repositoryId: string | null, data: Partial<NewAISettings>) {
  const repoIdValue = repositoryId || '';
  const existing = await db
    .select()
    .from(aiSettings)
    .where(eq(aiSettings.repositoryId, repoIdValue))
    .get();

  if (existing) {
    await updateAISettings(existing.id, data);
    return { ...existing, ...data, updatedAt: new Date() };
  } else {
    return createAISettings({ ...data, repositoryId: repoIdValue });
  }
}

export async function deleteAISettings(id: string) {
  await db.delete(aiSettings).where(eq(aiSettings.id, id));
}

// AI Prompt Logs
export async function createAIPromptLog(data: Omit<NewAIPromptLog, 'id' | 'createdAt'>) {
  const id = uuid();
  const now = new Date();
  await db.insert(aiPromptLogs).values({
    ...data,
    id,
    createdAt: now,
  });
  return { id, ...data, createdAt: now };
}

export async function updateAIPromptLog(
  id: string,
  data: Partial<Pick<NewAIPromptLog, 'status' | 'response' | 'errorMessage' | 'durationMs'>>
) {
  await db.update(aiPromptLogs).set(data).where(eq(aiPromptLogs.id, id));
}

export async function getAIPromptLogs(repositoryId?: string | null, limit = 50) {
  if (repositoryId) {
    return db
      .select()
      .from(aiPromptLogs)
      .where(eq(aiPromptLogs.repositoryId, repositoryId))
      .orderBy(desc(aiPromptLogs.createdAt))
      .limit(limit)
      .all();
  }
  return db
    .select()
    .from(aiPromptLogs)
    .orderBy(desc(aiPromptLogs.createdAt))
    .limit(limit)
    .all();
}

export async function deleteAllAIPromptLogs(repositoryId?: string | null) {
  if (repositoryId) {
    await db.delete(aiPromptLogs).where(eq(aiPromptLogs.repositoryId, repositoryId));
  } else {
    await db.delete(aiPromptLogs);
  }
}

// Route Test Suggestions
export async function getSuggestionsByRoute(routeId: string) {
  return db.select().from(routeTestSuggestions).where(eq(routeTestSuggestions.routeId, routeId)).all();
}

export async function getSuggestionsByRoutes(routeIds: string[]) {
  if (routeIds.length === 0) return [];
  return db.select().from(routeTestSuggestions).where(inArray(routeTestSuggestions.routeId, routeIds)).all();
}

export async function createRouteTestSuggestion(data: Omit<NewRouteTestSuggestion, 'id'>) {
  const id = uuid();
  await db.insert(routeTestSuggestions).values({ ...data, id, createdAt: new Date() });
  return { id, ...data, createdAt: new Date() };
}

export async function createRouteTestSuggestions(suggestions: Omit<NewRouteTestSuggestion, 'id'>[]) {
  if (suggestions.length === 0) return [];
  const suggestionsWithIds = suggestions.map(s => ({ ...s, id: uuid(), createdAt: new Date() }));
  await db.insert(routeTestSuggestions).values(suggestionsWithIds);
  return suggestionsWithIds;
}

export async function updateRouteTestSuggestion(id: string, data: Partial<NewRouteTestSuggestion>) {
  await db.update(routeTestSuggestions).set(data).where(eq(routeTestSuggestions.id, id));
}

export async function deleteRouteTestSuggestion(id: string) {
  await db.delete(routeTestSuggestions).where(eq(routeTestSuggestions.id, id));
}

export async function deleteSuggestionsByRoute(routeId: string) {
  await db.delete(routeTestSuggestions).where(eq(routeTestSuggestions.routeId, routeId));
}

// Auto-match suggestions against existing tests using fuzzy keyword matching
function normalizeForMatch(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2);
}

function calculateMatchScore(suggestion: string, testName: string): number {
  const suggestionWords = normalizeForMatch(suggestion);
  const testWords = normalizeForMatch(testName);

  let matches = 0;
  for (const sw of suggestionWords) {
    if (testWords.some(tw => tw.includes(sw) || sw.includes(tw))) {
      matches++;
    }
  }

  return suggestionWords.length > 0 ? matches / suggestionWords.length : 0;
}

export async function autoMatchSuggestionsForRoute(routeId: string, repositoryId: string) {
  const suggestions = await getSuggestionsByRoute(routeId);
  const repoTests = await getTestsByRepo(repositoryId);

  const updates: { suggestionId: string; testId: string }[] = [];

  for (const suggestion of suggestions) {
    if (suggestion.matchedTestId) continue; // Already matched

    let bestMatch: { testId: string; score: number } | null = null;

    for (const test of repoTests) {
      const score = calculateMatchScore(suggestion.suggestion, test.name);
      if (score >= 0.5 && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { testId: test.id, score };
      }
    }

    if (bestMatch) {
      updates.push({ suggestionId: suggestion.id, testId: bestMatch.testId });
    }
  }

  // Apply updates
  for (const update of updates) {
    await updateRouteTestSuggestion(update.suggestionId, { matchedTestId: update.testId });
  }

  return updates.length;
}

// Get suggestions with matched/unmatched status for display
export async function getSuggestionsWithMatchStatus(routeId: string) {
  const suggestions = await db
    .select({
      id: routeTestSuggestions.id,
      routeId: routeTestSuggestions.routeId,
      suggestion: routeTestSuggestions.suggestion,
      matchedTestId: routeTestSuggestions.matchedTestId,
      createdAt: routeTestSuggestions.createdAt,
      matchedTestName: tests.name,
    })
    .from(routeTestSuggestions)
    .leftJoin(tests, eq(routeTestSuggestions.matchedTestId, tests.id))
    .where(eq(routeTestSuggestions.routeId, routeId))
    .all();

  return suggestions;
}

// Get unmatched suggestions for a functional area (by routes linked to that area)
export async function getUnmatchedSuggestionsByArea(functionalAreaId: string) {
  const areaRoutes = await db
    .select()
    .from(routes)
    .where(eq(routes.functionalAreaId, functionalAreaId))
    .all();

  if (areaRoutes.length === 0) return [];

  const routeIds = areaRoutes.map(r => r.id);
  const suggestions = await db
    .select({
      id: routeTestSuggestions.id,
      routeId: routeTestSuggestions.routeId,
      suggestion: routeTestSuggestions.suggestion,
      matchedTestId: routeTestSuggestions.matchedTestId,
      createdAt: routeTestSuggestions.createdAt,
      routePath: routes.path,
    })
    .from(routeTestSuggestions)
    .innerJoin(routes, eq(routeTestSuggestions.routeId, routes.id))
    .where(inArray(routeTestSuggestions.routeId, routeIds))
    .all();

  return suggestions.filter(s => !s.matchedTestId);
}

// Get all unmatched suggestions for repository
export async function getUnmatchedSuggestionsByRepo(repositoryId: string) {
  const repoRoutes = await getRoutesByRepo(repositoryId);
  if (repoRoutes.length === 0) return [];

  const routeIds = repoRoutes.map(r => r.id);
  const suggestions = await db
    .select({
      id: routeTestSuggestions.id,
      routeId: routeTestSuggestions.routeId,
      suggestion: routeTestSuggestions.suggestion,
      matchedTestId: routeTestSuggestions.matchedTestId,
      createdAt: routeTestSuggestions.createdAt,
      routePath: routes.path,
    })
    .from(routeTestSuggestions)
    .innerJoin(routes, eq(routeTestSuggestions.routeId, routes.id))
    .where(inArray(routeTestSuggestions.routeId, routeIds))
    .all();

  return suggestions.filter(s => !s.matchedTestId);
}

// Background Jobs
export async function createBackgroundJob(data: {
  type: BackgroundJobType;
  label: string;
  totalSteps?: number;
  repositoryId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const id = uuid();
  const now = new Date();
  await db.insert(backgroundJobs).values({
    id,
    type: data.type,
    status: 'pending',
    label: data.label,
    totalSteps: data.totalSteps ?? null,
    completedSteps: 0,
    progress: 0,
    repositoryId: data.repositoryId ?? null,
    metadata: data.metadata ?? null,
    createdAt: now,
  });
  return { id };
}

export async function updateBackgroundJob(id: string, data: Partial<NewBackgroundJob>) {
  await db.update(backgroundJobs).set(data).where(eq(backgroundJobs.id, id));
}

export async function getActiveBackgroundJobs() {
  return db
    .select()
    .from(backgroundJobs)
    .where(or(eq(backgroundJobs.status, 'pending'), eq(backgroundJobs.status, 'running')))
    .orderBy(desc(backgroundJobs.createdAt))
    .all();
}

export async function getRecentBackgroundJobs(sinceMs = 10000) {
  const since = new Date(Date.now() - sinceMs);
  return db
    .select()
    .from(backgroundJobs)
    .where(
      or(
        or(eq(backgroundJobs.status, 'pending'), eq(backgroundJobs.status, 'running')),
        and(
          or(eq(backgroundJobs.status, 'completed'), eq(backgroundJobs.status, 'failed')),
          gte(backgroundJobs.completedAt, since)
        )
      )
    )
    .orderBy(desc(backgroundJobs.createdAt))
    .all();
}
