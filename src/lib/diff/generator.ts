import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import type { DiffMetadata, PageShiftInfo } from '../db/schema';

interface Rectangle {
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
 * Compare two PNG images and generate a diff image
 */
export async function generateDiff(
  baselinePath: string,
  currentPath: string,
  outputDir: string,
  threshold = 0.1,
  includeAntiAliasing = false
): Promise<DiffResult> {
  const baseline = PNG.sync.read(fs.readFileSync(baselinePath));
  const current = PNG.sync.read(fs.readFileSync(currentPath));

  const { width, height } = baseline;

  // Handle size mismatch - resize to baseline dimensions
  if (width !== current.width || height !== current.height) {
    throw new Error(`Image dimensions mismatch: baseline ${width}x${height}, current ${current.width}x${current.height}`);
  }

  const diff = new PNG({ width, height });

  const numDiffPixels = pixelmatch(
    baseline.data,
    current.data,
    diff.data,
    width,
    height,
    { threshold, includeAA: includeAntiAliasing }
  );

  // Save diff image
  const diffFileName = `diff-${Date.now()}.png`;
  const diffImagePath = path.join(outputDir, diffFileName);

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(diffImagePath, PNG.sync.write(diff));

  // Calculate metadata
  const changedRegions = findChangedRegions(diff.data, width, height);

  // Calculate content-aware percentage:
  // Instead of dividing by total pixels (which includes empty background),
  // divide by the union of content areas from both images
  const baselineBg = detectBackgroundColor(baseline.data, width, height);
  const currentBg = detectBackgroundColor(current.data, width, height);

  const baselineContent = calculateContentArea(baseline.data, width, height, baselineBg);
  const currentContent = calculateContentArea(current.data, width, height, currentBg);

  // Use the larger content area as the denominator for a more meaningful percentage
  const contentArea = Math.max(
    baselineContent.contentPixels,
    currentContent.contentPixels,
    1 // prevent division by zero
  );

  // Calculate percentage based on content area, not total image
  const contentPercentage = (numDiffPixels / contentArea) * 100;
  // Cap at 100% since diff pixels can exceed content area when images are very different
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
        excludedFromDiff: false,
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
          excludedFromDiff: false,
        };
      }
    }
  }

  return undefined;
}
