export type { CoreStabilizationSettings, StabilizationPage } from './types';

export {
  FREEZE_ANIMATIONS_CSS,
  FREEZE_ANIMATIONS_SCRIPT,
  DEFAULT_SCREENSHOT_DELAY,
  HIDE_SPINNERS_CSS,
  SYSTEM_FONTS_CSS,
  CROSS_OS_CHROMIUM_ARGS,
  getCrossOsFontCSS,
  DETERMINISTIC_RENDERING_CSS,
  PLACEHOLDER_IMAGE_BASE64,
  PLACEHOLDER_IMAGE_BUFFER,
} from './constants';

export { getFreezeRandomScript, getFreezeTimestampsScript } from './scripts';

export {
  waitForSpinnersToDisappear,
  waitForStylesLoaded,
  waitForImagesLoaded,
  waitForDomStable,
  waitForCanvasStable,
  injectCSS,
} from './page-helpers';

export { setupFreezeScripts } from './setup-freeze-scripts';
export { applyCoreStabilization } from './apply-stabilization';
