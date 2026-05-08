'use server';

import { revalidatePath } from 'next/cache';
import * as queries from '@/lib/db/queries';
import { requireTestOwnership } from '@/lib/auth/ownership';
import type { TestDiffOverrides, TestPlaywrightOverrides } from '@/lib/db/schema';

// `repositoryId` is preserved as a parameter for caller compatibility but it
// is no longer trusted — ownership is derived from `testId`'s repository.
// Without this, a caller could pass their own repoId + a victim's testId and
// flip override values (e.g. raise flakyThreshold to mask a regression).

export async function saveTestDiffOverrides(testId: string, _repositoryId: string | null, overrides: TestDiffOverrides | null) {
  await requireTestOwnership(testId);
  await queries.updateTestDiffOverrides(testId, overrides);
  revalidatePath(`/tests/${testId}`);
  return { success: true };
}

export async function resetTestDiffOverrides(testId: string, _repositoryId: string | null) {
  await requireTestOwnership(testId);
  await queries.updateTestDiffOverrides(testId, null);
  revalidatePath(`/tests/${testId}`);
  return { success: true };
}

export async function saveTestPlaywrightOverrides(testId: string, _repositoryId: string | null, overrides: TestPlaywrightOverrides | null) {
  await requireTestOwnership(testId);
  await queries.updateTestPlaywrightOverrides(testId, overrides);
  revalidatePath(`/tests/${testId}`);
  return { success: true };
}

export async function resetTestPlaywrightOverrides(testId: string, _repositoryId: string | null) {
  await requireTestOwnership(testId);
  await queries.updateTestPlaywrightOverrides(testId, null);
  revalidatePath(`/tests/${testId}`);
  return { success: true };
}
