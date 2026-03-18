import type { CoreStabilizationSettings, StabilizationPage } from './types';
import { waitForImagesLoaded, waitForStylesLoaded, waitForDomStable, waitForCanvasStable } from './page-helpers';

/**
 * Apply core pre-screenshot stabilization shared across all runner types.
 * Handles network idle, image/font loading, DOM stability, RAF gating, and canvas stability.
 *
 * Local runner wraps this with additional steps (spinner hiding, system fonts, third-party blocking).
 * Remote/embedded runners call this directly.
 */
export async function applyCoreStabilization(
  page: StabilizationPage,
  settings: CoreStabilizationSettings
): Promise<void> {
  // Phase 1: Run independent wait strategies concurrently
  const concurrentWaits: Promise<void>[] = [];

  if (settings.waitForNetworkIdle) {
    concurrentWaits.push(
      page.waitForLoadState('networkidle', { timeout: settings.networkIdleTimeout }).catch(() => {})
    );
  }

  if (settings.waitForImages) {
    concurrentWaits.push(
      waitForImagesLoaded(page, settings.waitForImagesTimeout).catch(() => {})
    );
  }

  if (settings.waitForFonts) {
    concurrentWaits.push(
      waitForStylesLoaded(page, 3000).catch(() => {})
    );
  }

  if (concurrentWaits.length > 0) {
    await Promise.all(concurrentWaits);
  }

  // Phase 2: Wait for DOM stability
  if (settings.waitForDomStable) {
    await waitForDomStable(page, settings.domStableTimeout).catch(() => {});
  }

  // Phase 3: Freeze performance.now, reset Excalidraw RNG, enable RAF gating + flush
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

  // Phase 4: Wait for canvas stability
  if (settings.waitForCanvasStable) {
    await waitForCanvasStable(page, settings.canvasStableTimeout, settings.canvasStableThreshold);
  }
}
