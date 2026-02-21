export { generateDiff, generateTextAwareDiffFromPaths, imagesMatch, type DiffResult } from './generator';
export { hashImage, hashPixelData, hashesMatch, hashImageWithDimensions } from './hasher';
export { runDiffEngine, computeSSIM, computeButteraugli, computePixelmatch, type DiffEngineType, type EngineResult } from './engines';
export { detectTextRegions, generateTextAwareDiff, mergeOverlappingRectangles, expandRectangle, clampRectangle, createTextMaskBitmap, type TextRegionResult, type TextAwareDiffOptions } from './text-regions';
