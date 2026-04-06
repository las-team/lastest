# Autoresearch v2: Multi-Track Play Agent Optimizer

You are an autonomous research agent optimizing the **Play Agent pipeline** for lastest. Your goal: raise the Play Agent pass rate from 57% (113/199) to ≥85% (170/199) by iteratively improving prompt templates across four coordinated tracks.

## Setup (run once at start)

1. Read all track programs to understand the experiment space:
   ```bash
   cat autoresearch/tracks/route-accuracy.md
   cat autoresearch/tracks/test-generation.md
   cat autoresearch/tracks/auth-resilience.md
   cat autoresearch/tracks/fix-loop.md
   ```

2. Run baseline metrics from DB:
   ```bash
   pnpm tsx autoresearch/harness/metrics.ts --repo-id=REPO_ID
   ```
   (The caller provides REPO_ID as a CLI arg)

3. Log baseline to `autoresearch/results.tsv`:
   ```
   <commit>\t<pass_rate>\t<route_accuracy>\t<syntax_quality>\t<auth_success>\tbaseline\tInitial v2 baseline
   ```

## Scope — CRITICAL

### CAN modify
- `src/lib/ai/prompts.ts` — ALL prompt templates (SYSTEM_PROMPT, createTestPrompt, createBranchAwareTestPrompt, createFixPrompt, createMcpFixPrompt, createEnhancePrompt, createUserStoryExtractionPrompt)
- `src/server/actions/spec-import.ts` — ONLY the `groupAcceptanceCriteria` function (around line 890) and nearby AC grouping logic

### CANNOT modify
- `autoresearch/harness/*.ts` — immutable evaluation harness
- `autoresearch/tracks/*.md` — immutable track programs
- `src/server/actions/play-agent.ts` — the pipeline itself
- `src/lib/db/schema.ts` — database schema
- `src/lib/playwright/runner.ts` — test runner
- Any other source files

### CANNOT do
- Delete or rename exported functions
- Change function signatures
- Add new dependencies

## Metrics & Weights

| Metric | Weight | Target | Source |
|--------|--------|--------|--------|
| `route_accuracy` | 3x | ≥ 0.95 | 1 - (404_failures / total) |
| `auth_success` | 2x | 1.0 | 1 - (auth_redirect / total) |
| `pass_rate` | 1x | ≥ 0.85 | passed / total |
| `syntax_quality` | 1x | 1.0 | 1 - (syntax_errors / total) |

**Weighted score** for track selection:
```
route_score    = route_accuracy * 3
auth_score     = auth_success * 2
gen_score      = (pass_rate + syntax_quality) / 2
fix_score      = pass_rate  (affected by fix quality)
```

Pick the track with the **lowest** weighted score each iteration.

## The Loop — NEVER STOP

### 1. Get current metrics
```bash
pnpm tsx autoresearch/harness/metrics.ts --repo-id=REPO_ID
```

### 2. Compute track scores & pick worst track
From the metrics output, calculate weighted scores. Pick the track with lowest score.

- If `route_accuracy < 0.95` → likely pick **route-accuracy**
- If `auth_success < 1.0` → likely pick **auth-resilience**
- If `syntax_quality < 1.0` → likely pick **test-generation**
- If all above are good but `pass_rate < 0.85` → pick **fix-loop** or **test-generation**

### 3. Read the track program
```bash
cat autoresearch/tracks/<selected-track>.md
```

### 4. Read current prompts
```bash
cat src/lib/ai/prompts.ts
```

### 5. Make ONE focused change
- Pick one experiment from the track's experiment list, or invent your own
- Make a single, focused modification scoped to that track
- Keep changes small and testable

### 6. Commit the change
```bash
git add src/lib/ai/prompts.ts
git commit -m "autoresearch: [track] <brief description>"
```
If also modifying spec-import.ts:
```bash
git add src/lib/ai/prompts.ts src/server/actions/spec-import.ts
git commit -m "autoresearch: [track] <brief description>"
```

### 7. Run fast eval for the track
```bash
pnpm tsx autoresearch/harness/fast-eval.ts --track=<track-name> --repo-id=REPO_ID 2>autoresearch/fast-eval.log
```

### 8. Parse results
```bash
grep "^track:\|^score:\|^passed:\|^failed:" autoresearch/fast-eval.log
```
Also check stderr for any errors:
```bash
tail -20 autoresearch/fast-eval.log
```

### 9. Log to results.tsv
```
<commit>\t<pass_rate>\t<route_accuracy>\t<syntax_quality>\t<auth_success>\t<keep|revert>\t[track] <description>
```

### 10. Keep or revert
- If track score **improved** → KEEP
- If score **equal** and no regression on other tracks → KEEP
- If score **decreased** → REVERT:
  ```bash
  git reset --hard HEAD~1
  ```

### 11. Every 5th iteration: Full eval
```bash
pnpm tsx autoresearch/harness/full-eval.ts --repo-id=REPO_ID > autoresearch/full-eval.log 2>&1
```
This triggers an actual Play Agent run (10-15 min). Parse all metrics from the output.

### 12. Loop back to step 1

## Strategy Notes

- **One change at a time** — isolate variables
- **Read failure details** — metrics.ts shows per-failure category and test name
- **Route accuracy is #1 priority** — 85% of failures are 404s. Fix this first.
- **Don't over-constrain** — prompts that are too restrictive may reduce test quality
- **Build on successes** — if a change helps some tests, try to make it more targeted
- **Track what you've tried** — read results.tsv before each iteration
- **Think about the AI consumer** — be clear, specific, and include examples in prompts
- **The test signature is fixed** — `export async function test(page, baseUrl, screenshotPath, stepLogger)` with `expect` provided by runner
- **No imports in generated tests** — the runner provides everything

## Context

- lastest is a Next.js 16 App Router app with shadcn/ui + Tailwind CSS v4
- Play Agent: scans routes → extracts user stories from specs → generates tests per AC group → runs them → fixes failures
- Tests are plain JS (TS annotations stripped), executed via `new AsyncFunction()`
- Tests have access to: `page`, `baseUrl`, `screenshotPath`, `stepLogger`, `expect`
- Auth is handled via Playwright storageState (pre-authenticated browser context)

## NEVER STOP

Keep running experiments until manually interrupted (Ctrl+C). There is always room for improvement.
