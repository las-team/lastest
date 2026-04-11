/**
 * Text-Region-Aware Diffing
 *
 * OCR-based two-pass diffing that detects text regions and applies separate
 * thresholds for text vs non-text areas. Reduces false positives from dynamic
 * text (timestamps, counters) and cross-OS font rendering differences.
 */

import { PNG } from 'pngjs';
import type { DiffEngineType } from '../db/schema';
import { runDiffEngine } from './engines';
import type { Rectangle } from './generator';

export interface TextRegionResult {
  regions: Rectangle[];
  mask: Uint8Array; // 1 byte per pixel: text=1, non-text=0
  ocrDurationMs: number;
  totalTextPixels: number;
}

export interface TextAwareDiffOptions {
  textRegionThreshold: number;     // lenient threshold for text (e.g., 0.3)
  nonTextThreshold: number;        // strict threshold for non-text (e.g., 0.1)
  textRegionPadding: number;       // bbox expansion in pixels (default: 4)
  includeAntiAliasing: boolean;
  textDetectionGranularity: 'word' | 'line' | 'block';
  diffEngine?: DiffEngineType;
}

// ---------------------------------------------------------------------------
// Rectangle operations
// ---------------------------------------------------------------------------

export function expandRectangle(rect: Rectangle, padding: number): Rectangle {
  return {
    x: rect.x - padding,
    y: rect.y - padding,
    width: rect.width + padding * 2,
    height: rect.height + padding * 2,
  };
}

export function clampRectangle(rect: Rectangle, width: number, height: number): Rectangle {
  const x = Math.max(0, rect.x);
  const y = Math.max(0, rect.y);
  return {
    x,
    y,
    width: Math.min(rect.width, width - x),
    height: Math.min(rect.height, height - y),
  };
}

function rectanglesOverlap(a: Rectangle, b: Rectangle): boolean {
  return !(a.x + a.width <= b.x || b.x + b.width <= a.x ||
           a.y + a.height <= b.y || b.y + b.height <= a.y);
}

function mergeTwo(a: Rectangle, b: Rectangle): Rectangle {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

export function mergeOverlappingRectangles(rects: Rectangle[]): Rectangle[] {
  if (rects.length <= 1) return [...rects];

  let merged = [...rects];
  let changed = true;

  while (changed) {
    changed = false;
    const result: Rectangle[] = [];
    const used = new Set<number>();

    for (let i = 0; i < merged.length; i++) {
      if (used.has(i)) continue;
      let current = merged[i];

      for (let j = i + 1; j < merged.length; j++) {
        if (used.has(j)) continue;
        if (rectanglesOverlap(current, merged[j])) {
          current = mergeTwo(current, merged[j]);
          used.add(j);
          changed = true;
        }
      }

      result.push(current);
    }

    merged = result;
  }

  return merged;
}

export function createTextMaskBitmap(
  regions: Rectangle[],
  width: number,
  height: number
): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (const r of regions) {
    const x0 = Math.max(0, r.x);
    const y0 = Math.max(0, r.y);
    const x1 = Math.min(width, r.x + r.width);
    const y1 = Math.min(height, r.y + r.height);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        mask[y * width + x] = 1;
      }
    }
  }
  return mask;
}

// ---------------------------------------------------------------------------
// OCR Detection
// ---------------------------------------------------------------------------

export async function detectTextRegions(
  imageData: Buffer | Uint8Array,
  width: number,
  height: number,
  granularity: 'word' | 'line' | 'block' = 'word',
  minConfidence: number = 50
): Promise<TextRegionResult> {
  const start = performance.now();

  // Dynamically import Tesseract.js
  let Tesseract: typeof import('tesseract.js');
  try {
    Tesseract = await Promise.race([
      import('tesseract.js'),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Tesseract.js import timeout')), 10_000)
      ),
    ]);
  } catch {
    // Fallback: no text regions detected
    return {
      regions: [],
      mask: new Uint8Array(width * height),
      ocrDurationMs: performance.now() - start,
      totalTextPixels: 0,
    };
  }

  // Convert RGBA buffer to PNG buffer for Tesseract
  const png = new PNG({ width, height });
  Buffer.from(imageData).copy(png.data as Buffer);
  const pngBuffer = PNG.sync.write(png);

  let result;
  try {
    // Suppress uncaughtException from tesseract worker threads (e.g. broken module
    // resolution in Docker standalone builds). Without this, the worker's require('..')
    // failure propagates as an uncaughtException that kills the executor's event loop.
    let workerCrashed = false;
    const suppressTesseractCrash = (err: Error) => {
      const stack = err.stack || '';
      const isTesseract = stack.includes('tesseract') || stack.includes('worker-script') || stack.includes('createWorker');
      if (isTesseract) {
        workerCrashed = true;
        return; // Swallow — handled below
      }
      throw err; // Re-throw non-tesseract errors
    };
    process.on('uncaughtException', suppressTesseractCrash);

    try {
      const worker = await Tesseract.createWorker('eng');
      if (workerCrashed) throw new Error('Tesseract worker crashed during init');
      result = await worker.recognize(pngBuffer);
      await worker.terminate();
    } finally {
      process.removeListener('uncaughtException', suppressTesseractCrash);
    }
  } catch {
    // Tesseract worker failed (e.g. broken module resolution in Docker)
    return {
      regions: [],
      mask: new Uint8Array(width * height),
      ocrDurationMs: performance.now() - start,
      totalTextPixels: 0,
    };
  }

  // Extract regions at the desired granularity
  const rawRegions: Rectangle[] = [];

  if (result.data.blocks) {
    for (const block of result.data.blocks) {
      if (granularity === 'block') {
        if (block.confidence >= minConfidence) {
          rawRegions.push({
            x: block.bbox.x0,
            y: block.bbox.y0,
            width: block.bbox.x1 - block.bbox.x0,
            height: block.bbox.y1 - block.bbox.y0,
          });
        }
        continue;
      }

      if (block.paragraphs) {
        for (const para of block.paragraphs) {
          if (para.lines) {
            for (const line of para.lines) {
              if (granularity === 'line') {
                if (line.confidence >= minConfidence) {
                  rawRegions.push({
                    x: line.bbox.x0,
                    y: line.bbox.y0,
                    width: line.bbox.x1 - line.bbox.x0,
                    height: line.bbox.y1 - line.bbox.y0,
                  });
                }
                continue;
              }

              // Word granularity
              if (line.words) {
                for (const word of line.words) {
                  if (word.confidence >= minConfidence) {
                    rawRegions.push({
                      x: word.bbox.x0,
                      y: word.bbox.y0,
                      width: word.bbox.x1 - word.bbox.x0,
                      height: word.bbox.y1 - word.bbox.y0,
                    });
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  const regions = mergeOverlappingRectangles(rawRegions);
  const mask = createTextMaskBitmap(regions, width, height);
  let totalTextPixels = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) totalTextPixels++;
  }

  return {
    regions,
    mask,
    ocrDurationMs: performance.now() - start,
    totalTextPixels,
  };
}

// ---------------------------------------------------------------------------
// Merge text masks from two images
// ---------------------------------------------------------------------------
// Two-Pass Text-Aware Diff
// ---------------------------------------------------------------------------

function blankMaskedPixels(
  imageData: Buffer | Uint8Array,
  width: number,
  height: number,
  mask: Uint8Array,
  maskValue: number // 1 = blank text pixels, 0 = blank non-text pixels
): Buffer {
  const out = Buffer.from(imageData);
  for (let i = 0; i < width * height; i++) {
    if (mask[i] === maskValue) {
      const idx = i * 4;
      // Fill with magenta so both images have same fill => zero diff in masked area
      out[idx] = 255;
      out[idx + 1] = 0;
      out[idx + 2] = 255;
      out[idx + 3] = 255;
    }
  }
  return out;
}

export async function generateTextAwareDiff(
  baselineData: Buffer | Uint8Array,
  currentData: Buffer | Uint8Array,
  width: number,
  height: number,
  options: TextAwareDiffOptions
): Promise<{
  diffData: Buffer;
  diffPixelCount: number;
  textRegions: Rectangle[];
  textRegionDiffPixels: number;
  nonTextRegionDiffPixels: number;
  ocrDurationMs: number;
}> {
  const engine = options.diffEngine || 'pixelmatch';

  // Detect text regions from both images in parallel
  const [baselineOcr, currentOcr] = await Promise.all([
    detectTextRegions(baselineData, width, height, options.textDetectionGranularity),
    detectTextRegions(currentData, width, height, options.textDetectionGranularity),
  ]);

  const ocrDurationMs = baselineOcr.ocrDurationMs + currentOcr.ocrDurationMs;

  // Expand and merge regions from both images
  const allRegions = [...baselineOcr.regions, ...currentOcr.regions]
    .map(r => expandRectangle(r, options.textRegionPadding))
    .map(r => clampRectangle(r, width, height));

  const mergedRegions = mergeOverlappingRectangles(allRegions);
  const combinedMask = createTextMaskBitmap(mergedRegions, width, height);

  // Fallback: no text detected → standard diff
  if (mergedRegions.length === 0) {
    const result = runDiffEngine(
      engine,
      baselineData,
      currentData,
      width,
      height,
      options.nonTextThreshold,
      options.includeAntiAliasing
    );
    return {
      diffData: Buffer.from(result.diffData),
      diffPixelCount: result.diffPixelCount,
      textRegions: [],
      textRegionDiffPixels: 0,
      nonTextRegionDiffPixels: result.diffPixelCount,
      ocrDurationMs,
    };
  }

  // Pass 1: Non-text regions (blank text areas, strict threshold)
  const baselineNonText = blankMaskedPixels(baselineData, width, height, combinedMask, 1);
  const currentNonText = blankMaskedPixels(currentData, width, height, combinedMask, 1);
  const nonTextResult = runDiffEngine(
    engine,
    baselineNonText,
    currentNonText,
    width,
    height,
    options.nonTextThreshold,
    options.includeAntiAliasing
  );

  // Pass 2: Text regions (blank non-text areas, lenient threshold)
  const baselineText = blankMaskedPixels(baselineData, width, height, combinedMask, 0);
  const currentText = blankMaskedPixels(currentData, width, height, combinedMask, 0);
  const textResult = runDiffEngine(
    engine,
    baselineText,
    currentText,
    width,
    height,
    options.textRegionThreshold,
    options.includeAntiAliasing
  );

  // Combine: merge non-zero pixels from both diff outputs
  const combinedDiff = Buffer.alloc(width * height * 4);
  let totalDiffPixels = 0;

  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    const nonTextAlpha = nonTextResult.diffData[idx + 3];
    const textAlpha = textResult.diffData[idx + 3];

    if (nonTextAlpha > 0) {
      combinedDiff[idx] = nonTextResult.diffData[idx];
      combinedDiff[idx + 1] = nonTextResult.diffData[idx + 1];
      combinedDiff[idx + 2] = nonTextResult.diffData[idx + 2];
      combinedDiff[idx + 3] = nonTextAlpha;
      totalDiffPixels++;
    } else if (textAlpha > 0) {
      combinedDiff[idx] = textResult.diffData[idx];
      combinedDiff[idx + 1] = textResult.diffData[idx + 1];
      combinedDiff[idx + 2] = textResult.diffData[idx + 2];
      combinedDiff[idx + 3] = textAlpha;
      totalDiffPixels++;
    }
  }

  return {
    diffData: combinedDiff,
    diffPixelCount: totalDiffPixels,
    textRegions: mergedRegions,
    textRegionDiffPixels: textResult.diffPixelCount,
    nonTextRegionDiffPixels: nonTextResult.diffPixelCount,
    ocrDurationMs,
  };
}
