# Track D: Fix Loop Improvement

## Goal
Improve the fix prompt so that failed tests get fixed correctly on the first attempt, without introducing new issues.

## Current Problem
Fix attempts sometimes:
- Produce identical code (no actual fix)
- Introduce new route hallucinations
- Oscillate between two broken states
- Don't address the root cause (e.g., fixing a selector when the real issue is a 404)

## Scope — What You Can Modify
- `createFixPrompt()` in `src/lib/ai/prompts.ts`
- `createMcpFixPrompt()` in `src/lib/ai/prompts.ts`

## Experiments

### D1: Error category → fix strategy mapping
Add explicit mapping at the top of the fix prompt:
```
ERROR DIAGNOSIS:
- If error contains "404" or "not found": The URL is wrong. Change page.goto() to use a route from the available routes list.
- If error contains "timeout" or "waiting for": A selector didn't match. Use more general selectors (getByRole, getByText).
- If error contains "syntax" or "unexpected token": Strip TypeScript annotations. Remove import statements.
- If error contains "login" or "redirect": Add auth state check at the top of the test.
- If error contains "not a function": You're using an API that doesn't exist. Check expect() usage.
```

### D2: Previous fix attempts context
Add to fix prompt:
```
This test has been fixed before. Previous errors:
{previousErrors}
Do NOT repeat previous fix attempts. Try a fundamentally different approach.
```

### D3: Route constraint in fix
Add available routes to fix prompt:
```
AVAILABLE ROUTES (use ONLY these in page.goto()):
{routes}
If the current page.goto() URL is not in this list, change it to the closest matching route.
```

### D4: Diff-style fix output
Instead of regenerating the whole test, ask for targeted changes:
```
Output ONLY the lines that need to change, with context:
- Line N (before): old code
- Line N (after): new code
```
(Note: this may not work well with current extractCodeFromResponse — test carefully)

### D5: Root cause analysis
Add step before fix:
```
Before fixing, analyze the root cause:
1. What line caused the error?
2. Why did it fail? (wrong URL, wrong selector, timing, syntax)
3. What's the minimal change to fix it?

Then apply ONLY that minimal change. Do not rewrite the entire test.
```

### D6: Fix validation checklist
Add at the end of fix prompt:
```
Before returning your fix, verify:
□ All page.goto() URLs are in the available routes list
□ No TypeScript annotations (: Type, as Type, <Type>)
□ No import statements
□ The fix actually changes something (not identical to input)
□ The fix addresses the specific error, not something else
```

## Metric
- Primary: `pass_rate` improvement after fix cycle
- Fast eval: `evalFixLoop` — generates fixes, checks syntax + route validity + code changed
