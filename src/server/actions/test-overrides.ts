'use server';

import { revalidatePath } from 'next/cache';
import * as queries from '@/lib/db/queries';
import { requireRepoAccess, requireTeamAccess } from '@/lib/auth';
import type { TestDiffOverrides, TestPlaywrightOverrides } from '@/lib/db/schema';

export async function saveTestDiffOverrides(testId: string, repositoryId: string | null, overrides: TestDiffOverrides | null) {
  if (repositoryId) await requireRepoAccess(repositoryId);
  else await requireTeamAccess();
  await queries.updateTestDiffOverrides(testId, overrides);
  revalidatePath(`/tests/${testId}`);
  return { success: true };
}

export async function resetTestDiffOverrides(testId: string, repositoryId: string | null) {
  if (repositoryId) await requireRepoAccess(repositoryId);
  else await requireTeamAccess();
  await queries.updateTestDiffOverrides(testId, null);
  revalidatePath(`/tests/${testId}`);
  return { success: true };
}

export async function saveTestPlaywrightOverrides(testId: string, repositoryId: string | null, overrides: TestPlaywrightOverrides | null) {
  if (repositoryId) await requireRepoAccess(repositoryId);
  else await requireTeamAccess();
  await queries.updateTestPlaywrightOverrides(testId, overrides);
  revalidatePath(`/tests/${testId}`);
  return { success: true };
}

export async function resetTestPlaywrightOverrides(testId: string, repositoryId: string | null) {
  if (repositoryId) await requireRepoAccess(repositoryId);
  else await requireTeamAccess();
  await queries.updateTestPlaywrightOverrides(testId, null);
  revalidatePath(`/tests/${testId}`);
  return { success: true };
}
