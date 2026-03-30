import { db } from '../index';
import {
  playwrightSettings,
  environmentConfigs,
  diffSensitivitySettings,
  aiSettings,
  aiPromptLogs,
  notificationSettings,
} from '../schema';
import {
  DEFAULT_SELECTOR_PRIORITY,
  DEFAULT_DIFF_THRESHOLDS,
  DEFAULT_AI_SETTINGS,
  DEFAULT_RECORDING_ENGINES,
  DEFAULT_NOTIFICATION_SETTINGS,
  DEFAULT_STABILIZATION_SETTINGS,
} from '../schema';
import type {
  NewPlaywrightSettings,
  NewEnvironmentConfig,
  NewDiffSensitivitySettings,
  NewAISettings,
  NewAIPromptLog,
  NewNotificationSettings,
  SelectorConfig,
  AIProvider,
} from '../schema';
import { eq, desc, isNull } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

export { DEFAULT_SELECTOR_PRIORITY, DEFAULT_DIFF_THRESHOLDS, DEFAULT_AI_SETTINGS, DEFAULT_RECORDING_ENGINES, DEFAULT_NOTIFICATION_SETTINGS };

// Helper to merge saved selector priority with defaults (adds new types)
function mergeSelectorPriority(saved: SelectorConfig[] | null | undefined): SelectorConfig[] {
  if (!saved || saved.length === 0) return DEFAULT_SELECTOR_PRIORITY;

  const savedTypes = new Set(saved.map(s => s.type));
  const maxPriority = Math.max(...saved.map(s => s.priority));

  // Add any new selector types from defaults that aren't in saved
  const newTypes = DEFAULT_SELECTOR_PRIORITY.filter(d => !savedTypes.has(d.type));
  if (newTypes.length === 0) return saved;

  return [
    ...saved,
    ...newTypes.map((t, i) => ({ ...t, priority: maxPriority + 1 + i })),
  ];
}

// Playwright Settings
export async function getPlaywrightSettings(repositoryId?: string | null) {
  if (repositoryId) {
    const settings = await db
      .select()
      .from(playwrightSettings)
      .where(eq(playwrightSettings.repositoryId, repositoryId))
      .get();
    if (settings) {
      return {
        ...settings,
        selectorPriority: mergeSelectorPriority(settings.selectorPriority),
        enabledRecordingEngines: settings.enabledRecordingEngines ?? DEFAULT_RECORDING_ENGINES,
        defaultRecordingEngine: settings.defaultRecordingEngine ?? 'lastest',
        stabilization: settings.stabilization ?? DEFAULT_STABILIZATION_SETTINGS,
        browsers: settings.browsers ?? ['chromium'],
      };
    }
  }

  // Return global settings (no repositoryId) or defaults
  const globalSettings = await db
    .select()
    .from(playwrightSettings)
    .where(isNull(playwrightSettings.repositoryId))
    .get();

  if (globalSettings) {
    return {
      ...globalSettings,
      selectorPriority: mergeSelectorPriority(globalSettings.selectorPriority),
      enabledRecordingEngines: globalSettings.enabledRecordingEngines ?? DEFAULT_RECORDING_ENGINES,
      defaultRecordingEngine: globalSettings.defaultRecordingEngine ?? 'lastest',
      stabilization: globalSettings.stabilization ?? DEFAULT_STABILIZATION_SETTINGS,
      browsers: globalSettings.browsers ?? ['chromium'],
    };
  }

  // Return default settings object (not saved)
  return {
    id: '',
    repositoryId: null,
    selectorPriority: DEFAULT_SELECTOR_PRIORITY,
    browser: 'chromium' as const,
    viewportWidth: 1280,
    viewportHeight: 720,
    lockViewportToRecording: false,
    headlessMode: 'true' as const,
    navigationTimeout: 30000,
    actionTimeout: 5000,
    pointerGestures: false,
    cursorFPS: 30,
    cursorPlaybackSpeed: 1,
    enabledRecordingEngines: DEFAULT_RECORDING_ENGINES,
    defaultRecordingEngine: 'lastest' as const,
    freezeAnimations: false,
    enableVideoRecording: false,
    screenshotDelay: 0,
    maxParallelTests: 1,
    stabilization: DEFAULT_STABILIZATION_SETTINGS,
    acceptAnyCertificate: false,
    networkErrorMode: 'fail',
    ignoreExternalNetworkErrors: false,
    consoleErrorMode: 'fail',
    grantClipboardAccess: false,
    acceptDownloads: false,
    enableNetworkInterception: false,
    browsers: ['chromium'] as string[],
    autoRetryCount: 0,
    enableA11y: false,
    createdAt: null,
    updatedAt: null,
  };
}

export async function createPlaywrightSettings(data: Omit<NewPlaywrightSettings, 'id' | 'createdAt' | 'updatedAt'>) {
  const id = uuid();
  const now = new Date();
  await db.insert(playwrightSettings).values({
    ...data,
    id,
    selectorPriority: data.selectorPriority || DEFAULT_SELECTOR_PRIORITY,
    createdAt: now,
    updatedAt: now,
  });
  return { id, ...data, createdAt: now, updatedAt: now };
}

export async function updatePlaywrightSettings(id: string, data: Partial<NewPlaywrightSettings>) {
  await db.update(playwrightSettings).set({ ...data, updatedAt: new Date() }).where(eq(playwrightSettings.id, id));
}

export async function upsertPlaywrightSettings(repositoryId: string | null, data: Partial<NewPlaywrightSettings>) {
  const whereClause = repositoryId
    ? eq(playwrightSettings.repositoryId, repositoryId)
    : isNull(playwrightSettings.repositoryId);

  const existing = await db
    .select()
    .from(playwrightSettings)
    .where(whereClause)
    .get();

  if (existing) {
    await updatePlaywrightSettings(existing.id, data);
    return { ...existing, ...data, updatedAt: new Date() };
  } else {
    return createPlaywrightSettings({ ...data, repositoryId: repositoryId ?? undefined });
  }
}

export async function deletePlaywrightSettings(id: string) {
  await db.delete(playwrightSettings).where(eq(playwrightSettings.id, id));
}

// Environment Configs
export async function getEnvironmentConfig(repositoryId?: string | null) {
  if (repositoryId) {
    const config = await db
      .select()
      .from(environmentConfigs)
      .where(eq(environmentConfigs.repositoryId, repositoryId))
      .get();
    if (config) return { ...config, baseUrl: config.baseUrl.replace(/\/+$/, '') };
  }

  // Return global config (no repositoryId) or defaults
  const globalConfig = await db
    .select()
    .from(environmentConfigs)
    .where(eq(environmentConfigs.repositoryId, ''))
    .get();

  if (globalConfig) return { ...globalConfig, baseUrl: globalConfig.baseUrl.replace(/\/+$/, '') };

  // Return default config object (not saved)
  return {
    id: '',
    repositoryId: null,
    mode: 'manual' as const,
    baseUrl: 'http://localhost:3000',
    startCommand: null,
    healthCheckUrl: null,
    healthCheckTimeout: 60000,
    reuseExistingServer: true,
    createdAt: null,
    updatedAt: null,
  };
}

export async function createEnvironmentConfig(data: Omit<NewEnvironmentConfig, 'id' | 'createdAt' | 'updatedAt'>) {
  const id = uuid();
  const now = new Date();
  await db.insert(environmentConfigs).values({
    ...data,
    id,
    createdAt: now,
    updatedAt: now,
  });
  return { id, ...data, createdAt: now, updatedAt: now };
}

export async function updateEnvironmentConfig(id: string, data: Partial<NewEnvironmentConfig>) {
  await db.update(environmentConfigs).set({ ...data, updatedAt: new Date() }).where(eq(environmentConfigs.id, id));
}

export async function upsertEnvironmentConfig(repositoryId: string | null, data: Partial<NewEnvironmentConfig>) {
  const whereClause = repositoryId
    ? eq(environmentConfigs.repositoryId, repositoryId)
    : isNull(environmentConfigs.repositoryId);

  const existing = await db
    .select()
    .from(environmentConfigs)
    .where(whereClause)
    .get();

  if (existing) {
    await updateEnvironmentConfig(existing.id, data);
    return { ...existing, ...data, updatedAt: new Date() };
  } else {
    return createEnvironmentConfig({ ...data, repositoryId: repositoryId ?? undefined });
  }
}

export async function deleteEnvironmentConfig(id: string) {
  await db.delete(environmentConfigs).where(eq(environmentConfigs.id, id));
}

// Diff Sensitivity Settings
export async function getDiffSensitivitySettings(repositoryId?: string | null) {
  if (repositoryId) {
    const settings = await db
      .select()
      .from(diffSensitivitySettings)
      .where(eq(diffSensitivitySettings.repositoryId, repositoryId))
      .get();
    if (settings) return settings;
  }

  // Return global settings (no repositoryId) or defaults
  const globalSettings = await db
    .select()
    .from(diffSensitivitySettings)
    .where(eq(diffSensitivitySettings.repositoryId, ''))
    .get();

  if (globalSettings) return globalSettings;

  // Return default settings object (not saved)
  return {
    id: '',
    repositoryId: null,
    unchangedThreshold: DEFAULT_DIFF_THRESHOLDS.unchangedThreshold,
    flakyThreshold: DEFAULT_DIFF_THRESHOLDS.flakyThreshold,
    includeAntiAliasing: DEFAULT_DIFF_THRESHOLDS.includeAntiAliasing,
    ignorePageShift: DEFAULT_DIFF_THRESHOLDS.ignorePageShift,
    diffEngine: DEFAULT_DIFF_THRESHOLDS.diffEngine,
    textRegionAwareDiffing: DEFAULT_DIFF_THRESHOLDS.textRegionAwareDiffing,
    textRegionThreshold: DEFAULT_DIFF_THRESHOLDS.textRegionThreshold,
    textRegionPadding: DEFAULT_DIFF_THRESHOLDS.textRegionPadding,
    textDetectionGranularity: DEFAULT_DIFF_THRESHOLDS.textDetectionGranularity,
    regionDetectionMode: DEFAULT_DIFF_THRESHOLDS.regionDetectionMode,
    createdAt: null,
    updatedAt: null,
  };
}

export async function createDiffSensitivitySettings(data: Omit<NewDiffSensitivitySettings, 'id' | 'createdAt' | 'updatedAt'>) {
  const id = uuid();
  const now = new Date();
  await db.insert(diffSensitivitySettings).values({
    ...data,
    id,
    createdAt: now,
    updatedAt: now,
  });
  return { id, ...data, createdAt: now, updatedAt: now };
}

export async function updateDiffSensitivitySettings(id: string, data: Partial<NewDiffSensitivitySettings>) {
  await db.update(diffSensitivitySettings).set({ ...data, updatedAt: new Date() }).where(eq(diffSensitivitySettings.id, id));
}

export async function upsertDiffSensitivitySettings(repositoryId: string | null, data: Partial<NewDiffSensitivitySettings>) {
  const whereClause = repositoryId
    ? eq(diffSensitivitySettings.repositoryId, repositoryId)
    : isNull(diffSensitivitySettings.repositoryId);

  const existing = await db
    .select()
    .from(diffSensitivitySettings)
    .where(whereClause)
    .get();

  if (existing) {
    await updateDiffSensitivitySettings(existing.id, data);
    return { ...existing, ...data, updatedAt: new Date() };
  } else {
    return createDiffSensitivitySettings({ ...data, repositoryId: repositoryId ?? undefined });
  }
}

export async function deleteDiffSensitivitySettings(id: string) {
  await db.delete(diffSensitivitySettings).where(eq(diffSensitivitySettings.id, id));
}

// AI Settings
export async function getAISettings(repositoryId?: string | null) {
  if (repositoryId) {
    const settings = await db
      .select()
      .from(aiSettings)
      .where(eq(aiSettings.repositoryId, repositoryId))
      .get();
    if (settings) return settings;
  }

  // Return global settings (no repositoryId) or defaults
  const globalSettings = await db
    .select()
    .from(aiSettings)
    .where(eq(aiSettings.repositoryId, ''))
    .get();

  if (globalSettings) return globalSettings;

  // Return default settings object (not saved)
  return {
    id: '',
    repositoryId: null,
    provider: DEFAULT_AI_SETTINGS.provider as AIProvider,
    openrouterApiKey: null,
    openrouterModel: DEFAULT_AI_SETTINGS.openrouterModel,
    agentSdkPermissionMode: DEFAULT_AI_SETTINGS.agentSdkPermissionMode,
    agentSdkModel: DEFAULT_AI_SETTINGS.agentSdkModel,
    agentSdkWorkingDir: null,
    customInstructions: null,
    aiDiffingEnabled: DEFAULT_AI_SETTINGS.aiDiffingEnabled,
    aiDiffingProvider: null,
    aiDiffingApiKey: null,
    aiDiffingModel: DEFAULT_AI_SETTINGS.aiDiffingModel,
    aiDiffingOllamaBaseUrl: DEFAULT_AI_SETTINGS.aiDiffingOllamaBaseUrl,
    aiDiffingOllamaModel: DEFAULT_AI_SETTINGS.aiDiffingOllamaModel,
    ollamaBaseUrl: DEFAULT_AI_SETTINGS.ollamaBaseUrl,
    ollamaModel: DEFAULT_AI_SETTINGS.ollamaModel,
    anthropicApiKey: null,
    anthropicModel: DEFAULT_AI_SETTINGS.anthropicModel,
    openaiApiKey: null,
    openaiModel: DEFAULT_AI_SETTINGS.openaiModel,
    pwAgentEnabled: DEFAULT_AI_SETTINGS.pwAgentEnabled,
    pwAgentModel: DEFAULT_AI_SETTINGS.pwAgentModel,
    pwAgentTimeout: DEFAULT_AI_SETTINGS.pwAgentTimeout,
    createdAt: null,
    updatedAt: null,
  };
}

export async function createAISettings(data: Omit<NewAISettings, 'id' | 'createdAt' | 'updatedAt'>) {
  const id = uuid();
  const now = new Date();
  await db.insert(aiSettings).values({
    ...data,
    id,
    createdAt: now,
    updatedAt: now,
  });
  return { id, ...data, createdAt: now, updatedAt: now };
}

export async function updateAISettings(id: string, data: Partial<NewAISettings>) {
  await db.update(aiSettings).set({ ...data, updatedAt: new Date() }).where(eq(aiSettings.id, id));
}

export async function upsertAISettings(repositoryId: string | null, data: Partial<NewAISettings>) {
  const whereClause = repositoryId
    ? eq(aiSettings.repositoryId, repositoryId)
    : isNull(aiSettings.repositoryId);

  const existing = await db
    .select()
    .from(aiSettings)
    .where(whereClause)
    .get();

  if (existing) {
    await updateAISettings(existing.id, data);
    return { ...existing, ...data, updatedAt: new Date() };
  } else {
    return createAISettings({ ...data, repositoryId: repositoryId ?? undefined });
  }
}

export async function deleteAISettings(id: string) {
  await db.delete(aiSettings).where(eq(aiSettings.id, id));
}

// AI Prompt Logs
export async function createAIPromptLog(data: Omit<NewAIPromptLog, 'id' | 'createdAt'>) {
  const id = uuid();
  const now = new Date();
  await db.insert(aiPromptLogs).values({
    ...data,
    id,
    createdAt: now,
  });
  return { id, ...data, createdAt: now };
}

export async function updateAIPromptLog(
  id: string,
  data: Partial<Pick<NewAIPromptLog, 'status' | 'response' | 'errorMessage' | 'durationMs'>>
) {
  await db.update(aiPromptLogs).set(data).where(eq(aiPromptLogs.id, id));
}

export async function getAIPromptLog(id: string) {
  return db.select().from(aiPromptLogs).where(eq(aiPromptLogs.id, id)).get();
}

export async function getAIPromptLogs(repositoryId?: string | null, limit = 50) {
  if (repositoryId) {
    return db
      .select()
      .from(aiPromptLogs)
      .where(eq(aiPromptLogs.repositoryId, repositoryId))
      .orderBy(desc(aiPromptLogs.createdAt))
      .limit(limit)
      .all();
  }
  return db
    .select()
    .from(aiPromptLogs)
    .orderBy(desc(aiPromptLogs.createdAt))
    .limit(limit)
    .all();
}

export async function deleteAllAIPromptLogs(repositoryId?: string | null) {
  if (repositoryId) {
    await db.delete(aiPromptLogs).where(eq(aiPromptLogs.repositoryId, repositoryId));
  } else {
    await db.delete(aiPromptLogs);
  }
}

// Notification Settings
export async function getNotificationSettings(repositoryId?: string | null) {
  if (repositoryId) {
    const settings = await db
      .select()
      .from(notificationSettings)
      .where(eq(notificationSettings.repositoryId, repositoryId))
      .get();
    if (settings) return settings;
  }

  // Return global settings (no repositoryId) or defaults
  const globalSettings = await db
    .select()
    .from(notificationSettings)
    .where(isNull(notificationSettings.repositoryId))
    .get();

  if (globalSettings) return globalSettings;

  // Return default settings object (not saved)
  return {
    id: '',
    repositoryId: null,
    slackWebhookUrl: null,
    slackEnabled: DEFAULT_NOTIFICATION_SETTINGS.slackEnabled,
    discordWebhookUrl: null,
    discordEnabled: DEFAULT_NOTIFICATION_SETTINGS.discordEnabled,
    githubPrCommentsEnabled: DEFAULT_NOTIFICATION_SETTINGS.githubPrCommentsEnabled,
    gitlabMrCommentsEnabled: DEFAULT_NOTIFICATION_SETTINGS.gitlabMrCommentsEnabled,
    customWebhookEnabled: DEFAULT_NOTIFICATION_SETTINGS.customWebhookEnabled,
    customWebhookUrl: null,
    customWebhookMethod: DEFAULT_NOTIFICATION_SETTINGS.customWebhookMethod,
    customWebhookHeaders: null,
    createdAt: null,
    updatedAt: null,
  };
}

export async function createNotificationSettings(data: Omit<NewNotificationSettings, 'id' | 'createdAt' | 'updatedAt'>) {
  const id = uuid();
  const now = new Date();
  await db.insert(notificationSettings).values({
    ...data,
    id,
    createdAt: now,
    updatedAt: now,
  });
  return { id, ...data, createdAt: now, updatedAt: now };
}

export async function updateNotificationSettings(id: string, data: Partial<NewNotificationSettings>) {
  await db.update(notificationSettings).set({ ...data, updatedAt: new Date() }).where(eq(notificationSettings.id, id));
}

export async function upsertNotificationSettings(repositoryId: string | null, data: Partial<NewNotificationSettings>) {
  const whereClause = repositoryId
    ? eq(notificationSettings.repositoryId, repositoryId)
    : isNull(notificationSettings.repositoryId);

  const existing = await db
    .select()
    .from(notificationSettings)
    .where(whereClause)
    .get();

  if (existing) {
    await updateNotificationSettings(existing.id, data);
    return { ...existing, ...data, updatedAt: new Date() };
  } else {
    return createNotificationSettings({ ...data, repositoryId: repositoryId ?? undefined });
  }
}
