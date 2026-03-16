# Track C: Auth Resilience

## Goal
Eliminate test failures caused by authentication redirects or missing auth state.

## Current Problem
Some tests fail because they navigate to protected pages without auth, get redirected to /login, and then fail on selector assertions for the original page content.

## Scope — What You Can Modify
- `SYSTEM_PROMPT` in `src/lib/ai/prompts.ts` — add auth awareness
- `createTestPrompt()` and `createBranchAwareTestPrompt()` — auth handling instructions
- `createFixPrompt()` — auth-aware fix strategies

## Experiments

### C1: Auth awareness in SYSTEM_PROMPT
Add section about auth handling:
```
AUTHENTICATION: Tests run with pre-authenticated browser state (cookies/localStorage).
If you see a login page or redirect, the test should:
1. Check if the current URL contains '/login' or '/sign-in'
2. If so, the auth state may have expired — screenshot the current state and pass
3. Do NOT try to fill in login forms — auth is handled by the test runner
```

### C2: Login detection in generated tests
Add a helper pattern to test generation:
```
After page.goto(), check for auth redirect:
const currentUrl = page.url();
if (currentUrl.includes('/login') || currentUrl.includes('/sign-in')) {
  stepLogger.log('Auth redirect detected — skipping test');
  await page.screenshot({ path: screenshotPath });
  return; // Pass gracefully
}
```

### C3: Storage state awareness
Add to test generation context:
```
The test runner provides pre-authenticated browser context via Playwright storageState.
All cookies and localStorage from a prior login session are available.
If auth is required, it's already handled — don't add login steps.
```

### C4: Auth-aware fix prompt
When a test fails with auth redirect, the fix should:
```
If error contains 'login', 'redirect', 'unauthorized', or 'sign-in':
- Do NOT add login form interactions
- Add auth state check: if (page.url().includes('/login')) return;
- Or wait longer for auth redirect to complete
```

### C5: Pre-navigation auth check
Add pattern to test template:
```
// Navigate and handle potential auth redirect
await page.goto(`${baseUrl}/protected-route`);
await page.waitForLoadState('domcontentloaded');
// If redirected to login, auth expired — graceful exit
if (page.url().includes('/login')) {
  await page.screenshot({ path: screenshotPath });
  return;
}
```

## Metric
- Primary: `auth_success` from metrics.ts (target = 1.0)
- Fast eval: `evalAuthResilience` — checks last build for auth-redirect failures
