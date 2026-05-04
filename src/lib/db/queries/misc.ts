import { db } from '../index';
import {
  selectorStats,
  bugReports,
  reviewTodos,
  tests,
  functionalAreas,
} from '../schema';
import type {
  NewReviewTodo,
} from '../schema';
import { eq, desc, and, inArray, gte } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import {
  hashSelectors,
  sortSelectorsByStats,
  type SelectorOutcome,
  type SelectorRef,
  type SelectorStatRow,
} from '@lastest/shared';

// Selector Stats - for optimizing fallback selector strategy
export async function getSelectorStats(testId: string, selectorArrayHash: string) {
  return db
    .select()
    .from(selectorStats)
    .where(and(eq(selectorStats.testId, testId), eq(selectorStats.selectorArrayHash, selectorArrayHash)));
}

export async function recordSelectorSuccess(
  testId: string,
  selectorArrayHash: string,
  selectorType: string,
  selectorValue: string,
  responseTimeMs: number
) {
  const now = new Date();
  const [existing] = await db
    .select()
    .from(selectorStats)
    .where(
      and(
        eq(selectorStats.testId, testId),
        eq(selectorStats.selectorArrayHash, selectorArrayHash),
        eq(selectorStats.selectorType, selectorType),
        eq(selectorStats.selectorValue, selectorValue)
      )
    );

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
  const [existing] = await db
    .select()
    .from(selectorStats)
    .where(
      and(
        eq(selectorStats.testId, testId),
        eq(selectorStats.selectorArrayHash, selectorArrayHash),
        eq(selectorStats.selectorType, selectorType),
        eq(selectorStats.selectorValue, selectorValue)
      )
    );

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

/**
 * Fetch every selector_stats row for a test as `SelectorStatRow[]` so
 * runner / EB can sort their candidates locally without additional round-
 * trips. Cheap — bounded by total fallback selectors ever seen for the
 * test, typically <100 rows.
 */
export async function getSelectorStatsForTest(testId: string): Promise<SelectorStatRow[]> {
  const rows = await db.select().from(selectorStats).where(eq(selectorStats.testId, testId));
  return rows.map((r) => ({
    hash: r.selectorArrayHash,
    type: r.selectorType,
    value: r.selectorValue,
    successCount: r.successCount ?? 0,
    failureCount: r.failureCount ?? 0,
    totalAttempts: r.totalAttempts ?? 0,
    avgResponseTimeMs: r.avgResponseTimeMs,
  }));
}

/**
 * Host-side helper for code paths with direct DB access (currently
 * `src/lib/setup/script-runner.ts`). Reads stats for the (test, hash)
 * pair and returns the input array sorted by historical success.
 *
 * Falls back to the original order if stats lookup fails — selector stats
 * are best-effort and must never break test execution.
 */
export async function getSortedSelectors<T extends SelectorRef>(
  testId: string,
  selectors: ReadonlyArray<T>,
): Promise<T[]> {
  const hash = hashSelectors(selectors);
  try {
    const rows = await db
      .select()
      .from(selectorStats)
      .where(and(eq(selectorStats.testId, testId), eq(selectorStats.selectorArrayHash, hash)));
    const stats: SelectorStatRow[] = rows.map((r) => ({
      hash: r.selectorArrayHash,
      type: r.selectorType,
      value: r.selectorValue,
      successCount: r.successCount ?? 0,
      failureCount: r.failureCount ?? 0,
      totalAttempts: r.totalAttempts ?? 0,
      avgResponseTimeMs: r.avgResponseTimeMs,
    }));
    return sortSelectorsByStats(selectors, stats);
  } catch {
    return [...selectors];
  }
}

/**
 * Batch-write per-attempt outcomes reported by the runner / EB at the end
 * of a test run. Each row is an upsert against the existing
 * `recordSelectorSuccess` / `recordSelectorFailure` recorders. Failures
 * are swallowed — the test result must not be lost on a stats write blip.
 */
export async function recordSelectorOutcomes(
  testId: string,
  outcomes: ReadonlyArray<SelectorOutcome>,
): Promise<void> {
  if (outcomes.length === 0) return;
  for (const o of outcomes) {
    try {
      if (o.success) {
        await recordSelectorSuccess(testId, o.hash, o.type, o.value, o.responseTimeMs ?? 0);
      } else {
        await recordSelectorFailure(testId, o.hash, o.type, o.value);
      }
    } catch (err) {
      console.warn(`[selector-stats] write failed for ${testId}/${o.hash}:${o.type}:${o.value}:`, err);
    }
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
    .where(eq(tests.repositoryId, repositoryId));

  if (repoTests.length === 0) {
    return [];
  }

  const testIds = repoTests.map((t) => t.id);

  // Get all selector stats for these tests
  const stats = await db
    .select()
    .from(selectorStats)
    .where(inArray(selectorStats.testId, testIds));

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

// Bug Reports
export async function createBugReport(data: {
  id?: string;
  teamId: string;
  reportedById: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
  context?: unknown;
  screenshotPath?: string | null;
  contentHash?: string | null;
}) {
  const id = data.id ?? uuid();
  await db.insert(bugReports).values({
    id,
    teamId: data.teamId,
    reportedById: data.reportedById,
    description: data.description,
    severity: data.severity,
    context: data.context as never,
    screenshotPath: data.screenshotPath ?? null,
    contentHash: data.contentHash ?? null,
    createdAt: new Date(),
  });
  return { id };
}

export async function countRecentBugReports(userId: string, since: Date) {
  const rows = await db
    .select({ id: bugReports.id })
    .from(bugReports)
    .where(and(eq(bugReports.reportedById, userId), gte(bugReports.createdAt, since)));
  return rows.length;
}

export async function getBugReportByHash(teamId: string, contentHash: string) {
  const [row] = await db
    .select()
    .from(bugReports)
    .where(and(eq(bugReports.teamId, teamId), eq(bugReports.contentHash, contentHash)));
  return row;
}

export async function updateBugReport(id: string, data: { githubIssueUrl?: string; githubIssueNumber?: number }) {
  await db.update(bugReports).set(data).where(eq(bugReports.id, id));
}

// ── Review Todos ──────────────────────────────────────────────────────

export async function createReviewTodo(data: Omit<NewReviewTodo, 'id'>) {
  const id = uuid();
  await db.insert(reviewTodos).values({ ...data, id, createdAt: new Date() });
  return { id, ...data, createdAt: new Date() };
}

export async function getReviewTodo(id: string) {
  const [row] = await db.select().from(reviewTodos).where(eq(reviewTodos.id, id));
  return row;
}

export async function getReviewTodosByBuild(buildId: string) {
  return db
    .select({
      todo: reviewTodos,
      testName: tests.name,
      functionalAreaName: functionalAreas.name,
    })
    .from(reviewTodos)
    .leftJoin(tests, eq(reviewTodos.testId, tests.id))
    .leftJoin(functionalAreas, eq(tests.functionalAreaId, functionalAreas.id))
    .where(eq(reviewTodos.buildId, buildId))
    .orderBy(desc(reviewTodos.createdAt));
}

export async function getReviewTodosByBranch(repositoryId: string, branch: string) {
  return db
    .select({
      todo: reviewTodos,
      testName: tests.name,
      functionalAreaName: functionalAreas.name,
    })
    .from(reviewTodos)
    .leftJoin(tests, eq(reviewTodos.testId, tests.id))
    .leftJoin(functionalAreas, eq(tests.functionalAreaId, functionalAreas.id))
    .where(and(eq(reviewTodos.repositoryId, repositoryId), eq(reviewTodos.branch, branch)))
    .orderBy(desc(reviewTodos.createdAt));
}

export async function getOpenTodoBranches(repositoryId: string) {
  const rows = await db
    .selectDistinct({ branch: reviewTodos.branch })
    .from(reviewTodos)
    .where(and(eq(reviewTodos.repositoryId, repositoryId), eq(reviewTodos.status, 'open')));
  return rows.map(r => r.branch);
}

export async function updateReviewTodo(id: string, data: Partial<NewReviewTodo>) {
  await db.update(reviewTodos).set(data).where(eq(reviewTodos.id, id));
}

export async function deleteReviewTodo(id: string) {
  await db.delete(reviewTodos).where(eq(reviewTodos.id, id));
}

export async function getReviewSummaryByBranch(repositoryId: string, branch: string) {
  const todos = await getReviewTodosByBranch(repositoryId, branch);
  const openCount = todos.filter(t => t.todo.status === 'open').length;
  const resolvedCount = todos.filter(t => t.todo.status === 'resolved').length;

  // Group by functional area
  const byArea: Record<string, { total: number; open: number; resolved: number }> = {};
  for (const t of todos) {
    const area = t.functionalAreaName || 'Ungrouped';
    if (!byArea[area]) byArea[area] = { total: 0, open: 0, resolved: 0 };
    byArea[area].total++;
    if (t.todo.status === 'open') byArea[area].open++;
    else byArea[area].resolved++;
  }

  return { openCount, resolvedCount, totalCount: todos.length, byArea };
}
