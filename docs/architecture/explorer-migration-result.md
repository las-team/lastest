# Explorer migration — result

**Status:** done and building. `pnpm install --frozen-lockfile`, `pnpm lint`,
`pnpm test`, `pnpm types`, `pnpm build` and `pnpm arch` all pass.
**Answers:** [`explorer-migration-brief.md`](./explorer-migration-brief.md).
**Not committed.** Paths are listed in §7.

---

## 1. The headline

Explorer is a workspace package. Its `package.json` lists **no `playwright`, no
`@lastest/db`, no `@lastest/pool-service`**, there is no `@/…` import anywhere
under `plugins/explorer/`, and `pnpm arch` reports **0 violations in the target
layout**. The burndown went **42 → 36**: explorer's five, plus the
`@/server/actions/explorer-agent` import that `scheduling` used to carry.

`pnpm build` is the signal that matters, and the manifest confirms why:

```
plugins/explorer/src/actions.ts → startExplorerAgent, pauseExplorerAgent,
  resumeExplorerAgent, cancelExplorerAgent, setFindingStatus,
  upsertExplorerKnowledge, deleteExplorerKnowledge
```

Seven first-class, dispatchable server references from inside the package.
Spike S1 predicted this on a toy; it now holds for the real feature, with no
codegen and no shim.

**But read §3 before concluding the migration is finished.** The plugin
originally still reached core tables — through eight named methods on one
injected port instead of forty scattered call sites. Four of those eight have
since landed as real capabilities (§3); five host methods remain. That is the
honest state, and §3 is the
measurement the pilot existed to produce.

---

## 2. The five violations

| Was | Now |
| --- | --- |
| `@/lib/playwright/ranger` in `planner.ts` | `@lastest/page-map` (new lib) |
| `@/lib/playwright/ranger` in `research.ts` | `@lastest/page-map` (new lib) |
| `playwright` in `tester.ts` | `ctx.browser` — the page arrives from core |
| `@/lib/scheduling/cron` in the actions | `@lastest/cron` (new lib) |
| `@/lib/qa-agent/auth` in the actions | split — see below |

### Each cross-plugin import, and why it resolved that way

**`@/lib/playwright/ranger` → `libs/page-map`.** `browsePageMap(cdpUrl, url)`
did two things: connect over CDP, and extract a page map. The first was core's
and is gone; the second is pure DOM reading that two features want. The
extractors are exported as plain functions rather than `observe(page)` helpers,
because a function passed to `page.evaluate` is serialised into the browser and
may not close over its module — which means the lib needs no page type at all,
and therefore no dependency on Playwright or on contracts. `ranger.ts` now calls
the same code, so there is one copy instead of two that drift.

**`@/lib/scheduling/cron` → `libs/cron`.** Exactly what the brief predicted. 225
lines, no dependencies, no boundary of any kind — the textbook §3 library. The
old path is a re-export shim, so `qa-agent` and the settings UI are untouched.
(`qa-agent` still imports the shim, so it still counts one `cross-plugin`
violation. Pointing it at `@lastest/cron` is a one-line change in another
feature's file, deliberately not made here.)

**`@/lib/qa-agent/auth` → split in two.** The brief guessed "probably a job". It
is not, and the reason is worth recording:

- `findExistingAuthSetup(repoId)` reads `setup_steps` and `storage_states`. That
  is a **core read**, not a cross-plugin problem wearing a different hat, and it
  became `host.resolveExistingAuth` (§3).
- `loginWithCredsOnEb(...)` drives a login form. **A job cannot express this.**
  It is a *precondition*: if it has not completed before research runs, the first
  iteration explores the logged-out marketing site and poisons the frontier for
  every iteration after it. You cannot enqueue a precondition. So the driving
  code moved into the plugin (`browser/login.ts`, ~50 lines duplicated from
  qa-agent's copy), which `core-scope.md` §5 sanctions — driving a page is the
  feature's business. Promoting it to `libs/browser-kit` is right *later*;
  qa-agent's version is entangled with its own auth-link discovery and storage
  capture, and lifting those is a qa-agent refactor wearing this PR's clothes.

**`playwright` → `ctx.browser`.** The whole of `chromium.connectOverCDP`, the
browser, the contexts and the close-on-finally are gone from feature code. What
that buys, stated exactly: explorer cannot leak, outlive, over-allocate or
escape the tenancy of an EB — not because it behaves, but because it never holds
the runner id that release needs.

---

## 3. The core API surface — the highest-value output

**Eight methods, originally.** Every one was a core-entity read or write
explorer used to do by reaching into a table directly, declared as a typed
port in [`plugins/explorer/src/host.ts`](../../plugins/explorer/src/host.ts).

**Status: four of the eight have since landed as real capabilities and left
the port.** `resolveTargetUrl` → `ctx.repos.baseUrl` (`core/repos`).
`listCoverage`/`createQuarantinedTest` → `ctx.tests` (`core/tests`).
`emitActivity` → `ctx.events`, backed by `plugins/events` — a **provider
plugin**, not core, per §4. Explorer's manifest now declares
`capabilities: ["browser", "ai", "data", "events", "tests", "repos"]`.

| # | Method | Was | Landed as |
| --- | --- | --- | --- |
| 1 | `getSettings(repoId)` | `ai_settings.explorer_*` | still nothing — should be plugin-owned |
| ~~2~~ | ~~`resolveTargetUrl`~~ | ~~`repositories.branchBaseUrls`, `environment_settings`~~ | `ctx.repos.baseUrl(repoId, branch)` |
| 3 | `resolveExistingAuth(repoId)` | `setup_steps`, `storage_states` | still a host method — `core/browser` (credentials) |
| ~~4~~ | ~~`listCoverage`~~ | ~~`tests`, `functional_areas`~~ | `ctx.tests.listCoverage(repoId)` |
| ~~5~~ | ~~`createQuarantinedTest`~~ | ~~`tests`, `functional_areas` (write)~~ | `ctx.tests.createQuarantined(input)` |
| ~~6~~ | ~~`emitActivity`~~ | ~~`activity_events`~~ | `ctx.events.emit(type, payload)` |
| 7 | `assertSafeOutboundUrl(url)` | `src/lib/security/outbound-url` | still a host method — `core/security` |
| 8 | `encryptField` / `decryptField` | `src/lib/crypto-fields` | still a host method — `core/data` |

`ExplorerHost` is down to five methods. Three genuinely need core PRs this
document's brief forbade bundling in (`core/browser` credentials,
`core/security`, `core/data` field crypto); one (`getSettings`) is a table that
should have moved and did not.

### The two design questions the follow-up work settled

**`core/repos`: a method, not a `baseUrl` field on `RepoRef`.** §3 originally
offered both. The field lost: `branchBaseUrls` is a map keyed by branch (a PR
branch and `main` deploy to different URLs), so a single `RepoRef.baseUrl`
could only ever answer for the default branch — every caller building against
a PR would need the method anyway. And `RepoRef` is built on *every* context
construction for *every* plugin, while the `environment_settings` fallback
query is only needed when the branch map is empty — paying for it unconditionally
would tax the ~19 features that never touch a browser. See
[`core/repos/src/repos.ts`](../../core/repos/src/repos.ts) for the full
argument.

**`core/tests`'s `createQuarantined` is a write into a core table from a
plugin — the sharpest case in the refactor.** The input type has no `id`
(core mints it), no `quarantined` flag (the method name is the only way to set
it, and it is unconditional), no `teamId` (comes from the resolved scope), and
no `functionalAreaId` (only a name, resolved or created inside the repo core
already authorized). What a plugin can still do through it, stated rather than
overclaimed: create an unbounded number of quarantined tests for a repo it
legitimately owns, and accumulate near-duplicate areas by name. Neither
crosses tenancy, which is the one thing this capability exists to hold. See
[`core/tests/src/tests.ts`](../../core/tests/src/tests.ts).

**`events` needed a host port, not its own table — decided, not assumed.**
`activityEvents` is read by a cross-feature activity feed
(`/api/v1/activity`, `/api/activity-feed/history`) and written by qa-agent,
play-agent, quickstart-agent, spec-import and gamification — none of which are
plugins yet. `plugins/events` cannot declare its own table and call the job
done; the data is core-owned in the sense that many non-plugin features share
it, even though core-scope.md §4 correctly keeps the *fan-out logic* out of
core. `plugins/events/src/host.ts` says this plainly rather than pretending
the plugin owns what it fans out.

**A pre-existing coupling this surfaced, not introduced:** `activityEvents.sourceType`
is a closed union hardcoding feature names (`explorer_agent`, `qa_agent`, …).
The events host casts a plugin id into it rather than widening the column,
which would be a `packages/db` schema change out of scope here — flagged, not
fixed.

### What did *not* need a core API — and this is the more useful half

Twelve things explorer used to reach for turned out to be covered already. This
is the number that predicts the remaining ~19 features, and it is encouraging:

| Was | Now |
| --- | --- |
| `requireRepoAccess` / `requireTeamAccess` in every action | `runtime.contextFor(manifest, { repositoryId })` |
| `assertQaAgentAccess(team.plan, isBillingEnabled())` | `ctx.team.entitlements.has("qa-agent")` |
| `assertAgentRunMinutesAvailable(teamId)` | inside `withBrowser` — `host.assertRunMinutes` |
| `getAISettings` → provider config | `ctx.ai` |
| `getStorageState(id)` → decrypt → inject | `withBrowser({ storageStateId })` |
| `claimEmbeddedBrowserForAgent` / `releasePoolEB` | `ctx.browser.withBrowser` |
| `toProxyStreamUrl(...)` | `session.streamUrl` (pre-signed) |
| `injectStorageStateIntoEb` | core, behind the claim |
| `createAIPromptLog` / `updateAIPromptLog` | inside `ctx.ai` |
| `agent_sessions` (explorer's slice) | `explorer_sessions` via `ctx.data` |
| `agent_knowledge` / `agent_experience` / `agent_findings` | `explorer_*` via `ctx.data` |
| `getTeam(trigger.teamId)` in cron dispatch | `contextFor({ teamId })` → `ctx.team` |

**So the ratio was 8 missing to 12 already-covered, and four of the eight have
since landed** (`resolveTargetUrl`, `listCoverage`, `createQuarantinedTest`,
`emitActivity`) — the ones expected to be wanted by most of the remaining
features, which is why they amortise. Two (`assertSafeOutboundUrl`,
`encryptField`) are small and unambiguous, still pending. One
(`resolveExistingAuth`) belongs to the browser-driving features specifically,
still pending. One (`getSettings`) is not a core API at all — it is a table
that should have moved and did not.

Read that as: **the remaining ~19 features are closer to "a quarter of the
work" than to "considerably more"** — `core/tests`, `core/repos` and the
`events` plugin have now landed, covering five of the eight, unblocking the
next migration.

---

## 4. Where the contract held, and where it did not

### `withBrowserSwarm` was the wrong primitive — and the contract already knew

The brief asked whether the contract covers `runScenariosConcurrent`'s
storage-state sharing. **It does, but not through `withBrowserSwarm`.**

A swarm gives N *separate* EBs: N pool slots, N streams of metered run-minutes,
and N browsers each needing authentication — where the state they need is the
one produced by *this run's* login, which may never have been persisted, so
`storageStateId` cannot express it either. `BrowserSession.isolatedPage()` mints
a fresh context inside the same browser seeded from the live default context,
and core closes it when the scope ends. One slot, one meter, identical
isolation. Its doc comment says exactly this; it was written for this case.

`withBrowserSwarm` is now unused by explorer. That is the correct outcome, not a
gap.

### The structural change `withBrowser` forced

The old driver claimed an EB at `explorer_research` and released it at
`explorer_analyze` — a pair of calls plus a `finally` and four
`.catch(() => {})` covering the paths where the pairing could be missed.
`withBrowser` is a *scope*, so the four loop steps now run inside one callback.

Strictly better: release no longer depends on the pipeline being correct. Pause,
cancel, a thrown planner error, the plan's hold ceiling expiring — all unwind the
same scope. **Cost:** a restart mid-iteration re-runs that iteration's research
rather than resuming at the exact step. Iterations are idempotent and the browser
it would have resumed onto was gone anyway, so the price is one repeated page
map.

### Three things that did not fit

**1. `ctx.data` has no typed query surface.** `CapabilityMap.data` is
`DataCapability` — i.e. `DataCapability<unknown>` — and `PluginContext` has no
type parameter for a plugin's schema, so `ctx.data.db.schema` is `unknown` and
the interface offers only `.transaction`. `core/data` *does* hand over a
properly-typed `ScopedDatabase` at runtime, so the fix is a cast, concentrated
in one function (`data/db.ts`). **This wants a core change:** parameterise
`PluginContext<C, TSchema>`, or have `definePlugin` infer the schema from the
manifest's `schema()`.

**2. The `drizzle-orm` ban made `manifest.schema` unimplementable.**
`FORBIDDEN_PLUGIN_IMPORTS` banned `drizzle-orm` outright, but declaring a table
needs `pgTable` from `drizzle-orm/pg-core` and a `where` clause needs `eq`.
Neither opens a connection — the same argument spike S2 made about
`@lastest/db/schema`.

The ban was aimed at the wrong noun, so `tools/architecture/boundaries.mjs` now
splits it. `@lastest/db`, `pg` and `postgres` stay banned **everywhere**; the
query builder is banned only for *pseudo*-plugins, where importing it means raw
SQL against core tables through the shared handle — which is exactly what the
eight remaining `db` violations are. **The burndown numbers are unchanged by
this split** (verified: still 36, same per-plugin breakdown). A packaged plugin
does not get the carve-out for free: its builder is bound to a schema
`core/data` validated as `explorer_`-prefixed, and it cannot import
`@lastest/db` to get another one.

**3. `AiCallOptions` cannot carry a model id — correctly.** The contract offers
`tier: "fast" | "balanced" | "deep"` and deliberately refuses model ids, so a
feature cannot opt itself into a more expensive model. Explorer's per-repo
`explorerModel` setting was doing precisely that. Rather than drop the setting,
the app's `ai` factory now resolves it as *what this tenant's `fast` tier means*.
That is a better shape than the original: every future plugin's high-volume path
inherits it instead of adding its own column. Tiering is not decorative here —
the tester makes one blocking call per browser action, so it runs `fast`, while
planning and clustering get `balanced`.

---

## 5. What I had to bend, stated plainly

**The `ExplorerHost` port is scaffolding, not architecture.** §6 says a plugin
calls a core function to learn about a core entity. Those functions do not
exist, `CapabilityMap` is a closed interface, and the brief forbids touching
`core/` in this change. So the gap is declared as a port the composition root
fills — the same shape `BrowserHost` uses, for the same stated reason.

The difference matters and I am not going to soften it: `BrowserHost` is a
permanent seam between core and the app; **this one is temporary, and the plugin
still transitively reads core tables through it.** What the port buys is that the
reads are enumerable, finite, and cannot grow without a diff that says so. It is
strictly better than the status quo and strictly worse than core actually having
these APIs.

Two smaller bends:

- **`libs/ui`.** Explorer's components import nine shadcn primitives. A plugin
  cannot import `@/components/ui`, and duplicating them would fork the design
  system one feature at a time. So the nine moved to `libs/ui` with re-export
  shims at the old paths — the rest of the app is untouched. This is the tier
  §3 exists for, but it is scope the brief did not name.
- **The EB stream viewer stayed in the app.** It is ~1,300 lines wired to the
  stream protocol and used across the product — core's side of the boundary. The
  plugin declares a `ComponentType<{ streamUrl: string }>` slot and the app fills
  it. A *component* rather than a render function, because a function prop cannot
  cross the RSC boundary from the server page that supplies it.

---

## 6. What is incomplete or unverified

**1. ~~No data migration~~ — RESOLVED.** `agent_knowledge`, `agent_experience`
and `agent_findings` become `explorer_knowledge`, `explorer_experience` and
`explorer_findings`; explorer's slice of `agent_sessions` becomes
`explorer_sessions`. `drizzle-kit push` reads those as drop-and-create, not
rename, and the Docker entrypoint runs `push --force` on startup — so a deploy
would have destroyed every explorer row, including the encrypted
`cred_password` values.

`scripts/migrate-explorer-plugin-tables.ts` now closes that. It migrates **by
rename**, not by copy, so rows, types and ciphertext move byte-for-byte and
`push` is left with only constraints to reconcile. `agent_sessions` is the one
exception — it holds five agent kinds, so explorer's slice is a filtered copy
and the source rows are left in place, which is what makes the script
re-runnable.

Required order:

```
pnpm tsx scripts/migrate-explorer-plugin-tables.ts
pnpm db:push
```

Verified against a throwaway database seeded with the pre-migration schema:
every branch exercised, ciphertext preserved, idempotent on re-run, a `qa`
session correctly left behind. Two losses are reported by the script rather
than hidden: `agent_findings.bug_report_id` has no counterpart and `push` drops
it, and explorer sessions whose `team_id` cannot be resolved from
`repositories` are not migrated (the destination declares it `NOT NULL`).

`explorer_triggers` is the exception to all of this: the plugin's table has the
same name, so push sees a shape change (FK dropped, `target_url` added) and the
rows survive on their own.

**2. `db:push` was not run.** `drizzle.config.ts` now globs
`./plugins/*/src/schema.ts` — spike S2 verified that mechanism, and the plugin
schema loads and passes `validateSchemaNamespace` (verified directly). But push
would drop the old tables in the dev database, so I did not run it. `drizzle-kit
generate` also could not verify it: `drizzle/meta/000{0,1,2}_snapshot.json` are
malformed, which is pre-existing and unrelated.

**3. Nothing was exercised at runtime.** No exploration was run end to end. The
compile-time and build-time claims are verified; "explorer behaves identically"
is *argued*, not observed. Specifically unverified: the `withBrowser` scope
against a real EB, `isolatedPage()` carrying auth across contexts, and the
deletion hook actually deleting.

**4. The trigger UI does not expose `targetUrl` yet.** The column exists and the
action accepts it; nothing in the UI sets it. Scheduled runs therefore still fall
back to `host.resolveTargetUrl`, which is the old behaviour — so nothing is
broken, but the column that exists to *remove* that core read is not yet used.

**5. `ai.generate` reports `inputTokens: 0, outputTokens: 0`.** Token counts are
recorded by the provider layer into `ai_prompt_logs` and are not returned per
call. Reporting zero is honest-but-useless; a plugin must not be able to infer
spend from a fabricated number, so the values are not guessed. Real per-call
accounting is a `core/ai-gateway` job.

**6. `AgentStepState.iteration` was removed from the core schema** but old
`agent_sessions` rows still carry it in jsonb. Harmless (it is read by nothing),
noted so nobody is surprised.

---

## 7. Paths

```
plugins/explorer/                6,274 LOC — manifest, schema, queries, pipeline,
                                 actions, browser driving, AI calls, UI
libs/page-map/                     379 LOC — rendered-DOM observation
libs/ui/                           625 LOC — nine shadcn primitives + cn
libs/cron/                         225 LOC — moved verbatim
libs/ai-kit/                       115 LOC — parseAiJson

src/lib/core/explorer-host.ts            the eight-method fill
src/lib/core/ai-capability.ts            the `ai` capability
src/lib/core/runtime.ts                  manifest registered, plugin wired
src/instrumentation.ts                   registry resolved at boot
src/app/(app)/explorer/page.tsx          composition only
src/app/api/explorer-agent/…/route.ts    delegates to plugin actions
src/app/api/v1/[...slug]/route.ts        three endpoints re-pointed
src/lib/scheduling/scheduler.ts          cron dispatch re-pointed
packages/db/src/schema/agents.ts         explorer's slice removed
tools/architecture/boundaries.mjs        db rule split; explorer graduated
drizzle.config.ts                        plugin schema glob

deleted: src/lib/explorer/, src/server/actions/explorer-agent.ts,
         src/components/explorer/, src/lib/db/queries/{explorer,
         agent-knowledge,agent-experience}.ts
```

### 7.1 Follow-up: deletion cascade, data migration, and four core capabilities

Everything in §3's "landed as" column, plus the two items §6 flagged as
incomplete (the deletion hook had no caller; there was no data migration for
the table renames).

```
core/repos/                          the `repos` capability + ReposHost
core/tests/                          the `tests` capability + TestsHost
core/jobs/                           the `jobs` capability, a worker-tick
                                     function, and the queue's host port —
                                     unconsumed: no plugin declares `jobs` yet
core/storage/                        the `storage` capability + StorageHost
plugins/events/                      provider plugin, `provides: ["events"]`
core/contracts/src/{repos,tests}.ts  the two new capability contracts
core/contracts/src/plugin.ts         `ProviderScope`, `ProvidedCapabilities<P>`,
                                     `implement` on the manifest
core/kernel/src/runtime.ts           `createRuntime` now wires `registry.providers`
                                     into the capability factories
core/kernel/src/registry.ts          `implement` validated when `provides` is set;
                                     `AnyManifest` deliberately loosens `jobs`/
                                     `implement` — see the comment there for why

packages/db/src/schema/runs.ts       `pluginJobs` table (the queue; not
                                     `background_jobs` — see the comment there)
src/lib/db/queries/plugin-jobs.ts    enqueue/claim/complete/fail/cancel
src/lib/db/plugin-deletion.ts        the call `deleteTeam`/`deleteRepository`
                                     were missing — dynamically imports the
                                     composition root to avoid a module cycle
src/lib/core/runtime.ts              `runPluginDeletion`; the four new
                                     capability factories; `eventsPlugin`
                                     added to `MANIFESTS`
src/lib/core/{repos,tests,jobs,events,storage}-host.ts   the app-side fills
src/lib/core/storage-grant.ts        HMAC-signed grants for `signedUrl`,
                                     reusing `@/lib/eb/stream-grant.ts`'s pattern
src/app/api/plugin-storage/route.ts  serves a blob against a signed grant
src/lib/db/queries/{auth,repositories}.ts   drive the deletion cascade
scripts/migrate-explorer-plugin-tables.ts   rename-based migration; run before
                                     `db:push` — see its header and §6 above
plugins/explorer/src/host.ts         5 methods, down from 8
plugins/explorer/src/{actions,pipeline}.ts   switched to `ctx.repos`/
                                     `ctx.tests`/`ctx.events`
```

## 8. Verification

Re-run after the follow-up work above, on the same working tree:

```
pnpm install                     0 new resolution/integrity lines in the lockfile
pnpm lint                        0 errors, 35 warnings (all pre-existing pseudo-plugins)
pnpm test                        110 files, 1632 passed, 0 failed
pnpm types                       clean
pnpm build                       compiled; /explorer and /api/plugin-storage present
pnpm arch                        target layout 0; burndown unchanged at 36

git diff -- pnpm-lock.yaml | grep -cE "^\+.*(resolution:|integrity)"   → 0
```

No new external dependency was added. Every new package is `workspace:*`.

**What is still unverified.** The `jobs`/`storage` capabilities are
constructible and unit-tested but have no consumer — nothing exercises them
against a real plugin or a real HTTP request. `core/storage`'s `signedUrl` →
`/api/plugin-storage` round-trip was reviewed, not curl'd. The deletion cascade
and the migration script were both verified against a throwaway Postgres
database with seeded rows (not the dev database, which had nothing to
migrate) — never against production data. `db:push` has not been run for the
new `plugin_jobs` table.
