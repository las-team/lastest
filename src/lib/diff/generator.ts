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
  const totalPixels = width * height;
  const percentageDifference = (numDiffPixels / totalPixels) * 100;
  const changedRegions = findChangedRegions(diff.data, width, height);
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
function findChangedRegions(diffData: Buffer, width: number, height: number): Rectangle[] {
  const regions: Rectangle[] = [];
  const visited = new Set<string>();

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const key = `${x},${y}`;
      if (visited.has(key)) continue;

      const pixelIndex = (y * width + x) * 4;
      const alpha = diffData[pixelIndex + 3];

      if (alpha > 0) {
        const region = floodFillRegion(diffData, width, height, x, y, visited);
        if (region.width > 5 && region.height > 5) {
          regions.push(region);
        }
      }
    }
  }

  return regions;
}

/**
 * Flood fill to find connected diff region
 */
function floodFillRegion(
  diffData: Buffer,
  width: number,
  height: number,
  startX: number,
  startY: number,
  visited: Set<string>
): Rectangle {
  const stack = [{ x: startX, y: startY }];
  let minX = startX, maxX = startX, minY = startY, maxY = startY;

  while (stack.length > 0) {
    const { x, y } = stack.pop()!;
    const key = `${x},${y}`;

    if (visited.has(key) || x < 0 || x >= width || y < 0 || y >= height) continue;

    const pixelIndex = (y * width + x) * 4;
    const alpha = diffData[pixelIndex + 3];

    if (alpha === 0) continue;

    visited.add(key);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);

    stack.push({ x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 });
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
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
    if (region.y < 100) {
      components.push('header');
    } else if (region.y > 500) {
      components.push('footer');
    } else if (region.width > 200) {
      components.push('main-content');
    } else if (region.width < 100 && region.height < 50) {
      components.push('button');
    } else {
      components.push('content');
    }
  });

  return Array.from(new Set(components));
}

/**
 * Detect page shift by analyzing vertical displacement of changed regions.
 * If multiple regions show the same vertical shift, it's likely a page-level shift
 * (e.g., banner added/removed, content insertion).
 */
function detectPageShift(regions: Rectangle[]): PageShiftInfo | undefined {
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
