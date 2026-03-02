import type { CoreStabilizationSettings, StabilizationPage } from './types';
import { DETERMINISTIC_RENDERING_CSS, FREEZE_ANIMATIONS_SCRIPT } from './constants';
import { getFreezeTimestampsScript, getFreezeRandomScript } from './scripts';

/**
 * Setup init scripts to freeze timestamps and random values.
 * Must be called BEFORE page navigation.
 *
 * Shared implementation used by all runner types (local, remote, embedded).
 */
export async function setupFreezeScripts(
  page: StabilizationPage,
  settings: CoreStabilizationSettings
): Promise<void> {
  // Freeze Date/Date.now() via init script (does NOT affect timers/RAF)
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

  // Freeze random values
  if (settings.freezeRandomValues) {
    await page.addInitScript(getFreezeRandomScript(settings.randomSeed, settings.reseedRandomOnInput));
  }

  // Freeze animations
  if (settings.freezeAnimations) {
    await page.addInitScript(FREEZE_ANIMATIONS_SCRIPT);
  }

  // Excalidraw RNG reset: provide __resetExcalidrawRNG that resets Math.random seed.
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
