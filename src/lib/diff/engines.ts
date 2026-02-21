/**
 * Multi-Engine Visual Diffing
 *
 * Three comparison engines:
 * - pixelmatch (default) — pixel-perfect binary comparison
 * - ssim — structural similarity index (perceptual)
 * - butteraugli — human-perception-aligned via CIELAB color space
 */

import pixelmatch from 'pixelmatch';

export type DiffEngineType = 'pixelmatch' | 'ssim' | 'butteraugli';

export interface EngineResult {
  diffPixelCount: number;
  diffData: Buffer;
}

// ---------------------------------------------------------------------------
// Pixelmatch engine (wrapper for consistency)
// ---------------------------------------------------------------------------
export function computePixelmatch(
  baselineData: Buffer | Uint8Array,
  currentData: Buffer | Uint8Array,
  width: number,
  height: number,
  threshold: number,
  includeAA: boolean
): EngineResult {
  const diffData = Buffer.alloc(width * height * 4);
  const diffPixelCount = pixelmatch(
    baselineData,
    currentData,
    diffData,
    width,
    height,
    { threshold, includeAA }
  );
  return { diffPixelCount, diffData };
}

// ---------------------------------------------------------------------------
// SSIM engine — Structural Similarity Index
// ---------------------------------------------------------------------------

const SSIM_K1 = 0.01;
const SSIM_K2 = 0.03;
const SSIM_L = 255; // dynamic range
const SSIM_C1 = (SSIM_K1 * SSIM_L) ** 2;
const SSIM_C2 = (SSIM_K2 * SSIM_L) ** 2;
const SSIM_WINDOW = 8;
const SSIM_INTENSITY_THRESHOLD = 0.01;

function toLuminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function computeSSIM(
  baselineData: Buffer | Uint8Array,
  currentData: Buffer | Uint8Array,
  width: number,
  height: number
): EngineResult {
  const diffData = Buffer.alloc(width * height * 4);
  let diffPixelCount = 0;

  // Build luminance arrays
  const lumA = new Float64Array(width * height);
  const lumB = new Float64Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    lumA[i] = toLuminance(baselineData[idx], baselineData[idx + 1], baselineData[idx + 2]);
    lumB[i] = toLuminance(currentData[idx], currentData[idx + 1], currentData[idx + 2]);
  }

  // Per-pixel SSIM from overlapping windows
  const ssimMap = new Float64Array(width * height);
  ssimMap.fill(1.0); // default: identical

  for (let wy = 0; wy <= height - SSIM_WINDOW; wy++) {
    for (let wx = 0; wx <= width - SSIM_WINDOW; wx++) {
      let sumA = 0, sumB = 0, sumA2 = 0, sumB2 = 0, sumAB = 0;
      const n = SSIM_WINDOW * SSIM_WINDOW;

      for (let dy = 0; dy < SSIM_WINDOW; dy++) {
        for (let dx = 0; dx < SSIM_WINDOW; dx++) {
          const idx = (wy + dy) * width + (wx + dx);
          const a = lumA[idx];
          const b = lumB[idx];
          sumA += a;
          sumB += b;
          sumA2 += a * a;
          sumB2 += b * b;
          sumAB += a * b;
        }
      }

      const muA = sumA / n;
      const muB = sumB / n;
      const sigA2 = sumA2 / n - muA * muA;
      const sigB2 = sumB2 / n - muB * muB;
      const sigAB = sumAB / n - muA * muB;

      const ssim = ((2 * muA * muB + SSIM_C1) * (2 * sigAB + SSIM_C2)) /
                   ((muA * muA + muB * muB + SSIM_C1) * (sigA2 + sigB2 + SSIM_C2));

      // Apply to all pixels in the window (take min of overlapping windows)
      for (let dy = 0; dy < SSIM_WINDOW; dy++) {
        for (let dx = 0; dx < SSIM_WINDOW; dx++) {
          const idx = (wy + dy) * width + (wx + dx);
          ssimMap[idx] = Math.min(ssimMap[idx], ssim);
        }
      }
    }
  }

  // Convert SSIM map to diff pixels
  for (let i = 0; i < width * height; i++) {
    const intensity = 1.0 - ssimMap[i];
    const idx = i * 4;

    if (intensity > SSIM_INTENSITY_THRESHOLD) {
      diffPixelCount++;
      // 4× intensity boost for visibility, clamped to 255
      const vis = Math.min(255, Math.round(intensity * 4 * 255));
      diffData[idx] = vis;       // R
      diffData[idx + 1] = 0;     // G
      diffData[idx + 2] = 0;     // B
      diffData[idx + 3] = 255;   // A
    } else {
      diffData[idx] = 0;
      diffData[idx + 1] = 0;
      diffData[idx + 2] = 0;
      diffData[idx + 3] = 0;
    }
  }

  return { diffPixelCount, diffData };
}

// ---------------------------------------------------------------------------
// Butteraugli engine — human-perception-aligned via CIELAB
// ---------------------------------------------------------------------------

// sRGB → Linear RGB → XYZ → L*a*b* conversion
function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function linearToXYZ(r: number, g: number, b: number): [number, number, number] {
  return [
    0.4124564 * r + 0.3575761 * g + 0.1804375 * b,
    0.2126729 * r + 0.7151522 * g + 0.0721750 * b,
    0.0193339 * r + 0.1191920 * g + 0.9503041 * b,
  ];
}

// D65 white point
const XN = 0.95047;
const YN = 1.00000;
const ZN = 1.08883;

function labF(t: number): number {
  return t > 0.008856 ? t ** (1 / 3) : (903.3 * t + 16) / 116;
}

function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  const [x, y, z] = linearToXYZ(lr, lg, lb);

  const fx = labF(x / XN);
  const fy = labF(y / YN);
  const fz = labF(z / ZN);

  const L = 116 * fy - 16;
  const a = 500 * (fx - fy);
  const bLab = 200 * (fy - fz);

  return [L, a, bLab];
}

// Multi-scale weights (scales: 1, 2, 4, 8 pixels)
const SCALE_WEIGHTS = [0.4, 0.3, 0.2, 0.1];
const JND_THRESHOLD = 1.0; // Just Noticeable Difference
const LUMINANCE_WEIGHT = 1.0;
const CHROMA_WEIGHT = 0.7;

function downscale2x(
  lab: Float64Array,
  width: number,
  height: number,
  components: number
): { data: Float64Array; w: number; h: number } {
  const w2 = Math.floor(width / 2);
  const h2 = Math.floor(height / 2);
  const out = new Float64Array(w2 * h2 * components);

  for (let y = 0; y < h2; y++) {
    for (let x = 0; x < w2; x++) {
      for (let c = 0; c < components; c++) {
        const idx = (y * w2 + x) * components + c;
        const s00 = lab[((y * 2) * width + (x * 2)) * components + c];
        const s10 = lab[((y * 2) * width + (x * 2 + 1)) * components + c];
        const s01 = lab[((y * 2 + 1) * width + (x * 2)) * components + c];
        const s11 = lab[((y * 2 + 1) * width + (x * 2 + 1)) * components + c];
        out[idx] = (s00 + s10 + s01 + s11) / 4;
      }
    }
  }

  return { data: out, w: w2, h: h2 };
}

function deltaEMap(
  labA: Float64Array,
  labB: Float64Array,
  width: number,
  height: number
): Float64Array {
  const map = new Float64Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const idx = i * 3;
    const dL = labA[idx] - labB[idx];
    const da = labA[idx + 1] - labB[idx + 1];
    const db = labA[idx + 2] - labB[idx + 2];
    // CIE76 delta-E with luminance/chroma weighting
    map[i] = Math.sqrt(LUMINANCE_WEIGHT * dL * dL + CHROMA_WEIGHT * (da * da + db * db));
  }
  return map;
}

function upscale(
  map: Float64Array,
  srcW: number,
  srcH: number,
  targetW: number,
  targetH: number
): Float64Array {
  const out = new Float64Array(targetW * targetH);
  for (let y = 0; y < targetH; y++) {
    for (let x = 0; x < targetW; x++) {
      const sx = Math.min(Math.floor(x * srcW / targetW), srcW - 1);
      const sy = Math.min(Math.floor(y * srcH / targetH), srcH - 1);
      out[y * targetW + x] = map[sy * srcW + sx];
    }
  }
  return out;
}

export function computeButteraugli(
  baselineData: Buffer | Uint8Array,
  currentData: Buffer | Uint8Array,
  width: number,
  height: number
): EngineResult {
  const diffData = Buffer.alloc(width * height * 4);
  let diffPixelCount = 0;

  const n = width * height;

  // Convert both images to L*a*b*
  const labA = new Float64Array(n * 3);
  const labB = new Float64Array(n * 3);

  for (let i = 0; i < n; i++) {
    const idx = i * 4;
    const [lA, aA, bA] = rgbToLab(baselineData[idx], baselineData[idx + 1], baselineData[idx + 2]);
    labA[i * 3] = lA;
    labA[i * 3 + 1] = aA;
    labA[i * 3 + 2] = bA;

    const [lB, aB, bB] = rgbToLab(currentData[idx], currentData[idx + 1], currentData[idx + 2]);
    labB[i * 3] = lB;
    labB[i * 3 + 1] = aB;
    labB[i * 3 + 2] = bB;
  }

  // Multi-scale decomposition: compute delta-E at multiple scales and combine
  const combinedMap = new Float64Array(n);

  let curLabA: Float64Array<ArrayBufferLike> = labA;
  let curLabB: Float64Array<ArrayBufferLike> = labB;
  let curW = width;
  let curH = height;

  for (let s = 0; s < SCALE_WEIGHTS.length; s++) {
    const dMap = deltaEMap(curLabA, curLabB, curW, curH);

    // Upscale to original resolution if needed
    const fullMap = (curW === width && curH === height)
      ? dMap
      : upscale(dMap, curW, curH, width, height);

    for (let i = 0; i < n; i++) {
      combinedMap[i] += SCALE_WEIGHTS[s] * fullMap[i];
    }

    // Downscale for next level
    if (s < SCALE_WEIGHTS.length - 1) {
      const dsA = downscale2x(curLabA, curW, curH, 3);
      const dsB = downscale2x(curLabB, curW, curH, 3);
      curLabA = dsA.data;
      curLabB = dsB.data;
      curW = dsA.w;
      curH = dsA.h;

      if (curW < 2 || curH < 2) break;
    }
  }

  // Threshold and color-map the diff output
  for (let i = 0; i < n; i++) {
    const dE = combinedMap[i];
    const idx = i * 4;

    if (dE > JND_THRESHOLD) {
      diffPixelCount++;
      // Color-mapped: yellow → orange → red → magenta
      const t = Math.min(dE / 10, 1); // normalize to 0-1 range (10 dE = full)
      let r: number, g: number, b: number;
      if (t < 0.33) {
        // yellow → orange
        const s = t / 0.33;
        r = 255;
        g = Math.round(255 * (1 - 0.5 * s));
        b = 0;
      } else if (t < 0.66) {
        // orange → red
        const s = (t - 0.33) / 0.33;
        r = 255;
        g = Math.round(128 * (1 - s));
        b = 0;
      } else {
        // red → magenta
        const s = (t - 0.66) / 0.34;
        r = 255;
        g = 0;
        b = Math.round(255 * s);
      }
      diffData[idx] = r;
      diffData[idx + 1] = g;
      diffData[idx + 2] = b;
      diffData[idx + 3] = 255;
    } else {
      diffData[idx] = 0;
      diffData[idx + 1] = 0;
      diffData[idx + 2] = 0;
      diffData[idx + 3] = 0;
    }
  }

  return { diffPixelCount, diffData };
}

// ---------------------------------------------------------------------------
// Engine dispatch
// ---------------------------------------------------------------------------

export function runDiffEngine(
  engineType: DiffEngineType,
  baselineData: Buffer | Uint8Array,
  currentData: Buffer | Uint8Array,
  width: number,
  height: number,
  threshold: number,
  includeAA: boolean
): EngineResult {
  switch (engineType) {
    case 'ssim':
      return computeSSIM(baselineData, currentData, width, height);
    case 'butteraugli':
      return computeButteraugli(baselineData, currentData, width, height);
    case 'pixelmatch':
    default:
      return computePixelmatch(baselineData, currentData, width, height, threshold, includeAA);
  }
}
