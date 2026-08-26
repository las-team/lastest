# Playground leaderboard migration — result

**Status:** done and building. `pnpm install`, `pnpm arch`, `pnpm lint`,
`pnpm types`, `pnpm test` and `pnpm build` all pass.
**Recipe:** [`plugin-migration-recipe.md`](./plugin-migration-recipe.md).
**Phase:** the fifth plugin of RFC §9 phase 4, after
[`rca`](./rca-migration-result.md), [`app-map`](./app-map-migration-result.md),
[`launch`](./launch-migration-result.md) and
[`api-test`](./api-test-migration-result.md).
**Committed** as three commits — core first (`d26add04`), launch adopting the
new field (`065cacc9`), migration on top (`c57dfcae`). The §7.2 split.

---

## 1. The headline

`playground` is a workspace package. `plugins/playground/package.json` lists
`@lastest/contracts`, `@lastest/core-data`, `@lastest/kernel`, `drizzle-orm`
and `uuid` — no `playwright`, no `@lastest/db`, no `@lastest/pool-service`, no
AI SDK. There is no `@/…` import anywhere under `plugins/playground/`.
`pnpm arch` reports **0 violations in the target layout**.

The moved surface, ~1,400 LOC:

| Was | Now |
| --- | --- |
| `src/lib/playground/registry.ts` + `.test.ts` | `plugins/playground/src/registry.ts` (verbatim) |
| `src/lib/playground/leaderboard.ts` + `.test.ts` | `plugins/playground/src/domain/leaderboard.ts` |
| `src/lib/db/queries/playground.ts` | `plugins/playground/src/data/queries.ts` |
| `src/app/api/v1/playground/[...path]/route.ts` | `plugins/playground/src/api/handlers.ts` (route is now 15 lines) |
| `src/lib/http/board-responses.ts` | `plugins/playground/src/api/responses.ts` — **deleted** from the app, §5 |
| `packages/db/src/schema/growth.ts` (`playground_achievements`, `DEFAULT_PLAYGROUND`) | `plugins/playground/src/{schema,config}.ts` |
| — | `plugins/playground/src/{index,host,wiring,deletion}.ts` |

**The build is the evidence, not the claim.** This plugin exports no server
actions — its only surface is a REST route — so, as with `launch`, the
`server-reference-manifest` count is vacuously zero and proves nothing. The
checks that do:

```
ƒ /api/v1/playground/[...path]                     ← route resolved
grep -rl 'playground-progress:'      .next/server/ ← handler code emitted
grep -rl 'checkboxes-radios.indeterminate' .next/server/ ← registry emitted
```

A re-export that resolved to nothing would still have printed the route line.

## 2. Port size: 3, and every method is a duplicate

Costed before starting, per recipe §1.5. Three methods — the smallest port of
any migration so far.

| # | Method | What it is | Already in `LaunchHost`? |
| --- | --- | --- | --- |
| 1 | `resolveActor` | identity boundary (bearer → person) | **yes**, identically |
| 2 | `rateLimit` | shared-resource boundary | **yes**, narrower there |
| 3 | `resolveUsers` | core read (display name + account age) | **yes**, as `resolveUserNames` |

Measured ports so far: `playground` **3**, `launch` **4**, `api-test` **5**,
`rca` **6**, `app-map` **9**, `url-diff` ~22 (never migrated).

**The number is not the finding. The overlap is.**

The recipe already says to group a port by *what each method is* rather than
counting it, because `api-test`'s `fetchGuarded` was the third independent
declaration of the same SSRF gap and one `core/security` PR would retire it in
three plugins at once. This is the same observation with the volume turned up:
it is not a port *containing* a shared gap, it is a port that is **entirely**
shared gap. Two untenanted plugins, migrated independently, arrived at the same
three needs and nothing else.

So the honest reading of this port's size is **zero new debt items**. It adds
nothing to the phase-5 backlog; it doubles the evidence for what is already on
it. Concretely, one `core/identity` capability exposing

- "resolve this bearer token to a person" and
- "give me the public slice of these user ids"

plus a rate-limit capability, would retire *both* ports completely — six
methods across two plugins, zero remaining. Neither plugin alone made a strong
enough case to build them. Together they do, and the case should be made
**before `share`, `gamification` and `playground`'s neighbours**, all of which
have the same user-scoped shape and will otherwise write a third copy.

### 2.1 One method is deliberately wider than launch's

`LaunchHost.rateLimit` returns a boolean. This one returns
`{ allowed, retryAfterMs }`, because the playground's 429 carries a computed
`Retry-After` derived from the limiter's oldest bucket hit. Collapsing that to
a fixed header value would have been a behaviour change smuggled in through a
port signature — the kind that passes every gate and shows up as a client
retry storm. When the two are unified, the wider shape is the one to keep.

### 2.2 And one is deliberately narrower

`LaunchHost.resolveActor` returns `isAdmin`, because the launch board has
staff-only endpoints. The playground has none, so the role never crosses this
boundary at all. There is nothing in the package that *could* grow a role
check, which is the difference between "we did not add one" and "one cannot be
added".

## 3. The core PR: `tenancy` in the manifest

[`launch-migration-result.md`](./launch-migration-result.md) §3.1 ended with a
deferral:

> Nothing in `PluginManifest` records that a plugin is untenanted. […] A future
> core PR could make it explicit […] Not doing it here: it is core, and it is
> speculative until a second untenanted plugin exists.

This is that second plugin, so the field landed first (`d26add04`), as its own
commit, ahead of any plugin code. `PluginManifest` grows
`tenancy?: "team" | "none"`, defaulting to `"team"` so every existing manifest
resolves unchanged.

What it buys is not documentation. `resolveRegistry` now rejects three manifest
shapes for an untenanted plugin, each because it would force the kernel to
produce a team the plugin has said does not exist:

| Rejected | Why |
| --- | --- |
| any capability but `data` | every other factory is handed a resolved `ContextScope`, which carries a `team` |
| any `provides` | a provider receives its *consumer's* team in `ProviderScope` |
| any job handler | `dispatch` builds a context before calling it |

`data` is the exception because `core/data` scopes by **plugin id**, not by
tenant — the handle is bound to the `<id>_`-prefixed tables, a boundary that
holds with or without a team behind it.

`buildContext` then throws `UntenantedPluginError` as the backstop for what the
registry cannot see: a composition root wiring a `runtime` in, or the plugin
calling `contextFor` itself. Both would otherwise succeed and hand back a
`ctx.team` resolved from whoever happened to be logged in. The guard is in
`buildContext` rather than `contextFor` because `dispatch` builds a context
too, and one guard on the shared path cannot be routed around by a future
second entry point.

**The shape of the field is the interesting part.** `tenancy: "none"` reads
like an exemption and is the opposite — it is a *narrowing*, and the plugin
gets strictly less than a default one does. That was the design goal: launch's
result doc warned that "a tenancy check that always passes reads exactly like a
tenancy check that works", and a field that made untenanted plugins *easier* to
write would have made that failure cheaper rather than harder.

This is also the second time the recipe's "make it explicit in the kernel
first" instruction has been followed rather than deferred, and it is worth
noting the difference from `launch`'s core PR. `onUserDeleted` was **blocking**
— without it, migrating launch would have shipped a silent GDPR regression.
`tenancy` is not: the playground would have worked fine without it, exactly as
launch does today. It is a guard rail, and guard rails are the kind of core
change that gets skipped when they are bundled into a feature PR. Splitting it
out is what made it get written.

## 4. What `core-scope.md` §6 cost here: an `innerJoin` doing two jobs

The leaderboard aggregate used to be:

```sql
… from playground_achievements
   inner join users on users.id = playground_achievements.user_id
  group by user_id, users.name
```

A plugin may not read a core table, so the join had to go. The obvious half is
the display name, which now arrives from `PlaygroundHost.resolveUsers` and is
merged in *before* ranking — where the join used to sit, so ranks stay
contiguous and identical.

**The non-obvious half is that the join was also a filter.** A row whose user
no longer exists matched nothing and silently vanished. Reproducing only the
name would have put deleted people back on a public leaderboard. So `hydrate()`
drops any id the host does not return — and `resolveUsers` distinguishes an
*absent* user (dropped) from a *present* user with `name: null` (kept, rendered
"Anonymous"), which is exactly the pair the old `users.name` produced.

This is worth generalising: **when you delete a join to a core table, ask what
the join type was.** A `leftJoin` (launch's comment authors) really is only
supplying data. An `innerJoin` is supplying data *and* an existence predicate,
and only one of those is visible in the column list.

The cost of the replacement is one extra round trip per cache miss instead of
one join — paid at most once per 60s board cache TTL, over an id set already in
memory.

## 5. `board-responses` is deleted, not shared

`src/lib/http/board-responses.ts` existed only for this route. It was itself
split out of `src/lib/launch/api-shared.ts` when `launch` migrated, and its doc
comment had already worked out the conclusion:

> a single shared `fail()` whose doc comment had to enumerate both features'
> failure codes was the smell that said so.

So it moved into the plugin as `src/api/responses.ts` and the app file is gone.
There are now two near-identical six-line `err`/`fail` pairs, one per plugin,
and the duplication is the point: a response body is part of an API's contract
with its own frontend, and the two frontends are different repos with different
failure codes.

`DEFAULT_PLAYGROUND.scope` went the same way for the opposite reason — it
duplicated `PLAYGROUND_SCOPE` in `@/lib/auth/oauth-clients`, which is the copy
everything actually read. What a credential *grants* stays with the OAuth
client registry (core: it is a credential). What an endpoint *demands* is
`PLAYGROUND_SCOPES` in the plugin (feature policy). The two strings being equal
is a coincidence of configuration, not a shared definition.

## 6. Deletion: the target already existed

`playground_achievements.user_id REFERENCES users(id) ON DELETE CASCADE` is
gone, per `core-scope.md` §6, and `onUserDeleted` replaces it — one `delete
… where user_id = $1`, idempotent by construction, since the plugin owns
exactly one table and every row in it hangs off the user directly.

**This cost no core change, and the contrast with `launch` is the useful
part.** Launch was the first plugin with person-scoped rows and had to land
`onUserDeleted`, a `"user"` `DeletionTarget` and a `cascadePluginDeletion` call
in `queries.deleteUser` — which did not exist at all — before it could migrate
without shipping a GDPR regression. The playground is the second and pays
nothing. That is the shape a framework investment is supposed to have, and it
is the first phase-4 evidence of it: recipe §2.1's warning cost one plugin a
core PR and will cost the rest of the user-scoped list zero.

The FK drop is by catalogue lookup in `scripts/migrate.js`, not by name —
`dropLaunchUserForeignKeys` became `dropPluginUserForeignKeys` and grew one
table name. Implicit constraint names differ between environments; `push` would
drop them by name and diverge.

## 7. The burndown did not move, and that is now unremarkable

21 → 21. `playground` had zero counted violations going in and zero coming out.
Both of recipe §1.5's counting hazards were checked: the feature owns no
`src/server/actions/` file at all (so no relative cross-feature import can
hide there), and `file` reports every moved source as text (so the grep survey
was complete).

The reason is the one `api-test` established: the walker counts forbidden
**imports**, and this feature's coupling was to core **tables**
(`playground_achievements` via the shared handle), core **auth**
(`board-actor`) and core **rate limiting** — all reached through
`CORE_SRC_PATHS`, all allowed. A feature can be built almost entirely on
other people's infrastructure and score zero.

**The port count is the metric.** For this plugin it says 3, and §2 says even
that overstates it.

## 8. Behaviour changes: one, and it is a non-change

Held constant everywhere except the leaderboard's user-existence filter, which
is reproduced rather than preserved verbatim (§4) — same output set, different
mechanism. Everything else is the same code with different import paths:

- The scoring registry moved **verbatim**, including its 75 ids and its
  "regenerate, don't hand-edit" header. Its 62-line test moved unmodified.
- The rate-limit `Retry-After` computation is preserved exactly, which is why
  the port method is wider than launch's (§2.1).
- The `earnedAtEpochMs` clamp to `[account creation, now]` is preserved; the
  floor now arrives as `createdAtMs` on the resolved user instead of from a
  `getUserById` row.
- Grouping the aggregate by `user_id` alone instead of `(user_id, users.name)`
  is not a change: name is functionally dependent on the id.

One test improved rather than moved. `leaderboard.test.ts` used to
`vi.mock("@/lib/db/queries")` because importing the module pulled the app's
shared `db` handle in through `getBoard`. Inside the package there is nothing
to mock — the handle comes from the wiring slot — so the mock is gone. Same
assertions, one less lie. (Same causation note as `api-test` §4: dependency
injection did that, not the boundary. The boundary is what forced it.)

## 9. What I did NOT verify

Stated plainly, per recipe §9, because a migration that claims more than it
checked is worse than one that admits the gap.

- **No runtime click-through.** No request was made to
  `/api/v1/playground/leaderboard`, `/me` or `/progress` against a running app.
  The build resolving the route and the handler's own strings appearing in the
  emitted chunk is the strongest evidence here, and it is not the same thing.
- **No `pnpm db:push` against a dev database**, so the FK drop in
  `scripts/migrate.js` is unexercised. It is a copy of the launch path that has
  run before, with one table name added, but it has not run.
- **The deletion hook has never fired.** `onUserDeleted` is one statement and
  `manifests.test.ts` asserts the hook implements at least one target, but no
  account has actually been deleted through it. Same gap as every previous
  migration's hook.
- **No verification that the static lastest-www playground frontend still
  works** against this API. The response shapes are unchanged by inspection;
  nothing exercised them.
- **The 60s board cache is per-process and was not tested across a restart or
  a second worker.** Unchanged from before the migration — noted because the
  cache now sits inside a package and looks more like new code than it is.

## 10. For whoever migrates the next one

1. **Two independent ports agreeing is a stronger signal than either port's
   size.** §2. If the method you are about to declare already exists verbatim
   in another plugin's `host.ts`, write that down in your result doc — that
   sentence is the whole business case for the core capability that retires
   both.
2. **When you delete a join to a core table, check the join type.** §4. An
   `innerJoin` carries an existence predicate that is invisible in the column
   list, and losing it silently widens what your feature shows.
3. **A guard-rail core PR only gets written if you split it out.** §3.
   `onUserDeleted` was blocking, so it would have been written either way.
   `tenancy` was not, and bundled into this migration it would have been an
   afterthought or nothing.
4. **The framework is starting to pay.** §6. The second plugin of a shape costs
   materially less than the first. `share` and `gamification` are the same
   shape again; expect them cheaper still, and expect the `core/identity` case
   from §2 to be the thing actually worth building before them.
