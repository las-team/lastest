# Implementation Plans: Scheduled Runs, Success Criteria Tab, WCAG Scoring

---

## Feature 1: Scheduled / Recurring Test Runs

### Current State
- Builds triggered via: Manual (UI), Webhook (GitHub/GitLab), CI/API
- `TriggerType = 'webhook' | 'manual' | 'push'` (schema.ts:726)
- Background jobs system exists (`backgroundJobs` table, polling via `/api/jobs/active`)
- GitHub Actions config already has `cronSchedule` field — but delegates to GitHub, not Lastest server
- **No server-side scheduler exists** (no node-cron, no setInterval-based cron)

### Schema Changes

**`src/lib/db/schema.ts`**

1. Add `'scheduled'` to `TriggerType`:
```ts
export type TriggerType = 'webhook' | 'manual' | 'push' | 'scheduled';
```

2. New `buildSchedules` table:
```ts
export const buildSchedules = sqliteTable('build_schedules', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  repositoryId: text('repository_id').references(() => repositories.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),                          // "Nightly regression", "Hourly smoke"
  enabled: integer('enabled', { mode: 'boolean' }).default(true),
  cronExpression: text('cron_expression').notNull(),      // Standard 5-field cron
  timezone: text('timezone').default('UTC'),
  runnerId: text('runner_id'),                            // Optional: target specific runner
  testIds: text('test_ids', { mode: 'json' }).$type<string[]>(), // null = all tests
  suiteId: text('suite_id').references(() => suites.id, { onDelete: 'set null' }),
  gitBranch: text('git_branch'),                          // null = repo's selected branch
  nextRunAt: integer('next_run_at', { mode: 'timestamp' }),
  lastRunAt: integer('last_run_at', { mode: 'timestamp' }),
  lastBuildId: text('last_build_id'),
  consecutiveFailures: integer('consecutive_failures').default(0),
  maxConsecutiveFailures: integer('max_consecutive_failures').default(5),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});
```

3. Add `scheduleId` to `builds` table:
```ts
scheduleId: text('schedule_id'), // links to buildSchedules.id if triggered by a schedule
```

### New Files

| File | Purpose |
|------|---------|
| `src/lib/db/queries/schedules.ts` | CRUD: create/update/delete/getDue/markRun |
| `src/lib/scheduling/cron.ts` | Cron parsing (`cron-parser` package), preset schedules, validation |
| `src/lib/scheduling/scheduler.ts` | Singleton 60s interval, queries due schedules, triggers builds |
| `src/server/actions/schedules.ts` | Server actions: create/update/delete/toggle with `requireRepoAccess()` |
| `src/components/schedules/schedule-manager.tsx` | UI: list, create, edit, toggle schedules |
| `src/components/schedules/cron-input.tsx` | Cron expression builder with presets dropdown |

### Scheduler Engine (`src/lib/scheduling/scheduler.ts`)

```
Every 60s:
  1. getDueSchedules() — WHERE enabled = 1 AND nextRunAt <= NOW()
  2. For each due schedule:
     a. Resolve test IDs (from testIds, suiteId, or all repo tests)
     b. Call createAndRunBuildFromCI() with triggerType: 'scheduled'
     c. Update: lastRunAt, lastBuildId, compute nextRunAt
     d. On failure: increment consecutiveFailures
     e. If consecutiveFailures >= max: auto-disable schedule
  3. Mutex flag prevents concurrent ticks processing same schedule
```

**Initialization**: Lazily start on first `/api/jobs/active` request (same pattern as stale runner cleanup in WS route).

### UI Location
- Repository Settings → new "Schedules" tab
- Quick presets: Hourly, Daily (3am), Weekly (Sunday 3am), Custom cron
- Schedule list shows: name, cron (human-readable), next run, last run status, toggle

### Dependencies
- Add `cron-parser` package (~10KB)

---

## Feature 2: Success Criteria Tab (Assertions Dashboard)

### Current State
- **33+ assertion types** exist (element state, content, page, layout, CSS, generic)
- **Recording**: Shift+right-click → assertion menu (recorder.ts:1071+)
- **Code generation**: `eventsToCodeLines()` in event-to-code.ts emits assertions inline with comments like `// Element assertion: toBeVisible`
- **Soft errors**: `wrapMatchersForSoftErrors` (runner.ts:130) collects failures into `softErrors[]` string array
- **Storage**: `testResults.softErrors` = flat string array — **no structured per-assertion tracking**
- **Test detail page**: `test-detail-client.tsx` (1208 lines), tabs: Code, Setup, Stabilization, Diff, Playwright, Screenshots, Plans, Run History, Recordings, Versions
- **Key gap**: Assertions only exist as code strings. No mapping from individual assertions → outcomes.

### Schema Changes

**`src/lib/db/schema.ts`**

1. New interfaces (add near line 97 alongside existing JSON types):

```ts
export interface TestAssertion {
  id: string;                  // uuid, stable across re-parses
  orderIndex: number;          // position in test code
  category: 'element' | 'page' | 'generic' | 'visual';
  assertionType: string;       // 'toBeVisible', 'toHaveURL', 'toBe', etc.
  negated: boolean;            // .not. modifier
  targetSelector?: string;     // human-readable selector
  targetSelectors?: Array<{ type: string; value: string }>;
  expectedValue?: string;      // stringified expected value
  attributeName?: string;      // for toHaveAttribute
  label?: string;              // user-friendly description
  codeLineStart?: number;
  codeLineEnd?: number;
}

export interface AssertionResult {
  assertionId: string;         // FK to TestAssertion.id
  status: 'passed' | 'failed' | 'skipped';
  actualValue?: string;
  errorMessage?: string;
  durationMs?: number;
}
```

2. New column on `tests` table:
```ts
assertions: text('assertions', { mode: 'json' }).$type<TestAssertion[]>(),
```

3. New column on `testResults` table:
```ts
assertionResults: text('assertion_results', { mode: 'json' }).$type<AssertionResult[]>(),
```

### New Files

| File | Purpose |
|------|---------|
| `src/lib/playwright/assertion-parser.ts` | Parses test `code` string → `TestAssertion[]` |
| `src/components/tests/success-criteria-tab.tsx` | Main tab component |
| `src/components/tests/assertion-row.tsx` | Individual assertion row (status, expected, actual) |
| `src/components/tests/add-assertion-dialog.tsx` | Dialog to manually add assertions |

### Assertion Parser (`src/lib/playwright/assertion-parser.ts`)

Parses test code to extract structured `TestAssertion[]`:

```
Recognizes:
  - expect(el).toBeVisible()          → element / toBeVisible
  - expect(el).not.toHaveText('foo')  → element / toHaveText / negated / expected='foo'
  - expect(page).toHaveURL('/dash')   → page / toHaveURL / expected='/dash'
  - expect(value).toBe(42)            → generic / toBe / expected='42'

Uses existing code comment annotations:
  "// Element assertion: toBeVisible" (emitted by eventsToCodeLines)

ID generation: hash(orderIndex + assertionType + targetSelector + expectedValue)
  → IDs stable across re-parses of unchanged code
```

**When to parse**: Assertions are parsed and stored on:
- Test save (manual edit)
- Test generation (AI)
- Test recording completion
- Test fix (AI fix/enhance)

### Enhanced Runner (`src/lib/playwright/runner.ts`)

Modify `createExpect()` (line 166) to accept `assertionResults: AssertionResult[]`:

```
Before executing matcher:
  1. Increment assertion counter (assertions execute in order)
  2. Match to TestAssertion by orderIndex
After executing matcher:
  - Success → push { assertionId, status: 'passed', actualValue }
  - Failure → push { assertionId, status: 'failed', actualValue, errorMessage }
```

Executor (`executor.ts:649`) stores `assertionResults` on the test result record.

### Success Criteria Tab UI

**Location**: New tab in `test-detail-client.tsx` after "Code":
```tsx
<TabsTrigger value="criteria">Success Criteria</TabsTrigger>
```

**Layout**:
```
┌─────────────────────────────────────────────────┐
│ Success Criteria                    5/7 passing  │
│ ═══════════════════════════════════════════════  │
│                                                  │
│ ✅ Page URL matches "/dashboard"                 │
│    Expected: /dashboard  |  Actual: /dashboard   │
│                                                  │
│ ✅ Button "Submit" is visible                    │
│    Selector: [data-testid="submit-btn"]          │
│                                                  │
│ ❌ Heading has text "Welcome back"               │
│    Expected: "Welcome back"                      │
│    Actual:   "Welcome, John"                     │
│                                                  │
│ ✅ Input "email" has value "test@example.com"    │
│    Expected: test@example.com                    │
│    Actual:   test@example.com                    │
│                                                  │
│ ⚪ Page title matches "Dashboard - App"  (not run)│
│                                                  │
│ ⚠️ Unmatched Soft Errors (2)                     │
│    • Timeout waiting for selector '.modal'       │
│    • Navigation to /api/data failed              │
│                                                  │
│ [+ Add Assertion]                                │
└─────────────────────────────────────────────────┘
```

**Components**:
- Summary bar: `X of Y passing` with progress indicator
- Assertion rows: status icon, category badge, description, expected/actual
- Expandable details: selector info, code line reference
- Unmatched soft errors: yellow warning panel for errors not linked to assertions
- Add assertion button: opens dialog with category picker

### Recording Integration

**Aligns with existing flow** (Shift+right-click → assertion menu):

Enhancement: During recording, show a **live assertions sidebar panel** that lists assertions as they're added:

```
Recording Assertions
─────────────────────
1. ✓ Page URL matches "/login"
2. ✓ Button "Login" is visible
3. ✓ Input "email" has placeholder "Enter email"
   [Edit] [Remove]

[+ Add Page Assertion ▾]
  ○ URL matches...
  ○ Title matches...
  ○ Page loaded
  ○ Network idle
```

This panel mirrors `eventsToCodeLines()` output in real-time but structured, not code. On save, both the code and the `TestAssertion[]` metadata are persisted.

**No new assertion recording mechanism needed** — the existing Shift+right-click flow stays. The panel is a read-only view of what's being recorded, with the option to remove/edit from there.

---

## Feature 6: WCAG Compliance Scoring

### Current State
- axe-core runs after each test (runner.ts:1446)
- Violations stored in `testResults.a11yViolations` as JSON array
- `A11yViolation` interface (schema.ts:182): `id, impact, description, help, helpUrl, nodes`
- **Missing**: WCAG `tags` array not captured (axe returns it but it's discarded)
- **Missing**: No passes count, no build-level aggregation, no score, no trends
- UI: `A11yViolationsPanel` shows violations list; build detail shows badge "3 a11y"

### Schema Changes

**`src/lib/db/schema.ts`**

1. Expand `A11yViolation` interface (line 182):
```ts
export interface A11yViolation {
  id: string;
  impact: 'critical' | 'serious' | 'moderate' | 'minor';
  description: string;
  help: string;
  helpUrl: string;
  nodes: number;
  tags?: string[];                     // NEW: ["wcag2a", "wcag111", "best-practice"]
  wcagLevel?: 'A' | 'AA' | 'AAA';     // NEW: derived from tags
}
```

2. Add to `testResults` table:
```ts
a11yPassesCount: integer('a11y_passes_count'),  // axe passes.length
```

3. Add to `builds` table:
```ts
a11yScore: integer('a11y_score'),                   // 0-100
a11yViolationCount: integer('a11y_violation_count'),
a11yCriticalCount: integer('a11y_critical_count'),   // critical + serious
a11yTotalRulesChecked: integer('a11y_total_rules_checked'),
```

### Runner Changes (`src/lib/playwright/runner.ts`)

At line 1446-1455, expand violation mapping:
```ts
// Add tags capture
tags: v.tags,
wcagLevel: v.tags?.includes('wcag2aaa') ? 'AAA'
         : v.tags?.includes('wcag2aa') ? 'AA'
         : v.tags?.includes('wcag2a') ? 'A'
         : undefined,
```

Also capture `a11yResults.passes.length` for denominator.

### New Files

| File | Purpose |
|------|---------|
| `src/lib/a11y/wcag-score.ts` | Pure scoring function |
| `src/components/builds/a11y-compliance-card.tsx` | Score gauge + breakdown |
| `src/components/builds/a11y-trend-chart.tsx` | Sparkline of scores over last N builds |

### Scoring Algorithm (`src/lib/a11y/wcag-score.ts`)

```ts
Input:  A11yViolation[], passesCount: number
Output: {
  score: number;           // 0-100
  level: 'A' | 'AA';      // target conformance level
  totalRules: number;
  passedRules: number;
  violatedRules: number;
  bySeverity: { critical, serious, moderate, minor };
  byLevel: { A, AA, AAA };
}

Algorithm:
  1. Start at 100
  2. Per violation, deduct:
     - critical: 10 × min(nodes, 3)
     - serious:   5 × min(nodes, 3)
     - moderate:  2 × min(nodes, 3)
     - minor:     1 × min(nodes, 3)
  3. Level multiplier: A = 1.5×, AA = 1.0×, AAA = 0.5×
  4. Clamp to [0, 100]

Also compute: passedRules / (passedRules + violatedRules) × 100
  → "Rule pass rate" as secondary metric
```

### Build Finalization

In `src/server/actions/builds.ts` → `runBuildAsync` (around line 940):
- After computing `overallStatus`, aggregate a11y data across all test results
- Compute score using `calculateWcagScore()`
- Persist via `updateBuild(buildId, { a11yScore, a11yViolationCount, ... })`

### New Query

In `src/lib/db/queries/builds.ts`:
```ts
getA11yScoreTrend(repositoryId: string, limit = 10)
  → SELECT id, a11yScore, a11yViolationCount, createdAt
    FROM builds WHERE repositoryId = ? AND a11yScore IS NOT NULL
    ORDER BY createdAt DESC LIMIT ?
```

### UI Components

**A11y Compliance Card** (on build detail page):
```
┌──────────────────────────────────┐
│  WCAG 2.2 AA Compliance          │
│                                  │
│        ┌─────┐                   │
│        │ 87% │  ← radial gauge   │
│        └─────┘                   │
│                                  │
│  2 critical · 3 serious          │
│  5 moderate · 1 minor            │
│                                  │
│  42/48 rules passed              │
│                                  │
│  Trend: 82 → 85 → 87 ↑          │
└──────────────────────────────────┘
```

Color coding: green ≥ 90, yellow ≥ 70, red < 70.

**Enhanced A11yViolationsPanel**:
- Add WCAG criterion badge per violation (e.g., "1.1.1", "4.1.2")
- Group by WCAG level (A / AA / AAA)
- Show "Affects N elements" per violation

**Trend Chart** (sparkline under the score card):
- Last 10 builds, line chart of a11yScore
- Follows pattern of `RecentHistory` component

---

## Implementation Order

### Week 1: Schema + Backend
1. All schema changes (3 features) → `pnpm db:push`
2. `schedules.ts` queries
3. `assertion-parser.ts`
4. `wcag-score.ts` scoring library
5. Runner changes (assertion results + a11y tags/passes)

### Week 2: Engines + Actions
6. Scheduler engine (`scheduler.ts` + `cron.ts`)
7. Server actions for schedules
8. Executor changes for assertion results
9. Build finalization for a11y scores
10. A11y trend query

### Week 3: Frontend
11. Schedule manager UI (settings tab)
12. Success Criteria tab + assertion rows
13. A11y compliance card + trend chart
14. Enhanced A11yViolationsPanel

### Week 4: Polish
15. Cron input component with presets
16. Add assertion dialog
17. Recording sidebar assertions panel
18. Tests + edge cases
