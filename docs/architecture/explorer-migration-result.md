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

**But read §3 before concluding the migration is finished.** The plugin still
reaches core tables — through eight named methods on one injected port instead
of forty scattered call sites. That is the honest state, and §3 is the
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

**Eight methods.** Every one is a core-entity read or write explorer used to do
by reaching into a table directly. They are declared as a typed port in
[`plugins/explorer/src/host.ts`](../../plugins/explorer/src/host.ts) and filled
by [`src/lib/core/explorer-host.ts`](../../src/lib/core/explorer-host.ts).

| # | Method | Was | Belongs in |
| --- | --- | --- | --- |
| 1 | `getSettings(repoId)` | `ai_settings.explorer_*` | **nowhere** — should be plugin-owned |
| 2 | `resolveTargetUrl(repoId, branch)` | `repositories.branchBaseUrls`, `environment_settings` | `core/repos`, or a `baseUrl` on `RepoRef` |
| 3 | `resolveExistingAuth(repoId)` | `setup_steps`, `storage_states` | `core/browser` (credentials) |
| 4 | `listCoverage(repoId)` | `tests`, `functional_areas` | `core/tests` |
| 5 | `createQuarantinedTest(...)` | `tests`, `functional_areas` (write) | `core/tests` |
| 6 | `emitActivity(event)` | `activity_events` | the `events` **provider plugin** (§4) |
| 7 | `assertSafeOutboundUrl(url)` | `src/lib/security/outbound-url` | `core/security` |
| 8 | `encryptField` / `decryptField` | `src/lib/crypto-fields` | `core/data` |

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

**So the ratio is 8 missing to 12 already-covered.** Four of the eight
(`resolveTargetUrl`, `listCoverage`, `createQuarantinedTest`, `emitActivity`)
will be wanted by most of the remaining features, so they amortise. Two
(`assertSafeOutboundUrl`, `encryptField`) are small and unambiguous. One
(`resolveExistingAuth`) belongs to the browser-driving features specifically.
One (`getSettings`) is not a core API at all — it is a table that should have
moved and did not.

Read that as: **the remaining ~19 features are closer to "a quarter of the work"
than to "considerably more"** — provided `core/tests`, `core/repos` and the
`events` plugin land first, because between them they cover five of the eight.

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

**1. No data migration — this will lose rows.** `agent_knowledge`,
`agent_experience` and `agent_findings` become `explorer_knowledge`,
`explorer_experience` and `explorer_findings`; explorer's slice of
`agent_sessions` becomes `explorer_sessions`. `drizzle-kit push` will read those
as drop-and-create, not rename. **A copy migration has to run before push, or
existing explorer data is gone** — including encrypted credentials in
`agent_knowledge.cred_password`, which are a re-entry burden on the user, not
just lost rows.

`explorer_triggers` is the exception: the plugin's table has the same name, so
push sees a shape change (FK dropped, `target_url` added) and the rows survive.

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

## 8. Verification

```
pnpm install --frozen-lockfile   ok
pnpm lint                        0 errors, 35 warnings (all pre-existing pseudo-plugins)
pnpm test                        102 files, 1585 passed, 0 failed
pnpm types                       clean
pnpm build                       compiled; 7 plugin server actions in the manifest
pnpm arch                        target layout 0; burndown 42 → 36

git diff -- pnpm-lock.yaml | grep -cE "^\+.*(resolution:|integrity)"   → 0
```

No new external dependency was added. Every new package is `workspace:*`, and
every third-party range reused is byte-identical to the one already in the root
`package.json`.
