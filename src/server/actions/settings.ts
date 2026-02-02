'use server';

import * as queries from '@/lib/db/queries';
import type { SelectorConfig, RecordingEngine } from '@/lib/db/schema';
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
  headlessMode?: string;
  navigationTimeout?: number;
  actionTimeout?: number;
  pointerGestures?: boolean;
  cursorFPS?: number;
  enabledRecordingEngines?: RecordingEngine[];
  defaultRecordingEngine?: string;
  freezeAnimations?: boolean;
  screenshotDelay?: number;
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
  includeAntiAliasing?: boolean;
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

// Notification Settings
export async function getNotificationSettingsAction(repositoryId?: string | null) {
  return queries.getNotificationSettings(repositoryId);
}

export async function saveNotificationSettings(data: {
  repositoryId?: string | null;
  slackWebhookUrl?: string | null;
  slackEnabled?: boolean;
  githubPrCommentsEnabled?: boolean;
}) {
  const { repositoryId, ...settingsData } = data;

  await queries.upsertNotificationSettings(repositoryId || null, settingsData);

  revalidatePath('/settings');

  return { success: true };
}
