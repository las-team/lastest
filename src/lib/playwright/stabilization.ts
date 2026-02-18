import type { Page, Route } from 'playwright';
import type { StabilizationSettings } from '@/lib/db/schema';
import { DEFAULT_STABILIZATION_SETTINGS } from '@/lib/db/schema';
import { HIDE_SPINNERS_CSS, PLACEHOLDER_IMAGE_BUFFER, SYSTEM_FONTS_CSS, getCrossOsFontCSS } from './constants';

/**
 * JavaScript to inject for seeding Math.random().
 * Uses a simple Linear Congruential Generator (LCG) for reproducible random values.
 */
export function getFreezeRandomScript(seed: number): string {
  return `
    (function() {
      let state = ${seed};
      Math.random = function() {
        state = (state * 1103515245 + 12345) & 0x7fffffff;
        return state / 0x7fffffff;
      };
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
  }

  // Freeze random values
  if (s.freezeRandomValues) {
    await page.addInitScript(getFreezeRandomScript(s.randomSeed));
  }
}
