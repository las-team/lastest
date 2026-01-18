import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import fs from 'fs';
import path from 'path';

export interface DiffResult {
  baseline: string;
  current: string;
  diff: string;
  pixelDiff: number;
  percentDiff: number;
  width: number;
  height: number;
  match: boolean;
}

export async function compareImages(
  baselinePath: string,
  currentPath: string,
  outputPath: string,
  threshold: number = 0.1
): Promise<DiffResult> {
  // Read images
  const baselineData = fs.readFileSync(baselinePath);
  const currentData = fs.readFileSync(currentPath);

  const baseline = PNG.sync.read(baselineData);
  const current = PNG.sync.read(currentData);

  // Ensure same dimensions
  const width = Math.max(baseline.width, current.width);
  const height = Math.max(baseline.height, current.height);

  // Resize if needed (pad with transparent pixels)
  const baselineResized = resizeImage(baseline, width, height);
  const currentResized = resizeImage(current, width, height);

  // Create diff image
  const diff = new PNG({ width, height });

  // Run pixelmatch
  const pixelDiff = pixelmatch(
    baselineResized.data,
    currentResized.data,
    diff.data,
    width,
    height,
    { threshold }
  );

  // Calculate percentage
  const totalPixels = width * height;
  const percentDiff = (pixelDiff / totalPixels) * 100;

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Write diff image
  fs.writeFileSync(outputPath, PNG.sync.write(diff));

  return {
    baseline: baselinePath,
    current: currentPath,
    diff: outputPath,
    pixelDiff,
    percentDiff: Math.round(percentDiff * 100) / 100,
    width,
    height,
    match: percentDiff < threshold * 100,
  };
}

function resizeImage(img: PNG, width: number, height: number): PNG {
  if (img.width === width && img.height === height) {
    return img;
  }

  const resized = new PNG({ width, height, fill: true });

  // Copy original image data
  PNG.bitblt(img, resized, 0, 0, img.width, img.height, 0, 0);

  return resized;
}

export async function compareScreenshots(
  baselineDir: string,
  currentDir: string,
  outputDir: string
): Promise<DiffResult[]> {
  const results: DiffResult[] = [];

  // Get all screenshots from baseline
  const baselineFiles = fs.readdirSync(baselineDir).filter(f => f.endsWith('.png'));

  for (const file of baselineFiles) {
    const baselinePath = path.join(baselineDir, file);
    const currentPath = path.join(currentDir, file);
    const diffPath = path.join(outputDir, `diff-${file}`);

    if (fs.existsSync(currentPath)) {
      const result = await compareImages(baselinePath, currentPath, diffPath);
      results.push(result);
    }
  }

  return results;
}

export interface ComparisonSummary {
  total: number;
  matching: number;
  different: number;
  results: DiffResult[];
}

export function summarizeComparison(results: DiffResult[]): ComparisonSummary {
  const matching = results.filter(r => r.match).length;

  return {
    total: results.length,
    matching,
    different: results.length - matching,
    results,
  };
}
