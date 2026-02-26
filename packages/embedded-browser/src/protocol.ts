/**
 * Protocol types for the embedded browser package.
 * Subset of packages/runner/src/protocol.ts — only the types needed for stabilization.
 */

export interface StabilizationPayload {
  freezeTimestamps: boolean;
  frozenTimestamp: string;
  freezeRandomValues: boolean;
  randomSeed: number;
  freezeAnimations: boolean;
  crossOsConsistency: boolean;
  waitForNetworkIdle: boolean;
  networkIdleTimeout: number;
  waitForDomStable: boolean;
  domStableTimeout: number;
  waitForFonts: boolean;
  waitForImages: boolean;
  waitForImagesTimeout: number;
  crossOsFontCSS?: string;
  waitForCanvasStable: boolean;
  canvasStableTimeout: number;
  canvasStableThreshold: number;
  disableImageSmoothing: boolean;
  roundCanvasCoordinates: boolean;
  reseedRandomOnInput: boolean;
}
