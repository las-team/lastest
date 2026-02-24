import type { Page, Route } from 'playwright';
import type { StabilizationSettings } from '@/lib/db/schema';
import { DEFAULT_STABILIZATION_SETTINGS } from '@/lib/db/schema';
import { DETERMINISTIC_RENDERING_CSS, HIDE_SPINNERS_CSS, PLACEHOLDER_IMAGE_BUFFER, SYSTEM_FONTS_CSS, getCrossOsFontCSS } from './constants';

/**
 * JavaScript to inject for seeding Math.random() AND crypto.getRandomValues().
 * Uses a simple Linear Congruential Generator (LCG) for reproducible random values.
 *
 * crypto.getRandomValues() is overridden because libraries like nanoid (used by
 * Excalidraw for element IDs) use it instead of Math.random(). Non-deterministic
 * IDs can affect rendering order, React reconciliation, and canvas compositing.
 */
export function getFreezeRandomScript(seed: number, reseedOnInput?: boolean): string {
  return `
    (function() {
      var baseSeed = ${seed};
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
      window.__resetMathRandom = function() {
        mathState = ${seed};
      };
${reseedOnInput ? `
      // Reseed LCG on user input events so element creation gets a seed
      // determined by the triggering event, not async RNG drift.
      function __hashInputEvent(e) {
        var h = baseSeed;
        var t = e.type;
        for (var i = 0; i < t.length; i++) h = ((h << 5) - h + t.charCodeAt(i)) | 0;
        h = ((h << 5) - h + ((e.clientX || 0) | 0)) | 0;
        h = ((h << 5) - h + ((e.clientY || 0) | 0)) | 0;
        if (e.key) for (var j = 0; j < e.key.length; j++) h = ((h << 5) - h + e.key.charCodeAt(j)) | 0;
        return (h & 0x7fffffff) || 1;
      }
      ['pointerdown','pointerup','keydown','keyup'].forEach(function(evtType) {
        window.addEventListener(evtType, function(e) {
          if (!e.isTrusted) return;
          var h = __hashInputEvent(e);
          mathState = h;
          cryptoState = (h * 2654435761 >>> 0) || 1;
        }, true);
      });
` : ''}
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
      flush(15);
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

  // 4. Font + deterministic CSS injection moved to setupFreezeScripts (init scripts)
  //    to avoid re-injecting <style> tags on every screenshot which triggers re-renders.
  //    System font CSS (disableWebfonts without crossOsConsistency) still injected here
  //    since it doesn't affect canvas rendering determinism.
  if (!s.crossOsConsistency && s.disableWebfonts) {
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

  // 8. Freeze performance.now, reset Excalidraw RNG, enable RAF gating + flush
  //    all queued callbacks deterministically before screenshot.
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
    // Playwright's setFixedTime uses @sinonjs/fake-timers which overrides
    // performance.now() as an own property on the performance object.
    // Use Performance.prototype.now to bypass the fake and get real elapsed time.
    // We control freeze/unfreeze ourselves via __perfNowFrozen.
    await page.addInitScript(`
      (function() {
        var _origPerfNow = Performance.prototype.now.bind(performance);
        window.__perfNowFrozen = false;
        performance.now = function() {
          return window.__perfNowFrozen !== false ? window.__perfNowFrozen : _origPerfNow();
        };
      })();
    `);
  }

  // Freeze random values
  if (s.freezeRandomValues) {
    await page.addInitScript(getFreezeRandomScript(s.randomSeed, s.reseedRandomOnInput));
  }

  // Inject deterministic rendering CSS early via init script (before page scripts run).
  // Previously injected via injectCSS/addStyleTag in applyStabilization, which added
  // a new <style> tag on every screenshot and could trigger re-renders that advance RNG.
  if (s.crossOsConsistency || s.freezeAnimations) {
    await page.addInitScript(`
      (function() {
        function inject() {
          if (!document.querySelector('[data-deterministic-css]') && (document.head || document.documentElement)) {
            var style = document.createElement('style');
            style.setAttribute('data-deterministic-css', 'true');
            style.textContent = ${JSON.stringify(DETERMINISTIC_RENDERING_CSS)};
            (document.head || document.documentElement).appendChild(style);
          }
        }
        inject();
        document.addEventListener('DOMContentLoaded', inject);
      })();
    `);
  }

  // Inject cross-OS font CSS early via init script (prevents FOUC from late injection).
  // Only when crossOsConsistency is enabled — freezeAnimations alone should NOT force
  // system fonts, matching the remote runner which only sends crossOsFontCSS for crossOs.
  if (s.crossOsConsistency) {
    const fontCSS = getCrossOsFontCSS();
    await page.addInitScript(`
      (function() {
        var css = ${JSON.stringify(fontCSS)};
        function inject() {
          if (!document.querySelector('[data-cross-os-fonts]') && (document.head || document.documentElement)) {
            var style = document.createElement('style');
            style.setAttribute('data-cross-os-fonts', 'true');
            style.textContent = css;
            (document.head || document.documentElement).appendChild(style);
          }
        }
        inject();
        document.addEventListener('DOMContentLoaded', inject);
      })();
    `);
  }

  // Excalidraw RNG reset: provide __resetExcalidrawRNG that resets Math.random seed.
  // applyPreScreenshotStabilization calls this before each screenshot.
  if (s.freezeAnimations) {
    await page.addInitScript(`
      (function() {
        window.__resetExcalidrawRNG = function() {
          if (typeof window.__resetMathRandom === 'function') {
            window.__resetMathRandom();
          }
        };
      })();
    `);
  }

  // Canvas determinism: force willReadFrequently for CPU-backed canvas (avoids GPU readback
  // non-determinism) and optionally disable imageSmoothingEnabled.
  const needsDeterministicCanvas = s.crossOsConsistency || s.freezeAnimations || s.disableImageSmoothing;
  if (needsDeterministicCanvas) {
    const forceWillReadFrequently = s.crossOsConsistency || s.freezeAnimations;
    const disableSmoothing = s.disableImageSmoothing;
    await page.addInitScript(`
      (function() {
        var _origGetContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(type, attrs) {
          if (type === '2d' && ${forceWillReadFrequently}) {
            attrs = Object.assign({}, attrs || {}, { willReadFrequently: true });
          }
          var ctx = _origGetContext.call(this, type, attrs);
          if (ctx && type === '2d' && ${disableSmoothing}) {
            ctx.imageSmoothingEnabled = false;
          }
          return ctx;
        };

        // OffscreenCanvas determinism
        if (typeof OffscreenCanvas !== 'undefined') {
          var _origOCGetContext = OffscreenCanvas.prototype.getContext;
          OffscreenCanvas.prototype.getContext = function(type, attrs) {
            if (type === '2d' && ${forceWillReadFrequently}) {
              attrs = Object.assign({}, attrs || {}, { willReadFrequently: true });
            }
            var ctx = _origOCGetContext.call(this, type, attrs);
            if (ctx && type === '2d' && ${disableSmoothing}) {
              ctx.imageSmoothingEnabled = false;
            }
            return ctx;
          };
        }
      })();
    `);
  }

  // Canvas coordinate rounding: snap path coords to pixel centers for deterministic strokes
  if (s.roundCanvasCoordinates) {
    await page.addInitScript(`
      (function() {
        function snap(v) { return Math.round(v - 0.5) + 0.5; }
        var proto = CanvasRenderingContext2D.prototype;

        var _moveTo = proto.moveTo;
        proto.moveTo = function(x, y) { return _moveTo.call(this, snap(x), snap(y)); };

        var _lineTo = proto.lineTo;
        proto.lineTo = function(x, y) { return _lineTo.call(this, snap(x), snap(y)); };

        var _bezierCurveTo = proto.bezierCurveTo;
        proto.bezierCurveTo = function(cp1x, cp1y, cp2x, cp2y, x, y) {
          return _bezierCurveTo.call(this, snap(cp1x), snap(cp1y), snap(cp2x), snap(cp2y), snap(x), snap(y));
        };

        var _quadraticCurveTo = proto.quadraticCurveTo;
        proto.quadraticCurveTo = function(cpx, cpy, x, y) {
          return _quadraticCurveTo.call(this, snap(cpx), snap(cpy), snap(x), snap(y));
        };

        var _arc = proto.arc;
        proto.arc = function(x, y, r, sa, ea, ccw) {
          return _arc.call(this, snap(x), snap(y), r, sa, ea, ccw);
        };

        var _arcTo = proto.arcTo;
        proto.arcTo = function(x1, y1, x2, y2, r) {
          return _arcTo.call(this, snap(x1), snap(y1), snap(x2), snap(y2), r);
        };

        var _rect = proto.rect;
        proto.rect = function(x, y, w, h) { return _rect.call(this, snap(x), snap(y), w, h); };

        var _strokeRect = proto.strokeRect;
        proto.strokeRect = function(x, y, w, h) { return _strokeRect.call(this, snap(x), snap(y), w, h); };

        var _fillRect = proto.fillRect;
        proto.fillRect = function(x, y, w, h) { return _fillRect.call(this, snap(x), snap(y), w, h); };

        // lineWidth normalization: round to nearest 0.5 (Skia uses different AA for fractional values)
        var _lineWidthDesc = Object.getOwnPropertyDescriptor(proto, 'lineWidth');
        if (_lineWidthDesc && _lineWidthDesc.set) {
          var _origLWSetter = _lineWidthDesc.set;
          Object.defineProperty(proto, 'lineWidth', {
            get: _lineWidthDesc.get,
            set: function(v) { _origLWSetter.call(this, Math.round(v * 2) / 2); },
            configurable: true,
          });
        }

        // shadowBlur normalization: round to integer (avoids Gaussian kernel variance)
        var _shadowBlurDesc = Object.getOwnPropertyDescriptor(proto, 'shadowBlur');
        if (_shadowBlurDesc && _shadowBlurDesc.set) {
          var _origSBSetter = _shadowBlurDesc.set;
          Object.defineProperty(proto, 'shadowBlur', {
            get: _shadowBlurDesc.get,
            set: function(v) { _origSBSetter.call(this, Math.round(v)); },
            configurable: true,
          });
        }

        // drawImage coordinate snapping: sub-pixel destinations cause AA variance
        var _drawImage = proto.drawImage;
        proto.drawImage = function() {
          var args = Array.prototype.slice.call(arguments);
          if (args.length === 3) {
            args[1] = snap(args[1]); args[2] = snap(args[2]);
          } else if (args.length === 5) {
            args[1] = snap(args[1]); args[2] = snap(args[2]);
          } else if (args.length === 9) {
            args[5] = snap(args[5]); args[6] = snap(args[6]);
          }
          return _drawImage.apply(this, args);
        };
      })();
    `);
  }
}

