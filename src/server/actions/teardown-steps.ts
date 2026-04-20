'use server';

import { revalidatePath } from 'next/cache';
import * as queries from '@/lib/db/queries';
import { requireTeamAccess, requireRepoAccess } from '@/lib/auth';
import type { TestTeardownOverrides } from '@/lib/db/schema';

export interface TeardownStep {
  id: string;
  stepType: 'test' | 'script' | 'storage_state';
  testId: string | null;
  scriptId: string | null;
  storageStateId: string | null;
  orderIndex: number;
  testName: string | null;
  scriptName: string | null;
  storageStateName: string | null;
}

export interface TeardownStepInput {
  stepType: 'test' | 'script';
  testId?: string | null;
  scriptId?: string | null;
}

/**
 * Get all default teardown steps for a repository
 */
export async function getDefaultTeardownSteps(repositoryId: string): Promise<TeardownStep[]> {
  const steps = await queries.getDefaultTeardownSteps(repositoryId);
  return steps.map((step) => ({
    id: step.id,
    stepType: step.stepType as 'test' | 'script' | 'storage_state',
    testId: step.testId,
    scriptId: step.scriptId,
    storageStateId: null,
    orderIndex: step.orderIndex,
    testName: step.testName,
    scriptName: step.scriptName,
    storageStateName: null,
  }));
}

/**
 * Add a single step to the end of the default teardown
 */
export async function addDefaultTeardownStep(
  repositoryId: string,
  stepType: 'test' | 'script' | 'storage_state',
  itemId: string
) {
  await requireRepoAccess(repositoryId);
  const existing = await queries.getDefaultTeardownSteps(repositoryId);
  const maxOrder = existing.length > 0
    ? Math.max(...existing.map((s) => s.orderIndex))
    : -1;

  await queries.createDefaultTeardownStep({
    repositoryId,
    stepType,
    testId: stepType === 'test' ? itemId : null,
    scriptId: stepType === 'script' ? itemId : null,
    orderIndex: maxOrder + 1,
  });

  revalidatePath('/tests');
  return { success: true };
}

/**
 * Remove a step from the default teardown
 */
export async function removeDefaultTeardownStep(stepId: string) {
  await requireTeamAccess();
  await queries.deleteDefaultTeardownStep(stepId);
  revalidatePath('/tests');
  return { success: true };
}

/**
 * Reorder default teardown steps
 */
export async function reorderDefaultTeardownSteps(
  repositoryId: string,
  stepIds: string[]
) {
  await requireRepoAccess(repositoryId);
  for (let i = 0; i < stepIds.length; i++) {
    await queries.updateDefaultTeardownStepOrder(stepIds[i], i);
  }

  revalidatePath('/tests');
  return { success: true };
}

// ============================================
// Per-Test Teardown Overrides
// ============================================

export async function getTestTeardownOverrides(testId: string) {
  const test = await queries.getTest(testId);
  if (!test) return { overrides: null, resolvedSteps: [] };

  const resolvedSteps = await queries.getResolvedTeardownStepsForTest(test);
  return { overrides: test.teardownOverrides, resolvedSteps };
}

export async function saveTestTeardownOverrides(testId: string, overrides: TestTeardownOverrides | null) {
  await requireTeamAccess();
  await queries.updateTestTeardownOverrides(testId, overrides);
  revalidatePath(`/tests/${testId}`);
  return { success: true };
}

export async function skipDefaultTeardownStepForTest(testId: string, defaultStepId: string) {
  await requireTeamAccess();
  const test = await queries.getTest(testId);
  if (!test) return { success: false, error: 'Test not found' };

  const overrides: TestTeardownOverrides = test.teardownOverrides ?? { skippedDefaultStepIds: [], extraSteps: [] };
  if (!overrides.skippedDefaultStepIds.includes(defaultStepId)) {
    overrides.skippedDefaultStepIds.push(defaultStepId);
  }
  await queries.updateTestTeardownOverrides(testId, overrides);
  revalidatePath(`/tests/${testId}`);
  return { success: true };
}

export async function unskipDefaultTeardownStepForTest(testId: string, defaultStepId: string) {
  await requireTeamAccess();
  const test = await queries.getTest(testId);
  if (!test) return { success: false, error: 'Test not found' };

  const overrides: TestTeardownOverrides = test.teardownOverrides ?? { skippedDefaultStepIds: [], extraSteps: [] };
  overrides.skippedDefaultStepIds = overrides.skippedDefaultStepIds.filter((id) => id !== defaultStepId);
  if (overrides.skippedDefaultStepIds.length === 0 && overrides.extraSteps.length === 0) {
    await queries.updateTestTeardownOverrides(testId, null);
  } else {
    await queries.updateTestTeardownOverrides(testId, overrides);
  }
  revalidatePath(`/tests/${testId}`);
  return { success: true };
}

export async function addExtraTeardownStep(testId: string, stepType: 'test' | 'script', itemId: string) {
  await requireTeamAccess();
  const test = await queries.getTest(testId);
  if (!test) return { success: false, error: 'Test not found' };

  const overrides: TestTeardownOverrides = test.teardownOverrides ?? { skippedDefaultStepIds: [], extraSteps: [] };
  overrides.extraSteps.push({
    stepType,
    testId: stepType === 'test' ? itemId : null,
    scriptId: stepType === 'script' ? itemId : null,
  });
  await queries.updateTestTeardownOverrides(testId, overrides);
  revalidatePath(`/tests/${testId}`);
  return { success: true };
}

export async function removeExtraTeardownStep(testId: string, index: number) {
  await requireTeamAccess();
  const test = await queries.getTest(testId);
  if (!test) return { success: false, error: 'Test not found' };

  const overrides: TestTeardownOverrides = test.teardownOverrides ?? { skippedDefaultStepIds: [], extraSteps: [] };
  if (index >= 0 && index < overrides.extraSteps.length) {
    overrides.extraSteps.splice(index, 1);
  }
  if (overrides.skippedDefaultStepIds.length === 0 && overrides.extraSteps.length === 0) {
    await queries.updateTestTeardownOverrides(testId, null);
  } else {
    await queries.updateTestTeardownOverrides(testId, overrides);
  }
  revalidatePath(`/tests/${testId}`);
  return { success: true };
}

export async function reorderExtraTeardownSteps(testId: string, newOrder: number[]) {
  await requireTeamAccess();
  const test = await queries.getTest(testId);
  if (!test) return { success: false, error: 'Test not found' };

  const overrides: TestTeardownOverrides = test.teardownOverrides ?? { skippedDefaultStepIds: [], extraSteps: [] };
  const reordered = newOrder.map((i) => overrides.extraSteps[i]).filter(Boolean);
  overrides.extraSteps = reordered;
  await queries.updateTestTeardownOverrides(testId, overrides);
  revalidatePath(`/tests/${testId}`);
  return { success: true };
}
