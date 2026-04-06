# Feature Spec: Playwright Code Transformer

## Overview

One-way transformation from Playwright Inspector codegen output to the Lastest runner format. Handles URL rewriting, import removal, indentation normalization, and function signature wrapping.

## Transformation Pipeline

### Input (Playwright codegen)
```javascript
import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://example.com/path');
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page).toHaveURL('https://example.com/result');
});
```

### Output (Lastest runner format)
```javascript
export async function test(page, baseUrl, screenshotPath, stepLogger) {
  const buildUrl = (base, path) => new URL(path, base).href;
  const getScreenshotPath = (label) => screenshotPath.replace('.png', `-${label}.png`);

  await page.goto(buildUrl(baseUrl, '/path'));
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page).toHaveURL(buildUrl(baseUrl, '/result'));
}
```

## Transformation Steps

### 1. `extractTestBody(code)`
Extracts function body from various codegen formats:
- `test('name', async ({ page }) => { ... })`
- `test('name', async ({ page }) => { ... })` (no semicolon)
- `async ({ page }) => { ... }` (bare async)
- Multiple test blocks (takes first)

### 2. `transformGotoStatements(code, baseUrlOrigin)`
Converts absolute URLs to `buildUrl()` calls:
- `page.goto('https://example.com/path')` with matching origin → `page.goto(buildUrl(baseUrl, '/path'))`
- `page.goto('/path')` → `page.goto(buildUrl(baseUrl, '/path'))`
- External URLs (different origin) → unchanged

### 3. `removeImports(code)`
Strips all `import` and `require()` statements.

### 4. `cleanupCode(code)`
- Removes leading/trailing empty lines
- Finds minimum indent across non-empty lines
- Adds 2-space indent for function body

### 5. `wrapInRunnerFormat(body)`
Wraps body in Lastest signature with helper functions:
- `buildUrl(base, path)` — URL resolution
- `getScreenshotPath(label)` — Screenshot naming convention

## Key Files
| File | Purpose |
|------|---------|
| `src/lib/playwright/code-transformer.ts` (~220 lines) | Full transformer |

## Tests
- `src/lib/playwright/code-transformer.test.ts` — 18 tests: format patterns, URL transformation, import removal, indentation
