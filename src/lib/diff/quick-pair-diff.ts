import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

export interface QuickPairDiffResult {
  pixelDifference: number;
  percentageDifference: number;
  // null when the two PNGs are byte-identical — there's nothing to render.
  diffImagePath: string | null;
  cached: boolean;
}

function sha256File(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

// Pad shorter image to target height with opaque white. Faster than the
// detect-background-color path in generateDiff — pixelmatch will simply
// flag the padding region as changed, which is the truth (one side has
// no content there).
function padToHeightWhite(img: PNG, targetHeight: number): PNG {
  if (img.height >= targetHeight) return img;
  const padded = new PNG({ width: img.width, height: targetHeight });
  (padded.data as Buffer).fill(0xff);
  (img.data as Buffer).copy(padded.data as Buffer, 0, 0, img.data.length);
  return padded;
}

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
 * Lightweight pixel diff for run-vs-run comparison.
 *
 * Optimised for the compare-runs page which only needs `{ diffPath, pct }` —
 * no changedRegions / contentArea / background detection like generateDiff.
 *
 * Two layers of short-circuit make repeat visits effectively free:
 *   1. If the input files are byte-identical (sha256 match) we return
 *      `pixelDifference: 0` without decoding either PNG.
 *   2. Otherwise the diff PNG is keyed by both file hashes and cached on
 *      disk alongside a `<key>.json` sidecar with the pct/count, so the
 *      same input pair is decoded + diffed at most once across all visits.
 */
export async function quickPairDiff(
  baselinePath: string,
  currentPath: string,
  outputDir: string,
): Promise<QuickPairDiffResult> {
  const hashA = sha256File(baselinePath);
  const hashB = sha256File(currentPath);

  if (hashA === hashB) {
    return { pixelDifference: 0, percentageDifference: 0, diffImagePath: null, cached: true };
  }

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const cacheKey = `${hashA.slice(0, 16)}-${hashB.slice(0, 16)}`;
  const diffPath = path.join(outputDir, `compare-${cacheKey}.png`);
  const metaPath = path.join(outputDir, `compare-${cacheKey}.json`);

  if (fs.existsSync(diffPath) && fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as {
        pixelDifference: number;
        percentageDifference: number;
      };
      return {
        pixelDifference: meta.pixelDifference,
        percentageDifference: meta.percentageDifference,
        diffImagePath: diffPath,
        cached: true,
      };
    } catch {
      // Corrupt sidecar — fall through and recompute.
    }
  }

  let baseline: PNG = PNG.sync.read(fs.readFileSync(baselinePath));
  let current: PNG = PNG.sync.read(fs.readFileSync(currentPath));

  const minWidth = Math.min(baseline.width, current.width);
  if (baseline.width !== current.width) {
    baseline = cropToWidth(baseline, minWidth);
    current = cropToWidth(current, minWidth);
  }

  if (baseline.height !== current.height) {
    const max = Math.max(baseline.height, current.height);
    if (baseline.height < max) baseline = padToHeightWhite(baseline, max);
    if (current.height < max) current = padToHeightWhite(current, max);
  }

  const { width, height } = baseline;
  const diff = new PNG({ width, height });
  const pixelDifference = pixelmatch(
    baseline.data,
    current.data,
    diff.data,
    width,
    height,
    { threshold: 0.1, includeAA: false },
  );
  const percentageDifference = (pixelDifference / (width * height)) * 100;

  fs.writeFileSync(diffPath, PNG.sync.write(diff));
  fs.writeFileSync(metaPath, JSON.stringify({ pixelDifference, percentageDifference }));

  return { pixelDifference, percentageDifference, diffImagePath: diffPath, cached: false };
}
