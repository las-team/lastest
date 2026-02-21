# Feature Spec: Page Shift Detection

## Overview

LCS (Longest Common Subsequence) row-alignment algorithm that detects content shifts in full-page screenshots — distinguishing moved content from actual visual changes.

## Problem

Full-page screenshots vary in height (content length). When content is added/removed (e.g., a banner), all subsequent content shifts down, causing massive false-positive diffs.

## Solution

### Dimension Normalization
1. **Width**: crop both images to minimum width (left-aligned layout assumption)
2. **Height**: pad shorter image with detected background color

### Page Shift Detection (LCS Row Alignment)
1. Hash all rows with quantized RGB (`>> 4`, sub-pixel rendering tolerance)
2. Build LCS DP table (m × n where m, n = heights)
3. Traceback to extract alignment operations: `'match'`, `'insert'`, `'delete'`
4. Guard: fall back to sequential matching if m×n > 50M cells (OOM prevention)

### Fuzzy Matching
Post-process to pair near-identical delete/insert rows:
- Compare using pixelmatch, threshold < 0.5 → reclassify as `'match'`
- Distinguishes "reordering" from "change"

### Aligned Image Building
- Match rows: copy from both
- Insert rows: current + baseline filled with background
- Delete rows: baseline + current filled with background

### Color-Coded Diff
- Matched rows: standard pixelmatch diff
- Inserted rows: green tint (new content)
- Deleted rows: red tint (removed content)

## Data Model

```typescript
interface PageShiftInfo {
  detected: boolean;
  deltaY: number;                           // vertical shift (+down, -up)
  confidence: number;                       // matchedRows / totalRows
  insertedRows?: number;
  deletedRows?: number;
  alignedBaselineImagePath?: string;
  alignedCurrentImagePath?: string;
  alignedDiffImagePath?: string;
  alignmentSegments?: AlignmentSegment[];   // RLE-compressed operations
}
```

## Configuration
- Parameter: `generateDiff(..., ignorePageShift = true)`
- When enabled: diff pixels counted only from matched rows (excludes shifted content)

## Key Files
| File | Purpose |
|------|---------|
| `src/lib/diff/generator.ts` | `generateShiftAwareDiff()`, `alignRows()`, `fuzzyMatchUnalignedRows()` |

## Performance
- LCS DP table (1080×1080): ~4.6 MB
- 50M cell guard prevents OOM on very tall pages
- Quantized hashing with 4-bit RGB tolerance for sub-pixel rendering differences
