# `veeva-migration` migration result (RFC §9 phase 4, seventeenth plugin)

**Status:** done. `src/lib/migration/`, `src/server/actions/migrations.ts`,
`src/components/migrations/` and `packages/db/src/schema/migrations.ts` are
deleted, not shimmed. No `PSEUDO_PLUGINS` entry was ever added, because there
was nothing left in `src/` to enforce by the time the entry would have landed.

**Why now:** an architecture review of `claude/veeva-sfdc-vault-migration-vh1px5`
found the feature installed as a pseudo-plugin and, separately, six correctness
and security defects. Five of the six were consequences of one thing — the
engine invented its own caller context — and the placement fix and the security
fix turned out to be the same piece of work. That is the interesting part of
this result doc.

---

## 1. Port size: 5

| method | what it replaced |
| --- | --- |
| `assertRepoSettingsAccess` | `requireRepoCapability(id, "repos:settings")` + `getCurrentSession()` + `hasMigrationAccess(team)` |
| `resolveConnectorSecrets` | `queries.getConnectorForConnection` |
| `resolveEndpoints` | the connector/environment half of `getMigrationProjectDetail`, plus the action's private `environmentOf` |
| `listConnectors` | the connect panel's connector list |
| `runArtifactRoot` | the `run_dir` column, deleted |

Grouped: one credential boundary, one identity/authorisation gate, two private
reads, one path derivation. "Go" by §1.5, and the count was accurate in advance
for once — the first pass counted 5 and the migration needed 5.

**`resolveConnectorSecrets` is the third independent declaration of one
capability gap.** The recipe asks for this to be said explicitly: it is the same
shape as `CiHost.scmCredentials` and `DataSourcesHost.googleSheetsAccessToken`
— *"decrypt the stored credential for this connection, server-side, and hand me
the plaintext"* — now arrived at three times against three credential tables
(`repo_credentials` via `sut_connectors`, SCM credentials, `google_sheets_accounts`).
One `core/credentials` capability taking a connector id retires a method in
three plugins. It joins the seven identity methods across three plugins already
on the phase-5 backlog.

**`assertRepoSettingsAccess` is a shape worth copying.** The pre-migration code
had `guardRepo`, `guardProject` and `hasMigrationAccess` in three modules, and a
new action could satisfy two of the three and look right. Collapsing them into
one port method means the plugin cannot check the capability and forget the
Early-Adopter gate. The page gate went the same way: `readMigrationConsole`
calls it itself, so a route cannot forget the team-ownership check that used to
be a separate `getRepository` read in the page body.

## 2. The tenancy hole, and why the plugin move is what fixed it

The review's first finding was that the engine's state was not tenanted. It is
worth spelling out because it is the strongest argument in the phase-4 record
for the no-FK / `ctx.data` rules being load-bearing rather than tidy.

The engine kept thirteen tables in a Postgres schema called `veeva_migration`
that it created itself, through a `postgres()` pool it opened itself, with:

- `runs` filtered by `status` and nothing else;
- `watermarks` keyed `(object_key, country, kind)`;
- `id_map` and `probe_results` scoped only by `vault_dns` — a string any team
  member types into their own Vault connector;
- no `team_id` or `project_id` anywhere.

So: a tenant entering another customer's Vault DNS could page their crosswalk
(`lookupCrosswalk`, `sampleCrosswalk`); `MAP_HASH_CHANGED` and `SF_ORG_MISMATCH`
compared against other tenants' runs; and the schema header's own recommended
shape — "two projects pointing at two environments" for UAT then PROD — meant
the PROD initial load inherited UAT's high-water marks and **silently skipped
data**. That last one is a data-loss bug, not only an isolation bug.

Three structural properties now hold, none of them by discipline:

1. `projectId` leads every engine primary key. A watermark belongs to a project
   by its *key*, not by a filter someone must remember to write.
   `plugins/veeva-migration/src/schema.test.ts` asserts it for all thirteen
   tables so the fourteenth cannot forget.
2. The store cannot open a connection: `ctx.data` hands it a handle on core's
   pool. That also puts every statement through the instrumented client in
   `packages/db` for the first time (so DB spans and the bound-parameter
   redaction policy apply), and makes `close()` a no-op — the read side used to
   open a four-connection pool and run DDL under an advisory lock **on every
   console page render**.
3. Deletion is real. The engine rows hang off `veeva_migration_projects` by a
   plugin-internal FK that still cascades, and `deletion.ts` drives the team,
   repo and user cases. The old schema outlived the project, the repo and the
   team — audit log and id map included. A manifest would have refused to boot
   without a `deletion` hook; core had no equivalent guard for a schema it did
   not know about.

`e2e/veeva-migration-store.integration.test.ts` runs the engine's own
`stateStoreContract` against the new store and then asserts the three leaks are
gone by construction, including the watermark collision with two projects on the
same vault.

### Why the integration test is in `e2e/`, not in the plugin

It needs a real `postgres` client to play the part of the composition root, and
a plugin's manifest must not list `postgres` at all — rule 2 exists so nobody
has to reason about whether a particular dependency is "only for tests".
`core/data/src/scoped-db.integration.test.ts` is the same shape for the same
reason. The app may open a connection; the plugin may not, which is precisely
what the test demonstrates the store does not need.

## 3. The engine was CLI-first, and that is where the other four defects came from

`packages/veeva-migration` → `libs/veeva-migration` is the tier fix the RFC
asks for (a pure domain engine importing nothing from the app, like
`libs/coverage-model`). The more important change is that the engine no longer
invents its caller.

`RunOptions.context` is a **required** `RunContext { tenantKey, actor, runDir,
signal }`. Required is the whole point: there are two front doors — the app's
plugin job and `src/cli.ts` — and the type system now refuses to let either
start a run without saying who is acting and where the bytes land. What it
replaced, one field at a time:

| was | defect | now |
| --- | --- | --- |
| `actor: process.env.USER ?? "veeva-migration"` | a regulated cutover's audit log named the server's OS account, on every entry | `context.actor`, the acting user's id |
| `deps.runDir ?? config.staging?.runDir ?? "./runs"` | free text from a settings form, unvalidated, handed to `fs.mkdir` — arbitrary write for anyone with `repos:settings` | `context.runDir`, derived by the host from its storage root plus ids |
| `config.staging.databaseUrl` | the app's own `DATABASE_URL` became feature config, threaded from a server action | gone; the store is injected |
| *(nothing)* | `abandonMigrationRun` could not stop a run and said so in its own comment | `context.signal`, checked at unit and batch boundaries |

`staging` is deleted from the config schema entirely. One note for whoever
misses it: **per-country `staging` was never implemented.** `createEngineDeps`
built exactly one store from the top-level config and logged a warning when a
country targeted a second vault, so the `staging:` line in `config/countries/CN.yaml`
("staging never leaves CN") described an intention. Residency is now
unambiguously the host's concern, because the host supplies the store.

### The CLI is demoted, not deleted

It lost its `bin` entry, so it no longer lands in `node_modules/.bin` of the
application image, and its state store is the file driver — it cannot reach the
application database at all. It was a second front door into the same engine
with none of the app's guards: no repo capability check, no connector credential
resolution, and no knowledge of the one-run-per-project lock the console holds
in the database, so a CLI run and a console run could interleave upserts and
both advance watermarks. It survives as a development and spec-conformance
harness (`pnpm --filter @lastest/veeva-migration cli`), and it now builds its
`RunContext` explicitly — `actor` is `os.userInfo().username`, stated at the
call site where that is true.

`PostgresStateStore`, `sql.ts` and their three test files are deleted (~1,400
lines). The engine has no database driver left.

## 4. First plugin to declare `jobs`

Nothing shipped had, so `processDuePluginJobs()` in `src/lib/core/runtime.ts`
had **zero callers** and its own comment deferred wiring the interval to
"whoever registers the first job handler". That is this plugin; the tick is now
in `src/lib/core/scheduler.ts` beside `processDueExplorerTriggers`.

Two things the second job-declaring plugin needs to know:

- **`processDueJobs` dispatches sequentially**, deliberately (`core/jobs`: twenty
  plugins' jobs firing at once is the capacity incident the queue exists to
  prevent). A migration run takes hours, so it occupies the tick it is claimed
  on and other plugins' jobs wait. Acceptable while migration is the only long
  job; it is the argument for moving the engine to a dedicated worker before a
  second one lands.
- **The run is `maxAttempts: 1`.** The engine is safe to re-run *deliberately*
  (an interrupted init is a delta), but a worker crash that a queue silently
  retries would start a second load against a live Vault with nobody watching.

What the queue bought beyond correctness: `run.signal` is the cancellation token
the feature never had, and the job payload carries **one id**. Credentials are
resolved inside the handler at the moment of use, so plaintext no longer sits in
a closure for the life of a multi-hour run, and nothing secret is persisted in a
`plugin_jobs` payload. `failStaleMigrationRuns` — which shipped with zero
callers — is now the plugin's own reconciler for the one gap the queue cannot
see (the process died between the engine finishing and the row being written),
called from the same tick.

## 5. Two known gaps, stated rather than papered over

**`ui.nav` is declared and unconsumed.** Nothing in the app reads
`manifest.ui.nav` — `src/components/layout/sidebar.tsx` hardcodes every entry,
including `explorer`'s, which also declares one. So the sidebar keeps its
hardcoded "Migrations" item and its Early-Adopter filter. Declaring `ui.nav` is
recipe-correct and costs nothing; building the consumer would let that whole file
shrink and is its own PR.

**`veeva_migration_audit_log.actor` is not anonymised by `onUserDeleted`.** The
hook nulls this plugin's four reference columns (`createdBy`, `signedOffBy`,
`startedBy`, `acknowledgedBy`), matching the `ON DELETE SET NULL` it replaces.
It deliberately does not touch the engine's audit log, which stores the acting
user's id: in a regulated cutover that log is the record of who did what, and a
trail that forgets its actors is not a trail. That is a retention decision with
a GDPR trade-off, flagged here so it can be overruled with intent rather than
discovered later. Deleting the user's *team* still reaps it, because the audit
rows cascade from the project.

## 6. Smaller things the review asked for

- Root `tsconfig.json` is back on **ES2017**; the one `0n` literal that forced
  ES2020 is a `BigInt(0)` call. `libs/veeva-migration` is excluded from the root
  program as a *root* only (its tests and testkit use ES2018+ syntax and
  Node-shaped `ProcessEnv`), and is verified by its own `tsc --noEmit` at ES2022.
  `exclude` does not stop tsc following an import, so the app still typechecks
  everything it actually reaches in that package under its own target.
- The engine has an `exports` map, so nothing needs to lazy-import a barrel that
  pulls in 46 object modules to read a type. The `MemoryStateStore` re-export is
  kept: `databaseUrl: "memory:"` is a supported runtime target, not only a test
  double, so the review's "test doubles in the production barrel" framing does
  not hold — the `exports` point did.
- The 4.3 MB `demo/veeva-migration-demo.mp4` and the `python3` renderer are
  deleted. The timeline JSONL and `demo-run.ts` stay: they are the source the
  flow model is documented against.
- `libs/ui` gained `timeAgo`. `plugins/qa-agent/src/ui/format.ts` held a verbatim
  copy of the app's and said *"fold it into a shared formatting lib the day a
  second plugin copies it"* — this was that day, so the copy became a re-export
  rather than a third duplicate.

## 7. Found along the way, not fixed

`libs/veeva-migration/src/run/engine.test.ts` → *"extract count mismatch:
re-extracts with PK chunking…"* fails roughly **1 run in 8**, with
`SyntaxError: Unexpected end of JSON input` and a watermark that should have
been kept coming back `undefined`. Confirmed pre-existing: it reproduces with
every test added by this work stripped out. The symptom (a partially-written
manifest read back, and a watermark decision taken off it) suggests a real race
in the extract manifest write/read rather than a flaky assertion, which would
make it a correctness bug in the same family as the rest of this review. Not
touched here because it is unrelated to the findings and deserves its own
change.

## Verification

- `pnpm arch` — target layout **0 violations**. (One pre-existing
  `core-to-plugin` violation remains in the *current* layout,
  `src/lib/execution/executor.ts:448` → `@lastest/plugin-api-test/runner`,
  untouched by this work.)
- `npx tsc --noEmit` clean at the root; `pnpm --filter @lastest/plugin-veeva-migration typecheck`
  and `pnpm --filter @lastest/veeva-migration typecheck` clean.
- `pnpm test` — 265 files, 3577 passing. Includes the engine's 1,157 (with new
  cases for the audit actor and for cancellation stopping a run mid-flight), the
  plugin's 42 moved flow/config tests, and 6 new schema-invariant tests.
- `pnpm lint` — 0 errors; the 20 warnings are all pre-existing and none are in
  code this migration added.
- `grep -rn '@/' plugins/veeva-migration/src` — doc comments only, no imports.
  The manifest lists no `postgres`, `@lastest/db`, `playwright` or AI SDK.
- **Not yet run:** `pnpm db:push` and `pnpm test:integration`. Both mutate the
  local dev database — the push renames four tables, drops nine FKs and drops
  the empty `veeva_migration` schema — so they are left for a deliberate run
  rather than executed from a worktree against a database another branch is
  checked out against.
