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
  scanStatus,
} from './schema';
import {
  DEFAULT_SELECTOR_PRIORITY,
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
  NewScanStatus,
  BuildStatus,
  SelectorConfig,
} from './schema';

export { DEFAULT_SELECTOR_PRIORITY };
import { eq, desc, and, inArray } from 'drizzle-orm';
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
  await db.delete(tests).where(eq(tests.id, id));
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

// Visual Diffs
export async function getVisualDiffsByBuild(buildId: string) {
  return db.select().from(visualDiffs).where(eq(visualDiffs.buildId, buildId)).all();
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
export async function getActiveBaseline(testId: string, branch: string) {
  return db
    .select()
    .from(baselines)
    .where(
      and(
        eq(baselines.testId, testId),
        eq(baselines.branch, branch),
        eq(baselines.isActive, true)
      )
    )
    .get();
}

export async function getBaselineByHash(testId: string, imageHash: string) {
  return db
    .select()
    .from(baselines)
    .where(
      and(
        eq(baselines.testId, testId),
        eq(baselines.imageHash, imageHash),
        eq(baselines.isActive, true)
      )
    )
    .get();
}

export async function createBaseline(data: Omit<NewBaseline, 'id'>) {
  const id = uuid();
  await db.insert(baselines).values({ ...data, id, createdAt: new Date() });
  return { id, ...data, createdAt: new Date() };
}

export async function deactivateBaselines(testId: string, branch: string) {
  await db
    .update(baselines)
    .set({ isActive: false })
    .where(and(eq(baselines.testId, testId), eq(baselines.branch, branch)));
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

// Get test results with test info (name, pathType) for a run
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
      testPathType: tests.pathType,
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
  const withTests = allRoutes.filter(r => r.hasTest).length;
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
