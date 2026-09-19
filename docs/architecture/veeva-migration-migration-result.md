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
same vault. **38 cases, all passing against a real Postgres.**

### The contract suite earned its place: it caught nine real bugs

Worth recording, because the temptation with a 900-line store translation is to
eyeball it. The first run was **20 failures of 38**, all of them behaviour the
deleted `PostgresStateStore` got from machinery in `sql.ts` that did not survive
the move to drizzle:

- `c("sfdc_id", …, { sfdcId: true })` normalised 15-char Salesforce ids to 18 on
  the way in and out. Lost → every id-keyed lookup in `id_map`, `row_results`,
  `pending_fk` and `fk_index` missed on a 15-char id.
- `dedupeRows()` folded duplicate keys inside one batch, because Postgres
  refuses to `ON CONFLICT DO UPDATE` the same row twice in one statement
  (SQLSTATE 21000). Lost → `putMany` raised on a repeated id, which is a normal
  input.
- The store stamped its own `vaultDns` over the row's, and `probeResults.set`
  did the same. Lost → a row could claim a second vault inside a store bound to
  one.
- `runs.create` silently ignored a duplicate run id (`onConflictDoNothing`), and
  `runs.update` silently hit nothing for an unknown run. Both must throw; the
  first would let two runs share an id, the second is how a terminal status goes
  missing.
- `runs.update` passed `undefined` through to `SET`, nulling a mapping hash on
  any partial patch.
- `merge` neither inserted a tombstone for an unmapped loser nor threw on a
  missing survivor (§3.4).
- `findings.previous()` ordered by `started_at`. The engine defines it as the
  run before this one in **creation** order, and a re-run of an earlier wave
  carries an older timestamp — the `seq` column exists for this and was dropped
  in translation.
- `auditLog.list({ limit })` returned the head. It is a tail: a caller asking
  for 5 wants the last 5 events.
- `countFailedByType` bucketed a null error type as `"unknown"`; the reference
  uses `"UNKNOWN"`, and the value lands in a report beside real Vault codes.

One assertion in the shared contract was changed rather than satisfied:
`auditLog` asserted the first three ids are literally `[1, 2, 3]`. That only
ever held for a store with a fresh id sequence — the in-memory one, and the old
postgres one because its integration test gave each run a private schema. A
store whose isolation is a tenant key inside a shared table has a sequence that
keeps climbing, and nothing in the engine depends on the first id being 1
(`id` orders an append-only log). The assertion now checks the ids are strictly
increasing and expresses the filter/tail cases in terms of the ids observed, so
it tests the store instead of the fixture.

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
`plugin_jobs` payload.

### 4.1 The run lifecycle, after the second review

The first cut of this claimed cancellation and crash recovery it did not have:
`cancelPluginJob` only touched `pending` rows, nothing ever aborted a handler
already in flight, `plugin_jobs` had no lease so a dead worker's job stayed
`running` forever (and its dedupe key locked the project), and the plugin's
sweeper judged runs by wall clock — a healthy multi-hour init was "aborted" at
thirty minutes. All four are closed, and each is owned by the layer that can
see the fact:

- **Core: the lease.** `plugin_jobs.heartbeat_at` is stamped at claim and
  refreshed every `DEFAULT_HEARTBEAT_MS` (30 s) by `processDueJobs` while the
  handler runs. `reapExpiredPluginJobLeases` (called by the worker before it
  claims) fails the attempt of any `running` row whose heartbeat is older than
  `PLUGIN_JOB_LEASE_MS` (5 min) — through `failPluginJobAttempt`, so
  `maxAttempts: 1` is honoured and a migration settles as `failed` rather than
  re-executing. `completePluginJob` / `failPluginJobAttempt` only touch a row
  that is still `running`.
- **Core: cancel reaches a running job.** `cancelPluginJob` now flips `running`
  rows too; the heartbeat reports the flip (`heartbeatPluginJob` returns
  `cancelled: true`) and the worker aborts the handler's `AbortController`. The
  engine sees it at its next unit or batch boundary.
- **Plugin: the row follows the queue.** `reconcileStaleRuns` asks
  `ctx.jobs.status` for every in-flight run row and aborts only those whose job
  is `done`/`failed`/missing. Nothing is judged by elapsed time except a
  `queued` row with **no job id** (a crash inside `enqueueMigrationRun`; the
  window is seconds, the cutoff five minutes). The reconciler has its own
  re-entry flag in the scheduler, separate from the worker's, so it keeps
  ticking during the long job it exists to watch.
- **Plugin: every terminal write is conditional.** `finishMigrationRun` writes
  only while the row is `queued`/`running`; `executeRun` starts only if
  `claimQueuedMigrationRun` moved it from `queued`. An operator's `aborted`
  therefore stands, and a run cancelled while waiting behind another job never
  starts.
- **Plugin: one run per project, enforced by the database.** Partial unique
  index `uq_veeva_migration_runs_one_active` on `(project_id) where status in
  ('queued','running')`, and `enqueueMigrationRun` deletes its own row and
  refuses if the queue's dedupe handed back a job another run owns.

## 5. Two known gaps, stated rather than papered over

**`ui.nav` is declared and unconsumed.** Nothing in the app reads
`manifest.ui.nav` — `src/components/layout/sidebar.tsx` hardcodes every entry,
including `explorer`'s, which also declares one. So the sidebar keeps its
hardcoded "Migrations" item and its Early-Adopter filter. Declaring `ui.nav` is
recipe-correct and costs nothing; building the consumer would let that whole file
shrink and is its own PR.

**Run artifacts on disk** — extract pages under `runArtifactRoot` — are removed
by `VeevaMigrationHost.removeArtifacts` from `deleteMigration`, `onRepoDeleted`
and `onTeamDeleted`. The summary's `reportPath` is stored relative to that root
and is not served; the absolute server path no longer reaches the browser.

**Endpoints freeze once a run exists.** Watermarks and the id map are keyed by
project, so `updateMigrationEndpoints` refuses to change either connector after
the first run; a different Vault is a different migration.

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
- `pnpm db:push` against local postgres: `[✓] Changes applied`. All 17
  `veeva_migration_*` tables exist; verified in the catalogue that **no FK
  points from any of them at a core table**, and that every engine table's
  primary key leads with `project_id` — `watermarks` included, which is the key
  whose absence caused the silent data skip.
- `pnpm test:integration` for the store suite: **38 of 38** against a real
  database, including the cross-project watermark, runs and id-map assertions
  and the cascade-on-project-delete check.

### Two pre-existing blockers found while doing it

Neither is caused by this change; both had to be fixed for `db:push` to
complete at all, and both would have hit the next release regardless.

1. **`pnpm db:push` silently skips every pre-push step unless `DATABASE_URL` is
   exported.** `scripts/migrate.js` guards each step with
   `if (!process.env.DATABASE_URL) return;` and nothing loads `.env.local`,
   while `drizzle.config.ts` falls back to a hardcoded local URL — so
   `drizzle-kit push` runs while the renames, backfills and FK drops do not.
   Locally that is exactly the hang the script's own header warns about: the
   first attempt stopped on *"Is `qa_agent_tasks` created or renamed from
   another table?"*, an unanswerable prompt, because `migrateQaAgentTables()`
   had been skipped. Run it as
   `DATABASE_URL=… pnpm db:push` until the script loads `.env.local` itself.
2. **A stale `PRE_CREATE_SQL` entry caused the prompt it existed to prevent.**
   `csv_data_sources` was pre-created there so drizzle would not mistake it for
   a rename, but the data-sources plugin migration renamed the table to
   `data_sources_csv_sources`. No schema declares the old name any more, so the
   pre-create resurrected an empty table on every push, leaving push with a
   stray DROP — and a release that adds thirteen tables turns that into *"Is
   `veeva_migration_audit_log` renamed from `csv_data_sources`?"*. The entry is
   removed and a `RETIRED_TABLES` step (mirroring `RETIRED_COLUMNS`) drops the
   leftover, refusing if it unexpectedly holds rows.
