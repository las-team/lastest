import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import type { AlignmentSegment, DiffMetadata, DiffEngineType, PageShiftInfo, RegionDetectionMode } from '../db/schema';
import { runDiffEngine } from './engines';

export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RegionCentroid {
  x: number;
  y: number;
  region: Rectangle;
}

export interface DiffResult {
  pixelDifference: number;
  percentageDifference: number;
  diffImagePath: string;
  metadata: DiffMetadata;
}

// Alignment operation types for LCS row alignment
type AlignOp = 'match' | 'insert' | 'delete';

/**
 * Maximum number of DP cells (m * n) for the LCS alignment.
 * Beyond this threshold we fall back to sequential row matching
 * to avoid freezing the event loop / running out of memory.
 * 25M cells ≈ 100MB RAM, covers images up to ~5000px each.
 */
const MAX_LCS_CELLS = 50_000_000;

interface AlignmentResult {
  ops: AlignOp[];
  baselineRows: number[];  // maps aligned row index -> baseline row (-1 for inserts)
  currentRows: number[];   // maps aligned row index -> current row (-1 for deletes)
  insertedRows: number;
  deletedRows: number;
  matchedRows: number;
}

/**
 * RLE-compress alignment ops into AlignmentSegment[] for efficient frontend rendering.
 */
function compressOpsToSegments(ops: AlignOp[]): AlignmentSegment[] {
  if (ops.length === 0) return [];
  const segments: AlignmentSegment[] = [];
  let current: AlignmentSegment = { op: ops[0], count: 1 };
  for (let i = 1; i < ops.length; i++) {
    if (ops[i] === current.op) {
      current.count++;
    } else {
      segments.push(current);
      current = { op: ops[i], count: 1 };
    }
  }
  segments.push(current);
  return segments;
}

/**
 * Detect background color by sampling corners and edges of the image.
 * Returns the most common color found in these areas.
 */
function detectBackgroundColor(data: Buffer, width: number, height: number): { r: number; g: number; b: number } {
  const samples: Map<string, number> = new Map();

  // Sample corners and edges
  const samplePoints = [
    { x: 0, y: 0 },
    { x: width - 1, y: 0 },
    { x: 0, y: height - 1 },
    { x: width - 1, y: height - 1 },
    { x: Math.floor(width / 2), y: 0 },
    { x: Math.floor(width / 2), y: height - 1 },
    { x: 0, y: Math.floor(height / 2) },
    { x: width - 1, y: Math.floor(height / 2) },
  ];

  for (const { x, y } of samplePoints) {
    const idx = (y * width + x) * 4;
    const key = `${data[idx]},${data[idx + 1]},${data[idx + 2]}`;
    samples.set(key, (samples.get(key) || 0) + 1);
  }

  // Find most common color
  let maxCount = 0;
  let bgColor = { r: 255, g: 255, b: 255 }; // default white

  for (const [key, count] of samples) {
    if (count > maxCount) {
      maxCount = count;
      const [r, g, b] = key.split(',').map(Number);
      bgColor = { r, g, b };
    }
  }

  return bgColor;
}

/**
 * Calculate the content area (non-background pixels) of an image.
 * Returns bounding box of content and pixel count.
 */
function calculateContentArea(
  data: Buffer,
  width: number,
  height: number,
  bgColor: { r: number; g: number; b: number },
  tolerance: number = 30
): { contentPixels: number; boundingBox: Rectangle | null } {
  let minX = width, minY = height, maxX = 0, maxY = 0;
  let contentPixels = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];

      // Check if pixel differs from background
      const diffR = Math.abs(r - bgColor.r);
      const diffG = Math.abs(g - bgColor.g);
      const diffB = Math.abs(b - bgColor.b);

      if (diffR > tolerance || diffG > tolerance || diffB > tolerance) {
        contentPixels++;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (contentPixels === 0) {
    return { contentPixels: 0, boundingBox: null };
  }

  return {
    contentPixels,
    boundingBox: {
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    },
  };
}

/**
 * Hash a single row of pixel data using MD5 for fast comparison.
 * We use MD5 because we only need collision resistance within a single image pair,
 * and it's significantly faster than SHA256 for this use case.
 */
function _hashRow(data: Buffer | Uint8Array, width: number, row: number): string {
  const start = row * width * 4;
  const end = start + width * 4;
  const slice = Buffer.from(data.buffer, data.byteOffset + start, end - start);
  return crypto.createHash('md5').update(slice).digest('hex');
}

/**
 * Hash a single row with quantized RGB channels for fuzzy matching.
 * Shift each RGB channel right by 4 bits (16 levels) so sub-pixel rendering
 * differences hash identically. Alpha is kept as-is.
 */
function hashRowQuantized(data: Buffer | Uint8Array, width: number, row: number): string {
  const rowBytes = width * 4;
  const start = row * rowBytes;
  const quantized = Buffer.allocUnsafe(rowBytes);
  for (let i = 0; i < rowBytes; i += 4) {
    quantized[i]     = data[start + i] >> 4;      // R
    quantized[i + 1] = data[start + i + 1] >> 4;  // G
    quantized[i + 2] = data[start + i + 2] >> 4;  // B
    quantized[i + 3] = data[start + i + 3];        // A unchanged
  }
  return crypto.createHash('md5').update(quantized).digest('hex');
}

/**
 * Compare two pixel rows using pixelmatch and return the fraction of pixels
 * that differ (0.0–1.0). Uses the same threshold and AA detection as the
 * main comparison, so sub-pixel font rendering noise is properly filtered.
 */
function rowDiffRatioPixelmatch(
  dataA: Buffer | Uint8Array,
  dataB: Buffer | Uint8Array,
  width: number,
  rowA: number,
  rowB: number,
  threshold: number,
  includeAA: boolean
): number {
  const rowBytes = width * 4;
  const rowDataA = Buffer.from(dataA.buffer, dataA.byteOffset + rowA * rowBytes, rowBytes);
  const rowDataB = Buffer.from(dataB.buffer, dataB.byteOffset + rowB * rowBytes, rowBytes);
  const output = new Uint8Array(rowBytes);
  const diff = pixelmatch(rowDataA, rowDataB, output, width, 1, { threshold, includeAA });
  return diff / width;
}

/**
 * LCS-based row alignment algorithm.
 * Hashes each pixel row in both images, then computes the longest common
 * subsequence to find the optimal vertical alignment. Rows present in LCS
 * are "matched", rows only in the current image are "insertions", rows only
 * in the baseline are "deletions".
 *
 * Inspired by Chromatic's Page Shift Detection and Happo's lcs-image-diff.
 */
function alignRows(
  baselineData: Buffer | Uint8Array,
  baselineWidth: number,
  baselineHeight: number,
  currentData: Buffer | Uint8Array,
  currentWidth: number,
  currentHeight: number
): AlignmentResult {
  // Both images must have the same width for row alignment
  if (baselineWidth !== currentWidth) {
    // Fall back: no alignment possible with different widths
    const maxH = Math.max(baselineHeight, currentHeight);
    return {
      ops: Array(maxH).fill('match' as AlignOp),
      baselineRows: Array.from({ length: maxH }, (_, i) => i < baselineHeight ? i : -1),
      currentRows: Array.from({ length: maxH }, (_, i) => i < currentHeight ? i : -1),
      insertedRows: Math.max(0, currentHeight - baselineHeight),
      deletedRows: Math.max(0, baselineHeight - currentHeight),
      matchedRows: Math.min(baselineHeight, currentHeight),
    };
  }

  // Guard: fall back to sequential matching when images are too tall for LCS.
  // The DP table is O(m*n) in both memory and time — tall full-page screenshots
  // would freeze the event loop or OOM without this check.
  if (baselineHeight * currentHeight > MAX_LCS_CELLS) {
    const minH = Math.min(baselineHeight, currentHeight);
    const maxH = Math.max(baselineHeight, currentHeight);
    const ops: AlignOp[] = [];
    const baselineRows: number[] = [];
    const currentRows: number[] = [];
    // Match rows 1:1 up to the shorter image
    for (let y = 0; y < minH; y++) {
      ops.push('match');
      baselineRows.push(y);
      currentRows.push(y);
    }
    // Remaining rows are inserts or deletes
    for (let y = minH; y < maxH; y++) {
      if (currentHeight > baselineHeight) {
        ops.push('insert');
        baselineRows.push(-1);
        currentRows.push(y);
      } else {
        ops.push('delete');
        baselineRows.push(y);
        currentRows.push(-1);
      }
    }
    return {
      ops,
      baselineRows,
      currentRows,
      insertedRows: Math.max(0, currentHeight - baselineHeight),
      deletedRows: Math.max(0, baselineHeight - currentHeight),
      matchedRows: minH,
    };
  }

  // Hash all rows (quantized to tolerate sub-pixel rendering differences)
  const baselineHashes: string[] = [];
  for (let y = 0; y < baselineHeight; y++) {
    baselineHashes.push(hashRowQuantized(baselineData, baselineWidth, y));
  }

  const currentHashes: string[] = [];
  for (let y = 0; y < currentHeight; y++) {
    currentHashes.push(hashRowQuantized(currentData, currentWidth, y));
  }

  // Compute LCS using space-optimized DP (we only need the traceback)
  const m = baselineHeight;
  const n = currentHeight;

  // Full DP table for traceback
  const dp: Uint32Array[] = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (baselineHashes[i - 1] === currentHashes[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Traceback to build alignment operations
  const ops: AlignOp[] = [];
  const baselineRows: number[] = [];
  const currentRows: number[] = [];
  let i = m, j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && baselineHashes[i - 1] === currentHashes[j - 1]) {
      ops.push('match');
      baselineRows.push(i - 1);
      currentRows.push(j - 1);
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push('insert');
      baselineRows.push(-1);
      currentRows.push(j - 1);
      j--;
    } else {
      ops.push('delete');
      baselineRows.push(i - 1);
      currentRows.push(-1);
      i--;
    }
  }

  // Reverse since we traced back from the end
  ops.reverse();
  baselineRows.reverse();
  currentRows.reverse();

  const insertedRows = ops.filter(o => o === 'insert').length;
  const deletedRows = ops.filter(o => o === 'delete').length;
  const matchedRows = ops.filter(o => o === 'match').length;

  return { ops, baselineRows, currentRows, insertedRows, deletedRows, matchedRows };
}

/**
 * Post-process an alignment result to fuzzy-match nearby delete/insert pairs
 * whose pixel data is similar. Rows that differ by less than `maxDiffRatio`
 * are reclassified as 'match' so they go through pixelmatch instead of being
 * painted solid red/green.
 */
function fuzzyMatchUnalignedRows(
  alignment: AlignmentResult,
  baselineData: Buffer | Uint8Array,
  currentData: Buffer | Uint8Array,
  width: number,
  threshold: number,
  includeAA: boolean,
  maxDiffRatio: number = 0.5
): AlignmentResult {
  const ops = [...alignment.ops];
  const baselineRows = [...alignment.baselineRows];
  const currentRows = [...alignment.currentRows];

  // Find consecutive blocks of deletes followed by inserts (or vice versa)
  // and pair them sequentially. This handles the common LCS pattern where
  // a block of N deletes is followed by N inserts for near-identical rows.
  let i = 0;
  while (i < ops.length) {
    // Find a block of deletes
    let delStart = i;
    while (i < ops.length && ops[i] === 'delete') i++;
    const delEnd = i;
    const delCount = delEnd - delStart;

    // Find a following block of inserts
    let insStart = i;
    while (i < ops.length && ops[i] === 'insert') i++;
    const insEnd = i;
    const insCount = insEnd - insStart;

    // Also check insert-then-delete pattern
    if (delCount === 0 && insCount > 0) {
      // Check if inserts are followed by deletes
      const delStart2 = i;
      while (i < ops.length && ops[i] === 'delete') i++;
      const delEnd2 = i;
      const delCount2 = delEnd2 - delStart2;

      if (delCount2 > 0) {
        // Pair inserts with following deletes sequentially
        const pairCount = Math.min(insCount, delCount2);
        for (let p = 0; p < pairCount; p++) {
          const ii = insStart + p;
          const di = delStart2 + p;
          const cRow = currentRows[ii];
          const bRow = baselineRows[di];
          if (cRow === -1 || bRow === -1) continue;

          const ratio = rowDiffRatioPixelmatch(baselineData, currentData, width, bRow, cRow, threshold, includeAA);
          if (ratio < maxDiffRatio) {
            ops[ii] = 'match';
            baselineRows[ii] = bRow;
            ops[di] = 'match' as AlignOp;
            baselineRows[di] = -2;
            currentRows[di] = -2;
          }
        }
      }
      continue;
    }

    if (delCount === 0 || insCount === 0) {
      if (delCount === 0 && insCount === 0) i++;
      continue;
    }

    // Pair deletes with inserts sequentially
    const pairCount = Math.min(delCount, insCount);
    for (let p = 0; p < pairCount; p++) {
      const di = delStart + p;
      const ii = insStart + p;
      const bRow = baselineRows[di];
      const cRow = currentRows[ii];
      if (bRow === -1 || cRow === -1) continue;

      const ratio = rowDiffRatioPixelmatch(baselineData, currentData, width, bRow, cRow, threshold, includeAA);
      if (ratio < maxDiffRatio) {
        // Keep the delete position as 'match' with both row refs, remove the insert
        ops[di] = 'match';
        currentRows[di] = cRow;
        ops[ii] = 'match' as AlignOp;
        baselineRows[ii] = -2;
        currentRows[ii] = -2;
      }
    }
  }

  // Remove sentinel entries
  const finalOps: AlignOp[] = [];
  const finalBaselineRows: number[] = [];
  const finalCurrentRows: number[] = [];

  for (let j = 0; j < ops.length; j++) {
    if (baselineRows[j] === -2 && currentRows[j] === -2) continue;
    finalOps.push(ops[j]);
    finalBaselineRows.push(baselineRows[j]);
    finalCurrentRows.push(currentRows[j]);
  }

  return {
    ops: finalOps,
    baselineRows: finalBaselineRows,
    currentRows: finalCurrentRows,
    insertedRows: finalOps.filter(o => o === 'insert').length,
    deletedRows: finalOps.filter(o => o === 'delete').length,
    matchedRows: finalOps.filter(o => o === 'match').length,
  };
}

/**
 * Build aligned image buffers from an alignment result.
 * ALL rows (match, insert, delete) are included so pixelmatch sees the full picture.
 * Inserted rows get baseline filled with background color; deleted rows get current filled.
 */
function buildAlignedImages(
  baselineData: Buffer | Uint8Array,
  currentData: Buffer | Uint8Array,
  width: number,
  alignment: AlignmentResult,
  baselineBg: { r: number; g: number; b: number },
  currentBg: { r: number; g: number; b: number }
): { alignedBaseline: Buffer; alignedCurrent: Buffer; alignedHeight: number } {
  const alignedHeight = alignment.ops.length;
  const rowBytes = width * 4;

  const alignedBaseline = Buffer.alloc(alignedHeight * rowBytes);
  const alignedCurrent = Buffer.alloc(alignedHeight * rowBytes);

  for (let i = 0; i < alignment.ops.length; i++) {
    const op = alignment.ops[i];
    const destOffset = i * rowBytes;

    if (op === 'match') {
      const bRow = alignment.baselineRows[i];
      const cRow = alignment.currentRows[i];
      Buffer.from(baselineData.buffer, baselineData.byteOffset + bRow * rowBytes, rowBytes)
        .copy(alignedBaseline, destOffset);
      Buffer.from(currentData.buffer, currentData.byteOffset + cRow * rowBytes, rowBytes)
        .copy(alignedCurrent, destOffset);
    } else if (op === 'insert') {
      // No baseline row — fill with baseline background color
      for (let x = 0; x < width; x++) {
        const off = destOffset + x * 4;
        alignedBaseline[off] = baselineBg.r;
        alignedBaseline[off + 1] = baselineBg.g;
        alignedBaseline[off + 2] = baselineBg.b;
        alignedBaseline[off + 3] = 255;
      }
      const cRow = alignment.currentRows[i];
      Buffer.from(currentData.buffer, currentData.byteOffset + cRow * rowBytes, rowBytes)
        .copy(alignedCurrent, destOffset);
    } else {
      // delete — no current row — fill with current background color
      const bRow = alignment.baselineRows[i];
      Buffer.from(baselineData.buffer, baselineData.byteOffset + bRow * rowBytes, rowBytes)
        .copy(alignedBaseline, destOffset);
      for (let x = 0; x < width; x++) {
        const off = destOffset + x * 4;
        alignedCurrent[off] = currentBg.r;
        alignedCurrent[off + 1] = currentBg.g;
        alignedCurrent[off + 2] = currentBg.b;
        alignedCurrent[off + 3] = 255;
      }
    }
  }

  return { alignedBaseline, alignedCurrent, alignedHeight };
}

/**
 * Generate a shift-aware diff image that shows:
 * - Green tinted rows for insertions (new content in current)
 * - Red tinted rows for deletions (removed content from baseline)
 * - Standard pixelmatch diff for matched rows that actually changed
 */
function buildShiftAwareDiffImage(
  baselineData: Buffer | Uint8Array,
  currentData: Buffer | Uint8Array,
  alignedDiffData: Buffer | Uint8Array,
  width: number,
  alignment: AlignmentResult
): PNG {
  const totalHeight = alignment.ops.length;
  const diffImage = new PNG({ width, height: totalHeight });
  const rowBytes = width * 4;

  for (let i = 0; i < alignment.ops.length; i++) {
    const op = alignment.ops[i];
    const destOffset = i * rowBytes;

    if (op === 'match') {
      // Copy diff data for matched rows (alignedDiffData includes all rows now)
      Buffer.from(alignedDiffData.buffer, alignedDiffData.byteOffset + i * rowBytes, rowBytes)
        .copy(diffImage.data as Buffer, destOffset);
    } else if (op === 'insert') {
      // Green tint for inserted rows (new content)
      const cRow = alignment.currentRows[i];
      const srcOffset = cRow * rowBytes;
      for (let x = 0; x < width; x++) {
        const si = srcOffset + x * 4;
        const di = destOffset + x * 4;
        // Blend with green overlay
        diffImage.data[di] = Math.floor(currentData[si] * 0.4);       // R dimmed
        diffImage.data[di + 1] = Math.min(255, Math.floor(currentData[si + 1] * 0.4 + 150)); // G boosted
        diffImage.data[di + 2] = Math.floor(currentData[si + 2] * 0.4); // B dimmed
        diffImage.data[di + 3] = 255;
      }
    } else {
      // Red tint for deleted rows (removed content)
      const bRow = alignment.baselineRows[i];
      const srcOffset = bRow * rowBytes;
      for (let x = 0; x < width; x++) {
        const si = srcOffset + x * 4;
        const di = destOffset + x * 4;
        // Blend with red overlay
        diffImage.data[di] = Math.min(255, Math.floor(baselineData[si] * 0.4 + 150));     // R boosted
        diffImage.data[di + 1] = Math.floor(baselineData[si + 1] * 0.4); // G dimmed
        diffImage.data[di + 2] = Math.floor(baselineData[si + 2] * 0.4); // B dimmed
        diffImage.data[di + 3] = 255;
      }
    }
  }

  return diffImage;
}

/**
 * Pad a PNG image to a taller height, filling extra rows with the detected background color.
 * Used to normalize heights when fullPage screenshots capture different page lengths.
 */
function padToHeight(img: PNG, targetHeight: number): PNG {
  if (img.height >= targetHeight) return img;
  const padded = new PNG({ width: img.width, height: targetHeight, fill: true });
  // Copy existing image data
  (img.data as Buffer).copy(padded.data as Buffer, 0, 0, img.data.length);
  // Fill remaining rows with background color
  const bg = detectBackgroundColor(img.data, img.width, img.height);
  const startByte = img.height * img.width * 4;
  const endByte = targetHeight * img.width * 4;
  for (let i = startByte; i < endByte; i += 4) {
    padded.data[i] = bg.r;
    padded.data[i + 1] = bg.g;
    padded.data[i + 2] = bg.b;
    padded.data[i + 3] = 255;
  }
  return padded;
}

/**
 * Crop a PNG image to a narrower width, keeping the left portion.
 * Used to normalize widths when fullPage screenshots capture different scrollWidths.
 */
function cropToWidth(img: PNG, targetWidth: number): PNG {
  if (img.width === targetWidth) return img;
  const cropped = new PNG({ width: targetWidth, height: img.height });
  for (let y = 0; y < img.height; y++) {
    const srcOffset = y * img.width * 4;
    const destOffset = y * targetWidth * 4;
    (img.data as Buffer).copy(cropped.data as Buffer, destOffset, srcOffset, srcOffset + targetWidth * 4);
  }
  return cropped;
}

/**
 * Compare two PNG images and generate a diff image.
 * When ignorePageShift is true and images have different heights (or a vertical
 * content shift is detected), uses LCS row-alignment to exclude displaced content
 * from the diff, reporting only genuinely changed pixels.
 */
export async function generateDiff(
  baselinePath: string,
  currentPath: string,
  outputDir: string,
  threshold = 0.1,
  includeAntiAliasing = false,
  ignoreRegions?: Rectangle[],
  ignorePageShift = false,
  diffEngine: DiffEngineType = 'pixelmatch',
  regionDetectionMode: RegionDetectionMode = 'grid'
): Promise<DiffResult> {
  let baseline: PNG = PNG.sync.read(fs.readFileSync(baselinePath));
  let current: PNG = PNG.sync.read(fs.readFileSync(currentPath));

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Crop to common width if widths differ (horizontal overflow from fullPage screenshots)
  const minWidth = Math.min(baseline.width, current.width);
  if (baseline.width !== current.width) {
    baseline = cropToWidth(baseline, minWidth);
    current = cropToWidth(current, minWidth);
  }

  const hasSameSize = baseline.width === current.width && baseline.height === current.height;
  const hasSameWidth = baseline.width === current.width;

  // Use shift-aware diffing when enabled and widths match
  if (ignorePageShift && hasSameWidth) {
    return generateShiftAwareDiff(baseline, current, outputDir, threshold, includeAntiAliasing, ignoreRegions, diffEngine, regionDetectionMode);
  }

  // Pad shorter image to match taller one when heights differ
  if (hasSameWidth && !hasSameSize) {
    const maxHeight = Math.max(baseline.height, current.height);
    if (baseline.height < maxHeight) {
      baseline = padToHeight(baseline, maxHeight);
    }
    if (current.height < maxHeight) {
      current = padToHeight(current, maxHeight);
    }
  } else if (!hasSameSize) {
    throw new Error(`Image dimensions mismatch: baseline ${baseline.width}x${baseline.height}, current ${current.width}x${current.height}`);
  }

  const { width, height } = baseline;

  // Blank out ignore regions in both images before comparison
  if (ignoreRegions && ignoreRegions.length > 0) {
    for (const region of ignoreRegions) {
      blankRegion(baseline.data, width, height, region);
      blankRegion(current.data, width, height, region);
    }
  }

  const diff = new PNG({ width, height });

  const engineResult = runDiffEngine(
    diffEngine,
    baseline.data,
    current.data,
    width,
    height,
    threshold,
    includeAntiAliasing
  );
  const numDiffPixels = engineResult.diffPixelCount;
  Buffer.from(engineResult.diffData).copy(diff.data as Buffer);

  // Save diff image
  const diffFileName = `diff-${Date.now()}.png`;
  const diffImagePath = path.join(outputDir, diffFileName);

  fs.writeFileSync(diffImagePath, PNG.sync.write(diff));

  // Calculate metadata
  const changedRegions = regionDetectionMode === 'flood-fill'
    ? findChangedRegionsFloodFill(diff.data, width, height)
    : findChangedRegions(diff.data, width, height);

  const baselineBg = detectBackgroundColor(baseline.data, width, height);
  const currentBg = detectBackgroundColor(current.data, width, height);
  const baselineContent = calculateContentArea(baseline.data, width, height, baselineBg);
  const currentContent = calculateContentArea(current.data, width, height, currentBg);

  const contentArea = Math.max(baselineContent.contentPixels, currentContent.contentPixels, 1);
  const contentPercentage = (numDiffPixels / contentArea) * 100;
  const percentageDifference = Math.min(contentPercentage, 100);

  const changeCategories = categorizeChanges(changedRegions, percentageDifference);
  const affectedComponents = detectAffectedComponents(changedRegions);
  const pageShift = detectPageShift(changedRegions);

  return {
    pixelDifference: numDiffPixels,
    percentageDifference: Math.round(percentageDifference * 100) / 100,
    diffImagePath,
    metadata: {
      changedRegions,
      affectedComponents,
      changeCategories,
      pageShift,
    },
  };
}

/**
 * File-path wrapper around generateTextAwareDiff (text-regions.ts).
 * Reads PNGs, normalises dimensions, applies ignore regions, runs two-pass
 * OCR diff, writes the combined diff image, and returns a DiffResult
 * compatible with the standard pipeline.
 */
export async function generateTextAwareDiffFromPaths(
  baselinePath: string,
  currentPath: string,
  outputDir: string,
  options: import('./text-regions').TextAwareDiffOptions,
  ignoreRegions?: Rectangle[],
  regionDetectionMode: RegionDetectionMode = 'grid',
): Promise<DiffResult> {
  const { generateTextAwareDiff } = await import('./text-regions');

  let baseline: PNG = PNG.sync.read(fs.readFileSync(baselinePath));
  let current: PNG = PNG.sync.read(fs.readFileSync(currentPath));

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Normalise widths (crop to narrower)
  const minWidth = Math.min(baseline.width, current.width);
  if (baseline.width !== current.width) {
    baseline = cropToWidth(baseline, minWidth);
    current = cropToWidth(current, minWidth);
  }

  // Normalise heights (pad to taller)
  if (baseline.height !== current.height) {
    const maxHeight = Math.max(baseline.height, current.height);
    if (baseline.height < maxHeight) baseline = padToHeight(baseline, maxHeight);
    if (current.height < maxHeight) current = padToHeight(current, maxHeight);
  }

  const { width, height } = baseline;

  // Blank ignore regions before diff
  if (ignoreRegions && ignoreRegions.length > 0) {
    for (const region of ignoreRegions) {
      blankRegion(baseline.data, width, height, region);
      blankRegion(current.data, width, height, region);
    }
  }

  // Two-pass OCR diff
  const result = await generateTextAwareDiff(
    baseline.data as Buffer,
    current.data as Buffer,
    width,
    height,
    options,
  );

  // Write combined diff image
  const diffPng = new PNG({ width, height });
  result.diffData.copy(diffPng.data as Buffer);
  const diffFileName = `diff-${Date.now()}.png`;
  const diffImagePath = path.join(outputDir, diffFileName);
  fs.writeFileSync(diffImagePath, PNG.sync.write(diffPng));

  // Compute content-area-based percentage (same formula as generateDiff)
  const baselineBg = detectBackgroundColor(baseline.data, width, height);
  const currentBg = detectBackgroundColor(current.data, width, height);
  const baselineContent = calculateContentArea(baseline.data, width, height, baselineBg);
  const currentContent = calculateContentArea(current.data, width, height, currentBg);
  const contentArea = Math.max(baselineContent.contentPixels, currentContent.contentPixels, 1);
  const contentPercentage = (result.diffPixelCount / contentArea) * 100;
  const percentageDifference = Math.round(Math.min(contentPercentage, 100) * 100) / 100;

  // Metadata
  const changedRegions = regionDetectionMode === 'flood-fill'
    ? findChangedRegionsFloodFill(result.diffData, width, height)
    : findChangedRegions(result.diffData, width, height);
  const changeCategories = categorizeChanges(changedRegions, percentageDifference);
  const affectedComponents = detectAffectedComponents(changedRegions);

  return {
    pixelDifference: result.diffPixelCount,
    percentageDifference,
    diffImagePath,
    metadata: {
      changedRegions,
      affectedComponents,
      changeCategories,
      textRegions: result.textRegions,
      textRegionDiffPixels: result.textRegionDiffPixels,
      nonTextRegionDiffPixels: result.nonTextRegionDiffPixels,
      ocrDurationMs: result.ocrDurationMs,
    },
  };
}

/**
 * Shift-aware diff: aligns images using LCS row matching, then runs pixelmatch
 * only on matched (non-shifted) rows. Produces a diff image that color-codes
 * insertions (green), deletions (red), and actual pixel changes (standard diff).
 */
async function generateShiftAwareDiff(
  baseline: PNG,
  current: PNG,
  outputDir: string,
  threshold: number,
  includeAntiAliasing: boolean,
  ignoreRegions?: Rectangle[],
  diffEngine: DiffEngineType = 'pixelmatch',
  regionDetectionMode: RegionDetectionMode = 'grid'
): Promise<DiffResult> {
  const width = baseline.width;

  // Blank out ignore regions before alignment hashing
  if (ignoreRegions && ignoreRegions.length > 0) {
    for (const region of ignoreRegions) {
      blankRegion(baseline.data, baseline.width, baseline.height, region);
      blankRegion(current.data, current.width, current.height, region);
    }
  }

  // Detect background colors before alignment (needed for blank-row fills)
  const baselineBg = detectBackgroundColor(baseline.data, baseline.width, baseline.height);
  const currentBg = detectBackgroundColor(current.data, current.width, current.height);

  // Align rows using LCS, then fuzzy-match nearby insert/delete pairs
  // whose pixels are similar (anti-aliasing, font rendering differences)
  const rawAlignment = alignRows(
    baseline.data, baseline.width, baseline.height,
    current.data, current.width, current.height
  );
  const alignment = fuzzyMatchUnalignedRows(
    rawAlignment, baseline.data, current.data, width, threshold, includeAntiAliasing
  );

  // Build aligned buffers with ALL rows (insert/delete filled with bg color)
  const { alignedBaseline, alignedCurrent, alignedHeight } = buildAlignedImages(
    baseline.data, current.data, width, alignment, baselineBg, currentBg
  );

  // Save aligned images for side-by-side shift comparison view
  const ts = Date.now();
  const alignedBaselinePng = new PNG({ width, height: alignedHeight });
  Buffer.from(alignedBaseline).copy(alignedBaselinePng.data as Buffer);
  const alignedBaselinePath = path.join(outputDir, `aligned-baseline-${ts}.png`);
  fs.writeFileSync(alignedBaselinePath, PNG.sync.write(alignedBaselinePng));

  const alignedCurrentPng = new PNG({ width, height: alignedHeight });
  Buffer.from(alignedCurrent).copy(alignedCurrentPng.data as Buffer);
  const alignedCurrentPath = path.join(outputDir, `aligned-current-${ts}.png`);
  fs.writeFileSync(alignedCurrentPath, PNG.sync.write(alignedCurrentPng));

  const alignmentSegments = compressOpsToSegments(alignment.ops);

  // Run diff engine on the full aligned images (for visual diff image only)
  let alignedDiffData: Buffer;

  if (alignedHeight > 0) {
    const alignedEngineResult = runDiffEngine(
      diffEngine,
      alignedBaseline,
      alignedCurrent,
      width,
      alignedHeight,
      threshold,
      includeAntiAliasing
    );
    alignedDiffData = Buffer.from(alignedEngineResult.diffData);
  } else {
    alignedDiffData = Buffer.alloc(0);
  }

  // Save aligned diff image for overlay in shift comparison view
  let alignedDiffPath: string | undefined;
  if (alignedHeight > 0) {
    const alignedDiffPng = new PNG({ width, height: alignedHeight });
    Buffer.from(alignedDiffData).copy(alignedDiffPng.data as Buffer);
    alignedDiffPath = path.join(outputDir, `aligned-diff-${ts}.png`);
    fs.writeFileSync(alignedDiffPath, PNG.sync.write(alignedDiffPng));
  }

  // Build the full shift-aware diff image
  const diffImage = buildShiftAwareDiffImage(
    baseline.data, current.data, alignedDiffData, width, alignment
  );

  const diffFileName = `diff-${Date.now()}.png`;
  const diffImagePath = path.join(outputDir, diffFileName);
  fs.writeFileSync(diffImagePath, PNG.sync.write(diffImage));

  // Count diff pixels only from matched rows (exclude insert/delete rows
  // which would compare content against background fill, inflating the percentage)
  let matchedRowDiffPixels = 0;
  for (let idx = 0; idx < alignment.ops.length; idx++) {
    if (alignment.ops[idx] !== 'match') continue;
    const bRow = alignment.baselineRows[idx];
    const cRow = alignment.currentRows[idx];
    if (bRow < 0 || cRow < 0) continue;
    const bStart = bRow * width * 4;
    const cStart = cRow * width * 4;
    const bSlice = baseline.data.subarray(bStart, bStart + width * 4);
    const cSlice = current.data.subarray(cStart, cStart + width * 4);
    const rowResult = runDiffEngine(diffEngine, Buffer.from(bSlice), Buffer.from(cSlice), width, 1, threshold, includeAntiAliasing);
    matchedRowDiffPixels += rowResult.diffPixelCount;
  }

  const baselineContent = calculateContentArea(baseline.data, baseline.width, baseline.height, baselineBg);
  const currentContent = calculateContentArea(current.data, current.width, current.height, currentBg);
  const contentArea = Math.max(baselineContent.contentPixels, currentContent.contentPixels, 1);
  const percentageDiff = Math.min((matchedRowDiffPixels / contentArea) * 100, 100);

  // Find changed regions from the full aligned diff
  const detectRegions = regionDetectionMode === 'flood-fill' ? findChangedRegionsFloodFill : findChangedRegions;
  const changedRegions = alignedHeight > 0
    ? detectRegions(alignedDiffData, width, alignedHeight)
    : [];

  const changeCategories = categorizeChanges(changedRegions, percentageDiff);
  const affectedComponents = detectAffectedComponents(changedRegions);

  // Compute dominant shift direction
  let dominantDeltaY = 0;
  if (alignment.insertedRows > 0 && alignment.deletedRows === 0) {
    dominantDeltaY = alignment.insertedRows;
  } else if (alignment.deletedRows > 0 && alignment.insertedRows === 0) {
    dominantDeltaY = -alignment.deletedRows;
  } else {
    dominantDeltaY = alignment.insertedRows - alignment.deletedRows;
  }

  const shiftDetected = alignment.insertedRows > 0 || alignment.deletedRows > 0;
  const confidence = shiftDetected
    ? Math.round((alignment.matchedRows / alignment.ops.length) * 100) / 100
    : 0;

  const pageShift: PageShiftInfo = {
    detected: shiftDetected,
    deltaY: dominantDeltaY,
    confidence,
    insertedRows: alignment.insertedRows,
    deletedRows: alignment.deletedRows,
    alignedBaselineImagePath: alignedBaselinePath,
    alignedCurrentImagePath: alignedCurrentPath,
    alignedDiffImagePath: alignedDiffPath,
    alignmentSegments,
  };

  return {
    pixelDifference: matchedRowDiffPixels,
    percentageDifference: Math.round(percentageDiff * 100) / 100,
    diffImagePath,
    metadata: {
      changedRegions,
      affectedComponents,
      changeCategories,
      pageShift,
    },
  };
}

/**
 * Compare and check if images are identical (for carry-forward)
 */
export function imagesMatch(path1: string, path2: string, threshold = 0.1): boolean {
  try {
    const img1 = PNG.sync.read(fs.readFileSync(path1));
    const img2 = PNG.sync.read(fs.readFileSync(path2));

    if (img1.width !== img2.width || img1.height !== img2.height) {
      return false;
    }

    // Create a dummy output buffer for pixelmatch
    const output = new Uint8Array(img1.width * img1.height * 4);
    const diffPixels = pixelmatch(
      img1.data,
      img2.data,
      output,
      img1.width,
      img1.height,
      { threshold }
    );

    return diffPixels === 0;
  } catch {
    return false;
  }
}

/**
 * Fill a rectangular region in an image buffer with a solid color (magenta).
 * Used to blank out ignore regions before diff comparison.
 */
function blankRegion(data: Buffer, imgWidth: number, imgHeight: number, region: Rectangle): void {
  const x0 = Math.max(0, region.x);
  const y0 = Math.max(0, region.y);
  const x1 = Math.min(imgWidth, region.x + region.width);
  const y1 = Math.min(imgHeight, region.y + region.height);

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const idx = (y * imgWidth + x) * 4;
      // Fill with magenta (same color in both images = zero diff)
      data[idx] = 255;     // R
      data[idx + 1] = 0;   // G
      data[idx + 2] = 255; // B
      data[idx + 3] = 255; // A
    }
  }
}

/**
 * Find rectangular regions of changes in the diff data
 */
/**
 * Find changed regions using a grid-based approach.
 * Divides image into cells, marks cells with enough diff pixels,
 * then groups adjacent cells into regions. This prevents sparse
 * scattered changes from merging into one giant region.
 */
function findChangedRegions(diffData: Buffer, width: number, height: number): Rectangle[] {
  const CELL_SIZE = 32; // Grid cell size in pixels
  const CELL_THRESHOLD = 0.05; // 5% of cell pixels must differ to mark cell as changed
  const GAP_TOLERANCE = 1; // Adjacent cells within this gap are grouped together

  const cellsX = Math.ceil(width / CELL_SIZE);
  const cellsY = Math.ceil(height / CELL_SIZE);

  // Count diff pixels per cell
  const cellCounts: number[][] = Array.from({ length: cellsY }, () => Array(cellsX).fill(0));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixelIndex = (y * width + x) * 4;
      const alpha = diffData[pixelIndex + 3];
      if (alpha > 0) {
        const cellX = Math.floor(x / CELL_SIZE);
        const cellY = Math.floor(y / CELL_SIZE);
        cellCounts[cellY][cellX]++;
      }
    }
  }

  // Mark cells as changed if they exceed threshold
  const changedCells: boolean[][] = cellCounts.map((row, cy) =>
    row.map((count, cx) => {
      const cellWidth = Math.min(CELL_SIZE, width - cx * CELL_SIZE);
      const cellHeight = Math.min(CELL_SIZE, height - cy * CELL_SIZE);
      const cellPixels = cellWidth * cellHeight;
      return count / cellPixels >= CELL_THRESHOLD;
    })
  );

  // Group adjacent changed cells into regions using flood fill on the grid
  const visited = new Set<string>();
  const regions: Rectangle[] = [];

  for (let cy = 0; cy < cellsY; cy++) {
    for (let cx = 0; cx < cellsX; cx++) {
      if (!changedCells[cy][cx] || visited.has(`${cx},${cy}`)) continue;

      // Flood fill on grid cells with gap tolerance
      const stack = [{ cx, cy }];
      let minCX = cx, maxCX = cx, minCY = cy, maxCY = cy;

      while (stack.length > 0) {
        const { cx: x, cy: y } = stack.pop()!;
        const key = `${x},${y}`;

        if (visited.has(key)) continue;
        if (x < 0 || x >= cellsX || y < 0 || y >= cellsY) continue;
        if (!changedCells[y][x]) continue;

        visited.add(key);
        minCX = Math.min(minCX, x);
        maxCX = Math.max(maxCX, x);
        minCY = Math.min(minCY, y);
        maxCY = Math.max(maxCY, y);

        // Check neighbors within gap tolerance
        for (let dy = -GAP_TOLERANCE - 1; dy <= GAP_TOLERANCE + 1; dy++) {
          for (let dx = -GAP_TOLERANCE - 1; dx <= GAP_TOLERANCE + 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            stack.push({ cx: x + dx, cy: y + dy });
          }
        }
      }

      // Convert cell coordinates back to pixel coordinates
      const region: Rectangle = {
        x: minCX * CELL_SIZE,
        y: minCY * CELL_SIZE,
        width: Math.min((maxCX + 1) * CELL_SIZE, width) - minCX * CELL_SIZE,
        height: Math.min((maxCY + 1) * CELL_SIZE, height) - minCY * CELL_SIZE,
      };

      // Only include regions larger than minimum size
      if (region.width > 10 && region.height > 10) {
        regions.push(region);
      }
    }
  }

  return regions;
}

/**
 * Find changed regions using pixel-level flood-fill with two-pass
 * connected component labeling (8-connectivity) and union-find.
 * Produces tighter bounding boxes than the grid-based approach.
 */
const MIN_FLOOD_REGION_PIXELS = 25;
const MIN_FLOOD_REGION_DIMENSION = 3;

function findChangedRegionsFloodFill(diffData: Buffer, width: number, height: number): Rectangle[] {
  const totalPixels = width * height;
  const labels = new Int32Array(totalPixels); // 0 = unlabeled
  let nextLabel = 1;

  // Union-Find with path compression and union by rank
  const parent = new Int32Array(totalPixels + 1); // over-allocate; labels are 1-based
  const rank = new Uint8Array(totalPixels + 1);

  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]]; // path halving
      x = parent[x];
    }
    return x;
  }

  function union(a: number, b: number): void {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    if (rank[ra] < rank[rb]) { parent[ra] = rb; }
    else if (rank[ra] > rank[rb]) { parent[rb] = ra; }
    else { parent[rb] = ra; rank[ra]++; }
  }

  // Pass 1: Scan L→R, T→B. For each diff pixel (alpha > 0), check 4 already-visited neighbors.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const alpha = diffData[idx * 4 + 3];
      if (alpha === 0) continue;

      // Neighbors already visited: top-left, top, top-right, left
      const neighbors: number[] = [];
      if (y > 0 && x > 0)          { const n = (y - 1) * width + (x - 1); if (labels[n]) neighbors.push(labels[n]); }
      if (y > 0)                     { const n = (y - 1) * width + x;       if (labels[n]) neighbors.push(labels[n]); }
      if (y > 0 && x < width - 1)  { const n = (y - 1) * width + (x + 1); if (labels[n]) neighbors.push(labels[n]); }
      if (x > 0)                     { const n = y * width + (x - 1);       if (labels[n]) neighbors.push(labels[n]); }

      if (neighbors.length === 0) {
        // New component
        const lbl = nextLabel++;
        labels[idx] = lbl;
        parent[lbl] = lbl;
        rank[lbl] = 0;
      } else {
        // Use the minimum label, union the rest
        let minLabel = neighbors[0];
        for (let i = 1; i < neighbors.length; i++) {
          if (neighbors[i] < minLabel) minLabel = neighbors[i];
        }
        labels[idx] = minLabel;
        for (let i = 0; i < neighbors.length; i++) {
          if (neighbors[i] !== minLabel) {
            union(minLabel, neighbors[i]);
          }
        }
      }
    }
  }

  // Pass 2: Resolve labels to canonical roots, accumulate bounding boxes per component
  const bboxMap = new Map<number, { minX: number; minY: number; maxX: number; maxY: number; count: number }>();

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const lbl = labels[idx];
      if (lbl === 0) continue;

      const root = find(lbl);
      labels[idx] = root; // flatten for consistency

      const box = bboxMap.get(root);
      if (box) {
        if (x < box.minX) box.minX = x;
        if (x > box.maxX) box.maxX = x;
        if (y < box.minY) box.minY = y;
        if (y > box.maxY) box.maxY = y;
        box.count++;
      } else {
        bboxMap.set(root, { minX: x, minY: y, maxX: x, maxY: y, count: 1 });
      }
    }
  }

  // Convert to Rectangle[], filtering small regions
  const regions: Rectangle[] = [];
  for (const box of bboxMap.values()) {
    const w = box.maxX - box.minX + 1;
    const h = box.maxY - box.minY + 1;
    if (box.count < MIN_FLOOD_REGION_PIXELS || w < MIN_FLOOD_REGION_DIMENSION || h < MIN_FLOOD_REGION_DIMENSION) {
      continue;
    }
    regions.push({ x: box.minX, y: box.minY, width: w, height: h });
  }

  return regions;
}

/**
 * Categorize changes based on characteristics
 */
function categorizeChanges(regions: Rectangle[], percentageDifference: number): DiffMetadata['changeCategories'] {
  const categories: DiffMetadata['changeCategories'] = [];

  if (percentageDifference > 5) categories.push('layout');
  if (regions.some(r => r.width > 100 || r.height > 100)) categories.push('layout');
  if (regions.some(r => r.width < 20 && r.height < 20)) categories.push('style');

  if (categories.length === 0) categories.push('style');

  return categories;
}

/**
 * Detect affected components based on region positions
 */
function detectAffectedComponents(regions: Rectangle[]): string[] {
  const components: string[] = [];

  regions.forEach(region => {
    const regionBottom = region.y + region.height;
    const regionRight = region.x + region.width;

    // Full page or main content (large regions)
    if (region.width > 800 || region.height > 400) {
      components.push('main-content');
      return;
    }

    // Sidebar (left or right edge, tall)
    if ((region.x < 50 || regionRight > 1200) && region.height > 200) {
      components.push('sidebar');
      return;
    }

    // Header (top 100px, doesn't extend far down)
    if (region.y < 100 && regionBottom < 150) {
      components.push('header');
      return;
    }

    // Footer (bottom area)
    if (region.y > 500) {
      components.push('footer');
      return;
    }

    // Button (small regions)
    if (region.width < 100 && region.height < 50) {
      components.push('button');
      return;
    }

    // Default
    components.push('content');
  });

  return Array.from(new Set(components));
}

/**
 * Detect page shift by analyzing vertical displacement of changed regions.
 * If multiple regions show the same vertical shift, it's likely a page-level shift
 * (e.g., banner added/removed, content insertion).
 */
export function detectPageShift(regions: Rectangle[]): PageShiftInfo | undefined {
  if (regions.length < 2) {
    return undefined;
  }

  // Calculate centroids for each region
  const centroids: RegionCentroid[] = regions.map(r => ({
    x: r.x + r.width / 2,
    y: r.y + r.height / 2,
    region: r,
  }));

  // Analyze vertical shifts between regions
  // If most regions are at similar Y positions but shifted, it's a page shift
  const yPositions = centroids.map(c => c.y).sort((a, b) => a - b);

  // Group regions by their Y position (with tolerance)
  const yGroups = new Map<number, number>();
  const tolerance = 50; // pixels

  for (const y of yPositions) {
    let foundGroup = false;
    for (const [groupY, count] of yGroups) {
      if (Math.abs(y - groupY) <= tolerance) {
        yGroups.set(groupY, count + 1);
        foundGroup = true;
        break;
      }
    }
    if (!foundGroup) {
      yGroups.set(y, 1);
    }
  }

  // If we have exactly 2 major Y groups, compute the shift
  const significantGroups = Array.from(yGroups.entries())
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1]);

  if (significantGroups.length >= 2) {
    const [y1] = significantGroups[0];
    const [y2] = significantGroups[1];
    const deltaY = Math.round(Math.abs(y1 - y2));

    // Page shift detected if delta is significant and consistent
    if (deltaY > 20) {
      const confidence = Math.min(
        (significantGroups[0][1] + significantGroups[1][1]) / regions.length,
        1
      );

      return {
        detected: true,
        deltaY: y1 > y2 ? deltaY : -deltaY,
        confidence: Math.round(confidence * 100) / 100,
      };
    }
  }

  // Check for uniform vertical shift across most regions
  // This handles cases where content shifted down/up uniformly
  if (regions.length >= 3) {
    const heights = regions.map(r => r.y);
    const avgY = heights.reduce((a, b) => a + b, 0) / heights.length;

    // Check if regions cluster in bottom half (content pushed down)
    const bottomCount = heights.filter(y => y > avgY).length;
    const topCount = heights.filter(y => y <= avgY).length;

    if (bottomCount >= regions.length * 0.7 || topCount >= regions.length * 0.7) {
      // Estimate shift from region distribution
      const minY = Math.min(...heights);
      const maxY = Math.max(...heights);

      if (maxY - minY > 100) {
        return {
          detected: true,
          deltaY: bottomCount > topCount ? Math.round(avgY) : -Math.round(avgY),
          confidence: 0.6,
        };
      }
    }
  }

  return undefined;
}
