import type { Page, Route } from 'playwright';
import type { StabilizationSettings } from '@/lib/db/schema';
import { DEFAULT_STABILIZATION_SETTINGS } from '@/lib/db/schema';
import { HIDE_SPINNERS_CSS, PLACEHOLDER_IMAGE_BUFFER, SYSTEM_FONTS_CSS, getCrossOsFontCSS } from './constants';

/**
 * JavaScript to inject for seeding Math.random() AND crypto.getRandomValues().
 * Uses a simple Linear Congruential Generator (LCG) for reproducible random values.
 *
 * crypto.getRandomValues() is overridden because libraries like nanoid (used by
 * Excalidraw for element IDs) use it instead of Math.random(). Non-deterministic
 * IDs can affect rendering order, React reconciliation, and canvas compositing.
 */
export function getFreezeRandomScript(seed: number): string {
  return `
    (function() {
      // Separate LCG states so crypto calls (nanoid) don't shift Math.random sequence (rough.js seeds)
      var mathState = ${seed};
      var cryptoState = (${seed} * 2654435761 >>> 0) || 1;

      function nextMath() {
        mathState = (mathState * 1103515245 + 12345) & 0x7fffffff;
        return mathState;
      }
      function nextCrypto() {
        cryptoState = (cryptoState * 1103515245 + 12345) & 0x7fffffff;
        return cryptoState;
      }

      Math.random = function() {
        return nextMath() / 0x7fffffff;
      };
      // Override crypto.getRandomValues to produce deterministic bytes
      crypto.getRandomValues = function(array) {
        for (var i = 0; i < array.length; i++) {
          array[i] = nextCrypto() & (array instanceof Uint8Array ? 0xff :
                                      array instanceof Uint16Array ? 0xffff :
                                      0xffffffff);
        }
        return array;
      };
      // Override crypto.randomUUID for deterministic UUIDs
      if (crypto.randomUUID) {
        crypto.randomUUID = function() {
          var hex = '';
          for (var i = 0; i < 32; i++) {
            hex += (nextCrypto() & 0xf).toString(16);
          }
          return hex.slice(0,8)+'-'+hex.slice(8,12)+'-4'+hex.slice(13,16)+'-'+
                 ((nextCrypto() & 0x3 | 0x8).toString(16))+hex.slice(17,20)+'-'+hex.slice(20,32);
        };
      }
    })();
  `;
}

/**
 * Wait for all spinners/loading indicators to disappear.
 */
export async function waitForSpinnersToDisappear(
  page: Page,
  customSelectors: string[],
  timeout: number
): Promise<void> {
  const defaultSelectors = [
    '[class*="spinner"]',
    '[class*="loading"]',
    '[class*="loader"]',
    '[class*="skeleton"]',
    '[class*="shimmer"]',
    '[class*="pulse"]',
    '[aria-busy="true"]',
    '[data-loading="true"]',
    '[data-testid*="loading"]',
    '[data-testid*="spinner"]',
    // Common framework spinners
    '.MuiCircularProgress-root',
    '.MuiLinearProgress-root',
    '.ant-spin',
    '.ant-skeleton',
    '.chakra-spinner',
    '.chakra-skeleton',
  ];

  const allSelectors = [...defaultSelectors, ...customSelectors];

  // Wait for all selectors to be hidden or not exist
  await Promise.race([
    Promise.all(
      allSelectors.map((sel) =>
        page.waitForSelector(sel, { state: 'hidden', timeout }).catch(() => {
          // Selector might not exist at all, which is fine
        })
      )
    ),
    page.waitForTimeout(timeout),
  ]);
}

/**
 * Wait for stylesheets and fonts to be fully loaded.
 */
export async function waitForStylesLoaded(page: Page, timeout: number): Promise<void> {
  await page.evaluate((t) => {
    return Promise.race([
      Promise.all([
        // Wait for fonts
        document.fonts.ready,
        // Wait for stylesheets
        Promise.all(
          Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(
            (link) =>
              new Promise<boolean>((resolve) => {
                const linkEl = link as HTMLLinkElement;
                if (linkEl.sheet) {
                  resolve(true);
                } else {
                  linkEl.onload = () => resolve(true);
                  linkEl.onerror = () => resolve(true); // Don't block on failed stylesheets
                }
              })
          )
        ),
      ]),
      new Promise((resolve) => setTimeout(resolve, t)),
    ]);
  }, timeout);
}

/**
 * Wait for all visible images to finish loading.
 * Skips images with no src and lazy images that haven't started loading.
 */
export async function waitForImagesLoaded(page: Page, timeout: number): Promise<void> {
  await Promise.race([
    page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img'));
      return Promise.all(
        imgs
          .filter((img) => {
            // Skip images with no source
            if (!img.src && !img.currentSrc) return false;
            // Skip lazy images that haven't started loading
            if (img.loading === 'lazy' && !img.complete) return false;
            return true;
          })
          .map(
            (img) =>
              new Promise<void>((resolve) => {
                if (img.complete && img.naturalWidth > 0) {
                  resolve();
                } else {
                  img.addEventListener('load', () => resolve(), { once: true });
                  img.addEventListener('error', () => resolve(), { once: true });
                }
              })
          )
      );
    }),
    page.waitForTimeout(timeout),
  ]);
}

/**
 * Wait for DOM to stabilize (no mutations for a period).
 */
export async function waitForDomStable(page: Page, timeout: number, stableMs = 200): Promise<void> {
  await page.evaluate(
    ({ timeout: t, stableMs: s }) => {
      return new Promise<boolean>((resolve) => {
        let timer: ReturnType<typeof setTimeout>;
        const observer = new MutationObserver(() => {
          clearTimeout(timer);
          timer = setTimeout(() => {
            observer.disconnect();
            resolve(true);
          }, s);
        });

        observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          characterData: true,
        });

        // Fallback timeout
        setTimeout(() => {
          observer.disconnect();
          resolve(true);
        }, t);

        // Initial trigger - if no mutations happen, resolve after stableMs
        timer = setTimeout(() => {
          observer.disconnect();
          resolve(true);
        }, s);
      });
    },
    { timeout, stableMs }
  );
}

/**
 * Setup third-party request blocking.
 * Blocks or mocks requests to external domains.
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
      // Invalid URL, continue normally
      return route.continue();
    }

    // Check if domain is allowed
    if (allowed.has(urlHost)) {
      return route.continue();
    }

    const resourceType = request.resourceType();

    // Mock images with placeholder
    if (resourceType === 'image' && settings.mockThirdPartyImages) {
      return route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: PLACEHOLDER_IMAGE_BUFFER,
      });
    }

    // Block scripts, stylesheets, XHR, fetch from third parties
    if (['script', 'stylesheet', 'xhr', 'fetch'].includes(resourceType)) {
      return route.abort();
    }

    // Allow other resource types (fonts, etc.)
    return route.continue();
  });
}

/**
 * Inject CSS via CSSOM to bypass Content Security Policy restrictions.
 * Falls back to addStyleTag if CSSOM injection fails.
 */
async function injectCSS(page: Page, css: string): Promise<void> {
  try {
    await page.evaluate((cssText) => {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(cssText);
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    }, css);
  } catch {
    // Fallback for older browsers without adoptedStyleSheets
    await page.addStyleTag({ content: css });
  }
}

/**
 * Wait for all canvas elements to produce stable output.
 * Runs entirely within a single page.evaluate() call to avoid non-deterministic
 * async callbacks (short timeouts, MessageChannel) firing between flush iterations.
 * Flushes gated RAF and compares canvas.toDataURL() until stable.
 */
export async function waitForCanvasStable(
  page: Page,
  _timeout: number,
  threshold: number
): Promise<void> {
  await page.evaluate(({ stableNeeded }) => {
    const flush = (window as any).__flushAnimationFrames;
    if (typeof flush !== 'function') return;

    let lastDataUrls = '';
    let stableCount = 0;

    // Run up to 30 flush-then-check iterations in a single JS execution context.
    // No delays between iterations — prevents non-deterministic async callbacks.
    for (let i = 0; i < 30; i++) {
      flush(10);
      const canvases = Array.from(document.querySelectorAll('canvas'));
      const dataUrls = canvases.map((c: HTMLCanvasElement) => {
        try { return c.toDataURL(); } catch { return ''; }
      }).join('|');

      if (dataUrls === lastDataUrls) {
        stableCount++;
        if (stableCount >= stableNeeded) return;
      } else {
        stableCount = 0;
      }
      lastDataUrls = dataUrls;
    }
  }, { stableNeeded: threshold }).catch(() => {});
}

/**
 * Apply all stabilization techniques to a page before screenshot.
 * This is the main entry point called by the runner.
 */
export async function applyStabilization(
  page: Page,
  targetUrl: string,
  settings?: Partial<StabilizationSettings>
): Promise<void> {
  const s = { ...DEFAULT_STABILIZATION_SETTINGS, ...settings };

  // 1. Wait for network idle
  if (s.waitForNetworkIdle) {
    await page.waitForLoadState('networkidle', { timeout: s.networkIdleTimeout }).catch(() => {
      // Timeout is acceptable, continue with stabilization
    });
  }

  // 2. Wait for images to finish loading
  if (s.waitForImages) {
    await waitForImagesLoaded(page, s.waitForImagesTimeout).catch(() => {});
  }

  // 3. Wait for styles/fonts to load (FOUC prevention)
  if (s.waitForFonts) {
    await waitForStylesLoaded(page, 3000);
  }

  // 4. Apply font override (cross-OS bundled font supersedes system fonts)
  if (s.crossOsConsistency) {
    await injectCSS(page, getCrossOsFontCSS());
  } else if (s.disableWebfonts) {
    await injectCSS(page, SYSTEM_FONTS_CSS);
  }

  // 5. Hide loading spinners via CSS
  if (s.hideLoadingIndicators) {
    await injectCSS(page, HIDE_SPINNERS_CSS);
  }

  // 6. Wait for spinners to actually disappear
  if (s.hideLoadingIndicators && s.loadingSelectors.length > 0) {
    await waitForSpinnersToDisappear(page, s.loadingSelectors, s.domStableTimeout);
  }

  // 7. Wait for DOM stability
  if (s.waitForDomStable) {
    await waitForDomStable(page, s.domStableTimeout);
  }

  // 8. Enable RAF/setTimeout gating (was deferred during page load for rendering)
  //    then flush all queued callbacks deterministically before screenshot.
  await page.evaluate(() => {
    if (typeof (window as any).__enableRAFGating === 'function') {
      (window as any).__enableRAFGating();
    }
    if (typeof (window as any).__flushAnimationFrames === 'function') {
      (window as any).__flushAnimationFrames(10);
    }
  }).catch(() => {});

  // 9. Wait for canvas stability (single-evaluate loop of flush + toDataURL comparison)
  if (s.waitForCanvasStable) {
    await waitForCanvasStable(page, s.canvasStableTimeout, s.canvasStableThreshold);
  }
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

  // Freeze timestamps using Playwright's built-in clock API
  if (s.freezeTimestamps) {
    await page.clock.setFixedTime(new Date(s.frozenTimestamp));
    // Playwright's setFixedTime does NOT freeze performance.now() — it continues
    // returning real elapsed time. Override it so timing-dependent rendering
    // (e.g. Excalidraw animations, roughjs stroke timing) is deterministic.
    await page.addInitScript(`
      (function() {
        var frozen = 1000;
        performance.now = function() { return frozen; };
      })();
    `);
  }

  // Freeze random values
  if (s.freezeRandomValues) {
    await page.addInitScript(getFreezeRandomScript(s.randomSeed));
  }

  // Disable image smoothing on canvas 2D contexts for deterministic rendering
  if (s.disableImageSmoothing) {
    await page.addInitScript(`
      (function() {
        var _origGetContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(type, attrs) {
          var ctx = _origGetContext.call(this, type, attrs);
          if (ctx && type === '2d') {
            ctx.imageSmoothingEnabled = false;
          }
          return ctx;
        };
      })();
    `);
  }
}
