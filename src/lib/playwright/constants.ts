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
 * GSAP, Framer Motion, Lottie, and other JS animation libraries.
 */
export const FREEZE_ANIMATIONS_SCRIPT = `
// 1. Inject CSS to kill CSS animations/transitions
(function injectFreezeCSS() {
  const css = ${JSON.stringify(`*, *::before, *::after {
  animation: none !important;
  transition: none !important;
  animation-delay: 0s !important;
  transition-delay: 0s !important;
  scroll-behavior: auto !important;
}`)};
  function inject() {
    if (document.head || document.documentElement) {
      const style = document.createElement('style');
      style.setAttribute('data-freeze-animations', 'true');
      style.textContent = css;
      (document.head || document.documentElement).appendChild(style);
    }
  }
  // Inject immediately if possible, and also on DOMContentLoaded for safety
  inject();
  document.addEventListener('DOMContentLoaded', inject);
})();

// 2. Override requestAnimationFrame to execute callbacks once (not loop)
const _origRAF = window.requestAnimationFrame;
let _rafId = 0;
window.requestAnimationFrame = function(callback) {
  // Execute once with timestamp 0, don't schedule repeating frames
  return _origRAF.call(window, function() {
    callback(0);
  });
};

// 3. Pause Web Animations API animations after load
document.addEventListener('DOMContentLoaded', function() {
  try {
    if (typeof document.getAnimations === 'function') {
      document.getAnimations().forEach(function(anim) { anim.cancel(); });
    }
  } catch(e) {}
});

// Also pause on full load for late-starting animations
window.addEventListener('load', function() {
  try {
    if (typeof document.getAnimations === 'function') {
      document.getAnimations().forEach(function(anim) { anim.cancel(); });
    }
  } catch(e) {}
});
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
 * 1x1 transparent PNG placeholder for mocked third-party images.
 * Base64 encoded.
 */
export const PLACEHOLDER_IMAGE_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/**
 * Buffer of the placeholder image for route fulfillment.
 */
export const PLACEHOLDER_IMAGE_BUFFER = Buffer.from(PLACEHOLDER_IMAGE_BASE64, 'base64');
