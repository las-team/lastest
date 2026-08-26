# Scheduling migration — result

**Status:** done and building. `pnpm install`, `pnpm arch`, `pnpm lint`,
`pnpm types`, `pnpm test`, `pnpm build` and `pnpm format:check` all pass.
**Recipe:** [`plugin-migration-recipe.md`](./plugin-migration-recipe.md).
**Phase:** the thirteenth plugin of RFC §9 phase 4.
**Not committed.**

---

## 1. The headline

`plugins/scheduling/package.json` lists five real dependencies
(`@lastest/analytics`, `@lastest/contracts`, `@lastest/core-data`,
`@lastest/cron`, `@lastest/kernel`, plus UI deps) and no `playwright`, no
`@lastest/db`, no `@lastest/pool-service`. There is no `@/…` import anywhere
under `plugins/scheduling/`. `pnpm arch` reports **0 violations in the
target layout**, and the current-layout burndown went **14 → 13** —
`scheduling`'s one counted `cross-plugin` violation is gone, not moved.

Costed against recipe §1.5 before starting: **1 host method**
(`triggerBuild`) — the same tier as `ranger`, the cheapest migration so far.
Every read and write the feature performs is against its own table; the only
thing core does that this feature cannot is create and run a build.

| Was | Now |
| --- | --- |
| `src/server/actions/schedules.ts` (177 LOC) | `plugins/scheduling/src/actions.ts` (185 LOC) |
| `src/lib/db/queries/schedules.ts` (93 LOC) | `plugins/scheduling/src/data/queries.ts` (103 LOC) |
| `src/components/settings/schedule-manager-client.tsx` (318 LOC) | `plugins/scheduling/src/ui/schedule-manager.tsx` (318 LOC, `@/components/ui/*` → `@lastest/ui`) |
| `build_schedules` in `packages/db/src/schema/runs.ts` | `scheduling_build_schedules` in `plugins/scheduling/src/schema.ts` |
| `src/lib/auth/ownership.ts`'s `requireScheduleOwnership` | inline in `actions.ts`'s `mustOwn` (see §3) |
| `src/lib/scheduling/scheduler.ts` (193 LOC) | `src/lib/core/scheduler.ts` (192 LOC) — **reclassified as core, not migrated** (see §2) |
| `src/lib/scheduling/cron.ts` (shim) | deleted; the plugin imports `@lastest/cron` directly |

## 2. `scheduler.ts` was never this feature — the real finding

The old map entry (`PSEUDO_PLUGINS["scheduling"]`) listed
`src/lib/scheduling` as `lib` and `schedules.ts` + `scanner.ts` as
`actions`. Reading `src/lib/scheduling/scheduler.ts`'s own import and
consumer lists (recipe §1.6) found it was never the build-schedule feature's
file at all, despite sitting next to `cron.ts` by directory convention:

- Three of its four tick handlers dispatch *other* plugins' triggers —
  `processLaunchCohorts` (`@lastest/plugin-launch/cohorts`, static import)
  and `dispatchDueExplorerTriggers` (`@lastest/plugin-explorer/actions`,
  dynamic import). Only `processDueSchedules` was genuinely this feature's
  own.
- `core/jobs/src/worker.ts` already documented this file, in someone else's
  package, before this migration existed: *"Not the interval itself.
  `src/lib/scheduling/scheduler.ts` already owns a single 60-second-tick loop
  pattern for **this app**."*
- `plugins/launch/src/domain/cohort-engine.ts` calls it exactly that too:
  *"`processLaunchCohorts()` is the plugin's one exported entry point that
  **the app** calls on a timer."*

Two already-migrated plugins depend on this file as their scheduling
infrastructure. That is not a feature calling a shared helper — it is the
composition root's own tick loop, misfiled under a feature directory before
any of this existed. §1.6 lists three resolutions (invert / reclassify /
stop); this is a "reclassify," the `ci` shape, except the destination is not
"leave in place + add to `CORE_SRC_PATHS`" (there was no legitimate
directory for it to stay in as `src/lib/scheduling/scheduler.ts`). It moved
to `src/lib/core/scheduler.ts` — the composition root, the one place already
allowed to import every plugin, which is what it has effectively been doing
since before `launch` and `explorer` existed. `src/lib/core/*` carries no
`CODEOWNERS` gate today (no `-host.ts` file does either — a pre-existing gap
this migration did not introduce or fix), so this needed no new entry in
`CORE_SRC_PATHS` or `.github/CODEOWNERS`.

Only `processDueSchedules` changed in substance, and only because it now has
a plugin to call into: it is `processDueBuildSchedules` in the new file,
wiring the runtime and calling `dispatchDueSchedules()` from
`@lastest/plugin-scheduling/actions` — the exact call shape
`processDueExplorerTriggers` already used for `dispatchDueExplorerTriggers`.
The other three handlers (`processDueQaTriggers`,
`processDueExplorerTriggers`, the `processLaunchCohorts` call) moved
unchanged, byte-for-byte apart from the one renamed function.

One consequence worth being explicit about: the old `processDueSchedules`
logged a `console.log`/`console.error` line per schedule (name +
build id, or name + error). `dispatchDueSchedules()` has no `ctx.log` (see
§3) and logs nothing per item — it returns a fired count, and
`processDueBuildSchedules` logs one aggregate line, the same shape
`processDueExplorerTriggers` already used for explorer triggers. This is a
real, if minor, behaviour change: per-schedule failure detail no longer
appears in the scheduler's own log lines (it is still recorded in the row's
`consecutiveFailures` column). Flagged here rather than silently dropped.

## 3. `scanner.ts` was never this feature either

The old map entry's second action module, `scanner.ts` (327 LOC), shares no
table, type or import with `schedules.ts`/`cron.ts` in either direction. It
is repository route discovery (`RemoteRouteScanner` from the already-promoted
`@lastest/route-scan`), functional-area creation, and smoke-test generation
— all against core's `routes`/`functionalAreas`/`tests` tables via
`requireRepoAccess` and roughly 25 distinct `queries.*` calls, well past
recipe §1.5's ~15-method stop line. It never belonged to this feature; it
sat beside it by directory convention only, the same finding `data-sources`
made for `spec-import.ts`. Left as its own uncosted
`PSEUDO_PLUGINS["route-scan"]` entry in `tools/architecture/boundaries.mjs`
rather than migrated with `schedules.ts` or silently dropped from the
burndown.

## 4. The host port and where authorization went

**`SchedulingHost` has one method:**

```ts
triggerBuild(input: SchedulingTriggerInput): Promise<SchedulingTriggerResult>;
```

wrapping `createAndRunBuildFromCI` (`src/server/actions/builds.ts` — "builds
*is* the product," §6.1). `src/lib/core/scheduling-host.ts` is the first
host to declare this method; nothing existing could be reused.

Every user-invoked action used to open with `requireRepoAccess(repositoryId)`
and, for updates, `requireScheduleOwnership(id)` — a core helper in
`src/lib/auth/ownership.ts` that read `queries.getBuildSchedule` directly.
Once `build_schedules` became this plugin's own table, keeping that helper in
core would have meant core importing a plugin to read it — the exact §1.6
edge `gamification` found in the other direction. `requireScheduleOwnership`
is deleted, not ported: `contextFor(schedulingPlugin, { repositoryId })`
replaces the repo-access half, and a two-line `mustOwn` helper in
`actions.ts` replaces the ownership half (read the row via `ctx.data`, check
`schedule.repositoryId === repositoryId`). Three surveyed symbols
(`requireRepoAccess`, `requireScheduleOwnership`, the manual `repositoryId`
comparison `updateScheduleAction`/`toggleScheduleAction` already did) became
one host method plus one inline check — the same shape `api-test`'s
migration found for its own ownership guards (recipe §3.1).

**Wiring:** `capabilities: ["data"]`, tenanted, wired *with* a `runtime` —
the `explorer`/`ci`/`ranger`/`data-sources` shape, not the
`gamification`/`awards`/`launch` "no runtime" one. The six user-invoked
actions call `contextFor(schedulingPlugin, { repositoryId })`;
`dispatchDueSchedules()` (the system tick) and the deletion hook take `data`
straight from the wiring slot, since neither has a session to build a
context from. Unlike `explorer`'s `dispatchDueExplorerTriggers`,
`dispatchDueSchedules` does not call `contextFor` per item either — creating
a build needs no `ctx.team`/`ctx.repo`, only the schedule row's own
`repositoryId`, already authorized when the schedule was created.

## 5. The action-id count found one dead action (recipe §8)

`server-reference-manifest.json` minted **5** action ids for
`plugins/scheduling/src/actions` against **6** exported functions before the
last commit; after deleting the dead one, 5 for 5, plus
`dispatchDueSchedules` (never dispatched from a client, same shape as
`dispatchDueExplorerTriggers`) correctly minting none. The gap was
`updateScheduleAction` — rename/re-cron an existing schedule without
delete+recreate. Grepping the repo (and reading the original
`schedule-manager-client.tsx` in full before this migration touched it)
confirms it had zero callers **before** the migration too: there was never an
edit UI, only create/toggle/delete/trigger. Recipe §8's exact "fewer, but not
zero" case — not the S1 re-export trap, a dead RPC endpoint — the same
finding `ci`'s migration made for three of its own exports. Deleted rather
than carried forward as unreachable, unauthenticated-by-default surface area.

## 6. The table rename and the FK it drops

`build_schedules` → `scheduling_build_schedules`, `core/data`'s `<id>_`
prefix requirement. One real FK to a core table
(`repository_id → repositories.id ON DELETE CASCADE`), which
`core-scope.md` §6 forbids a plugin from declaring — dropped by catalogue
lookup in `scripts/migrate.js`'s new `migrateSchedulingTables()`, the same
shape `migrateAwardsTables` uses (rename first, since `drizzle-kit push`
cannot see a rename and would otherwise drop-and-recreate the table empty,
taking every configured recurring run with it; then look up the FK by
`pg_constraint` under the new name, since implicitly-created constraint
names differ between environments).

No `team_id` column exists on this table — only `repository_id`, the same
shape `awards` has — so `deletion.ts` declares only `onRepoDeleted`, not
`onTeamDeleted`. Deleting a team deletes its repositories first (core's own
cascade), and each repo delete drives the hook, so team deletion is still
covered, one level removed. `src/lib/db/queries/repositories.ts`'s
`deleteRepository` cascade-list comment is updated to say so, the same way
`share`'s and `ci`'s migrations updated it for their own tables.

`builds.scheduleId` (a plain `text` column, never a real FK even before this
move) is untouched — grepped and confirmed it is set nowhere and read
nowhere in the app today. Pre-existing dead weight, not something this
migration needed to resolve.

## 7. A small bulk promotion this migration needed to proceed

`schedule-manager-client.tsx` imported `track`/`Events` from
`src/lib/analytics/{umami,events}.ts` — 48 lines total, zero imports beyond
`window.umami` globals, already listed in `UNCLASSIFIED_SRC_PATHS` as
"the RFC does not name this as core or a plugin." Recipe §5's mechanical
test (read the import list) says library, not feature: it is promoted to
`libs/analytics`, with `src/lib/analytics/{umami,events}.ts` left as
re-export shims — the same shape `src/lib/scheduling/cron.ts` already used
for `libs/cron` — so none of its 14 existing app-side consumers needed an
import change. The plugin itself imports `@lastest/analytics` directly, not
the shim. `"src/lib/analytics"` is removed from `UNCLASSIFIED_SRC_PATHS`
now that it has one.

This is the same shape recipe §5 warns against doing *inside* a migration
("that import becomes a host-port method... promotion deletes it") — except
here the promoted module was never a candidate for a host method in the
first place (a plugin has no way to call an app-side analytics tracker
through `ctx`), so there was no coupling-preserving alternative to reach
for. `explorer`'s pilot did the same thing for `libs/page-map`/`libs/cron`
for the same reason: the first plugin that needs a shared leaf dependency is
sometimes also the first to promote it.

## 8. Two test files moved, one rewritten

- `src/lib/scheduling/cron.test.ts` → `libs/cron/src/cron.test.ts`, import
  changed from `./cron` (the app shim) to `./index` (the lib itself) — it
  was always testing `@lastest/cron`'s behaviour through a re-export, never
  anything about the scheduling feature. `libs/cron` had no test file of its
  own before this; now it does, and gained a `vitest` devDependency to run
  it (matching `libs/test-templates`'s pattern — root `pnpm test` globs the
  whole repo, so this is what lets the file resolve `vitest` under pnpm's
  strict linking, not what discovers it).
- `src/lib/scheduling/scheduler.integration.test.ts` →
  `plugins/scheduling/src/scheduling.integration.test.ts`, rewritten to call
  `dispatchDueSchedules()` directly instead of replicating scheduler.ts's
  call sequence by hand. The old file's own header explained why it didn't
  call the sequence directly: `processDueSchedules` was unexported. It no
  longer is — `dispatchDueSchedules` is a real export now — so this follows
  the same pattern `plugins/explorer/src/explorer.integration.test.ts`
  already set for `dispatchDueExplorerTriggers`. Also added: a check that
  `scheduling_build_schedules` exists and `build_schedules` does not, the
  same rename-verification shape `explorer`'s integration test uses.
- `e2e/settings-ui.integration.test.ts` (a real-browser Playwright test,
  outside `src/`/`plugins/`, exempt from the plugin-boundary rules but still
  type-checked by root `pnpm types`) imported `buildSchedules` from
  `@/lib/db/schema` directly. Updated to import
  `schedulingBuildSchedules` from `@lastest/plugin-scheduling/schema`
  instead — the table object moved, the test's behaviour did not.

## 9. What I did NOT verify

Be suspicious of everything in this section.

- **No runtime exercise whatsoever.** The app was never started against a
  real database. Nothing clicked "Add Schedule" in a live browser, nothing
  waited for a real 60-second tick to fire a real build. `pnpm build` proves
  Next.js can resolve the moved code across the package boundary and that
  five of six actions mint real dispatchable ids (§5); it proves nothing
  about the settings page rendering correctly or a scheduled build actually
  running end to end.
- **No `db:push` and no `scripts/migrate.js` run against a real database.**
  `scheduling_build_schedules` has never been created for real, and the
  rename/FK-drop path in `migrateSchedulingTables()` has never executed
  against actual data. A live dev postgres is running in this environment
  (`docker compose ps` shows `lastest-dev-db` up), but running the migration
  against it was deliberately not attempted without asking first — it is a
  real, if reversible, schema mutation against the user's own dev database,
  and every prior migration in this series (`ranger`, `awards`,
  `data-sources`, …) recorded the identical gap rather than assume it was
  fine to just try. `core/data`'s `validateSchemaNamespace` (the
  `scheduling_` prefix check) and the deletion-hook-presence check both run
  inside `resolveRegistry`, which `src/lib/core/manifests.test.ts` exercises
  without a database — that passed (part of `pnpm test`) — but nothing here
  confirms the table actually migrates cleanly against Postgres, or that
  `migrateSchedulingTables()`'s catalogue-lookup FK drop finds the
  constraint it expects to find.
- **`scheduling.integration.test.ts` was never run.** It needs
  `pnpm test:integration`, a live pool service and a live EB — none
  available here. Written to the same shape as
  `explorer.integration.test.ts`/the file it replaces, not executed.
- **The dropped per-schedule log lines (§2) have no test.** Nothing asserts
  what `processDueBuildSchedules`'s aggregate log line looks like versus the
  old per-item lines; this is read from the code, not observed.
- **`libs/analytics`'s promotion (§7) was verified by `pnpm build` resolving
  every one of its 14 app-side consumers through the shim, and by `pnpm
  test` — not by loading a page and confirming a real Umami event fires.**
