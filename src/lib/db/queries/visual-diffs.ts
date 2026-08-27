import { db } from "../index";
import {
  visualDiffs,
  baselines,
  ignoreRegions,
  focusRegions,
  plannedScreenshots,
  testResults,
  tests,
  builds,
  testRuns,
  routes,
  routeTestSuggestions,
  functionalAreas,
} from "../schema";
import type {
  NewVisualDiff,
  NewBaseline,
  NewIgnoreRegion,
  NewFocusRegion,
  NewPlannedScreenshot,
  DomDiffResult,
  DomSnapshotData,
} from "../schema";
import { eq, desc, and, or, inArray, isNull, sql } from "drizzle-orm";
import { v4 as uuid } from "uuid";

// Visual Diffs
export async function getVisualDiffsByBuild(buildId: string) {
  return db.select().from(visualDiffs).where(eq(visualDiffs.buildId, buildId));
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
      consoleErrors: testResults.consoleErrors,
      networkRequests: testResults.networkRequests,
      downloads: testResults.downloads,
      browser: visualDiffs.browser,
      // Per-step progress fields (consumed by the verify board to render
      // a per-step pass/fail strip and synthesize "not run" rows for steps
      // beyond lastReachedStep).
      lastReachedStep: testResults.lastReachedStep,
      totalSteps: testResults.totalSteps,
      evaluationOutcome: testResults.evaluationOutcome,
      softErrors: testResults.softErrors,
      issueUrl: visualDiffs.issueUrl,
      issueProvider: visualDiffs.issueProvider,
      baselineTextPath: visualDiffs.baselineTextPath,
      currentTextPath: visualDiffs.currentTextPath,
      textDiffStatus: visualDiffs.textDiffStatus,
    })
    .from(visualDiffs)
    .leftJoin(testResults, eq(visualDiffs.testResultId, testResults.id))
    .leftJoin(tests, eq(visualDiffs.testId, tests.id))
    .leftJoin(functionalAreas, eq(tests.functionalAreaId, functionalAreas.id))
    .where(eq(visualDiffs.buildId, buildId));
  return diffs;
}

/**
 * Build's visual diffs with only the `domDiff` sub-object pulled out of
 * `metadata`, optionally narrowed to a single test.
 *
 * The projection is deliberately narrower than `getVisualDiffsWithTestStatus`:
 * the rest of `metadata` (aiAnalysis, GitHub links) would bloat a payload that
 * the only consumer — the public share render context — never reads.
 */
export async function getVisualDiffsWithDomDiff(
  buildId: string,
  testId?: string | null,
) {
  return db
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
      plannedImagePath: visualDiffs.plannedImagePath,
      plannedDiffImagePath: visualDiffs.plannedDiffImagePath,
      mainBaselineImagePath: visualDiffs.mainBaselineImagePath,
      mainDiffImagePath: visualDiffs.mainDiffImagePath,
      domDiff: sql<DomDiffResult | null>`${visualDiffs.metadata}->'domDiff'`,
      testResultStatus: testResults.status,
      testName: tests.name,
    })
    .from(visualDiffs)
    .leftJoin(testResults, eq(visualDiffs.testResultId, testResults.id))
    .leftJoin(tests, eq(visualDiffs.testId, tests.id))
    .where(
      testId
        ? and(eq(visualDiffs.buildId, buildId), eq(visualDiffs.testId, testId))
        : eq(visualDiffs.buildId, buildId),
    );
}

export async function getVisualDiff(id: string) {
  const [row] = await db
    .select()
    .from(visualDiffs)
    .where(eq(visualDiffs.id, id));
  return row;
}

export async function getPendingDiffsByBuild(buildId: string) {
  return db
    .select()
    .from(visualDiffs)
    .where(
      and(eq(visualDiffs.buildId, buildId), eq(visualDiffs.status, "pending")),
    );
}

export async function createVisualDiff(data: Omit<NewVisualDiff, "id">) {
  const id = uuid();
  await db.insert(visualDiffs).values({ ...data, id, createdAt: new Date() });
  return { id, ...data, createdAt: new Date() };
}

export async function updateVisualDiff(
  id: string,
  data: Partial<NewVisualDiff>,
) {
  await db.update(visualDiffs).set(data).where(eq(visualDiffs.id, id));
}

export async function batchUpdateVisualDiffs(
  ids: string[],
  data: Partial<NewVisualDiff>,
) {
  await db.update(visualDiffs).set(data).where(inArray(visualDiffs.id, ids));
}

export async function setDiffIssue(
  id: string,
  issueUrl: string,
  issueProvider: string,
) {
  await db
    .update(visualDiffs)
    .set({ issueUrl, issueProvider })
    .where(eq(visualDiffs.id, id));
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
    .where(eq(visualDiffs.buildId, buildId));
  // Only count non-unchanged diffs (AI analysis only runs on changed diffs)
  const analyzable = diffs.filter((d) => d.classification !== "unchanged");

  return {
    approveCount: analyzable.filter((d) => d.aiRecommendation === "approve")
      .length,
    reviewCount: analyzable.filter((d) => d.aiRecommendation === "review")
      .length,
    flagCount: analyzable.filter((d) => d.aiRecommendation === "flag").length,
    pendingAnalysis: analyzable.filter(
      (d) =>
        d.aiAnalysisStatus === "pending" || d.aiAnalysisStatus === "running",
    ).length,
    totalAnalyzable: analyzable.length,
    completedAnalysis: analyzable.filter(
      (d) => d.aiAnalysisStatus === "completed",
    ).length,
  };
}

export async function getPendingAIApprovableDiffs(buildId: string) {
  return db
    .select()
    .from(visualDiffs)
    .where(
      and(
        eq(visualDiffs.buildId, buildId),
        eq(visualDiffs.status, "pending"),
        eq(visualDiffs.aiRecommendation, "approve"),
      ),
    );
}

// Baselines

/**
 * Get active baseline, most specific scope first.
 *
 * Two nested fallbacks, environment outside data cell:
 *
 *   (env, cell) → (env, no cell) → (no env, cell) → (no env, no cell)
 *
 * and within each, the original branch chain: branch → default branch. A final
 * legacy fallback takes any active baseline for the browser, tried inside the
 * environment before going unscoped.
 *
 * Environment is the OUTER loop deliberately. A UAT run must prefer a UAT
 * baseline for a different cell over a PROD baseline for its own cell: the
 * environment decides what the page is supposed to look like, while the cell
 * only decides which data it was showing. Getting this order backwards would
 * make every UAT run diff against PROD the moment a cell went unmatched.
 */
export async function getActiveBaseline(
  testId: string,
  stepLabel?: string | null,
  branch?: string,
  defaultBranch?: string,
  browser: string = "chromium",
  /** P2: data cell of the current run. Cell-specific baselines win; a run with
   *  no cell, or a cell with no baseline of its own, falls back to the shared
   *  (NULL-cell) baseline. That fallback is what lets the representative-cell
   *  policy work — 39 of 40 expanded runs compare against the one baseline the
   *  representative captured, instead of each demanding its own. */
  dataCell?: string | null,
  /** B2: environment key of the current run ('uat', 'prod'). A run with no
   *  environment, or an environment with no baseline of its own, falls back to
   *  the unscoped baseline — so adopting environments never orphans the
   *  approvals a repo already has. */
  environmentKey?: string | null,
) {
  const stepConditions = stepLabel
    ? [eq(baselines.stepLabel, stepLabel)]
    : [isNull(baselines.stepLabel)];

  type Cond = ReturnType<typeof eq> | ReturnType<typeof isNull>;

  // Ordering matters throughout: querying variants at once and taking the
  // newest would let an unrelated environment's or cell's baseline win purely
  // on timestamp.
  const envVariants: Cond[] = environmentKey
    ? [
        eq(baselines.environmentKey, environmentKey),
        isNull(baselines.environmentKey),
      ]
    : [isNull(baselines.environmentKey)];

  const cellVariants: Cond[] = dataCell
    ? [eq(baselines.dataCell, dataCell), isNull(baselines.dataCell)]
    : [isNull(baselines.dataCell)];

  for (const envCondition of envVariants) {
    for (const cellCondition of cellVariants) {
      // 1. Try branch-specific baseline
      if (branch) {
        const [branchBaseline] = await db
          .select()
          .from(baselines)
          .where(
            and(
              eq(baselines.testId, testId),
              eq(baselines.isActive, true),
              eq(baselines.branch, branch),
              eq(baselines.browser, browser),
              envCondition,
              cellCondition,
              ...stepConditions,
            ),
          )
          .orderBy(desc(baselines.createdAt));
        if (branchBaseline) return branchBaseline;
      }

      // 2. Try default branch baseline
      if (defaultBranch && defaultBranch !== branch) {
        const [mainBaseline] = await db
          .select()
          .from(baselines)
          .where(
            and(
              eq(baselines.testId, testId),
              eq(baselines.isActive, true),
              eq(baselines.branch, defaultBranch),
              eq(baselines.browser, browser),
              envCondition,
              cellCondition,
              ...stepConditions,
            ),
          )
          .orderBy(desc(baselines.createdAt));
        if (mainBaseline) return mainBaseline;
      }
    }
  }

  // 3. Legacy fallback — any active baseline for this browser, still preferring
  // the run's own environment before reaching across to an unscoped one.
  for (const envCondition of envVariants) {
    const [fallback] = await db
      .select()
      .from(baselines)
      .where(
        and(
          eq(baselines.testId, testId),
          eq(baselines.isActive, true),
          eq(baselines.browser, browser),
          envCondition,
          ...stepConditions,
        ),
      )
      .orderBy(desc(baselines.createdAt));
    if (fallback) return fallback;
  }
  return undefined;
}

/**
 * Get baseline for a specific branch only (no BRANCH fallback).
 *
 * There is still an ENVIRONMENT fallback, and the two are not the same kind of
 * thing: "no fallback" here has always meant "do not silently compare this
 * branch against another one". Falling back from a UAT-scoped baseline to the
 * repo's unscoped one is the opposite — it is what stops a repo that just
 * adopted environments from seeing every one of its approvals disappear.
 */
export async function getBranchBaseline(
  testId: string,
  stepLabel: string | null | undefined,
  branch: string,
  browser: string = "chromium",
  /** P2: data cell of the current run. A baseline captured for THIS cell wins;
   *  otherwise the shared (NULL-cell) baseline is used, which is what lets the
   *  representative-cell policy hold — the other expanded runs compare against
   *  the one baseline the representative established. */
  dataCell?: string | null,
  /** Environment of the current run. Same specific-beats-general rule as
   *  `dataCell`, and the two compose — see the variant order below. */
  environmentKey?: string | null,
) {
  const stepConditions = stepLabel
    ? [eq(baselines.stepLabel, stepLabel)]
    : [isNull(baselines.stepLabel)];

  // Specific first, then shared, on BOTH axes. Querying every variant at once
  // and taking the newest would let an unrelated cell's (or environment's)
  // baseline win purely on timestamp.
  const cellVariants = dataCell
    ? [eq(baselines.dataCell, dataCell), isNull(baselines.dataCell)]
    : [isNull(baselines.dataCell)];
  const envVariants = environmentKey
    ? [
        eq(baselines.environmentKey, environmentKey),
        isNull(baselines.environmentKey),
      ]
    : [isNull(baselines.environmentKey)];

  // Environment is the outer loop: a baseline captured against THIS
  // environment is the closer match, because a screenshot from another
  // environment can differ for reasons that have nothing to do with the data
  // row (different sandbox, different tenant branding).
  const variants = envVariants.flatMap((envCondition) =>
    cellVariants.map((cellCondition) => [envCondition, cellCondition] as const),
  );

  for (const [envCondition, cellCondition] of variants) {
    const [row] = await db
      .select()
      .from(baselines)
      .where(
        and(
          eq(baselines.testId, testId),
          eq(baselines.isActive, true),
          eq(baselines.branch, branch),
          eq(baselines.browser, browser),
          envCondition,
          cellCondition,
          ...stepConditions,
        ),
      )
      .orderBy(desc(baselines.createdAt));
    if (row) return row;
  }
  return undefined;
}

/**
 * Find the most recent active baseline for a test+step+browser across ANY
 * branch. Used by the UX hint when the current branch (and default branch
 * fallback) have nothing to diff against — lets the verify board tell the
 * user "approved baseline exists on <branch>" instead of looking like the
 * baseline was wiped.
 */
export async function getAnyActiveBaseline(
  testId: string,
  stepLabel: string | null | undefined,
  browser: string = "chromium",
  /** Restrict to one data cell. Omitted → any cell, which is what the
   *  "a baseline exists on <branch>" hint wants. */
  dataCell?: string | null,
) {
  const stepConditions = stepLabel
    ? [eq(baselines.stepLabel, stepLabel)]
    : [isNull(baselines.stepLabel)];
  if (dataCell !== undefined) {
    stepConditions.push(
      dataCell === null
        ? isNull(baselines.dataCell)
        : eq(baselines.dataCell, dataCell),
    );
  }
  const [row] = await db
    .select()
    .from(baselines)
    .where(
      and(
        eq(baselines.testId, testId),
        eq(baselines.isActive, true),
        eq(baselines.browser, browser),
        ...stepConditions,
      ),
    )
    .orderBy(desc(baselines.createdAt))
    .limit(1);
  return row;
}

/**
 * Every active baseline for a test, across all steps, branches and browsers.
 *
 * Unlike `getActiveBaseline`/`getAnyActiveBaseline` this resolves nothing — it
 * is the whole set, which is what a media allow-list and a baseline copy both
 * need.
 */
export async function getActiveBaselinesForTest(testId: string) {
  return db
    .select()
    .from(baselines)
    .where(and(eq(baselines.testId, testId), eq(baselines.isActive, true)));
}

/**
 * Get all active baselines for a branch in a repository
 */
export async function getBaselinesByBranch(
  repositoryId: string,
  branch: string,
) {
  return db
    .select()
    .from(baselines)
    .where(
      and(
        or(
          eq(baselines.repositoryId, repositoryId),
          isNull(baselines.repositoryId),
        ),
        eq(baselines.branch, branch),
        eq(baselines.isActive, true),
      ),
    );
}

/**
 * Carry-forward by content hash.
 *
 * Environment-scoped like the rest, but note what the fallback means here: an
 * identical image already approved for the repo carries forward into an
 * environment run. That is correct — the pixels are the same by definition, and
 * refusing the match would force a re-approval of an image the user has already
 * signed off on.
 */
export async function getBaselineByHash(
  testId: string,
  imageHash: string,
  stepLabel?: string | null,
  browser: string = "chromium",
  environmentKey?: string | null,
) {
  const conditions = [
    eq(baselines.testId, testId),
    eq(baselines.imageHash, imageHash),
    eq(baselines.isActive, true),
    eq(baselines.browser, browser),
  ];
  if (environmentKey) {
    conditions.push(
      or(
        eq(baselines.environmentKey, environmentKey),
        isNull(baselines.environmentKey),
      )!,
    );
  } else {
    conditions.push(isNull(baselines.environmentKey));
  }
  if (stepLabel) {
    conditions.push(eq(baselines.stepLabel, stepLabel));
  } else {
    conditions.push(isNull(baselines.stepLabel));
  }
  const [row] = await db
    .select()
    .from(baselines)
    .where(and(...conditions));
  return row;
}

export async function createBaseline(data: Omit<NewBaseline, "id">) {
  const id = uuid();
  await db.insert(baselines).values({ ...data, id, createdAt: new Date() });
  return { id, ...data, createdAt: new Date() };
}

/**
 * Self-heal: adopt a per-step DOM snapshot onto a baseline that has none.
 * Baselines created before per-step DOM capture (or via approval paths that
 * don't ride a snapshot on) have a null dom_snapshot, which permanently
 * disables the per-step DOM diff against them. When the current run is
 * identical to the baseline (carry-forward / pixel-identical), the current
 * per-step DOM ≈ the baseline DOM, so it is safe to adopt it. Guarded on
 * `is null` so a real baseline snapshot is never clobbered, and a no-op when
 * the snapshot is unavailable (e.g. a legacy runner that doesn't emit it).
 */
export async function backfillBaselineDomSnapshot(
  baselineId: string,
  domSnapshot: DomSnapshotData | null | undefined,
): Promise<void> {
  if (!domSnapshot) return;
  await db
    .update(baselines)
    .set({ domSnapshot })
    .where(and(eq(baselines.id, baselineId), isNull(baselines.domSnapshot)));
}

/**
 * Deactivate baselines. If branch is provided, only deactivates for that branch.
 */
/**
 * Deactivate EVERY active baseline for a test — all steps, branches, browsers.
 * Used when a test's steps change (e.g. Record-from-here splices new actions
 * in): the old baselines were captured against the previous steps and would
 * produce misaligned/meaningless diffs, so they're invalidated wholesale.
 * Unlike deactivateBaselines, this does not pin stepLabel to NULL.
 */
export async function deactivateAllBaselinesForTest(testId: string) {
  const result = await db
    .update(baselines)
    .set({ isActive: false })
    .where(and(eq(baselines.testId, testId), eq(baselines.isActive, true)))
    .returning({ id: baselines.id });
  return result.length;
}

/**
 * Retire the baselines a new approval replaces.
 *
 * `environmentKey` is not optional in spirit even though it is in the type: a
 * caller that omits it retires baselines across EVERY environment, which is
 * exactly the bug the environment model exists to prevent — approving a change
 * in UAT would silently drop PROD's approved baseline. Omit it only when the
 * intent really is repo-wide (deleting a test, resetting a step).
 */
export async function deactivateBaselines(
  testId: string,
  stepLabel?: string | null,
  branch?: string,
  browser?: string,
  /** P2 cell scoping. `undefined` (the default) keeps the historical
   *  behaviour of deactivating regardless of cell. `null` restricts to the
   *  shared baseline; a coordsKey restricts to that cell — so approving one
   *  cell's baseline cannot retire another cell's. */
  dataCell?: string | null,
  /** Environment scoping, same `undefined` / `null` / value contract as
   *  `dataCell`: approving one environment's baseline must not retire
   *  another's. */
  environmentKey?: string | null,
) {
  const conditions = [eq(baselines.testId, testId)];
  if (dataCell !== undefined) {
    conditions.push(
      dataCell === null
        ? isNull(baselines.dataCell)
        : eq(baselines.dataCell, dataCell),
    );
  }
  if (stepLabel) {
    conditions.push(eq(baselines.stepLabel, stepLabel));
  } else {
    conditions.push(isNull(baselines.stepLabel));
  }
  if (branch) {
    conditions.push(eq(baselines.branch, branch));
  }
  if (browser) {
    conditions.push(eq(baselines.browser, browser));
  }
  if (environmentKey !== undefined) {
    conditions.push(
      environmentKey
        ? eq(baselines.environmentKey, environmentKey)
        : isNull(baselines.environmentKey),
    );
  }
  await db
    .update(baselines)
    .set({ isActive: false })
    .where(and(...conditions));
}

/**
 * Get previous run's screenshot for a test on the same branch (for vs_previous mode)
 */
export async function getPreviousRunScreenshot(
  testId: string,
  buildId: string,
  branch: string,
  stepLabel?: string | null,
) {
  // Find the most recent visual diff for this test on this branch that's not from the current build
  const stepConditions = stepLabel
    ? [eq(visualDiffs.stepLabel, stepLabel)]
    : [isNull(visualDiffs.stepLabel)];

  const [result] = await db
    .select({
      currentImagePath: visualDiffs.currentImagePath,
    })
    .from(visualDiffs)
    .innerJoin(builds, eq(visualDiffs.buildId, builds.id))
    .innerJoin(testRuns, eq(builds.testRunId, testRuns.id))
    .where(
      and(
        eq(visualDiffs.testId, testId),
        eq(testRuns.gitBranch, branch),
        // Exclude current build
        sql`${visualDiffs.buildId} != ${buildId}`,
        ...stepConditions,
      ),
    )
    .orderBy(desc(visualDiffs.createdAt))
    .limit(1);

  return result?.currentImagePath ?? null;
}

/**
 * Get distinct active baseline step labels for a given test.
 * Used to populate suggestions when renaming a step label on the diff page.
 */
export async function getStepLabelsForTest(testId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ stepLabel: baselines.stepLabel })
    .from(baselines)
    .where(and(eq(baselines.testId, testId), eq(baselines.isActive, true)));
  return rows
    .map((r) => r.stepLabel)
    .filter((label): label is string => label !== null)
    .sort();
}

// Ignore Regions (per-screenshot mask, mirrors focusRegions)
export async function getIgnoreRegions(
  testId: string,
  stepLabel: string | null,
) {
  return db
    .select()
    .from(ignoreRegions)
    .where(
      and(
        eq(ignoreRegions.testId, testId),
        stepLabel === null
          ? isNull(ignoreRegions.stepLabel)
          : eq(ignoreRegions.stepLabel, stepLabel),
      ),
    );
}

export async function createIgnoreRegion(data: Omit<NewIgnoreRegion, "id">) {
  const id = uuid();
  await db.insert(ignoreRegions).values({ ...data, id, createdAt: new Date() });
  return { id, ...data, createdAt: new Date() };
}

export async function deleteIgnoreRegion(id: string) {
  await db.delete(ignoreRegions).where(eq(ignoreRegions.id, id));
}

export async function getIgnoreRegionById(id: string) {
  const [row] = await db
    .select()
    .from(ignoreRegions)
    .where(eq(ignoreRegions.id, id));
  return row;
}

// Focus Regions (per-screenshot positive mask)
export async function getFocusRegions(
  testId: string,
  stepLabel: string | null,
) {
  return db
    .select()
    .from(focusRegions)
    .where(
      and(
        eq(focusRegions.testId, testId),
        stepLabel === null
          ? isNull(focusRegions.stepLabel)
          : eq(focusRegions.stepLabel, stepLabel),
      ),
    );
}

export async function createFocusRegion(
  data: Omit<NewFocusRegion, "id" | "createdAt">,
) {
  const id = uuid();
  const createdAt = new Date();
  await db.insert(focusRegions).values({ ...data, id, createdAt });
  return { id, ...data, createdAt };
}

export async function deleteFocusRegion(id: string) {
  await db.delete(focusRegions).where(eq(focusRegions.id, id));
}

export async function getFocusRegionById(id: string) {
  const [row] = await db
    .select()
    .from(focusRegions)
    .where(eq(focusRegions.id, id));
  return row;
}

export async function getFocusRegionsByTest(testId: string) {
  return db.select().from(focusRegions).where(eq(focusRegions.testId, testId));
}

// Get visual diffs for a specific test result (step-level diffs)
export async function getVisualDiffsByTestResult(testResultId: string) {
  return db
    .select()
    .from(visualDiffs)
    .where(eq(visualDiffs.testResultId, testResultId));
}

// ============================================
// Planned Screenshots
// ============================================

export async function createPlannedScreenshot(
  data: Omit<NewPlannedScreenshot, "id" | "createdAt" | "updatedAt">,
) {
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
  const [row] = await db
    .select()
    .from(plannedScreenshots)
    .where(eq(plannedScreenshots.id, id));
  return row;
}

export async function getPlannedScreenshotByTest(
  testId: string,
  stepLabel?: string | null,
) {
  const conditions = [
    eq(plannedScreenshots.testId, testId),
    eq(plannedScreenshots.isActive, true),
  ];
  if (stepLabel) {
    conditions.push(eq(plannedScreenshots.stepLabel, stepLabel));
  } else {
    conditions.push(isNull(plannedScreenshots.stepLabel));
  }
  const [row] = await db
    .select()
    .from(plannedScreenshots)
    .where(and(...conditions));
  return row;
}

export async function getPlannedScreenshotByRoute(routeId: string) {
  const [row] = await db
    .select()
    .from(plannedScreenshots)
    .where(
      and(
        eq(plannedScreenshots.routeId, routeId),
        eq(plannedScreenshots.isActive, true),
      ),
    );
  return row;
}

export async function getPlannedScreenshotsByRepo(repositoryId: string) {
  return db
    .select()
    .from(plannedScreenshots)
    .where(
      and(
        eq(plannedScreenshots.repositoryId, repositoryId),
        eq(plannedScreenshots.isActive, true),
      ),
    )
    .orderBy(desc(plannedScreenshots.createdAt));
}

export async function getPlannedScreenshotsByTest(testId: string) {
  return db
    .select()
    .from(plannedScreenshots)
    .where(
      and(
        eq(plannedScreenshots.testId, testId),
        eq(plannedScreenshots.isActive, true),
      ),
    )
    .orderBy(plannedScreenshots.stepLabel);
}

export async function updatePlannedScreenshot(
  id: string,
  data: Partial<NewPlannedScreenshot>,
) {
  await db
    .update(plannedScreenshots)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(plannedScreenshots.id, id));
}

export async function deletePlannedScreenshot(id: string) {
  // Soft delete - mark as inactive
  await db
    .update(plannedScreenshots)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(plannedScreenshots.id, id));
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
  functionalAreaPlan: string | null;
  testSuggestions: string[];
}

export async function getRouteWithContext(
  routeId: string,
): Promise<RouteWithContext | null> {
  const [route] = await db
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
      functionalAreaPlan: functionalAreas.agentPlan,
    })
    .from(routes)
    .leftJoin(functionalAreas, eq(routes.functionalAreaId, functionalAreas.id))
    .where(eq(routes.id, routeId));

  if (!route) return null;

  // Fetch associated test suggestions
  const suggestions = await db
    .select({ suggestion: routeTestSuggestions.suggestion })
    .from(routeTestSuggestions)
    .where(eq(routeTestSuggestions.routeId, routeId));
  return {
    ...route,
    testSuggestions: suggestions.map((s) => s.suggestion),
  };
}
