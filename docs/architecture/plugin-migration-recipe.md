# Plugin migration recipe (RFC §9 phase 4)

**Status:** written for the first phase-4 wave (`rca`, `url-diff`, `app-map`),
generalised from the explorer pilot ([`explorer-migration-result.md`](./explorer-migration-result.md))
and the two check-layer plugins. Revised after
[`launch`](./launch-migration-result.md), which added §2.1 (which deletion
target), §2.2 (a plugin need not be tenanted), §3.2 (replacing a join to a core table)
and the API-route case in §6;
and after [`api-test`](./api-test-migration-result.md), which added §2.3 (a
plugin that persists into core tables), §3.1 (write the guard into the port
method) and the shape rule in §3; and after
[`playground`](./playground-migration-result.md), which closed §2.2's open
question (`tenancy` is now a manifest field the kernel enforces) and sharpened
§1.5 (compare your port to the ports that exist) and §3.2; and after
[`gamification`](./gamification-migration-result.md), which added §1.6 (check
whether *core* imports the feature), §2.4 (check your table names) and a second
`"use server"` trap in §6; and after [`ci`](./ci-migration-result.md), which
gave §1.6 its three possible outcomes (invert / reclassify / stop), added §1.7
(an empty `contextFor()` may already be your `currentActor`), extended §2.1 to
"check what each dropped FK points at", generalised §6's page rule to API
routes, and split §8's action-id count into two distinct signals.
**Audience:** whoever migrates the next feature out of `src/` into `plugins/<id>/`.

This is the *how*. The *why* is [`core-plugin-refactor.md`](./core-plugin-refactor.md)
§3–§7 and [`core-scope.md`](./core-scope.md); read those first if you have not.

---

## 0. The three rules you are being paid to keep

1. **No `@/…` import anywhere under `plugins/<id>/`.** The package cannot see the
   Next.js app. What it needs from the app arrives injected.
2. **No `playwright`, `@lastest/db`, `@lastest/pool-service`, `pg`, `postgres`, or
   an AI SDK in the plugin's `package.json`.** pnpm's strict layout turns that
   manifest into the enforcement — not a lint rule someone can disable.
3. **No plugin → plugin import.** Compose through core, a shared `libs/*` package,
   or a host port filled at the composition root.

`pnpm arch` checks all three. `Target layout (core/** + plugins/**)` must stay at
**0 violations** — that number is not a ratchet, it is a hard zero.

## 1. What "done" looks like

- `plugins/<id>/` is a workspace package with one `definePlugin` manifest.
- `src/lib/<id>/` and `src/server/actions/<id>.ts` are **deleted**, not left as
  shims. Every consumer imports `@lastest/plugin-<id>/…` instead.
- The plugin's entry is gone from `PSEUDO_PLUGINS` in
  `tools/architecture/boundaries.mjs` — that deletion *is* the graduation, and it
  is what drops the burndown.
- Behaviour is identical. This is a move, not a rewrite (RFC §2).

## 1.5 Cost the host port BEFORE you start

Count the distinct core functions the feature calls. That number is the host
port's size, and it is the single best predictor of whether the migration is
worth doing yet.

| Port size | Verdict |
| --- | --- |
| ≤ ~8 | Go. This is a feature sitting *on* core. |
| ~8–15 | Go, but expect most of the port to be one missing capability. |
| > ~15 | **Stop.** The port would be bigger than the feature. |

A port larger than the feature it serves is not a boundary — it is core
re-exported through a keyhole. It satisfies "no `@/…` imports" while proving
nothing, which is the §10 risk of drawing the boundary wrong. When the count
comes out that high, the feature is a thin *orchestration of* core rather than
a consumer of it, and the real task is extracting the core module it
orchestrates, as its own PR, first.

Measured so far: `playground` **3** (done), `launch` **4** (done), `api-test`
**5** (done), `rca` **6** (done), `app-map` **9** (done), `gamification` **9**
(done), `ci` **9** (done), `url-diff` **~22** (never migrated — reclassified as
core, RFC §9 phase 4).

> **Group by *what each method is*, not only by how many collapse together.**
> `api-test`'s five grouped into three — one security boundary, two authorized
> writes, two AI preflight reads — but the useful fact is that the security one
> (`fetchGuarded`) is the *third* declaration of the same gap, after
> `explorer`'s `assertSafeOutboundUrl` and `app-map`'s `fetchSitemapXml`. One
> `core/security` PR retires a method in three plugins at once. A port of 5
> containing a shared boundary is cheaper than a port of 5 containing five
> private reads.

> **Check your port against the ports that already exist — method by method,
> before you write it.** `playground`'s three (`resolveActor`, `rateLimit`, a
> batched user lookup) are all declared verbatim in `plugins/launch/src/host.ts`.
> Not a port *containing* a shared gap: a port that is **entirely** shared gap,
> arrived at independently by two migrations. Its honest size is therefore
> **zero new debt items** — it adds nothing to the phase-5 backlog and doubles
> the evidence for what is on it. That is the strongest form this signal takes,
> and it is the argument that justifies building the core capability: one
> `core/identity` PR plus a rate-limit capability retires six methods across two
> plugins. **If a method you are about to declare already exists verbatim in
> another plugin's `host.ts`, say so in your result doc.** Neither plugin alone
> made that case; together they do.
>
> `gamification` then added four more identity shapes — "who is calling", "is
> this an admin of this team", "who are these ids", "who is in this team" —
> bringing the total to **seven methods across three plugins**. That has stopped
> being a pattern worth noting and is now a costed piece of work with a known
> payoff. Build it before `share`, which has the same user-scoped surface and
> will otherwise write a fourth copy.
>
> Two smaller rules from the same comparison. Where the two differ, **the
> *wider* signature is usually the right one**: `PlaygroundHost.rateLimit`
> returns `{ allowed, retryAfterMs }` because the route's 429 carries a computed
> `Retry-After`, and taking launch's boolean would have been a behaviour change
> smuggled in through a port signature. And where one plugin needs less, **take
> less**: playground's actor carries no `isAdmin`, because that board has no
> staff endpoints, so nothing in the package *could* grow a role check.

> **Port size does not track LOC, in either direction.** `launch` is twice
> `rca`'s size with two thirds of its port; `url-diff` is smaller than both and
> would have needed 22. What it tracks is **how much of what the feature
> touches belongs to somebody else**. A useful proxy you can count in a
> minute: *joins from the feature's queries into a core table*. `launch` had
> exactly one (`launch_comments → users` for a display name) and it cost
> exactly one port method.

> **Count core functions the feature *calls*. Nothing else.** A first pass over
> `app-map` counted 20 distinct imported symbols and would have stopped the
> migration; the real port was **9**. The 11-symbol difference was type-only
> imports (which get narrowed or promoted — §3.1) and `@/components/ui`
> primitives (which go to `libs/ui` — §5). Neither is a port method.
>
> Then group what is left. `app-map`'s nine were five reads of one missing
> capability, one security boundary, and three calls into an unmigrated
> neighbour — three items of debt, not nine. A port of 9 that groups into 3
> is healthier than a port of 6 that groups into 6.

> **A zero burndown is now the normal case, not a red flag.** After `app-map`
> the instinct was that zero counted violations meant something was hidden.
> `api-test` went in at zero with *both* hazards below checked and genuinely
> had none — because the walker counts forbidden **imports**, and that feature's
> coupling was to core **tables** and core **auth**, reached through
> `src/lib/db/queries`, which is `CORE_SRC_PATHS` and therefore allowed. Most
> of what is left on the list looks like that. Still run the two checks; just
> do not expect the number to move, and do not read a flat number as "nothing
> happened". **The port count is the metric from here.**

> **Counting hazard 1 — the walker's blind spot.** `pnpm arch` reporting zero
> violations for a feature does not mean it has none.
> `crossPluginPatternsFor()` builds its patterns from `@/…` aliases, so a
> `plugin → plugin` import written as a *relative* path inside
> `src/server/actions/` is invisible to it. `app-map` graduated with a clean
> burndown while holding exactly such an import
> (`import { addQaTask, startQaAgent } from "./qa-agent"`). Always run
> `grep -rn 'from "\./' src/server/actions/<feature>.ts` as part of the survey.

> **Counting hazard 2 — binary files.** `plugins/app-map/src/build-map.ts`
> (formerly `src/lib/app-map/build-map.ts`) contains literal NUL
> bytes (deliberate `\0` separators in an edge key, line ~217). `grep` treats
> such a file as binary and **silently reports nothing** — no match, no
> warning. That made an early survey of this exact feature undercount its
> imports by seven. Before trusting a grep-based survey, run
> `file <path>`: anything reported as `data` rather than `text` is invisible to
> your search. `grep -a` reads it correctly.

> **Count the API route too, before you assume it re-exports.** `ci`'s GitLab
> webhook handler needed six extra host methods to live in the package
> (pull-request bookkeeping, build triggering, replay protection) — a 9-method
> port would have become 15. It stayed in the app and the plugin exposes a
> four-question *gate* instead. See §6.2.

## 1.6 Check whether *core* imports the feature. `pnpm arch` does not.

The walker builds its patterns from what a **plugin** may not import. Nothing
inspects what **core** imports, so a core→feature edge — the one direction RFC
§3 forbids outright — is invisible to the burndown, to ESLint and to the graph
test.

`gamification` had one. `createTest()` in `src/lib/db/queries/tests.ts` ended
with `import("@/lib/gamification/hooks")`, written as a dynamic import to break
a module-eval cycle rather than to hide anything, and it made the feature
*unmigratable* as it stood: a package cannot be imported from inside the query
layer without making core depend on it.

Before costing the port, run:

```
grep -rn '<feature>' src/lib/db src/lib/execution src/lib/eb src/lib/diff \
                     src/lib/verify src/lib/auth src/lib/ws
```

If anything comes back, **do not assume it is a blocking core PR.** There are
three resolutions and only the first is:

| What you found | Resolution | Cost | Precedent |
| --- | --- | --- | --- |
| Core genuinely calls the feature | **Invert it** — core declares a port, the composition root registers the listener | blocking core PR | `gamification` |
| What core calls was never the feature — it is a boundary misfiled under the feature's directory | **Reclassify it** — leave the code where it is, add the path to `CORE_SRC_PATHS` **and to CODEOWNERS**, and migrate only the rest | no code moves | `ci` |
| The feature is a thin orchestration *of* core | **Stop** — extract the core module first | separate, earlier PR | `url-diff` |

Tell them apart the same way §5 tells a library from a feature: **read the
module's import list and its consumer list.** `ci`'s eleven-call-site hit looked
like the worst case and was the cheapest — `src/lib/github/oauth.ts` and
`content.ts` are imported by `src/lib/auth/auth.ts` and `src/lib/ai/` because
they *are* core (OAuth exchange, encrypted token resolution, webhook signature
verification), while every CI-configuration module had exactly one consumer: its
own action module. One `PSEUDO_PLUGINS` entry, two destinations.

For the inversion case, the shape that worked: core declares a port
(`src/lib/db/test-hooks.ts`), the composition root registers the feature's
listener inside `getPluginRuntime()`, and `src/instrumentation.ts` already
awaits that at boot so nothing can outrun the registration.

For the reclassification case, **the CODEOWNERS half is not optional.**
`tools/architecture/boundaries.test.ts` asserts every `CORE_SRC_PATHS` entry is
owner-protected and will fail `pnpm test` if you forget — which is the point:
calling something core without a review gate makes the classification
meaningless.

## 1.7 Before declaring a `currentActor`, try an empty `contextFor()`

Four migrations in a row declared a host method for "who is calling"
(`launch`/`playground`'s `resolveActor`, `gamification`'s `currentActor`). `ci`
did not need one, and the reason generalises to any **team-scoped** feature:

```ts
const ctx = await runtime.contextFor(ciPlugin);   // no scope request at all
const teamId = ctx.team.id;                       // session-authorized
```

`resolveScope` falls through to the app's `requireTeamAccess()` when the request
carries neither `repositoryId` nor `teamId`, so `ctx.team.id` is a
session-authorized tenant that **no argument influenced**. `explorer` and
`app-map` pass a `repositoryId` because their work hangs off a repo; if yours
hangs off a *team*, pass nothing.

What this does **not** cover is *role*. RBAC capabilities are not on
`PluginContext` and should not be, so an admin-only action still needs
`host.requireTeamAdmin()` — shaped as "give me the authorized team id" per §3.1.
That method is now declared verbatim in two plugins, and `core/identity` would
retire eight identity methods across four.

> **While you are there, check for *relative* cross-feature imports in the
> files you are about to delete.** `src/server/actions/play-agent.ts` held
> `import { awardScore } from "./gamification"`, uncounted because `play-agent`
> is not a pseudo-plugin so no rule applied in either direction. It was found
> by `pnpm types` after the target was deleted, which is luck, not process.

## 2. Pick the shape: does the plugin own tables?

| | Owns tables | Owns no tables |
| --- | --- | --- |
| Manifest | `capabilities: ["data"]`, `schema: () => import("./schema")`, `deletion: …` | neither |
| Template | `plugins/a11y`, `plugins/explorer` | `plugins/design-system`, `plugins/events` |
| Table names | must be `<id>_`-prefixed; `core/data` validates at boot | n/a |

`resolveRegistry` refuses to boot a plugin that declares `schema` without
`deletion` — plugin tables carry no FK to core tables, so `ON DELETE CASCADE`
does not exist for them and the hook is the only thing that makes account
deletion complete ([`core-scope.md`](./core-scope.md) §6).

**A feature that only reads core tables owns no tables.** It reaches them
through a capability (`ctx.tests`, `ctx.repos`, `ctx.storage`) or, where core has
no API yet, through a **host port**.

### 2.1 Then ask what the rows hang off — team, repo, or user

The deletion hook has three targets, and picking the wrong one ships a GDPR
regression that nothing catches.

| The rows belong to | Hook | Example |
| --- | --- | --- |
| a tenant | `onTeamDeleted` / `onRepoDeleted` | `explorer_knowledge`, `a11y_baselines` |
| a person | `onUserDeleted` | `launch_votes`, `launch_comments` |
| something else entirely | **none exists** — say so | `ci_*.runner_id` → `runners` |

**Deleting a user does not delete their team.** So a team hook never fires for
user-scoped rows, and the FK you are removing (`REFERENCES users(id) ON DELETE
CASCADE`) was the only thing reaping them. `onUserDeleted` exists because
`launch` hit exactly this — and it landed as a **core PR before** the migration
(`core/contracts`, `core/data`, plus the `cascadePluginDeletion` call in
`queries.deleteUser`, which did not exist at all).

Mechanical check before you write `schema.ts`: list the FKs you are about to
drop and see what each points at.

```
select rel.relname as tbl, ref.relname as points_at, con.confdeltype
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_class ref on ref.oid = con.confrelid
 where con.contype = 'f' and rel.relname like '<id>_%';
```

Note also that a hook can be *stricter* than the FK it replaces, and usually
should be: `ON DELETE CASCADE` removed launch's vote rows but left the
denormalized `upvote_count` stale. The hook recomputes it.

**And read the `confdeltype` column, not just `confrelid`.** The query above
returns *what each FK points at* and *what it did*, and `ci` is where both
mattered:

| Dropped FK | `confdeltype` | Consequence |
| --- | --- | --- |
| `team_id -> teams.id` | `r` (**restrict**) | Not a cascade at all — it *refused* to delete a team with configs. Replacing it with `onTeamDeleted` is a **behaviour change**, and the right one (`core-scope.md` §6: a plugin must not veto a tenant deletion) — but say so, do not call it a preservation. |
| `repository_id -> repositories.id` | `c` (cascade) | The ordinary case. `onRepoDeleted`. |
| `runner_id -> runners.id` | `n` (set null) | **`DeletionTarget` has no case for a runner.** No hook can fire, so the config is left pointing at an id that does not resolve. |

The third row is the one to watch for: a target outside team/repo/user leaves a
gap the framework cannot close. Write it into `host.ts` and `deletion.ts` and
say how bad it is (`ci`'s is contained — the panel already renders the missing
runner as *"not found in database"* — and the honest fix is a fourth
`DeletionTarget`, a core PR). **Do not bolt a fourth target onto a migration
PR**; that is exactly the §7.2 split `playground`'s `tenancy` demonstrated.

### 2.2 A plugin does not have to be tenanted at all — declare it

Some plugins never call `contextFor` and never hold a `PluginContext`. A public
directory — anonymous readers, writers identified by a user id and an OAuth
scope, no `team_id` column anywhere — has no team to scope to, so `ctx.team`
would be a lie, and **a tenancy assertion that always passes reads exactly like
one that works**.

Say so in the manifest:

```ts
export const playgroundPlugin = definePlugin({
  id: "playground",
  title: "Playground leaderboard",
  tenancy: "none",          // ← the declaration
  capabilities: ["data"],   // ← the only capability you may then consume
  schema: () => import("./schema"),
  deletion: createDeletionHook(),
});
```

and let the composition root pass no `runtime`, only the handle:

```ts
configurePlayground({ host: appPlaygroundHost, data: data.capability("playground") });
```

Taking the `DataCapability` straight from the wiring slot is not a new
mechanism — it is the route every plugin's *deletion hook* already takes, since
a hook runs because a tenant was deleted and has no scope left to build a
context from.

**`tenancy: "none"` is a narrowing, not an exemption**, and that is the whole
design. `resolveRegistry` rejects every capability but `data` (the rest are all
built from a resolved `ContextScope`, which carries a team), rejects `provides`
(a provider is handed its consumer's team), and rejects job handlers (dispatch
builds a context). `buildContext` throws `UntenantedPluginError` if anything
hands one a scope anyway — a composition root wiring a `runtime` in, or the
plugin calling `contextFor` itself. `data` is the exception because `core/data`
scopes by *plugin id*: the handle is bound to the `<id>_`-prefixed tables, a
boundary that holds with or without a team behind it.

What it does not relax: you still owe a `deletion` hook, and it is almost
always `onUserDeleted` — see §2.1.

> Written up as `launch`'s open question ("the only signal is the missing
> `runtime`; if a second untenanted plugin appears, make it explicit in the
> kernel first — that is a core PR, not a migration") and closed as
> `playground`'s core PR, exactly that way. Worth noting *because it was not
> blocking*: unlike `onUserDeleted`, the migration would have worked without
> it. A guard rail bundled into a feature PR is an afterthought or nothing;
> splitting it out is what made it get written.

### 2.3 A plugin can persist and still own no table

`api-test` owns no storage and is not computed-on-read either: an API test *is*
a `tests` row (`testType: "api"` + an `apiDefinition` jsonb), and its result is
a `test_results.api_result` jsonb. Both are core tables.

The manifest consequence is the easy case — no `schema`, no `deletion` hook,
core's own cascades already reach the rows. The design consequence is not:
[`core-scope.md`](./core-scope.md) §6 ("a plugin does not reach a core table, it
calls a core function") stops being a rule that happens not to bind and becomes
the entire shape of the port.

Two things to decide when you hit this:

- **Does an existing capability fit — really fit?** `ctx.tests` exists and was
  the wrong answer here: `createQuarantined` deliberately cannot express an
  un-quarantined write, an `apiDefinition`, or an update at all, and those
  refusals are the capability's design, not gaps to patch. Widening a
  capability to fit its second consumer is a **core PR with its own review**.
  Declaring the gap in the host port is the migration PR. Do not merge the two.
- **Whose jsonb is it?** A payload the plugin is the only writer *and* reader
  of, sitting in a core column, is the promote case (§6.1 row one) — six
  API-test types went to `@lastest/eb-protocol` and the core schema re-exports
  them, so no app import path changed.

### 2.4 Check your table names against the `<id>_` rule before you plan

`core/data`'s `validateSchemaNamespace` refuses to boot a plugin whose tables
are not prefixed with its id. Every migration up to `playground` got that for
free — `launch_*`, `a11y_*`, `explorer_*`, `playground_achievements` were all
already namespaced — and "no rename, no backfill, no drop/recreate risk" had
started to read like a property of the process. It was luck.

`gamification` had to rename five of six, and `ci` both of two — so this is now
the **expected** case, not the exception. `ci`'s stakes were higher than a
leaderboard's: `gitlab_pipeline_configs.webhook_secret` cannot be re-derived,
because the matching value lives in the customer's GitLab project hook, so a
silent drop/recreate turns every subsequent delivery into a 401.

`gamification`'s five:

```
bots             -> gamification_bots
bug_blitz_events -> gamification_bug_blitz_events
score_events     -> gamification_score_events
user_scores      -> gamification_user_scores
achievements     -> gamification_achievements
```

**`drizzle-kit push` cannot see a rename.** It compares names, finds the old
table absent from the schema and the new one missing from the database, and
resolves that by dropping the first and creating the second — silently, with
`--force`, taking every row. The rename has to happen in `scripts/migrate.js`
*before* push, following `EXPLORER_RENAMES` / `migrateGamificationTables()`:
idempotent, skipping a destination that already holds rows and dropping one a
prior push left behind empty.

> Two of gamification's old names, `achievements` and `user_scores`, were
> generic enough to read like core concepts. They never were. That ambiguity is
> a better argument for the prefix rule than "namespaces prevent collisions".

## 3. The host port — the honest escape hatch

When the feature needs something core does not expose yet, declare it as an
interface in `plugins/<id>/src/host.ts` and let the composition root fill it from
`src/lib/core/<id>-host.ts`.

```ts
// plugins/<id>/src/host.ts — the gap, stated out loud
export interface RcaHost {
  listDiffsForBuild(buildId: string): Promise<RcaDiffInput[]>;
}
```

```ts
// src/lib/core/<id>-host.ts — the app fills it, using @/… freely
import type { RcaHost } from "@lastest/plugin-rca/host";
export const appRcaHost: RcaHost = { … };
```

Two things make this legitimate rather than a loophole:

- The plugin still holds **no** `@/…` import, no DB handle and no pod address.
  It has a named, typed, greppable list of everything it needs from outside.
- The port is **countable**. `explorer` started at eight methods and is at five;
  the count going down is the phase-5 burndown. A port method that turns out to
  be general is a candidate for promotion into a real core capability — as its
  own PR (RFC §7.2), never bundled with a plugin migration.

Write the file header the way `plugins/explorer/src/host.ts` does: say which
methods are permanent seams and which are scaffolding waiting on a core PR.

### 3.1 Shape each method as "do the thing", not "give me the primitive"

The two forms both satisfy `pnpm arch`. Only one is a boundary.

```ts
assertSafeOutboundUrl(url: string): Promise<void>;   // a re-export
fetchGuarded(url, req): Promise<GuardedResponse>;    // a boundary
```

With the first, the plugin still owns the control flow: it can call the guard
and then `fetch` anyway, or add a `skipCheck` flag, or forget it in the second
call site. With the second there is nothing in the package to forget *with* —
no `fetch`, no dispatcher, no guard. `plugins/explorer` has the weaker shape
and should be revisited when `core/security` lands; `api-test` has the
stronger one.

**The same rule turns an authorization habit into a property.** Any port method
that performs a *write* should carry its own guard:

```ts
// src/lib/core/<id>-host.ts — the guard is inside the write, not beside it
async createTest(input) {
  await requireRepoCapability(input.repositoryId, "tests:write");
  return { id: (await queries.createTest({ … })).id };
}
```

`plugins/api-test/src/actions.ts` then has no guard at all, because it has no
other route to the table — three surveyed symbols
(`requireRepoCapability`, `requireRepoAccess`, `requireTestOwnership`) became
**zero** port methods this way. It is also forced rather than chosen: RBAC
`Capability` values are not on `PluginContext` and should not be.

Apply the same reasoning to anything the write must *not* omit. `tests.code` is
human-visible and snapshotted into `test_versions`, and an API definition can
carry a live bearer token — so the host takes the definition and renders the
column through the plugin's `renderApiDefinitionForCode` itself, rather than
accepting a pre-rendered string. The plugin owns the redaction logic (its own
type); core owns the decision to apply it.

**A side effect worth expecting: injected transports make the engine
testable.** `runApiTest` had no coverage before the migration because testing it
meant mocking global `fetch` and an undici `Agent`. With `fetchGuarded`
injected, a stub host is four lines. Be honest about the causation in your
result doc — dependency injection did that, not the boundary; the boundary is
what forced the question.

### 3.2 Replacing a join to a core table: check the join type first

`core-scope.md` §6 means every join from a feature query into a core table has
to go. The column list tells you what to put in the port method. It does not
tell you what else the join was doing.

| Join | What it was doing | Port method is enough? |
| --- | --- | --- |
| `leftJoin(users)` | supplying a column | **yes** — `resolveUserNames`, and rows with no match still render |
| `innerJoin(users)` | supplying a column **and an existence predicate** | **no** — reproduce the filter too |

`launch`'s comment authors were a `leftJoin`: the port returns names, missing
users render `null`, done. `playground`'s leaderboard was an `innerJoin`, and a
row whose user no longer exists used to match nothing and silently vanish.
Replacing only the name would have put deleted people back on a public board.
So the host method distinguishes an **absent** user (dropped) from a **present**
user with `name: null` (kept), and the plugin drops any id the host does not
return.

Keep the filter even when a deletion hook now reaps those rows — rows orphaned
*before* the hook existed are exactly the ones that would surface.

The cost of the swap is one batched round trip per call instead of one join.
Bound it: `playground` pays it at most once per 60s board-cache TTL, over an id
set already in memory.

## 4. Wiring — why `Symbol.for` and not a module-level `let`

A plugin's `"use server"` module is *imported by Next.js*, never constructed, so
there is no moment at which to pass it arguments. `configure<Name>()` is called
once by `src/lib/core/runtime.ts` and the actions read what it left.

The slot must be a realm-wide `Symbol.for(...)` key on `globalThis`. Next.js can
place a server action's module and the module that wired it in **different
bundles**; two copies of a module-level `let` is a failure that only appears in a
production build. Copy `plugins/design-system/src/wiring.ts` (host only) or
`plugins/explorer/src/wiring.ts` (host + runtime + data).

## 5. Shared pure logic goes to `libs/`, not to core

When two features need the same dependency-free helper, the answer is a `libs/*`
package — the third tier from [`core-scope.md`](./core-scope.md) §3. Core is for
things that break *everyone* when a feature gets them wrong (tenancy, capacity,
money, credentials, the registry). Shared code that guards nothing is a library,
and putting it in core is how the RFC's core got to nine modules.

The explorer pilot created `libs/page-map` and `libs/cron` this way; a later
bulk pass added `libs/github`, `libs/test-templates` and `libs/route-scan`
([result](./shared-dependency-promotions.md)). Keep libs free of `@/…` and free
of plugin imports — `pnpm arch` enforces both.

If the helper *is* a security boundary (an SSRF guard, crypto, a quota check),
it belongs in core instead, and it is a separate PR.

**The test is mechanical — read the module's import list:**

| Its imports | Verdict |
| --- | --- |
| nothing, or only other `libs/*` | library. Promote. |
| `@/lib/db`, `@/lib/ai`, another feature | not shared logic, it is a feature. Wants `ctx.jobs`. |
| a storage path, crypto, a quota, an SSRF guard | boundary. Core, separate PR. |

`@/lib/share/video-fallback` is the instructive near-miss: 66 lines, imports
only `fs/promises` and `path`, looks exactly like a library — and is not one,
because it joins a caller-supplied id into a filesystem path under
`storage/`. Row three, not row one.

**Do this as its own pass, before the migrations, not inside one.** Count the
violations by *module imported* rather than by importing feature — one module
was 19% of the whole burndown. If you promote during a migration instead, that
import becomes a host-port method: the rule is satisfied and the coupling
survives.

**Check for shims first.** `qa-agent` was importing `@/lib/scheduling/cron`,
which has been a 13-line re-export of `@lastest/cron` since phase 2. The
violation was the *path*, not the dependency. A one-line import change was
worth as much as a migration, so grep for these before designing anything.

## 6. Routes and actions cross the package boundary fine (spike S1)

- **Server actions:** a `"use server"` module inside a `transpilePackages`
  package produces real, dispatchable action ids. Export them from
  `plugins/<id>/src/actions.ts`. No codegen, no shim.

  **The rule that covers both known traps: a `"use server"` module exports
  async functions and nothing else.**
  - `export { x } from "pkg"` compiles to a module with **no exports** —
    declare wrapper functions if you ever need to re-export.
  - `export type { A, B };` compiles to a **runtime action export**, and the
    production build then fails on every page with
    `Export A doesn't exist in target module`. Next.js assigns an action id per
    export name before types are erased, then cannot resolve them. `pnpm types`
    and `pnpm lint` both pass; only `pnpm build` catches it. Put types on a
    non-action module and re-export from `index.ts` (`gamification`).
- **Route pages:** the page component lives in the package
  (`plugins/<id>/src/ui/page.tsx`, exported as `./page`). The app's
  `src/app/(app)/<path>/page.tsx` keeps only the *composition* — resolving the
  selected repository, plan gating, and handing down app UI the plugin may not
  import. See `src/app/(app)/explorer/page.tsx` for the pattern and for the
  reasoning about what is legitimate to pass down.
- **`"use client"` components** inside the package work. Import shadcn
  primitives from `@lastest/ui`, not from `@/components/ui`. A primitive that
  is not there yet moves in — definition to `libs/ui`, re-export shim left at
  `src/components/ui/<name>.tsx` so no app import changes. `libs/` carries no
  CODEOWNERS gate, so this is not a core PR.
- **API routes work the same way, and are *sometimes* a bare re-export.** The
  handlers live in the package (`plugins/<id>/src/api/handlers.ts`) and
  `src/app/api/.../route.ts` re-exports them by name — Next.js discovers route
  handlers by named export, so `export { GET, POST } from "@lastest/plugin-<id>/api"`
  is what it wants. (This is *not* the S1 `"use server"` trap above; that one
  applies only to `"use server"` files.) See
  `src/app/api/v1/launch/[...path]/route.ts`, 16 lines for a 681-line handler.
  But see §6.2 before assuming yours is that shape.
- **App UI a plugin cannot import goes down as a prop.** `app-map` handed its
  live-progress panel down as `exploreProgressPanel` (a `ComponentType`) and
  qa-agent's cancel action as `onCancelExploration`, the same way
  `src/app/(app)/explorer/page.tsx` hands down `browserViewer`. The rule:
  **the plugin owns the placement, the app owns the thing placed.** A render
  prop is not a loophole — the plugin still learns nothing about what it
  mounted.

### 6.1 Types the plugin may not import: narrow, or promote?

Both are legitimate; the deciding question is *whose type is it*.

| | Do this | Precedent |
| --- | --- | --- |
| The type is the plugin's own payload | **Promote** it to `@lastest/eb-protocol` (a core PR) | `rca` — its verdict shapes |
| The type belongs to core or to another unmigrated feature | **Narrow** it: declare the fields you read in `host.ts`, and let a `satisfies` clause in `src/lib/core/<id>-host.ts` be the assertion that it still matches | `rca`'s `RcaChangeMap`; `app-map`'s `AppMapDiscovery` |

Narrowing is not a fork as long as the assertion exists: if core's shape
drifts, the host file stops type-checking. Promoting *another* feature's
payload types ahead of that feature's own migration is presumptuous — and
narrowing is why `app-map` needed no core change at all.

### 6.2 A route moves only if the route is mostly the feature's

`launch`'s route was a bare re-export because every line of the handler was
launch's. `ci`'s GitLab webhook is the opposite ratio and **stayed in the app.**

Count it the way §1.5 says to count anything: moving the handler into the
package needed `getRepositoryByGitlabProjectId`, `getPullRequestByBranch`,
`createPullRequest`, `updatePullRequest`, `createAndRunBuild` and
`markWebhookSeen` — **six** extra host methods, taking a 9-method port to 15,
to drag pull-request bookkeeping across a boundary it has no reason to cross.

Read the handler and split it by *owner*, not by file:

| The handler does | Owner |
| --- | --- |
| resolve the repository, record the merge request, trigger the build, replay protection | core |
| what shared secret should this have been signed with; is this event enabled; is this branch in the filter; is delivery `ci_file` or `webhook` | the plugin |

So the plugin exports a **gate** (`plugins/ci/src/webhook.ts`) that answers its
four questions and nothing else, and the app route composes. That is §6's page
rule one level up: *the plugin owns the placement, the app owns the thing
placed* becomes **the plugin answers its own questions, the app composes.**

Two details worth copying:

- **The gate returns the *expected* secret; the route does the
  `timingSafeEqual`.** The plugin never sees the presented token, because
  comparing secrets is core's job.
- **The gate has no session**, so it takes its `DataCapability` from the wiring
  slot rather than `contextFor` — the same route a deletion hook takes (§2.2).
  Resolving the config is what *establishes* the tenant, so a `teamId` argument
  would be circular; that is the one place a plugin query legitimately takes no
  team.

## 7. Registration checklist

| File | Edit |
| --- | --- |
| `plugins/<id>/package.json` | deps honest — this is the enforcement (§7.4) |
| `package.json` (root) | `"@lastest/plugin-<id>": "workspace:*"` |
| `next.config.ts` | add to `transpilePackages` |
| `src/lib/core/manifests.ts` | import + append to `MANIFESTS` |
| `src/lib/core/runtime.ts` | import `configure<Name>` + call it in `getPluginRuntime` |
| `src/lib/core/<id>-host.ts` | the app's fill for the host port, if there is one |
| `src/lib/core/ai-capability.ts` | if you declare `capabilities: ["ai"]`: add your `AIActionType` to `ACTION_TYPES` |
| `scripts/migrate.js` | if tables moved: drop the FKs to core tables *by catalogue lookup*, before `drizzle-kit push` |
| `tools/architecture/boundaries.mjs` | **delete** the `PSEUDO_PLUGINS` entry |
| `tools/architecture/boundaries.mjs` | if you reclassified anything as core (§1.6): add it to `CORE_SRC_PATHS` |
| `.github/CODEOWNERS` | **required** for every path you added to `CORE_SRC_PATHS` — the graph test fails otherwise |
| `tools/architecture/baseline.json` | regenerate with `pnpm arch:baseline` — but see below |

`drizzle.config.ts` needs no edit — it already globs `plugins/*/src/schema.ts`.
The FK drop does: `push` would drop the constraints itself, but *by name*, and
implicitly-created constraint names differ between environments. Find them in
`pg_constraint` instead. See `dropLaunchUserForeignKeys()`.

The baseline only needs regenerating if the count actually moved. `app-map` and
`api-test` both graduated without changing it, and a baseline rewritten to the
same number is noise in the diff.

**The `ai-capability` row is a silent one.** `createAiFactory` drops an
`actionType` it does not recognise — the `ai_prompt_logs.action_type` column is
an enum, so passing an unknown value would fail the insert inside the logging
path rather than at the call site. The allowlist started as the three
`explorer_*` values, so a feature moving its `generateWithAI(...)` call onto
`ctx.ai.generate(...)` **loses its spend attribution with no error, no warning
and no failing test**. `api-test` had to add `create_test`. Check yours.

## 8. Gates

```
pnpm install --frozen-lockfile   # new package resolves; no forbidden dep pulled in
pnpm arch                        # target layout must be 0; current layout must not rise
pnpm lint
pnpm types
pnpm test
pnpm build                       # the real check that actions + route pages still resolve
```

`pnpm build` is the one that matters. Type-checking a package in isolation will
not tell you whether Next.js can still dispatch the action.

Better than "the build passed" — count the action ids it produced:

```
node -e "const m=require('./.next/server/server-reference-manifest.json');
console.log(Object.values(m.node).filter(v =>
  JSON.stringify(v).includes('plugins/<id>/src/actions')).length)"
```

That number must equal the number of exported actions. `app-map` expected 5 and
got 5. **A mismatch is two different findings depending on its shape:**

| Result | Means | Do |
| --- | --- | --- |
| **zero** ids | the S1 re-export trap — the module compiled to no exports at all | declare the actions locally (§6) |
| **fewer, but not zero** | the missing ones are unreachable from any client boundary, so Next.js minted no id — i.e. **dead actions** | delete them |

`ci` came back 10 for 13, and all three without ids had been dead *before* the
migration: the settings page read its configs through the query layer and both
YAML previews are computed client-side, so each was a live RPC endpoint
maintained for no caller. A `"use server"` export nobody dispatches is not
neutral — it is an unauthenticated-by-default entry point you are not thinking
about. Server-component reads belong in a plain `reads.ts` instead
(`gamification`, `ci`), which is also what a server component actually wants.

**A plugin with no actions needs a different check.** `launch` exports none —
its only surface is a REST route — so the manifest count is vacuously zero.
There, confirm the route appears in the build's route table
(`ƒ /api/v1/launch/[...path]`) *and* that the plugin's own code landed in the
emitted chunk, e.g. `grep -rl '<a string only the handler contains>' .next/server/`.
A re-export that resolved to nothing would still print a route line.

**`pnpm test` does not check the plugin registry.** `resolveRegistry` and
`core/data`'s namespace validation only run inside `getPluginRuntime()`, which
needs a database — so a `<id>_` prefix typo or an empty `deletion` object used
to be provable only by booting the app. `src/lib/core/manifests.test.ts` now
runs those checks against `MANIFESTS` (which is import-safe by design). Nothing
to add per migration; it just has to keep passing.

## 9. Write down what you did *not* verify

Every migration so far has shipped with unexercised paths — no runtime click-through,
no `db:push` against a dev database, no real browser. Say so explicitly in the
result doc, the way [`explorer-migration-result.md`](./explorer-migration-result.md)
§6 does. A migration that claims more than it checked is worse than one that
admits the gap, because the next person believes it.
