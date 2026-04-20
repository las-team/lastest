import fs from 'fs/promises';
import path from 'path';
import { PNG } from 'pngjs';
import { STORAGE_DIRS, resolveStoragePath } from '@/lib/storage/paths';

const SAMPLE_GRID = 16;
const WHITE_THRESHOLD = 0.99;

async function resolveImagePath(imagePath: string): Promise<string | null> {
  if (path.isAbsolute(imagePath)) {
    try { await fs.access(imagePath); return imagePath; } catch { return null; }
  }
  const viaStorage = resolveStoragePath(imagePath);
  if (viaStorage) {
    try { await fs.access(viaStorage); return viaStorage; } catch { /* fall through */ }
  }
  // Last resort: screenshot filename only
  const fallback = path.join(STORAGE_DIRS.screenshots, path.basename(imagePath));
  try { await fs.access(fallback); return fallback; } catch { return null; }
}

/**
 * Heuristic: returns true when the PNG is nearly all-white (or transparent).
 * Samples a sparse 16×16 grid so cost stays O(256) regardless of image size.
 * Used to catch blank screenshots caused by navigation racing screenshot capture.
 */
export async function isScreenshotBlankWhite(imagePath: string): Promise<boolean> {
  const absPath = await resolveImagePath(imagePath);
  if (!absPath) return false;

  let png: PNG;
  try {
    const buf = await fs.readFile(absPath);
    png = PNG.sync.read(buf);
  } catch {
    return false;
  }

  const { width, height, data } = png;
  if (width < 8 || height < 8) return false;

  const stepX = Math.max(1, Math.floor(width / SAMPLE_GRID));
  const stepY = Math.max(1, Math.floor(height / SAMPLE_GRID));
  let sampled = 0;
  let whitish = 0;

  for (let y = Math.floor(stepY / 2); y < height; y += stepY) {
    for (let x = Math.floor(stepX / 2); x < width; x += stepX) {
      const idx = (y * width + x) * 4;
      const r = data[idx]!;
      const g = data[idx + 1]!;
      const b = data[idx + 2]!;
      const a = data[idx + 3]!;
      sampled++;
      const transparentOrWhite = a === 0 || (r >= 250 && g >= 250 && b >= 250);
      if (transparentOrWhite) whitish++;
    }
  }

  if (sampled === 0) return false;
  return whitish / sampled >= WHITE_THRESHOLD;
}
