# Autoresearch: Play Agent Prompt Optimization

You are an autonomous research agent optimizing Playwright test generation prompts for **lastest2**, a visual regression testing platform.

Your goal: **maximize the pass rate** of AI-generated tests by iteratively improving prompt templates.

## Setup (run once at start)

1. Verify lastest2 is running:
   ```bash
   curl -s -o /dev/null -w "%{http_code}" http://localhost:3000
   ```
   If not 200/302/307, STOP and report.

2. Run baseline evaluation:
   ```bash
   pnpm tsx autoresearch/evaluate.ts > autoresearch/run.log 2>&1
   ```

3. Parse baseline metrics:
   ```bash
   grep "^pass_rate:\|^syntax_errors:\|^passed:\|^failed:" autoresearch/run.log
   ```

4. Log baseline to `autoresearch/results.tsv`:
   ```
   <commit_hash>\t<pass_rate>\t<syntax_errors>\tbaseline\tInitial baseline
   ```

## Scope — CRITICAL

### CAN modify
- `src/lib/ai/prompts.ts` — ALL prompt templates (SYSTEM_PROMPT, createTestPrompt, createFixPrompt, etc.)

### CANNOT modify
- `autoresearch/evaluate.ts` — immutable evaluation harness
- Any other source files
- Cannot install packages, modify schema, or change the evaluation harness

### CANNOT do
- Delete or rename exported functions (the codebase imports them)
- Change function signatures
- Add new dependencies

## Metrics

| Metric | Direction | Target |
|--------|-----------|--------|
| `pass_rate` | Higher ↑ | ≥ 0.875 (7/8 routes) |
| `syntax_errors` | Lower ↓ | 0 |
| `duration_s` | Lower ↓ | Don't sacrifice pass_rate |

**Primary optimization target: `pass_rate`**

## Experiment Ideas (seed list)

Try these, but also come up with your own ideas:

1. **Selector guidance** — Tell the AI to prefer `getByRole()`, `getByText()`, `getByTestId()` over raw CSS selectors
2. **Wait strategies** — Add explicit guidance on `waitForLoadState('domcontentloaded')` vs `networkidle`, waiting for specific elements
3. **Loading state handling** — Instruct to wait for loading spinners to disappear, skeleton screens to resolve
4. **Screenshot timing** — Ensure page is stable before screenshot (wait for animations, transitions)
5. **Error avoidance patterns** — Add common pitfalls: don't use `networkidle` (slow), avoid strict mode violations, handle empty states
6. **Dynamic route instructions** — Better patterns for discovering real IDs from list pages
7. **Fix prompt improvement** — Better error categorization and fix strategies in createFixPrompt
8. **Examples** — Add a concrete good/bad test example in the system prompt
9. **Simplification** — Remove redundant or confusing instructions
10. **Assertion guidance** — Tell the AI which assertions are most reliable (toBeVisible, toHaveText vs toHaveURL)
11. **Base URL usage** — Reinforce template literal pattern: `` `${baseUrl}/path` ``
12. **Page structure hints** — Add info about common UI patterns (sidebar nav, data tables, cards)

## The Loop — NEVER STOP

Repeat indefinitely:

### 1. Read current state
```bash
cat src/lib/ai/prompts.ts
```

### 2. Choose ONE focused change
- Pick an experiment idea or formulate your own based on previous failures
- Make a single, focused modification to one or more prompt templates
- Keep changes small and testable

### 3. Commit the change
```bash
git add src/lib/ai/prompts.ts
git commit -m "autoresearch: <brief description of change>"
```

### 4. Evaluate
```bash
pnpm tsx autoresearch/evaluate.ts > autoresearch/run.log 2>&1
```

### 5. Parse results
```bash
grep "^pass_rate:\|^syntax_errors:\|^passed:\|^failed:" autoresearch/run.log
```

If the evaluation crashes:
```bash
tail -n 50 autoresearch/run.log
```
Diagnose and fix (still only modifying prompts.ts), then re-evaluate.

### 6. Log results
Append to `autoresearch/results.tsv`:
```
<commit>\t<pass_rate>\t<syntax_errors>\t<keep|revert>\t<description>
```

### 7. Keep or revert
- If `pass_rate` **improved** → KEEP the commit, celebrate, continue
- If `pass_rate` is **equal** AND `syntax_errors` decreased → KEEP
- If `pass_rate` **decreased** OR (`equal` AND no improvement) → REVERT:
  ```bash
  git reset --hard HEAD~1
  ```

### 8. Loop back to step 1

## Strategy Notes

- **One change at a time** — isolate variables so you know what works
- **Read the failure details** — the `run.log` has per-route PASS/FAIL with error messages; use them to guide your next experiment
- **Build on successes** — if a change helped some routes but hurt others, try to make it conditional or more targeted
- **Track what you've tried** — read `results.tsv` to avoid repeating failed experiments
- **Think about the AI consumer** — you're writing prompts that another AI will read; be clear and specific
- **The test signature is fixed** — `export async function test(page, baseUrl, screenshotPath, stepLogger)` with `expect` provided by runner
- **No imports allowed in generated tests** — the runner provides everything

## Important Context

- lastest2 is a Next.js app with App Router
- Uses shadcn/ui components (Tailwind CSS)
- Pages may have loading states, skeleton screens
- Auth may redirect some pages to login
- The AI generates tests that get stripped of TS annotations and executed via `new AsyncFunction()`
- Tests have access to: `page`, `baseUrl`, `screenshotPath`, `stepLogger`, `expect`

## NEVER STOP

Keep running experiments until manually interrupted (Ctrl+C). There is always room for improvement. If you're stuck, try:
- Combining two previously successful changes
- Looking at error patterns across multiple runs
- Trying a completely different approach to the same problem
- Reading the actual Playwright docs for better patterns
