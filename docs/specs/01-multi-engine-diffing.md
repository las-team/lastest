# Feature Spec: Multi-Engine Visual Diffing

## Overview

Replaces the single pixelmatch approach with a pluggable diff engine architecture supporting three comparison algorithms, each targeting different sensitivity needs.

## Engines

### Pixelmatch (Default)
- Pixel-perfect binary comparison with configurable threshold
- Fast (microseconds per image)
- Best for: strict layout regression, CI gating
- Trade-off: false positives from font rendering variations across OS

### SSIM (Structural Similarity Index)
- Converts images to luminance, computes local SSIM in 8×8 sliding windows
- Constants: K1=0.01, K2=0.03, intensity threshold=0.01
- Per-pixel SSIM from overlapping windows, 4× intensity boost for visibility
- Best for: perceptual comparison tolerant of rendering noise
- Trade-off: slower than pixelmatch, still strict on color fidelity

### Butteraugli (Human Perception-Aligned)
- Google's advanced perceptual metric
- sRGB → Linear RGB → XYZ → L\*a\*b\* (CIELAB color space)
- Multi-scale decomposition (4 scales: 1, 2, 4, 8 pixels) with weights [0.4, 0.3, 0.2, 0.1]
- CIE76 delta-E with JND threshold of 1.0 (imperceptible to human eye)
- Luminance weight 1.0, chroma weight 0.7
- Color-mapped diff output: yellow → orange → red → magenta
- Best for: UI testing where human perception matters, cross-platform consistency
- Trade-off: most computationally expensive

## Architecture

### Type System
```typescript
type DiffEngineType = 'pixelmatch' | 'ssim' | 'butteraugli';

interface EngineResult {
  diffPixelCount: number;
  diffData: Buffer;
}
```

### Engine Selection
Parameter in `generateDiff(..., diffEngine: DiffEngineType)` dispatches to the appropriate engine function:
- `computeSSIM(baselineData, currentData, width, height)` → `EngineResult`
- `computeButteraugli(baselineData, currentData, width, height)` → `EngineResult`
- `pixelmatch(...)` → default fallback

### Database Schema
Stored in `diffSensitivitySettings` table:
- `diffEngine` (text, default: `'pixelmatch'`)

### Default Settings
```typescript
const DEFAULT_DIFF_THRESHOLDS = {
  unchangedThreshold: 0.05,
  flakyThreshold: 10,
  includeAntiAliasing: false,
  ignorePageShift: false,
  diffEngine: 'pixelmatch',
  // ...
};
```

## Key Files
| File | Purpose |
|------|---------|
| `src/lib/diff/engines.ts` (352 lines) | `computeSSIM`, `computeButteraugli` implementations |
| `src/lib/diff/generator.ts` | Engine dispatch in `generateDiff()` |
| `src/lib/db/schema.ts` | `DiffEngineType` type, `diffSensitivitySettings` table |
| `src/components/settings/diff-sensitivity-card.tsx` | Engine selection UI (Engine tab) |

## UI Integration
Settings → Diff Sensitivity → Engine tab:
- Dropdown to select engine
- Comparison table (speed, AA filtering, perceptual quality, false positive rate)
- Compatibility guide tab explains how Playwright settings interact with each engine

## Tests
- `src/lib/diff/engines.test.ts` — 8 tests: pixelmatch integration, threshold sensitivity
- `src/lib/diff/generator.benchmark.test.ts` — 27 synthetic scenarios × 3 engines
