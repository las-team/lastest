/**
 * Screenshot stabilization for the remote runner.
 *
 * Contains constants and helpers inlined from the local runner's
 * src/lib/playwright/constants.ts and src/lib/playwright/stabilization.ts.
 * The runner package cannot import from src/lib/ so these are duplicated here.
 */

import type { Page } from 'playwright';
import type { StabilizationPayload } from './protocol.js';

/**
 * Chromium launch args for cross-OS rendering consistency.
 * Disables font hinting, subpixel positioning, LCD text, GPU compositing,
 * forces sRGB color profile, and hides scrollbars.
 */
export const CROSS_OS_CHROMIUM_ARGS = [
  '--font-render-hinting=none',
  '--disable-font-subpixel-positioning',
  '--disable-lcd-text',
  '--disable-gpu',
  '--force-color-profile=srgb',
  '--hide-scrollbars',
  '--disable-skia-runtime-opts',
  '--disable-accelerated-2d-canvas',
];

/**
 * Script injected via addInitScript to freeze both CSS and JS animations.
 * Runs before any page scripts on every navigation.
 */
export const FREEZE_ANIMATIONS_SCRIPT = `
// 1. Inject CSS to kill CSS animations/transitions (including inline styles)
(function injectFreezeCSS() {
  var css = '*, *::before, *::after { animation: none !important; transition: none !important; animation-delay: 0s !important; transition-delay: 0s !important; scroll-behavior: auto !important; }';
  function inject() {
    if (!document.querySelector('[data-freeze-animations]') && (document.head || document.documentElement)) {
      var style = document.createElement('style');
      style.setAttribute('data-freeze-animations', 'true');
      style.textContent = css;
      (document.head || document.documentElement).appendChild(style);
    }
  }
  inject();
  document.addEventListener('DOMContentLoaded', inject);
})();

// 2. Block Element.prototype.animate (Web Animations API)
var _origAnimate = Element.prototype.animate;
Element.prototype.animate = function() {
  return { cancel: function(){}, finish: function(){}, pause: function(){}, play: function(){},
           onfinish: null, oncancel: null, playState: 'finished', finished: Promise.resolve(),
           effect: null, timeline: null, id: '', currentTime: 0, startTime: 0,
           addEventListener: function(){}, removeEventListener: function(){} };
};

// 3. Override setInterval to prevent auto-advancing carousels/tickers.
var _origSetInterval = window.setInterval;
window.setInterval = function() {
  return 0;
};

// 4. Cancel all existing Web Animations on DOMContentLoaded and load
function cancelAllAnimations() {
  try {
    if (typeof document.getAnimations === 'function') {
      document.getAnimations().forEach(function(a) { a.cancel(); });
    }
  } catch(e) {}
}
document.addEventListener('DOMContentLoaded', cancelAllAnimations);
window.addEventListener('load', function() {
  cancelAllAnimations();
  setTimeout(cancelAllAnimations, 100);
  setTimeout(cancelAllAnimations, 500);
});

// 5. Freeze animated GIFs by replacing them with static canvas snapshots
(function freezeGifs() {
  function isGifSrc(src) {
    if (!src) return false;
    try {
      var url = new URL(src, location.href);
      return /\\.gif(\\\\?|$)/i.test(url.pathname);
    } catch(e) {
      return /\\.gif(\\\\?|$)/i.test(src);
    }
  }

  function freezeGifImage(img) {
    if (img.dataset.gifFrozen) return;
    img.dataset.gifFrozen = '1';
    try {
      var w = img.naturalWidth;
      var h = img.naturalHeight;
      if (!w || !h) return;
      var canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      var ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, w, h);
      img.src = canvas.toDataURL('image/png');
    } catch(e) {}
  }

  function processAllGifs() {
    var imgs = document.querySelectorAll('img');
    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];
      if (isGifSrc(img.src) || isGifSrc(img.currentSrc)) {
        if (img.complete && img.naturalWidth > 0) {
          freezeGifImage(img);
        } else {
          img.addEventListener('load', function() { freezeGifImage(this); }, { once: true });
        }
      }
    }
  }

  if (typeof MutationObserver !== 'undefined') {
    var observer = new MutationObserver(function(mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var nodes = mutations[i].addedNodes;
        for (var j = 0; j < nodes.length; j++) {
          var node = nodes[j];
          if (node.nodeType === 1) {
            if (node.tagName === 'IMG' && isGifSrc(node.src)) {
              if (node.complete && node.naturalWidth > 0) {
                freezeGifImage(node);
              } else {
                node.addEventListener('load', function() { freezeGifImage(this); }, { once: true });
              }
            }
            var childImgs = node.querySelectorAll ? node.querySelectorAll('img') : [];
            for (var k = 0; k < childImgs.length; k++) {
              if (isGifSrc(childImgs[k].src)) {
                if (childImgs[k].complete && childImgs[k].naturalWidth > 0) {
                  freezeGifImage(childImgs[k]);
                } else {
                  childImgs[k].addEventListener('load', function() { freezeGifImage(this); }, { once: true });
                }
              }
            }
          }
        }
      }
    });
    document.addEventListener('DOMContentLoaded', function() {
      observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
    });
  }

  document.addEventListener('DOMContentLoaded', processAllGifs);
  window.addEventListener('load', function() {
    processAllGifs();
    setTimeout(processAllGifs, 200);
    setTimeout(processAllGifs, 600);
  });
})();
`;

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
      let state = ${seed};
      function nextLCG() {
        state = (state * 1103515245 + 12345) & 0x7fffffff;
        return state;
      }
      Math.random = function() {
        return nextLCG() / 0x7fffffff;
      };
      // Override crypto.getRandomValues to produce deterministic bytes
      var _origGetRandomValues = crypto.getRandomValues.bind(crypto);
      crypto.getRandomValues = function(array) {
        for (var i = 0; i < array.length; i++) {
          array[i] = nextLCG() & (array instanceof Uint8Array ? 0xff :
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
            hex += (nextLCG() & 0xf).toString(16);
          }
          return hex.slice(0,8)+'-'+hex.slice(8,12)+'-4'+hex.slice(13,16)+'-'+
                 ((nextLCG() & 0x3 | 0x8).toString(16))+hex.slice(17,20)+'-'+hex.slice(20,32);
        };
      }
    })();
  `;
}

/**
 * Setup init scripts to freeze timestamps and random values.
 * Must be called BEFORE page navigation.
 */
export async function setupFreezeScripts(
  page: Page,
  settings?: StabilizationPayload
): Promise<void> {
  if (!settings) return;

  if (settings.freezeTimestamps) {
    await page.clock.setFixedTime(new Date(settings.frozenTimestamp));
  }

  if (settings.freezeRandomValues) {
    await page.addInitScript(getFreezeRandomScript(settings.randomSeed));
  }

  if (settings.freezeAnimations) {
    await page.addInitScript(FREEZE_ANIMATIONS_SCRIPT);
  }
}

/**
 * Apply pre-screenshot stabilization: network idle, image loading, font loading, DOM stability.
 * Simplified version of the local runner's applyStabilization() — no font CSS injection or spinner hiding.
 */
export async function applyPreScreenshotStabilization(
  page: Page,
  settings?: StabilizationPayload
): Promise<void> {
  if (!settings) return;

  // 1. Wait for network idle
  if (settings.waitForNetworkIdle) {
    await page.waitForLoadState('networkidle', { timeout: settings.networkIdleTimeout }).catch(() => {});
  }

  // 2. Wait for images to finish loading
  if (settings.waitForImages) {
    await Promise.race([
      page.evaluate(() => {
        const imgs = Array.from(document.querySelectorAll('img'));
        return Promise.all(
          imgs
            .filter((img) => {
              if (!img.src && !img.currentSrc) return false;
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
      page.waitForTimeout(settings.waitForImagesTimeout),
    ]).catch(() => {});
  }

  // 3. Wait for fonts to load
  if (settings.waitForFonts) {
    await page.evaluate((t) => {
      return Promise.race([
        document.fonts.ready,
        new Promise((resolve) => setTimeout(resolve, t)),
      ]);
    }, 3000).catch(() => {});
  }

  // 4. Inject cross-OS font CSS (sent from server when crossOsConsistency is enabled)
  if (settings.crossOsFontCSS) {
    await page.addStyleTag({ content: settings.crossOsFontCSS });
  }

  // 5. Wait for DOM stability
  if (settings.waitForDomStable) {
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

          setTimeout(() => {
            observer.disconnect();
            resolve(true);
          }, t);

          timer = setTimeout(() => {
            observer.disconnect();
            resolve(true);
          }, s);
        });
      },
      { timeout: settings.domStableTimeout, stableMs: 200 }
    ).catch(() => {});
  }
}
