import * as queries from '@/lib/db/queries';
import type {
  Test,
  StabilizationSettings,
  DiffEngineType,
  TextDetectionGranularity,
  RegionDetectionMode,
} from '@/lib/db/schema';
import { DEFAULT_STABILIZATION_SETTINGS, DEFAULT_DIFF_THRESHOLDS } from '@/lib/db/schema';

export interface ResolvedDiffSettings {
  unchangedThreshold: number;
  flakyThreshold: number;
  includeAntiAliasing: boolean;
  ignorePageShift: boolean;
  diffEngine: DiffEngineType;
  textRegionAwareDiffing: boolean;
  textRegionThreshold: number;
  textRegionPadding: number;
  textDetectionGranularity: TextDetectionGranularity;
  regionDetectionMode: RegionDetectionMode;
}

export interface ResolvedPlaywrightSettings {
  browser: 'chromium' | 'firefox' | 'webkit';
  navigationTimeout: number;
  actionTimeout: number;
  screenshotDelay: number;
  networkErrorMode: 'fail' | 'warn' | 'ignore';
  consoleErrorMode: 'fail' | 'warn' | 'ignore';
  acceptAnyCertificate: boolean;
  maxParallelTests: number;
}

export interface ResolvedTestSettings {
  playwright: ResolvedPlaywrightSettings;
  diff: ResolvedDiffSettings;
  stabilization: StabilizationSettings;
  viewport: { width: number; height: number };
  baseUrl: string;
}

/**
 * Resolve all effective settings for a test.
 * Merge order: hardcoded defaults → repo DB settings → per-test overrides.
 * Returns an immutable snapshot — no DB writes.
 */
export async function resolveTestSettings(
  test: Test,
  repositoryId: string | null,
): Promise<ResolvedTestSettings> {
  // Load repo-level settings
  const [repoPlaywright, repoDiff, repoEnv] = await Promise.all([
    queries.getPlaywrightSettings(repositoryId),
    queries.getDiffSensitivitySettings(repositoryId),
    repositoryId ? queries.getEnvironmentConfig(repositoryId) : null,
  ]);

  // --- Diff resolution ---
  const diffBase: ResolvedDiffSettings = {
    unchangedThreshold: repoDiff?.unchangedThreshold ?? DEFAULT_DIFF_THRESHOLDS.unchangedThreshold,
    flakyThreshold: repoDiff?.flakyThreshold ?? DEFAULT_DIFF_THRESHOLDS.flakyThreshold,
    includeAntiAliasing: repoDiff?.includeAntiAliasing ?? DEFAULT_DIFF_THRESHOLDS.includeAntiAliasing,
    ignorePageShift: repoDiff?.ignorePageShift ?? DEFAULT_DIFF_THRESHOLDS.ignorePageShift,
    diffEngine: (repoDiff?.diffEngine as DiffEngineType) ?? DEFAULT_DIFF_THRESHOLDS.diffEngine,
    textRegionAwareDiffing: repoDiff?.textRegionAwareDiffing ?? DEFAULT_DIFF_THRESHOLDS.textRegionAwareDiffing,
    textRegionThreshold: repoDiff?.textRegionThreshold ?? DEFAULT_DIFF_THRESHOLDS.textRegionThreshold,
    textRegionPadding: repoDiff?.textRegionPadding ?? DEFAULT_DIFF_THRESHOLDS.textRegionPadding,
    textDetectionGranularity: (repoDiff?.textDetectionGranularity as TextDetectionGranularity) ?? DEFAULT_DIFF_THRESHOLDS.textDetectionGranularity,
    regionDetectionMode: (repoDiff?.regionDetectionMode as RegionDetectionMode) ?? DEFAULT_DIFF_THRESHOLDS.regionDetectionMode,
  };
  const diff: ResolvedDiffSettings = test.diffOverrides
    ? { ...diffBase, ...stripUndefined(test.diffOverrides) }
    : diffBase;

  // --- Playwright resolution ---
  const playwrightBase: ResolvedPlaywrightSettings = {
    browser: (repoPlaywright?.browser as 'chromium' | 'firefox' | 'webkit') ?? 'chromium',
    navigationTimeout: repoPlaywright?.navigationTimeout ?? 30000,
    actionTimeout: repoPlaywright?.actionTimeout ?? 30000,
    screenshotDelay: repoPlaywright?.screenshotDelay ?? 0,
    networkErrorMode: (repoPlaywright?.networkErrorMode as 'fail' | 'warn' | 'ignore') ?? 'warn',
    consoleErrorMode: (repoPlaywright?.consoleErrorMode as 'fail' | 'warn' | 'ignore') ?? 'warn',
    acceptAnyCertificate: repoPlaywright?.acceptAnyCertificate ?? false,
    maxParallelTests: repoPlaywright?.maxParallelTests ?? 2,
  };
  const pwOverrides = test.playwrightOverrides;
  const playwright: ResolvedPlaywrightSettings = pwOverrides
    ? { ...playwrightBase, ...stripUndefined(pwOverrides) }
    : playwrightBase;

  // --- Stabilization resolution ---
  const stabilizationBase: StabilizationSettings = {
    ...DEFAULT_STABILIZATION_SETTINGS,
    ...(repoPlaywright?.stabilization ? stripUndefined(repoPlaywright.stabilization) : {}),
  };
  const stabilization: StabilizationSettings = test.stabilizationOverrides
    ? { ...stabilizationBase, ...stripUndefined(test.stabilizationOverrides) }
    : stabilizationBase;

  // --- Viewport ---
  const viewport = test.viewportOverride ?? {
    width: repoPlaywright?.viewportWidth ?? 1280,
    height: repoPlaywright?.viewportHeight ?? 720,
  };

  // --- Base URL ---
  const baseUrl = pwOverrides?.baseUrl ?? repoEnv?.baseUrl ?? 'http://localhost:3000';

  return { playwright, diff, stabilization, viewport, baseUrl };
}

/** Remove undefined keys so spread doesn't clobber with undefined */
function stripUndefined<T extends object>(obj: T): Partial<T> {
  const result: Partial<T> = {};
  for (const key of Object.keys(obj) as Array<keyof T>) {
    if (obj[key] !== undefined) result[key] = obj[key];
  }
  return result;
}
