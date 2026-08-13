# Test plan — core/plugin refactor (`claude/core-plugin-refactor-plan`)

> **Status (2026-08-13): §0–§4 all executed.** §0/§1 directly; §2 via four
> parallel agents doing real runtime verification; §3 as ~30 committed
> `*.integration.test.ts` suites against live infra; §4 **automated as a real
> Playwright browser journey** (`e2e/`) rather than left as a manual
> walkthrough — which is what finally closed §2.18's "no browser was
> available" gap.
>
> - §2 found **2 regressions**, both since fixed (§2.18).
> - §3 found **no new regressions** in ~30 suites (§3.1).
> - §4's browser run found **3 real product bugs that every earlier layer
>   structurally could not see** — all three pre-existing on `main`, none
>   caused by this refactor (§4.1). The most serious: **the Recorder is
>   completely broken** in the default dev provisioner mode.
>
> Caveat on §4's numbers: they were gathered while a *second, unrelated*
> plugin-rollout effort was live in the same working tree, which repeatedly
> restarted and at times broke the dev server mid-run. See §4.2.

**Scope of "the refactor" as actually diffed against `main`:** 347 files,
+35,974/−7,419. This is **not** the full plugin rollout in
[`core-plugin-refactor.md`](./core-plugin-refactor.md) §9 — Phase 4 (roll out
one plugin per PR) is barely started. What actually landed on this branch:

- The kernel + contracts + five `@lastest/core-*` packages (`browser`, `data`,
  `jobs`, `repos`, `storage`, `tests`) and their app-side "host" fills in
  `src/lib/core/*-host.ts` (see [`core-scope.md`](./core-scope.md)).
- `explorer` extracted as the pilot plugin ([`explorer-migration-result.md`](./explorer-migration-result.md)) —
  its own doc already lists what it verified and, more importantly, **what it
  explicitly did not** (§6 there: no runtime exercise, `db:push` not run for
  `plugin_jobs`, the explorer table-rename migration not run against the dev
  DB). Treat every item in that §6 as still open unless you've since closed it.
- `packages/db/src/schema.ts` split into `packages/db/src/schema/{agents,
  eb-protocol,growth,identity,repos,runs,scm,settings,shared,tests,visual}.ts`.
- A billing-gating signature change: `hasQaAgentAccess`/`assertQaAgentAccess`
  now take an explicit `billingEnabled` param instead of reading env
  themselves ([`feature-access.ts`](../../src/lib/billing/feature-access.ts)) —
  every call site had to be updated; a missed one either wrongly locks out a
  self-hosted team or wrongly grants a free-tier one.
- Nine shadcn primitives (`badge`, `button`, `card`, `input`, `label`,
  `progress`, `select`, `tabs`, `textarea`) rewritten/slimmed and re-exported
  from `libs/ui` — these render on nearly every page in the product, so this
  is the single highest-blast-radius change in the diff even though it looks
  cosmetic in the stat list.
- Non-trivial behavioral changes inside `qa-agent` (`explore.ts` +392 new
  lines, `crawl.ts`, `server/actions/qa-agent.ts` +759/−103), `ranger.ts`
  (-CDP-direct, now via `ctx.browser`/`libs/page-map`), `scheduling/cron.ts`
  (gutted to a re-export shim over the new `libs/cron`), GitHub issues
  (`github-issues.ts`, `github-issue-body.ts`) plus a brand-new
  `verify/confirm-on-green.ts` auto-close path, `comparison/scorer.ts` +
  `storage-state-diff.ts`, `crypto-fields.ts`, and a new `playback/` module
  (`step-timings.ts`, `feature-flag.ts`) wired into `video-player.tsx` /
  `replay-player.tsx` / the new `playback-sync.tsx`.

This plan is ordered **cheapest-and-most-likely-to-catch-something first**:
automated gates → refactor-specific regression targets → full product
walkthrough. Don't skip straight to the full walkthrough — the automated
gates and the targeted section will catch most of what actually broke, for a
fraction of the time.

---

## 0. Prerequisites — close these before testing anything else

These are gaps `explorer-migration-result.md` §6 already flagged as
unresolved. If they're still open, several sections below will fail for
reasons that have nothing to do with whatever else changed.

- [ ] `pnpm tsx scripts/migrate-explorer-plugin-tables.ts` has been run
  against the environment you're about to test in, **in that order, before**
  `pnpm db:push`. Skipping this and running `db:push` first drops
  `agent_knowledge`/`agent_experience`/`agent_findings`/explorer's slice of
  `agent_sessions` (including encrypted `cred_password` values) instead of
  renaming them.
- [ ] `pnpm db:push` has been run since, and it includes the new `plugin_jobs`
  table (`packages/db/src/schema/runs.ts`) — confirm the table exists
  (`\d plugin_jobs` in psql, or check Drizzle Studio) rather than assuming.
- [ ] `pnpm install` is current (new workspace packages: `@lastest/kernel`,
  `@lastest/contracts`, `@lastest/core-browser`, `@lastest/core-data`,
  `@lastest/core-jobs`, `@lastest/core-repos`, `@lastest/core-storage`,
  `@lastest/core-tests`, `@lastest/plugin-events`, `@lastest/plugin-explorer`,
  `libs/ui`, `libs/cron`, `libs/ai-kit`, `libs/page-map`).
- [ ] `pnpm dev` (app) and `pnpm dev:pool` (EB pool service) are **both**
  running — the browser-host tests below need a real EB claim, not a mock.
- [ ] `⚠️ Do not run `pnpm db:reset`` for any of this — per `CLAUDE.md` it
  drops every table and needs explicit sign-off first.

---

## 1. Automated gates (run these first, in this order)

| # | Command | What it actually catches here |
| - | --- | --- |
| 1 | `pnpm install --frozen-lockfile` | new workspace packages resolve; no accidental external dep pulled into `plugins/*` or `core/*` |
| 2 | `pnpm arch` | import-boundary violations; compare the printed total to `tools/architecture/baseline.json` (`total: 36`) — **a rising number is a regression**, the ratchet only goes down |
| 3 | `pnpm lint` | ESLint boundary rules (`no-restricted-imports` on `plugins/**` / `core/**`) |
| 4 | `pnpm types` | the schema split and the new `@lastest/core-*` packages type-check across the whole app, not just in isolation |
| 5 | `pnpm test` | unit tests, including the new ones added on this branch — see §2 for which suites map to which risk area |
| 6 | `pnpm test:integration` | anything gated behind `vitest.integration.config.ts` (check what that config actually includes before assuming it covers DB-backed paths) |
| 7 | `pnpm build` | Next.js can still resolve `"use server"` actions and route pages that now live partly in packages; this is the check that would have caught an S1-fallback failure |
| 8 | `pnpm format:check` | should be a no-op if pre-commit hooks ran; run it anyway on a full-branch review |

If any of 1–4 fail, stop — fix those before spending time on manual testing,
they'll invalidate whatever you observe.

### 1.1 Test files worth running individually first

These were added or materially changed by this branch and are the fastest
signal for "did I break the thing the refactor touched":

```
pnpm test -- src/lib/db/plugin-deletion.test.ts
pnpm test -- src/lib/db/queries/deletion-cascade.test.ts
pnpm test -- src/lib/crypto-fields.test.ts
pnpm test -- src/lib/billing/feature-access.test.ts
pnpm test -- src/lib/qa-agent/explore.test.ts
pnpm test -- src/lib/integrations/github-issue-body.test.ts
pnpm test -- src/lib/verify/check-modes.test.ts
pnpm test -- src/lib/eb/stream-grant.test.ts src/lib/eb/front-proxy.test.ts
pnpm test -- tools/architecture/boundaries.test.ts
```

---

## 2. Refactor-specific regression targets

For each item: what changed, the concrete way it can break, and how to check
it. This is the section that should get the most actual time — it's aimed
directly at the diff, not a generic feature sweep.

### 2.1 `core/browser` — `src/lib/core/browser-host.ts`

**What changed:** feature code no longer calls `chromium.connectOverCDP`,
`claimEmbeddedBrowserForAgent`, or `releasePoolEB` directly for the migrated
paths (explorer, ranger). It now goes through `withBrowser`/`withBrowserSwarm`,
which owns claim → storage-state injection → run-minute metering → release,
including on throw.

**Failure modes to actively check for:**
- EB never released on an exception inside the callback → pool exhaustion
  after a few failed runs. Force a failure mid-explorer-run (bad target URL,
  or kill the EB pod manually) and confirm `pnpm stack:status` /
  `dev:pool` logs show the slot freed within seconds, not leaked.
- `assertAgentRunMinutesAvailable` still enforced — start an explorer run on a
  team at/over its run-minute quota and confirm it's rejected before an EB is
  claimed, not after.
- `storageStateId` injection still round-trips: run explorer against a repo
  with a saved storage state and confirm the browser starts already
  authenticated (check network/DOM, not just "no error").
- `session.streamUrl` on the returned handle is pre-signed/proxied, never a
  raw pod address — open the live viewer during an explorer run and confirm
  the stream connects through the front proxy, not directly to a pod IP.
- `isolatedPage()` (used by explorer's iteration loop instead of
  `withBrowserSwarm`, per `explorer-migration-result.md` §4) actually shares
  auth state across iterations within one claimed browser — run a multi-step
  explore against an authenticated app and confirm iteration 2+ isn't logged
  out.

### 2.2 `core/ai` — `src/lib/core/ai-capability.ts`

**What changed:** provider selection, prompt logging, and the `tier: "fast" |
"balanced" | "deep"` abstraction replace direct model-id selection; explorer's
per-repo `explorerModel` setting is now resolved as "what this tenant's `fast`
tier means" rather than passed through.

**Check:**
- An explorer run on a repo with a custom `explorerModel` setting still uses a
  model consistent with that setting (check `ai_prompt_logs` for the actual
  model used, not just that a call succeeded).
- `ai_prompt_logs` still gets written with token counts for **non-explorer**
  callers (qa-agent, quickstart, healer/generator agents) — the doc flags that
  explorer specifically reports `inputTokens: 0, outputTokens: 0` through
  `ctx.ai` as a known, accepted gap. Confirm that gap is scoped to explorer
  and hasn't spread to other AI settings screens' usage displays.
- AI settings page (`src/components/settings/ai-settings-card.tsx`, +90 lines
  on this branch) still saves/loads correctly — this file changed alongside
  the capability refactor, so check the 500ms-debounced autosave path
  specifically (per `CLAUDE.md`: `originalValues`/`hasChanges`/`doSave`/
  `useEffect` deps all need to agree).

### 2.3 `core/jobs` — `src/lib/core/jobs-host.ts`, `plugin_jobs` table

**What changed:** a brand-new queue (`plugin_jobs`, distinct from
`background_jobs`) with `enqueuePluginJob`/`cancelPluginJob`/
`getPluginJobStatus`, gated by `isRegisteredType` from the composition root.

**Check — this is explicitly unverified per `explorer-migration-result.md`§8:
"nothing exercises them against a real plugin or a real HTTP request."**
- Confirm at least one plugin actually enqueues a job (grep for
  `ctx.jobs.enqueue` — if the answer is "still zero consumers," this whole
  path is dead code and testing it further isn't useful yet; note that
  instead of chasing it).
- If there is a consumer: enqueue with a duplicate `dedupeKey` for the same
  `pluginId`+`teamId` and confirm it's a no-op, not a second row. Enqueue with
  an unregistered `type` and confirm it's rejected at write time, not silently
  queued.
- Confirm the worker loop (`processDueJobs`) actually claims and completes a
  due row — this needs the loop to be running somewhere (check `runtime.ts`
  for where it's ticked; it may not be wired into `pnpm dev` at all yet).

### 2.4 `core/storage` — `storage-host.ts`, `storage-grant.ts`, `/api/plugin-storage`

**Check — flagged "reviewed, not curl'd" in the migration doc:**
- Actually request a `signedUrl` for a plugin blob and hit
  `/api/plugin-storage` with it before the grant's TTL expires → 200 with the
  right bytes. Hit it again after the grant window → rejected, not served
  from cache.
- Attempt to reuse a **stream** grant (from `src/lib/eb/stream-grant.ts`)
  against `/api/plugin-storage`, and a **storage** grant against the EB
  stream endpoint. Both must fail — the HKDF info strings are supposed to
  make them non-interchangeable (`GRANT_KEY_INFO = "plugin-storage-grant-v1"`
  vs. the stream grant's own info string). This is a security boundary, not
  just a functional one.
- Confirm `teams.storageUsedBytes` is *not* affected by plugin-storage writes
  (deliberately independent per the file's own comment) — write a large
  plugin blob and confirm the team's storage quota bar on the billing page
  doesn't move.

### 2.5 `core/events` — `events-host.ts`, activity feed

**Check:**
- Trigger an event from a still-non-plugin feature that writes
  `activityEvents` directly (qa-agent, play-agent, quickstart-agent,
  spec-import, gamification — per the doc, none of these route through the
  new host yet) and confirm it still appears in the live activity feed
  (`/api/activity-feed/sessions`, the SSE-backed UI) and in
  `/api/v1/activity` history.
- Trigger one from explorer (which *does* go through `ctx.events.emit`) and
  confirm it shows up identically — same feed, same shape, correct
  `sourceType` cast (`explorer_agent`).
- This is the one place the doc names a **known, accepted bend** (`sourceType`
  is a closed union, not open) — not a bug to file, but worth confirming no
  new `sourceType` value silently falls through to something wrong in the UI.

### 2.6 `core/repos` / `core/tests` — `repos-host.ts`, `tests-host.ts`

**Check:**
- `ctx.repos.baseUrl(repoId, branch)` resolution order, confirmed by direct
  test (2026-08-10): `branchBaseUrls[branch]` → `branchBaseUrls.main` →
  *any other* entry in `branchBaseUrls` → `environment_settings`. **Correction
  to the earlier framing here:** "no entry for that branch" does **not** fall
  straight to `environment_settings` — it falls to any other branch entry
  first, and only reaches `environment_settings` if `branchBaseUrls` is
  entirely empty. This matches `core/repos/src/repos.ts`'s own docstring and
  is byte-identical to the pre-refactor `resolveTargetUrl` logic (diffed
  against `fb6cd661`), so it's not a behavior change — just correcting how
  this doc described it. One net-new thing the capability adds that
  `resolveTargetUrl` never had: a tenancy check (`repo.teamId !== team.id →
  null`) before resolving anything — a strict improvement, not a regression.
- `ctx.tests.createQuarantined(input)` — create one from explorer's UI and
  confirm: the new test lands under the correct repo/team (no cross-tenant
  leak — this is called out in `core-scope.md` as *the* sharpest write-into-
  core case in the whole refactor), the functional area is resolved/created
  correctly by name, and the `quarantined` flag is set. Then try to create a
  near-duplicate functional area by name twice and confirm the accumulation
  behavior matches what the doc predicts (near-duplicates are possible; that
  was accepted, not fixed — just confirm it's still merely a nuisance, not a
  crash or a tenancy break).

### 2.7 Schema split — `packages/db/src/schema/*.ts`

**Check:**
- `pnpm db:studio` opens and every table is visible and browsable — the split
  is purely organizational (`src/lib/db/schema.ts` is a re-export shim per
  `CLAUDE.md`), so anything that fails here means an import got dropped in
  the split, not a real schema change.
- Grep for any remaining `from "@/lib/db/schema"` or
  `from "@lastest/db/schema"` deep-imports that reference a specific
  sub-module path incorrectly (e.g. importing `visual.ts` internals directly
  instead of through the barrel) — these would compile fine today and break
  the moment someone reorganizes the sub-modules again.
- `drizzle.config.ts`'s glob over `plugins/*/src/schema.ts` doesn't
  accidentally also match something under `packages/`.

### 2.8 GDPR deletion cascade — `src/lib/db/plugin-deletion.ts`

**This is the correctness risk the RFC called out by name (§5, §10) and it's
now got real code behind it — test it for real, not just via the unit test.**
- Delete a **team** that has explorer data (knowledge/experience/findings
  rows, an explorer trigger, a `plugin_jobs` row if any exist) and confirm
  every plugin-owned row is gone afterward — query the tables directly, don't
  trust the UI's success toast.
- Delete a **repository** (not the whole team) and confirm only that repo's
  plugin data is removed, not a sibling repo's under the same team.
- Confirm the dynamic-import trick in `plugin-deletion.ts` (deferred specifically to avoid a module cycle with `runtime.ts`) doesn't throw
  in production build mode (`pnpm build && pnpm start`) — a dynamic import
  that only worked under `next dev`'s module resolution would be a nasty
  deploy-time surprise.

### 2.9 Billing gating signature change — `feature-access.ts`

**What changed:** `hasQaAgentAccess(plan)` → `hasQaAgentAccess(plan,
billingEnabled)`; same for `assertQaAgentAccess`. Every call site had to add
the second argument.

**Check — grep for every call site and verify each one, this is exactly the
kind of change a missed call site breaks silently:**
- Self-hosted (no `STRIPE_SECRET_KEY`): QA Agent should be unlocked for every
  plan, including `free` — confirm both the sidebar (client-side gate,
  reading a passed-in prop, not env) and the server action (`assertQaAgentAccess` inside `src/server/actions/qa-agent.ts`) agree.
- Billing enabled, team on `free`/`starter`/`growth`: QA Agent should be
  locked, upgrade screen shown, and the server action should still reject a
  direct call even if someone bypasses the UI.
- Billing enabled, team on `pro`: unlocked in both places.
- The client/server drift this refactor exists to prevent: intentionally
  check a component that renders under SSR vs. one that hydrates client-side
  and confirm they don't disagree for the same team mid-session.

### 2.10 UI primitives — `libs/ui` (badge, button, card, input, label, progress, select, tabs, textarea)

**Why this matters more than its diff size suggests:** these render on nearly
every screen. A visual or behavioral regression here shows up everywhere, not
in one feature.

- **Correction (2026-08-10): the "select.tsx shrank ~200 lines" framing was
  wrong.** Diffed `libs/ui/src/select.tsx` against `main`'s
  `src/components/ui/select.tsx` directly — they're byte-identical (211 lines
  both sides, same for all 9 primitives, modulo the `cn` import path). The
  200-line shrink is entirely `src/components/ui/select.tsx` becoming a
  17-line re-export shim, not a simplification of the implementation. Since
  every `cva` variant map and exported symbol is untouched, this item is
  lower-risk than originally framed — but still worth a light pass: exercise
  a couple of dropdowns (settings dropdowns, plan selectors, check-mode
  selectors in `verify/check-modes-dialog.tsx`) to confirm the re-export
  wiring itself resolves correctly at runtime, not just at the type level.
- `tabs.tsx` — click through every tabbed surface (Verify's step detail tabs,
  Settings sections, Tests detail page) and confirm the active-tab indicator
  and content-switching still work, and that deep-linking to a specific tab
  (if any page does that via URL) still resolves.
- `badge.tsx`/`progress.tsx` — check status badges (test pass/fail, build
  status) and progress bars (storage quota, run-minute usage, explorer
  progress) for correct color variants — a variant prop rename during the
  slimdown is the likely failure mode, and it fails silently (renders,
  wrong color) rather than crashing.
- Do a light visual diff pass in both light and dark theme — these primitives
  are exactly what theme-aware styling depends on.

### 2.11 `qa-agent` (`explore.ts`, `crawl.ts`, `server/actions/qa-agent.ts`)

**The single largest behavioral diff in this branch** (`qa-agent.ts`
+759/−103 lines) and qa-agent is explicitly **not yet migrated to a plugin** —
it's still `src/lib/qa-agent`, still on the old direct-CDP path per
`core-plugin-refactor.md`'s own count (10 `chromium.connectOverCDP` call
sites, several inside `qa-agent`). So this isn't core-boundary risk — it's
"a large feature got rewritten in the same branch as the architecture work."

- Run a full QA Agent session end-to-end against a real target: crawl
  discovery → task generation → execution → findings/report. Compare the
  findings quality/coverage against a pre-refactor run on the same target if
  you have one to diff against.
- Pay particular attention to anything path-adjacent to explorer, since the
  RFC explicitly notes `explorer` used to import `@/lib/qa-agent` and that
  coupling was supposed to be cut — confirm qa-agent's behavior wasn't
  altered as a side effect of extracting explorer's copy of shared logic
  (auth discovery, crawling) into `libs/page-map`/`explorer`'s own
  `browser/login.ts`.

### 2.12 `ranger.ts`, `libs/page-map`

**Correction after running `pnpm arch` (2026-08-10): `ranger.ts` itself still
directly imports `playwright` at line 1** — `ranger::browser: 1` is unchanged
from `tools/architecture/baseline.json`, i.e. this specific violation was
never in scope for this branch. What actually changed, per
`explorer-migration-result.md` §2, is narrower: explorer's own `planner.ts`
and `research.ts` used to call into `ranger.ts` (`@/lib/playwright/ranger`,
a cross-plugin import) for `browsePageMap(cdpUrl, url)`; that call is gone,
and the DOM-extraction half of it now lives verbatim in the new
`libs/page-map`, shared by both explorer and (still) `ranger.ts` internally.
`ranger.ts`'s own direct-CDP connect for its primary use (autoring/recorder
flow) is untouched.

- Confirm explorer no longer imports anything from `src/lib/playwright/ranger`
  (`grep -rn "playwright/ranger" plugins/explorer` should be empty) — that's
  the actual change to verify, not a ranger-side behavior change.
- Run Ranger directly (its own recorder/authoring entry point) and confirm it
  still works — it's on the same direct-CDP path as before, so this is a
  plain regression check, not a boundary-migration check.
- Run Explorer against a real page and confirm the page map it produces via
  `libs/page-map` is equivalent to what `ranger.ts`'s old `browsePageMap`
  produced — since the extraction logic moved verbatim per the migration doc,
  a regression here would most likely be a wiring bug (wrong page passed in),
  not a logic bug.

### 2.13 Scheduling (`cron.ts` → `libs/cron` shim, `scheduler.ts`)

- `src/lib/scheduling/cron.ts` is now a thin re-export over `libs/cron` — confirm every existing caller (schedules UI, cron validation in settings, the
  scheduler's dispatch loop) still resolves `PRESET_SCHEDULES`, `isValidCron`,
  etc. through the shim with identical behavior. Create a schedule with each
  preset, and one custom cron expression, and confirm both validate and fire
  at the expected time (or use a near-future custom expression to observe a
  real fire within the test window).
- `scheduler.ts`'s cron-dispatch path used to call `getTeam(trigger.teamId)`
  directly; per the migration doc this now goes through
  `contextFor({ teamId })` → `ctx.team` for at least the explorer trigger
  path. Confirm a **non-explorer** scheduled run (a regular scheduled test
  run) still dispatches correctly — this is the part of `scheduler.ts` that
  wasn't part of the explorer migration and needs to keep working unchanged.

### 2.14 GitHub issues — `github-issues.ts`, `github-issue-body.ts`, `confirm-on-green.ts`

- File a GitHub issue from a failing test result with full evidence (per
  `c3ad7e1f "full-evidence GitHub issues"`) and confirm the issue body still
  renders correctly on GitHub (screenshots/diffs linked, not broken markdown —
  there's a dedicated test file, `github-issue-body.test.ts`, but confirm
  against a real GitHub issue too, since rendering on GitHub's side isn't
  something a unit test can catch).
- Confirm AI-engineer assignment still happens on issue creation.
- **`confirm-on-green.ts` is new — this is the auto-close path and has no UI
  trigger, so it needs a deliberate test:** create an issue via the normal
  flow (state `auto`), fix the underlying regression, get a rerun to
  `safe_to_merge`, and confirm the issue auto-closes with a comment linking
  the green build. Then repeat with an issue that was manually re-linked
  (state `linked`, not `auto`) and confirm it does **not** auto-close — the
  scope guard the file's header describes.
- Confirm a normal human-driven "closes #N" PR merge still triggers the
  existing webhook re-run path unaffected by the new auto-close code sharing
  the same finalization hook.

### 2.15 Comparison scoring — `scorer.ts`, `storage-state-diff.ts`

- Run a build that exercises multiple check layers and confirm the aggregate
  score/verdict per step matches expectations for known-good and known-bad
  cases — `scorer.ts` changed by 45 lines, small enough that a targeted
  before/after comparison on a couple of fixtures is more useful than a broad
  sweep.
- `storage-state-diff.ts` is entirely new (116 lines) — find or create its
  caller (likely inside Verify's storage/state check layer) and confirm it
  produces a sensible diff between two storage states, including the "no
  differences" case (empty/equal diff, not a false positive).

### 2.16 `crypto-fields.ts`

- This underlies encrypted DB fields used broadly (storage-state credentials,
  explorer's `cred_password`, OAuth tokens, etc.). Confirm round-trip
  encrypt/decrypt still works for **existing pre-refactor encrypted rows**,
  not just newly-written ones — if the encryption scheme, key derivation, or
  prefix (`ENC_PREFIX`) changed at all, old ciphertext could become
  unreadable. This is the highest-severity failure mode in this whole plan
  (silent data loss on secrets) — test it explicitly against a row you know
  predates this branch, don't only test fresh writes.

### 2.17 Playback (`playback/step-timings.ts`, `feature-flag.ts`, `playback-sync.tsx`, `video-player.tsx`, `replay-player.tsx`)

- Open a build's Verify page, play back a step's recorded video, and confirm
  the scrubber/timeline stays in sync with the annotated step markers
  (per spec 28, "Persist step timings on the video clock + annotated
  scrubber"). Scrub manually to a specific step and confirm the right
  evidence/DOM snapshot is shown for that timestamp.
- Check the feature flag in `playback/feature-flag.ts` — confirm both the
  flag-on and flag-off code paths render something coherent (not a half-
  migrated UI) if the flag is meant to still gate anything at this point.

---

## 2.18 Results — 2026-08-10 verification run

§0, §1, and §2 were executed end to end: §0/§1 directly (automated gates,
prerequisites, the EB pool + app both brought up); §2's 17 targets fanned out
across four parallel agents, each doing real runtime verification (DB
create/delete cycles, direct capability-function calls, curl round-trips
against the live app) rather than a re-read of the code, with an explicit
constraint that no browser-automation tool was available in this environment
— items needing an actual rendered UI are marked accordingly below.

### Confirmed regressions (2) — fix before this branch ships

1. **`plugin_jobs` rows are orphaned on team deletion (§2.8, GDPR).**
   `packages/db/src/schema/runs.ts:184`'s `pluginJobs` table has no FK to
   `teams` and isn't a plugin-owned schema, so it's invisible to both
   `deleteTeam`'s FK-cascade path and `runDeletionHooks`
   (`core/data/src/deletion.ts:51`, which only walks plugin-registered
   schemas). Reproduced directly: create a team, enqueue a `plugin_jobs` row
   scoped to it, delete the team, the row survives with the deleted team's id
   still in `team_id`. Currently masked because zero plugins call
   `ctx.jobs.enqueue` yet (confirmed by grep and by `runtime.ts`'s own
   comment) — will silently leak data the moment one does. **Fix:** either
   add `.references(() => teams.id, { onDelete: "cascade" })` to
   `plugin_jobs.team_id`, or add it to `runDeletionHooks`'s core-table sweep.

2. **`/api/plugin-storage` is missing from `PUBLIC_PATHS` in `src/proxy.ts`
   (§2.4).** The route is designed for grant-only auth (no session needed —
   same pattern as `/api/embedded/stream/ws`, which *is* listed), but the
   front-proxy 307-redirects any unauthenticated request there to `/login`
   before the route handler ever runs. Verified with curl: grant + no cookie
   → `307`; identical grant + session cookie → `200` with correct bytes. This
   breaks the feature's actual intended usage (a caller with a grant but no
   app session — the entire point of a signed grant). **Fix:** add
   `"/api/plugin-storage"` to `PUBLIC_PATHS` in `src/proxy.ts` (one line, same
   list `/api/embedded/stream/ws` is already in).

Both were reproduced with concrete before/after evidence, not inferred from
reading code, and both fall inside the sign-off checklist's escalate-
immediately class (§8 below still applies: GDPR-class and a broken security
boundary, respectively).

### Everything else checked: no other regressions found

- **§2.1 `core/browser`** — the real integration suite (`browser.integration.test.ts`,
  `isolatedPage`/`withBrowser`/`withBrowserSwarm` against a live EB) passed
  15/15 once the app was actually running for EBs to register against (an
  environment-setup miss on the first attempt, not a code issue — see §1
  above). Release-on-throw, deadline teardown, and swarm isolation all
  confirmed working.
- **§2.2 `core/ai`** — the `explorerModel` setting only overrides the `fast`
  tier (tester calls), not `balanced` (planner/analyst) — confirmed
  deliberate and documented in `plugins/explorer/src/ai/gateway.ts:13-27`,
  just not disclosed in the Settings UI copy. Autosave wiring for the three
  new AI settings fields confirmed present in all four required places.
- **§2.3 `core/jobs`** — dedup and unregistered-type rejection both work
  correctly at the host layer (`jobs-host.ts`); the raw query layer has no
  gate of its own, harmless today since nothing calls it directly. The
  worker loop (`processDuePluginJobs`) is correct but has zero callers
  anywhere in `src/` — genuinely unwired, not broken.
- **§2.5 `core/events`** — both the non-plugin and `ctx.events` paths land
  correctly in `activity_events` and are retrievable via
  `/api/activity-feed/history`. The `sourceType` closed-union bend is real
  (explorer's raw id `"explorer"` isn't in the `ActivitySourceType` union)
  but confirmed cosmetic — falls through to a generic default in the UI, not
  a crash.
- **§2.4 `core/storage`** (beyond the regression above) — expiry, and the
  storage-grant/stream-grant cross-type rejection, both verified to hold at
  the crypto layer; `teams.storageUsedBytes` confirmed independent as
  designed.
- **§2.6 `core/repos`/`core/tests`** — resolution order and tenancy checks
  verified correct (see the §2.6 correction above); `createQuarantined`'s
  near-duplicate functional-area accumulation behaves exactly as the RFC
  predicted (nuisance, not a tenancy break); cross-tenant reads/writes both
  correctly rejected.
- **§2.7 schema split** — every table reachable from the barrel, no deep
  imports anywhere, no glob collision.
- **§2.9 billing gating** — every `hasQaAgentAccess`/`assertQaAgentAccess`
  call site correctly threads `billingEnabled`; verified end to end with a
  real HTTP call against a free-plan team in this (billing-disabled)
  environment — QA Agent access was not rejected, as expected.
- **§2.10 UI primitives** — see the correction above; all 9 primitives are
  byte-identical to `main`, only their `src/components/ui/*` counterparts
  became re-export shims. Lowest actual risk of anything in §2 despite
  looking like the widest blast radius on paper.
- **§2.11 `qa-agent`** — the 862-line action-file diff and the new 392-line
  `explore.ts` were read in full; no accidental behavior changes found (no
  dropped awaits, inverted conditions, or silently swallowed errors beyond
  pre-existing patterns). Two real test-coverage gaps, not regressions:
  `exploreTargetApp`'s browser-driving orchestration and `storage-state-diff.ts`
  both ship with zero direct tests.
- **§2.12 `ranger.ts`/`libs/page-map`** — see the correction above;
  extraction logic confirmed verbatim-identical between the old inline
  closure and the new `libs/page-map/src/scripts.ts`.
- **§2.13 scheduling** — the `cron.ts` shim is a byte-identical re-export of
  `libs/cron` (diffed directly, not just claimed); regular scheduled-run
  dispatch (as opposed to explorer's trigger dispatch, which did change) is
  byte-unchanged and was exercised at runtime — a real due schedule was
  picked up and dispatched on the next tick.
- **§2.14 GitHub issues / `confirm-on-green.ts`** — the `'auto'`/`'open'`
  scope guard matches the actual query filter exactly; the function is only
  reachable from trusted server-side build-finalization code, never a
  client-invokable `"use server"` export.
- **§2.15 comparison scoring** — `scorer.ts`'s new `storageState` evidence
  entry is additive-only and can never gate a verdict on its own (only
  `"low"` signal); `storage-state-diff.ts` correctly returns a clean result
  for the no-differences case. No dedicated test file for the new function.
- **§2.16 crypto-fields** — `src/lib/crypto.ts` has zero diff against `main`
  (byte-identical `PREFIX`, algorithm, key derivation), so the "old
  ciphertext becomes unreadable" risk doesn't apply regardless of the dev
  DB's lack of pre-existing encrypted rows to test against.
- **§2.17 playback** — feature flag confirmed to gate two real consumers
  correctly on both the flag-on and flag-off paths, no half-migrated UI;
  `resolveStepSegments`'s degradation ladder verified directly against 5
  cases via direct execution.

### What genuinely could not be verified here

No browser-automation tool was available in this environment, so nothing
requiring an actual rendered/interactive UI was exercised end to end:
live keyboard-nav/visual inspection of the UI primitives, the EB live-stream
viewer, the video-playback scrubber's visual sync, and any full click-through
flow (explorer/qa-agent live runs, the golden-path walkthrough in §4 below).
§2's code-level and API-level verification substantially de-risks these —
particularly for the UI primitives, where "byte-identical to `main`" is
stronger evidence than a visual click-through would have produced anyway —
but §4's manual pass is still the right next step for anyone with a browser
in hand.

---

## 3. Full product feature matrix

Broader sweep across everything `lastest.cloud` does, for confidence beyond
the refactor's direct blast radius. Priority: **P0** = golden path, test
every time; **P1** = important, test when time allows or when adjacent code
changed; **P2** = spot-check.

| Area | Priority | Touched by this refactor? | What to verify |
| --- | --- | --- | --- |
| Auth (login/register/OAuth GitHub+GitLab+Google, sessions, invites) | P0 | No | Full login/logout, OAuth round-trip for each provider, invite-accept flow, session persistence |
| Onboarding | P1 | No | New-team onboarding wizard completes and lands on the right first screen |
| Repos + repo access | P0 | Indirect (`repos-host.ts`) | Add/connect a repo, `requireRepoAccess` still enforced correctly per §2.6 |
| Setup/teardown scripts, configs | P1 | No | Create/edit a setup script, confirm it runs before recorded tests |
| Recorder (record a test) | P0 | No direct change, but shares `libs/ui` primitives | Record a new test end-to-end, save, confirm steps captured correctly |
| Ranger (auto path exploration) | P1 | Yes — §2.12 | See §2.12 |
| Authoring AI (generator/healer/enhancer agents) | P1 | Indirect (`core/ai`) | Generate a test via AI, heal a broken selector, confirm `ai_prompt_logs` written |
| Quickstart agent | P1 | Indirect (`core/ai`, `core/browser` via pool-service) | Run quickstart on a fresh repo, confirm scaffolded tests are sane |
| Tests list / functional areas tree | P0 | Indirect (`core/tests`) | Browse tree, create/move a test, quarantine flag behavior matches §2.6 |
| Test runs / builds | P0 | No direct change | Trigger a run, confirm build created, status transitions correctly |
| Visual diff review (approve/reject baselines) | P0 | No direct change, uses `libs/ui` badge/select | Approve and reject a diff, confirm baseline updates, ignore-regions still work |
| Verify (9 check layers: visual/text/dom/network/console/a11y/design/perf/url) | P0 | Yes — comparison scorer, storage-state-diff, playback, confirm-on-green all live here | Run through each layer's evidence pane, confirm case-status derivation, see §2.14–§2.17 |
| App Map (explore/map/screens/flows) | P1 | Indirect — `explorer` migration touched shared code | Run an Explore session, confirm map/flow player renders |
| Explorer agent | P0 | **Directly migrated to a plugin** — highest refactor risk | Full run per §2.1–§2.6; also confirm knowledge/experience/findings pages still show historical data after the table rename migration |
| QA Agent | P0 | Yes — largest raw diff, §2.11 | Full session per §2.11 |
| Compare / Compose | P1 | No | Compare two builds/versions, compose a spec |
| URL Diff | P1 | No | Capture and diff a URL trajectory |
| Analytics / Impact | P2 | No | Dashboards load, numbers plausible |
| Leaderboard / Gamification / Awards | P2 | No | Season scoring, Bug Blitz events, repo awards still compute |
| Scheduling (cron-triggered runs) | P0 | Yes — §2.13 | Per §2.13 |
| GitHub/GitLab integrations (PRs, pipelines, webhooks) | P0 | Issues path yes — §2.14; pipelines no | Per §2.14, plus a GitLab pipeline trigger smoke test |
| CSV / Google Sheets data sources | P2 | No | Import a CSV/Sheet, confirm rows drive a parameterized test |
| RCA (root cause analysis) | P2 | No | Trigger RCA on a failed run, confirm output |
| API test | P2 | No | Run an API test, confirm assertions evaluated |
| Design-system check layer | P1 | No (still pre-plugin) | Verify design-token diff detection |
| A11y check layer / WCAG scoring | P1 | No | Score trend still computes on a build |
| Public share links (`/r/<slug>`, `/share/<slug>`) | P1 | Indirect — `share/captions.ts`, `video-fallback.ts`, `chapter-rail.tsx` changed | Open a public share link, confirm captions render and video fallback works if the primary asset is missing |
| Demo notes | P2 | No | AI demo notes generate on a build |
| Runners (remote runner CLI, `@lastest/runner`) | P1 | No | Register a runner, dispatch a command, confirm result posts back |
| MCP server | P2 | No | Connect an MCP client, list/run a tool |
| Settings — Playwright/Environment/Diff/AI/Notification | P0 | AI + Notification cards changed on this branch | Edit each settings section, confirm 500ms-debounced autosave (`originalValues`/`hasChanges`) behaves, per `CLAUDE.md` |
| Settings — Billing | P0 | Yes — §2.9 | Per §2.9, plus Stripe webhook plan-flip still updates `teams.plan` immediately |
| Runners status page, health checks | P2 | No | `/api/health`, `/api/runners/status` respond correctly |
| VS Code extension | P2 | No | Connect extension to a local instance, confirm basic round-trip |
| EB stream viewer / live embedded browser view | P0 | Indirect — `explorer-browser-viewer.tsx` changed, stream grant unaffected | Watch a live EB session stream during any browser-driving flow |
| Team/repo deletion (GDPR) | P0 | Yes — §2.8 | Per §2.8 |

---

## 4. Golden-path E2E script — **now automated** (`e2e/`)

This was written as a manual walkthrough only because the run that produced
§2.18 had no browser. That premise turned out to be wrong about the repo:
`playwright` and `@playwright/test` are already root dependencies and
Chromium is installed, so §4 now exists as a real browser suite driving the
actual app at `http://localhost:3000`:

| File | Covers |
| --- | --- |
| `e2e/harness.ts` | Local target app, Chromium session + console-error capture, the real register → onboarding → sandbox-repo flow, DB helpers |
| `e2e/golden-path.integration.test.ts` | Steps 1–7b as ONE continuous journey (state carries between steps) |
| `e2e/settings-ui.integration.test.ts` | Steps 12–14 |
| `e2e/agents-ui.integration.test.ts` | Steps 10–11 (written; see §4.2) |
| `e2e/share-and-deletion.integration.test.ts` | Steps 15–16 + the 8–9 triage (partial; see §4.2) |

Run with `pnpm test:integration`. Prerequisites are the usual ones **plus a
running app** (`pnpm dev`), since these drive it over HTTP.

Why this is worth more than the manual pass it replaces: it is re-runnable,
and it caught three real bugs (§4.1) that ~30 non-browser suites in §3 could
not, because each of them lives specifically in the gap between "the server
action works" and "the product works".

The steps below are the original script, kept as the specification the suite
implements.

1. Log in (or register a fresh team) → confirm onboarding lands correctly.
2. Connect/add a repository.
3. Record a new test against that repo.
4. Save it; confirm it appears in the Tests tree under the right functional
   area.
5. Trigger a run → confirm a build is created and progresses to completion.
6. Open the build; review the visual diff; approve one screenshot, reject
   another with a comment.
7. Open Verify for that build; walk each check-layer tab; confirm evidence
   renders and the step-timing scrubber (playback) stays in sync.
8. From a failing result, file a GitHub issue with full evidence; confirm it
   appears on GitHub, correctly assigned.
9. Push a fix, let the webhook re-run fire, get the build to `safe_to_merge`;
   confirm the issue auto-closes via `confirm-on-green`.
10. Kick off an Explorer session against the same repo; watch the live EB
    stream; let it run to completion; check findings, knowledge, and that the
    EB was released (`pnpm stack:status` / pool-service logs show the slot
    freed).
11. Kick off a QA Agent session; confirm crawl → tasks → execution → report.
12. Create a scheduled run (one preset cron, one custom); confirm it validates
    and appears in the schedule list.
13. Open Settings → Billing; confirm QA Agent gating matches the team's actual
    plan and billing-enabled state (§2.9).
14. Open Settings → AI and Notification; make an edit in each; confirm
    autosave and reload-persistence.
15. Generate a public share link for the build; open it in an incognito
    window; confirm it renders without auth, including captions/video
    fallback.
16. As a final destructive-but-necessary check (on a **disposable** test team,
    not your real one): delete the team and confirm every table this plan
    touched — including explorer's plugin tables and any `plugin_jobs` rows —
    is actually gone (§2.8).

---

### 4.1 Results — 2026-08-13 browser run

Best clean run of `golden-path.integration.test.ts`: **8 passed / 2 failed**,
both failures being real product bugs the suite deliberately asserts as red
rather than hiding. `settings-ui.integration.test.ts`: **green, twice, with
clean teardown.**

| Step | Verdict |
| --- | --- |
| 1 register → onboarding | PASS |
| 2 sandbox repo + base URL | PASS — repo created through the wizard, `branchBaseUrls.main` set to the target |
| — app shell renders, zero console errors | PASS — `libs/ui` re-exports resolve at runtime (§2.10) |
| 3 record a test | **PARTIAL — recorder is broken (finding 1).** Test authored through the real Import-code UI instead; labelled as such in the file |
| 4 test appears in tree under its area | PASS — asserted against the rendered tree |
| 5 Run All → build completes | PASS |
| 6a approve build → baselines | PASS |
| 6b real diffs; approve one, reject one with comment | PASS — real pixel diffs, both decisions persisted |
| 7 Verify check-layer tabs | PASS — **13 layers walked, 13 distinct panes**; content genuinely switches, deep-link `?mode=focus` resolves (§2.10) |
| 7b playback scrubber sync | Blocked by finding 2; verified via the `forceVideoRecording` path instead (§2.17) |
| 12 schedules (preset + custom cron) | PASS — preset resolves through the `libs/cron` shim *in the client bundle*, invalid cron rejected |
| 13 billing / QA-Agent gating | PASS — no client/server drift, checked on `free` and on `pro` |
| 14 settings autosave | PASS — **debounce survives a real page reload**, both cards, including §2.2's new `explorerModel` field |

#### Findings — 3 real bugs, all pre-existing on `main`, none caused by this refactor

1. **The Recorder is completely broken in the default dev provisioner mode.**
   Every session dies with `page.evaluate: ReferenceError: __name is not
   defined`. `browserRecordingScript` (`packages/embedded-browser/src/browser-script.ts`)
   contains named inner functions; esbuild's `keepNames` — via `tsx`, which
   is how `process`-mode EBs are launched — rewrites them to call a `__name`
   helper, and Playwright then serialises that source into a page where the
   helper does not exist. Recorder sources are byte-identical to `main`.
   **Why §3 missed it:** §3's Recorder row drove Playwright directly and ran
   codegen, explicitly noting it never touched the `start_recording` path.
2. **Settings → Testing → "Video Recording" is a dead toggle.** It is saved
   and read back correctly, and *nothing consumes it*: the EB executor gates
   video solely on `command.forceVideoRecording`
   (`test-executor.ts`), which only demo/share builds pass. Verified true on
   `main` too. Consequence: the spec-28 annotated scrubber is unreachable
   through the documented path — step 7b reaches it via `forceVideoRecording`.
3. **`repositories` has no foreign key to `teams` at all** — the column's own
   comment claims one was "added after teams table definition"; it never was.
   Deleting a team therefore orphans its repositories. **5 orphaned repos
   already exist in the dev DB.** Same class as §2.18's confirmed
   `plugin_jobs` regression but wider, and directly relevant to §2.8's GDPR
   claim: the cascade has a hole *above* the plugin layer.

Two harness/infra issues also surfaced, both fixed or recorded:

- `queries.deleteTeam()` **throws** for any team that still has a member
  (`users_team_id_teams_id_fk` is NO ACTION); the product avoids this by
  deleting the user first. `destroyTeam` swallowed the throw and leaked every
  e2e team — now fixed to delete users and repos first, and to fail loudly.
- EBs can be left `busy` and are **not reaped**, wedging the pool at
  `online: 0` until cleaned by hand. Observed after abnormally-terminated
  runs; it is §2.1's pool-exhaustion mode, reachable in practice.

### 4.2 What is not yet green, and why

- **Steps 10–11 (Explorer live stream, QA Agent) — written, not passing.**
  `agents-ui.integration.test.ts` exists with a deliberately strict
  `assertStreamPainted()` (FPS strip + non-zero-intrinsic-size canvas + >1
  distinct sampled colour, so it cannot pass on a blank canvas), but every
  run so far was killed by the environment before producing a verdict.
  **§2.18's live-stream gap is therefore still open.**
- **Steps 15–16 — partially written**, share-link and deletion-sweep cases
  incomplete.
- **Steps 8–9 — still blocked on GitHub credentials**, as originally
  predicted. `confirm-on-green`'s scope guard is covered at runtime by §3.
- **Suite stability.** Results varied run to run: one run scored 8/10,
  another 1/11 with everything timing out. Two causes, neither in the code
  under test: (a) a second, unrelated plugin-rollout effort was live in the
  same working tree, repeatedly restarting the dev server and at points
  leaving it 500ing (a moved `rca/dynamic-text`, later a moved
  `github/content`); (b) the 4-slot EB pool with asynchronous teardown
  starves a journey that runs four real builds back to back. **Re-run these
  against a quiet tree before drawing conclusions from a red result.**

---

## 5. Sign-off checklist

- [ ] §1 automated gates all green, `pnpm arch` total ≤ 36 (baseline, not
  regressed)
- [ ] §0 prerequisites confirmed (migration script run before `db:push`,
  `plugin_jobs` table exists)
- [ ] §2.1–§2.17 refactor-specific targets checked, failures triaged and
  either fixed or filed
- [ ] §3 P0 rows all exercised at least once
- [ ] §4 golden path run start to finish without a hard blocker
- [ ] Any finding involving §2.16 (crypto-fields on pre-existing ciphertext)
  or §2.8 (deletion cascade) escalated immediately regardless of severity
  elsewhere — those two are silent-data-loss/GDPR-class, not "file a ticket
  and move on"
