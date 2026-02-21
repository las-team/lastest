import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import { generateDiff } from './generator';
import type { DiffResult } from './generator';
import type { DiffEngineType } from '../db/schema';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const SS = path.resolve('storage/screenshots/c8fc9e1c-413d-4013-9920-cdbab5fe7f0c');
const DD = path.resolve('storage/diffs');
const TEMP_DIR = path.resolve('__temp_benchmark__');

// ---------------------------------------------------------------------------
// 10 image pairs
// ---------------------------------------------------------------------------
interface ImagePair {
  label: string;
  baseline: string;
  current: string;
  description: string;
}

const PAIRS: ImagePair[] = [
  {
    label: 'identical-same-height',
    baseline: path.join(SS, '02110815-d9f9-4b30-bb81-ccd8fba5ddbb-d9253cb7-a44e-418e-963a-c871a38e89bd.png'),
    current:  path.join(SS, '04285d0d-7fd8-406d-937b-02405f421361-d9253cb7-a44e-418e-963a-c871a38e89bd.png'),
    description: '1440x6661 vs 1440x6661 — same test, two runs',
  },
  {
    label: 'near-identical-third-run',
    baseline: path.join(SS, '02110815-d9f9-4b30-bb81-ccd8fba5ddbb-d9253cb7-a44e-418e-963a-c871a38e89bd.png'),
    current:  path.join(SS, '0ff4bddc-78a5-4edd-a813-97bd6033fca5-d9253cb7-a44e-418e-963a-c871a38e89bd.png'),
    description: '1440x6661 vs 1440x6661 — third run, flakiness probe',
  },
  {
    label: 'height-diff-29px',
    baseline: path.join(SS, '04285d0d-7fd8-406d-937b-02405f421361-1296b7c5-1140-4629-8f8e-127421417465.png'),
    current:  path.join(SS, '3594ad16-8571-40cd-a7fa-91f4448944dd-1296b7c5-1140-4629-8f8e-127421417465.png'),
    description: '1440x7826 vs 1440x7855 — tiny height diff (29px)',
  },
  {
    label: 'height-diff-133px',
    baseline: path.join(SS, '04285d0d-7fd8-406d-937b-02405f421361-3179cc8b-5366-456f-8577-2729d960c391.png'),
    current:  path.join(SS, '3594ad16-8571-40cd-a7fa-91f4448944dd-3179cc8b-5366-456f-8577-2729d960c391.png'),
    description: '1440x6150 vs 1440x6017 — medium height diff (133px)',
  },
  {
    label: 'height-diff-206px',
    baseline: path.join(SS, '04285d0d-7fd8-406d-937b-02405f421361-71e949dd-b794-4c1b-9d27-5777b918bd2c.png'),
    current:  path.join(SS, '3594ad16-8571-40cd-a7fa-91f4448944dd-71e949dd-b794-4c1b-9d27-5777b918bd2c.png'),
    description: '1440x2477 vs 1440x2271 — larger height diff (206px)',
  },
  {
    label: 'height-diff-343px',
    baseline: path.join(SS, '02110815-d9f9-4b30-bb81-ccd8fba5ddbb-d9253cb7-a44e-418e-963a-c871a38e89bd.png'),
    current:  path.join(SS, '3594ad16-8571-40cd-a7fa-91f4448944dd-d9253cb7-a44e-418e-963a-c871a38e89bd.png'),
    description: '1440x6661 vs 1440x6318 — significant height shrink (343px)',
  },
  {
    label: 'width+height-diff',
    baseline: path.join(SS, '04285d0d-7fd8-406d-937b-02405f421361-3bb40151-c9ac-4aa2-8080-6aaaee61f2f4.png'),
    current:  path.join(SS, '3594ad16-8571-40cd-a7fa-91f4448944dd-3bb40151-c9ac-4aa2-8080-6aaaee61f2f4.png'),
    description: '1452x7009 vs 1440x6795 — width (-12px) AND height (-214px)',
  },
  {
    label: 'mobile-vs-desktop',
    baseline: path.join(SS, '04285d0d-7fd8-406d-937b-02405f421361-cac7b0bf-e98e-4c61-8d10-bb6116bb2fb6-mobile.png'),
    current:  path.join(SS, '04285d0d-7fd8-406d-937b-02405f421361-cac7b0bf-e98e-4c61-8d10-bb6116bb2fb6.png'),
    description: '375x15016 vs 1440x10419 — completely different dimensions',
  },
  {
    label: 'mobile-identical',
    baseline: path.join(SS, '04285d0d-7fd8-406d-937b-02405f421361-cac7b0bf-e98e-4c61-8d10-bb6116bb2fb6-mobile.png'),
    current:  path.join(SS, 'f9d5471d-bacc-455a-913c-aca65efb2de2-cac7b0bf-e98e-4c61-8d10-bb6116bb2fb6-mobile.png'),
    description: '375x15016 vs 375x15016 — mobile viewport, same height',
  },
  {
    label: 'aligned-pair',
    baseline: path.join(DD, 'aligned-baseline-1771443466123.png'),
    current:  path.join(DD, 'aligned-current-1771443466123.png'),
    description: 'Pre-aligned pair from storage/diffs — pure pixelmatch benchmark',
  },
];

// ---------------------------------------------------------------------------
// 6 settings combinations
// ---------------------------------------------------------------------------
interface SettingsCombo {
  key: string;
  label: string;
  threshold: number;
  includeAntiAliasing: boolean;
  ignorePageShift: boolean;
}

const SETTINGS: SettingsCombo[] = [
  { key: 'S1', label: 'default',     threshold: 0.10, includeAntiAliasing: false, ignorePageShift: false },
  { key: 'S2', label: 'sensitive',   threshold: 0.01, includeAntiAliasing: false, ignorePageShift: false },
  { key: 'S3', label: 'tolerant',    threshold: 0.30, includeAntiAliasing: false, ignorePageShift: false },
  { key: 'S4', label: 'AA-aware',    threshold: 0.10, includeAntiAliasing: true,  ignorePageShift: false },
  { key: 'S5', label: 'shift-aware', threshold: 0.10, includeAntiAliasing: false, ignorePageShift: true  },
  { key: 'S6', label: 'shift+AA',    threshold: 0.10, includeAntiAliasing: true,  ignorePageShift: true  },
];

// ---------------------------------------------------------------------------
// Report collection
// ---------------------------------------------------------------------------
interface BenchmarkResult {
  pairLabel: string;
  pairDescription: string;
  settingsKey: string;
  settingsLabel: string;
  pixelDiff: number;
  percentDiff: number;
  classification: 'unchanged' | 'flaky' | 'changed';
  shiftDetected: boolean;
  insertedRows: number;
  deletedRows: number;
  durationMs: number;
  error?: string;
}

const REPORT: BenchmarkResult[] = [];

function classify(pct: number): 'unchanged' | 'flaky' | 'changed' {
  if (pct <= 1) return 'unchanged';
  if (pct <= 10) return 'flaky';
  return 'changed';
}

// ---------------------------------------------------------------------------
// Check if all image files exist — skip gracefully in CI
// ---------------------------------------------------------------------------
function pairFilesExist(pair: ImagePair): boolean {
  return fs.existsSync(pair.baseline) && fs.existsSync(pair.current);
}

const allPairsAvailable = PAIRS.every(pairFilesExist);

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe.skipIf(!allPairsAvailable)('Diff Engine Benchmark', () => {
  beforeAll(() => {
    if (!fs.existsSync(TEMP_DIR)) {
      fs.mkdirSync(TEMP_DIR, { recursive: true });
    }
  });

  afterAll(() => {
    // ─── Section 1: Per-pair table ───
    console.log('\n\n' + '='.repeat(120));
    console.log('  DIFF ENGINE BENCHMARK REPORT');
    console.log('='.repeat(120));

    for (const pair of PAIRS) {
      const rows = REPORT.filter(r => r.pairLabel === pair.label);
      if (rows.length === 0) continue;

      console.log(`\n▸ ${pair.label} — ${pair.description}`);
      console.table(
        rows.map(r => ({
          Settings: `${r.settingsKey} (${r.settingsLabel})`,
          'Pixel Diff': r.error ? 'ERROR' : r.pixelDiff.toLocaleString(),
          '% Diff': r.error ? r.error : `${r.percentDiff}%`,
          Classification: r.classification,
          'Shift?': r.shiftDetected ? 'YES' : '-',
          'Ins/Del Rows': r.insertedRows || r.deletedRows ? `+${r.insertedRows}/-${r.deletedRows}` : '-',
          'Duration': `${r.durationMs}ms`,
        }))
      );
    }

    // ─── Section 2: Classification change matrix ───
    console.log('\n' + '-'.repeat(120));
    console.log('  CLASSIFICATION CHANGE MATRIX (vs S1 default)');
    console.log('-'.repeat(120));

    const matrix: Record<string, Record<string, string>> = {};
    for (const pair of PAIRS) {
      const rows = REPORT.filter(r => r.pairLabel === pair.label);
      const s1 = rows.find(r => r.settingsKey === 'S1');
      if (!s1) continue;

      const changes: Record<string, string> = {};
      let hasChange = false;
      for (const r of rows) {
        if (r.settingsKey === 'S1') continue;
        if (r.classification !== s1.classification) {
          changes[r.settingsKey] = `${s1.classification} → ${r.classification}`;
          hasChange = true;
        } else {
          changes[r.settingsKey] = '(same)';
        }
      }
      if (hasChange) {
        matrix[pair.label] = changes;
      }
    }

    if (Object.keys(matrix).length === 0) {
      console.log('  No classification changes across any settings.\n');
    } else {
      for (const [label, changes] of Object.entries(matrix)) {
        console.log(`  ${label}:`);
        for (const [key, val] of Object.entries(changes)) {
          console.log(`    ${key}: ${val}`);
        }
      }
    }

    // ─── Section 3: Page shift impact (S1 vs S5) ───
    console.log('\n' + '-'.repeat(120));
    console.log('  PAGE SHIFT IMPACT (S1 default vs S5 shift-aware)');
    console.log('-'.repeat(120));

    const shiftImpact: Array<{
      pair: string;
      s1Pct: number;
      s5Pct: number;
      delta: number;
      verdict: string;
    }> = [];

    for (const pair of PAIRS) {
      const rows = REPORT.filter(r => r.pairLabel === pair.label);
      const s1 = rows.find(r => r.settingsKey === 'S1');
      const s5 = rows.find(r => r.settingsKey === 'S5');
      if (!s1 || !s5 || s1.error || s5.error) continue;

      const delta = s1.percentDiff - s5.percentDiff;
      shiftImpact.push({
        pair: pair.label,
        s1Pct: s1.percentDiff,
        s5Pct: s5.percentDiff,
        delta: Math.round(delta * 100) / 100,
        verdict: delta > 0.5 ? 'HELPS' : delta < -0.5 ? 'HURTS' : 'NEUTRAL',
      });
    }

    console.table(shiftImpact);

    console.log('\n' + '='.repeat(120) + '\n');

    // Clean up temp dir
    try {
      fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  // Generate tests: 10 pairs × 6 settings = 60 tests
  for (const pair of PAIRS) {
    describe(pair.label, () => {
      for (const settings of SETTINGS) {
        it(`${settings.key} (${settings.label})`, async () => {
          if (!pairFilesExist(pair)) {
            REPORT.push({
              pairLabel: pair.label,
              pairDescription: pair.description,
              settingsKey: settings.key,
              settingsLabel: settings.label,
              pixelDiff: 0,
              percentDiff: 0,
              classification: 'unchanged',
              shiftDetected: false,
              insertedRows: 0,
              deletedRows: 0,
              durationMs: 0,
              error: 'FILES_MISSING',
            });
            return;
          }

          const outDir = path.join(TEMP_DIR, `${pair.label}-${settings.key}`);

          const start = performance.now();
          let result: DiffResult;
          try {
            result = await generateDiff(
              pair.baseline,
              pair.current,
              outDir,
              settings.threshold,
              settings.includeAntiAliasing,
              undefined, // ignoreRegions
              settings.ignorePageShift,
            );
          } catch (err) {
            const durationMs = Math.round(performance.now() - start);
            REPORT.push({
              pairLabel: pair.label,
              pairDescription: pair.description,
              settingsKey: settings.key,
              settingsLabel: settings.label,
              pixelDiff: 0,
              percentDiff: 0,
              classification: 'changed',
              shiftDetected: false,
              insertedRows: 0,
              deletedRows: 0,
              durationMs,
              error: (err as Error).message.slice(0, 80),
            });
            // Don't fail — record the error and move on
            return;
          }
          const durationMs = Math.round(performance.now() - start);

          const ps = result.metadata.pageShift;
          REPORT.push({
            pairLabel: pair.label,
            pairDescription: pair.description,
            settingsKey: settings.key,
            settingsLabel: settings.label,
            pixelDiff: result.pixelDifference,
            percentDiff: result.percentageDifference,
            classification: classify(result.percentageDifference),
            shiftDetected: ps?.detected ?? false,
            insertedRows: ps?.insertedRows ?? 0,
            deletedRows: ps?.deletedRows ?? 0,
            durationMs,
          });

          // Basic sanity assertions — no crash + valid range
          expect(result.pixelDifference).toBeGreaterThanOrEqual(0);
          expect(result.percentageDifference).toBeGreaterThanOrEqual(0);
          expect(result.percentageDifference).toBeLessThanOrEqual(100);
          expect(result.diffImagePath).toBeTruthy();
        }, 60_000); // 60s timeout per test
      }
    });
  }
});

// ===========================================================================
// Part 2 — Multi-Engine Accuracy Benchmark (synthetic, always runs)
// ===========================================================================

const ENGINE_TEMP_DIR = path.resolve('__temp_engine_benchmark__');

// ---------------------------------------------------------------------------
// Synthetic image generators
// ---------------------------------------------------------------------------

/** Create a solid-color PNG */
function solidPNG(w: number, h: number, r: number, g: number, b: number, a = 255): PNG {
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) {
    const idx = i * 4;
    png.data[idx] = r;
    png.data[idx + 1] = g;
    png.data[idx + 2] = b;
    png.data[idx + 3] = a;
  }
  return png;
}

/** Create a PNG with a colored rectangle on a background */
function rectPNG(
  w: number, h: number,
  rect: { x: number; y: number; rw: number; rh: number },
  fg: [number, number, number, number] = [0, 0, 0, 255],
  bg: [number, number, number, number] = [255, 255, 255, 255]
): PNG {
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const inRect = x >= rect.x && x < rect.x + rect.rw && y >= rect.y && y < rect.y + rect.rh;
      const c = inRect ? fg : bg;
      png.data[idx] = c[0]; png.data[idx + 1] = c[1]; png.data[idx + 2] = c[2]; png.data[idx + 3] = c[3];
    }
  }
  return png;
}

/** Create a PNG with horizontal gradient */
function gradientPNG(w: number, h: number, fromR: number, fromG: number, fromB: number, toR: number, toG: number, toB: number): PNG {
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = x / (w - 1);
      const idx = (y * w + x) * 4;
      png.data[idx] = Math.round(fromR + t * (toR - fromR));
      png.data[idx + 1] = Math.round(fromG + t * (toG - fromG));
      png.data[idx + 2] = Math.round(fromB + t * (toB - fromB));
      png.data[idx + 3] = 255;
    }
  }
  return png;
}

/** Create a PNG with alternating pixel checkerboard (simulates anti-aliasing) */
function checkerboardPNG(w: number, h: number, c1: [number, number, number], c2: [number, number, number]): PNG {
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const c = (x + y) % 2 === 0 ? c1 : c2;
      png.data[idx] = c[0]; png.data[idx + 1] = c[1]; png.data[idx + 2] = c[2]; png.data[idx + 3] = 255;
    }
  }
  return png;
}

/** Create a PNG with random noise */
function noisePNG(w: number, h: number, seed: number): PNG {
  const png = new PNG({ width: w, height: h });
  let s = seed;
  const rand = () => { s = (s * 1664525 + 1013904223) & 0xFFFFFFFF; return (s >>> 0) / 0xFFFFFFFF; };
  for (let i = 0; i < w * h; i++) {
    const idx = i * 4;
    png.data[idx] = Math.floor(rand() * 256);
    png.data[idx + 1] = Math.floor(rand() * 256);
    png.data[idx + 2] = Math.floor(rand() * 256);
    png.data[idx + 3] = 255;
  }
  return png;
}

/** Add scattered single-pixel noise to an existing PNG (simulates sub-pixel rendering) */
function addSubPixelNoise(src: PNG, count: number, seed: number): PNG {
  const png = new PNG({ width: src.width, height: src.height });
  src.data.copy(png.data);
  let s = seed;
  const rand = () => { s = (s * 1664525 + 1013904223) & 0xFFFFFFFF; return (s >>> 0) / 0xFFFFFFFF; };
  for (let i = 0; i < count; i++) {
    const x = Math.floor(rand() * src.width);
    const y = Math.floor(rand() * src.height);
    const idx = (y * src.width + x) * 4;
    for (let c = 0; c < 3; c++) {
      const delta = Math.floor(rand() * 5) - 2; // -2 to +2
      png.data[idx + c] = Math.max(0, Math.min(255, png.data[idx + c] + delta));
    }
  }
  return png;
}

/** Create multi-element page-like image */
function pagePNG(w: number, h: number, elements: Array<{ y: number; rh: number; color: [number, number, number, number] }>): PNG {
  const png = solidPNG(w, h, 245, 245, 245); // light gray bg
  for (const el of elements) {
    const margin = 20;
    for (let y = el.y; y < Math.min(el.y + el.rh, h); y++) {
      for (let x = margin; x < w - margin; x++) {
        const idx = (y * w + x) * 4;
        png.data[idx] = el.color[0]; png.data[idx + 1] = el.color[1];
        png.data[idx + 2] = el.color[2]; png.data[idx + 3] = el.color[3];
      }
    }
  }
  return png;
}

// ---------------------------------------------------------------------------
// Test scenario definitions
// ---------------------------------------------------------------------------

interface Scenario {
  name: string;
  description: string;
  expectedDiff: 'none' | 'subtle' | 'moderate' | 'major';
  humanNoticeable: boolean;
  baseline: () => PNG;
  current: () => PNG;
}

const W = 200;
const H = 200;

const SCENARIOS: Scenario[] = [
  // ── Category 1: Identical / near-identical ──
  {
    name: 'identical-solid',
    description: 'Two identical solid white images',
    expectedDiff: 'none',
    humanNoticeable: false,
    baseline: () => solidPNG(W, H, 255, 255, 255),
    current: () => solidPNG(W, H, 255, 255, 255),
  },
  {
    name: 'identical-complex',
    description: 'Two identical gradient images',
    expectedDiff: 'none',
    humanNoticeable: false,
    baseline: () => gradientPNG(W, H, 0, 0, 128, 255, 128, 0),
    current: () => gradientPNG(W, H, 0, 0, 128, 255, 128, 0),
  },
  {
    name: 'identical-with-rect',
    description: 'Two identical images with black rectangle',
    expectedDiff: 'none',
    humanNoticeable: false,
    baseline: () => rectPNG(W, H, { x: 50, y: 50, rw: 100, rh: 80 }),
    current: () => rectPNG(W, H, { x: 50, y: 50, rw: 100, rh: 80 }),
  },

  // ── Category 2: Sub-pixel / anti-aliasing noise ──
  {
    name: 'subpixel-10',
    description: '10 pixels with ±2 channel noise (0.025% area)',
    expectedDiff: 'subtle',
    humanNoticeable: false,
    baseline: () => solidPNG(W, H, 200, 200, 200),
    current: () => addSubPixelNoise(solidPNG(W, H, 200, 200, 200), 10, 42),
  },
  {
    name: 'subpixel-100',
    description: '100 pixels with ±2 channel noise (0.25% area)',
    expectedDiff: 'subtle',
    humanNoticeable: false,
    baseline: () => solidPNG(W, H, 200, 200, 200),
    current: () => addSubPixelNoise(solidPNG(W, H, 200, 200, 200), 100, 42),
  },
  {
    name: 'subpixel-500',
    description: '500 pixels with ±2 channel noise (1.25% area)',
    expectedDiff: 'subtle',
    humanNoticeable: false,
    baseline: () => gradientPNG(W, H, 50, 50, 100, 200, 150, 50),
    current: () => addSubPixelNoise(gradientPNG(W, H, 50, 50, 100, 200, 150, 50), 500, 42),
  },
  {
    name: 'checkerboard-vs-shifted',
    description: 'Checkerboard AA pattern shifted 1px (worst case for pixelmatch)',
    expectedDiff: 'subtle',
    humanNoticeable: false,
    baseline: () => checkerboardPNG(W, H, [200, 200, 200], [220, 220, 220]),
    current: () => checkerboardPNG(W, H, [220, 220, 220], [200, 200, 200]),
  },

  // ── Category 3: Color shifts (imperceptible to noticeable) ──
  {
    name: 'color-shift-1',
    description: 'Global +1 on all channels (imperceptible)',
    expectedDiff: 'subtle',
    humanNoticeable: false,
    baseline: () => solidPNG(W, H, 128, 128, 128),
    current: () => solidPNG(W, H, 129, 129, 129),
  },
  {
    name: 'color-shift-5',
    description: 'Global +5 on all channels (barely perceptible)',
    expectedDiff: 'subtle',
    humanNoticeable: false,
    baseline: () => solidPNG(W, H, 128, 128, 128),
    current: () => solidPNG(W, H, 133, 133, 133),
  },
  {
    name: 'color-shift-20',
    description: 'Global +20 on all channels (clearly visible)',
    expectedDiff: 'moderate',
    humanNoticeable: true,
    baseline: () => solidPNG(W, H, 128, 128, 128),
    current: () => solidPNG(W, H, 148, 148, 148),
  },
  {
    name: 'hue-shift-subtle',
    description: 'Slight hue shift: blue→slightly purple (R+3)',
    expectedDiff: 'subtle',
    humanNoticeable: false,
    baseline: () => solidPNG(W, H, 50, 50, 200),
    current: () => solidPNG(W, H, 53, 50, 200),
  },
  {
    name: 'hue-shift-visible',
    description: 'Visible hue shift: blue→purple (R+40)',
    expectedDiff: 'moderate',
    humanNoticeable: true,
    baseline: () => solidPNG(W, H, 50, 50, 200),
    current: () => solidPNG(W, H, 90, 50, 200),
  },

  // ── Category 4: Geometric changes ──
  {
    name: 'rect-moved-1px',
    description: 'Rectangle moved 1px right (sub-pixel repositioning)',
    expectedDiff: 'subtle',
    humanNoticeable: false,
    baseline: () => rectPNG(W, H, { x: 50, y: 50, rw: 80, rh: 60 }),
    current: () => rectPNG(W, H, { x: 51, y: 50, rw: 80, rh: 60 }),
  },
  {
    name: 'rect-moved-5px',
    description: 'Rectangle moved 5px right (visible shift)',
    expectedDiff: 'moderate',
    humanNoticeable: true,
    baseline: () => rectPNG(W, H, { x: 50, y: 50, rw: 80, rh: 60 }),
    current: () => rectPNG(W, H, { x: 55, y: 50, rw: 80, rh: 60 }),
  },
  {
    name: 'rect-resized',
    description: 'Rectangle grew 20px wider and 10px taller',
    expectedDiff: 'moderate',
    humanNoticeable: true,
    baseline: () => rectPNG(W, H, { x: 50, y: 50, rw: 80, rh: 60 }),
    current: () => rectPNG(W, H, { x: 50, y: 50, rw: 100, rh: 70 }),
  },
  {
    name: 'rect-color-change',
    description: 'Rectangle changed from black to dark blue',
    expectedDiff: 'moderate',
    humanNoticeable: true,
    baseline: () => rectPNG(W, H, { x: 50, y: 50, rw: 80, rh: 60 }, [0, 0, 0, 255]),
    current: () => rectPNG(W, H, { x: 50, y: 50, rw: 80, rh: 60 }, [0, 0, 80, 255]),
  },
  {
    name: 'rect-added',
    description: 'New element appeared (added red rectangle)',
    expectedDiff: 'major',
    humanNoticeable: true,
    baseline: () => solidPNG(W, H, 255, 255, 255),
    current: () => rectPNG(W, H, { x: 30, y: 30, rw: 120, rh: 80 }, [220, 50, 50, 255]),
  },
  {
    name: 'rect-removed',
    description: 'Element disappeared (removed black rectangle)',
    expectedDiff: 'major',
    humanNoticeable: true,
    baseline: () => rectPNG(W, H, { x: 30, y: 30, rw: 120, rh: 80 }),
    current: () => solidPNG(W, H, 255, 255, 255),
  },

  // ── Category 5: Page layout shifts ──
  {
    name: 'page-shift-20px',
    description: 'Page content shifted down 20px (banner inserted)',
    expectedDiff: 'moderate',
    humanNoticeable: true,
    baseline: () => pagePNG(W, 300, [
      { y: 10, rh: 40, color: [70, 130, 180, 255] },
      { y: 60, rh: 80, color: [100, 100, 100, 255] },
      { y: 150, rh: 60, color: [180, 70, 70, 255] },
      { y: 220, rh: 30, color: [70, 70, 70, 255] },
    ]),
    current: () => pagePNG(W, 320, [
      { y: 10, rh: 40, color: [70, 130, 180, 255] },
      { y: 60, rh: 20, color: [255, 200, 50, 255] },
      { y: 80, rh: 80, color: [100, 100, 100, 255] },
      { y: 170, rh: 60, color: [180, 70, 70, 255] },
      { y: 240, rh: 30, color: [70, 70, 70, 255] },
    ]),
  },
  {
    name: 'page-shift-50px',
    description: 'Page content shifted down 50px (large element inserted)',
    expectedDiff: 'major',
    humanNoticeable: true,
    baseline: () => pagePNG(W, 300, [
      { y: 10, rh: 40, color: [70, 130, 180, 255] },
      { y: 60, rh: 80, color: [100, 100, 100, 255] },
      { y: 150, rh: 60, color: [180, 70, 70, 255] },
    ]),
    current: () => pagePNG(W, 350, [
      { y: 10, rh: 40, color: [70, 130, 180, 255] },
      { y: 60, rh: 50, color: [50, 180, 50, 255] },
      { y: 110, rh: 80, color: [100, 100, 100, 255] },
      { y: 200, rh: 60, color: [180, 70, 70, 255] },
    ]),
  },

  // ── Category 6: Random noise (stress tests) ──
  {
    name: 'noise-identical',
    description: 'Two identical noisy images (same seed)',
    expectedDiff: 'none',
    humanNoticeable: false,
    baseline: () => noisePNG(W, H, 12345),
    current: () => noisePNG(W, H, 12345),
  },
  {
    name: 'noise-different',
    description: 'Two completely different noisy images',
    expectedDiff: 'major',
    humanNoticeable: true,
    baseline: () => noisePNG(W, H, 12345),
    current: () => noisePNG(W, H, 67890),
  },

  // ── Category 7: Gradient changes ──
  {
    name: 'gradient-identical',
    description: 'Two identical gradients',
    expectedDiff: 'none',
    humanNoticeable: false,
    baseline: () => gradientPNG(W, H, 0, 0, 0, 255, 255, 255),
    current: () => gradientPNG(W, H, 0, 0, 0, 255, 255, 255),
  },
  {
    name: 'gradient-slight-shift',
    description: 'Gradient endpoints shifted by 5 values',
    expectedDiff: 'subtle',
    humanNoticeable: false,
    baseline: () => gradientPNG(W, H, 0, 0, 0, 255, 255, 255),
    current: () => gradientPNG(W, H, 0, 0, 0, 250, 250, 250),
  },
  {
    name: 'gradient-direction-change',
    description: 'Gradient direction reversed',
    expectedDiff: 'major',
    humanNoticeable: true,
    baseline: () => gradientPNG(W, H, 0, 0, 0, 255, 255, 255),
    current: () => gradientPNG(W, H, 255, 255, 255, 0, 0, 0),
  },

  // ── Category 8: Mixed realistic scenarios ──
  {
    name: 'button-hover-state',
    description: 'Button color change simulating hover (blue→light blue)',
    expectedDiff: 'moderate',
    humanNoticeable: true,
    baseline: () => rectPNG(W, H, { x: 50, y: 80, rw: 100, rh: 40 }, [59, 130, 246, 255], [245, 245, 245, 255]),
    current: () => rectPNG(W, H, { x: 50, y: 80, rw: 100, rh: 40 }, [96, 165, 250, 255], [245, 245, 245, 255]),
  },
  {
    name: 'text-reflow',
    description: 'Simulated text reflow: multiple thin lines shifted',
    expectedDiff: 'moderate',
    humanNoticeable: true,
    baseline: () => pagePNG(W, H, [
      { y: 20, rh: 3, color: [30, 30, 30, 255] },
      { y: 26, rh: 3, color: [30, 30, 30, 255] },
      { y: 32, rh: 3, color: [30, 30, 30, 255] },
      { y: 38, rh: 3, color: [30, 30, 30, 255] },
      { y: 44, rh: 3, color: [30, 30, 30, 255] },
    ]),
    current: () => pagePNG(W, H, [
      { y: 20, rh: 3, color: [30, 30, 30, 255] },
      { y: 26, rh: 3, color: [30, 30, 30, 255] },
      { y: 33, rh: 3, color: [30, 30, 30, 255] },
      { y: 39, rh: 3, color: [30, 30, 30, 255] },
      { y: 45, rh: 3, color: [30, 30, 30, 255] },
    ]),
  },
];

// ---------------------------------------------------------------------------
// Engines to test
// ---------------------------------------------------------------------------
const ENGINES: DiffEngineType[] = ['pixelmatch', 'ssim', 'butteraugli'];

// ---------------------------------------------------------------------------
// Report types
// ---------------------------------------------------------------------------
interface EngineTestResult {
  engine: DiffEngineType;
  scenario: string;
  expectedDiff: string;
  humanNoticeable: boolean;
  pixelDiff: number;
  percentDiff: number;
  durationMs: number;
  detectedDiff: boolean;
  error?: string;
}

const ENGINE_RESULTS: EngineTestResult[] = [];

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe('Multi-Engine Accuracy Benchmark', () => {
  beforeAll(() => {
    if (!fs.existsSync(ENGINE_TEMP_DIR)) {
      fs.mkdirSync(ENGINE_TEMP_DIR, { recursive: true });
    }
  });

  afterAll(() => {
    // ═══════════════════════════════════════════════════════════════════════
    // REPORT GENERATION
    // ═══════════════════════════════════════════════════════════════════════
    console.log('\n\n' + '='.repeat(130));
    console.log('  DIFF ENGINE ACCURACY BENCHMARK REPORT');
    console.log('='.repeat(130));

    // ── Section 1: Per-scenario engine comparison ──
    console.log('\n  PER-SCENARIO RESULTS');
    console.log('-'.repeat(130));

    const scenarioNames = [...new Set(ENGINE_RESULTS.map(r => r.scenario))];
    for (const name of scenarioNames) {
      const rows = ENGINE_RESULTS.filter(r => r.scenario === name);
      const scenario = SCENARIOS.find(s => s.name === name)!;

      console.log(`\n  ${name} — ${scenario.description}`);
      console.log(`  Expected: ${scenario.expectedDiff} | Human noticeable: ${scenario.humanNoticeable ? 'YES' : 'no'}`);
      console.table(
        rows.map(r => ({
          Engine: r.engine,
          'Diff Pixels': r.error ? 'ERROR' : r.pixelDiff.toLocaleString(),
          '% Diff': r.error ? r.error : `${r.percentDiff.toFixed(3)}%`,
          Detected: r.detectedDiff ? 'YES' : 'no',
          'Time (ms)': r.durationMs,
        }))
      );
    }

    // ── Section 2: Accuracy metrics per engine ──
    console.log('\n' + '='.repeat(130));
    console.log('  ACCURACY METRICS');
    console.log('='.repeat(130));

    for (const engine of ENGINES) {
      const engineRows = ENGINE_RESULTS.filter(r => r.engine === engine && !r.error);

      const tp = engineRows.filter(r => r.humanNoticeable && r.detectedDiff).length;
      const fn = engineRows.filter(r => r.humanNoticeable && !r.detectedDiff).length;
      const tn = engineRows.filter(r => !r.humanNoticeable && !r.detectedDiff).length;
      const fp = engineRows.filter(r => !r.humanNoticeable && r.detectedDiff).length;

      const sensitivity = tp + fn > 0 ? ((tp / (tp + fn)) * 100).toFixed(1) : 'N/A';
      const specificity = tn + fp > 0 ? ((tn / (tn + fp)) * 100).toFixed(1) : 'N/A';
      const precision = tp + fp > 0 ? ((tp / (tp + fp)) * 100).toFixed(1) : 'N/A';
      const f1 = tp + fp > 0 && tp + fn > 0
        ? ((2 * tp / (2 * tp + fp + fn)) * 100).toFixed(1)
        : 'N/A';

      const avgTime = engineRows.length > 0
        ? Math.round(engineRows.reduce((s, r) => s + r.durationMs, 0) / engineRows.length)
        : 0;

      console.log(`\n  ${engine.toUpperCase()}`);
      console.table({
        'True Positives (detected real diffs)': tp,
        'False Negatives (missed real diffs)': fn,
        'True Negatives (ignored noise)': tn,
        'False Positives (flagged noise)': fp,
        'Sensitivity (recall)': `${sensitivity}%`,
        'Specificity': `${specificity}%`,
        'Precision': `${precision}%`,
        'F1 Score': `${f1}%`,
        'Avg Duration': `${avgTime}ms`,
      });
    }

    // ── Section 3: Engine comparison matrix ──
    console.log('\n' + '='.repeat(130));
    console.log('  ENGINE COMPARISON MATRIX');
    console.log('='.repeat(130));

    const engineMatrix: Array<{
      Scenario: string;
      Expected: string;
      'Human?': string;
      'PM %': string;
      'SSIM %': string;
      'Btgl %': string;
      'PM ok': string;
      'SSIM ok': string;
      'Btgl ok': string;
    }> = [];

    for (const scenario of SCENARIOS) {
      const pm = ENGINE_RESULTS.find(r => r.scenario === scenario.name && r.engine === 'pixelmatch');
      const ss = ENGINE_RESULTS.find(r => r.scenario === scenario.name && r.engine === 'ssim');
      const bt = ENGINE_RESULTS.find(r => r.scenario === scenario.name && r.engine === 'butteraugli');

      const judge = (r: EngineTestResult | undefined) => {
        if (!r || r.error) return 'ERR';
        if (scenario.humanNoticeable) return r.detectedDiff ? 'OK' : 'MISS';
        return r.detectedDiff ? 'FP' : 'OK';
      };

      engineMatrix.push({
        Scenario: scenario.name,
        Expected: scenario.expectedDiff,
        'Human?': scenario.humanNoticeable ? 'yes' : 'no',
        'PM %': pm?.error ? 'ERR' : `${pm?.percentDiff.toFixed(2)}`,
        'SSIM %': ss?.error ? 'ERR' : `${ss?.percentDiff.toFixed(2)}`,
        'Btgl %': bt?.error ? 'ERR' : `${bt?.percentDiff.toFixed(2)}`,
        'PM ok': judge(pm),
        'SSIM ok': judge(ss),
        'Btgl ok': judge(bt),
      });
    }

    console.table(engineMatrix);

    // ── Section 4: Performance comparison ──
    console.log('\n' + '='.repeat(130));
    console.log('  PERFORMANCE SUMMARY');
    console.log('='.repeat(130));

    for (const engine of ENGINES) {
      const rows = ENGINE_RESULTS.filter(r => r.engine === engine && !r.error);
      if (rows.length === 0) { console.log(`  ${engine}: no results`); continue; }
      const times = rows.map(r => r.durationMs);
      const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
      const min = Math.min(...times);
      const max = Math.max(...times);
      const sorted = [...times].sort((a, b) => a - b);
      const p50 = sorted[Math.floor(sorted.length / 2)];
      console.log(`  ${engine}: avg=${avg}ms, p50=${p50}ms, min=${min}ms, max=${max}ms`);
    }

    console.log('\n' + '='.repeat(130) + '\n');

    // Clean up
    try { fs.rmSync(ENGINE_TEMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  // ── Generate tests: SCENARIOS × ENGINES ──
  for (const scenario of SCENARIOS) {
    describe(scenario.name, () => {
      for (const engine of ENGINES) {
        it(`${engine}`, async () => {
          const baselinePng = scenario.baseline();
          const currentPng = scenario.current();

          const outDir = path.join(ENGINE_TEMP_DIR, `${scenario.name}-${engine}`);
          const baselinePath = path.join(outDir, 'baseline.png');
          const currentPath = path.join(outDir, 'current.png');

          fs.mkdirSync(outDir, { recursive: true });
          fs.writeFileSync(baselinePath, PNG.sync.write(baselinePng));
          fs.writeFileSync(currentPath, PNG.sync.write(currentPng));

          const start = performance.now();
          let result: DiffResult;
          try {
            result = await generateDiff(
              baselinePath,
              currentPath,
              outDir,
              0.1,                // threshold
              false,              // includeAntiAliasing
              undefined,          // ignoreRegions
              false,              // ignorePageShift
              engine,             // diffEngine
            );
          } catch (err) {
            const durationMs = Math.round(performance.now() - start);
            ENGINE_RESULTS.push({
              engine,
              scenario: scenario.name,
              expectedDiff: scenario.expectedDiff,
              humanNoticeable: scenario.humanNoticeable,
              pixelDiff: 0,
              percentDiff: 0,
              durationMs,
              detectedDiff: false,
              error: (err as Error).message.slice(0, 80),
            });
            return;
          }
          const durationMs = Math.round(performance.now() - start);

          ENGINE_RESULTS.push({
            engine,
            scenario: scenario.name,
            expectedDiff: scenario.expectedDiff,
            humanNoticeable: scenario.humanNoticeable,
            pixelDiff: result.pixelDifference,
            percentDiff: result.percentageDifference,
            durationMs,
            detectedDiff: result.pixelDifference > 0,
          });

          // Sanity: valid output
          expect(result.pixelDifference).toBeGreaterThanOrEqual(0);
          expect(result.percentageDifference).toBeGreaterThanOrEqual(0);
          expect(result.percentageDifference).toBeLessThanOrEqual(100);
        }, 30_000);
      }
    });
  }
});
