import { db } from './index';
import {
  functionalAreas,
  tests,
  testRuns,
  testResults,
  builds,
  visualDiffs,
  baselines,
  plannedScreenshots,
  ignoreRegions,
  pullRequests,
  githubAccounts,
  gitlabAccounts,
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
  testVersions,
  suites,
  suiteTests,
  notificationSettings,
  selectorStats,
  teams,
  users,
  sessions,
  oauthAccounts,
  passwordResetTokens,
  emailVerificationTokens,
  userInvitations,
  runners,
  setupScripts,
  setupConfigs,
  defaultSetupSteps,
} from './schema';
import {
  DEFAULT_SELECTOR_PRIORITY,
  DEFAULT_DIFF_THRESHOLDS,
  DEFAULT_AI_SETTINGS,
  DEFAULT_RECORDING_ENGINES,
  DEFAULT_NOTIFICATION_SETTINGS,
  DEFAULT_STABILIZATION_SETTINGS,
} from './schema';
import type {
  NewFunctionalArea,
  NewTest,
  NewTestRun,
  NewTestResult,
  NewBuild,
  NewVisualDiff,
  NewBaseline,
  NewPlannedScreenshot,
  NewIgnoreRegion,
  NewPullRequest,
  NewGithubAccount,
  NewGitlabAccount,
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
  NewTestVersion,
  NewSuite,
  NewSuiteTest,
  NewNotificationSettings,
  NewSelectorStat,
  NewTeam,
  NewUser,
  NewSession,
  NewOAuthAccount,
  NewPasswordResetToken,
  NewUserInvitation,
  NewRunner,
  NewSetupScript,
  NewSetupConfig,
  NewDefaultSetupStep,
  Team,
  User,
  Runner,
  RunnerStatus,
  BuildStatus,
  SelectorConfig,
  AIProvider,
  BackgroundJobType,
  BackgroundJobStatus,
  TestChangeReason,
  UserRole,
  SetupScriptType,
} from './schema';

export { DEFAULT_SELECTOR_PRIORITY, DEFAULT_DIFF_THRESHOLDS, DEFAULT_AI_SETTINGS, DEFAULT_RECORDING_ENGINES, DEFAULT_NOTIFICATION_SETTINGS };
import { eq, desc, and, inArray, or, gte, lt, isNull } from 'drizzle-orm';
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

  // Create initial version (version 1)
  await db.insert(testVersions).values({
    id: uuid(),
    testId: id,
    version: 1,
    code: data.code,
    name: data.name,
    targetUrl: data.targetUrl ?? null,
    changeReason: 'initial',
    createdAt: now,
  });

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
      plannedImagePath: visualDiffs.plannedImagePath,
      plannedDiffImagePath: visualDiffs.plannedDiffImagePath,
      plannedPixelDifference: visualDiffs.plannedPixelDifference,
      plannedPercentageDifference: visualDiffs.plannedPercentageDifference,
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

// GitLab Accounts
export async function getGitlabAccount() {
  return db.select().from(gitlabAccounts).get();
}

export async function getGitlabAccountByTeam(teamId: string) {
  return db.select().from(gitlabAccounts).where(eq(gitlabAccounts.teamId, teamId)).get();
}

export async function createGitlabAccount(data: Omit<NewGitlabAccount, 'id'>) {
  const id = uuid();
  await db.insert(gitlabAccounts).values({ ...data, id, createdAt: new Date() });
  return { id, ...data, createdAt: new Date() };
}

export async function updateGitlabAccount(id: string, data: Partial<NewGitlabAccount>) {
  await db.update(gitlabAccounts).set(data).where(eq(gitlabAccounts.id, id));
}

export async function deleteGitlabAccount(id: string) {
  await db.delete(gitlabAccounts).where(eq(gitlabAccounts.id, id));
}

export async function updateGitlabSelectedRepository(accountId: string, repositoryId: string | null) {
  await db.update(gitlabAccounts).set({ selectedRepositoryId: repositoryId }).where(eq(gitlabAccounts.id, accountId));
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

export async function getRepositoryByGitlabProjectId(gitlabProjectId: number) {
  return db.select().from(repositories).where(eq(repositories.gitlabProjectId, gitlabProjectId)).get();
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

export async function getSelectedRepository(teamId?: string) {
  const account = teamId ? await getGithubAccountByTeam(teamId) : await getGithubAccount();
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

// Helper to merge saved selector priority with defaults (adds new types)
function mergeSelectorPriority(saved: SelectorConfig[] | null | undefined): SelectorConfig[] {
  if (!saved || saved.length === 0) return DEFAULT_SELECTOR_PRIORITY;

  const savedTypes = new Set(saved.map(s => s.type));
  const maxPriority = Math.max(...saved.map(s => s.priority));

  // Add any new selector types from defaults that aren't in saved
  const newTypes = DEFAULT_SELECTOR_PRIORITY.filter(d => !savedTypes.has(d.type));
  if (newTypes.length === 0) return saved;

  return [
    ...saved,
    ...newTypes.map((t, i) => ({ ...t, priority: maxPriority + 1 + i })),
  ];
}

// Playwright Settings
export async function getPlaywrightSettings(repositoryId?: string | null) {
  if (repositoryId) {
    const settings = await db
      .select()
      .from(playwrightSettings)
      .where(eq(playwrightSettings.repositoryId, repositoryId))
      .get();
    if (settings) {
      return {
        ...settings,
        selectorPriority: mergeSelectorPriority(settings.selectorPriority),
        enabledRecordingEngines: settings.enabledRecordingEngines ?? DEFAULT_RECORDING_ENGINES,
        defaultRecordingEngine: settings.defaultRecordingEngine ?? 'lastest',
        stabilization: settings.stabilization ?? DEFAULT_STABILIZATION_SETTINGS,
      };
    }
  }

  // Return global settings (no repositoryId) or defaults
  const globalSettings = await db
    .select()
    .from(playwrightSettings)
    .where(isNull(playwrightSettings.repositoryId))
    .get();

  if (globalSettings) {
    return {
      ...globalSettings,
      selectorPriority: mergeSelectorPriority(globalSettings.selectorPriority),
      enabledRecordingEngines: globalSettings.enabledRecordingEngines ?? DEFAULT_RECORDING_ENGINES,
      defaultRecordingEngine: globalSettings.defaultRecordingEngine ?? 'lastest',
      stabilization: globalSettings.stabilization ?? DEFAULT_STABILIZATION_SETTINGS,
    };
  }

  // Return default settings object (not saved)
  return {
    id: '',
    repositoryId: null,
    selectorPriority: DEFAULT_SELECTOR_PRIORITY,
    browser: 'chromium' as const,
    viewportWidth: 1280,
    viewportHeight: 720,
    headlessMode: 'true' as const,
    navigationTimeout: 30000,
    actionTimeout: 5000,
    pointerGestures: false,
    cursorFPS: 30,
    enabledRecordingEngines: DEFAULT_RECORDING_ENGINES,
    defaultRecordingEngine: 'lastest' as const,
    freezeAnimations: false,
    screenshotDelay: 0,
    maxParallelTests: 1,
    stabilization: DEFAULT_STABILIZATION_SETTINGS,
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
  const whereClause = repositoryId
    ? eq(playwrightSettings.repositoryId, repositoryId)
    : isNull(playwrightSettings.repositoryId);

  const existing = await db
    .select()
    .from(playwrightSettings)
    .where(whereClause)
    .get();

  if (existing) {
    await updatePlaywrightSettings(existing.id, data);
    return { ...existing, ...data, updatedAt: new Date() };
  } else {
    return createPlaywrightSettings({ ...data, repositoryId: repositoryId ?? undefined });
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
  const whereClause = repositoryId
    ? eq(environmentConfigs.repositoryId, repositoryId)
    : isNull(environmentConfigs.repositoryId);

  const existing = await db
    .select()
    .from(environmentConfigs)
    .where(whereClause)
    .get();

  if (existing) {
    await updateEnvironmentConfig(existing.id, data);
    return { ...existing, ...data, updatedAt: new Date() };
  } else {
    return createEnvironmentConfig({ ...data, repositoryId: repositoryId ?? undefined });
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
    includeAntiAliasing: DEFAULT_DIFF_THRESHOLDS.includeAntiAliasing,
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
  const whereClause = repositoryId
    ? eq(diffSensitivitySettings.repositoryId, repositoryId)
    : isNull(diffSensitivitySettings.repositoryId);

  const existing = await db
    .select()
    .from(diffSensitivitySettings)
    .where(whereClause)
    .get();

  if (existing) {
    await updateDiffSensitivitySettings(existing.id, data);
    return { ...existing, ...data, updatedAt: new Date() };
  } else {
    return createDiffSensitivitySettings({ ...data, repositoryId: repositoryId ?? undefined });
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
    agentSdkPermissionMode: DEFAULT_AI_SETTINGS.agentSdkPermissionMode,
    agentSdkWorkingDir: null,
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
  const whereClause = repositoryId
    ? eq(aiSettings.repositoryId, repositoryId)
    : isNull(aiSettings.repositoryId);

  const existing = await db
    .select()
    .from(aiSettings)
    .where(whereClause)
    .get();

  if (existing) {
    await updateAISettings(existing.id, data);
    return { ...existing, ...data, updatedAt: new Date() };
  } else {
    return createAISettings({ ...data, repositoryId: repositoryId ?? undefined });
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

// Counts for setup guide
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

export async function getBackgroundJob(id: string) {
  return db.select().from(backgroundJobs).where(eq(backgroundJobs.id, id)).get();
}

export async function getPendingBuildJobs(repositoryId?: string | null) {
  const conditions = [
    eq(backgroundJobs.status, 'pending'),
    eq(backgroundJobs.type, 'build_run'),
  ];
  if (repositoryId) {
    conditions.push(eq(backgroundJobs.repositoryId, repositoryId));
  }
  return db
    .select()
    .from(backgroundJobs)
    .where(and(...conditions))
    .orderBy(backgroundJobs.createdAt)
    .all();
}

export async function markStaleJobsAsCrashed(staleThresholdMs = 300000) {
  const threshold = new Date(Date.now() - staleThresholdMs);
  // Check lastActivityAt first (if set), otherwise fall back to startedAt
  // This prevents killing jobs that are actively making progress
  const staleJobs = await db
    .select()
    .from(backgroundJobs)
    .where(
      and(
        eq(backgroundJobs.status, 'running'),
        or(
          // Job has lastActivityAt set and it's stale
          and(
            backgroundJobs.lastActivityAt,
            lt(backgroundJobs.lastActivityAt, threshold)
          ),
          // Job has no lastActivityAt (legacy) and startedAt is stale
          and(
            isNull(backgroundJobs.lastActivityAt),
            lt(backgroundJobs.startedAt, threshold)
          )
        )
      )
    )
    .all();

  const now = new Date();
  for (const job of staleJobs) {
    await db.update(backgroundJobs).set({
      status: 'failed',
      error: 'Job timed out (no progress for 5 minutes)',
      completedAt: now,
    }).where(eq(backgroundJobs.id, job.id));

    // Also update associated build and test run if this is a build_run job
    if (job.type === 'build_run' && job.metadata) {
      const meta = job.metadata as { buildId?: string; testRunId?: string };
      if (meta.buildId) {
        await db.update(builds).set({
          overallStatus: 'blocked',
          completedAt: now,
        }).where(eq(builds.id, meta.buildId));
      }
      if (meta.testRunId) {
        await db.update(testRuns).set({
          status: 'failed',
          completedAt: now,
        }).where(eq(testRuns.id, meta.testRunId));
      }
    }
  }

  return staleJobs.length;
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

export async function createTestVersion(data: Omit<NewTestVersion, 'id'>) {
  const id = uuid();
  await db.insert(testVersions).values({ ...data, id, createdAt: new Date() });
  return { id, ...data, createdAt: new Date() };
}

// Update test with versioning - saves current state before updating
export async function updateTestWithVersion(
  id: string,
  data: Partial<NewTest>,
  changeReason?: TestChangeReason | string
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
  });

  // Update the test
  await db.update(tests).set({ ...data, updatedAt: new Date() }).where(eq(tests.id, id));
}

// Suites
export async function getSuites(repositoryId?: string | null) {
  if (repositoryId) {
    return db.select().from(suites).where(eq(suites.repositoryId, repositoryId)).orderBy(desc(suites.createdAt)).all();
  }
  return db.select().from(suites).orderBy(desc(suites.createdAt)).all();
}

export async function getSuite(id: string) {
  return db.select().from(suites).where(eq(suites.id, id)).get();
}

export async function createSuite(data: Omit<NewSuite, 'id' | 'createdAt' | 'updatedAt'>) {
  const id = uuid();
  const now = new Date();
  await db.insert(suites).values({ ...data, id, createdAt: now, updatedAt: now });
  return { id, ...data, createdAt: now, updatedAt: now };
}

export async function updateSuite(id: string, data: Partial<NewSuite>) {
  await db.update(suites).set({ ...data, updatedAt: new Date() }).where(eq(suites.id, id));
}

export async function deleteSuite(id: string) {
  // Suite tests are cascade deleted via FK
  await db.delete(suites).where(eq(suites.id, id));
}

// Suite Tests
export async function getSuiteTests(suiteId: string) {
  return db
    .select({
      id: suiteTests.id,
      suiteId: suiteTests.suiteId,
      testId: suiteTests.testId,
      orderIndex: suiteTests.orderIndex,
      createdAt: suiteTests.createdAt,
      testName: tests.name,
      testCode: tests.code,
      targetUrl: tests.targetUrl,
      functionalAreaId: tests.functionalAreaId,
    })
    .from(suiteTests)
    .innerJoin(tests, eq(suiteTests.testId, tests.id))
    .where(eq(suiteTests.suiteId, suiteId))
    .orderBy(suiteTests.orderIndex)
    .all();
}

export async function addTestToSuite(suiteId: string, testId: string, orderIndex?: number) {
  // Get current max order if not provided
  let order = orderIndex;
  if (order === undefined) {
    const existing = await db
      .select({ maxOrder: suiteTests.orderIndex })
      .from(suiteTests)
      .where(eq(suiteTests.suiteId, suiteId))
      .orderBy(desc(suiteTests.orderIndex))
      .limit(1)
      .get();
    order = (existing?.maxOrder ?? -1) + 1;
  }

  const id = uuid();
  await db.insert(suiteTests).values({
    id,
    suiteId,
    testId,
    orderIndex: order,
    createdAt: new Date(),
  });
  return { id, suiteId, testId, orderIndex: order };
}

export async function addTestsToSuite(suiteId: string, testIds: string[]) {
  // Get current max order
  const existing = await db
    .select({ maxOrder: suiteTests.orderIndex })
    .from(suiteTests)
    .where(eq(suiteTests.suiteId, suiteId))
    .orderBy(desc(suiteTests.orderIndex))
    .limit(1)
    .get();
  let order = (existing?.maxOrder ?? -1) + 1;

  const toInsert = testIds.map((testId) => ({
    id: uuid(),
    suiteId,
    testId,
    orderIndex: order++,
    createdAt: new Date(),
  }));

  if (toInsert.length > 0) {
    await db.insert(suiteTests).values(toInsert);
  }
  return toInsert;
}

export async function removeTestFromSuite(suiteId: string, testId: string) {
  await db
    .delete(suiteTests)
    .where(and(eq(suiteTests.suiteId, suiteId), eq(suiteTests.testId, testId)));
}

export async function reorderSuiteTests(suiteId: string, orderedTestIds: string[]) {
  // Update order for each test
  for (let i = 0; i < orderedTestIds.length; i++) {
    await db
      .update(suiteTests)
      .set({ orderIndex: i })
      .where(and(eq(suiteTests.suiteId, suiteId), eq(suiteTests.testId, orderedTestIds[i])));
  }
}

export async function getSuiteWithTests(id: string) {
  const suite = await getSuite(id);
  if (!suite) return null;
  const suiteTestList = await getSuiteTests(id);
  return { ...suite, tests: suiteTestList };
}

// Functional Areas Tree
export interface FunctionalAreaWithChildren {
  id: string;
  repositoryId: string | null;
  name: string;
  description: string | null;
  parentId: string | null;
  isRouteFolder: boolean | null;
  orderIndex: number | null;
  children: FunctionalAreaWithChildren[];
  tests: { id: string; name: string; latestStatus: string | null }[];
  suites: { id: string; name: string; description: string | null; testCount: number }[];
}

export async function getFunctionalAreasTree(repositoryId: string): Promise<FunctionalAreaWithChildren[]> {
  const areas = await db
    .select()
    .from(functionalAreas)
    .where(eq(functionalAreas.repositoryId, repositoryId))
    .orderBy(functionalAreas.orderIndex)
    .all();

  const allTests = await getTestsByRepo(repositoryId);
  const testsByArea = new Map<string, typeof allTests>();

  for (const test of allTests) {
    if (test.functionalAreaId) {
      const existing = testsByArea.get(test.functionalAreaId) || [];
      existing.push(test);
      testsByArea.set(test.functionalAreaId, existing);
    }
  }

  // Get all suites with their test counts
  const allSuites = await getSuites(repositoryId);
  const suitesByArea = new Map<string, typeof allSuites>();

  for (const suite of allSuites) {
    if (suite.functionalAreaId) {
      const existing = suitesByArea.get(suite.functionalAreaId) || [];
      existing.push(suite);
      suitesByArea.set(suite.functionalAreaId, existing);
    }
  }

  // Get test counts for suites
  const suiteTestCounts = new Map<string, number>();
  for (const suite of allSuites) {
    const suiteTestList = await getSuiteTests(suite.id);
    suiteTestCounts.set(suite.id, suiteTestList.length);
  }

  // Get latest status for each test
  const testsWithStatus = await Promise.all(
    allTests.map(async (test) => {
      const results = await getTestResultsByTest(test.id);
      return { id: test.id, name: test.name, latestStatus: results[0]?.status || null };
    })
  );
  const statusMap = new Map(testsWithStatus.map(t => [t.id, t.latestStatus]));

  // Build tree structure
  const areaMap = new Map<string, FunctionalAreaWithChildren>();
  const rootAreas: FunctionalAreaWithChildren[] = [];

  for (const area of areas) {
    const areaTests = testsByArea.get(area.id) || [];
    const areaSuites = suitesByArea.get(area.id) || [];
    areaMap.set(area.id, {
      ...area,
      children: [],
      tests: areaTests.map(t => ({ id: t.id, name: t.name, latestStatus: statusMap.get(t.id) || null })),
      suites: areaSuites.map(s => ({ id: s.id, name: s.name, description: s.description, testCount: suiteTestCounts.get(s.id) || 0 })),
    });
  }

  for (const area of areas) {
    const node = areaMap.get(area.id)!;
    if (area.parentId && areaMap.has(area.parentId)) {
      areaMap.get(area.parentId)!.children.push(node);
    } else {
      rootAreas.push(node);
    }
  }

  return rootAreas;
}

export async function updateFunctionalAreaParent(id: string, parentId: string | null) {
  await db.update(functionalAreas).set({ parentId }).where(eq(functionalAreas.id, id));
}

export async function reorderFunctionalAreas(repositoryId: string, orderedIds: string[]) {
  for (let i = 0; i < orderedIds.length; i++) {
    await db
      .update(functionalAreas)
      .set({ orderIndex: i })
      .where(and(eq(functionalAreas.id, orderedIds[i]), eq(functionalAreas.repositoryId, repositoryId)));
  }
}

export async function getOrCreateRoutesFolder(repositoryId: string) {
  const existing = await db
    .select()
    .from(functionalAreas)
    .where(and(eq(functionalAreas.repositoryId, repositoryId), eq(functionalAreas.name, 'Routes'), eq(functionalAreas.isRouteFolder, true)))
    .get();

  if (existing) return existing;

  const id = uuid();
  await db.insert(functionalAreas).values({
    id,
    repositoryId,
    name: 'Routes',
    description: 'Auto-generated folder containing discovered routes',
    isRouteFolder: true,
    orderIndex: 0,
  });

  return { id, repositoryId, name: 'Routes', description: 'Auto-generated folder containing discovered routes', parentId: null, isRouteFolder: true, orderIndex: 0 };
}

export async function moveTestToArea(testId: string, areaId: string | null) {
  await db.update(tests).set({ functionalAreaId: areaId, updatedAt: new Date() }).where(eq(tests.id, testId));
}

export async function moveSuiteToArea(suiteId: string, areaId: string | null) {
  await db.update(suites).set({ functionalAreaId: areaId, updatedAt: new Date() }).where(eq(suites.id, suiteId));
}

export async function getSuitesByArea(areaId: string) {
  return db.select().from(suites).where(eq(suites.functionalAreaId, areaId)).orderBy(suites.orderIndex).all();
}

export async function getUnsortedSuites(repositoryId: string) {
  return db
    .select()
    .from(suites)
    .where(and(eq(suites.repositoryId, repositoryId), isNull(suites.functionalAreaId)))
    .orderBy(suites.orderIndex)
    .all();
}

// Get visual diffs for a specific test result (step-level diffs)
export async function getVisualDiffsByTestResult(testResultId: string) {
  return db.select().from(visualDiffs).where(eq(visualDiffs.testResultId, testResultId)).all();
}

// Notification Settings
export async function getNotificationSettings(repositoryId?: string | null) {
  if (repositoryId) {
    const settings = await db
      .select()
      .from(notificationSettings)
      .where(eq(notificationSettings.repositoryId, repositoryId))
      .get();
    if (settings) return settings;
  }

  // Return global settings (no repositoryId) or defaults
  const globalSettings = await db
    .select()
    .from(notificationSettings)
    .where(isNull(notificationSettings.repositoryId))
    .get();

  if (globalSettings) return globalSettings;

  // Return default settings object (not saved)
  return {
    id: '',
    repositoryId: null,
    slackWebhookUrl: null,
    slackEnabled: DEFAULT_NOTIFICATION_SETTINGS.slackEnabled,
    discordWebhookUrl: null,
    discordEnabled: DEFAULT_NOTIFICATION_SETTINGS.discordEnabled,
    githubPrCommentsEnabled: DEFAULT_NOTIFICATION_SETTINGS.githubPrCommentsEnabled,
    gitlabMrCommentsEnabled: DEFAULT_NOTIFICATION_SETTINGS.gitlabMrCommentsEnabled,
    customWebhookEnabled: DEFAULT_NOTIFICATION_SETTINGS.customWebhookEnabled,
    customWebhookUrl: null,
    customWebhookMethod: DEFAULT_NOTIFICATION_SETTINGS.customWebhookMethod,
    customWebhookHeaders: null,
    createdAt: null,
    updatedAt: null,
  };
}

export async function createNotificationSettings(data: Omit<NewNotificationSettings, 'id' | 'createdAt' | 'updatedAt'>) {
  const id = uuid();
  const now = new Date();
  await db.insert(notificationSettings).values({
    ...data,
    id,
    createdAt: now,
    updatedAt: now,
  });
  return { id, ...data, createdAt: now, updatedAt: now };
}

export async function updateNotificationSettings(id: string, data: Partial<NewNotificationSettings>) {
  await db.update(notificationSettings).set({ ...data, updatedAt: new Date() }).where(eq(notificationSettings.id, id));
}

export async function upsertNotificationSettings(repositoryId: string | null, data: Partial<NewNotificationSettings>) {
  const whereClause = repositoryId
    ? eq(notificationSettings.repositoryId, repositoryId)
    : isNull(notificationSettings.repositoryId);

  const existing = await db
    .select()
    .from(notificationSettings)
    .where(whereClause)
    .get();

  if (existing) {
    await updateNotificationSettings(existing.id, data);
    return { ...existing, ...data, updatedAt: new Date() };
  } else {
    return createNotificationSettings({ ...data, repositoryId: repositoryId ?? undefined });
  }
}

// Selector Stats - for optimizing fallback selector strategy
export async function getSelectorStats(testId: string, selectorArrayHash: string) {
  return db
    .select()
    .from(selectorStats)
    .where(and(eq(selectorStats.testId, testId), eq(selectorStats.selectorArrayHash, selectorArrayHash)))
    .all();
}

export async function recordSelectorSuccess(
  testId: string,
  selectorArrayHash: string,
  selectorType: string,
  selectorValue: string,
  responseTimeMs: number
) {
  const now = new Date();
  const existing = await db
    .select()
    .from(selectorStats)
    .where(
      and(
        eq(selectorStats.testId, testId),
        eq(selectorStats.selectorArrayHash, selectorArrayHash),
        eq(selectorStats.selectorType, selectorType),
        eq(selectorStats.selectorValue, selectorValue)
      )
    )
    .get();

  if (existing) {
    const newSuccessCount = (existing.successCount ?? 0) + 1;
    const newTotalAttempts = (existing.totalAttempts ?? 0) + 1;
    const oldAvg = existing.avgResponseTimeMs ?? responseTimeMs;
    const newAvg = Math.round((oldAvg * (newSuccessCount - 1) + responseTimeMs) / newSuccessCount);

    await db
      .update(selectorStats)
      .set({
        successCount: newSuccessCount,
        totalAttempts: newTotalAttempts,
        avgResponseTimeMs: newAvg,
        lastUsedAt: now,
      })
      .where(eq(selectorStats.id, existing.id));
  } else {
    await db.insert(selectorStats).values({
      id: uuid(),
      testId,
      selectorArrayHash,
      selectorType,
      selectorValue,
      successCount: 1,
      failureCount: 0,
      totalAttempts: 1,
      avgResponseTimeMs: responseTimeMs,
      lastUsedAt: now,
      createdAt: now,
    });
  }
}

export async function recordSelectorFailure(
  testId: string,
  selectorArrayHash: string,
  selectorType: string,
  selectorValue: string
) {
  const now = new Date();
  const existing = await db
    .select()
    .from(selectorStats)
    .where(
      and(
        eq(selectorStats.testId, testId),
        eq(selectorStats.selectorArrayHash, selectorArrayHash),
        eq(selectorStats.selectorType, selectorType),
        eq(selectorStats.selectorValue, selectorValue)
      )
    )
    .get();

  if (existing) {
    await db
      .update(selectorStats)
      .set({
        failureCount: (existing.failureCount ?? 0) + 1,
        totalAttempts: (existing.totalAttempts ?? 0) + 1,
        lastUsedAt: now,
      })
      .where(eq(selectorStats.id, existing.id));
  } else {
    await db.insert(selectorStats).values({
      id: uuid(),
      testId,
      selectorArrayHash,
      selectorType,
      selectorValue,
      successCount: 0,
      failureCount: 1,
      totalAttempts: 1,
      avgResponseTimeMs: null,
      lastUsedAt: now,
      createdAt: now,
    });
  }
}

// Aggregated selector stats by selectorType for a repository
export interface SelectorTypeStats {
  selectorType: string;
  totalSuccesses: number;
  totalFailures: number;
  totalAttempts: number;
  avgResponseTimeMs: number | null;
  successRate: number; // 0-100
}

export async function getAggregatedSelectorStats(repositoryId: string): Promise<SelectorTypeStats[]> {
  // Get all tests for this repository
  const repoTests = await db
    .select({ id: tests.id })
    .from(tests)
    .where(eq(tests.repositoryId, repositoryId))
    .all();

  if (repoTests.length === 0) {
    return [];
  }

  const testIds = repoTests.map((t) => t.id);

  // Get all selector stats for these tests
  const stats = await db
    .select()
    .from(selectorStats)
    .where(inArray(selectorStats.testId, testIds))
    .all();

  // Aggregate by selectorType
  const aggregated = new Map<
    string,
    { successes: number; failures: number; attempts: number; responseTimeSum: number; responseTimeCount: number }
  >();

  for (const stat of stats) {
    const existing = aggregated.get(stat.selectorType) || {
      successes: 0,
      failures: 0,
      attempts: 0,
      responseTimeSum: 0,
      responseTimeCount: 0,
    };

    existing.successes += stat.successCount ?? 0;
    existing.failures += stat.failureCount ?? 0;
    existing.attempts += stat.totalAttempts ?? 0;
    if (stat.avgResponseTimeMs != null && stat.successCount != null && stat.successCount > 0) {
      existing.responseTimeSum += stat.avgResponseTimeMs * stat.successCount;
      existing.responseTimeCount += stat.successCount;
    }

    aggregated.set(stat.selectorType, existing);
  }

  // Convert to result array
  const result: SelectorTypeStats[] = [];
  for (const [selectorType, data] of aggregated) {
    const successRate = data.attempts > 0 ? Math.round((data.successes / data.attempts) * 100) : 0;
    const avgResponseTimeMs =
      data.responseTimeCount > 0 ? Math.round(data.responseTimeSum / data.responseTimeCount) : null;

    result.push({
      selectorType,
      totalSuccesses: data.successes,
      totalFailures: data.failures,
      totalAttempts: data.attempts,
      avgResponseTimeMs,
      successRate,
    });
  }

  return result;
}

// ============================================
// Team Management
// ============================================

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);
}

export async function createTeam(data: { name: string; slug?: string }): Promise<Team> {
  const id = uuid();
  const now = new Date();
  let slug = data.slug || generateSlug(data.name);

  // Ensure slug is unique
  let existing = await getTeamBySlug(slug);
  let counter = 1;
  while (existing) {
    slug = `${generateSlug(data.name)}-${counter}`;
    existing = await getTeamBySlug(slug);
    counter++;
  }

  await db.insert(teams).values({
    id,
    name: data.name,
    slug,
    createdAt: now,
    updatedAt: now,
  });

  const team = await getTeam(id);
  if (!team) throw new Error('Failed to create team');
  return team;
}

export async function getTeam(id: string) {
  return db.select().from(teams).where(eq(teams.id, id)).get();
}

export async function getTeamBySlug(slug: string) {
  return db.select().from(teams).where(eq(teams.slug, slug)).get();
}

export async function updateTeam(id: string, data: Partial<NewTeam>) {
  await db.update(teams).set({ ...data, updatedAt: new Date() }).where(eq(teams.id, id));
}

export async function deleteTeam(id: string) {
  await db.delete(teams).where(eq(teams.id, id));
}

export async function getTeamMembers(teamId: string) {
  return db.select().from(users).where(eq(users.teamId, teamId)).orderBy(desc(users.createdAt)).all();
}

export async function getUsersByTeam(teamId: string) {
  return getTeamMembers(teamId);
}

export async function removeUserFromTeam(userId: string) {
  await db.update(users).set({ teamId: null, updatedAt: new Date() }).where(eq(users.id, userId));
}

// Team-scoped repositories
export async function getRepositoriesByTeam(teamId: string) {
  return db.select().from(repositories).where(eq(repositories.teamId, teamId)).orderBy(desc(repositories.createdAt)).all();
}

// Team-scoped GitHub account
export async function getGithubAccountByTeam(teamId: string) {
  return db.select().from(githubAccounts).where(eq(githubAccounts.teamId, teamId)).get();
}

// Team-scoped invitations
export async function getPendingInvitationsByTeam(teamId: string) {
  const now = new Date();
  return db
    .select()
    .from(userInvitations)
    .where(and(eq(userInvitations.teamId, teamId), isNull(userInvitations.acceptedAt), gte(userInvitations.expiresAt, now)))
    .orderBy(desc(userInvitations.createdAt))
    .all();
}

// ============================================
// User Management
// ============================================

export async function getUsers() {
  return db.select().from(users).orderBy(desc(users.createdAt)).all();
}

export async function getUserById(id: string) {
  return db.select().from(users).where(eq(users.id, id)).get();
}

export async function getUserByEmail(email: string) {
  return db.select().from(users).where(eq(users.email, email.toLowerCase())).get();
}

export async function getUserCount() {
  const result = await db.select({ id: users.id }).from(users).all();
  return result.length;
}

export async function createUser(data: Omit<NewUser, 'id' | 'createdAt' | 'updatedAt'>): Promise<User> {
  const id = uuid();
  const now = new Date();
  await db.insert(users).values({
    ...data,
    id,
    email: data.email.toLowerCase(),
    createdAt: now,
    updatedAt: now,
  });
  // Fetch the created user to get a properly typed User object
  const user = await getUserById(id);
  if (!user) {
    throw new Error('Failed to create user');
  }
  return user;
}

export async function updateUser(id: string, data: Partial<NewUser>) {
  await db.update(users).set({ ...data, updatedAt: new Date() }).where(eq(users.id, id));
}

export async function deleteUser(id: string) {
  await db.delete(users).where(eq(users.id, id));
}

export async function updateUserRole(id: string, role: UserRole) {
  await db.update(users).set({ role, updatedAt: new Date() }).where(eq(users.id, id));
}

// ============================================
// Sessions
// ============================================

export async function getSessionByToken(token: string) {
  return db.select().from(sessions).where(eq(sessions.token, token)).get();
}

export async function getSessionWithUser(token: string) {
  const result = await db
    .select({
      session: sessions,
      user: users,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.token, token))
    .get();
  return result;
}

export async function createSession(data: Omit<NewSession, 'id' | 'createdAt'>) {
  const id = uuid();
  const now = new Date();
  await db.insert(sessions).values({ ...data, id, createdAt: now });
  return { id, ...data, createdAt: now };
}

export async function deleteSession(token: string) {
  await db.delete(sessions).where(eq(sessions.token, token));
}

export async function deleteSessionsByUser(userId: string) {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

export async function deleteExpiredSessions() {
  const now = new Date();
  await db.delete(sessions).where(lt(sessions.expiresAt, now));
}

// ============================================
// OAuth Accounts
// ============================================

export async function getOAuthAccount(provider: string, providerAccountId: string) {
  return db
    .select()
    .from(oauthAccounts)
    .where(
      and(
        eq(oauthAccounts.provider, provider),
        eq(oauthAccounts.providerAccountId, providerAccountId)
      )
    )
    .get();
}

export async function getOAuthAccountsByUser(userId: string) {
  return db.select().from(oauthAccounts).where(eq(oauthAccounts.userId, userId)).all();
}

export async function createOAuthAccount(data: Omit<NewOAuthAccount, 'id' | 'createdAt'>) {
  const id = uuid();
  const now = new Date();
  await db.insert(oauthAccounts).values({ ...data, id, createdAt: now });
  return { id, ...data, createdAt: now };
}

export async function updateOAuthAccount(id: string, data: Partial<NewOAuthAccount>) {
  await db.update(oauthAccounts).set(data).where(eq(oauthAccounts.id, id));
}

export async function deleteOAuthAccount(id: string) {
  await db.delete(oauthAccounts).where(eq(oauthAccounts.id, id));
}

// ============================================
// Password Reset Tokens
// ============================================

export async function getPasswordResetToken(token: string) {
  return db.select().from(passwordResetTokens).where(eq(passwordResetTokens.token, token)).get();
}

export async function createPasswordResetToken(userId: string): Promise<string> {
  const id = uuid();
  const token = uuid();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour

  // Delete any existing tokens for this user
  await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, userId));

  await db.insert(passwordResetTokens).values({
    id,
    userId,
    token,
    expiresAt,
    createdAt: now,
  });
  return token;
}

export async function markPasswordResetTokenUsed(token: string) {
  await db
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(eq(passwordResetTokens.token, token));
}

export async function deleteExpiredPasswordResetTokens() {
  const now = new Date();
  await db.delete(passwordResetTokens).where(lt(passwordResetTokens.expiresAt, now));
}

// ============================================
// Email Verification Tokens
// ============================================

export async function getEmailVerificationToken(token: string) {
  return db.select().from(emailVerificationTokens).where(eq(emailVerificationTokens.token, token)).get();
}

export async function createEmailVerificationToken(userId: string): Promise<string> {
  const id = uuid();
  const token = uuid();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours

  // Delete any existing tokens for this user
  await db.delete(emailVerificationTokens).where(eq(emailVerificationTokens.userId, userId));

  await db.insert(emailVerificationTokens).values({
    id,
    userId,
    token,
    expiresAt,
    createdAt: now,
  });
  return token;
}

export async function deleteEmailVerificationToken(token: string) {
  await db.delete(emailVerificationTokens).where(eq(emailVerificationTokens.token, token));
}

// ============================================
// User Invitations
// ============================================

export async function getInvitations() {
  return db.select().from(userInvitations).orderBy(desc(userInvitations.createdAt)).all();
}

export async function getPendingInvitations() {
  const now = new Date();
  return db
    .select()
    .from(userInvitations)
    .where(and(isNull(userInvitations.acceptedAt), gte(userInvitations.expiresAt, now)))
    .orderBy(desc(userInvitations.createdAt))
    .all();
}

export async function getInvitationByToken(token: string) {
  return db.select().from(userInvitations).where(eq(userInvitations.token, token)).get();
}

export async function getInvitationByEmail(email: string) {
  return db.select().from(userInvitations).where(eq(userInvitations.email, email.toLowerCase())).get();
}

export async function createInvitation(data: { email: string; teamId: string; invitedById?: string; role?: UserRole }): Promise<string> {
  const id = uuid();
  const token = uuid();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

  await db.insert(userInvitations).values({
    id,
    teamId: data.teamId,
    email: data.email.toLowerCase(),
    invitedById: data.invitedById ?? null,
    token,
    role: data.role ?? 'member',
    expiresAt,
    createdAt: now,
  });
  return token;
}

export async function markInvitationAccepted(token: string) {
  await db
    .update(userInvitations)
    .set({ acceptedAt: new Date() })
    .where(eq(userInvitations.token, token));
}

export async function deleteInvitation(id: string) {
  await db.delete(userInvitations).where(eq(userInvitations.id, id));
}

export async function deleteExpiredInvitations() {
  const now = new Date();
  await db.delete(userInvitations).where(lt(userInvitations.expiresAt, now));
}

// Runner queries
export async function getRunnerById(runnerId: string) {
  return db.select().from(runners).where(eq(runners.id, runnerId)).get();
}

// ============================================
// Planned Screenshots
// ============================================

export async function createPlannedScreenshot(data: Omit<NewPlannedScreenshot, 'id' | 'createdAt' | 'updatedAt'>) {
  const id = uuid();
  const now = new Date();
  await db.insert(plannedScreenshots).values({
    ...data,
    id,
    createdAt: now,
    updatedAt: now,
  });
  return { id, ...data, createdAt: now, updatedAt: now };
}

export async function getPlannedScreenshot(id: string) {
  return db.select().from(plannedScreenshots).where(eq(plannedScreenshots.id, id)).get();
}

export async function getPlannedScreenshotByTest(testId: string, stepLabel?: string | null) {
  const conditions = [
    eq(plannedScreenshots.testId, testId),
    eq(plannedScreenshots.isActive, true),
  ];
  if (stepLabel) {
    conditions.push(eq(plannedScreenshots.stepLabel, stepLabel));
  } else {
    conditions.push(isNull(plannedScreenshots.stepLabel));
  }
  return db
    .select()
    .from(plannedScreenshots)
    .where(and(...conditions))
    .get();
}

export async function getPlannedScreenshotByRoute(routeId: string) {
  return db
    .select()
    .from(plannedScreenshots)
    .where(and(eq(plannedScreenshots.routeId, routeId), eq(plannedScreenshots.isActive, true)))
    .get();
}

export async function getPlannedScreenshotsByRepo(repositoryId: string) {
  return db
    .select()
    .from(plannedScreenshots)
    .where(and(eq(plannedScreenshots.repositoryId, repositoryId), eq(plannedScreenshots.isActive, true)))
    .orderBy(desc(plannedScreenshots.createdAt))
    .all();
}

export async function getPlannedScreenshotsByTest(testId: string) {
  return db
    .select()
    .from(plannedScreenshots)
    .where(and(eq(plannedScreenshots.testId, testId), eq(plannedScreenshots.isActive, true)))
    .orderBy(plannedScreenshots.stepLabel)
    .all();
}

export async function updatePlannedScreenshot(id: string, data: Partial<NewPlannedScreenshot>) {
  await db.update(plannedScreenshots).set({ ...data, updatedAt: new Date() }).where(eq(plannedScreenshots.id, id));
}

export async function deletePlannedScreenshot(id: string) {
  // Soft delete - mark as inactive
  await db.update(plannedScreenshots).set({ isActive: false, updatedAt: new Date() }).where(eq(plannedScreenshots.id, id));
}

export async function hardDeletePlannedScreenshot(id: string) {
  await db.delete(plannedScreenshots).where(eq(plannedScreenshots.id, id));
}

// Get route with full context for AI test generation
export interface RouteWithContext {
  id: string;
  path: string;
  type: string;
  description: string | null;
  filePath: string | null;
  framework: string | null;
  routerType: string | null;
  functionalAreaId: string | null;
  functionalAreaName: string | null;
  functionalAreaDescription: string | null;
  testSuggestions: string[];
}

export async function getRouteWithContext(routeId: string): Promise<RouteWithContext | null> {
  const route = await db
    .select({
      id: routes.id,
      path: routes.path,
      type: routes.type,
      description: routes.description,
      filePath: routes.filePath,
      framework: routes.framework,
      routerType: routes.routerType,
      functionalAreaId: routes.functionalAreaId,
      functionalAreaName: functionalAreas.name,
      functionalAreaDescription: functionalAreas.description,
    })
    .from(routes)
    .leftJoin(functionalAreas, eq(routes.functionalAreaId, functionalAreas.id))
    .where(eq(routes.id, routeId))
    .get();

  if (!route) return null;

  // Fetch associated test suggestions
  const suggestions = await db
    .select({ suggestion: routeTestSuggestions.suggestion })
    .from(routeTestSuggestions)
    .where(eq(routeTestSuggestions.routeId, routeId))
    .all();

  return {
    ...route,
    testSuggestions: suggestions.map(s => s.suggestion),
  };
}

// ============================================
// Setup Scripts
// ============================================

export async function getSetupScripts(repositoryId: string) {
  return db
    .select()
    .from(setupScripts)
    .where(eq(setupScripts.repositoryId, repositoryId))
    .orderBy(desc(setupScripts.createdAt))
    .all();
}

export async function getSetupScript(id: string) {
  return db.select().from(setupScripts).where(eq(setupScripts.id, id)).get();
}

export async function createSetupScript(data: Omit<NewSetupScript, 'id' | 'createdAt' | 'updatedAt'>) {
  const id = uuid();
  const now = new Date();
  await db.insert(setupScripts).values({
    ...data,
    id,
    createdAt: now,
    updatedAt: now,
  });
  return { id, ...data, createdAt: now, updatedAt: now };
}

export async function updateSetupScript(id: string, data: Partial<NewSetupScript>) {
  await db.update(setupScripts).set({ ...data, updatedAt: new Date() }).where(eq(setupScripts.id, id));
}

export async function deleteSetupScript(id: string) {
  await db.delete(setupScripts).where(eq(setupScripts.id, id));
}

export async function duplicateSetupScript(id: string) {
  const original = await getSetupScript(id);
  if (!original) return null;

  return createSetupScript({
    repositoryId: original.repositoryId ?? undefined,
    name: `${original.name} (Copy)`,
    type: original.type as SetupScriptType,
    code: original.code,
    description: original.description ?? undefined,
  });
}

// ============================================
// Setup Configs (API seeding configuration)
// ============================================

export async function getSetupConfigs(repositoryId: string) {
  return db
    .select()
    .from(setupConfigs)
    .where(eq(setupConfigs.repositoryId, repositoryId))
    .orderBy(desc(setupConfigs.createdAt))
    .all();
}

export async function getSetupConfig(id: string) {
  return db.select().from(setupConfigs).where(eq(setupConfigs.id, id)).get();
}

export async function createSetupConfig(data: Omit<NewSetupConfig, 'id' | 'createdAt' | 'updatedAt'>) {
  const id = uuid();
  const now = new Date();
  await db.insert(setupConfigs).values({
    ...data,
    id,
    createdAt: now,
    updatedAt: now,
  });
  return { id, ...data, createdAt: now, updatedAt: now };
}

export async function updateSetupConfig(id: string, data: Partial<NewSetupConfig>) {
  await db.update(setupConfigs).set({ ...data, updatedAt: new Date() }).where(eq(setupConfigs.id, id));
}

export async function deleteSetupConfig(id: string) {
  await db.delete(setupConfigs).where(eq(setupConfigs.id, id));
}

// ============================================
// Setup-related test/suite/build/repo queries
// ============================================

// Get test with its setup configuration resolved
export async function getTestWithSetup(testId: string) {
  const test = await getTest(testId);
  if (!test) return null;

  let setupTest = null;
  let setupScript = null;

  // Test's own setup takes precedence
  if (test.setupTestId) {
    setupTest = await getTest(test.setupTestId);
  } else if (test.setupScriptId) {
    setupScript = await getSetupScript(test.setupScriptId);
  } else if (test.repositoryId) {
    // Fall back to repository default
    const repo = await getRepository(test.repositoryId);
    if (repo?.defaultSetupTestId) {
      setupTest = await getTest(repo.defaultSetupTestId);
    } else if (repo?.defaultSetupScriptId) {
      setupScript = await getSetupScript(repo.defaultSetupScriptId);
    }
  }

  return { ...test, setupTest, setupScript };
}

// Get suite with its setup configuration
export async function getSuiteWithSetup(suiteId: string) {
  const suite = await getSuite(suiteId);
  if (!suite) return null;

  let setupTest = null;
  let setupScript = null;

  if (suite.setupTestId) {
    setupTest = await getTest(suite.setupTestId);
  } else if (suite.setupScriptId) {
    setupScript = await getSetupScript(suite.setupScriptId);
  }

  return { ...suite, setupTest, setupScript };
}

// Update test setup configuration
export async function updateTestSetup(testId: string, setupTestId: string | null, setupScriptId: string | null) {
  await db.update(tests).set({
    setupTestId,
    setupScriptId,
    updatedAt: new Date(),
  }).where(eq(tests.id, testId));
}

// Update suite setup configuration
export async function updateSuiteSetup(suiteId: string, setupTestId: string | null, setupScriptId: string | null) {
  await db.update(suites).set({
    setupTestId,
    setupScriptId,
    updatedAt: new Date(),
  }).where(eq(suites.id, suiteId));
}

// Update repository default setup configuration
export async function updateRepositoryDefaultSetup(
  repositoryId: string,
  defaultSetupTestId: string | null,
  defaultSetupScriptId: string | null
) {
  await db.update(repositories).set({
    defaultSetupTestId,
    defaultSetupScriptId,
  }).where(eq(repositories.id, repositoryId));
}

// Get tests that use a specific test as their setup
export async function getTestsUsingSetupTest(setupTestId: string) {
  return db
    .select()
    .from(tests)
    .where(eq(tests.setupTestId, setupTestId))
    .all();
}

// Get tests that use a specific setup script
export async function getTestsUsingSetupScript(setupScriptId: string) {
  return db
    .select()
    .from(tests)
    .where(eq(tests.setupScriptId, setupScriptId))
    .all();
}

// Get suites that use a specific test as their setup
export async function getSuitesUsingSetupTest(setupTestId: string) {
  return db
    .select()
    .from(suites)
    .where(eq(suites.setupTestId, setupTestId))
    .all();
}

// Get suites that use a specific setup script
export async function getSuitesUsingSetupScript(setupScriptId: string) {
  return db
    .select()
    .from(suites)
    .where(eq(suites.setupScriptId, setupScriptId))
    .all();
}

// ============================================
// Default Setup Steps (multi-step setup)
// ============================================

export async function getDefaultSetupSteps(repositoryId: string) {
  return db
    .select({
      id: defaultSetupSteps.id,
      repositoryId: defaultSetupSteps.repositoryId,
      stepType: defaultSetupSteps.stepType,
      testId: defaultSetupSteps.testId,
      scriptId: defaultSetupSteps.scriptId,
      orderIndex: defaultSetupSteps.orderIndex,
      createdAt: defaultSetupSteps.createdAt,
      // Join test name
      testName: tests.name,
      // Join script name
      scriptName: setupScripts.name,
    })
    .from(defaultSetupSteps)
    .leftJoin(tests, eq(defaultSetupSteps.testId, tests.id))
    .leftJoin(setupScripts, eq(defaultSetupSteps.scriptId, setupScripts.id))
    .where(eq(defaultSetupSteps.repositoryId, repositoryId))
    .orderBy(defaultSetupSteps.orderIndex)
    .all();
}

export async function createDefaultSetupStep(data: Omit<NewDefaultSetupStep, 'id' | 'createdAt'>) {
  const id = uuid();
  await db.insert(defaultSetupSteps).values({
    ...data,
    id,
    createdAt: new Date(),
  });
  return { id, ...data, createdAt: new Date() };
}

export async function deleteDefaultSetupStep(id: string) {
  await db.delete(defaultSetupSteps).where(eq(defaultSetupSteps.id, id));
}

export async function deleteAllDefaultSetupSteps(repositoryId: string) {
  await db.delete(defaultSetupSteps).where(eq(defaultSetupSteps.repositoryId, repositoryId));
}

export async function updateDefaultSetupStepOrder(id: string, orderIndex: number) {
  await db.update(defaultSetupSteps).set({ orderIndex }).where(eq(defaultSetupSteps.id, id));
}

export async function replaceDefaultSetupSteps(
  repositoryId: string,
  steps: Array<{ stepType: 'test' | 'script'; testId?: string | null; scriptId?: string | null }>
) {
  // Delete all existing steps
  await deleteAllDefaultSetupSteps(repositoryId);

  // Insert new steps with order
  const results = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const result = await createDefaultSetupStep({
      repositoryId,
      stepType: step.stepType,
      testId: step.testId ?? null,
      scriptId: step.scriptId ?? null,
      orderIndex: i,
    });
    results.push(result);
  }

  return results;
}
