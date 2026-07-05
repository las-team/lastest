/**
 * Cluster the changed pixels between two screenshots into a small set of
 * bounding boxes. Used by the QuickStart demo flow (spec §2.5): after baseline
 * approval, the regions of run-to-run churn (animated heroes, rotating
 * testimonials, live charts, timestamps) are persisted as baseline ignore
 * regions so the pairing rerun diffs clean — the demo share's chips/hero become
 * honest without presentation-layer special-casing, and the founder inherits a
 * stable baseline.
 *
 * Deliberately conservative: a cluster that covers most of the page is a REAL
 * change, not noise, and is never masked; if masks would cover most of the page
 * we bail entirely (better to leave the noise than blind the whole baseline).
 */
import { PNG } from "pngjs";

export interface ClusterRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Coarse grid cell size (px). We cluster at cell resolution, not per-pixel, so
// connected-components stays cheap even on tall full-page screenshots.
const CELL = 8;
// Per-channel abs difference for a pixel to count as "changed".
const CHANNEL_DELTA = 32;
// Clusters smaller than this many cells are speckle — ignored.
const MIN_CELLS = 4;
// A single cluster larger than this fraction of the page is a real change.
const MAX_CLUSTER_AREA_FRAC = 0.5;
// If total masked area would exceed this fraction, don't mask at all.
const MAX_TOTAL_AREA_FRAC = 0.6;
const MAX_REGIONS = 12;

/**
 * Cluster the changed pixels between two equal-sized PNG buffers. Returns [] on
 * a size mismatch (a dimension change is itself a real change, not maskable
 * noise) or a parse failure.
 */
export function computeDiffClusters(
  baselinePng: Buffer,
  currentPng: Buffer,
): ClusterRegion[] {
  let b: PNG;
  let c: PNG;
  try {
    b = PNG.sync.read(baselinePng);
    c = PNG.sync.read(currentPng);
  } catch {
    return [];
  }
  if (b.width !== c.width || b.height !== c.height) return [];
  const W = b.width;
  const H = b.height;
  if (W === 0 || H === 0) return [];

  const cols = Math.ceil(W / CELL);
  const rows = Math.ceil(H / CELL);
  const changed = new Uint8Array(cols * rows);

  for (let y = 0; y < H; y++) {
    const rowCell = Math.floor(y / CELL) * cols;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (
        Math.abs(b.data[i] - c.data[i]) > CHANNEL_DELTA ||
        Math.abs(b.data[i + 1] - c.data[i + 1]) > CHANNEL_DELTA ||
        Math.abs(b.data[i + 2] - c.data[i + 2]) > CHANNEL_DELTA
      ) {
        changed[rowCell + Math.floor(x / CELL)] = 1;
      }
    }
  }

  // Connected components (8-connectivity) over changed cells, BFS with an
  // explicit stack. Track each component's cell bounding box + cell count.
  const seen = new Uint8Array(cols * rows);
  const stack: number[] = [];
  const raw: Array<{
    minC: number;
    minR: number;
    maxC: number;
    maxR: number;
    cells: number;
  }> = [];

  for (let start = 0; start < changed.length; start++) {
    if (!changed[start] || seen[start]) continue;
    seen[start] = 1;
    stack.length = 0;
    stack.push(start);
    let minC = cols;
    let minR = rows;
    let maxC = 0;
    let maxR = 0;
    let cells = 0;
    while (stack.length) {
      const idx = stack.pop()!;
      const cx = idx % cols;
      const cy = (idx - cx) / cols;
      cells++;
      if (cx < minC) minC = cx;
      if (cx > maxC) maxC = cx;
      if (cy < minR) minR = cy;
      if (cy > maxR) maxR = cy;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const nIdx = ny * cols + nx;
          if (changed[nIdx] && !seen[nIdx]) {
            seen[nIdx] = 1;
            stack.push(nIdx);
          }
        }
      }
    }
    if (cells >= MIN_CELLS) raw.push({ minC, minR, maxC, maxR, cells });
  }

  const pageArea = W * H;
  const regions: ClusterRegion[] = [];
  for (const r of raw) {
    // Pad by one cell and clamp to the frame.
    const x = Math.max(0, (r.minC - 1) * CELL);
    const y = Math.max(0, (r.minR - 1) * CELL);
    const width = Math.min(W - x, (r.maxC - r.minC + 3) * CELL);
    const height = Math.min(H - y, (r.maxR - r.minR + 3) * CELL);
    if (width <= 0 || height <= 0) continue;
    if ((width * height) / pageArea > MAX_CLUSTER_AREA_FRAC) continue;
    regions.push({ x, y, width, height });
  }

  // Largest first, capped.
  regions.sort((a, z) => z.width * z.height - a.width * a.height);
  const capped = regions.slice(0, MAX_REGIONS);

  const totalArea = capped.reduce((s, r) => s + r.width * r.height, 0);
  if (totalArea / pageArea > MAX_TOTAL_AREA_FRAC) return [];

  return capped;
}
