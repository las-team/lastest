'use server';

import * as queries from '@/lib/db/queries';
import type { SelectorConfig } from '@/lib/db/schema';
import { revalidatePath } from 'next/cache';

export async function getPlaywrightSettings(repositoryId?: string | null) {
  return queries.getPlaywrightSettings(repositoryId);
}

export async function savePlaywrightSettings(data: {
  repositoryId?: string | null;
  selectorPriority?: SelectorConfig[];
  browser?: string;
  viewportWidth?: number;
  viewportHeight?: number;
  headless?: boolean;
  navigationTimeout?: number;
  actionTimeout?: number;
  pointerGestures?: boolean;
  cursorFPS?: number;
}) {
  const { repositoryId, ...settingsData } = data;

  await queries.upsertPlaywrightSettings(repositoryId || null, settingsData);

  revalidatePath('/settings');
  revalidatePath('/record');

  return { success: true };
}

export async function resetPlaywrightSettings(repositoryId?: string | null) {
  const settings = await queries.getPlaywrightSettings(repositoryId);

  if (settings.id) {
    await queries.deletePlaywrightSettings(settings.id);
  }

  revalidatePath('/settings');
  revalidatePath('/record');

  return { success: true };
}

// Diff Sensitivity Settings
export async function getDiffSensitivitySettingsAction(repositoryId?: string | null) {
  return queries.getDiffSensitivitySettings(repositoryId);
}

export async function saveDiffSensitivitySettings(data: {
  repositoryId?: string | null;
  unchangedThreshold?: number;
  flakyThreshold?: number;
}) {
  const { repositoryId, ...settingsData } = data;

  await queries.upsertDiffSensitivitySettings(repositoryId || null, settingsData);

  revalidatePath('/settings');
  revalidatePath('/builds');

  return { success: true };
}

export async function resetDiffSensitivitySettings(repositoryId?: string | null) {
  const settings = await queries.getDiffSensitivitySettings(repositoryId);

  if (settings.id) {
    await queries.deleteDiffSensitivitySettings(settings.id);
  }

  revalidatePath('/settings');
  revalidatePath('/builds');

  return { success: true };
}
