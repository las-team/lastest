'use server';

import * as queries from '@/lib/db/queries';
import { requireTeamAccess, requireRepoAccess } from '@/lib/auth';
import type { SelectorConfig, RecordingEngine, StabilizationSettings } from '@/lib/db/schema';
import { revalidatePath } from 'next/cache';

export async function getPlaywrightSettings(repositoryId?: string | null) {
  await requireTeamAccess();
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
  selectorTimeoutMs?: number;
  pointerGestures?: boolean;
  cursorFPS?: number;
  cursorPlaybackSpeed?: number;
  enabledRecordingEngines?: RecordingEngine[];
  defaultRecordingEngine?: string;
  freezeAnimations?: boolean;
  enableVideoRecording?: boolean;
  enableA11y?: boolean;
  screenshotDelay?: number;
  maxParallelTests?: number;
  stabilization?: StabilizationSettings;
  acceptAnyCertificate?: boolean;
  networkErrorMode?: string;
  ignoreExternalNetworkErrors?: boolean;
  consoleErrorMode?: string;
  grantClipboardAccess?: boolean;
  acceptDownloads?: boolean;
  enableNetworkInterception?: boolean;
  lockViewportToRecording?: boolean;
  browsers?: string[];
  customAttributeName?: string | null;
}) {
  if (data.repositoryId) await requireRepoAccess(data.repositoryId);
  else await requireTeamAccess();
  const { repositoryId, ...settingsData } = data;

  await queries.upsertPlaywrightSettings(repositoryId || null, settingsData);

  revalidatePath('/settings');

  return { success: true };
}

export async function resetPlaywrightSettings(repositoryId?: string | null) {
  if (repositoryId) await requireRepoAccess(repositoryId);
  else await requireTeamAccess();
  const settings = await queries.getPlaywrightSettings(repositoryId);

  if (settings.id) {
    await queries.deletePlaywrightSettings(settings.id);
  }

  revalidatePath('/settings');

  return { success: true };
}

// Diff Sensitivity Settings
export async function getDiffSensitivitySettingsAction(repositoryId?: string | null) {
  await requireTeamAccess();
  return queries.getDiffSensitivitySettings(repositoryId);
}

export async function saveDiffSensitivitySettings(data: {
  repositoryId?: string | null;
  unchangedThreshold?: number;
  flakyThreshold?: number;
  includeAntiAliasing?: boolean;
  ignorePageShift?: boolean;
  diffEngine?: string;
  textRegionAwareDiffing?: boolean;
  textRegionThreshold?: number;
  textRegionPadding?: number;
  textDetectionGranularity?: string;
  regionDetectionMode?: string;
}) {
  if (data.repositoryId) await requireRepoAccess(data.repositoryId);
  else await requireTeamAccess();
  const { repositoryId, ...settingsData } = data;

  await queries.upsertDiffSensitivitySettings(repositoryId || null, settingsData);

  revalidatePath('/settings');
  revalidatePath('/builds');

  return { success: true };
}

export async function resetDiffSensitivitySettings(repositoryId?: string | null) {
  if (repositoryId) await requireRepoAccess(repositoryId);
  else await requireTeamAccess();
  const settings = await queries.getDiffSensitivitySettings(repositoryId);

  if (settings.id) {
    await queries.deleteDiffSensitivitySettings(settings.id);
  }

  revalidatePath('/settings');
  revalidatePath('/builds');

  return { success: true };
}

// Notification Settings
function maskWebhookUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}/••••••••`;
  } catch {
    return '••••••••';
  }
}

export async function getNotificationSettingsAction(repositoryId?: string | null) {
  await requireTeamAccess();
  const settings = await queries.getNotificationSettings(repositoryId);
  return {
    ...settings,
    slackWebhookUrl: maskWebhookUrl(settings.slackWebhookUrl),
    discordWebhookUrl: maskWebhookUrl(settings.discordWebhookUrl),
    customWebhookUrl: maskWebhookUrl(settings.customWebhookUrl),
    _hasSlackWebhook: !!settings.slackWebhookUrl,
    _hasDiscordWebhook: !!settings.discordWebhookUrl,
    _hasCustomWebhook: !!settings.customWebhookUrl,
  };
}

function isMaskedWebhookUrl(value: string | null | undefined): boolean {
  return !!value && value.includes('••••••••');
}

export async function saveNotificationSettings(data: {
  repositoryId?: string | null;
  slackWebhookUrl?: string | null;
  slackEnabled?: boolean;
  discordWebhookUrl?: string | null;
  discordEnabled?: boolean;
  githubPrCommentsEnabled?: boolean;
  gitlabMrCommentsEnabled?: boolean;
  customWebhookEnabled?: boolean;
  customWebhookUrl?: string | null;
  customWebhookMethod?: string;
  customWebhookHeaders?: string | null;
}) {
  if (data.repositoryId) await requireRepoAccess(data.repositoryId);
  else await requireTeamAccess();
  const { repositoryId, ...settingsData } = data;

  // Don't overwrite real URLs with masked placeholders
  if (isMaskedWebhookUrl(settingsData.slackWebhookUrl)) delete settingsData.slackWebhookUrl;
  if (isMaskedWebhookUrl(settingsData.discordWebhookUrl)) delete settingsData.discordWebhookUrl;
  if (isMaskedWebhookUrl(settingsData.customWebhookUrl)) delete settingsData.customWebhookUrl;

  await queries.upsertNotificationSettings(repositoryId || null, settingsData);

  revalidatePath('/settings');

  return { success: true };
}

export async function testCustomWebhookAction(data: {
  url: string;
  method: 'POST' | 'PUT';
  headers?: string | null;
}): Promise<{ success: boolean; statusCode?: number; error?: string }> {
  await requireTeamAccess();
  const { testCustomWebhook } = await import('@/lib/integrations/custom-webhook');

  let parsedHeaders: Record<string, string> | undefined;
  if (data.headers) {
    try {
      parsedHeaders = JSON.parse(data.headers);
    } catch {
      return { success: false, error: 'Invalid JSON in headers' };
    }
  }

  return testCustomWebhook({
    url: data.url,
    method: data.method,
    headers: parsedHeaders,
  });
}

// Early Adopter Mode
export async function updateEarlyAdopterMode(enabled: boolean) {
  const session = await requireTeamAccess();
  await queries.updateTeam(session.team.id, { earlyAdopterMode: enabled });
  revalidatePath('/settings');
  revalidatePath('/');
}

// Ban AI Mode
export async function updateBanAiMode(enabled: boolean) {
  const session = await requireTeamAccess();
  await queries.updateTeam(session.team.id, { banAiMode: enabled });
  revalidatePath('/settings');
  revalidatePath('/');
}

// Selector Stats
export async function getSelectorStatsAction(repositoryId: string) {
  await requireRepoAccess(repositoryId);
  return queries.getAggregatedSelectorStats(repositoryId);
}
