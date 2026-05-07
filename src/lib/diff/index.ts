export { generateDiff, generateTextAwareDiffFromPaths, imagesMatch, type DiffResult } from './generator';
export { hashImage, hashPixelData, hashesMatch, hashImageWithDimensions } from './hasher';
export { runDiffEngine, computeSSIM, computeButteraugli, computePixelmatch, type DiffEngineType, type EngineResult } from './engines';
export { detectTextRegions, generateTextAwareDiff, mergeOverlappingRectangles, expandRectangle, clampRectangle, createTextMaskBitmap, type TextRegionResult, type TextAwareDiffOptions } from './text-regions';
// Multi-layer comparison engines (v1.13)
export { computeDomDiff, summarizeDomDiff } from './dom-diff';
export { computeNetworkDiff, normalizeRequestUrl, summarizeNetworkDiff } from './network-diff';
export { computeConsoleDiff, fingerprintConsoleMessage, summarizeConsoleDiff } from './console-diff';
export { computeUrlTrajectoryDiff, normalizeTrajectoryUrl, summarizeUrlTrajectoryDiff } from './url-trajectory-diff';
export { computeA11yDiff, summarizeA11yDiff } from './a11y-diff';
export { computeVariableDiff, summarizeVariableDiff } from './variable-diff';
export { computePerfDiff, summarizePerfDiff } from './perf-diff';
