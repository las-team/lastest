# Gamification ("Beat the Bot") migration — result

> **Superseded in part (wiring-shape collapse):** the `host`+`data`-only
> wiring this doc describes gained a `runtime` — the session paths
> (`getViewerGamificationSnapshot`, the `onTestCreated` listener) resolve
> "who is calling" through `contextFor()` + `ctx.actor`, retiring the host's
> `currentActor` method (9 → 8). `awardScore`'s caller-attested `teamId`
> contract is unchanged. See recipe §4.1 and
> `plugins/gamification/src/wiring.ts`.

**Status:** done and building. `pnpm install`, `pnpm arch`, `pnpm lint`,
`pnpm types`, `pnpm test` and `pnpm build` all pass.
**Recipe:** [`plugin-migration-recipe.md`](./plugin-migration-recipe.md).
**Phase:** the sixth plugin of RFC §9 phase 4, after
[`rca`](./rca-migration-result.md), [`app-map`](./app-map-migration-result.md),
[`launch`](./launch-migration-result.md),
[`api-test`](./api-test-migration-result.md) and
[`playground`](./playground-migration-result.md).
**Committed** as two commits — core first (`17ef7663`), migration on top
(`eb174e18`). The §7.2 split.
**Burndown: 21 → 20.**

---

## 1. The headline

`gamification` is a workspace package. `plugins/gamification/package.json` lists
`@lastest/contracts`, `@lastest/core-data`, `@lastest/kernel`, `@lastest/ui`,
`drizzle-orm` and `uuid` — no `playwright`, no `@lastest/db`, no
`@lastest/pool-service`, no AI SDK. There is no `@/…` import anywhere under
`plugins/gamification/`. `pnpm arch` reports **0 violations in the target
layout**, and the current-layout count drops from 21 to 20.

The moved surface, ~2,300 LOC:

| Was | Now |
| --- | --- |
| `src/lib/gamification/rules.ts` | `plugins/gamification/src/domain/rules.ts` |
| `src/lib/gamification/hooks.ts` | `plugins/gamification/src/actions.ts` (`onTestCreated`) |
| `src/lib/db/queries/gamification.ts` (555) | `src/data/queries.ts` + `src/domain/leaderboard.ts` |
| `src/server/actions/gamification.ts` (576) | `src/actions.ts` (shell) + `src/domain/scoring.ts` (engine) |
| `src/components/gamification/user-score-chip.tsx` | `src/ui/user-score-chip.tsx` |
| `src/components/gamification/celebration-listener-client.tsx` | **split** — §6 |
| six tables in `packages/db/src/schema/growth.ts` | `src/schema.ts`, five of them renamed — §4 |
| — | `src/{index,host,wiring,deletion,reads}.ts` |

**The build is the evidence, not the claim.**
`server-reference-manifest.json` carries **9 action ids** whose module is
`plugins/gamification/src/actions.ts`, matching the 9 exported actions exactly.

## 2. Port size: 9, and four of them are the same missing capability

Costed before starting, per recipe §1.5.

| # | Method | Group | Retired by |
| --- | --- | --- | --- |
| 1 | `currentActor` | identity | `core/identity` |
| 2 | `requireTeamAdmin` | identity (authorization) | `core/identity` |
| 3 | `resolveActorProfiles` | identity (display data) | `core/identity` |
| 4 | `listTeamMemberIds` | identity (membership) | `core/identity` |
| 5 | `isEnabledForTeam` | a flag on `teams` | `ctx.team.entitlements` |
| 6 | `setEnabledForTeam` | authorized write to `teams` | `ctx.team` |
| 7 | `getTestCreator` | core entity read | `ctx.tests` |
| 8 | `stampTestCreator` | authorized write to `tests` | a widened `ctx.tests` |
| 9 | `emitActivityEvent` | delivery | `ctx.events` — **blocked**, §3 |

Measured ports: `playground` 3, `launch` 4, `api-test` 5, `rca` 6,
`app-map` 9, `gamification` **9**, `url-diff` ~22 (never migrated).

**`core/identity` is now the answer to seven port methods across three
plugins.** `launch` needed `resolveActor` + `resolveUserNames`, `playground`
needed the same two, and this needs four more shapes of the same thing. That
is no longer a pattern worth noting in a result doc — it is a costed, specific
piece of work with a known payoff, and it should be built before `share`,
which has the same user-scoped surface and will otherwise write a fourth copy.

### 2.1 Two methods shaped so the check cannot be skipped

`requireTeamAdmin()` **returns the authorized team id** rather than a boolean.
Every admin action in `plugins/gamification/src/actions.ts` starts from that
return value, so there is no team id in scope to act on until the check has
passed — "forgot the authorization check" is a `undefined` and a type error,
not a security hole. Same move `api-test` made by putting
`requireRepoCapability` *inside* `createTest`, applied to a read of the caller
rather than a write.

`resolveActorProfiles` gets its own core query (`getUserProfilesByIds`) rather
than widening the `getUsersByIds` the board APIs use. Those boards are
**public**, this one is not, and the two disclosure rules differ: the
leaderboard falls back to a user's email when they have no display name.
Widening the shared function would have made email reachable from a public
endpoint by whoever added the field.

## 3. `ctx.events` exists, this plugin wants it, and it cannot have it

The most useful thing this migration found.

`@lastest/plugin-events` provides an `events` capability, and Beat-the-Bot is
the first migrated feature that genuinely wants it — every award writes an
activity row. It ended up as a host method instead, and the reason is a real
gap rather than an oversight.

A capability is built from a `ContextScope`, which the kernel obtains from
`resolveScope`. `awardScore()` is called from six app call sites that already
hold an authorized `teamId` and pass it in — a diff approved, a review todo
resolved, a build finishing. But `ScopeRequest.teamId` is documented in
`core/kernel/src/runtime.ts` as **background paths only**, trusted precisely
because core's scheduler and job worker are the only callers that set it:

> honouring it from a user request would be a tenancy escape, which is the one
> thing this whole exercise exists to prevent.

So taking `ctx.events` here meant either threading a request-supplied `teamId`
through `contextFor` — the exact escape that comment forbids — or inventing a
session-derived scope that the six callers do not all have (some run in the
background).

**What is missing is a way for `resolveScope` to accept a team the caller has
already authorized, distinct from one it is asked to trust blindly.** That is a
kernel change with a security argument attached, so it is emphatically not
something to bundle into a feature migration. Recorded here, declared in
`plugins/gamification/src/host.ts`, and the reason the manifest says
`capabilities: ["data"]`.

The same gap is why this plugin, though thoroughly tenanted, takes its
`DataCapability` from the wiring slot the way `launch` and `playground` do. The
difference is worth stating: those two have no tenant, this one has a tenant it
is *given* rather than one it resolves. Tenancy is enforced by the six callers'
own `requireTeamAccess()`, exactly as before the migration — preserved, not
introduced.

## 4. The first migration that had to rename tables

Five of six were not `gamification_`-prefixed, and `core/data`'s
`validateSchemaNamespace` refuses to boot without it:

```
bots             -> gamification_bots
bug_blitz_events -> gamification_bug_blitz_events
score_events     -> gamification_score_events
user_scores      -> gamification_user_scores
achievements     -> gamification_achievements
```

Every previous migration got the prefix for free. `launch_*`, `a11y_*`,
`explorer_*` and `playground_achievements` were already namespaced, and "no
rename, no backfill, no drop/recreate risk" had started to read like a property
of the process. It was luck.

**`drizzle-kit push` cannot see a rename.** It compares names, finds `bots`
absent from the schema and `gamification_bots` missing from the database, and
resolves that by dropping the first and creating the second. Every score,
achievement and bot row in the product would go with it.
`migrateGamificationTables()` in `scripts/migrate.js` does the `ALTER TABLE …
RENAME TO` first, following the `EXPLORER_RENAMES` precedent — idempotent,
skipping a destination that already holds rows and dropping one that a prior
`push` left behind empty.

Two of the old names are worth pausing on. **`achievements` and `user_scores`
are generic enough to read like core concepts.** They never were. That
ambiguity is precisely what the prefix rule exists to remove, and it is a
better argument for the rule than "namespaces prevent collisions".

## 5. The core PR: core was calling this feature

`createTest()` in `src/lib/db/queries/tests.ts` ended with:

```ts
import("@/lib/gamification/hooks").then((m) => m.onTestCreated(id, …))
```

Core reaching into a feature — the one direction RFC §3 forbids outright, and
**invisible to `pnpm arch`, which walks plugin imports rather than core's**.
The strongest coupling in this feature was the one nothing counted. The dynamic
`import()` was not hiding it deliberately (it broke a
queries → hooks → auth → queries module cycle) but the effect was identical.

The inversion: core declares the port (`src/lib/db/test-hooks.ts`), the
composition root fills it inside `getPluginRuntime()`, and
`src/instrumentation.ts` already awaits that at boot — so no `createTest` can
outrun the registration. A listener rather than moving the call to the callers
because `createTest` has ~30 call sites; threading it through each would be a
rewrite (RFC §2) and would drop attribution wherever one was missed.

### 5.1 The same PR removed a would-be cross-plugin edge

`getBotByKind` had four callers. Three (`ai.ts`, `play-agent.ts`, the v1 API
route) are unclassified app code and may import a plugin. The fourth was
`src/server/actions/qa-agent.ts` — a **future plugin**, so after this migration
it would have held a `plugin → plugin` import, and one the walker's `@/…`
patterns would not have caught either.

Rather than count it, the core PR removed it: `createTest` gained
`createdByAgent?: BotKind`, so a caller that knows *which agent it is* passes
the kind and the listener resolves the per-team bot row on the side of the
boundary that owns the table. `qa-agent` no longer references gamification at
all. `BotKind` moved to `schema/shared.ts` because it names core's agents, not
gamification's rows.

**Worth generalising: when a migration would create a cross-plugin edge, ask
whether the edge is real before deciding how to count it.** Here the consumer
did not want a bot row, it wanted to say who authored a test — and the honest
version of that sentence has no bot in it.

### 5.2 And it surfaced a relative-import hazard

`src/server/actions/play-agent.ts` held `import { awardScore } from
"./gamification"` — a relative cross-feature import, exactly the blind spot
recipe §1.5's counting hazard 1 describes. It went uncounted because
`play-agent` is not a pseudo-plugin, so no rule applied to it in either
direction. Found by `pnpm types` after the file it pointed at was deleted,
which is the only reason it was found at all.

## 6. Two UI components, two different answers

`user-score-chip.tsx` moved wholesale — `cn` came from `@lastest/ui`, and its
one action import became a relative one.

`celebration-listener-client.tsx` could not: it reads the app's
`ActivityFeedProvider` React context. It **split** along the line recipe §6
draws. The plugin owns `CelebrationToasts({ events, historyLoaded })` — which
events deserve a toast, and what each one says, which is entirely this
feature's business. The app keeps a nine-line wrapper beside the provider it
belongs to, supplying the context. A `satisfies readonly CelebrationEvent[]`
in the wrapper is the assertion that the plugin's narrowed event type still
matches the feed's real one (§6.1's "narrow, don't promote" — it is not this
feature's type).

## 7. The deletion hook is a bug fix, not a replacement

Every previous result doc framed its hook as replacing an `ON DELETE CASCADE`
that `core-scope.md` §6 removed. **That framing does not apply here and would
be flattering.** These six tables carried *no* FK to `teams` or `users` before
the move — `team_id` was already a convention-only reference, one of the 104 the
schema graph counted (§7 of `core-scope.md`).

So deleting a team already left every score event, every achievement and every
bot row behind, and had done since the feature shipped. `onTeamDeleted` fixes
that. `core-scope.md` says convention-only references are "the existing norm
here, not a novelty" — the price of that norm is exactly this: nobody notices
until something forces an inventory.

## 8. A new S1 trap: `export type` in a `"use server"` module

`plugins/gamification/src/actions.ts` briefly re-exported two types for
convenience:

```ts
export type { AwardInput, AwardResult };
```

The production build failed on **every page**:

```
Export AwardInput doesn't exist in target module
The export AwardInput was not found in module [project]/plugins/gamification/src/actions.ts
```

Next.js assigns an action id per export name *before* types are erased, then
cannot resolve the resulting import. `pnpm types` passes. `pnpm lint` passes.
Only `pnpm build` catches it — which is the recipe's own §8 claim ("`pnpm build`
is the one that matters") earning its place for the second time.

This is a sibling of the known trap that `export { x } from "./y"` inside a
`"use server"` file compiles to a module with *no* exports. The rule that covers
both: **a `"use server"` module exports async functions and nothing else.**

## 9. Why `awards` did not come along

The `gamification` entry in `tools/architecture/boundaries.mjs` bundled
`src/lib/gamification` *and* `src/lib/awards`. Reading their import lists
before costing anything (recipe §9's `launch` lesson) showed the two share
**no import in either direction** — the map entry was a guess based on both
sounding like "points and prizes".

They are different shapes. Beat-the-Bot computes over its own tables. Awards
computes repo tiers from **build, testRun, test and visualDiff history**, plus
`public_shares`, which belongs to `share`. Costed at ~8 methods, six of them
core aggregate reads and one a cross-feature read that wants `share` migrated
first. So the entry is now `awards: { lib: ["src/lib/awards"], … }` and it stays
in `src/` as its own future plugin.

## 10. What I did NOT verify

Per recipe §9, because a migration that claims more than it checked is worse
than one that admits the gap.

- **No runtime click-through.** Nothing loaded `/leaderboard`, toggled
  gamification in settings, started a season or a bug blitz, or watched a
  celebration toast fire. The build resolving 9 action ids is not the same
  thing.
- **The table renames have never run.** `migrateGamificationTables()` is a copy
  of a pattern that has run before, but this instance has not, against any
  database. **This is the highest-risk unverified item in any phase-4 migration
  so far** — a rename that silently no-ops leaves `push` free to drop the old
  tables. Run `pnpm db:push` against a scratch database with rows in `bots` and
  `score_events` before this reaches an environment that matters.
- **`onTestCreated` has not fired.** The whole registration path —
  `createTest` → `notifyTestCreated` → the composition root's listener →
  `awardScore` — is exercised by nothing but the type checker.
- **The deletion hook has never fired.**
- **No unit tests were added**, and `domain/scoring.ts` is now trivially
  testable with two stubs (that separation is the one genuine improvement here
  beyond the move — the pre-migration engine could only be reached through
  Next.js's action dispatcher against a live database, which is why it had
  none). Not writing them was a scope decision, and it leaves the feature's
  entire business logic uncovered.
- **The `p2-spot-checks` integration suite was edited but not run** — it needs
  a database. Its season create/end round trip is gone, replaced by a
  leaderboard read against an unknown season id.

## 11. For whoever migrates the next one

1. **Check whether *core* imports the feature**, not just what the feature
   imports. `pnpm arch` does not look. `grep -rn '<feature>' src/lib/db
   src/lib/execution src/lib/eb` before costing anything — a core→feature edge
   is a blocking core PR, and it is the one the burndown cannot see.
2. **`export type { … }` in a `"use server"` module breaks the build.** §8.
   A `"use server"` module exports async functions and nothing else.
3. **Check your table names against the `<id>_` rule before you plan.** §4.
   Five of six needed renaming here, and a rename is a `scripts/migrate.js`
   change that `drizzle-kit push` will happily do wrong.
4. **A hook is not always replacing a cascade.** §7. Check whether the FK
   existed before claiming you preserved it.
5. **When a migration would create a cross-plugin edge, ask whether the edge is
   real.** §5.1. `qa-agent` did not want a bot row; it wanted to say who
   authored a test.
6. **Read both halves of a bundled map entry.** §9. `gamification` and `awards`
   shared nothing but a theme.
