# Specification: Fix Smoke Test Error Detection

## Overview

Tests that navigate to endpoints returning 404 or other HTTP errors are currently passing when they should fail. The smoke test code generator creates proper error detection code (using `page.on()` listeners and `expect()` assertions), but the PlaywrightRunner's `executeLine()` method doesn't actually execute these error-checking patterns. This task fixes the runner to properly detect and fail on network errors (HTTP 400+) and console errors during smoke test execution.

## Workflow Type

**Type**: feature

**Rationale**: This requires adding new functionality to the PlaywrightRunner to capture and validate HTTP responses and console messages. While it involves modifying existing code, it's adding a new capability (automatic error detection) rather than fixing a code bug.

## Task Scope

### Services Involved
- **frontend** (primary) - Next.js application containing the PlaywrightRunner

### This Task Will:
- [ ] Modify `PlaywrightRunner.runSingleTest()` to capture network failures (HTTP status >= 400)
- [ ] Modify `PlaywrightRunner.runSingleTest()` to capture console errors
- [ ] Update test failure conditions to include network/console errors
- [ ] Store captured errors in TestResult records for debugging

### Out of Scope:
- Changes to the test-generator.ts smoke test template (it already generates correct code)
- Changes to the diff viewing pages
- UI changes for displaying error details
- Changes to the database schema (already has consoleErrors and networkRequests columns)

## Service Context

### Frontend (Next.js Application)

**Tech Stack:**
- Language: TypeScript
- Framework: Next.js 16.1.3
- Key libraries: Playwright 1.57.0, Drizzle ORM
- Key directories: `src/lib/playwright/`, `src/lib/scanner/`, `src/server/actions/`

**Entry Point:** `pnpm dev`

**How to Run:**
```bash
pnpm install
pnpm dev
```

**Port:** 3000

## Files to Modify

| File | Service | What to Change |
|------|---------|---------------|
| `src/lib/playwright/runner.ts` | frontend | Add console/network error tracking in `runSingleTest()` |

## Files to Reference

These files show patterns to follow:

| File | Pattern to Copy |
|------|----------------|
| `src/lib/scanner/test-generator.ts` | Shows expected error detection pattern with `page.on()` |
| `src/lib/db/schema.ts` | Shows `consoleErrors` and `networkRequests` fields in TestResult |

## Patterns to Follow

### Error Detection Pattern from test-generator.ts

From `src/lib/scanner/test-generator.ts`:

```typescript
// Capture console errors
page.on('console', msg => {
  if (msg.type() === 'error') {
    consoleErrors.push(msg.text());
  }
});

// Capture network failures
page.on('response', response => {
  if (response.status() >= 400) {
    networkFailures.push({
      url: response.url(),
      status: response.status(),
    });
  }
});

// Later: Assert no errors
expect(consoleErrors, 'Console errors detected').toHaveLength(0);
expect(networkFailures, 'Network failures detected').toHaveLength(0);
```

**Key Points:**
- Event listeners must be attached BEFORE navigation
- HTTP status codes >= 400 are considered failures
- Console messages of type 'error' are captured
- Both arrays should be empty for a passing test

### Database Schema Pattern

From `src/lib/db/schema.ts`:

```typescript
export interface NetworkRequest {
  url: string;
  method: string;
  status: number;
  duration: number;
  resourceType: string;
}

// TestResult already has these fields:
consoleErrors: text('console_errors', { mode: 'json' }).$type<string[]>(),
networkRequests: text('network_requests', { mode: 'json' }).$type<NetworkRequest[]>(),
```

**Key Points:**
- The schema already supports storing error data
- NetworkRequest interface includes method, duration, and resourceType
- Console errors are stored as string array

## Requirements

### Functional Requirements

1. **Network Error Detection**
   - Description: Smoke tests must fail when any HTTP response has status >= 400
   - Acceptance: Navigating to `/builds/invalid-id` returns 404 and test fails

2. **Console Error Detection**
   - Description: Smoke tests must fail when console.error() is called
   - Acceptance: Pages that log errors to console cause test failures

3. **Error Reporting**
   - Description: Captured errors must be included in test result for debugging
   - Acceptance: Failed test results include `consoleErrors` and `networkRequests` arrays

### Edge Cases

1. **Multiple 404 responses** - Should capture all failed network requests, not just the first
2. **Redirect responses (3xx)** - Should NOT be treated as failures
3. **Missing resources that don't affect functionality** - Still captured but user can review
4. **Console.warn vs console.error** - Only console.error should trigger failures

## Implementation Notes

### DO
- Follow the pattern in `test-generator.ts` for `page.on()` event listeners
- Attach event listeners BEFORE calling `page.goto()`
- Store captured errors even on success (for diagnostics)
- Use the existing `NetworkRequest` interface from schema

### DON'T
- Don't modify `test-generator.ts` - the generated code is correct
- Don't add new database columns - use existing `consoleErrors` and `networkRequests`
- Don't break existing test execution that doesn't involve network errors
- Don't treat HTTP 3xx redirects as failures

## Development Environment

### Start Services

```bash
pnpm dev
```

### Service URLs
- Frontend: http://localhost:3000

### Required Environment Variables
- None required for this task (SQLite database is local)

## Success Criteria

The task is complete when:

1. [ ] Tests that navigate to non-existent routes (404) fail with clear error message
2. [ ] Tests that navigate to pages with console errors fail with clear error message
3. [ ] Failed test results include captured `consoleErrors` array
4. [ ] Failed test results include captured `networkRequests` array with failed requests
5. [ ] No console errors during normal app operation
6. [ ] Existing tests still pass (no regressions)
7. [ ] New functionality verified via browser - create a test pointing to an invalid URL and verify it fails

## QA Acceptance Criteria

**CRITICAL**: These criteria must be verified by the QA Agent before sign-off.

### Unit Tests
| Test | File | What to Verify |
|------|------|----------------|
| Network failure capture | `src/lib/playwright/runner.ts` | HTTP 400+ responses trigger test failure |
| Console error capture | `src/lib/playwright/runner.ts` | Console errors trigger test failure |
| Success path unchanged | `src/lib/playwright/runner.ts` | Valid pages without errors still pass |

### Integration Tests
| Test | Services | What to Verify |
|------|----------|----------------|
| End-to-end smoke test | Runner ↔ Browser ↔ App | Complete test run with error detection |

### End-to-End Tests
| Flow | Steps | Expected Outcome |
|------|-------|------------------|
| 404 Detection | 1. Create test pointing to `/invalid/path` 2. Run test | Test fails with network error in result |
| Console Error Detection | 1. Create test pointing to page with JS error 2. Run test | Test fails with console error in result |
| Happy Path | 1. Create test pointing to `/` 2. Run test | Test passes, no errors captured |

### Browser Verification (if frontend)
| Page/Component | URL | Checks |
|----------------|-----|--------|
| Build Detail | `http://localhost:3000/builds/[buildId]` | Shows failed test results with error details |
| Test Runner | N/A (server-side) | Creates tests that properly detect errors |

### Database Verification (if applicable)
| Check | Query/Command | Expected |
|-------|---------------|----------|
| Error stored in result | Check `test_results` table | `console_errors` and `network_requests` populated on failure |

### QA Sign-off Requirements
- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] All E2E tests pass
- [ ] Browser verification complete (if applicable)
- [ ] Database state verified (if applicable)
- [ ] No regressions in existing functionality
- [ ] Code follows established patterns
- [ ] No security vulnerabilities introduced

## Technical Implementation Guidance

### Recommended Approach

Modify `runSingleTest()` in `src/lib/playwright/runner.ts` to:

```typescript
private async runSingleTest(test: Test, runId: string): Promise<TestRunResult> {
  // ... existing setup code ...

  // Add error tracking arrays
  const consoleErrors: string[] = [];
  const networkFailures: NetworkRequest[] = [];

  // ... after creating page ...

  // Attach listeners BEFORE navigation
  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  page.on('response', response => {
    if (response.status() >= 400) {
      networkFailures.push({
        url: response.url(),
        method: response.request().method(),
        status: response.status(),
        duration: 0, // Optional: calculate if needed
        resourceType: response.request().resourceType(),
      });
    }
  });

  // ... execute test code ...

  // After test execution, check for errors
  if (consoleErrors.length > 0 || networkFailures.length > 0) {
    const errorMessage = [];
    if (consoleErrors.length > 0) {
      errorMessage.push(`Console errors: ${consoleErrors.join(', ')}`);
    }
    if (networkFailures.length > 0) {
      errorMessage.push(`Network failures: ${networkFailures.map(f => `${f.status} ${f.url}`).join(', ')}`);
    }
    throw new Error(errorMessage.join('; '));
  }

  // ... existing success handling ...
}
```

### Return Values

The `TestRunResult` should include the captured errors for storage:
- Add `consoleErrors?: string[]`
- Add `networkRequests?: NetworkRequest[]`

These values are already supported by the database schema.
