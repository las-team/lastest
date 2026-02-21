# Feature Spec: Runner Exported Functions

## Overview

Three key functions from `runner.ts` are now publicly exported for use by other modules (debug-runner, test files, setup scripts).

## `createAppState(page: Page): AppState`

Factory for application state accessor. Allows tests to assert on internal application state.

```typescript
interface AppState {
  get(path: string): Promise<unknown>;         // Get by dot-notation path
  getHistoryLength(): Promise<number>;         // Undo/redo history length
  getAll(): Promise<unknown>;                  // Entire state object
  evaluate<T>(accessor: string): Promise<T>;   // Custom accessor expression
}
```

**Usage**:
```javascript
const state = createAppState(page);
const count = await state.get('store.counter');
const isOpen = await state.get('ui.modalOpen');
```

## `createExpect(timeout = 5000): ExpectFunction`

Factory for custom expect implementation matching Playwright's API.

**Page matchers**:
- `expect(page).toHaveURL(expected, options?)`
- `expect(page).toHaveTitle(expected, options?)`
- `.not.toHaveURL(...)`, `.not.toHaveTitle(...)`

**Locator matchers**:
- `toBeVisible`, `toBeHidden`, `toBeAttached`, `toBeDetached`
- `toHaveText`, `toContainText`, `toHaveValue`
- `toBeEnabled`, `toBeDisabled`, `toBeChecked`

Each matcher accepts `{ timeout }` option; defaults to factory parameter.

## `stripTypeAnnotations(code: string): string`

Removes TypeScript type annotations so test code runs as plain JavaScript.

**Patterns removed**:
- Variable annotations: `const x: Type = ...` → `const x = ...`
- Destructured annotations: `const { a, b }: Type = ...` → `const { a, b } = ...`
- `as` assertions: `expr as Type` → `expr`
- Angle-bracket assertions: `<Type>expr` → `expr`

**Note**: Was previously only a private method on `PlaywrightRunner` class. Now exported as standalone function.

## Key Files
| File | Purpose |
|------|---------|
| `src/lib/playwright/runner.ts` | All three functions |
| `src/lib/playwright/debug-runner.ts` | Consumer |
| `src/lib/setup/script-runner.ts` | Consumer |

## Tests
- `src/lib/playwright/runner.test.ts` — Tests for stripTypeAnnotations, createExpect
