# Feature Spec: Cross-OS Screenshot Stabilization

## Overview

Ensures deterministic, pixel-reproducible screenshots across Windows, macOS, and Linux by controlling time, randomness, animations, fonts, network, and rendering.

## Architecture

Two-phase execution model:
1. **Pre-navigation** (`setupFreezeScripts`) — inject init scripts before page loads
2. **Post-navigation** (`applyStabilization`) — apply CSS, waits, fonts after page loads

### Execution Flow
```
Browser launch with CROSS_OS_CHROMIUM_ARGS
  → setupFreezeScripts() — inject timestamp/random before navigation
  → page.goto(url)
  → applyStabilization() — CSS, fonts, waits
  → page.screenshot() — deterministic result
```

## Components

### 1. Timestamp Freezing (`getFreezeTimestampsScript`)
Replaces global `Date` object via `page.addInitScript()`:
- `new Date()` → frozen date
- `new Date(args)` → normal constructor (parametric use preserved)
- `Date.now()` → frozen timestamp
- Preserves `Date.parse()`, `Date.UTC()`

### 2. Random Value Seeding (`getFreezeRandomScript`)
Replaces `Math.random()` with seeded LCG (Linear Congruential Generator):
- Multiplier: `1103515245` (glibc standard)
- Increment: `12345`
- Modulus: `0x7fffffff` (31-bit positive)
- Produces deterministic sequence of floats in [0, 1)

### 3. Animation Freezing (`FREEZE_ANIMATIONS_CSS`)
Simple CSS injection via `page.addStyleTag()`:
```css
*, *::before, *::after {
  animation: none !important;
  transition: none !important;
  animation-delay: 0s !important;
  transition-delay: 0s !important;
}
```
Changed from master: was complex JavaScript interception of Web Animations API, `requestAnimationFrame`, `setTimeout`, `setInterval`, animated GIFs → now CSS-only (simpler, sufficient for 95% of cases).

### 4. Font Normalization
Two modes:
- **Cross-OS Consistency** (`crossOsConsistency: true`): Reads bundled Inter font from `public/fonts/inter-regular.woff2`, encodes as base64 data URI, injects as `@font-face` + `font-family: 'Inter' !important` on all elements. Result cached.
- **System Fonts** (`disableWebfonts: true`): Injects `SYSTEM_FONTS_CSS` using `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, ...`

### 5. Spinner Hiding (`HIDE_SPINNERS_CSS`)
30+ selectors matching common frameworks (MUI, Ant, Chakra, plus generic patterns):
```css
[class*="spinner"], [class*="loading"], [class*="loader"],
[aria-busy="true"], [data-loading="true"],
.MuiCircularProgress-root, .ant-spin, .chakra-spinner, ...
{
  visibility: hidden !important;
  opacity: 0 !important;
}
```
Keeps spinners in DOM (for wait functions) but visually hidden.

### 6. Stability Waits
- **`waitForStylesLoaded()`** — `document.fonts.ready` + all `<link rel="stylesheet">` loaded. Prevents FOUC.
- **`waitForDomStable(timeout, stableMs=200)`** — MutationObserver waits for no DOM mutations for `stableMs`. Handles React/Vue re-renders.
- **`waitForSpinnersToDisappear()`** — Waits for 30+ loading indicator selectors to become hidden. Uses `Promise.race()` for early exit.
- **Network idle** — Optional wait for no inflight requests.

### 7. Third-Party Blocking (`setupThirdPartyBlocking`)
Route interception via `page.route('**/*')`:
- **Allowed**: target domain, localhost, 127.0.0.1, custom `allowedDomains`
- **Blocked**: third-party scripts, stylesheets, XHR, fetch
- **Mocked**: third-party images → 1×1 transparent PNG placeholder
- **Passed through**: fonts, media

### 8. Chromium Launch Args (`CROSS_OS_CHROMIUM_ARGS`)
```
--font-render-hinting=none
--disable-font-subpixel-positioning
--disable-lcd-text
--disable-gpu
--force-color-profile=srgb
--hide-scrollbars
```

## Configuration (`StabilizationSettings`)

```typescript
interface StabilizationSettings {
  freezeTimestamps: boolean;          // default: true
  frozenTimestamp: string;            // default: '2025-01-01T12:00:00Z'
  freezeRandomValues: boolean;        // default: true
  randomSeed: number;                 // default: 12345
  waitForNetworkIdle: boolean;        // default: true
  networkIdleTimeout: number;         // default: 30000
  waitForFonts: boolean;              // default: true
  waitForDomStable: boolean;          // default: true
  domStableTimeout: number;           // default: 5000
  crossOsConsistency: boolean;        // default: true (bundled Inter font)
  disableWebfonts: boolean;           // default: false (system fonts)
  hideLoadingIndicators: boolean;     // default: true
  loadingSelectors: string[];         // default: [] (custom selectors)
  blockThirdParty: boolean;           // default: true
  allowedDomains: string[];           // default: []
  mockThirdPartyImages: boolean;      // default: true
}
```

## Key Files
| File | Purpose |
|------|---------|
| `src/lib/playwright/stabilization.ts` (~400 lines) | Core functions, waits, third-party blocking |
| `src/lib/playwright/constants.ts` (~115 lines) | CSS, fonts, browser args, placeholder image |
| `src/lib/db/schema.ts` | `StabilizationSettings` interface, `DEFAULT_STABILIZATION_SETTINGS` |

## Tests
- `src/lib/playwright/stabilization.test.ts` — 12 tests: freeze timestamp/random script generation, LCG algorithm
- `src/lib/playwright/constants.test.ts` — 24 tests: CSS validation, chromium args, placeholder image

## Removed from Master
- `FREEZE_ANIMATIONS_SCRIPT` (complex JS) → replaced by `FREEZE_ANIMATIONS_CSS` (simple CSS)
- `waitForImages` / `waitForImagesTimeout` settings removed
- Scroll behavior CSS removed
