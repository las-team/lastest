/**
 * CSS injected to freeze all animations and transitions for stable screenshots.
 * Applied when PlaywrightSettings.freezeAnimations is enabled.
 */
export const FREEZE_ANIMATIONS_CSS = `*, *::before, *::after {
  animation: none !important;
  transition: none !important;
  animation-delay: 0s !important;
  transition-delay: 0s !important;
}`;

/**
 * Default screenshot stabilization delay in milliseconds.
 * A delay before taking screenshots allows content to settle.
 */
export const DEFAULT_SCREENSHOT_DELAY = 0;
