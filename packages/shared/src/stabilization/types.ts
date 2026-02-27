import type { Page } from 'playwright';

/**
 * Core stabilization settings shared across all runner types.
 * Maps 1:1 to the StabilizationPayload sent over WebSocket.
 */
export interface CoreStabilizationSettings {
  freezeTimestamps: boolean;
  frozenTimestamp: string;
  freezeRandomValues: boolean;
  randomSeed: number;
  reseedRandomOnInput: boolean;
  freezeAnimations: boolean;
  crossOsConsistency: boolean;
  crossOsFontCSS?: string;
  waitForNetworkIdle: boolean;
  networkIdleTimeout: number;
  waitForDomStable: boolean;
  domStableTimeout: number;
  waitForFonts: boolean;
  waitForImages: boolean;
  waitForImagesTimeout: number;
  waitForCanvasStable: boolean;
  canvasStableTimeout: number;
  canvasStableThreshold: number;
  disableImageSmoothing: boolean;
  roundCanvasCoordinates: boolean;
}

/**
 * Minimal Playwright Page interface used by shared stabilization code.
 * Avoids coupling to a specific Playwright version.
 */
export type StabilizationPage = Pick<
  Page,
  'addInitScript' | 'evaluate' | 'waitForLoadState' | 'waitForTimeout' | 'waitForSelector' | 'addStyleTag'
>;
