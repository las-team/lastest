# Launch board migration — result

**Status:** done and building. `pnpm install`, `pnpm arch`, `pnpm lint`,
`pnpm types`, `pnpm test` (1665 passing) and `pnpm build` all pass.
**Recipe:** [`plugin-migration-recipe.md`](./plugin-migration-recipe.md).
**Phase:** the third plugin of RFC §9 phase 4, after
[`rca`](./rca-migration-result.md) and
[`app-map`](./app-map-migration-result.md).
**Not committed.**

---

## 1. The headline

`launch` is a workspace package. `plugins/launch/package.json` lists five
dependencies — `@lastest/contracts`, `@lastest/core-data`, `@lastest/kernel`,
`drizzle-orm`, `uuid` — and no `playwright`, no `@lastest/db`, no
`@lastest/pool-service`, no AI SDK. There is no `@/…` import anywhere under
`plugins/launch/`. `pnpm arch` reports **0 violations in the target layout**.

The moved surface, ~2,800 LOC vertical:

| Was | Now |
| --- | --- |
| `src/lib/launch/time.ts` + `.test.ts` | `plugins/launch/src/domain/time.ts` |
| `src/lib/launch/velocity.ts` + `.test.ts` | `plugins/launch/src/domain/velocity.ts` |
| `src/lib/launch/analytics.ts` | `plugins/launch/src/domain/analytics.ts` |
| `src/lib/launch/serialize.ts` | `plugins/launch/src/domain/serialize.ts` |
| `src/lib/launch/gating.ts` | `plugins/launch/src/domain/gating.ts` |
| `src/lib/launch/cohort-engine.ts` + `.test.ts` | `plugins/launch/src/domain/cohort-engine.ts` |
| `src/lib/db/queries/launch.ts` (764 LOC) | `plugins/launch/src/data/queries.ts` |
| 7 `launch_*` tables in `packages/db/src/schema/growth.ts` | `plugins/launch/src/schema.ts` |
| `DEFAULT_LAUNCH` in the same file | `plugins/launch/src/config.ts` |
| `src/app/api/v1/launch/[...path]/route.ts` (681 LOC) | `plugins/launch/src/api/handlers.ts` |
| `src/lib/launch/oauth-config.ts` | **core** — `src/lib/auth/oauth-clients.ts` |
| `src/lib/launch/api-shared.ts` | **core** — `src/lib/auth/board-actor.ts` + `src/lib/http/board-responses.ts` |
| — | `plugins/launch/src/{index,host,wiring,deletion}.ts`, `src/data/db.ts`, `src/api/responses.ts` |

`src/lib/launch/` is gone. So is `src/lib/db/queries/launch.ts` and its line in
the `queries.ts` barrel. The app side keeps a 16-line route file that re-exports
four handlers.

**Burndown: 22 → 21.** One `cross-plugin` violation disappeared —
`src/lib/scheduling/scheduler.ts` imported `@/lib/launch/cohort-engine` and now
imports `@lastest/plugin-launch/cohorts`. §5 argues that this one number
understates and overstates the change at the same time.

---

## 2. The port is four methods, the smallest yet

| Plugin | Vertical LOC | Host port |
| --- | --- | --- |
| `rca` | ~1,400 | 6 |
| `app-map` | ~3,000 | 9 |
| **`launch`** | **~2,800** | **4** |
| `url-diff` | ~1,000 | ~22 → not migrated, reclassified as core |

The recipe's §1.5 rule — *"the cheap plugins are the ones that compute; the
expensive ones are the ones that coordinate"* — predicted this exactly, and
`launch` is the cleanest confirmation so far because it breaks the LOC
correlation in the *other* direction from `url-diff`. It is twice the size of
`rca` with two thirds of the port.

The reason is ownership. Launch owns its seven tables, its ranking maths, its
week-boundary arithmetic and its cohort state machine. Nothing it computes
belongs to core. What it needs from outside is only:

1. **`resolveActor`** — identity. A bearer token → a person. Credentials, so
   core (`core-scope.md` §2).
2. **`sourceIp`** — trusting `X-Forwarded-For` correctly. Every IP gate on the
   board rests on it.
3. **`rateLimit`** — a shared in-process limiter. Capacity.
4. **`resolveUserNames`** — the one genuine debt item. See §4.

Three of the four are boundaries that *should* stay on core's side of the line
permanently. Only the fourth is scaffolding. That ratio is new: `rca` had six
methods of which four were one missing capability, and `app-map` had nine of
which five were.

---

## 3. The new shape: a plugin with no tenant

**This is the finding worth carrying forward.** Every plugin before this one
held team- or repo-scoped data and reached it through
`runtime.contextFor(manifest, { repositoryId })`, which resolves a scope,
checks access, and hands back a `ctx` carrying `ctx.team`.

Launch has no tenant. It is a public directory: readers are anonymous, writers
are identified by a user id plus an OAuth scope, and its seven tables have no
`team_id` column to scope by. There is no repository, no plan, no entitlement.

So the plugin **never calls `contextFor` and never holds a `PluginContext`.**
It takes its `DataCapability` straight from the wiring slot:

```ts
// src/lib/core/runtime.ts — note the missing `runtime`
configureLaunch({ host: appLaunchHost, data: data.capability("launch") });
```

That is not a new mechanism. It is the route every plugin's *deletion hook*
already uses — a hook runs *because* a team was deleted, so it too has no scope
to build a context from, which is why `ExplorerWiring` and `A11yWiring` already
carry a `data` handle alongside `runtime`. Launch is the first plugin where
that path is the only one rather than the exception.

**What it costs, stated plainly.** `ctx.team` is the kernel's tenancy
assertion, and launch does not get one, so nothing in core is checking a tenant
on its behalf. Inventing a synthetic team to satisfy the signature would have
been strictly worse: a tenancy check that always passes reads exactly like a
tenancy check that works.

**What it does not cost.** The data boundary is untouched. The handle is the
schema-scoped one `core/data` built after validating the `launch_` prefix on
all seven tables, so the plugin reaches its own tables and nothing else. The
capability model turns out to decompose more finely than "you get a ctx or you
get nothing" — which is worth knowing before `share`, `gamification` and
`playground`, all of which have user-scoped surfaces.

### 3.1 The kernel should probably say so

Nothing in `PluginManifest` records that a plugin is untenanted. `capabilities:
["data"]` looks identical for `a11y` (team-scoped) and `launch` (not). Today
the only signal is that the composition root passes no `runtime`, which is a
convention, not a check. A future core PR could make it explicit — a `scope:
"tenant" | "global"` field that `contextFor` refuses for the latter. Not doing
it here: it is core, and it is speculative until a second untenanted plugin
exists.

> **Resolved.** The second untenanted plugin is
> [`playground`](./playground-migration-result.md), and the field landed first
> as its own commit (`d26add04`), spelled `tenancy: "team" | "none"`. It went
> further than proposed here: `resolveRegistry` rejects any capability but
> `data`, any `provides` and any job handler for such a plugin, and
> `buildContext` — not just `contextFor` — throws `UntenantedPluginError`,
> because `dispatch` builds a context too and one guard on the shared path
> cannot be routed around later. `plugins/launch/src/index.ts` now declares
> the field; nothing about launch's behaviour changed.

---

## 4. `onUserDeleted` — the core PR this needed first

The blocking discovery, found while writing the schema.

Four of launch's tables carried `REFERENCES users(id) ON DELETE CASCADE`, and a
fifth `ON DELETE SET NULL`. That is how a deleted account's votes, comments and
reactions used to disappear. `core-scope.md` §6 removes FKs from plugin tables
to core tables — so those cascades had to be replaced by a deletion hook.

Except `DeletionHook` had exactly two members:

```ts
onTeamDeleted?(teamId: string): Promise<void>;
onRepoDeleted?(repoId: string): Promise<void>;
```

Every plugin before this held tenant-scoped rows, so the two targets covered
everything. Launch's rows belong to a *person*, and deleting a user does not
delete their team — no team hook would ever fire for them. Migrating without
noticing would have shipped a **GDPR regression**: rows that a database cascade
used to remove, silently surviving a "delete my account" on a public board.

So the migration was blocked on a core change, which landed first as its own
commit — RFC §7.2's workflow doing precisely what it exists for:

- `DeletionHook.onUserDeleted?(userId)` — `core/contracts`
- `DeletionTarget.kind` gains `"user"`, and `runDeletionHooks` selects on it —
  `core/data`
- `queries.deleteUser()` calls `cascadePluginDeletion({ kind: "user", id })` —
  the app's query layer, the same one-line structural fix `deleteTeam` and
  `deleteRepository` already had
- three tests: hook selection in `core/data`, the wiring assertion in
  `deletion-cascade.test.ts`, and a new registry test (§6)

**`deleteUser` did not cascade to plugins at all before this.** No plugin owned
user-scoped rows, so nothing was broken — but the call site did not exist, and
the next plugin to own them would have hit the same wall. It exists now.

### 4.1 What the hook does *not* delete

`launch_profiles` rows survive. The FK was `ON DELETE SET NULL`, so a
submission has always outlived its submitter — the board keeps showing a
featured app after the founder closes their account. `onUserDeleted` nulls
`submitted_by_user_id` and leaves the row, which is the pre-existing behaviour,
not a decision this migration made.

Votes, comments and reactions are deleted, and every affected profile's
denormalized `upvote_count` is recomputed. The database used to do the first
half of that and *not* the second: a raw `ON DELETE CASCADE` removed the vote
rows and left `upvote_count` stale until the next `recomputeUpvoteCount`. **The
hook is stricter than the FK it replaces.**

---

## 5. Two modules named after a feature that were not the feature's

`plugin-migration-recipe.md` §5 says the test for "is this shared logic" is
mechanical: read the import list, not the directory name. Two modules under
`src/lib/launch/` failed that test in opposite directions, and both moved to
**core** in the same pre-migration commit.

**`oauth-config.ts` → `src/lib/auth/oauth-clients.ts`.** It holds the
redirect-URI allowlist for `/oauth/authorize` — the only thing between a
fragment-delivered bearer token and an open-redirect token leak — plus the
client → scope map that decides what a minted token may do. Three clients are
registered and two of them are not the launch board (`playground-www`, `www`).
That is `core-scope.md` §2's credentials clause, and it was sitting in a
feature directory because the launch board happened to need it first.

`DEFAULT_LAUNCH.tokenTtlSeconds` and `DEFAULT_LAUNCH.scope` went with it: the
playground's and the marketing site's token lifetimes were being defined by the
launch board's tunables object.

**`api-shared.ts` → `src/lib/auth/board-actor.ts` + `src/lib/http/board-responses.ts`.**
Already shared with `/api/v1/playground`, and it *split*. The identity half
(`resolveActor`, `hasScope`, `isAdmin`) is a boundary and went to core. The
`err`/`fail` response helpers are not — they are `NextResponse.json` with a
fixed body shape, and the shape is each board API's contract with its own
frontend. The tell was already in the code: `fail`'s doc comment had to
enumerate two features' failure codes. So the launch plugin declares its own
six-line copy and the playground keeps the other.

**This is why the burndown number is misleading in both directions.** It
dropped by one, but two modules left the feature and became reviewable core;
and the one violation it did count (`scheduling → launch`) was resolved by a
package import, not by removing the coupling — the scheduler still calls into
launch, it just does so across a declared boundary. It should become
`ctx.jobs` when `scheduling` migrates.

---

## 6. A gate that was missing, found by this migration

`resolveRegistry` and `core/data`'s namespace validation already refuse to boot
a bad plugin set. **Nothing called them outside `getPluginRuntime()`**, which
needs a database — so the registry's validity was only ever proven by starting
the app. A `launch_` prefix typo across seven tables, or a `deletion` object
with no methods on it, would have passed `pnpm build` and `pnpm test`.

`src/lib/core/manifests.test.ts` now runs those checks in CI. Four assertions:
the registry resolves, ids are unique, every plugin table is namespaced to its
own plugin, and every plugin with storage has a hook that implements at least
one target. The last one closes a real hole — `resolveRegistry` asserts a
`deletion` *object* exists but cannot assert it has any method, and an empty
hook is indistinguishable from a missing one at deletion time
(`runDeletionHooks` just reports the plugin as `skipped`).

`MANIFESTS` is import-safe by design — that is why it was split out of the
`server-only` `runtime.ts` — so the test needs no database.

---

## 7. The one behaviour change: comment author names

`getCommentsForProfile` used to `leftJoin(users, …)` to fetch `users.name`. A
plugin may not read a core table at all (`core-scope.md` §6), not even for a
display name, so the join is gone. `CommentRow` no longer carries `authorName`;
`serializeComment(row, authorName, viewerUserId)` takes it as an argument, and
the handler resolves a batch through `LaunchHost.resolveUserNames` before
serializing.

- **Same output.** A missing user yields `null`, which is what the left join
  produced for them too.
- **One extra round trip per response containing comments**, batched by
  `inArray` over the distinct author ids. Not an N+1.
- `queries.getUsersByIds` is new in `src/lib/db/queries/auth.ts` — the app-side
  half.

This is the port method that is plainly debt. It wants to be
`ctx.identity.names()`, or to disappear entirely if the board ever stores a
display name of its own.

---

## 8. Schema move: seven tables, no rename, no backfill

The tables already carried the `launch_` prefix, so `core/data`'s namespace
rule was satisfied without renaming anything — no drop/recreate risk, unlike
the a11y migration which had to add two NOT NULL columns first.

What changes at the database level:

- **five FKs to `users(id)` dropped.** `scripts/migrate.js` gains
  `dropLaunchUserForeignKeys()`, which finds them by catalogue lookup rather
  than by name (the names were created implicitly and differ per environment)
  and drops them before `drizzle-kit push --force`.
- **FKs *between* launch tables stay.** `profile_id REFERENCES
  launch_profiles(id) ON DELETE CASCADE` breaks no rule — both sides are
  plugin-owned — and it still does real work, which is what keeps the deletion
  hook small.
- **two indexes added.** `idx_launch_profiles_submitter` and
  `idx_launch_reactions_reactor`. Both back lookups the deletion hook now
  performs by user id, which were index-free scans while the FK made them rare.

`drizzle.config.ts` already globs `plugins/*/src/schema.ts`, so `pnpm db:push`
picks the tables up from their new home with no config change.

---

## 9. What I did NOT verify

Be suspicious of everything in this section.

- **No runtime exercise whatsoever.** The app was never started. Nothing hit
  `/api/v1/launch/cohorts/current`, submitted a profile, cast a vote, posted a
  comment, or ran `/oauth/authorize`. `pnpm build` proves Next.js resolves and
  registers the four re-exported route handlers across the package boundary
  (`ƒ /api/v1/launch/[...path]` appears in the route table and the plugin's
  handler code is in the emitted chunk); it proves nothing about a request
  being served correctly.
- **`resolveActor`'s header-only stand-in is the least-tested thing here.**
  `appLaunchHost.resolveActor` builds a `{ headers: new Headers(...) }` object
  and casts it to `NextRequest`, because the plugin has no request to hand over
  and should not be given one (it carries cookies). `board-actor.resolveActor`
  only reads `request.headers.get("authorization")` before falling back to
  `getCurrentSession()`, so the cast is sound *as that function is written
  today* — and it is a cast, so it will not fail loudly if that function starts
  reading something else. **If you exercise one thing by hand, make it a
  bearer-token mutation and a staff-cookie mutation.**
- **`onUserDeleted` has never run.** The hook is unit-covered only in the sense
  that `core/data`'s selection logic is tested; `deleteUserData` itself has no
  test and has never touched a database. It is the GDPR path, so it is the
  second thing to exercise by hand.
- **No `db:push` was run.** The seven tables moved packages, five FK drops and
  two index creations are pending. `dropLaunchUserForeignKeys()` was written
  against the catalogue but never executed. Run `pnpm db:push` against a dev
  database and read the plan before trusting it.
- **The build-time snapshot script was not run.** `scripts/build-launch-data.mjs`
  (in the frontend repo) reads `GET /cohorts?include=profiles` and depends on
  the *flat* payload shape. `flatCohortPayload` moved unchanged, but nothing
  re-checked its output against that consumer.
- **`pnpm test:integration` was not run** — it needs a database and a pool
  service.
- **Emoji reaction handling was moved, not re-verified.**
  `LAUNCH_CONFIG.allowedReactions` contains multi-code-point emoji (`❤️`); the
  `includes` check is a straight port, but no test covers it.
- **The pre-existing `a11y`, `design-system` and `explorer` package
  typechecks still fail** (their `tsconfig` `lib` lacks `DOM` while
  `@lastest/shared` needs it). Unrelated to this migration, and `plugins/launch`
  typechecks clean.
