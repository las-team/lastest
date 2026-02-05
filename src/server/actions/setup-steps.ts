'use server';

import { revalidatePath } from 'next/cache';
import * as queries from '@/lib/db/queries';
import type { TestSetupOverrides } from '@/lib/db/schema';

export interface SetupStep {
  id: string;
  stepType: 'test' | 'script';
  testId: string | null;
  scriptId: string | null;
  orderIndex: number;
  testName: string | null;
  scriptName: string | null;
}

export interface SetupStepInput {
  stepType: 'test' | 'script';
  testId?: string | null;
  scriptId?: string | null;
}

/**
 * Get all default setup steps for a repository
 */
export async function getDefaultSetupSteps(repositoryId: string): Promise<SetupStep[]> {
  const steps = await queries.getDefaultSetupSteps(repositoryId);
  return steps.map((step) => ({
    id: step.id,
    stepType: step.stepType as 'test' | 'script',
    testId: step.testId,
    scriptId: step.scriptId,
    orderIndex: step.orderIndex,
    testName: step.testName,
    scriptName: step.scriptName,
  }));
}

/**
 * Replace all default setup steps with a new ordered list
 */
export async function updateDefaultSetupSteps(
  repositoryId: string,
  steps: SetupStepInput[]
) {
  await queries.replaceDefaultSetupSteps(repositoryId, steps);
  revalidatePath('/env');
  return { success: true };
}

/**
 * Add a single step to the end of the default setup
 */
export async function addDefaultSetupStep(
  repositoryId: string,
  stepType: 'test' | 'script',
  itemId: string
) {
  // Get current max order index
  const existing = await queries.getDefaultSetupSteps(repositoryId);
  const maxOrder = existing.length > 0
    ? Math.max(...existing.map((s) => s.orderIndex))
    : -1;

  await queries.createDefaultSetupStep({
    repositoryId,
    stepType,
    testId: stepType === 'test' ? itemId : null,
    scriptId: stepType === 'script' ? itemId : null,
    orderIndex: maxOrder + 1,
  });

  revalidatePath('/env');
  return { success: true };
}

/**
 * Remove a step from the default setup
 */
export async function removeDefaultSetupStep(stepId: string) {
  await queries.deleteDefaultSetupStep(stepId);
  revalidatePath('/env');
  return { success: true };
}

/**
 * Reorder default setup steps
 */
export async function reorderDefaultSetupSteps(
  repositoryId: string,
  stepIds: string[]
) {
  // Update each step's order index
  for (let i = 0; i < stepIds.length; i++) {
    await queries.updateDefaultSetupStepOrder(stepIds[i], i);
  }

  revalidatePath('/env');
  return { success: true };
}

// ============================================
// Per-Test Setup Overrides
// ============================================

export async function getTestSetupOverrides(testId: string) {
  const test = await queries.getTest(testId);
  if (!test) return { overrides: null, resolvedSteps: [] };

  const resolvedSteps = await queries.getResolvedSetupStepsForTest(test);
  return { overrides: test.setupOverrides, resolvedSteps };
}

export async function saveTestSetupOverrides(testId: string, overrides: TestSetupOverrides | null) {
  await queries.updateTestSetupOverrides(testId, overrides);
  revalidatePath(`/tests/${testId}`);
  return { success: true };
}

export async function skipDefaultStepForTest(testId: string, defaultStepId: string) {
  const test = await queries.getTest(testId);
  if (!test) return { success: false, error: 'Test not found' };

  const overrides: TestSetupOverrides = test.setupOverrides ?? { skippedDefaultStepIds: [], extraSteps: [] };
  if (!overrides.skippedDefaultStepIds.includes(defaultStepId)) {
    overrides.skippedDefaultStepIds.push(defaultStepId);
  }
  await queries.updateTestSetupOverrides(testId, overrides);
  revalidatePath(`/tests/${testId}`);
  return { success: true };
}

export async function unskipDefaultStepForTest(testId: string, defaultStepId: string) {
  const test = await queries.getTest(testId);
  if (!test) return { success: false, error: 'Test not found' };

  const overrides: TestSetupOverrides = test.setupOverrides ?? { skippedDefaultStepIds: [], extraSteps: [] };
  overrides.skippedDefaultStepIds = overrides.skippedDefaultStepIds.filter((id) => id !== defaultStepId);
  if (overrides.skippedDefaultStepIds.length === 0 && overrides.extraSteps.length === 0) {
    await queries.updateTestSetupOverrides(testId, null);
  } else {
    await queries.updateTestSetupOverrides(testId, overrides);
  }
  revalidatePath(`/tests/${testId}`);
  return { success: true };
}

export async function addExtraSetupStep(testId: string, stepType: 'test' | 'script', itemId: string) {
  const test = await queries.getTest(testId);
  if (!test) return { success: false, error: 'Test not found' };

  const overrides: TestSetupOverrides = test.setupOverrides ?? { skippedDefaultStepIds: [], extraSteps: [] };
  overrides.extraSteps.push({
    stepType,
    testId: stepType === 'test' ? itemId : null,
    scriptId: stepType === 'script' ? itemId : null,
  });
  await queries.updateTestSetupOverrides(testId, overrides);
  revalidatePath(`/tests/${testId}`);
  return { success: true };
}

export async function removeExtraSetupStep(testId: string, index: number) {
  const test = await queries.getTest(testId);
  if (!test) return { success: false, error: 'Test not found' };

  const overrides: TestSetupOverrides = test.setupOverrides ?? { skippedDefaultStepIds: [], extraSteps: [] };
  if (index >= 0 && index < overrides.extraSteps.length) {
    overrides.extraSteps.splice(index, 1);
  }
  if (overrides.skippedDefaultStepIds.length === 0 && overrides.extraSteps.length === 0) {
    await queries.updateTestSetupOverrides(testId, null);
  } else {
    await queries.updateTestSetupOverrides(testId, overrides);
  }
  revalidatePath(`/tests/${testId}`);
  return { success: true };
}

export async function reorderExtraSetupSteps(testId: string, newOrder: number[]) {
  const test = await queries.getTest(testId);
  if (!test) return { success: false, error: 'Test not found' };

  const overrides: TestSetupOverrides = test.setupOverrides ?? { skippedDefaultStepIds: [], extraSteps: [] };
  const reordered = newOrder.map((i) => overrides.extraSteps[i]).filter(Boolean);
  overrides.extraSteps = reordered;
  await queries.updateTestSetupOverrides(testId, overrides);
  revalidatePath(`/tests/${testId}`);
  return { success: true };
}
