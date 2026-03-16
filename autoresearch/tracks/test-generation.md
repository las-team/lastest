# Track B: Test Generation Quality

## Goal
Improve the quality of generated tests: valid syntax, proper structure, no antipatterns.

## Current Problem
Tests sometimes contain TypeScript annotations, import statements, or invalid syntax that causes runtime failures.

## Scope — What You Can Modify
- `SYSTEM_PROMPT` in `src/lib/ai/prompts.ts`
- Requirements section of `createTestPrompt()` and `createBranchAwareTestPrompt()`
- `createUserStoryExtractionPrompt()` — AC grouping guidance

## Experiments

### B1: Stronger no-TypeScript enforcement
Add explicit examples of what NOT to do:
```
WRONG: const element: Locator = page.locator(...)
RIGHT: const element = page.locator(...)
WRONG: import { expect } from '@playwright/test'
RIGHT: (no imports — expect is provided as a parameter)
```

### B2: Multi-route test guidance
Instruct AI to cover 2-3 related ACs in one test when they share a route:
```
If multiple acceptance criteria target the same route, combine them into ONE test that:
1. Navigates to the route once
2. Verifies each criterion sequentially
3. Takes screenshots at key verification points
```

### B3: Route-aware test naming
Include target route in test name for traceability:
```
Name your test: "[route] - [what it tests]"
Example: "/settings - verify theme toggle works"
```

### B4: Loading state handling
Add explicit guidance for common loading patterns:
```
After navigation, ALWAYS:
1. await page.waitForLoadState('domcontentloaded')
2. Wait for any loading indicators to disappear: await page.locator('[data-loading]').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
```

### B5: shadcn/ui selector patterns
Add selector guidance specific to the UI framework:
```
This app uses shadcn/ui. Prefer these selectors:
- Buttons: page.getByRole('button', { name: '...' })
- Inputs: page.getByRole('textbox') or page.getByLabel('...')
- Tabs: page.getByRole('tab', { name: '...' })
- Dialog: page.getByRole('dialog')
```

### B6: AC grouping in extraction prompt
Improve `createUserStoryExtractionPrompt` to group related ACs:
```
Group acceptance criteria that:
- Target the same page/route
- Test related functionality (e.g., form fields on the same form)
- Share setup steps (e.g., both need to navigate to settings)
Set groupedWith to the first AC's ID in the group.
```

### B7: Concrete example test
Add a full working example test in SYSTEM_PROMPT that demonstrates all best practices.

## Metric
- Primary: `syntax_quality` from metrics.ts (target = 1.0)
- Secondary: `pass_rate` improvement from better test structure
- Fast eval: `evalTestGeneration` — generates tests, syntax-checks, checks for antipatterns
