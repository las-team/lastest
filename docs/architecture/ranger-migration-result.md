# Ranger migration — result

**Status:** done and building. `pnpm install`, `pnpm arch`, `pnpm lint`,
`pnpm types`, `pnpm test` and `pnpm build` all pass.
**Recipe:** [`plugin-migration-recipe.md`](./plugin-migration-recipe.md).
**Phase:** the tenth plugin of RFC §9 phase 4, and the first out of the §6.2
`src/lib/playwright` split.
**Not committed.**

---

## 1. The headline

`ranger` is a workspace package. `plugins/ranger/package.json` lists four
dependencies — `@lastest/contracts`, `@lastest/core-data`, `@lastest/kernel`,
`@lastest/page-map` — and no `playwright`, no `@lastest/db`, no
`@lastest/pool-service`. There is no `@/…` import anywhere under
`plugins/ranger/`. `pnpm arch` reports **0 violations in the target layout**
and the current-layout burndown went **19 → 18**: the `ranger::browser` entry
(the direct `chromium.connectOverCDP(cdpUrl)` call RFC §1.1 opened with) is
gone, not just moved.

| Was | Now |
| --- | --- |
| `src/lib/playwright/ranger.ts` (48 LOC) | `plugins/ranger/src/browse.ts` (40 LOC) |
| `src/server/actions/ranger-agent.ts` (321 LOC) | `plugins/ranger/src/actions.ts` (232 LOC) + `plugins/ranger/src/data/*` (114 LOC) + `plugins/ranger/src/errors.ts` |
| its slice of the shared `agent_sessions` table | `plugins/ranger/src/schema.ts` — `ranger_sessions`, its own table |
| — (nothing owned deletion) | `plugins/ranger/src/deletion.ts` — new, see §5 |

369 old lines became 676 new ones. That is not scope creep: `explorer` set the
precedent (§2) that a plugin able to own its session data stops sharing
`agent_sessions` and gets its own table, and a table costs a schema file, a
deletion hook and a data layer that the old code got for free by piggybacking
on infrastructure three other unmigrated features still share.

## 2. Why this was the plugin to do next

Costed against recipe §1.5 before starting, the same way every migration
before it was: **one host method** (`assertSafeOutboundUrl` — comfortably
inside the "go" range, and see §4 for why it is not really a new debt item).
Two other signals made it the better pick over the remaining pseudo-plugins:

- It is one of the six direct-CDP call sites RFC §1.1 opened the whole
  document with. Migrating it is a literal instance of R4, not an abstract
  argument for it.
- `demo` (the pseudo-plugin the RFC's original ordering names right before
  it) turned out on inspection not to be a plugin at all — its two library
  files (`excalidraw-seed.ts`, `sandbox-seeds.ts`) are called exclusively
  from core-classified auth/onboarding code (`src/lib/auth/demo.ts`,
  `src/server/actions/repos.ts`, `src/server/actions/onboarding.ts`), and its
  two actions (`signInAsDemo`, `generateNotesForBuild`) have zero callers
  anywhere in the app — confirmed dead. That is recipe §1.6's hazard in a
  fourth shape (`ci`'s "reclassify", `url-diff`'s "stop", `gamification`'s
  "invert", and now "there is nothing here to migrate at all"), but it does
  not produce an actual plugin, so it is left for whoever picks it up next
  rather than folded into this PR.

## 3. The shape: one table, one host method, no UI

Ranger has no page, no nav entry and no components. It is MCP-triggered —
`packages/mcp-server`'s `lastest_ranger` / `lastest_ranger_status` tools call
the app over HTTP, never the plugin directly — and polled through
`/api/v1/ranger/*` in `src/app/api/v1/[...slug]/route.ts`, which now does
what `explorer`'s GET handler already does: `await getPluginRuntime()`, then
a dynamic `import("@lastest/plugin-ranger/actions")`. Existence and tenancy
are the action's own check (`RangerSessionNotFoundError`, mirroring
`ExplorerSessionNotFoundError`), so the route lost the duplicate
`queries.getAgentSession` + manual `teamId` check it used to open both the
GET and DELETE handlers with.

**Manifest:** `capabilities: ["browser", "repos", "events", "data"]`, one
table (`ranger_sessions`), a `deletion` hook. Tenanted, and wired *with* a
`runtime` (`configureRanger({ runtime, host, data })` in
`src/lib/core/runtime.ts`) — the `explorer`/`ci` shape, not the
`gamification`/`awards`/`launch` "no runtime" one, because
`startRanger`/`getRangerSession`/`cancelRanger` all resolve their scope from
a session-authorized `repositoryId` via `contextFor(rangerPlugin, {
repositoryId })`, the same call `explorer`'s actions make.

**`RangerHost` has one method:**

```ts
assertSafeOutboundUrl(url: string): Promise<void>;
```

This is the **fourth** plugin to declare this exact method verbatim, after
`explorer`, `app-map` and `api-test` — recipe §1.5's strongest form of the
"check against ports that already exist" signal. A `core/security` PR
retiring it would retire it in four plugins in one change; this migration's
honest contribution to the phase-5 backlog is therefore not "one more host
method" but "one more data point that this one is overdue."

**No `"use server"`.** Every function in `actions.ts` is a plain export.
Nothing in the plugin has a client component to call it from, so marking the
file `"use server"` would mint zero action ids for no benefit and, per
recipe §8, "a `"use server"` export nobody dispatches is not neutral" —
`launch` is the precedent for dropping the directive outright when a
plugin's only surface is a route rather than a page. Confirmed by build
output: `server-reference-manifest.json` has zero entries under
`plugins/ranger/src/actions`, and `plugins_ranger_src_errors_ts_*.js` is
present in `.next/server/chunks/`, proving the package's own code — not a
dead re-export — is what actually shipped (the two checks recipe §8 asks
for, read together rather than as a single pass/fail number).

## 4. What migrating onto `ctx.browser` fixed for free

The pre-migration code called `claimEmbeddedBrowserForAgent(5 * 60 * 1000,
onQueued)` and `releasePoolEB(runnerId)` directly from
`src/server/actions/ranger-agent.ts`, and `src/lib/playwright/ranger.ts`
opened its own `chromium.connectOverCDP(cdpUrl)`. `src/lib/core/browser-host.ts`
— the app's fill for `core/browser`'s `BrowserHost` — turns out to call the
exact same two functions. So `ctx.browser.withBrowser({ purpose:
"interactive" }, async (session) => { … })` is a pure refactor of the claim
path, not a behaviour change, with one real difference: `withBrowser` calls
`host.assertRunMinutes(team.id)` before claiming and clamps the callback to a
plan-derived deadline (`core/browser/src/host.ts`'s `maxHoldFor`). Neither
existed in the hand-rolled version. Ranger sessions are now subject to
run-minute quota and a hold-time ceiling for the first time — a gap this
migration closed incidentally, not a design goal of it.

The stream URL is the other simplification: the old code computed
`toProxyStreamUrl(raw, "", instanceId)` itself; `session.streamUrl` on the
`BrowserSession` core hands back is already the proxied, grant-signed value,
so `actions.ts` just reads it.

One behaviour-preservation detail that needed care, not a rewrite: the
original distinguished "no browser became available" (mark the
`ranger_provision` step failed) from "the browse itself threw" (mark
`ranger_browse` failed). `ctx.browser.withBrowser` collapses both into one
rejection path, so `executeRanger` in `actions.ts` tracks a `provisioned`
flag set the instant the callback starts, and the catch block picks the
failed step from it. Skipping that would have made every provisioning
failure since migration show up as a browse failure in the activity feed —
a small thing, but exactly the kind of silent behaviour drift recipe §9 asks
this section to call out.

## 5. The table, the deletion hook, and what did not move

`ranger_sessions` replaces ranger's slice of the shared `agent_sessions` —
the same move `explorer` made first, for the same reason: `agent_sessions`
is still shared by three unmigrated agents (`play`, `quickstart`, `qa`), so a
plugin cannot own an FK-free deletion story for rows it does not exclusively
write. `repository_id`/`team_id` are plain `text` per `core-scope.md` §6, and
`deletion.ts` — `onTeamDeleted` + `onRepoDeleted`, one table, no ordering to
get wrong — is the cascade the database no longer performs for free.

**Old ranger rows in `agent_sessions` (`kind = "ranger"`) are not migrated.**
They are short-lived polling records an MCP client typically drains within
minutes of creating them, not data anyone returns to days later, so a
one-off backfill script for rows that are already stale by the time this
lands would cost more than it is worth. `scripts/migrate.js` needed no edit
— unlike `gamification`/`ci`/`share`/`awards`, this is a genuinely new table,
not a rename, so there is no `drizzle-kit push` drop/recreate risk and
nothing for `EXPLORER_RENAMES`-style migration code to do.

`ActivitySourceType`/`agent_sessions.agent_type` is a related, pre-existing
gap this migration inherits rather than introduces: `PwAgentType` already
lists `"ranger"` as a valid value the old code set on every activity event,
but `src/lib/core/events-host.ts` (the app's fill for the `events` provider
plugin every migrated plugin uses) always sends `agentType: null` — it has
no field in `EventsHostEmit` for it. The activity feed card degrades
gracefully (the agent badge just does not render), and `explorer`'s own
emit already has the same gap, so this is not new to ranger — flagged here
because it was checked, not because it changed.

## 6. What I did NOT verify

Be suspicious of everything in this section.

- **No runtime exercise whatsoever.** The app was never started against a
  real database. Nothing called `POST /api/v1/repos/:id/ranger` against a
  live pool, watched a stream, or polled a session to completion. `pnpm
  build` proves Next.js can resolve the moved code across the package
  boundary and that the plugin's own chunk is what ships (§3); it proves
  nothing about a real EB claim succeeding or the page map coming back
  correctly shaped.
- **No `db:push` was run.** `ranger_sessions` has never been created in a
  real database. `core/data`'s `validateSchemaNamespace` (the `ranger_`
  prefix check) and the deletion-hook-presence check both run inside
  `resolveRegistry`, which `src/lib/core/manifests.test.ts` exercises
  without a database — that passed (part of `pnpm test`) — but nothing here
  confirms the table actually migrates cleanly against Postgres.
- **The MCP integration was not exercised end to end.** `packages/mcp-server`
  talks to the app over HTTP and needed no code change (the route's request/
  response shape is unchanged), but `lastest_ranger` / `lastest_ranger_status`
  were not run against a dev server to confirm that claim rather than assume
  it from reading `client.ts`.
- **The `provisioned`-flag failure-path split (§4) has no test of its own.**
  Both failure branches (`ctx.browser.withBrowser` rejecting before the
  callback runs vs. `browsePageMap` throwing inside it) are exercised only
  by reading the code, not by a unit test with a stub `BrowserCapability`
  that actually rejects at each point. If you want one thing exercised by
  hand first, make it this — it is also the one place this migration
  deliberately changed control flow rather than moving it verbatim.
- **The events emission shape (§5) is asserted by reading `events-host.ts`,
  not by an integration test that inserts a row and reads it back.**
