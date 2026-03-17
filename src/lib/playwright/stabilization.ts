import type { Page, Route } from 'playwright';
import type { StabilizationSettings } from '@/lib/db/schema';
import type { CoreStabilizationSettings } from '@lastest/shared';
import { DEFAULT_STABILIZATION_SETTINGS } from '@/lib/db/schema';
import {
  HIDE_SPINNERS_CSS,
  SYSTEM_FONTS_CSS,
  PLACEHOLDER_IMAGE_BUFFER,
  getCrossOsFontCSS,
  setupFreezeScripts as sharedSetupFreezeScripts,
  waitForSpinnersToDisappear,
  waitForDomStable,
  waitForImagesLoaded,
  waitForStylesLoaded,
  waitForCanvasStable,
  injectCSS,
  getFreezeRandomScript,
  getFreezeTimestampsScript,
} from '@lastest/shared';

// Re-export shared helpers for backward compatibility with local runner consumers
export {
  getFreezeRandomScript,
  getFreezeTimestampsScript,
  waitForSpinnersToDisappear,
  waitForStylesLoaded,
  waitForImagesLoaded,
  waitForDomStable,
  waitForCanvasStable,
};

/**
 * Convert local StabilizationSettings to CoreStabilizationSettings.
 */
function toCoreSettings(settings: StabilizationSettings): CoreStabilizationSettings {
  return {
    freezeTimestamps: settings.freezeTimestamps,
    frozenTimestamp: settings.frozenTimestamp,
    freezeRandomValues: settings.freezeRandomValues,
    randomSeed: settings.randomSeed,
    reseedRandomOnInput: settings.reseedRandomOnInput,
    freezeAnimations: settings.freezeAnimations,
    crossOsConsistency: settings.crossOsConsistency,
    crossOsFontCSS: settings.crossOsConsistency ? getCrossOsFontCSS() : undefined,
    waitForNetworkIdle: settings.waitForNetworkIdle,
    networkIdleTimeout: settings.networkIdleTimeout,
    waitForDomStable: settings.waitForDomStable,
    domStableTimeout: settings.domStableTimeout,
    waitForFonts: settings.waitForFonts,
    waitForImages: settings.waitForImages,
    waitForImagesTimeout: settings.waitForImagesTimeout,
    waitForCanvasStable: settings.waitForCanvasStable,
    canvasStableTimeout: settings.canvasStableTimeout,
    canvasStableThreshold: settings.canvasStableThreshold,
    disableImageSmoothing: settings.disableImageSmoothing,
    roundCanvasCoordinates: settings.roundCanvasCoordinates,
  };
}

/**
 * Setup third-party request blocking.
 * Blocks or mocks requests to external domains.
 * Local-only feature — remote runners don't have route interception.
 */
export async function setupThirdPartyBlocking(
  page: Page,
  targetUrl: string,
  settings: Pick<StabilizationSettings, 'blockThirdParty' | 'allowedDomains' | 'mockThirdPartyImages'>
): Promise<void> {
  if (!settings.blockThirdParty) return;

  const targetHost = new URL(targetUrl).hostname;
  const allowed = new Set([targetHost, 'localhost', '127.0.0.1', ...settings.allowedDomains]);

  await page.route('**/*', async (route: Route) => {
    const request = route.request();
    let urlHost: string;

    try {
      urlHost = new URL(request.url()).hostname;
    } catch {
      return route.continue();
    }

    if (allowed.has(urlHost)) {
      return route.continue();
    }

    const resourceType = request.resourceType();

    if (resourceType === 'image' && settings.mockThirdPartyImages) {
      return route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: PLACEHOLDER_IMAGE_BUFFER,
      });
    }

    if (['script', 'stylesheet', 'xhr', 'fetch'].includes(resourceType)) {
      return route.abort();
    }

    return route.continue();
  });
}

/**
 * Setup init scripts to freeze timestamps and random values.
 * Must be called BEFORE page navigation.
 */
export async function setupFreezeScripts(
  page: Page,
  settings?: Partial<StabilizationSettings>
): Promise<void> {
  const s = { ...DEFAULT_STABILIZATION_SETTINGS, ...settings };
  await sharedSetupFreezeScripts(page, toCoreSettings(s));
}

/**
 * Apply all stabilization techniques to a page before screenshot.
 * This is the main entry point called by the local runner.
 * Wraps shared applyCoreStabilization with local-only extras.
 */
export async function applyStabilization(
  page: Page,
  targetUrl: string,
  settings?: Partial<StabilizationSettings>
): Promise<void> {
  const s = { ...DEFAULT_STABILIZATION_SETTINGS, ...settings };
  const core = toCoreSettings(s);

  // Phase 1: Run core stabilization (network idle, images, fonts, DOM stability)
  // But we need to interleave local-only CSS injection, so we do it manually:

  // 1a. Concurrent waits (same as core)
  const concurrentWaits: Promise<void>[] = [];

  if (core.waitForNetworkIdle) {
    concurrentWaits.push(
      page.waitForLoadState('networkidle', { timeout: core.networkIdleTimeout }).catch(() => {})
    );
  }

  if (core.waitForImages) {
    concurrentWaits.push(
      waitForImagesLoaded(page, core.waitForImagesTimeout).catch(() => {})
    );
  }

  if (core.waitForFonts) {
    concurrentWaits.push(
      waitForStylesLoaded(page, 3000)
    );
  }

  if (concurrentWaits.length > 0) {
    await Promise.all(concurrentWaits);
  }

  // 1b. Local-only CSS injection
  if (!s.crossOsConsistency && s.disableWebfonts) {
    await injectCSS(page, SYSTEM_FONTS_CSS);
  }

  if (s.hideLoadingIndicators) {
    await injectCSS(page, HIDE_SPINNERS_CSS);
  }

  // 1c. Local-only spinner waiting
  if (s.hideLoadingIndicators && s.loadingSelectors.length > 0) {
    await waitForSpinnersToDisappear(page, s.loadingSelectors, s.domStableTimeout);
  }

  // 1d. DOM stability
  if (core.waitForDomStable) {
    await waitForDomStable(page, core.domStableTimeout);
  }

  // Phase 2: Freeze performance.now, reset Excalidraw RNG, enable RAF gating + flush
  /* eslint-disable @typescript-eslint/no-explicit-any */
  await page.evaluate(() => {
    (window as any).__perfNowFrozen = performance.now();
    if (typeof (window as any).__resetExcalidrawRNG === 'function') {
      (window as any).__resetExcalidrawRNG();
    }
    if (typeof (window as any).__enableRAFGating === 'function') {
      (window as any).__enableRAFGating();
    }
    if (typeof (window as any).__flushAnimationFrames === 'function') {
      (window as any).__flushAnimationFrames(20);
    }
  }).catch(() => {});
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // Phase 3: Wait for canvas stability
  if (core.waitForCanvasStable) {
    await waitForCanvasStable(page, core.canvasStableTimeout, core.canvasStableThreshold);
  }
}
