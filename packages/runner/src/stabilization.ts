/**
 * Screenshot stabilization for the remote runner.
 * Delegates to @lastest/shared for all stabilization logic.
 */

import type { Page } from 'playwright';
import type { StabilizationPayload } from './protocol.js';
import {
  CROSS_OS_CHROMIUM_ARGS,
  FREEZE_ANIMATIONS_SCRIPT,
  setupFreezeScripts as sharedSetupFreezeScripts,
  applyCoreStabilization,
  getFreezeRandomScript,
  getFreezeTimestampsScript,
} from '@lastest/shared';

export { CROSS_OS_CHROMIUM_ARGS, FREEZE_ANIMATIONS_SCRIPT, getFreezeRandomScript, getFreezeTimestampsScript };

/**
 * Setup init scripts to freeze timestamps and random values.
 * Must be called BEFORE page navigation.
 */
export async function setupFreezeScripts(
  page: Page,
  settings?: StabilizationPayload
): Promise<void> {
  if (!settings) return;
  await sharedSetupFreezeScripts(page, settings);
}

/**
 * Apply pre-screenshot stabilization: network idle, image loading, font loading, DOM stability.
 */
export async function applyPreScreenshotStabilization(
  page: Page,
  settings?: StabilizationPayload
): Promise<void> {
  if (!settings) return;
  await applyCoreStabilization(page, settings);
}
