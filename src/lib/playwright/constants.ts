import fs from 'fs';
import path from 'path';

/**
 * CSS injected to freeze all animations and transitions for stable screenshots.
 * Applied when PlaywrightSettings.freezeAnimations is enabled.
 */
export const FREEZE_ANIMATIONS_CSS = `*, *::before, *::after {
  animation: none !important;
  transition: none !important;
  animation-delay: 0s !important;
  transition-delay: 0s !important;
  scroll-behavior: auto !important;
}`;

/**
 * Script injected via addInitScript to freeze both CSS and JS animations.
 * Runs before any page scripts on every navigation.
 * Handles: CSS animations/transitions, Web Animations API, requestAnimationFrame,
 * setInterval-based carousels, element.animate(), and inline style transitions.
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

// 3. setInterval override removed — too aggressive, breaks apps that rely on
//    periodic state management (e.g. Excalidraw collaboration, React scheduling).
//    CSS animation freeze + RAF gating handles visual stability without this.

// 3b. Gate requestAnimationFrame — queue callbacks instead of firing them.
// Gating is DISABLED during page load to allow initial rendering.
// Enable via window.__enableRAFGating() after the page is interactive.
var _origRAF = window.requestAnimationFrame;
var _origCancelRAF = window.cancelAnimationFrame;
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
  // Drop gated timeouts — they were deferred to prevent side effects during stabilization
  _timeoutQueue.clear();
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
    var rafCbs = Array.from(_rafQueue.values());
    _rafQueue.clear();
    rafCbs.forEach(function(cb) { try { cb(1000); } catch(e) {} });
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
  // Also cancel after a brief delay for late-starting animations (React hydration, etc.)
  setTimeout(cancelAllAnimations, 100);
  setTimeout(cancelAllAnimations, 500);
});

// 5. Freeze animated GIFs by replacing them with static canvas snapshots
(function freezeGifs() {
  function isGifSrc(src) {
    if (!src) return false;
    try {
      var url = new URL(src, location.href);
      return /\.gif(\\?|$)/i.test(url.pathname);
    } catch(e) {
      return /\.gif(\\?|$)/i.test(src);
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
    } catch(e) {
      // Cross-origin GIFs will throw — silently skip (Layer 1 handles them)
    }
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

  // Observe dynamically added GIF images
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
            // Check descendants
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
 * Default screenshot stabilization delay in milliseconds.
 * A delay before taking screenshots allows content to settle.
 */
export const DEFAULT_SCREENSHOT_DELAY = 0;

/**
 * CSS to hide common loading indicators and spinners.
 * These are visually hidden but remain in the DOM for wait checks.
 */
export const HIDE_SPINNERS_CSS = `
[class*="spinner"],
[class*="loading"],
[class*="loader"],
[class*="skeleton"],
[class*="pulse"],
[class*="shimmer"],
[aria-busy="true"],
[data-loading="true"],
[data-testid*="loading"],
[data-testid*="spinner"],
.MuiCircularProgress-root,
.MuiLinearProgress-root,
.ant-spin,
.ant-skeleton,
.chakra-spinner,
.chakra-skeleton,
.loading-indicator,
.spinner,
.loader {
  visibility: hidden !important;
  opacity: 0 !important;
}
`;

/**
 * CSS to force system fonts instead of web fonts.
 * Prevents FOUC from font loading.
 */
export const SYSTEM_FONTS_CSS = `
*, *::before, *::after {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
               "Helvetica Neue", Arial, "Noto Sans", sans-serif,
               "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol",
               "Noto Color Emoji" !important;
}
`;

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
  '--run-all-compositor-stages-before-draw',
  '--disable-threaded-animation',
  '--disable-partial-raster',
  '--disable-checker-imaging',
  '--force-device-scale-factor=1',
];

/**
 * Returns CSS that injects a bundled Inter font and overrides all font-family declarations.
 * The font is embedded as a base64 data URI so it works regardless of target site origin.
 * Result is cached after first call.
 */
let _crossOsFontCSSCache: string | null = null;
export function getCrossOsFontCSS(): string {
  if (_crossOsFontCSSCache) return _crossOsFontCSSCache;

  const fontPath = path.join(process.cwd(), 'public', 'fonts', 'inter-regular.woff2');
  const fontBuffer = fs.readFileSync(fontPath);
  const base64 = fontBuffer.toString('base64');

  _crossOsFontCSSCache = `
@font-face {
  font-family: 'Inter-Bundled';
  src: url('data:font/woff2;base64,${base64}') format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: block;
}
*, *::before, *::after {
  font-family: 'Inter-Bundled', sans-serif !important;
}
`;
  return _crossOsFontCSSCache;
}

/**
 * CSS injected for deterministic rendering: hides cursor, caret, text selection,
 * and normalizes font smoothing. Applied when crossOsConsistency or freezeAnimations
 * is enabled to eliminate visual non-determinism between runs.
 */
export const DETERMINISTIC_RENDERING_CSS = `*, *::before, *::after {
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
 * 1x1 transparent PNG placeholder for mocked third-party images.
 * Base64 encoded.
 */
export const PLACEHOLDER_IMAGE_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/**
 * Buffer of the placeholder image for route fulfillment.
 */
export const PLACEHOLDER_IMAGE_BUFFER = Buffer.from(PLACEHOLDER_IMAGE_BASE64, 'base64');
