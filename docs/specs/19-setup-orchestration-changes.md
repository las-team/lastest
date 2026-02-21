# Feature Spec: Setup Orchestration Changes

## Overview

Enhanced setup system supporting test-as-setup pattern with extended helper function injection, explicit failure on missing references, and teardown removal.

## Helper Function Injection

### Setup Script Runner (`src/lib/setup/script-runner.ts`)

**Old**: 6-parameter function signature
```typescript
async function test(page, baseUrl, stepLogger, expect, appState, locateWithFallback)
```

**New**: 11-parameter function signature (matches runner.ts)
```typescript
async function test(
  page, baseUrl, stepLogger, expect, appState, locateWithFallback,
  fileUpload,          // NEW — Functional
  clipboard,           // NEW — Stub (null)
  downloads,           // NEW — Stub (null)
  network              // NEW — Stub (null)
)
```

### Helper Implementations
- **fileUpload**: Fully functional — `page.locator(selector).setInputFiles(filePaths)`
- **clipboard**: `null` (setup has no clipboard access)
- **downloads**: `null` (setup skips downloads)
- **network**: `null` (setup has no network interception)

## Error Handling

### Missing Setup References
- **Old**: Missing setup test/script → logs warning, returns `{ success: true }`
- **New**: Returns `{ success: false, error: "Setup test not found: {id}" }`

Rationale: Orphaned setup references should be explicit failures, not silent successes.

## Teardown Removal

### Removed
- `TeardownOrchestrator` class
- `getTeardownOrchestrator()` function
- `testNeedsTeardown()` function
- `defaultTeardownSteps` table
- `teardownOverrides` field from tests
- `teardownStatus`, `teardownError`, `teardownDurationMs` from builds

### Rationale
Tests should handle cleanup in their own code. Separate teardown orchestration added complexity without proportional benefit.

## Test-as-Setup Pattern

Now possible to:
1. Record a test normally
2. Reuse test code as a setup step for other tests
3. File uploads work in setup context
4. Other capabilities gracefully degrade to null (no errors, just unavailable)

## Key Files
| File | Purpose |
|------|---------|
| `src/lib/setup/script-runner.ts` | Setup script execution with helpers |
| `src/lib/setup/setup-orchestrator.ts` | Setup step orchestration |
| `src/lib/setup/types.ts` | Setup type definitions |
| `src/lib/setup/index.ts` | Exports (teardown removed) |
