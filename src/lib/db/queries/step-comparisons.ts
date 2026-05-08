/**
 * Step-comparison queries (v1.13). One row per `(buildId, testId, stepLabel)`
 * carrying the unified multi-layer verdict and evidence chain.
 */

import { db } from '../index';
import { stepComparisons } from '../schema';
import type { NewStepComparison, StepComparison } from '../schema';
import { eq, and } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

export async function createStepComparison(data: Omit<NewStepComparison, 'id'>): Promise<StepComparison> {
  const id = uuid();
  await db.insert(stepComparisons).values({ ...data, id });
  const [row] = await db.select().from(stepComparisons).where(eq(stepComparisons.id, id));
  return row;
}

export async function getStepComparisonsByBuild(buildId: string): Promise<StepComparison[]> {
  return await db.select().from(stepComparisons).where(eq(stepComparisons.buildId, buildId));
}

export async function getStepComparisonsByTestResult(testResultId: string): Promise<StepComparison[]> {
  return await db.select().from(stepComparisons).where(eq(stepComparisons.testResultId, testResultId));
}

export async function getStepComparisonByVisualDiff(visualDiffId: string): Promise<StepComparison | undefined> {
  const [row] = await db.select().from(stepComparisons).where(eq(stepComparisons.visualDiffId, visualDiffId));
  return row;
}

export async function countStepComparisonVerdicts(buildId: string): Promise<{ green: number; yellow: number; red: number }> {
  const rows = await db.select().from(stepComparisons).where(eq(stepComparisons.buildId, buildId));
  const counts = { green: 0, yellow: 0, red: 0 };
  for (const r of rows) counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;
  return counts;
}

export async function deleteStepComparisonsByBuild(buildId: string): Promise<void> {
  await db.delete(stepComparisons).where(eq(stepComparisons.buildId, buildId));
}

export async function getStepComparisonForStep(
  buildId: string,
  testId: string,
  stepLabel: string | null,
): Promise<StepComparison | undefined> {
  const conds = [eq(stepComparisons.buildId, buildId), eq(stepComparisons.testId, testId)];
  if (stepLabel != null) conds.push(eq(stepComparisons.stepLabel, stepLabel));
  const [row] = await db.select().from(stepComparisons).where(and(...conds));
  return row;
}
