# TestSprite Gap-Closure — Implementation Plan

Status: approved for implementation on `claude/jolly-newton-7No63`.

This plan closes the prioritized gaps identified in the TestSprite + competitor
analysis while preserving our **BYOK + MCP-first** strategy. Four features plus a
two-phase MCP-surface consolidation.

Prioritized gaps (others deferred to P3):

| Gap    | Priority | Summary                                                               |
| ------ | -------- | --------------------------------------------------------------------- |
| **E6** | P0       | One-prompt, diff-scoped `validate_diff` MCP verb                      |
| **E5** | P0       | "Fix the app" loop — app-code fix recommendations to the coding agent |
| **E1** | P0       | Backend / API test type + headless HTTP engine                        |
| **E3** | P2       | Load / performance testing on API tests                               |

Approved decisions:

1. Run **both** MCP consolidation phases (56 → ~22 tools).
2. **Fold** E1/E3 into existing tools (`lastest_test` + `lastest_run_tests`) rather
   than adding `run_api_test` / `run_load_test` verbs.
3. Add **`ajv`** for JSON-schema response assertions.

---

## Cross-cutting answers

### Do we need a new engine?

| Feature          | New engine?                | Notes                                                                                                                                                           |
| ---------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1 API tests     | Yes — headless HTTP engine | Extends `src/lib/setup/api-seeder.ts` (`fetch` + auth + `{{var}}` + dot-path). Executor branch: `testType === 'api'` runs in-process, skips runner/EB dispatch. |
| E3 Load          | Yes — concurrency runner   | Bounded `Promise.allSettled` pool over E1's `runApiTest`; depends on E1.                                                                                        |
| E5 Fix-the-app   | No                         | Orchestrates `failure-triage` + change-map + `generateWithAI`.                                                                                                  |
| E6 validate_diff | No                         | Composes `findAffectedTests` → `createAndRunBuildCore` → verdict queries.                                                                                       |

### Fit with current UI tests + verify

API tests flow through the **same** `test_results → step_comparisons → EvidenceItem →
effectiveVerdict` pipeline as UI tests:

- `api` becomes the **10th check layer** in `src/lib/verify/check-modes.ts`
  (`CheckLayer`, `CheckModeMap`, `DEFAULTS`) and `EvidenceLayer` (`schema.ts`),
  with enforce/log/disable modes.
- **Load** results reuse the existing **`perf` layer** (no new layer).
- Mixed UI + API builds produce one unified verdict, one `lastest_verify` view,
  one Verify-phase approval surface.

---

## Feature designs

### E6 — `lastest_validate_diff` (P0, no new engine)

- Reuses: `findAffectedTests` (`src/lib/smart-selection/file-matcher.ts`),
  `createAndRunBuildCore` (`src/server/actions/builds.ts`), verdict queries
  (`countStepComparisonVerdicts`, `getStepComparisonsByBuild`,
  `getVisualDiffsByBuild`, `getBuildChangeMap`), `compareBranches` for range mode.
- New: `src/server/actions/validate-diff.ts`; `validate-diff` POST branch in
  `src/app/api/v1/[...slug]/route.ts`; client + MCP verb.
- Schema: none (optional `triggerType: 'validate_diff'`, free-text column).
- Risks: builds are async → default `wait:true` + `maxWaitMs` cap +
  `build_running` fallback; `compareBranches` is GitHub-only → local repos pass
  `diff` text; explicit `no_affected_tests` status.

### E5 — `lastest_suggest_app_fix` (P0, no new engine)

- Reuses: `failure-triage.ts` (`real_regression` gate), `getBuildChangeMap`,
  `test_results` (error/console/network/dom-diff), `generateWithAI` + `parseAiJson`,
  GitHub `content.ts` for source/line accuracy.
- New: `src/lib/ai/app-fix-advisor.ts`; `tests/:id/suggest-app-fix` POST branch;
  `app_fix_suggestions` table (mirrors `build_demo_notes`); queries module.
- Read-only enforcement: plan mode + disallowed Write/Edit/Bash/NotebookEdit
  (same guard as the test healer). Never auto-applies.

### E1 — API test type + headless engine (P0, new engine)

- Reuses: `api-seeder.ts` helpers, `test_results`/`step_comparisons`,
  `generateWithAI`+`parseAiJson`, `gatherCodebaseIntelligence` (`apiLayer`),
  `setupScripts.type:'api'` precedent, SSRF guard (`src/lib/url-diff/ssrf.ts`).
- New: `src/lib/api-test/{types,runner,generator,evidence}.ts`; executor branch;
  `'api'` check layer + evidence layer.
- Schema (one `db:push`): `tests.testType` (`browser|api`, default `browser`),
  `tests.apiDefinition` jsonb, `DEFAULT_API_TEST_SETTINGS`.
- Deps: `ajv`. SSRF + secret redaction on auth headers.

### E3 — Load/perf on API tests (P2, new engine, depends on E1)

- Reuses: E1 `runApiTest`, `perf` layer + `EvidenceItem`/`effectiveVerdict`,
  `perfBaselines` precedent, concurrency-batch idiom, `DEFAULT_*` convention.
- New: `src/lib/api-test/{load-runner,load-evidence}.ts`; executor routes to
  load-runner when `loadConfig` present.
- Schema: `LoadTestThresholds`/`LoadTestResult`, `DEFAULT_LOAD_TEST_THRESHOLDS`,
  `tests.loadConfig` + `test_results.loadResult` jsonb.
- Folded into `lastest_run_tests { mode: 'load' }`. Async (jobId + poll) for long runs.

### Build order

E6 → E5 → E1 → E3, then MCP consolidation (so new verbs land against the
consolidated surface where possible).

---

## MCP consolidation (56 → ~22)

Principle: collapse pure CRUD into resource tools with an `action` discriminator;
keep "workflow verbs" the agent reasons about as discrete steps. E1/E3 add zero
tools (fold into `lastest_test` + `lastest_run_tests`); only E5/E6 add a verb.

| Domain              | Today | After | Consolidation                                                                                 |
| ------------------- | ----- | ----- | --------------------------------------------------------------------------------------------- |
| Health/jobs         | 3     | 1     | `lastest_status {health\|jobs\|job}`                                                          |
| Repos + PW settings | 6     | 1     | `lastest_repo {list\|get\|create\|update\|get_settings\|update_settings}`                     |
| Areas               | 5     | 1     | `lastest_area {list\|get\|create\|update\|delete\|list_tests}`                                |
| Tests (CRUD)        | 6     | 1     | `lastest_test {...}` `filter:failing`, `testType:'api'` carries E1                            |
| Storage states      | 3     | 1     | `lastest_storage_state {list\|create\|delete}`                                                |
| Setup scripts       | 5     | 1     | `lastest_setup_script {list\|get\|create\|update\|delete}`                                    |
| Visual diffs        | 7     | 2     | `lastest_get_diffs {scope}` + `lastest_decide_diff {approve\|reject\|snooze}`                 |
| Builds/runs (reads) | 4     | 1     | `lastest_build {list\|get\|review}` (drop `get_test_run`)                                     |
| Coverage/QA         | 2     | 1     | `lastest_insights {coverage\|qa}`                                                             |
| Verify              | 3     | 2     | `lastest_verify {view\|change_map}` + keep `approve_layer`                                    |
| Workflow verbs      | —     | 6     | `run_tests`, `heal_test`, `publish_share`, `approve_layer`, `quickstart`, `quickstart_status` |
| New feature verbs   | —     | 2     | `validate_diff` (E6), `suggest_app_fix` (E5)                                                  |

Phase 1 (safe, no saas-demo impact): diffs 7→2, health 3→1, builds 4→1,
insights 2→1, drop `get_test_run`.
Phase 2 (resource CRUD): repo/area/test/storage/setup collapses.

### saas-demo (QuickStart) protection — DO NOT TOUCH

The saas-demo skill is the QuickStart pipeline (`server.ts` quickstart tools).
Agent share-creation chain:

`lastest_quickstart` → `lastest_quickstart_status` → **`lastest_publish_share`**
→ (`list_build_shares` / `revoke_share` optional).

Keep `quickstart`, `quickstart_status`, `publish_share` as standalone verbs with
**unchanged signatures** (`publish_share` returns `{shareId, slug, url}`). Only the
non-critical share reads are merged: `list_build_shares` + `list_test_shares` +
`revoke_share` → `lastest_share {list|revoke}`.

---

## Notes / environment

- Schema changes require `pnpm db:push` against a live Postgres (host docker). If the
  DB is not reachable in a given environment, schema edits land in code but the push
  must run where the DB is available.
- Always `pnpm` (never npm/npx). Never `pnpm db:reset` without asking.
