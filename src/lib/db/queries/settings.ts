import { db } from "../index";
import { encryptField, decryptField } from "@/lib/crypto";
import {
  playwrightSettings,
  environmentConfigs,
  diffSensitivitySettings,
  aiSettings,
  aiPromptLogs,
  notificationSettings,
  repositories,
  teams,
} from "../schema";
import {
  DEFAULT_SELECTOR_PRIORITY,
  DEFAULT_DIFF_THRESHOLDS,
  DEFAULT_AI_SETTINGS,
  DEFAULT_RECORDING_ENGINES,
  DEFAULT_NOTIFICATION_SETTINGS,
  DEFAULT_STABILIZATION_SETTINGS,
} from "../schema";
import type {
  NewPlaywrightSettings,
  NewEnvironmentConfig,
  NewDiffSensitivitySettings,
  NewAISettings,
  NewAIPromptLog,
  NewNotificationSettings,
  SelectorConfig,
  AIProvider,
} from "../schema";
import { eq, desc, isNull } from "drizzle-orm";
import { v4 as uuid } from "uuid";

export {
  DEFAULT_SELECTOR_PRIORITY,
  DEFAULT_DIFF_THRESHOLDS,
  DEFAULT_AI_SETTINGS,
  DEFAULT_RECORDING_ENGINES,
  DEFAULT_NOTIFICATION_SETTINGS,
};

// Helper to merge saved selector priority with defaults (adds new types)
function mergeSelectorPriority(
  saved: SelectorConfig[] | null | undefined,
): SelectorConfig[] {
  if (!saved || saved.length === 0) return DEFAULT_SELECTOR_PRIORITY;

  const savedTypes = new Set(saved.map((s) => s.type));
  const maxPriority = Math.max(...saved.map((s) => s.priority));

  // Add any new selector types from defaults that aren't in saved
  const newTypes = DEFAULT_SELECTOR_PRIORITY.filter(
    (d) => !savedTypes.has(d.type),
  );
  if (newTypes.length === 0) return saved;

  return [
    ...saved,
    ...newTypes.map((t, i) => ({ ...t, priority: maxPriority + 1 + i })),
  ];
}

// Playwright Settings
export async function getPlaywrightSettings(repositoryId?: string | null) {
  if (repositoryId) {
    const [settings] = await db
      .select()
      .from(playwrightSettings)
      .where(eq(playwrightSettings.repositoryId, repositoryId));
    if (settings) {
      return {
        ...settings,
        selectorPriority: mergeSelectorPriority(settings.selectorPriority),
        enabledRecordingEngines:
          settings.enabledRecordingEngines ?? DEFAULT_RECORDING_ENGINES,
        defaultRecordingEngine: settings.defaultRecordingEngine ?? "lastest",
        stabilization: settings.stabilization ?? DEFAULT_STABILIZATION_SETTINGS,
        browsers: settings.browsers ?? ["chromium"],
      };
    }
  }

  // Return global settings (no repositoryId) or defaults
  const [globalSettings] = await db
    .select()
    .from(playwrightSettings)
    .where(isNull(playwrightSettings.repositoryId));

  if (globalSettings) {
    return {
      ...globalSettings,
      selectorPriority: mergeSelectorPriority(globalSettings.selectorPriority),
      enabledRecordingEngines:
        globalSettings.enabledRecordingEngines ?? DEFAULT_RECORDING_ENGINES,
      defaultRecordingEngine:
        globalSettings.defaultRecordingEngine ?? "lastest",
      stabilization:
        globalSettings.stabilization ?? DEFAULT_STABILIZATION_SETTINGS,
      browsers: globalSettings.browsers ?? ["chromium"],
    };
  }

  // Return default settings object (not saved)
  return {
    id: "",
    repositoryId: null,
    selectorPriority: DEFAULT_SELECTOR_PRIORITY,
    customAttributeName: null,
    browser: "chromium" as const,
    viewportWidth: 1280,
    viewportHeight: 720,
    lockViewportToRecording: false,
    headlessMode: "true" as const,
    navigationTimeout: 30000,
    actionTimeout: 5000,
    selectorTimeoutMs: 3000,
    pointerGestures: false,
    cursorFPS: 30,
    cursorPlaybackSpeed: 1,
    enabledRecordingEngines: DEFAULT_RECORDING_ENGINES,
    defaultRecordingEngine: "lastest" as const,
    freezeAnimations: false,
    enableVideoRecording: false,
    screenshotDelay: 0,
    maxParallelTests: 1,
    maxParallelEBs: 10,
    ebPoolMax: 30,
    ebIdleTTLSeconds: 90,
    stabilization: DEFAULT_STABILIZATION_SETTINGS,
    acceptAnyCertificate: false,
    networkErrorMode: "fail",
    ignoreExternalNetworkErrors: true,
    consoleErrorMode: "fail",
    consoleErrorIgnoreHosts: null as string[] | null,
    userAgentOverride: null as string | null,
    grantClipboardAccess: false,
    acceptDownloads: false,
    enableNetworkInterception: false,
    enableDomDiff: false,
    browsers: ["chromium"] as string[],
    autoRetryCount: 0,
    enableA11y: false,
    enableDesignSystem: false,
    designSystem: null,
    // Per-check 3-way modes — null on a fresh repo, derived from legacy
    // booleans by deriveCheckModes() in src/lib/verify/check-modes.ts.
    visualMode: null as string | null,
    textMode: null as string | null,
    domMode: null as string | null,
    networkMode: null as string | null,
    consoleMode: null as string | null,
    a11yMode: null as string | null,
    designMode: null as string | null,
    perfMode: null as string | null,
    urlMode: null as string | null,
    apiMode: null as string | null,
    createdAt: null,
    updatedAt: null,
  };
}

export async function createPlaywrightSettings(
  data: Omit<NewPlaywrightSettings, "id" | "createdAt" | "updatedAt">,
) {
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

export async function updatePlaywrightSettings(
  id: string,
  data: Partial<NewPlaywrightSettings>,
) {
  await db
    .update(playwrightSettings)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(playwrightSettings.id, id));
}

export async function upsertPlaywrightSettings(
  repositoryId: string | null,
  data: Partial<NewPlaywrightSettings>,
) {
  const whereClause = repositoryId
    ? eq(playwrightSettings.repositoryId, repositoryId)
    : isNull(playwrightSettings.repositoryId);

  const [existing] = await db
    .select()
    .from(playwrightSettings)
    .where(whereClause);

  if (existing) {
    await updatePlaywrightSettings(existing.id, data);
    return { ...existing, ...data, updatedAt: new Date() };
  } else {
    return createPlaywrightSettings({
      ...data,
      repositoryId: repositoryId ?? undefined,
    });
  }
}

export async function deletePlaywrightSettings(id: string) {
  await db.delete(playwrightSettings).where(eq(playwrightSettings.id, id));
}

// Global pool-limit helpers moved to @lastest/db (`packages/db/src/settings.ts`)
// — the pool service needs them too. Re-exported so app callers keep importing
// from this module.
export {
  getGlobalPoolLimits,
  ensureGlobalPlaywrightSettings,
} from "@lastest/db/settings";

// Environment Configs
export async function getEnvironmentConfig(repositoryId?: string | null) {
  if (repositoryId) {
    const [config] = await db
      .select()
      .from(environmentConfigs)
      .where(eq(environmentConfigs.repositoryId, repositoryId));
    if (config)
      return { ...config, baseUrl: config.baseUrl.replace(/\/+$/, "") };
  }

  // Synthetic default when no repository row exists. The team-level
  // (repositoryId IS NULL) row has no UI writer and is intentionally ignored.
  return {
    id: "default",
    repositoryId: repositoryId ?? null,
    mode: "manual" as const,
    baseUrl: "http://localhost:3000",
    startCommand: null,
    healthCheckUrl: null,
    healthCheckTimeout: 60000,
    reuseExistingServer: true,
    createdAt: null,
    updatedAt: null,
  };
}

export async function createEnvironmentConfig(
  data: Omit<NewEnvironmentConfig, "id" | "createdAt" | "updatedAt">,
) {
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

export async function updateEnvironmentConfig(
  id: string,
  data: Partial<NewEnvironmentConfig>,
) {
  await db
    .update(environmentConfigs)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(environmentConfigs.id, id));
}

export async function upsertEnvironmentConfig(
  repositoryId: string,
  data: Partial<NewEnvironmentConfig>,
) {
  const [existing] = await db
    .select()
    .from(environmentConfigs)
    .where(eq(environmentConfigs.repositoryId, repositoryId));

  if (existing) {
    await updateEnvironmentConfig(existing.id, data);
    return { ...existing, ...data, updatedAt: new Date() };
  } else {
    return createEnvironmentConfig({ ...data, repositoryId });
  }
}

export async function deleteEnvironmentConfig(id: string) {
  await db.delete(environmentConfigs).where(eq(environmentConfigs.id, id));
}

// Diff Sensitivity Settings
export async function getDiffSensitivitySettings(repositoryId?: string | null) {
  if (repositoryId) {
    const [settings] = await db
      .select()
      .from(diffSensitivitySettings)
      .where(eq(diffSensitivitySettings.repositoryId, repositoryId));
    if (settings) return settings;
  }

  // Return global settings (no repositoryId) or defaults
  const [globalSettings] = await db
    .select()
    .from(diffSensitivitySettings)
    .where(eq(diffSensitivitySettings.repositoryId, ""));

  if (globalSettings) return globalSettings;

  // Return default settings object (not saved)
  return {
    id: "",
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
    textDiffEnabled: DEFAULT_DIFF_THRESHOLDS.textDiffEnabled,
    createdAt: null,
    updatedAt: null,
  };
}

export async function createDiffSensitivitySettings(
  data: Omit<NewDiffSensitivitySettings, "id" | "createdAt" | "updatedAt">,
) {
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

export async function updateDiffSensitivitySettings(
  id: string,
  data: Partial<NewDiffSensitivitySettings>,
) {
  await db
    .update(diffSensitivitySettings)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(diffSensitivitySettings.id, id));
}

export async function upsertDiffSensitivitySettings(
  repositoryId: string | null,
  data: Partial<NewDiffSensitivitySettings>,
) {
  const whereClause = repositoryId
    ? eq(diffSensitivitySettings.repositoryId, repositoryId)
    : isNull(diffSensitivitySettings.repositoryId);

  const [existing] = await db
    .select()
    .from(diffSensitivitySettings)
    .where(whereClause);

  if (existing) {
    await updateDiffSensitivitySettings(existing.id, data);
    return { ...existing, ...data, updatedAt: new Date() };
  } else {
    return createDiffSensitivitySettings({
      ...data,
      repositoryId: repositoryId ?? undefined,
    });
  }
}

export async function deleteDiffSensitivitySettings(id: string) {
  await db
    .delete(diffSensitivitySettings)
    .where(eq(diffSensitivitySettings.id, id));
}

// AI Settings
function decryptAISettingsRow<
  T extends {
    openrouterApiKey?: string | null;
    anthropicApiKey?: string | null;
    openaiApiKey?: string | null;
    aiDiffingApiKey?: string | null;
  },
>(row: T): T {
  return {
    ...row,
    openrouterApiKey: decryptField(row.openrouterApiKey),
    anthropicApiKey: decryptField(row.anthropicApiKey),
    openaiApiKey: decryptField(row.openaiApiKey),
    aiDiffingApiKey: decryptField(row.aiDiffingApiKey),
  };
}

export async function getAISettings(repositoryId?: string | null) {
  if (repositoryId) {
    const [settings] = await db
      .select()
      .from(aiSettings)
      .where(eq(aiSettings.repositoryId, repositoryId));
    if (settings) return decryptAISettingsRow(settings);
  }

  // Return global settings (no repositoryId) or defaults
  const [globalSettings] = await db
    .select()
    .from(aiSettings)
    .where(eq(aiSettings.repositoryId, ""));

  if (globalSettings) return decryptAISettingsRow(globalSettings);

  // Return default settings object (not saved)
  return {
    id: "",
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
    pwAgentModel: DEFAULT_AI_SETTINGS.pwAgentModel,
    pwAgentTimeout: DEFAULT_AI_SETTINGS.pwAgentTimeout,
    explorerMaxIterations: DEFAULT_AI_SETTINGS.explorerMaxIterations,
    explorerStyleRotation: DEFAULT_AI_SETTINGS.explorerStyleRotation,
    explorerModel: DEFAULT_AI_SETTINGS.explorerModel,
    createdAt: null,
    updatedAt: null,
  };
}

/**
 * Resolve whether in-product AI is active for a repo's team. This is the single
 * gate that replaces inferring availability from key/provider presence: it folds
 * the team-level `banAiMode` kill-switch and the `builtInAiEnabled` mode flag.
 * Returns false when the repo (or its team) can't be resolved. MCP-first: false
 * means hide in-product AI + background AI and steer the user to their own agent.
 */
export async function getInProductAiEnabled(
  repositoryId?: string | null,
): Promise<boolean> {
  if (!repositoryId) return false;
  const [row] = await db
    .select({
      banAiMode: teams.banAiMode,
      builtInAiEnabled: teams.builtInAiEnabled,
    })
    .from(repositories)
    .innerJoin(teams, eq(repositories.teamId, teams.id))
    .where(eq(repositories.id, repositoryId));
  return !!row && !row.banAiMode && !!row.builtInAiEnabled;
}

export async function createAISettings(
  data: Omit<NewAISettings, "id" | "createdAt" | "updatedAt">,
) {
  const id = uuid();
  const now = new Date();
  await db.insert(aiSettings).values({
    ...data,
    id,
    createdAt: now,
    updatedAt: now,
    openrouterApiKey: encryptField(data.openrouterApiKey),
    anthropicApiKey: encryptField(data.anthropicApiKey),
    openaiApiKey: encryptField(data.openaiApiKey),
    aiDiffingApiKey: encryptField(data.aiDiffingApiKey),
  });
  return { id, ...data, createdAt: now, updatedAt: now };
}

export async function updateAISettings(
  id: string,
  data: Partial<NewAISettings>,
) {
  const toWrite: Partial<NewAISettings> = { ...data, updatedAt: new Date() };
  if ("openrouterApiKey" in data)
    toWrite.openrouterApiKey = encryptField(data.openrouterApiKey);
  if ("anthropicApiKey" in data)
    toWrite.anthropicApiKey = encryptField(data.anthropicApiKey);
  if ("openaiApiKey" in data)
    toWrite.openaiApiKey = encryptField(data.openaiApiKey);
  if ("aiDiffingApiKey" in data)
    toWrite.aiDiffingApiKey = encryptField(data.aiDiffingApiKey);
  await db.update(aiSettings).set(toWrite).where(eq(aiSettings.id, id));
}

export async function upsertAISettings(
  repositoryId: string | null,
  data: Partial<NewAISettings>,
) {
  const whereClause = repositoryId
    ? eq(aiSettings.repositoryId, repositoryId)
    : isNull(aiSettings.repositoryId);

  const [existing] = await db.select().from(aiSettings).where(whereClause);

  if (existing) {
    await updateAISettings(existing.id, data);
    return { ...existing, ...data, updatedAt: new Date() };
  } else {
    return createAISettings({
      ...data,
      repositoryId: repositoryId ?? undefined,
    });
  }
}

export async function deleteAISettings(id: string) {
  await db.delete(aiSettings).where(eq(aiSettings.id, id));
}

// AI Prompt Logs
export async function createAIPromptLog(
  data: Omit<NewAIPromptLog, "id" | "createdAt">,
) {
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
  data: Partial<
    Pick<NewAIPromptLog, "status" | "response" | "errorMessage" | "durationMs">
  >,
) {
  await db.update(aiPromptLogs).set(data).where(eq(aiPromptLogs.id, id));
}

export async function getAIPromptLog(id: string) {
  const [row] = await db
    .select()
    .from(aiPromptLogs)
    .where(eq(aiPromptLogs.id, id));
  return row;
}

export async function getAIPromptLogs(
  repositoryId?: string | null,
  limit = 50,
) {
  if (repositoryId) {
    return db
      .select()
      .from(aiPromptLogs)
      .where(eq(aiPromptLogs.repositoryId, repositoryId))
      .orderBy(desc(aiPromptLogs.createdAt))
      .limit(limit);
  }
  return db
    .select()
    .from(aiPromptLogs)
    .orderBy(desc(aiPromptLogs.createdAt))
    .limit(limit);
}

export async function deleteAllAIPromptLogs(repositoryId?: string | null) {
  if (repositoryId) {
    await db
      .delete(aiPromptLogs)
      .where(eq(aiPromptLogs.repositoryId, repositoryId));
  } else {
    await db.delete(aiPromptLogs);
  }
}

// Notification Settings
export async function getNotificationSettings(repositoryId?: string | null) {
  if (repositoryId) {
    const [settings] = await db
      .select()
      .from(notificationSettings)
      .where(eq(notificationSettings.repositoryId, repositoryId));
    if (settings) return settings;
  }

  // Return global settings (no repositoryId) or defaults
  const [globalSettings] = await db
    .select()
    .from(notificationSettings)
    .where(isNull(notificationSettings.repositoryId));

  if (globalSettings) return globalSettings;

  // Return default settings object (not saved)
  return {
    id: "",
    repositoryId: null,
    slackWebhookUrl: null,
    slackEnabled: DEFAULT_NOTIFICATION_SETTINGS.slackEnabled,
    discordWebhookUrl: null,
    discordEnabled: DEFAULT_NOTIFICATION_SETTINGS.discordEnabled,
    githubPrCommentsEnabled:
      DEFAULT_NOTIFICATION_SETTINGS.githubPrCommentsEnabled,
    gitlabMrCommentsEnabled:
      DEFAULT_NOTIFICATION_SETTINGS.gitlabMrCommentsEnabled,
    customWebhookEnabled: DEFAULT_NOTIFICATION_SETTINGS.customWebhookEnabled,
    customWebhookUrl: null,
    customWebhookMethod: DEFAULT_NOTIFICATION_SETTINGS.customWebhookMethod,
    customWebhookHeaders: null,
    issueTrackerProvider: DEFAULT_NOTIFICATION_SETTINGS.issueTrackerProvider,
    createdAt: null,
    updatedAt: null,
  };
}

export async function createNotificationSettings(
  data: Omit<NewNotificationSettings, "id" | "createdAt" | "updatedAt">,
) {
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

export async function updateNotificationSettings(
  id: string,
  data: Partial<NewNotificationSettings>,
) {
  await db
    .update(notificationSettings)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(notificationSettings.id, id));
}

export async function upsertNotificationSettings(
  repositoryId: string | null,
  data: Partial<NewNotificationSettings>,
) {
  const whereClause = repositoryId
    ? eq(notificationSettings.repositoryId, repositoryId)
    : isNull(notificationSettings.repositoryId);

  const [existing] = await db
    .select()
    .from(notificationSettings)
    .where(whereClause);

  if (existing) {
    await updateNotificationSettings(existing.id, data);
    return { ...existing, ...data, updatedAt: new Date() };
  } else {
    return createNotificationSettings({
      ...data,
      repositoryId: repositoryId ?? undefined,
    });
  }
}
