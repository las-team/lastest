# EB launching and setup-resolution cleanup — plan

## Context

Latest 16-test build on prod (`bb7fe13d-…`) launched ~26 EB pods to run 16 test executions. User reported white-screen / `net::ERR_NETWORK_CHANGED` symptoms. We need to understand why so many EBs are launched, why some get marked dead, why `build_setup_test_id=null` despite a login test, and reduce both duplication and waste.

### Findings

1. **`build_setup_test_id=null` is correct for this build.** The build had no explicit build-level setup. Login is handled as **per-test setup** through `default_setup_steps` (`setup-orchestrator.ts:154-253`) — the build action calls `resolveSetupCodeForRunner(tests)` (`builds.ts:948`), which walks each test's repo `default_setup_steps`, then `test.setupTestId`, then repo `defaultSetupTestId`, and returns the first match as `{ code, setupId }`. Executor then runs ONE broadcast setup EB and captures `storageStateJson` for all tests (`executor.ts:1011-1083`). So expected EBs ≈ 1 broadcast-setup + 16 test = **17**.

2. **The extra ~9 EBs come from warm-pool churn, not retries.** Live `[Dispatch]` logs for this build show all 16 tests passing on attempt 1 — zero dead-EB retries fired. The extra spawns come from `releasePoolEB` triggering `ensureWarmPool` after every test release (`embedded-sessions.ts:537+`, `provisioner.ts:461`). With `EB_WARM_POOL_MIN=2` and 1-job-1-EB, each test claim → release → terminate → spawn 2 new warm replacements pattern. Many of those warm spawns are reaped idle once the build ends. Verified `[Pool] Reaped 22 idle EB Job(s)` / `Reaped 18` log lines.

3. **CNI / dead-EB risk is real but didn't fire on this build.** `provisioner.ts:351-357` documents the Calico CNI route-table churn → `net::ERR_NETWORK_CHANGED` → blank screenshots → silent pass. Mitigation is `EB_LAUNCH_INTERVAL_MS`. Prod is set to **200ms** (memory `project_olares_eb_launch_interval`); code default is 500ms. 200ms is too tight relative to Chromium's ~5–30s cold-start; we're paying CNI risk for almost no real serialisation benefit (16 launches × 200ms = 3.2s, dwarfed by the cold-start tail).

4. **Dead-EB attempts are invisible.** `executor.ts:1132-1146` discards attempt-1's failure when `EB_DEAD_ERR_RX` matches. No `test_results`, no `runner_commands`, only stderr log lines that age out. Operators can't tell how often this is happening.

5. **Duplicated setup-resolution** exists across 5 sites (all reading `default_setup_steps` and either pre-loading a `storage_state` or picking a setup test/script):
   - `src/server/actions/builds.ts:881-892` (storage_state pre-load) + `:898-954` (setup code resolve)
   - `src/server/actions/runs.ts:162-173` + `:177`
   - `src/lib/execution/setup-capture.ts:112-169` (`resolveSetupCodeForRunner`)
   - `src/lib/setup/setup-orchestrator.ts:154-253` (`runTestSetup`)
   - `src/server/actions/debug.ts:103` (one-off caller)

## Plan

Two independent tracks. Track A is purely a refactor (low-risk, high-readability). Track B changes runtime behaviour and needs prod monitoring.

---

### Track A — De-duplicate setup resolution

**Goal:** single shared helper that, given `(repositoryId, tests, build?)`, returns the executor-ready `{ setupInfo, setupContext }`. Delete the per-call-site re-implementations.

**Files to add**

- `src/lib/setup/resolve-build-setup.ts` — new module exporting:
  ```ts
  export async function resolveBuildSetup(args: {
    tests: Test[];
    repositoryId: string | null;
    build?: {
      buildSetupTestId: string | null;
      buildSetupScriptId: string | null;
    } | null;
  }): Promise<{
    setupInfo: { code: string; setupId: string } | undefined;
    setupContext: { storageState?: string; variables: Record<string, unknown> };
  }>;
  ```
  Internally: (1) pre-load first matching `storage_state` step into `setupContext.storageState` (current `builds.ts:881-892` / `runs.ts:162-173`); (2) if `build.buildSetupTestId|ScriptId` set, resolve directly (current `builds.ts:898-916`); (3) else fall back to `resolveSetupCodeForRunner(tests)` (current `setup-capture.ts:112-169`); (4) walk `default_setup_steps` only once instead of in every helper.

**Files to modify**

- `src/server/actions/builds.ts:867-925` — replace inline storage_state pre-load + buildSetupTestId resolution + per-test fallback with a single `resolveBuildSetup({ tests, repositoryId, build })` call. Keep the `setupStatus` writes adjacent (lines 900, 920, 924, 951, 975).
- `src/server/actions/runs.ts:160-177` — same swap; runs.ts has no `build` arg, just pass `build: null`.
- `src/server/actions/debug.ts:103` — call the shared helper with `[test]`.
- `src/lib/execution/setup-capture.ts:112-169` — keep `resolveSetupCodeForRunner` as a _thin_ re-export of the inner step in the new module (or delete entirely once all call sites move). `captureSetupForRemoteRunner` (lines 24-102) is unused in the prod path — verify with grep and delete if dead.

**Verification**

- `pnpm lint && pnpm test` — Drizzle types + unit tests pass.
- Targeted: write a unit test in `src/lib/setup/resolve-build-setup.test.ts` covering: (a) build-level setupTestId wins, (b) build-level setupScriptId wins, (c) per-test default_setup_steps fallback, (d) storage_state pre-load is non-clobbering when a setup test runs, (e) no setup needed → returns `{ setupInfo: undefined, setupContext: { variables: {} } }`.
- Manually trigger one build via UI; assert `[Dispatch] Broadcast setup complete` still logs and `setup_status='completed'` lands on the build row.

---

### Track B — Cut EB waste in half

**Goal:** for a 16-test build, launch ≤ 18 EB pods (1 setup + 16 tests + ≤ 1 warm buffer), not ~26. Reduce dead-EB risk further. Make any remaining retries observable.

#### B1. Suspend warm-pool refill while a build is dispatching

Largest single waste lever. Today every `releasePoolEB` triggers `ensureWarmPool`, which spawns up to `warmPoolMin` fresh pods that the in-flight build doesn't need (`embedded-sessions.ts:537+`). The next test claim will provision its own fresh EB anyway via `claimOrProvisionPoolEB` (`embedded-sessions.ts:694-745`), so warm refill is redundant during dispatch.

**Change** (`src/lib/eb/provisioner.ts:461-509`): add an in-process "build dispatch in-flight" counter — `incBuildDispatch()` / `decBuildDispatch()` — and short-circuit `ensureWarmPool` to a no-op when the counter > 0.

**Caller** (`src/lib/execution/executor.ts:1168-1198`): wrap the `executeViaPoolWorkers` body in `try { inc(); … } finally { dec(); ensureWarmPool().catch(…); }` so warm-pool catches up exactly once when the build finishes.

**Risk:** during a build, interactive callers (recording, debug, AI tabs) that hit `claimPoolEB` fast-path find no idle EBs and provision their own. Already happens — `interactiveReservedSlots()` (provisioner.ts:92) protects them. No regression for interactive flows.

#### B2. Raise `EB_LAUNCH_INTERVAL_MS` back to 500ms on Olares

Current Olares override is 200ms (memory `project_olares_eb_launch_interval`). That's tighter than the code default and right at the CNI race window. Bump to **500ms** (code default) or **750ms**. Throughput cost is negligible (16 × 300ms extra = 4.8s vs ~5–30s Chromium cold-start dominating).

**Change:** edit the Olares ConfigMap / deployment env on the `lastest-dev` and `lastest-internal-dev` Deployments. No code change.

**Verification:** after deploy, run a 16-test build; count `[EB Provisioner] Created Job` log lines and grep for `NETWORK_CHANGED` / `Target.*has been closed` in `[Dispatch]` lines. Expectation: zero CNI-related retries.

#### B3. Pre-warm exactly what the build needs, then suspend warm-pool

When a build starts with N tests + setup, pre-provision `min(maxParallelEBs + 1, ebPoolMax - inFlight)` pods in a single call before the executor begins, then let B1 keep the warm pool quiet. Avoids the slow ramp at the start of every build.

**New helper** (`src/lib/eb/provisioner.ts`): `prewarmForBuild(targetCount: number): Promise<number>` — same loop as `ensureWarmPool` lines 484-506 but parameterised on `targetCount` and respecting `awaitLaunchSlot()`.

**Caller** (`src/lib/execution/executor.ts:1168`): call before the semaphore loop. Wire `maxParallelEBs` through.

#### B4. Persist dead-EB retry attempts

Currently invisible. The fix is to write a `test_results` row for the failed attempt 1 with `status='failed'` and an `errorMessage` tagged `[EB-dead]`, link attempt 2 via `retry_of`. Use the existing `is_flaky` flag if attempt 2 passes (matches `flaky_count` aggregate semantics).

**Files**

- `src/lib/execution/executor.ts:1132-1140` and `:1141-1146` — instead of `continue`, persist the dead-attempt via `onResult({ status: 'failed', errorMessage: `[EB-dead] ${lastError}`, … })` with a synthetic id, then on attempt-2 success persist that result with `retryOf` set to the dead row's id and `isFlaky=true`.
- `src/lib/db/queries/tests.ts` — verify `createTestResult` accepts `retryOf` and `isFlaky` (already does per schema.ts:491-492).

**UX implication:** existing verify board and flake views will start surfacing dead-EB retries. Worth a one-line entry on `/builds` showing "1 retry due to EB infra".

#### B5. Reduce false dead-EB markings

`EB_DEAD_ERR_RX` (`executor.ts:986`) matches `Target .*has been closed` — but Playwright also raises that for legitimately-finished tests during cleanup. Tighten the regex or pair it with an EB-health probe before triggering retry. Specifically:

- Before deciding "dead", call `GET /health` on the EB's container URL (port 9224, per `provisioner.ts:322-327`). If 200, the EB is alive and the error is a test-code issue → don't burn another EB.
- Split the regex: `EB_INFRA_ERR_RX` (`ECONNREFUSED|EB network unhealthy|runner went offline`) → instant retry; `MAYBE_INFRA_ERR_RX` (`Target.*has been closed|page\.screenshot.*Target page.*closed`) → probe `/health` first.

**Files**

- `src/lib/execution/executor.ts:986, 1132-1146` — split detection.
- Optional new helper in `src/lib/eb/health-probe.ts` to keep the http call out of the executor body.

---

### Sequencing

1. Track A is independent — land it first (1 PR). Pure refactor.
2. B1 + B2 (smallest behaviour change, biggest waste reduction) — 1 PR.
3. B4 — 1 PR (observability before further behaviour tuning).
4. B3 + B5 — 1 PR (perf + correctness, after we can see the impact via B4).

### Expected outcome

| metric                           | before                  | after                          |
| -------------------------------- | ----------------------- | ------------------------------ |
| EBs launched per 16-test build   | ~26                     | ≤ 18                           |
| Warm-pool spawns during dispatch | ~10                     | 0                              |
| Dead-EB retries surfaced in DB   | 0                       | all                            |
| Idle EB reaper cycles per build  | 3–5                     | 0–1                            |
| `NETWORK_CHANGED` rate           | nonzero on tight bursts | 0 (or measurable in B4 if not) |

### Files touched (cumulative)

- new: `src/lib/setup/resolve-build-setup.ts`, `src/lib/setup/resolve-build-setup.test.ts`, `src/lib/eb/health-probe.ts` (optional)
- modified: `src/server/actions/builds.ts`, `src/server/actions/runs.ts`, `src/server/actions/debug.ts`, `src/lib/execution/setup-capture.ts` (shrink or delete), `src/lib/eb/provisioner.ts`, `src/lib/execution/executor.ts`, `src/server/actions/embedded-sessions.ts`, Olares deployment env (`EB_LAUNCH_INTERVAL_MS=500`)
