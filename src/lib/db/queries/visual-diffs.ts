import { db } from '../index';
import {
  visualDiffs,
  baselines,
  ignoreRegions,
  plannedScreenshots,
  testResults,
  tests,
  builds,
  testRuns,
  routes,
  routeTestSuggestions,
  functionalAreas,
} from '../schema';
import type {
  NewVisualDiff,
  NewBaseline,
  NewIgnoreRegion,
  NewPlannedScreenshot,
} from '../schema';
import { eq, desc, and, or, inArray, isNull, sql } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

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
      mainBaselineImagePath: visualDiffs.mainBaselineImagePath,
      mainDiffImagePath: visualDiffs.mainDiffImagePath,
      mainPixelDifference: visualDiffs.mainPixelDifference,
      mainPercentageDifference: visualDiffs.mainPercentageDifference,
      mainClassification: visualDiffs.mainClassification,
      aiAnalysis: visualDiffs.aiAnalysis,
      aiRecommendation: visualDiffs.aiRecommendation,
      aiAnalysisStatus: visualDiffs.aiAnalysisStatus,
      testResultStatus: testResults.status,
      errorMessage: testResults.errorMessage,
      testName: tests.name,
      functionalAreaName: functionalAreas.name,
      a11yViolations: testResults.a11yViolations,
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

export async function getAIDiffSummaryForBuild(buildId: string) {
  const diffs = await db
    .select({
      aiRecommendation: visualDiffs.aiRecommendation,
      aiAnalysisStatus: visualDiffs.aiAnalysisStatus,
      status: visualDiffs.status,
      classification: visualDiffs.classification,
    })
    .from(visualDiffs)
    .where(eq(visualDiffs.buildId, buildId))
    .all();

  // Only count non-unchanged diffs (AI analysis only runs on changed diffs)
  const analyzable = diffs.filter(d => d.classification !== 'unchanged');

  return {
    approveCount: analyzable.filter(d => d.aiRecommendation === 'approve').length,
    reviewCount: analyzable.filter(d => d.aiRecommendation === 'review').length,
    flagCount: analyzable.filter(d => d.aiRecommendation === 'flag').length,
    pendingAnalysis: analyzable.filter(d =>
      d.aiAnalysisStatus === 'pending' || d.aiAnalysisStatus === 'running'
    ).length,
    totalAnalyzable: analyzable.length,
    completedAnalysis: analyzable.filter(d => d.aiAnalysisStatus === 'completed').length,
  };
}

export async function getPendingAIApprovableDiffs(buildId: string) {
  return db
    .select()
    .from(visualDiffs)
    .where(
      and(
        eq(visualDiffs.buildId, buildId),
        eq(visualDiffs.status, 'pending'),
        eq(visualDiffs.aiRecommendation, 'approve')
      )
    )
    .all();
}

// Baselines

/**
 * Get active baseline with branch-first fallback chain:
 * 1. Branch-specific baseline (if branch provided)
 * 2. Default branch baseline (if defaultBranch provided)
 * 3. Any active baseline (legacy fallback)
 */
export async function getActiveBaseline(testId: string, stepLabel?: string | null, branch?: string, defaultBranch?: string) {
  const stepConditions = stepLabel
    ? [eq(baselines.stepLabel, stepLabel)]
    : [isNull(baselines.stepLabel)];

  // 1. Try branch-specific baseline
  if (branch) {
    const branchBaseline = await db
      .select()
      .from(baselines)
      .where(and(
        eq(baselines.testId, testId),
        eq(baselines.isActive, true),
        eq(baselines.branch, branch),
        ...stepConditions,
      ))
      .orderBy(desc(baselines.createdAt))
      .get();
    if (branchBaseline) return branchBaseline;
  }

  // 2. Try default branch baseline
  if (defaultBranch && defaultBranch !== branch) {
    const mainBaseline = await db
      .select()
      .from(baselines)
      .where(and(
        eq(baselines.testId, testId),
        eq(baselines.isActive, true),
        eq(baselines.branch, defaultBranch),
        ...stepConditions,
      ))
      .orderBy(desc(baselines.createdAt))
      .get();
    if (mainBaseline) return mainBaseline;
  }

  // 3. Legacy fallback — any active baseline
  return db
    .select()
    .from(baselines)
    .where(and(
      eq(baselines.testId, testId),
      eq(baselines.isActive, true),
      ...stepConditions,
    ))
    .orderBy(desc(baselines.createdAt))
    .get();
}

/**
 * Get baseline for a specific branch only (no fallback)
 */
export async function getBranchBaseline(testId: string, stepLabel: string | null | undefined, branch: string) {
  const stepConditions = stepLabel
    ? [eq(baselines.stepLabel, stepLabel)]
    : [isNull(baselines.stepLabel)];

  return db
    .select()
    .from(baselines)
    .where(and(
      eq(baselines.testId, testId),
      eq(baselines.isActive, true),
      eq(baselines.branch, branch),
      ...stepConditions,
    ))
    .orderBy(desc(baselines.createdAt))
    .get();
}

/**
 * Get all active baselines for a branch in a repository
 */
export async function getBaselinesByBranch(repositoryId: string, branch: string) {
  return db
    .select()
    .from(baselines)
    .where(and(
      or(eq(baselines.repositoryId, repositoryId), isNull(baselines.repositoryId)),
      eq(baselines.branch, branch),
      eq(baselines.isActive, true),
    ))
    .all();
}

export async function getBaselineByHash(testId: string, imageHash: string, stepLabel?: string | null) {
  const conditions = [
    eq(baselines.testId, testId),
    eq(baselines.imageHash, imageHash),
    eq(baselines.isActive, true),
  ];
  if (stepLabel) {
    conditions.push(eq(baselines.stepLabel, stepLabel));
  } else {
    conditions.push(isNull(baselines.stepLabel));
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

/**
 * Deactivate baselines. If branch is provided, only deactivates for that branch.
 */
export async function deactivateBaselines(testId: string, stepLabel?: string | null, branch?: string) {
  const conditions = [eq(baselines.testId, testId)];
  if (stepLabel) {
    conditions.push(eq(baselines.stepLabel, stepLabel));
  } else {
    conditions.push(isNull(baselines.stepLabel));
  }
  if (branch) {
    conditions.push(eq(baselines.branch, branch));
  }
  await db
    .update(baselines)
    .set({ isActive: false })
    .where(and(...conditions));
}

/**
 * Get previous run's screenshot for a test on the same branch (for vs_previous mode)
 */
export async function getPreviousRunScreenshot(testId: string, buildId: string, branch: string, stepLabel?: string | null) {
  // Find the most recent visual diff for this test on this branch that's not from the current build
  const stepConditions = stepLabel
    ? [eq(visualDiffs.stepLabel, stepLabel)]
    : [isNull(visualDiffs.stepLabel)];

  const result = await db
    .select({
      currentImagePath: visualDiffs.currentImagePath,
    })
    .from(visualDiffs)
    .innerJoin(builds, eq(visualDiffs.buildId, builds.id))
    .innerJoin(testRuns, eq(builds.testRunId, testRuns.id))
    .where(and(
      eq(visualDiffs.testId, testId),
      eq(testRuns.gitBranch, branch),
      // Exclude current build
      sql`${visualDiffs.buildId} != ${buildId}`,
      ...stepConditions,
    ))
    .orderBy(desc(visualDiffs.createdAt))
    .limit(1)
    .get();

  return result?.currentImagePath ?? null;
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

// Get visual diffs for a specific test result (step-level diffs)
export async function getVisualDiffsByTestResult(testResultId: string) {
  return db.select().from(visualDiffs).where(eq(visualDiffs.testResultId, testResultId)).all();
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
