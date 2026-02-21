# Feature Spec: Diff Engine Benchmark Framework

## Overview

Data-driven benchmark harness for comparing diff engines and text-region-aware diffing across realistic scenarios. Enables evidence-based engine configuration.

## Architecture

### Standalone Script
```bash
pnpm tsx src/lib/diff/benchmark-comparison.ts
```

### 13 Realistic Scenarios
| Category | Scenario | Description |
|----------|----------|-------------|
| Real screenshots | Same app, different scroll | Excalidraw at different positions |
| Controlled | Edge jitter (15/30/50px) | Simulates font rendering across OS |
| Controlled | AA fringe | Anti-aliasing rendering differences |
| Controlled | 1px layout shift | Sub-pixel content translation |
| Text-heavy | Jitter + AA on builds list | Real UI with text variations |
| Mixed | Excalidraw drawing | Vector + text content |
| Edge case | Identical images | Zero-diff baseline (correctness check) |

### Image Manipulation Functions
- `addSubPixelJitter(data, width, height, amount)` — Sine-based edge jitter simulating font rendering
- `shiftRegionColor(data, width, rect, rShift, gShift, bShift)` — RGB shifts in rectangles
- `shiftImage(data, width, height, dx, dy)` — Content translation
- `addAAFringe(data, width, height, amount)` — Anti-aliasing rendering differences

## Output

Three result tables:

### 1. Comparison Table
Standard vs text-aware diffing per engine:
- Diff pixels, percentage, execution time, reduction percentage

### 2. Details Table
Per-scenario breakdown:
- Text region diff pixels vs non-text region diff pixels
- OCR regions found
- OCR duration

### 3. Summary Table
Aggregate statistics:
- Average reduction per engine
- Performance analysis
- Success validation against criteria

## Success Criteria
| Criterion | Target |
|-----------|--------|
| Text jitter scenarios | ≥50% diff reduction with text-aware mode |
| Non-text changes | ≥95% diff retention (preserve genuine changes) |
| Identical images | 0% diff |
| OCR overhead | <100ms average |

## Vitest Integration
`src/lib/diff/generator.benchmark.test.ts`:
- 27 synthetic scenarios × 3 engines
- Tests dimension mismatch handling, anti-aliasing, threshold sensitivity
- Validates engine correctness and relative performance

## Key Files
| File | Purpose |
|------|---------|
| `src/lib/diff/benchmark-comparison.ts` (613 lines) | Standalone benchmark harness |
| `src/lib/diff/generator.benchmark.test.ts` | Vitest benchmark tests |
