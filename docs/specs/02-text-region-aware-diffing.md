# Feature Spec: Text-Region-Aware Diffing

## Overview

OCR-based two-pass diffing that detects text regions in screenshots and applies separate thresholds for text vs non-text areas. Reduces false positives from dynamic text (timestamps, counters) and cross-OS font rendering differences.

## Problem

Standard pixel diffing treats all pixels equally. Dynamic text (timestamps, user counts) and font rendering variations across OS/browsers cause test flakiness unrelated to actual UI regressions.

## Solution: Two-Pass OCR Comparison

### Detection Pipeline (`detectTextRegions`)
1. Dynamically imports Tesseract.js (10s timeout)
2. Extracts blocks → paragraphs → lines → words with bounding boxes
3. Filters by confidence (default: 50/100)
4. Three granularity levels:
   - `'word'` — individual words (precise, slower)
   - `'line'` — grouped by line (balanced)
   - `'block'` — entire text blocks (fast, coarse)

### Output
```typescript
interface TextRegionResult {
  regions: Rectangle[];
  mask: Uint8Array;        // 1 byte per pixel: text=1, non-text=0
  ocrDurationMs: number;
  totalTextPixels: number;
}
```

### Two-Pass Execution (`generateTextAwareDiff`)
1. **Non-text pass**: Blank text regions in both images (fill with magenta), use strict threshold (e.g., 0.1) → detects layout/color changes
2. **Text pass**: Blank non-text regions in both images (fill with magenta), use lenient threshold (e.g., 0.3) → tolerates font rendering
3. **Combine**: Merge non-zero pixels from both diff outputs into a single diff image

### Fallback
If no text detected → falls back to standard `generateDiff` with the non-text threshold.

## Configuration

```typescript
interface TextAwareDiffOptions {
  textRegionThreshold: number;           // lenient threshold for text (e.g., 0.3)
  nonTextThreshold: number;              // strict threshold for non-text (e.g., 0.1)
  textRegionPadding: number;             // bbox expansion in pixels (default: 4)
  includeAntiAliasing: boolean;
  textDetectionGranularity: 'word' | 'line' | 'block';
}
```

### Database Schema
Fields in `diffSensitivitySettings` table:
- `textRegionAwareDiffing` (boolean, default: `false`) — opt-in
- `textRegionThreshold` (integer, default: `30`) — percentage, stored as 30 = 0.3
- `textRegionPadding` (integer, default: `4`) — pixels to expand bounding boxes
- `textDetectionGranularity` (text, default: `'word'`)

### DiffMetadata Additions
```typescript
interface DiffMetadata {
  textRegions?: Rectangle[];
  textRegionDiffPixels?: number;
  nonTextRegionDiffPixels?: number;
  ocrDurationMs?: number;
}
```

## Rectangle Operations
- `mergeTextMasks()` — unions text regions from baseline + current images
- `mergeOverlappingRectangles()` — iterative multi-pass merge (strict overlap detection)
- `expandRectangle(rect, padding)` — padding around detected text
- `clampRectangle(rect, width, height)` — bounds enforcement
- `createTextMaskBitmap(regions, width, height)` — per-pixel bitmap for masking

## Key Files
| File | Purpose |
|------|---------|
| `src/lib/diff/text-regions.ts` (357 lines) | Detection, masking, merging |
| `src/lib/diff/generator.ts` | `generateTextAwareDiff()` orchestration |
| `src/lib/diff/index.ts` | Public exports |
| `src/components/settings/diff-sensitivity-card.tsx` | Text-region settings UI |

## UI Integration
Settings → Diff Sensitivity → below the tabs:
- Toggle for `textRegionAwareDiffing`
- When enabled:
  - Text Region Tolerance slider (1-100%, default 30)
  - Text Region Padding slider (0-20px, default 4)
  - Detection Granularity dropdown (Word / Line / Block)

## Performance
- Tesseract.js: typically 100-500ms per image, 50-100MB memory
- Dynamic import (loaded only when text-aware diffing is enabled)
- Parallel OCR detection on baseline + current images simultaneously

## Tests
- `src/lib/diff/text-regions.test.ts` — 10 tests: rectangle merge, masking, bitmap creation
