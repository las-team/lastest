'use server';

import { revalidatePath } from 'next/cache';
import * as queries from '@/lib/db/queries';
import { requireTeamAccess } from '@/lib/auth';
import type { StabilizationSettings } from '@/lib/db/schema';

export async function saveTestStabilizationOverrides(testId: string, overrides: Partial<StabilizationSettings> | null) {
  await requireTeamAccess();
  await queries.updateTestStabilizationOverrides(testId, overrides);
  revalidatePath(`/tests/${testId}`);
  return { success: true };
}

export async function resetTestStabilizationOverrides(testId: string) {
  await requireTeamAccess();
  await queries.updateTestStabilizationOverrides(testId, null);
  revalidatePath(`/tests/${testId}`);
  return { success: true };
}
