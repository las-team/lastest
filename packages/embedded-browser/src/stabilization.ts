/**
 * Screenshot stabilization for the embedded browser.
 *
 * Copied from packages/runner/src/stabilization.ts.
 * The embedded-browser package cannot import from runner (separate package),
 * so this is duplicated here with the local protocol import.
 */

import type { Page } from 'playwright';
import type { StabilizationPayload } from './protocol.js';

/**
 * Chromium launch args for cross-OS rendering consistency.
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
  '--run-all-compositor-stages-before-draw',
  '--disable-threaded-animation',
  '--disable-partial-raster',
  '--disable-checker-imaging',
  '--force-device-scale-factor=1',
  '--disable-gpu-rasterization',
  '--disable-oop-rasterization',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
];

/**
 * CSS for deterministic rendering: hides cursor, caret, text selection,
 * and normalizes font smoothing.
 */
const DETERMINISTIC_RENDERING_CSS = `*, *::before, *::after {
  cursor: none !important;
  caret-color: transparent !important;
  -webkit-font-smoothing: antialiased !important;
  -moz-osx-font-smoothing: grayscale !important;
  text-rendering: geometricPrecision !important;
  -webkit-text-size-adjust: 100% !important;
  will-change: auto !important;
}
::selection {
  background: transparent !important;
  color: inherit !important;
}`;

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

// 2. Block Element.prototype.animate (Web Animations API) — prevents libraries
//    like slick-slider from creating new JS-driven animations
var _origAnimate = Element.prototype.animate;
Element.prototype.animate = function() {
  // Return a minimal Animation-like object that does nothing
  return { cancel: function(){}, finish: function(){}, pause: function(){}, play: function(){},
           onfinish: null, oncancel: null, playState: 'finished', finished: Promise.resolve(),
           effect: null, timeline: null, id: '', currentTime: 0, startTime: 0,
           addEventListener: function(){}, removeEventListener: function(){} };
};

// 3b. Gate requestAnimationFrame — queue callbacks instead of firing them.
// Gating is DISABLED during page load to allow initial rendering.
// Enable via window.__enableRAFGating() after the page is interactive.
// Playwright's setFixedTime installs fake-timers which override RAF as own properties.
// Access real natives via Window.prototype to bypass fakes — ensures callbacks get
// real DOMHighResTimeStamp during interactions (not frozen clock values).
var _origRAF = (Window.prototype.requestAnimationFrame || window.requestAnimationFrame).bind(window);
var _origCancelRAF = (Window.prototype.cancelAnimationFrame || window.cancelAnimationFrame).bind(window);
var _rafQueue = new Map();
var _rafNextId = 1;
var _rafGatingEnabled = false;
window.requestAnimationFrame = function(callback) {
  if (!_rafGatingEnabled) {
    return _origRAF(callback);
  }
  var id = _rafNextId++;
  _rafQueue.set(id, callback);
  return id;
};
window.cancelAnimationFrame = function(id) {
  if (_rafGatingEnabled) {
    _rafQueue.delete(id);
  } else {
    _origCancelRAF(id);
  }
};
window.__enableRAFGating = function() { _rafGatingEnabled = true; };
window.__disableRAFGating = function() {
  _rafGatingEnabled = false;
  // Drain orphaned RAF callbacks via real browser RAF
  var leftover = Array.from(_rafQueue.values());
  _rafQueue.clear();
  leftover.forEach(function(cb) { try { _origRAF(cb); } catch(e) {} });
  // Drain gated timeouts so deferred callbacks (e.g. laser fade-out) still execute
  var timeouts = Array.from(_timeoutQueue.values());
  _timeoutQueue.clear();
  timeouts.forEach(function(cb) { try { _origSetTimeout(cb, 0); } catch(e) {} });
};

// 3c. Gate setTimeout with delay > 100ms — catches debounced operations.
// Also deferred until __enableRAFGating() is called.
var _origSetTimeout = window.setTimeout;
var _origClearTimeout = window.clearTimeout;
var _timeoutQueue = new Map();
var _timeoutNextId = 1;
window.setTimeout = function(callback, delay) {
  if (typeof callback !== 'function') {
    return _origSetTimeout.apply(window, arguments);
  }
  if (_rafGatingEnabled && delay > 100) {
    var id = _timeoutNextId++;
    _timeoutQueue.set(id, callback);
    return id;
  }
  return _origSetTimeout.call(window, callback, delay);
};
window.clearTimeout = function(id) {
  if (_timeoutQueue.has(id)) {
    _timeoutQueue.delete(id);
  } else {
    _origClearTimeout.call(window, id);
  }
};

// Flush gated RAF callbacks deterministically before screenshots.
// Only flushes RAF — gated timeouts are intentionally NOT flushed because
// they may cause side-effects (auto-save indicators, undo checkpoints) that
// change the visual state. They are gated solely to prevent RNG drift.
// Runs multiple iterations because each flush can schedule new callbacks.
window.__flushAnimationFrames = function(maxIterations) {
  maxIterations = maxIterations || 10;
  for (var i = 0; i < maxIterations && _rafQueue.size > 0; i++) {
    var t = 1000;
    if (window.__perfNowFrozen !== false && typeof window.__perfNowFrozen === 'number') {
      window.__perfNowFrozen += 16;
      t = window.__perfNowFrozen;
    }
    var rafCbs = Array.from(_rafQueue.values());
    _rafQueue.clear();
    rafCbs.forEach(function(cb) { try { cb(t); } catch(e) {} });
  }
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
 * JavaScript to inject for freezing Date/Date.now() only.
 * Unlike page.clock.setFixedTime(), this does NOT install fake-timers,
 * so setTimeout/setInterval/requestAnimationFrame continue working normally.
 */
export function getFreezeTimestampsScript(frozenTimestamp: string): string {
  return `
    (function() {
      var frozenDate = new Date('${frozenTimestamp}');
      var frozenTime = frozenDate.getTime();
      var OriginalDate = Date;
      function FrozenDate() {
        if (arguments.length === 0) return new OriginalDate(frozenTime);
        return new (Function.prototype.bind.apply(OriginalDate, [null].concat(Array.prototype.slice.call(arguments))))();
      }
      FrozenDate.now = function() { return frozenTime; };
      FrozenDate.parse = OriginalDate.parse;
      FrozenDate.UTC = OriginalDate.UTC;
      FrozenDate.prototype = OriginalDate.prototype;
      window.Date = FrozenDate;
    })();
  `;
}

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
 * Setup init scripts to freeze timestamps and random values.
 * Must be called BEFORE page navigation.
 */
export async function setupFreezeScripts(
  page: Page,
  settings?: StabilizationPayload
): Promise<void> {
  if (!settings) return;

  if (settings.freezeTimestamps) {
    await page.addInitScript(getFreezeTimestampsScript(settings.frozenTimestamp));
    // Override performance.now() so we can freeze/unfreeze it ourselves
    // via the __perfNowFrozen mechanism used during RAF flushing.
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

  if (settings.freezeRandomValues) {
    await page.addInitScript(getFreezeRandomScript(settings.randomSeed, settings.reseedRandomOnInput));
  }

  if (settings.freezeAnimations) {
    await page.addInitScript(FREEZE_ANIMATIONS_SCRIPT);
  }

  // Excalidraw RNG: roughjs uses each element's stored seed via Math.imul(48271, seed).
  // Intercepting Math.imul replaced per-element seeds with a single accumulated sequence,
  // coupling rendering to total call count and making it non-deterministic.
  // Instead, provide a no-op __resetExcalidrawRNG for backward compatibility with call sites.
  if (settings.freezeAnimations) {
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

  // Inject deterministic rendering CSS early via init script (before page scripts run).
  if (settings.crossOsConsistency || settings.freezeAnimations) {
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

  // Inject cross-OS font CSS early via init script (prevents FOUC from late injection)
  if (settings.crossOsFontCSS) {
    await page.addInitScript(`
      (function() {
        var css = ${JSON.stringify(settings.crossOsFontCSS)};
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

  // Canvas determinism: force willReadFrequently for CPU-backed canvas (avoids GPU readback
  // non-determinism) and optionally disable imageSmoothingEnabled.
  const needsDeterministicCanvas = settings.crossOsConsistency || settings.freezeAnimations || settings.disableImageSmoothing;
  if (needsDeterministicCanvas) {
    const forceWillReadFrequently = settings.crossOsConsistency || settings.freezeAnimations;
    const disableSmoothing = settings.disableImageSmoothing;
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
  if (settings.roundCanvasCoordinates) {
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

/**
 * Apply pre-screenshot stabilization: network idle, image loading, font loading, DOM stability.
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

  // 4. CSS injection moved to setupFreezeScripts

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

  // 6. Freeze performance.now, reset Excalidraw RNG, enable RAF gating + flush deterministically
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

  // 7. Wait for canvas stability (flush + toDataURL comparison loop)
  if (settings.waitForCanvasStable) {
    await waitForCanvasStable(page, settings.canvasStableTimeout, settings.canvasStableThreshold);
  }
}

/**
 * Wait for canvas elements to produce stable output.
 * Runs flush-then-check iterations synchronously in a single evaluate call.
 */
async function waitForCanvasStable(
  page: Page,
  _timeout: number,
  threshold: number
): Promise<void> {
  await page.evaluate(({ stableNeeded }) => {
    const flush = (window as any).__flushAnimationFrames;
    if (typeof flush !== 'function') return;

    let lastDataUrls = '';
    let stableCount = 0;

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
