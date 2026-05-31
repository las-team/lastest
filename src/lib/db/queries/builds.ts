import { db } from '../index';
import {
  builds,
  testRuns,
  testResults,
  tests,
  testVersions,
  visualDiffs,
  functionalAreas,
  stepComparisons,
  stepLayerFeedback,
} from '../schema';
import type {
  NewBuild,
  BuildStatus,
  A11yViolation,
  DesignSystemViolation,
  DesignTokenCategory,
  LayerFeedbackStatus,
} from '../schema';
import { getWcagLevel } from '@/lib/a11y/wcag-score';
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
      designSystemScore: builds.designSystemScore,
      designSystemViolationCount: builds.designSystemViolationCount,
      designSystemCriticalCount: builds.designSystemCriticalCount,
      designSystemTotalRulesChecked: builds.designSystemTotalRulesChecked,
      executorError: builds.executorError,
      executorFailedAt: builds.executorFailedAt,
      manuallyScopedAreaIds: builds.manuallyScopedAreaIds,
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
  const rawRows = await db
    .select({
      id: testResults.id,
      retryOf: testResults.retryOf,
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

  // Dedupe by testId: a build can have multiple test_results rows per test
  // (retries, re-runs). Drop superseded originals (rows whose id appears in
  // another row's retryOf), then keep one row per testId. Without this the
  // /compose page produces duplicate React keys.
  const supersededIds = new Set<string>();
  for (const r of rawRows) {
    if (r.retryOf) supersededIds.add(r.retryOf);
  }
  const seenTestIds = new Set<string>();
  const rows: typeof rawRows = [];
  for (const r of rawRows) {
    if (r.id && supersededIds.has(r.id)) continue;
    if (r.testId) {
      if (seenTestIds.has(r.testId)) continue;
      seenTestIds.add(r.testId);
    }
    rows.push(r);
  }

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

  // Quarantined tests don't block builds — pre-load the set so it can filter
  // both diffs and step comparisons.
  const quarantinedTestIds = new Set(
    (await db.select({ id: tests.id }).from(tests).where(eq(tests.quarantined, true))).map(t => t.id)
  );

  // Per-layer feedback is checked alongside diffs because a verify-board
  // confirmation lands in step_layer_feedback rather than visualDiffs (it
  // covers network / console / a11y / perf / url / dom / variable too). A
  // rejected layer must block the build the same way a rejected diff does,
  // and an approved/snoozed layer set must let an otherwise-red step pass.
  const feedbackRows = await db
    .select()
    .from(stepLayerFeedback)
    .where(eq(stepLayerFeedback.buildId, buildId));
  const hasRejectedLayer = feedbackRows.some(f => f.status === 'rejected');

  if (allDiffs.length === 0) {
    if (hasRejectedLayer) return 'blocked';
    return 'safe_to_merge';
  }

  const diffs = allDiffs.filter(d => !d.testId || !quarantinedTestIds.has(d.testId));

  if (diffs.length === 0) {
    if (hasRejectedLayer) return 'blocked';
    return 'safe_to_merge';
  }

  const hasFailed = diffs.some(d => d.status === 'rejected');
  const hasPending = diffs.some(d => d.status === 'pending');
  const hasTodo = diffs.some(d => d.status === 'todo');

  if (hasFailed || hasRejectedLayer) return 'blocked';

  // Multi-layer step verdicts can also escalate the build status. A `red`
  // verdict from non-visual layers (new console errors, new 4xx/5xx, URL
  // divergence, critical a11y) means there is high-signal evidence of a
  // real regression even if the visual diffs were all auto-approved. BUT —
  // once the reviewer has settled every evidence layer on that step (via
  // the verify board's drag-to-column or "Verify all" actions), the step
  // is treated as resolved even though step.verdict itself is never
  // mutated. This mirrors the build-detail "Approve all" semantics.
  const stepRows = await db
    .select({
      id: stepComparisons.id,
      verdict: stepComparisons.verdict,
      testId: stepComparisons.testId,
      evidence: stepComparisons.evidence,
    })
    .from(stepComparisons)
    .where(eq(stepComparisons.buildId, buildId));
  const nonQuarantinedSteps = stepRows.filter(s => !quarantinedTestIds.has(s.testId));

  const SETTLED: LayerFeedbackStatus[] = ['approved', 'auto_approved', 'snoozed'];
  const fbByStep = new Map<string, Set<string>>();
  for (const f of feedbackRows) {
    if (!SETTLED.includes(f.status)) continue;
    if (!fbByStep.has(f.stepComparisonId)) fbByStep.set(f.stepComparisonId, new Set());
    fbByStep.get(f.stepComparisonId)!.add(f.layer);
  }

  const stepIsVerified = (step: typeof nonQuarantinedSteps[number]): boolean => {
    const evLayers = Array.from(new Set((step.evidence ?? []).map(e => e.layer)));
    if (evLayers.length === 0) return false;
    const settled = fbByStep.get(step.id);
    if (!settled) return false;
    return evLayers.every(l => settled.has(l));
  };

  const hasRedStep = nonQuarantinedSteps.some(s => s.verdict === 'red' && !stepIsVerified(s));
  if (hasRedStep) return 'review_required';

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

// Aggregated per-rule a11y violation row used by the build drill-in UI
// and the bulk-download endpoint. Groups every violation across the
// build's test_results by `id` (the axe rule id) so reviewers see one
// row per rule with the occurrence count, total offending nodes, the
// severity/WCAG-level/help URL pulled from the first occurrence, and a
// small set of sample test results that hit the rule (with one sample
// node each when the harvester captured selectors).
export interface BuildA11yViolationRow {
  id: string;
  impact: 'critical' | 'serious' | 'moderate' | 'minor';
  description: string;
  help: string;
  helpUrl: string;
  wcagLevel?: 'A' | 'AA' | 'AAA';
  tags: string[];
  occurrenceCount: number; // # of test_results that hit this rule
  totalNodes: number;      // sum of `nodes` counts across all occurrences
  samples: Array<{
    testResultId: string;
    testId: string | null;
    testName: string | null;
    areaName: string | null;
    nodes: number;
    sampleNode?: {
      target: string[];
      failureSummary?: string;
      html?: string;
    };
  }>;
}

const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  serious: 1,
  moderate: 2,
  minor: 3,
};

export async function getBuildA11yViolations(buildId: string): Promise<BuildA11yViolationRow[]> {
  const [build] = await db
    .select({ testRunId: builds.testRunId })
    .from(builds)
    .where(eq(builds.id, buildId));
  if (!build?.testRunId) return [];

  const rows = await db
    .select({
      testResultId: testResults.id,
      testId: testResults.testId,
      a11yViolations: testResults.a11yViolations,
      testName: tests.name,
      areaName: functionalAreas.name,
    })
    .from(testResults)
    .leftJoin(tests, eq(testResults.testId, tests.id))
    .leftJoin(functionalAreas, eq(tests.functionalAreaId, functionalAreas.id))
    .where(eq(testResults.testRunId, build.testRunId));

  const byRule = new Map<string, BuildA11yViolationRow>();
  for (const r of rows) {
    const violations = (r.a11yViolations ?? []) as A11yViolation[];
    if (!Array.isArray(violations) || violations.length === 0) continue;
    for (const v of violations) {
      if (!v?.id) continue;
      let row = byRule.get(v.id);
      if (!row) {
        row = {
          id: v.id,
          impact: v.impact ?? 'moderate',
          description: v.description ?? '',
          help: v.help ?? '',
          helpUrl: v.helpUrl ?? '',
          wcagLevel: v.wcagLevel ?? getWcagLevel(v.tags) ?? undefined,
          tags: Array.isArray(v.tags) ? v.tags : [],
          occurrenceCount: 0,
          totalNodes: 0,
          samples: [],
        };
        byRule.set(v.id, row);
      }
      row.occurrenceCount += 1;
      row.totalNodes += typeof v.nodes === 'number' ? v.nodes : 0;
      if (row.samples.length < 5) {
        const sampleNode = Array.isArray(v.sampleNodes) && v.sampleNodes.length > 0
          ? v.sampleNodes[0]
          : undefined;
        row.samples.push({
          testResultId: r.testResultId,
          testId: r.testId ?? null,
          testName: r.testName ?? null,
          areaName: r.areaName ?? null,
          nodes: typeof v.nodes === 'number' ? v.nodes : 0,
          sampleNode,
        });
      }
    }
  }

  return Array.from(byRule.values()).sort((a, b) => {
    const sa = SEVERITY_RANK[a.impact] ?? 9;
    const sb = SEVERITY_RANK[b.impact] ?? 9;
    if (sa !== sb) return sa - sb;
    if (b.occurrenceCount !== a.occurrenceCount) return b.occurrenceCount - a.occurrenceCount;
    return a.id.localeCompare(b.id);
  });
}

// Drill-in view for a single test result — same per-rule shape but bound
// to one test_results row, so the API and Verify focus pane share one
// schema. Returns null when the test result has no captured violations
// (different from "0 rules violated", which returns an empty array).
export interface TestResultA11yViolationRow {
  id: string;
  impact: 'critical' | 'serious' | 'moderate' | 'minor';
  description: string;
  help: string;
  helpUrl: string;
  wcagLevel?: 'A' | 'AA' | 'AAA';
  tags: string[];
  nodes: number;
  sampleNodes: Array<{
    target: string[];
    failureSummary?: string;
    html?: string;
  }>;
}

export async function getTestResultA11yViolations(
  testResultId: string,
): Promise<TestResultA11yViolationRow[] | null> {
  const [row] = await db
    .select({ a11yViolations: testResults.a11yViolations })
    .from(testResults)
    .where(eq(testResults.id, testResultId));
  if (!row) return null;
  const violations = (row.a11yViolations ?? null) as A11yViolation[] | null;
  if (violations === null) return null;
  return violations
    .filter((v) => v?.id)
    .map((v) => ({
      id: v.id,
      impact: v.impact ?? 'moderate',
      description: v.description ?? '',
      help: v.help ?? '',
      helpUrl: v.helpUrl ?? '',
      wcagLevel: v.wcagLevel ?? getWcagLevel(v.tags) ?? undefined,
      tags: Array.isArray(v.tags) ? v.tags : [],
      nodes: typeof v.nodes === 'number' ? v.nodes : 0,
      sampleNodes: Array.isArray(v.sampleNodes) ? v.sampleNodes : [],
    }))
    .sort((a, b) => {
      const sa = SEVERITY_RANK[a.impact] ?? 9;
      const sb = SEVERITY_RANK[b.impact] ?? 9;
      if (sa !== sb) return sa - sb;
      return a.id.localeCompare(b.id);
    });
}

// ── Design System rollups (mirror of getA11yScoreTrend / getBuildA11yViolations) ──

export async function getDesignSystemScoreTrend(repositoryId: string, limit = 10) {
  const rows = await db
    .select({
      id: builds.id,
      designSystemScore: builds.designSystemScore,
      designSystemViolationCount: builds.designSystemViolationCount,
      designSystemCriticalCount: builds.designSystemCriticalCount,
      designSystemTotalRulesChecked: builds.designSystemTotalRulesChecked,
      createdAt: builds.createdAt,
    })
    .from(builds)
    .innerJoin(testRuns, eq(builds.testRunId, testRuns.id))
    .where(and(
      eq(testRuns.repositoryId, repositoryId),
      sql`${builds.designSystemScore} IS NOT NULL`,
    ))
    .orderBy(desc(builds.createdAt))
    .limit(limit);
  return rows.reverse(); // oldest first
}

/** Build-level drill-in row: one entry per off-token value, with the
 *  occurrence count and a couple of sample selectors. Mirrors
 *  BuildA11yViolationRow shape so the UI components can share styling. */
export interface BuildDesignSystemViolationRow {
  id: string;
  category: DesignTokenCategory;
  property: string;
  actual: string;
  expected?: string;
  expectedName?: string;
  impact: 'critical' | 'serious' | 'moderate' | 'minor';
  occurrenceCount: number;
  totalNodes: number;
  samples: Array<{
    testResultId: string;
    testId: string | null;
    testName: string | null;
    areaName: string | null;
    nodes: number;
    sampleNode?: {
      target: string[];
      failureSummary?: string;
      html?: string;
    };
  }>;
}

export async function getBuildDesignSystemViolations(
  buildId: string,
): Promise<BuildDesignSystemViolationRow[]> {
  const [build] = await db
    .select({ testRunId: builds.testRunId })
    .from(builds)
    .where(eq(builds.id, buildId));
  if (!build?.testRunId) return [];

  const rows = await db
    .select({
      testResultId: testResults.id,
      testId: testResults.testId,
      designSystemViolations: testResults.designSystemViolations,
      testName: tests.name,
      areaName: functionalAreas.name,
    })
    .from(testResults)
    .leftJoin(tests, eq(testResults.testId, tests.id))
    .leftJoin(functionalAreas, eq(tests.functionalAreaId, functionalAreas.id))
    .where(eq(testResults.testRunId, build.testRunId));

  const byRule = new Map<string, BuildDesignSystemViolationRow>();
  for (const r of rows) {
    const violations = (r.designSystemViolations ?? []) as DesignSystemViolation[];
    if (!Array.isArray(violations) || violations.length === 0) continue;
    for (const v of violations) {
      if (!v?.id) continue;
      let row = byRule.get(v.id);
      if (!row) {
        row = {
          id: v.id,
          category: v.category,
          property: v.property,
          actual: v.actual,
          expected: v.expected,
          expectedName: v.expectedName,
          impact: v.impact ?? 'moderate',
          occurrenceCount: 0,
          totalNodes: 0,
          samples: [],
        };
        byRule.set(v.id, row);
      }
      row.occurrenceCount += 1;
      row.totalNodes += typeof v.nodes === 'number' ? v.nodes : 0;
      if (row.samples.length < 5) {
        const sampleNode = Array.isArray(v.sampleNodes) && v.sampleNodes.length > 0
          ? v.sampleNodes[0]
          : undefined;
        row.samples.push({
          testResultId: r.testResultId,
          testId: r.testId ?? null,
          testName: r.testName ?? null,
          areaName: r.areaName ?? null,
          nodes: typeof v.nodes === 'number' ? v.nodes : 0,
          sampleNode,
        });
      }
    }
  }

  return Array.from(byRule.values()).sort((a, b) => {
    const sa = SEVERITY_RANK[a.impact] ?? 9;
    const sb = SEVERITY_RANK[b.impact] ?? 9;
    if (sa !== sb) return sa - sb;
    if (b.totalNodes !== a.totalNodes) return b.totalNodes - a.totalNodes;
    return a.id.localeCompare(b.id);
  });
}
