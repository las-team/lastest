# Excalidraw Visual Regression Stabilization

## Problem
Excalidraw tests produce false positive pixel diffs due to non-deterministic rendering.

## Root Cause
Excalidraw uses roughjs for hand-drawn shapes. The rendering chain:
1. Global `Random(Date.now())` instance in `packages/common/src/random.ts`
2. `randomInteger()` calls `Random.next()` which uses `Math.imul(48271, seed)` — NOT Math.random()
3. Each element gets `seed: randomInteger()` at creation time
4. roughjs uses element seed for all stroke/fill rendering — deterministic per seed
5. **Problem**: Between Playwright actions, async callbacks fire non-deterministically, calling `randomInteger()` (for `versionNonce` updates), advancing the global RNG state. Later elements get different seeds -> different roughjs rendering.

## Stabilization Methods & Functions

### Effective

#### 1. Freeze `performance.now()` via addInitScript
- Playwright's `clock.setFixedTime()` does NOT freeze `performance.now()`
- Manual override: `performance.now = function() { return 1000; }`
- **Functions**: `setupFreezeScripts()` in `src/lib/playwright/stabilization.ts`, `packages/runner/src/stabilization.ts`

#### 2. Gate `requestAnimationFrame`
- RAF callback count between Playwright actions varies (6-8 per ~50ms)
- If any callback triggers `randomInteger()`, RNG drifts
- Override: queue RAF callbacks in a Map, flush deterministically before screenshots via `window.__flushAnimationFrames(n)`
- **Functions**: `FREEZE_ANIMATIONS_SCRIPT` in `src/lib/playwright/constants.ts`, `packages/runner/src/stabilization.ts`
- **Globals**: `window.__enableRAFGating()`, `window.__disableRAFGating()`, `window.__flushAnimationFrames(maxIterations)`

#### 3. Gate `setTimeout` with delay > 100ms
- Debounced operations (auto-save, collaboration sync, undo checkpoints) fire at variable intervals
- Override: queue callbacks for delay > 100ms, allow short timeouts for initialization
- Only RAF is flushed before screenshots; gated timeouts stay gated (flushing them caused side-effects)
- **Functions**: Same `FREEZE_ANIMATIONS_SCRIPT` as #2

#### 4. `CROSS_OS_CHROMIUM_ARGS` when `freezeAnimations` is true
- Args: `--disable-gpu`, `--disable-accelerated-2d-canvas`, `--disable-skia-runtime-opts`, `--font-render-hinting=none`, etc.
- Apply when either `crossOsConsistency` or `freezeAnimations` is true
- **Functions**: `CROSS_OS_CHROMIUM_ARGS` in `packages/runner/src/stabilization.ts`, browser launch in `runner.ts`

### Mixed Results

#### 5. `waitForCanvasStable()` — multi-evaluate polling loop
- Loop: flush RAF -> get canvas.toDataURL() -> wait 100ms -> repeat until stable
- Problem: the 100ms `page.waitForTimeout()` between checks allows short timeouts to fire non-deterministically
- **Functions**: `waitForCanvasStable()` in `src/lib/playwright/stabilization.ts`, `packages/runner/src/stabilization.ts`

#### 6. `waitForCanvasStable()` — single-evaluate approach
- Entire stability check in one `page.evaluate()`: no delays between iterations
- 30 iterations of flush(10) + canvas.toDataURL() comparison in single JS context
- Inconsistent — the variability happens BETWEEN Playwright actions, not at screenshot time

### Ineffective / Harmful — Do Not Use

#### 7. Override `Math.imul` to redirect roughjs RNG through `Math.random()`
- Broke per-element determinism: ALL Random instances shared single LCG sequence

#### 8. `clock.install()` + `setFixedTime()` for `performance.now()`
- `performance.now()` still returns real time even with clock.install() + setFixedTime()

#### 9. `disableImageSmoothing` on canvas 2D contexts
- Override `HTMLCanvasElement.prototype.getContext` to set `imageSmoothingEnabled = false`
- Changed how existing canvas content renders, creating new diffs rather than fixing non-determinism
- **Setting exists but should remain OFF**

#### 10. Font pre-loading (Virgil, Excalifont, Cascadia) + resize event
- resize event on Excalidraw triggers full canvas re-render with different RNG state

#### 11. Gate `MessageChannel` (React scheduler)
- Flushing MC callbacks during screenshots added more non-deterministic React work to the flush cycle

#### 12. Aggressive RAF flush (50 iterations)
- May create infinite loop if RAF callbacks keep scheduling new callbacks — use 10

## Files Modified
1. `src/lib/playwright/constants.ts` — FREEZE_ANIMATIONS_SCRIPT with RAF gating, setTimeout gating
2. `src/lib/playwright/stabilization.ts` — performance.now freeze, waitForCanvasStable
3. `packages/runner/src/stabilization.ts` — Mirror of above
4. `packages/runner/src/runner.ts` — CROSS_OS_CHROMIUM_ARGS when freezeAnimations=true
5. `src/lib/playwright/runner.ts` — Same chromium args change
6. `src/lib/db/schema.ts` — waitForCanvasStable, canvasStableTimeout, canvasStableThreshold, disableImageSmoothing
7. `src/lib/ws/protocol.ts` — StabilizationPayload fields
8. `packages/runner/src/protocol.ts` — Same protocol changes
9. `src/lib/execution/executor.ts` — buildStabilizationPayload

## Stabilization Settings (excalidraw repo)
```json
{
  "waitForCanvasStable": true,
  "canvasStableTimeout": 3000,
  "canvasStableThreshold": 2,
  "disableImageSmoothing": false,
  "freezeAnimations": true,
  "crossOsConsistency": true,
  "freezeTimestamps": true,
  "freezeRandomValues": true
}
```

## Untried Approaches
1. Gating ALL timeouts (including 0-100ms) — risk of breaking initialization
2. Gating `queueMicrotask` / Promises — would break everything
3. Route interception to modify Excalidraw JS bundle and expose `reseed()` on window
4. Resetting Excalidraw's global RNG state before each Playwright action
5. Using Playwright's `page.route()` to patch roughjs to use a different RNG
6. Per-screenshot RNG reset via exposed window function
7. Reducing setTimeout gate threshold from 100ms to lower value

## Operational Notes
- Runner must be restarted after builds: `pnpm lastest2-runner stop && pnpm lastest2-runner start`
- Test command: `pnpm lastest2-runner trigger --repo ewyct/excalidraw_test`
- Success criteria: two consecutive runs produce identical diff percentages
