'use server';

import { revalidatePath } from 'next/cache';
import * as queries from '@/lib/db/queries';
import { requireTestOwnership } from '@/lib/auth/ownership';
import type { StabilizationSettings } from '@/lib/db/schema';

export async function saveTestStabilizationOverrides(testId: string, overrides: Partial<StabilizationSettings> | null) {
  await requireTestOwnership(testId);
  await queries.updateTestStabilizationOverrides(testId, overrides);
  revalidatePath(`/tests/${testId}`);
  return { success: true };
}

export async function resetTestStabilizationOverrides(testId: string) {
  await requireTestOwnership(testId);
  await queries.updateTestStabilizationOverrides(testId, null);
  revalidatePath(`/tests/${testId}`);
  return { success: true };
}
