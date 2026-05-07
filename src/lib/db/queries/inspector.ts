import { db } from '../index';
import { inspectorCache, tests, repositories } from '../schema';
import type { InspectionResult } from '../schema';
import { eq, lt } from 'drizzle-orm';

export async function getInspectorCacheEntry(cacheKey: string) {
  const [row] = await db
    .select()
    .from(inspectorCache)
    .where(eq(inspectorCache.cacheKey, cacheKey));
  return row;
}

export async function putInspectorCacheEntry(
  cacheKey: string,
  testId: string,
  currentResultId: string,
  baselineResultId: string,
  engine: string,
  payload: InspectionResult,
) {
  await db
    .insert(inspectorCache)
    .values({
      cacheKey,
      testId,
      currentResultId,
      baselineResultId,
      engine,
      payload,
    })
    .onConflictDoUpdate({
      target: inspectorCache.cacheKey,
      set: { payload, computedAt: new Date() },
    });
}

export async function dropInspectorCacheForTest(testId: string) {
  await db.delete(inspectorCache).where(eq(inspectorCache.testId, testId));
}

export async function dropInspectorCacheForResult(testResultId: string) {
  await db
    .delete(inspectorCache)
    .where(eq(inspectorCache.currentResultId, testResultId));
}

export async function sweepInspectorCacheOlderThan(cutoff: Date) {
  await db.delete(inspectorCache).where(lt(inspectorCache.computedAt, cutoff));
}

export async function getRepoIdForTest(testId: string): Promise<string | null> {
  const [row] = await db
    .select({ repositoryId: tests.repositoryId })
    .from(tests)
    .where(eq(tests.id, testId));
  return row?.repositoryId ?? null;
}

export async function getRepoTeamIdForTest(testId: string): Promise<string | null> {
  const [row] = await db
    .select({ teamId: repositories.teamId })
    .from(tests)
    .innerJoin(repositories, eq(tests.repositoryId, repositories.id))
    .where(eq(tests.id, testId));
  return row?.teamId ?? null;
}

