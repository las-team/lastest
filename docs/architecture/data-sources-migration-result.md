# `data-sources` migration result (RFC §9 phase 4, plugin 12 of 13)

**Plugin:** `@lastest/plugin-data-sources`
**New libs:** `@lastest/csv`, `@lastest/google-sheets`
**Status:** code complete; gates run below. Not yet exercised against a real
Postgres instance or in a browser — see §8.

## 1. What moved, and what didn't

RFC §6.3 maps `data-sources` to `src/lib/csv`, `src/lib/google-sheets`, and
three action modules: `csv-sources.ts`, `google-sheets.ts`, `spec-import.ts`.
Reading the import lists (recipe §1.6) split it three ways, not one:

- **CSV/Sheets parsing + the Sheets REST client** — pure, zero `@/…` imports,
  caller-supplied token or in-memory bytes. Promoted to `libs/csv` and
  `libs/google-sheets` (recipe §5) *before* the plugin migration, in the same
  commit that repointed `src/lib/execution/executor.ts` and
  `src/lib/vars/resolver.ts` at them. Those two files are core, and
  `import { resolveSheetReferences } from "@/lib/google-sheets/resolver"` was
  a core→feature edge (recipe §1.6) sitting inside a pseudo-plugin nobody had
  graphed — `pnpm arch`'s walker only checks what *plugins* import, never what
  core does.
- **The Google Sheets OAuth token refresh** — a credential boundary
  (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`) — stayed core. It moved from
  `src/lib/google-sheets/api.ts` into `src/lib/core/data-sources-host.ts`
  rather than becoming a new `CORE_SRC_PATHS` entry, because it has exactly
  one caller. `github`/`gitlab` OAuth earned a `CORE_SRC_PATHS` line (and a
  CODEOWNERS line) because `ci`'s split found three *other* core modules
  importing it; this has none. The OAuth authorize/callback routes
  (`src/app/api/auth/google-sheets/{route,callback}.ts`) were never part of
  the pseudo-plugin's file list at all and did not move.
- **`spec-import.ts` was never this feature.** It shares no table, no type,
  and no import with csv/google-sheets in either direction — it is AI-driven
  user-story extraction and test generation (`generateWithAI`, `tests`,
  `test_specs`, `functional_areas`, `routes`, `agent_sessions`, background
  jobs, an embedded-browser claim, `@lastest/github`). A rough count of the
  distinct core calls it makes comes out past 20, well over recipe §1.5's
  stop line. Left in place, split into its own uncosted
  `PSEUDO_PLUGINS["spec-import"]` entry (`tools/architecture/boundaries.mjs`)
  rather than silently dropped from the burndown or crammed into this port.

What actually moved into `plugins/data-sources/`: `src/server/actions/
csv-sources.ts`, the data-source half of `src/server/actions/
google-sheets.ts` (the account/OAuth half stayed core), the two DB tables,
and six UI components (`csv-sources-settings-card`, `csv-data-browser`,
`google-sheets-settings-card`, `sheet-data-browser`, `sheet-data-preview`,
`sheet-reference-inserter`).

## 2. The host port is three methods, one credential boundary

```
googleSheetsAccessToken(teamId)   — resolve + auto-refresh the team's token
googleSheetsAccountInfo(teamId)   — display info for the settings card
disconnectGoogleSheets(teamId)    — delete the connected account
```

All three exist because `googleSheetsAccounts` is a core credential table —
the `CiHost.scmCredentials` shape applied to a different provider. Everything
else is a capability: `ctx.data` (the plugin's own two tables) and
`ctx.storage` (uploaded CSV bytes). No `requireRepoAccess`-style method either
— repo-scoped actions call `runtime.contextFor(dataSourcesPlugin,
{ repositoryId })` and `resolveScope` authorizes it (recipe §1.7, the
`explorer`/`app-map`/`ci` shape); the three account-level actions call it with
no scope request, falling through to `requireTeamAccess()`.

By recipe §1.5's table this is a **3**, tied with `rca`'s low end and cheaper
than most of phase 4 — but, per the `ranger` lesson, a low port count is not
the whole cost. This migration's real weight was elsewhere: working out that
the map was wrong (§1), and a capability gap that had nothing to do with the
host port at all (§3).

## 3. `storage` is new, and it exposed a gap `DeletionHook` was never built for

This is the **first** plugin to declare `capabilities: ["storage"]`. The
pre-migration code wrote uploaded CSV bytes to
`STORAGE_DIRS["csv-sources"]/<repositoryId>/<timestamp>_<name>` with raw
`fs.writeFile` — a plugin cannot import `fs`/`path`/`@/lib/storage/paths`
(rule 1), and the better answer was already sitting there: `ctx.storage` is
tenant-quota-checked, namespaced-by-`(teamId, pluginId)` blob storage, built
during the `playground`/`gamification` wave of this project but never
consumed. Each CSV source's bytes now live at the deterministic key
`csv/<id>` — no path column to persist or go stale, and quota enforcement
arrives for free.

That surfaced a real hole. `StorageCapability` is scoped to `(teamId,
pluginId)` at construction (`createStorageCapability(host, { pluginId,
teamId })`), which is fine inside a request — `ctx.storage` is built as part
of `buildContext` from the resolved `ContextScope`. A deletion hook has no
`ContextScope` (same reason every hook takes `ctx.data` straight from the
wiring slot instead of a built `PluginContext`), and nothing in
`core/storage` reaps a team's prefix when the team is deleted — there is no
`onTeamDeleted` inside the storage host itself, only the plugin-level
`DeletionHook` contract, which this is the first plugin to need for both a
table *and* a blob at once.

The fix (`plugins/data-sources/src/deletion.ts`) is the same shape
`data/db.ts` already uses for the table half: the wiring slot carries the raw
`StorageHost` (not a capability), and the hook builds a
`createStorageCapability(host, { pluginId: "data-sources", teamId })` once it
knows which team it is deleting for — which `onTeamDeleted(teamId)` and
`onRepoDeleted(repositoryId)` both eventually resolve (the latter by grouping
the repo's rows by `teamId` first, since a delete-by-repo hook is not itself
handed one). Delete is driven by each row's own id (`csv/<id>`) rather than
`storage.list("")`, so a future feature inside this plugin storing something
else under the same namespace can't be swept by an unrelated wildcard.

This is a real, if narrow, capability gap worth carrying into whichever
plugin next declares `storage` + `schema` together: **`core/storage` has no
team-prefix reaper, and a deletion hook has no route to a scoped
`StorageCapability` without the wiring slot carrying the raw host.** Neither
half is hard, but nothing generalizes it yet — the next plugin to hit this
writes the same `createStorageCapability(...)` call in its own `deletion.ts`
until it's worth a kernel-level `DeletionHook` argument instead.

## 4. Reverse read: core still needs the plugin's own data at test-run time

`src/lib/execution/executor.ts` — core, `CORE_SRC_PATHS` — resolves
`{{csv:...}}`/`{{sheet:...}}` references in test code before sending it to a
runner. It used to call `queries.getCsvDataSources(repositoryId)` /
`queries.getGoogleSheetsDataSources(repositoryId)` straight off the shared
`db` handle. Once those tables moved into `plugins/data-sources/src/
schema.ts`, that stopped being reachable (`core-scope.md` §6), and the
executor has no `PluginContext` to pull `ctx.data` from — it is the execution
substrate, invoked from many call sites that were never authorizing a
specific plugin's scope for a single test run.

Same shape as `share-reads.ts` (`awards`' migration): `plugins/data-sources/
src/reads.ts` already exposes plain, unscoped read functions — same route
every deletion hook takes, the handle comes from the wiring slot, not a
session. `src/lib/core/data-sources-reads.ts` re-exports them for the
executor to call, narrowed to `libs/csv`'s `CsvSourceLike` / `libs/
google-sheets`'s `SheetSourceLike` rather than the plugin's own
`CsvDataSource`/`GoogleSheetsDataSource` — the executor never needed `id` or
`teamId`, only the reference-resolution fields, so narrowing kept its import
graph pointed at libs instead of the plugin (recipe §6.1). Deliberately does
not import `./runtime` — `src/instrumentation.ts` already awaits
`getPluginRuntime()` before the server serves a request, so the plugin's
wiring is in place by the time the executor runs, and pulling in the
composition root here would be circular in spirit if not in fact.

One dead function was found and deleted rather than adapted:
`requireDataSourceOwnership` in `src/lib/auth/ownership.ts` called
`queries.getCsvDataSource` directly and had zero callers anywhere in the
repository — confirmed by grep before removal, the same check `recorder`'s
migration used to confirm `debug-recorder.ts` was dead.

## 5. Table rename, and the FK that was never there

```
csv_data_sources           -> data_sources_csv_sources
google_sheets_data_sources -> data_sources_google_sheets
```

The fourth-and-fifth rename in phase 4 (after `gamification`'s five and
`ci`'s two) — `scripts/migrate.js`'s `migrateDataSourcesTables()` does the
`ALTER TABLE … RENAME` before `drizzle-kit push`, for the same reason every
prior rename needed it: push cannot see a rename, only a dropped table and a
new empty one.

Both tables carried FKs into `teams`/`repositories` (plain, no `onDelete`
cascade — Postgres restrict is the default, and neither was declared with
one). `google_sheets_data_sources` additionally pointed at
`google_sheets_accounts`, the OAuth credential table, which stays core. All
three are dropped by catalogue lookup (`pg_constraint`, not by name — the
same reasoning `migrateCiTables` documents: implicitly-created constraint
names differ between environments). Unlike `ci`'s `restrict` FK on
`team_id -> teams.id`, neither of these was a behavior change to remove:
`restrict` was never hit in practice because nothing deleted a team or repo
through a path that didn't already reap the child rows first
(`deleteRepository`'s transaction, `deleteTeam`'s per-repo loop) — so this is
closer to `gamification`'s finding (convention-only reference) than `ci`'s
(a real, load-bearing constraint).

`packages/db/src/schema/settings.ts` (where both tables sat next to
`googleSheetsAccounts`, the credential row that stays) drops both table
definitions and their exported types. `src/lib/db/queries/repositories.ts`'s
`deleteRepository` transaction and `src/lib/db/queries/integrations.ts`'s
`deleteGoogleSheetsAccount` both had inline deletes against these tables;
both are removed with a comment pointing at the plugin's `onRepoDeleted`
hook, the same pattern the `ci_gitlab_pipeline_configs` removal from
`deleteRepository` already set. One small, deliberate behavior change:
`deleteGoogleSheetsAccount` used to delete every data source row tied to the
disconnected account. It no longer does — imported sheets are left in place
when you disconnect, the same way removing a GitHub App installation does not
delete a repo's CI config. Written down here rather than silently absorbed.

## 6. Storage is a behavior adaptation, not a straight move

RFC §2 calls this "a move, not a rewrite," and mostly it was — but the
storage half genuinely couldn't be a byte-identical move, because the
destination (`ctx.storage`) is a different primitive than the source (raw
`fs`). Concretely:

- `storagePath` (the persisted relative path) is gone from the schema
  entirely. The key is derived from the row's own `id` (`csv/<id>`), so
  there is nothing to persist or for a `sync` without a new upload to go
  looking for on disk versus in the DB.
- Quota enforcement is new, not preserved-and-relocated: the old code had no
  concept of a per-team storage ceiling for CSV uploads at all.
- `uploadCsvSource`/`syncCsvSource`/`deleteCsvSource` all call `ctx.storage.
  {put,get,delete}` instead of `fs.{writeFile,readFile,unlink}` — same
  control flow, different backend.

## 7. Gates

```
pnpm install --frozen-lockfile   # resolved: @lastest/csv, @lastest/google-sheets,
                                  # @lastest/plugin-data-sources — no forbidden dep pulled in
pnpm arch                        # target layout: 0 (unchanged). current layout: 14 (unchanged —
                                  # data-sources counted zero violations before graduating too)
pnpm lint                        # 0 errors; the pre-existing 32 warnings are all unrelated
pnpm types                       # 0 errors, whole-repo tsc
pnpm test                        # 114 files / 1676 tests passed, 60 skipped (pre-existing skips)
pnpm build                       # see below
```

`pnpm build` compiled successfully (3.4min), typechecked clean, and generated
all 48 static pages including `/settings` and `/tests/[id]` — the two pages
that mount this plugin's UI — plus the untouched `/api/auth/google-sheets`
and `/api/auth/google-sheets/callback` routes. Per recipe §8's action-id
count:

```
node -e "const m=require('./.next/server/server-reference-manifest.json');
console.log(Object.values(m.node).filter(v =>
  JSON.stringify(v).includes('plugins/data-sources/src/actions')).length)"
# -> 15
```

15 for 15 exported functions (5 CSV + 3 account + 7 Google Sheets data
source) — exact match, so neither the S1 re-export trap nor a dead action.

## 8. What was NOT verified

- No run against a real Postgres instance — the table rename
  (`migrateDataSourcesTables`), the FK drop, and `core/data`'s
  `validateSchemaNamespace` check on the `data_sources_` prefix are all
  exercised only by reading the code, not by running `pnpm db:push` against a
  live database.
- No browser click-through: CSV upload, Google Sheets OAuth connect →
  import → sync → delete, and the `{{csv:}}`/`{{sheet:}}` reference resolution
  path inside an actual test run were not exercised end-to-end.
- The storage-quota rejection path (`ctx.storage.put` throwing when a team is
  over quota) is untested against a real quota configuration.
- The deletion hook's storage cleanup (`onTeamDeleted`/`onRepoDeleted`
  deleting blob keys) has no test exercising it against the real
  `appStorageHost` filesystem backend.

A migration that claims more than it checked is worse than one that admits
the gap (recipe §9) — these four are exactly that gap.
