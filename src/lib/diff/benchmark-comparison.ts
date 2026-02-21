/**
 * Diff Engine Benchmark Comparison
 *
 * Standalone benchmark harness that generates synthetic test images procedurally,
 * runs them through all 3 diff engines (pixelmatch, ssim, butteraugli) and
 * optionally with text-aware diffing, then outputs comparison tables.
 *
 * Usage:
 *   pnpm tsx src/lib/diff/benchmark-comparison.ts
 */

import { runDiffEngine, type DiffEngineType, type EngineResult } from './engines';
import { generateTextAwareDiff, type TextAwareDiffOptions } from './text-regions';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ScenarioDefinition {
  name: string;
  description: string;
  width: number;
  height: number;
  /** Build a "baseline" image buffer (RGBA) */
  buildBaseline: (width: number, height: number) => Buffer;
  /** Build a "current" image buffer (RGBA) that differs from baseline */
  buildCurrent: (width: number, height: number) => Buffer;
  /** Whether this scenario is expected to have zero diff */
  expectZeroDiff?: boolean;
  /** Whether this scenario should use text-aware diffing */
  textAware?: boolean;
}

interface ComparisonRow {
  Scenario: string;
  Engine: string;
  'Diff Pixels': number;
  '% Diff': string;
  'Time (ms)': number;
}

interface DetailRow {
  Scenario: string;
  Engine: string;
  'Text Diff Px': number | string;
  'Non-Text Diff Px': number | string;
  'OCR Regions': number | string;
  'OCR Time (ms)': number | string;
}

interface SummaryRow {
  Engine: string;
  'Avg Diff %': string;
  'Avg Time (ms)': string;
  'Max Diff %': string;
  'Min Diff %': string;
  'Scenarios Run': number;
  'Zero-Diff Pass': string;
}

// ---------------------------------------------------------------------------
// Image manipulation helpers
// ---------------------------------------------------------------------------

/**
 * Add sub-pixel jitter simulating font rendering differences.
 * Uses a sine-based function to offset edge pixels by small amounts.
 */
function addSubPixelJitter(
  data: Buffer,
  width: number,
  height: number,
  amount: number
): void {
  // Work on a copy of the data so we read original values
  const original = Buffer.from(data);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;

      // Detect edges: pixels that differ significantly from their neighbors
      const isEdge = _isEdgePixel(original, width, height, x, y);
      if (!isEdge) continue;

      // Sine-based jitter offset
      const phase = (x * 0.7 + y * 1.3) * 0.1;
      const jitterX = Math.round(Math.sin(phase) * (amount / 255) * 2);
      const jitterY = Math.round(Math.cos(phase * 0.8) * (amount / 255) * 2);

      const srcX = Math.min(Math.max(x + jitterX, 0), width - 1);
      const srcY = Math.min(Math.max(y + jitterY, 0), height - 1);
      const srcIdx = (srcY * width + srcX) * 4;

      // Blend original and shifted pixel
      const blend = Math.min(amount, 255) / 255;
      data[idx] = Math.round(original[idx] * (1 - blend) + original[srcIdx] * blend);
      data[idx + 1] = Math.round(original[idx + 1] * (1 - blend) + original[srcIdx + 1] * blend);
      data[idx + 2] = Math.round(original[idx + 2] * (1 - blend) + original[srcIdx + 2] * blend);
      // Alpha stays the same
    }
  }
}

/**
 * Check if a pixel is an edge pixel by comparing with its neighbors.
 */
function _isEdgePixel(
  data: Buffer,
  width: number,
  height: number,
  x: number,
  y: number
): boolean {
  const idx = (y * width + x) * 4;
  const r = data[idx];
  const g = data[idx + 1];
  const b = data[idx + 2];

  const neighbors = [
    [-1, 0], [1, 0], [0, -1], [0, 1],
  ];

  for (const [dx, dy] of neighbors) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

    const nIdx = (ny * width + nx) * 4;
    const dr = Math.abs(r - data[nIdx]);
    const dg = Math.abs(g - data[nIdx + 1]);
    const db = Math.abs(b - data[nIdx + 2]);

    if (dr + dg + db > 60) return true;
  }

  return false;
}

/**
 * Shift RGB values in a rectangular region of the image.
 */
function shiftRegionColor(
  data: Buffer,
  width: number,
  height: number,
  rect: Rect,
  rShift: number,
  gShift: number,
  bShift: number
): void {
  const x0 = Math.max(0, rect.x);
  const y0 = Math.max(0, rect.y);
  const x1 = Math.min(width, rect.x + rect.width);
  const y1 = Math.min(height, rect.y + rect.height);

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const idx = (y * width + x) * 4;
      data[idx] = clamp(data[idx] + rShift, 0, 255);
      data[idx + 1] = clamp(data[idx + 1] + gShift, 0, 255);
      data[idx + 2] = clamp(data[idx + 2] + bShift, 0, 255);
    }
  }
}

/**
 * Translate image content by (dx, dy) pixels, filling exposed area with
 * the background color (sampled from top-left corner).
 */
function shiftImage(
  data: Buffer,
  width: number,
  height: number,
  dx: number,
  dy: number
): void {
  const original = Buffer.from(data);

  // Sample background color from the origin pixel
  const bgR = original[0];
  const bgG = original[1];
  const bgB = original[2];
  const bgA = original[3];

  // Fill everything with background first
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = bgR;
    data[i * 4 + 1] = bgG;
    data[i * 4 + 2] = bgB;
    data[i * 4 + 3] = bgA;
  }

  // Copy shifted content
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcX = x - dx;
      const srcY = y - dy;
      if (srcX < 0 || srcX >= width || srcY < 0 || srcY >= height) continue;

      const destIdx = (y * width + x) * 4;
      const srcIdx = (srcY * width + srcX) * 4;
      data[destIdx] = original[srcIdx];
      data[destIdx + 1] = original[srcIdx + 1];
      data[destIdx + 2] = original[srcIdx + 2];
      data[destIdx + 3] = original[srcIdx + 3];
    }
  }
}

/**
 * Add anti-aliasing fringe rendering differences.
 * Simulates how different renderers produce slightly different AA on edges.
 */
function addAAFringe(
  data: Buffer,
  width: number,
  height: number,
  amount: number
): void {
  const original = Buffer.from(data);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4;

      // Check if pixel is near a luminance edge
      const lum = _luminance(original[idx], original[idx + 1], original[idx + 2]);
      const lumRight = _luminance(
        original[idx + 4], original[idx + 5], original[idx + 6]
      );
      const lumBelow = _luminance(
        original[(idx + width * 4)], original[(idx + width * 4) + 1], original[(idx + width * 4) + 2]
      );

      const edgeH = Math.abs(lum - lumRight);
      const edgeV = Math.abs(lum - lumBelow);

      if (edgeH > 20 || edgeV > 20) {
        // Add a small AA fringe: blend toward gray
        const fringeStrength = (amount / 255) * 0.5;
        const grayTarget = 128;
        data[idx] = Math.round(original[idx] * (1 - fringeStrength) + grayTarget * fringeStrength);
        data[idx + 1] = Math.round(original[idx + 1] * (1 - fringeStrength) + grayTarget * fringeStrength);
        data[idx + 2] = Math.round(original[idx + 2] * (1 - fringeStrength) + grayTarget * fringeStrength);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function _luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// ---------------------------------------------------------------------------
// Procedural image generators
// ---------------------------------------------------------------------------

/**
 * Create a solid color image buffer.
 */
function makeSolidImage(
  width: number,
  height: number,
  r: number,
  g: number,
  b: number,
  a = 255
): Buffer {
  const buf = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    buf[i * 4] = r;
    buf[i * 4 + 1] = g;
    buf[i * 4 + 2] = b;
    buf[i * 4 + 3] = a;
  }
  return buf;
}

/**
 * Create a "UI-like" image with header, sidebar, content area, and footer.
 * Uses simple rectangles and color blocks to simulate a dashboard layout.
 */
function makeUIImage(width: number, height: number): Buffer {
  const buf = makeSolidImage(width, height, 245, 245, 245); // light gray bg

  // Header bar — dark blue
  fillRect(buf, width, 0, 0, width, 60, 30, 60, 120);

  // Sidebar — medium gray
  fillRect(buf, width, 0, 60, 220, height - 60 - 50, 200, 200, 210);

  // Content area — white
  fillRect(buf, width, 230, 70, width - 240, height - 70 - 60, 255, 255, 255);

  // Content blocks (simulating cards)
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 2; col++) {
      const cx = 240 + col * ((width - 260) / 2) + 5;
      const cy = 80 + row * 130;
      fillRect(buf, width, cx, cy, (width - 280) / 2, 120, 250, 250, 255);

      // Card header stripe
      fillRect(buf, width, cx, cy, (width - 280) / 2, 8, 80, 130, 200);

      // Text-like lines inside cards
      for (let line = 0; line < 4; line++) {
        const lineWidth = 100 + (line * 37) % 80;
        fillRect(buf, width, cx + 10, cy + 20 + line * 22, lineWidth, 10, 60, 60, 60);
      }
    }
  }

  // Footer
  fillRect(buf, width, 0, height - 50, width, 50, 50, 50, 70);

  // Navigation items in sidebar
  for (let i = 0; i < 6; i++) {
    const active = i === 1;
    fillRect(
      buf, width,
      10, 80 + i * 45, 200, 35,
      active ? 70 : 210, active ? 120 : 210, active ? 190 : 220
    );
    // Nav text
    fillRect(buf, width, 20, 90 + i * 45, 120, 12, active ? 255 : 80, active ? 255 : 80, active ? 255 : 80);
  }

  return buf;
}

/**
 * Create an image with dense "text-like" horizontal lines.
 * Simulates a text-heavy UI such as documentation or article pages.
 */
function makeTextHeavyImage(width: number, height: number): Buffer {
  const buf = makeSolidImage(width, height, 255, 255, 255); // white bg

  // Header
  fillRect(buf, width, 0, 0, width, 50, 35, 35, 45);

  // Title line
  fillRect(buf, width, 40, 70, 400, 24, 20, 20, 20);

  // Subtitle
  fillRect(buf, width, 40, 102, 300, 14, 100, 100, 100);

  // Paragraph text lines
  let y = 140;
  const lineHeight = 20;
  const paragraphGap = 30;

  for (let p = 0; p < 6; p++) {
    const lineCount = 4 + (p % 3);
    for (let l = 0; l < lineCount; l++) {
      if (y + 12 > height - 40) break;
      // Vary line width to simulate real text
      const lineWidth = width - 80 - (l === lineCount - 1 ? 120 + (p * 47) % 200 : 0);
      fillRect(buf, width, 40, y, Math.max(60, lineWidth), 12, 40, 40, 40);
      y += lineHeight;
    }
    y += paragraphGap;
  }

  // Code block
  if (y + 100 < height - 40) {
    fillRect(buf, width, 40, y, width - 80, 90, 245, 245, 250);
    for (let l = 0; l < 4; l++) {
      const indent = l === 0 ? 0 : 20;
      fillRect(buf, width, 52 + indent, y + 12 + l * 18, 200 + (l * 31) % 100, 10, 100, 40, 40);
    }
  }

  return buf;
}

/**
 * Fill a rectangle in an RGBA buffer.
 */
function fillRect(
  buf: Buffer,
  imgWidth: number,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  g: number,
  b: number,
  a = 255
): void {
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(imgWidth, Math.round(x + w));

  for (let py = y0; py < Math.round(y + h); py++) {
    for (let px = x0; px < x1; px++) {
      const idx = (py * imgWidth + px) * 4;
      buf[idx] = r;
      buf[idx + 1] = g;
      buf[idx + 2] = b;
      buf[idx + 3] = a;
    }
  }
}

// ---------------------------------------------------------------------------
// 13 Synthetic test scenarios
// ---------------------------------------------------------------------------

const IMG_WIDTH = 800;
const IMG_HEIGHT = 600;

const SCENARIOS: ScenarioDefinition[] = [
  // 1. Identical images (zero diff baseline)
  {
    name: 'identical',
    description: 'Identical images — zero diff baseline',
    width: IMG_WIDTH,
    height: IMG_HEIGHT,
    buildBaseline: (w, h) => makeUIImage(w, h),
    buildCurrent: (w, h) => makeUIImage(w, h),
    expectZeroDiff: true,
  },

  // 2. Edge jitter — 15px amount
  {
    name: 'edge-jitter-15',
    description: 'Sub-pixel edge jitter (amount=15) — font rendering sim',
    width: IMG_WIDTH,
    height: IMG_HEIGHT,
    buildBaseline: (w, h) => makeUIImage(w, h),
    buildCurrent: (w, h) => {
      const img = makeUIImage(w, h);
      addSubPixelJitter(img, w, h, 15);
      return img;
    },
  },

  // 3. Edge jitter — 30px amount
  {
    name: 'edge-jitter-30',
    description: 'Sub-pixel edge jitter (amount=30) — moderate rendering noise',
    width: IMG_WIDTH,
    height: IMG_HEIGHT,
    buildBaseline: (w, h) => makeUIImage(w, h),
    buildCurrent: (w, h) => {
      const img = makeUIImage(w, h);
      addSubPixelJitter(img, w, h, 30);
      return img;
    },
  },

  // 4. Edge jitter — 50px amount
  {
    name: 'edge-jitter-50',
    description: 'Sub-pixel edge jitter (amount=50) — heavy rendering noise',
    width: IMG_WIDTH,
    height: IMG_HEIGHT,
    buildBaseline: (w, h) => makeUIImage(w, h),
    buildCurrent: (w, h) => {
      const img = makeUIImage(w, h);
      addSubPixelJitter(img, w, h, 50);
      return img;
    },
  },

  // 5. Anti-aliasing fringe
  {
    name: 'aa-fringe',
    description: 'Anti-aliasing fringe differences (amount=80)',
    width: IMG_WIDTH,
    height: IMG_HEIGHT,
    buildBaseline: (w, h) => makeUIImage(w, h),
    buildCurrent: (w, h) => {
      const img = makeUIImage(w, h);
      addAAFringe(img, w, h, 80);
      return img;
    },
  },

  // 6. 1px layout shift
  {
    name: '1px-shift',
    description: '1px layout shift — entire content translated',
    width: IMG_WIDTH,
    height: IMG_HEIGHT,
    buildBaseline: (w, h) => makeUIImage(w, h),
    buildCurrent: (w, h) => {
      const img = makeUIImage(w, h);
      shiftImage(img, w, h, 1, 0);
      return img;
    },
  },

  // 7. Text-heavy UI with jitter + AA
  {
    name: 'text-heavy-jitter-aa',
    description: 'Text-heavy UI with jitter (20) + AA fringe (60)',
    width: IMG_WIDTH,
    height: IMG_HEIGHT,
    buildBaseline: (w, h) => makeTextHeavyImage(w, h),
    buildCurrent: (w, h) => {
      const img = makeTextHeavyImage(w, h);
      addSubPixelJitter(img, w, h, 20);
      addAAFringe(img, w, h, 60);
      return img;
    },
    textAware: true,
  },

  // 8. Mixed content — jitter + color shift in one region
  {
    name: 'mixed-content',
    description: 'Mixed: edge jitter (10) + color shift in sidebar',
    width: IMG_WIDTH,
    height: IMG_HEIGHT,
    buildBaseline: (w, h) => makeUIImage(w, h),
    buildCurrent: (w, h) => {
      const img = makeUIImage(w, h);
      addSubPixelJitter(img, w, h, 10);
      shiftRegionColor(img, w, h, { x: 0, y: 60, width: 220, height: h - 110 }, 15, -5, -10);
      return img;
    },
  },

  // 9. Large content change — replacing most of the content area
  {
    name: 'large-change',
    description: 'Large content change — content area replaced',
    width: IMG_WIDTH,
    height: IMG_HEIGHT,
    buildBaseline: (w, h) => makeUIImage(w, h),
    buildCurrent: (w, h) => {
      const img = makeUIImage(w, h);
      // Replace the entire content area with a different color scheme
      fillRect(img, w, 230, 70, w - 240, h - 130, 240, 248, 255);
      // Add different content blocks
      for (let row = 0; row < 4; row++) {
        fillRect(img, w, 250, 90 + row * 110, w - 280, 95, 220, 235, 250);
        fillRect(img, w, 260, 100 + row * 110, 300, 14, 30, 80, 150);
        fillRect(img, w, 260, 120 + row * 110, 250, 10, 80, 80, 80);
        fillRect(img, w, 260, 136 + row * 110, 200, 10, 80, 80, 80);
      }
      return img;
    },
  },

  // 10. Small targeted change — single button color change
  {
    name: 'small-targeted',
    description: 'Small targeted change — single button color shift',
    width: IMG_WIDTH,
    height: IMG_HEIGHT,
    buildBaseline: (w, h) => {
      const img = makeUIImage(w, h);
      // Add a button
      fillRect(img, w, 600, 400, 120, 40, 50, 120, 200);
      return img;
    },
    buildCurrent: (w, h) => {
      const img = makeUIImage(w, h);
      // Button with different color (hover state)
      fillRect(img, w, 600, 400, 120, 40, 70, 150, 230);
      return img;
    },
  },

  // 11. Full page scroll difference
  {
    name: 'scroll-diff',
    description: 'Full page scroll — content shifted down by 80px',
    width: IMG_WIDTH,
    height: IMG_HEIGHT,
    buildBaseline: (w, h) => makeUIImage(w, h),
    buildCurrent: (w, h) => {
      const img = makeUIImage(w, h);
      shiftImage(img, w, h, 0, 80);
      return img;
    },
  },

  // 12. Color temperature shift + gradient overlay
  {
    name: 'color-temp-gradient',
    description: 'Color temperature shift with gradient overlay',
    width: IMG_WIDTH,
    height: IMG_HEIGHT,
    buildBaseline: (w, h) => makeUIImage(w, h),
    buildCurrent: (w, h) => {
      const img = makeUIImage(w, h);
      // Apply a warm color tint to entire image
      shiftRegionColor(img, w, h, { x: 0, y: 0, width: w, height: h }, 8, 3, -5);
      // Overlay a subtle gradient from top to bottom
      for (let y = 0; y < h; y++) {
        const alpha = (y / (h - 1)) * 0.08; // max 8% opacity
        for (let x = 0; x < w; x++) {
          const idx = (y * w + x) * 4;
          img[idx] = clamp(Math.round(img[idx] * (1 - alpha) + 255 * alpha), 0, 255);
          img[idx + 1] = clamp(Math.round(img[idx + 1] * (1 - alpha) + 245 * alpha), 0, 255);
          img[idx + 2] = clamp(Math.round(img[idx + 2] * (1 - alpha) + 230 * alpha), 0, 255);
        }
      }
      return img;
    },
  },

  // 13. Border/shadow + font weight change
  {
    name: 'border-shadow-font',
    description: 'Border/shadow change + font weight simulation',
    width: IMG_WIDTH,
    height: IMG_HEIGHT,
    buildBaseline: (w, h) => {
      const img = makeUIImage(w, h);
      // Card borders — thin
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 2; col++) {
          const cx = 240 + col * ((w - 260) / 2) + 5;
          const cy = 80 + row * 130;
          const cw = (w - 280) / 2;
          // 1px border
          fillRect(img, w, cx, cy, cw, 1, 200, 200, 200);
          fillRect(img, w, cx, cy + 119, cw, 1, 200, 200, 200);
          fillRect(img, w, cx, cy, 1, 120, 200, 200, 200);
          fillRect(img, w, cx + cw - 1, cy, 1, 120, 200, 200, 200);
        }
      }
      return img;
    },
    buildCurrent: (w, h) => {
      const img = makeUIImage(w, h);
      // Card borders — thicker with shadow
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 2; col++) {
          const cx = 240 + col * ((w - 260) / 2) + 5;
          const cy = 80 + row * 130;
          const cw = (w - 280) / 2;
          // 2px border
          fillRect(img, w, cx, cy, cw, 2, 170, 170, 170);
          fillRect(img, w, cx, cy + 118, cw, 2, 170, 170, 170);
          fillRect(img, w, cx, cy, 2, 120, 170, 170, 170);
          fillRect(img, w, cx + cw - 2, cy, 2, 120, 170, 170, 170);
          // Shadow (3px offset, light gray)
          fillRect(img, w, cx + 3, cy + 120, cw, 3, 220, 220, 220);
          fillRect(img, w, cx + cw, cy + 3, 3, 120, 220, 220, 220);
        }
      }
      // Simulate font weight change: thicken text lines
      // We shift text region colors slightly darker to simulate bold
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 2; col++) {
          const cx = 240 + col * ((w - 260) / 2) + 5;
          const cy = 80 + row * 130;
          shiftRegionColor(img, w, h, { x: cx + 10, y: cy + 18, width: 200, height: 88 }, -15, -15, -15);
        }
      }
      return img;
    },
  },
];

// ---------------------------------------------------------------------------
// Engines to benchmark
// ---------------------------------------------------------------------------

const ENGINES: DiffEngineType[] = ['pixelmatch', 'ssim', 'butteraugli'];

const TEXT_AWARE_OPTIONS: TextAwareDiffOptions = {
  textRegionThreshold: 0.3,
  nonTextThreshold: 0.1,
  textRegionPadding: 4,
  includeAntiAliasing: false,
  textDetectionGranularity: 'word',
  diffEngine: 'pixelmatch',
};

// ---------------------------------------------------------------------------
// Benchmark runner
// ---------------------------------------------------------------------------

interface ScenarioResult {
  scenario: string;
  engine: string;
  diffPixels: number;
  totalPixels: number;
  percentDiff: number;
  timeMs: number;
  error?: string;
  // Text-aware fields
  textDiffPixels?: number;
  nonTextDiffPixels?: number;
  ocrRegions?: number;
  ocrTimeMs?: number;
}

async function runScenario(
  scenario: ScenarioDefinition,
  engine: DiffEngineType
): Promise<ScenarioResult> {
  const { width, height, name } = scenario;
  const totalPixels = width * height;

  const baseline = scenario.buildBaseline(width, height);
  const current = scenario.buildCurrent(width, height);

  const start = performance.now();

  try {
    const result: EngineResult = runDiffEngine(
      engine,
      baseline,
      current,
      width,
      height,
      0.1,  // threshold (only used by pixelmatch)
      false // includeAA
    );

    const timeMs = Math.round((performance.now() - start) * 100) / 100;
    const percentDiff = Math.round((result.diffPixelCount / totalPixels) * 10000) / 100;

    return {
      scenario: name,
      engine,
      diffPixels: result.diffPixelCount,
      totalPixels,
      percentDiff,
      timeMs,
    };
  } catch (err) {
    const timeMs = Math.round((performance.now() - start) * 100) / 100;
    return {
      scenario: name,
      engine,
      diffPixels: 0,
      totalPixels,
      percentDiff: 0,
      timeMs,
      error: (err as Error).message.slice(0, 80),
    };
  }
}

async function runTextAwareScenario(
  scenario: ScenarioDefinition
): Promise<ScenarioResult> {
  const { width, height, name } = scenario;
  const totalPixels = width * height;

  const baseline = scenario.buildBaseline(width, height);
  const current = scenario.buildCurrent(width, height);

  const start = performance.now();

  try {
    const result = await generateTextAwareDiff(
      baseline,
      current,
      width,
      height,
      TEXT_AWARE_OPTIONS
    );

    const timeMs = Math.round((performance.now() - start) * 100) / 100;
    const percentDiff = Math.round((result.diffPixelCount / totalPixels) * 10000) / 100;

    return {
      scenario: name,
      engine: 'text-aware',
      diffPixels: result.diffPixelCount,
      totalPixels,
      percentDiff,
      timeMs,
      textDiffPixels: result.textRegionDiffPixels,
      nonTextDiffPixels: result.nonTextRegionDiffPixels,
      ocrRegions: result.textRegions.length,
      ocrTimeMs: Math.round(result.ocrDurationMs * 100) / 100,
    };
  } catch (err) {
    const timeMs = Math.round((performance.now() - start) * 100) / 100;
    return {
      scenario: name,
      engine: 'text-aware',
      diffPixels: 0,
      totalPixels,
      percentDiff: 0,
      timeMs,
      error: (err as Error).message.slice(0, 80),
    };
  }
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

function formatResults(results: ScenarioResult[]): void {
  // ─── Table 1: Comparison table ───
  console.log('\n' + '='.repeat(120));
  console.log('  DIFF ENGINE BENCHMARK COMPARISON');
  console.log('='.repeat(120));
  console.log('  Engines: pixelmatch, ssim, butteraugli (+ text-aware where applicable)');
  console.log('  Image size: ' + IMG_WIDTH + 'x' + IMG_HEIGHT + ' (' + (IMG_WIDTH * IMG_HEIGHT).toLocaleString() + ' pixels)');
  console.log('  Scenarios: ' + SCENARIOS.length);
  console.log('='.repeat(120));

  const comparisonRows: ComparisonRow[] = [];

  for (const scenario of SCENARIOS) {
    const scenarioResults = results.filter(r => r.scenario === scenario.name);
    for (const r of scenarioResults) {
      comparisonRows.push({
        Scenario: r.scenario,
        Engine: r.engine,
        'Diff Pixels': r.error ? -1 : r.diffPixels,
        '% Diff': r.error ? `ERR: ${r.error}` : `${r.percentDiff}%`,
        'Time (ms)': r.timeMs,
      });
    }
  }

  console.log('\n--- Comparison: Engine x Scenario ---\n');
  console.table(comparisonRows);

  // ─── Table 2: Details (text-aware) ───
  console.log('\n' + '-'.repeat(120));
  console.log('  TEXT-AWARE DIFFING DETAILS');
  console.log('-'.repeat(120));

  const detailRows: DetailRow[] = [];
  const textAwareResults = results.filter(r => r.engine === 'text-aware');

  if (textAwareResults.length === 0) {
    console.log('  No text-aware scenarios were run.\n');
  } else {
    for (const r of textAwareResults) {
      // Find the pixelmatch baseline for comparison
      const pmResult = results.find(
        pr => pr.scenario === r.scenario && pr.engine === 'pixelmatch'
      );

      detailRows.push({
        Scenario: r.scenario,
        Engine: 'text-aware',
        'Text Diff Px': r.textDiffPixels ?? 'N/A',
        'Non-Text Diff Px': r.nonTextDiffPixels ?? 'N/A',
        'OCR Regions': r.ocrRegions ?? 'N/A',
        'OCR Time (ms)': r.ocrTimeMs ?? 'N/A',
      });

      // Also show the standard pixelmatch result for comparison
      if (pmResult) {
        detailRows.push({
          Scenario: r.scenario,
          Engine: 'pixelmatch (baseline)',
          'Text Diff Px': '-',
          'Non-Text Diff Px': '-',
          'OCR Regions': '-',
          'OCR Time (ms)': '-',
        });
      }
    }

    console.log('\n');
    console.table(detailRows);
  }

  // ─── Table 3: Summary ───
  console.log('\n' + '-'.repeat(120));
  console.log('  AGGREGATE SUMMARY');
  console.log('-'.repeat(120));

  const summaryRows: SummaryRow[] = [];
  const allEngines = [...ENGINES, 'text-aware'] as const;

  for (const engine of allEngines) {
    const engineResults = results.filter(r => r.engine === engine && !r.error);
    if (engineResults.length === 0) continue;

    const percentages = engineResults.map(r => r.percentDiff);
    const times = engineResults.map(r => r.timeMs);
    const avgPercent = percentages.reduce((a, b) => a + b, 0) / percentages.length;
    const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
    const maxPercent = Math.max(...percentages);
    const minPercent = Math.min(...percentages);

    // Validate zero-diff scenarios
    const zeroDiffScenarios = SCENARIOS.filter(s => s.expectZeroDiff);
    const zeroDiffResults = engineResults.filter(r =>
      zeroDiffScenarios.some(s => s.name === r.scenario)
    );
    const zeroDiffPass = zeroDiffResults.every(r => r.diffPixels === 0);

    summaryRows.push({
      Engine: engine,
      'Avg Diff %': `${(Math.round(avgPercent * 100) / 100).toFixed(2)}%`,
      'Avg Time (ms)': `${(Math.round(avgTime * 100) / 100).toFixed(2)}`,
      'Max Diff %': `${maxPercent}%`,
      'Min Diff %': `${minPercent}%`,
      'Scenarios Run': engineResults.length,
      'Zero-Diff Pass': zeroDiffPass ? 'PASS' : 'FAIL',
    });
  }

  // Calculate average diff reduction from text-aware vs pixelmatch
  const textAwareWithPm = results.filter(r => r.engine === 'text-aware' && !r.error);
  if (textAwareWithPm.length > 0) {
    let totalReduction = 0;
    let comparisonCount = 0;

    for (const ta of textAwareWithPm) {
      const pm = results.find(
        r => r.scenario === ta.scenario && r.engine === 'pixelmatch' && !r.error
      );
      if (pm && pm.diffPixels > 0) {
        const reduction = ((pm.diffPixels - ta.diffPixels) / pm.diffPixels) * 100;
        totalReduction += reduction;
        comparisonCount++;
      }
    }

    if (comparisonCount > 0) {
      const avgReduction = Math.round((totalReduction / comparisonCount) * 100) / 100;
      console.log(`\n  Text-aware avg diff reduction vs pixelmatch: ${avgReduction}%`);
    }
  }

  console.log('\n');
  console.table(summaryRows);

  // Validate zero-diff scenarios across all engines
  console.log('\n' + '-'.repeat(120));
  console.log('  VALIDATION');
  console.log('-'.repeat(120));

  let allValid = true;
  for (const scenario of SCENARIOS) {
    if (!scenario.expectZeroDiff) continue;
    const scenarioResults = results.filter(r => r.scenario === scenario.name);
    for (const r of scenarioResults) {
      if (r.diffPixels !== 0) {
        console.log(`  FAIL: ${scenario.name} / ${r.engine} — expected 0 diff, got ${r.diffPixels}`);
        allValid = false;
      }
    }
  }

  if (allValid) {
    console.log('  All zero-diff validations passed.');
  }

  console.log('\n' + '='.repeat(120) + '\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('Diff Engine Benchmark Comparison');
  console.log('Generating synthetic images and running comparisons...\n');

  const allResults: ScenarioResult[] = [];
  let completed = 0;
  const total = SCENARIOS.length * ENGINES.length
    + SCENARIOS.filter(s => s.textAware).length;

  for (const scenario of SCENARIOS) {
    // Run through all 3 engines
    for (const engine of ENGINES) {
      const result = await runScenario(scenario, engine);
      allResults.push(result);
      completed++;
      process.stdout.write(
        `\r  Progress: ${completed}/${total} — ${scenario.name} / ${engine}` +
        ' '.repeat(20)
      );
    }

    // Run text-aware if applicable
    if (scenario.textAware) {
      const textResult = await runTextAwareScenario(scenario);
      allResults.push(textResult);
      completed++;
      process.stdout.write(
        `\r  Progress: ${completed}/${total} — ${scenario.name} / text-aware` +
        ' '.repeat(20)
      );
    }
  }

  // Clear progress line
  process.stdout.write('\r' + ' '.repeat(80) + '\r');

  formatResults(allResults);
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
