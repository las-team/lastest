# Explorer → plugin: the core API surface it implies

Status: **measurement.** The migration described in
`explorer-migration-brief.md` has NOT been performed. Its prerequisite was
unmet when this was written (§0); `core/browser` and `core/data` have since been
built — see §6 for what that changed and what it did not.

This document is the brief's "highest-value output": every core-entity touch
explorer performs today, and the core API each one turns into under the
no-read rule (`core-scope.md` §6). It is the first real measurement of how big
the core API surface has to be.

---

## 0. Why the migration did not proceed

```
core/
  contracts/   types only, zero deps
  kernel/      definePlugin + resolveRegistry
```

There is no `core/browser`, no `core/data`, no `plugins/`, no `libs/`.
`core/contracts/src/browser.ts` defines `BrowserCapability` as an interface and
`DrivablePage` as `unknown`; the comment says "`@lastest/core-browser`
re-exports the real `Page` type" — that package does not exist. `ctx.browser`
and `ctx.data` are types with no implementation behind them.

Per the brief: stopping and saying so, rather than finding adjacent work.

Current `pnpm arch`: **42 violations**, explorer's five exactly as the brief
lists. One additional edge the brief omits, counted under `scheduling`:

```
cross-plugin  @/server/actions/explorer-agent   src/lib/scheduling/scheduler.ts:180
```

That is an **inbound** edge — the app's cron scheduler imports explorer's server
action directly. It must become `ctx.jobs` dispatch in the same change, or
extracting explorer breaks the scheduler.

---

## 1. Core-entity reads → required core APIs

Grouped by core entity. "Sites" are call sites found in
`src/lib/explorer/**`, `src/server/actions/explorer-agent.ts`,
`src/app/(app)/explorer/page.tsx`, `src/app/api/explorer-agent/[sessionId]/route.ts`.

### 1.1 Covered by the existing contract

| Core entity | Explorer's call | Sites | Contract element | Notes |
| --- | --- | --- | --- | --- |
| repositories | `queries.getRepository(id)` | agent:1779 | `PluginContext.repo: RepoRef` | Only `id` is used; `RepoRef` is wide enough. |
| storage states (injection) | `queries.getStorageState()` + `injectStorageStateIntoEb()` | agent:389, 392 | `BrowserClaimOptions.storageStateId` | Clean fit. Plugin passes an id, core injects. |
| EB claim / release | `claimEmbeddedBrowserForAgent()`, `releasePoolEB()` | agent:345, 370 | `withBrowser` | Fits *shape*, not *lifetime* — see §3.1. |
| stream URL | `toProxyStreamUrl()` | agent:300 | `BrowserSession.streamUrl` | Clean fit. |
| run-minute quota | `assertAgentRunMinutesAvailable(teamId)` | agent:1492, 1773 | metering inside `withBrowser` | Core already owns this per `browser.ts`. |
| plan gating | `assertQaAgentAccess`, `hasQaAgentAccess`, `isBillingEnabled` | agent:1489/1716/1765, page:32 | `TeamRef.entitlements` | Becomes `team.entitlements.has("qa-agent")`. |
| activity events | `emitAndPersistActivityEvent()` | agent:192 | `EventsCapability.emit` | Provider plugin, not core. Clean fit. |
| auth guards | `requireRepoAccess`, `requireTeamAccess` | 12 sites | resolved before the plugin runs | Conceptually fits; mechanically unspecified — §3.5. |

### 1.2 New core APIs that do not exist yet

| # | Core entity | Explorer's call today | Sites | Core API needed |
| --- | --- | --- | --- | --- |
| C1 | teams | `queries.getTeam(trigger.teamId)` | agent:1764 | `core.teams.resolve(teamId): Promise<TeamRef>` — needed on the **cron path**, where there is no session to resolve a team from. |
| C2 | repo selection | `getSelectedRepository(userId, teamId)` | page:42 | `core.repos.selected(): Promise<RepoRef \| null>` — "which repo is the user looking at" is shell state; the plugin page needs it before it has a `repo`. |
| C3 | environment config | `getEnvironmentConfig(repoId)` | page:75 | `core.environment.get(repoId): Promise<{ baseUrl, ... }>` — explorer's target URL derives from it. |
| C4 | AI settings (presence) | `queries.getAISettings(repoId)`, checks `provider === "none"` | agent:430, 709, 813, 1186, 1431; config:13 | `ai.configured(): Promise<boolean>`, or widen `budget()` to answer it. Explorer's preflight fails with "No AI provider configured" and cannot ask that question today. |
| C5 | AI settings (model override) | `settings.explorerModel` | config:13–30 | **Conflicts with the contract** — see §3.3. |
| C6 | tests (read) | `queries.getTestsByRepo(repoId)` | coverage:17 | `core.tests.list(repoId): Promise<TestSummary[]>` — explorer needs name + targetUrl only, for the coverage digest. |
| C7 | tests (**write**) | `queries.createTest(...)` | agent:1122 | `core.tests.create(...)` — explorer *creates core tests*. A write, not a read; the brief's framing understates this. |
| C8 | functional areas (read) | `getFunctionalAreasTree`, `getFunctionalAreasByRepo` | coverage:19, agent:1102 | `core.areas.tree(repoId)` / `core.areas.list(repoId)`. |
| C9 | functional areas (**write**) | `createFunctionalArea(...)` | agent:1106 | `core.areas.create(...)`. |
| C10 | SSRF policy | `assertSafeOutboundUrl(url)` | agent:1409 | `core.security.assertSafeOutboundUrl(url)` — a security boundary, so core, not a lib. |
| C11 | existing auth setup | `findExistingAuthSetup(repoId)` (from `@/lib/qa-agent/auth`) | agent:495 | `core.auth.findSetup(repoId)` — it reads storage states, a core entity. See §2.4. |
| C12 | live credential login | `loginWithCredsOnEb({ email, password, ... })` | agent:395 | `BrowserClaimOptions.credentialsId` — see §3.4, which is also a security finding. |

**Count: 12 new core functions, of which 2 are writes into core tables and 2
(C5, C12) do not fit the contract as written.**

That is for *one* feature. Extrapolated naively across ~19 remaining features
the surface is large, but the overlap should be high: C1–C3 and C10 are
generic, and C4/C6/C8 are the kind of thing most features will want. A more
useful read of this number is that the **irreducible** per-feature additions
here are C5, C7, C9, C11, C12 — the ones specific to explorer's domain — which
suggests roughly 3–5 genuinely new core functions per feature, not 12.

---

## 2. The four cross-plugin / browser imports

### 2.1 `@/lib/playwright/ranger` (planner.ts:5, research.ts:1) → **`libs/browser-kit`**

`ranger.ts` is 196 lines exporting `RangerPageMap` and `browsePageMap()`. Its
own header calls it "pure observation — no AI is involved". It connects over
CDP and extracts a structured DOM map.

Justification: this is *driving*, and `core-scope.md` §5 puts driving explicitly
outside core. It holds no credential, gates no spend, allocates no capacity. It
is reusable — a reason to be a library, not a reason to be gate-kept. It becomes
`libs/browser-kit`, taking a `DrivablePage` instead of a `cdpUrl`.

Note `ranger.ts:1` is itself an open `browser playwright` violation in the
baseline, so this move fixes two entries, not one.

### 2.2 `playwright` (tester.ts:1) → **`ctx.browser` + `DrivablePage`**

Straightforward for `runScenario` (tester.ts:430–443). **Not** straightforward
for `runScenariosConcurrent` — see §3.2.

### 2.3 `@/lib/scheduling/cron` (explorer-agent.ts:12) → **`libs/cron`**

Uses `isValidCron()` and `getNextRunTime()`. Both are pure functions over a cron
string. No secret, no capacity, no money, no tenancy — fails all five of
`core-scope.md` §2's bars for core, passes the bar for a library. The brief's
guess is right.

Note this only moves the *parsing*. The *scheduling* — `scheduler.ts:180`
calling into explorer — is the inbound edge from §0 and becomes
`ctx.jobs.enqueue("explorer.scheduled-run", ...)`.

### 2.4 `@/lib/qa-agent/auth` (explorer-agent.ts:26) → **splits three ways**

This one does not resolve to a single answer. The module has seven exports;
explorer uses two, and they belong in different tiers:

- `findExistingAuthSetup(repoId)` — reads storage states, a **core** entity →
  becomes core API **C11**. Not a job: it is a synchronous read on the preflight
  path, and `ctx.jobs` is asynchronous by construction.
- `loginWithCredsOnEb({...})` — handles **credentials**, which `core-scope.md`
  §2 names as a core concern outright → becomes core (**C12**), expressed as a
  claim option rather than a callable, so the plugin never holds the secret.
- The remaining exports (`probeAuthedState`, `findAuthLinksOnEb`,
  `validateStorageStateOnEb`, `probeAndCaptureOnEb`) are EB-driving helpers →
  `libs/browser-kit` alongside ranger, if anything else needs them.

The brief guesses "probably a job". I disagree: neither half is a job. One is a
blocking core read, the other is a credential injection that must happen before
the plugin ever sees the page.

---

## 3. What does not fit the contract

These are the findings worth more than the import bookkeeping.

### 3.1 `withBrowser`'s scoped callback cannot express explorer's EB lifetime

Explorer holds **one EB across many separate server-action invocations**. The
module-level `sessionEbs` map (agent:337–371) is keyed by `sessionId`;
`claimSessionEb` is called in one HTTP request and `releaseSessionEb` in a
later, different one. The client drives the loop by calling back in.

`withBrowser(opts, fn)` is a scoped callback — it claims, runs `fn`, and
releases. It cannot span requests. This is not an import problem; it is an
architectural mismatch, and it is the single largest piece of work in the
migration.

Two ways out, both real changes:

1. **Move the loop into a job.** `ctx.jobs` runs one long-lived
   `explorer.run` handler that wraps the whole iteration in a single
   `withBrowser`. Progress reaches the UI via `ctx.events`. This fits the
   contract as written and is almost certainly the right answer — but it
   rewrites explorer's control flow, and the brief's "explorer behaves
   identically in the app" exit criterion needs re-reading in that light,
   because the API route and client polling change shape.
2. **Add claim/release handles to the contract.** Rejected: a handle a plugin
   can hold across requests is exactly the leak `withBrowser` exists to prevent
   ("a leaked EB is stolen capacity").

Either way this is a **core PR decision that must be made before the migration**,
not during it.

### 3.2 `withBrowserSwarm` does not cover the storage-state sharing — the brief's question, answered

**No, it does not.** Two independent reasons.

`runScenariosConcurrent` (tester.ts:453–510) does this inside **one** EB:

```js
const browser = await chromium.connectOverCDP(cdpUrl);
const defaultCtx = browser.contexts()[0] ?? await browser.newContext();
const storageState = await defaultCtx.storageState();      // live snapshot
// scenario 0 runs on defaultPage (the screencast context, so it stays watchable)
// scenarios 1..N run on browser.newContext({ storageState })
```

1. **It needs a `Browser`, not a `Page`.** `BrowserSession` exposes only
   `page: DrivablePage`. There is no `newContext()`. The isolation model here is
   N contexts in one browser; the contract's model is N browsers.
2. **The shared state is a live runtime snapshot, not a stored id.**
   `BrowserClaimOptions.storageStateId` seeds from a *persisted* storage state.
   Explorer seeds from `defaultCtx.storageState()` — the state as it exists
   after this session's login, which may never have been persisted. There is no
   way to express "seed the others from context 0's current state".

There is also a cost consequence: `withBrowserSwarm({ count: N })` claims **N
EBs**, where explorer uses **one**. That is N× pool capacity and N× run-minutes
for identical behaviour. For a feature whose whole point is bounded-concurrency
exploration, that is a significant regression, and it is a money question — so
core's business, not something to paper over in the plugin.

Suggested contract change (core PR): either expose an
`session.isolatedPage(): Promise<DrivablePage>` that mints a fresh context
inside the *same* EB seeded from the default context, or a
`withPages({ count })` that is explicit about being intra-EB. The current
`withBrowserSwarm` is the wrong primitive for this caller.

### 3.3 `explorerModel` conflicts with the tier-only `AiCallOptions`

`AiCallOptions.tier` is deliberately `"fast" | "balanced" | "deep"`, with the
comment: *"a plugin naming `claude-opus-5` would pin core's provider choice and
let a feature opt itself into a more expensive tier without that being a billing
decision."*

Explorer has exactly that today: `aiSettings.explorerModel` is a per-repo model
id override, stored in a **core** settings table, applied by
`explorerConfigFromSettings()` (config.ts:13–30) to whichever provider is
active. Its rationale is sound — the explorer loop makes many small calls, so a
cheaper model is the right trade — but the mechanism is precisely what the
contract forbids.

Resolution is a design decision, not a mechanical one:

- Map `explorerModel`'s *intent* onto `tier: "fast"` and drop the id. Loses
  user-facing configurability that exists today.
- Keep a per-plugin model override, but as a **core**-owned setting core reads
  when serving that plugin's calls — the plugin still never names a model.

Either is defensible; the second preserves behaviour. It is a core PR.

### 3.4 Plaintext credentials in plugin-readable session metadata

`credentialsFrom(metadata)` (agent:~305–332) reads
`metadata.quickstartEmail` / `metadata.quickstartPassword` — plaintext
credentials in the `agent_sessions.metadata` jsonb — and hands them to
`loginWithCredsOnEb`.

Under the contract a plugin must never hold credential material
(`BrowserClaimOptions`: *"The plugin passes an **id**; core resolves and injects
the credential material. The plugin never sees it."*). Migrating this as-is
would carry the violation into the plugin.

This needs a core-owned credential record with `credentialsId` on
`BrowserClaimOptions` (**C12**). It is worth flagging on its own merits
regardless of the refactor: those passwords are in a jsonb column today.

### 3.5 Nothing specifies how a plugin's `"use server"` action obtains its `ctx`

Spike S1 proved `"use server"` *works* inside a workspace package. It did not
answer how the exported action gets a `PluginContext` — there is no
`getPluginContext()` in `core/kernel/src/`, and `PluginContext` is a plain type
with no constructor.

Explorer has ~25 exported server actions, each currently opening with
`requireRepoAccess(...)`/`requireTeamAccess(...)`. Every one needs an answer to
this. It is the most-repeated unknown in the whole migration and it blocks the
first line of real work.

Needed in the kernel (core PR): something like
`resolvePluginContext(pluginId, { repositoryId? })` that runs the existing auth
guard, builds `TeamRef`/`RepoRef`, and injects only the declared capabilities.

### 3.6 `agent_sessions` cannot be split by "explorer's slice"

The brief scopes "explorer's slice of `agentSessions`". That slice is a
discriminator column, not a partition:

```
AgentSessionKind = "play" | "quickstart" | "ranger" | "qa" | "explorer"
```

Seven modules call `createAgentSession`: `qa-agent.ts`, `explorer-agent.ts`,
`quickstart-agent.ts`, `play-agent.ts`, `ai.ts`, `spec-import.ts`,
`ranger-agent.ts`. `agent_knowledge`, `agent_experience` and `agent_findings`
are likewise shared with qa-agent.

So explorer cannot take these tables with it, and cannot leave them behind
either. The options are to duplicate the table shape into
`plugins/explorer/schema` and migrate only `kind = 'explorer'` rows, or to make
`agent_sessions` a capability provided by an `agents` provider plugin (the
`provides` mechanism in `PluginManifest` exists for exactly this). The first is
mechanical but forks the schema five ways as the other features migrate; the
second is more work now and less later.

**This is unresolved and is a genuine blocker for a clean pilot.** Explorer was
picked as the pilot partly because it looked self-contained; on this axis it is
not.

### 3.7 Four FK cascades to replace, not one

`agent_sessions`, `agent_knowledge`, `agent_experience`, `agent_findings` and
`explorer_triggers` all declare
`.references(() => repositories.id, { onDelete: "cascade" })`. Under the no-FK
rule all five cascades disappear and the `DeletionHook` must reproduce them.
`onRepoDeleted` is the load-bearing one here — `onTeamDeleted` alone would leave
rows behind when a repo is deleted from a live team, which is the common case.

---

## 4. What is incomplete or unverified

- **Nothing was migrated, moved, or deleted.** No code changes were made; the
  only new file is this document. `pnpm arch` still reports 42.
- `pnpm lint` / `test` / `types` / `build` were **not** run — there is no change
  to verify, and running them would prove nothing about the migration.
- The lockfile check is trivially satisfied (no dependency changes), so it was
  not run as a meaningful signal.
- `src/components/explorer/**` (1,247 LOC) was **not** audited for core reads.
  The scan covered `src/lib/explorer/`, `src/server/actions/explorer-agent.ts`,
  the route page and the API route. Client components may surface additional
  core reads through server actions not in that set — most likely a storage-state
  picker, which would add a `core.storageStates.list(repoId)` to §1.2.
- The `agent_sessions` split (§3.6) has no chosen answer. It needs a decision
  before the pilot can proceed.
- Whether `libs/browser-kit` should own `runScenarioOnPage` itself (as opposed
  to just ranger) was not assessed; it depends on how much the other ~19
  features share that shape, which S3 only sampled.

---

## 5. Recommended order

The migration is blocked on core work that is, correctly, out of scope for a
plugin PR:

1. ~~**Core PR A** — `core/data` + plugin-context resolution (§3.5).~~ **Done**,
   see §6.
2. ~~**Core PR B** — `core/browser`, with a decision on §3.1 and §3.2.~~
   **Done**, see §6.
3. **Core PR C** — the §1.2 API surface: C1–C4, C6–C11. C5 and C12 carry design
   decisions (§3.3, §3.4). **This is now the blocking item.**
4. **Decide §3.6** — duplicate `agent_sessions`, or an `agents` provider plugin.
5. **Libs** — `libs/cron`, `libs/browser-kit`. These are unblocked today and are
   what the previous attempt drifted into building; that work is reusable, it
   was just sequenced ahead of its dependents.
6. **Then** the explorer plugin.

---

## 6. What the prerequisite work changed

`core/browser`, `core/data` and the kernel runtime now exist. What that settled,
and what it deliberately did not:

### Settled

| Was | Now |
| --- | --- |
| §3.2 — swarm cannot express intra-EB isolation | `BrowserSession.isolatedPage()` added to the contract. N contexts on **one** EB, seeded from the default context's live state. Removes the N× pool-and-run-minute cost `withBrowserSwarm` would have imposed on explorer. |
| §3.5 — no way for a plugin action to obtain `ctx` | `createRuntime({ resolveScope })` in `@lastest/kernel`. The app supplies the resolver (it owns `requireRepoAccess`); the plugin calls `contextFor(manifest)` and never learns how its team was established. |
| `DrivablePage = unknown`, so plugins got no page typing | `DrivablePageTypeMap` is an empty slot in contracts, filled by `@lastest/core-browser` via declaration merging. Plugins get the real `Page` with no `playwright` in their manifest. Proved by `core/browser/src/types.test-d.ts`. |
| No teeth behind "plugins only touch their own tables" | `validateSchemaNamespace` rejects, at boot, any table not prefixed with the plugin's id. This closes the one hole the import ban cannot: a plugin re-exporting a core table through its own `schema()`. |
| Deletion hooks were declared but nothing ran them | `runDeletionHooks` — sequential, failure-isolated, failures returned not thrown. |

### Deliberately not settled

- **§3.1 (EB lifetime across requests) needs no core change.** `withBrowser`
  inside a `ctx.jobs` handler covers it. What it costs is explorer's control
  flow, which is the explorer PR's problem, not core's. The alternative — a
  claim handle a plugin can hold across requests — was rejected: that is exactly
  the leak the scoped callback exists to prevent.
- **§3.3 (`explorerModel`) and §3.4 (plaintext credentials)** are untouched.
  Both are `core/ai-gateway` work, and both carry a product decision rather than
  a mechanical one.
- **C1–C12 do not exist.** Building them is Core PR C.

### Honest limits of what was built

- **The app wiring is compile-verified, not runtime-verified.** No plugin exists,
  so `getPluginRuntime()` has no caller. `pnpm build` proves it compiles and
  links; it does not prove an EB is claimed correctly end-to-end.
- **`MAX_HOLD_MS` per plan is a guess.** The numbers are plausible, not derived
  from usage data. They are one table in `core/browser/src/host.ts`.
- **Deadline enforcement cannot kill a running callback** — JavaScript has no
  such primitive. What expiry does is tear down the browser and release the pool
  slot, so the *capacity* is recovered immediately and the callback's next page
  call fails. The plugin's promise may still be pending; the EB is not still
  occupied. This is stated in the code rather than papered over.
- **`resolveScope`'s `teamId` is trusted.** It is how a cron trigger acts for a
  team with no session. Threading it from a user request would be a tenancy
  escape. Today the only callers are core's own paths; nothing mechanically
  enforces that yet.
- **`core/data` is not exercised against a real database.** Namespacing and the
  deletion driver are unit-tested; `createScopedDatabase` has no integration
  test because no plugin schema exists to point it at.
