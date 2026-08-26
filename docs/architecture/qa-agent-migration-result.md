# QA Agent migration — result

**Status:** landed. RFC §9 phase 4's sixteenth and final feature migration —
the flagship, deliberately last, and the largest single move of the refactor.
**Package:** `plugins/qa-agent/` → `@lastest/plugin-qa-agent`
**Recipe followed:** [`plugin-migration-recipe.md`](./plugin-migration-recipe.md)

## 1. The headline

QA Agent is an orchestrated nine-phase agent team — preflight, login
resolution (a four-option cascade), discovery (static route scan + live crawl
+ a shared-frontier explorer swarm), coverage planning, a human review gate,
generation, execution, healing, summary — plus a direction queue
(`qa_agent_tasks`), cron/PR automation triggers (`qa_agent_triggers`), and a
~2,700-line UI. It migrated in two passes: the browser pass moved the domain
layer (`plugins/qa-agent/src/domain/` — crawl, swarm, login probes, planning,
triage, PR/code checks, docs ingestion) and converted every EB touch off raw
CDP months before this change; this change finishes it — manifest, wiring, a
29-method host port, the 4.5k-line action module, the UI, the two tables, and
the deletion hook.

`PSEUDO_PLUGINS["qa-agent"]` is deleted. `src/lib/qa-agent/`,
`src/server/actions/qa-agent.ts` and `src/components/qa-agent/` are deleted,
not left as shims. What remains on the ledger is the costed orphan trio
(§8). The burndown does not move — qa-agent's counted violations were already
zero after the browser pass, exactly the "zero here is not a finished
migration" case the ledger's own commentary used it to illustrate; the port
count and the deleted entry are the metrics, per recipe §1.5.

## 2. Manifest: `capabilities: ["browser", "ai", "data"]` — and why not `tests`/`repos`/`events`

- **`browser`** — every claim (login probes, the single-explorer crawl, the
  swarm's progressive claim protocol) is a `ctx.browser.withBrowser` /
  `withBrowserSwarm` scope. The `agentBrowserCapability` bridge
  (`src/lib/core/agent-browser.ts`) — built for exactly this file when it had
  no `ctx` — lost its only caller; it is kept, header updated, as the ramp
  `play-agent` should take (it never onboarded and still claims raw EBs).
- **`ai`** — the pipeline's three own JSON calls (auth-context extraction,
  planner/journey refiner, task triage) moved onto `ctx.ai.generate` under
  their pre-migration action types; `ai-capability.ts`'s `ACTION_TYPES` gains
  `qa_auth_extract`/`qa_plan`/`qa_task_triage` (recipe §7's silent row,
  fourth hit). Generation/healing do NOT go through `ctx.ai` — they run
  inside `@lastest/plugin-authoring-ai`'s agents (§4, host item 11).
- **`data`** — the two owned tables, through the `qa_agent_`-validated handle.
- **`tests` and `repos` were checked method-by-method and rejected** (the
  task's own prior guess included them): `ctx.tests.createQuarantined`
  cannot express an un-quarantined write with code, per-layer overrides, an
  `apiDefinition` and bot attribution (the `api-test`/`quickstart` finding,
  third time), and `listCoverage` returns no test ids — the coverage
  matcher's key. `ctx.repos.baseUrl` answers a question this plugin never
  asks; it needs provider/owner/branches for GitHub-aware discovery.
- **`events` rejected for `quickstart`'s exact §3 reason:** the feed keys
  agent badges on `sourceType: "qa_agent"` plus per-event `agentType`
  (orchestrator/scout/diver/planner/generator/healer/ranger), which
  `plugins/events`' generic `emit()` cannot express. `emitActivity` is a host
  method preserving the exact pre-migration event shape, `promptLogId` link
  included.

## 3. The host port: 29 methods in 12 groups — one over `quickstart`'s 28, for the same reason

Recipe §1.5's stop line is about a port dwarfing its feature. What stays in
`plugins/qa-agent/src/actions.ts` (4,624 lines) after the port is declared is
the entire orchestrator: the login cascade, the swarm claim protocol,
coverage-aware planning, the review gate, the triage protocols
(`gap_fill`/`explore`/`targeted_refine`/`targeted_direct`), the task-queue
state machine. `plugins/qa-agent/src/host.ts` carries the full grouped
breakdown with each group's honest future; the shape summary:

| Group | Methods | Note |
| --- | --- | --- |
| 1. Session CRUD (`agent_sessions`, kind `"qa"`) | 5 | quickstart's shape + a recent-sessions read (§5) |
| 2. Run-minute quota | 1 | pre-flight refusal; the claim path meters again |
| 3. SSRF guard (`checkOutboundUrl`) | 1 | **fourth** declaration of the same boundary (explorer, app-map, api-test) — the strongest `core/security` case yet, shaped check-and-report per §3.1 |
| 4. Test CRUD | 5 | `api-test`/`quickstart`'s shape; `play_agent` bot attribution decided host-side |
| 5. Execution (`startRun`/`isRunSettled`/`getLatestResultStatus`) | 3 | the missing build/exec capability `quickstart` item 6 named |
| 6. Storage states / auth resolution | 3 | `captureStorageState` = the shared module quickstart §11 left for this migration (§6); `resolveExistingAuth` verbatim in explorer's port — second declaration |
| 7. Repo/source facts | 6 | incl. `getSourceAccess`, a bound-closure facade over the GitHub token — the token never crosses the boundary (authoring-ai's rule) |
| 8. Team settings (`getTeamEmailTemplate`) | 1 | verbatim in quickstart's port |
| 9. Pool headroom (`getEbPoolMax`) | 1 | swarm sizing (`min(requested, poolMax − 5)`) |
| 10. Activity (`emitActivity`) | 1 | NOT `ctx.events` — §2 above |
| 11. Authoring sessions (`withAuthoringSession`) | 1 | the plugin→plugin bridge — §4 |
| 12. Identity (`currentActor`) | 1 | the NINTH identity method across five plugins; `core/identity` keeps accruing evidence |

Verbatim-shared methods across ports now stand at: SSRF ×4, existing-auth ×2,
identity ×9-across-5 — each one a priced core PR, none bundled here (§7.2).

## 4. The one cross-plugin call: generation and healing run inside `authoring-ai`

Pre-migration, `qa-agent.ts` imported `withAuthoringAiSession` from
`@lastest/plugin-authoring-ai/actions` directly — legal for a pseudo-plugin
(the walker generates no pattern for an already-packaged target), fatal for a
packaged one. It is now `QaAgentHost.withAuthoringSession`, filled by the
composition root (`src/lib/core/qa-agent-host.ts` imports the authoring-ai
actions — the one place that import is legal, `quickstart.publishShare`'s
shape). The session type is *narrowed* in the plugin
(`QaAuthoringSession`: `createTest`/`healTest` slices only) and the host's
pass-through `satisfies` is the drift assertion.

## 5. Sessions stayed in core's `agent_sessions` — the encryption story

The `quickstart` precedent, applied from the other side, exactly as its result
doc's §11 told this migration to. QA runs write `quickstartEmail` /
`quickstartPassword` / `qaAuthContext` into session metadata; core's query
layer (`src/lib/db/queries/integrations.ts`) encrypts those at rest
**by field name, across the whole table, regardless of `kind`**
(`crypto-fields.ts`; `scripts/rotate-encryption-key.ts` rotates them). The
field names are shared with QuickStart's rows by core's own schema comment.
Splitting onto a `qa_agent_sessions` table would fork that encryption path or
ship this plugin's copy unencrypted. So session CRUD is five host methods that
delegate to the owned query layer — which is also what the `host::db` rule
(`FORBIDDEN_HOST_IMPORTS`) makes structural: the host cannot open the DB, so
the encrypt-on-write path is the only path. `quickstart`'s host item 2 and
`index.ts` were updated to reflect that the constraint is now mutual: the debt
clears only when both agents move together onto a core credential capability.

The plugin sees sessions through `QaSessionRow` — a narrowed view
(`QaStepId`/`QaStepState`/`QaSessionMetadata`) declared in its `types.ts`;
`src/lib/core/qa-agent-host.ts` carries the `satisfies` assertions (step-id
and activity/agent unions) plus quickstart-style jsonb-boundary casts on
steps/metadata (a known, accepted weakness — quickstart §10 names it).

## 6. Tables: one rename, two FK drops, a deletion hook

`schema.planned.ts` — written and deliberately disarmed during the browser
pass — became the live `plugins/qa-agent/src/schema.ts`, and its own header's
checklist was executed exactly:

- `qa_tasks` → `qa_agent_tasks` (the `qa_agent_` prefix
  `validateSchemaNamespace` demands; `qa_agent_triggers` was born compliant),
  renamed by `migrateQaAgentTables()` in `scripts/migrate.js` **before**
  `drizzle-kit push` — push cannot see a rename (recipe §2.4). Fatal-catch,
  idempotent, empty-destination drop: the `GAMIFICATION_RENAMES` pattern
  verbatim.
- Both tables' `repository_id → repositories.id ON DELETE CASCADE` FKs
  (`confdeltype = 'c'`, checked — no `restrict` surprise) dropped by
  catalogue lookup after the rename. The `UNIQUE` on
  `qa_agent_triggers.repository_id` is untouched — uniqueness was never the
  FK's doing.
- `deletion.ts` (`onTeamDeleted` + `onRepoDeleted`, explorer's shape, data
  handle from the wiring slot) is the cascade the database no longer
  performs. `agent_sessions` needs nothing: core's own cascade still covers
  it (recipe §2.3).
- **Both Dockerfiles** gained the `plugins/qa-agent/src/schema.ts` COPY line
  (`Dockerfile` and `Dockerfile.migrate` — the files' own warning about
  exactly this). The schema's only non-erased import is `drizzle-orm/pg-core`;
  its `./types`/eb-protocol imports are `import type`, which drizzle-kit's
  esbuild loader erases without resolving, per `Dockerfile.migrate`'s header.
- Core's `packages/db/src/schema/agents.ts` lost the two tables and the three
  task types; `src/lib/db/queries/{qa-tasks,qa-agent-triggers}.ts` are
  deleted and the barrel notes where they went. One dead export was dropped
  rather than carried: `getQaTaskBySession` had zero callers anywhere.

**Verified against a throwaway database** (§10): seeded old-name tables with
rows and live FKs, ran `node scripts/migrate.js` — rename applied, rows
byte-identical after it, both FKs dropped by catalogue lookup, UNIQUE
preserved. Separately, `drizzle-kit push` against a clean database created
`qa_agent_tasks`/`qa_agent_triggers` from the plugin schema via the existing
`drizzle.config.ts` glob.

## 7. Actions, dispatchers and UI

- **`plugins/qa-agent/src/actions.ts`** (4,624 lines) is the moved
  orchestrator. Auth: `contextFor(qaAgentPlugin, …)` — session scope for UI
  actions, the ownership-checked `{repositoryId, teamId}` background branch
  for the detached pipeline, the task dispatcher and trigger fires (which
  never see `headers()`). Plan gate: `ctx.team.entitlements.has("qa-agent")`,
  with the pre-migration message text preserved (the "Pro" in it mirrors
  `QA_AGENT_MIN_PLAN`; the gate itself cannot drift, only the wording could —
  noted in the code).
- **`dispatchDueQaTriggers()`** is a new plugin export: the scheduler-tick
  handler moved out of `src/lib/core/scheduler.ts` into the plugin (the
  `dispatchDueSchedules`/`dispatchDueExplorerTriggers` shape), owning the
  due-trigger query and nextRunAt advancement; the app's tick loop shrinks to
  a wire-runtime-and-call stub.
- **`reads.ts`** (not `"use server"`, the `gamification`/`ci` rule): task and
  trigger reads for the `/qa-agent` page, the v1 API and the GitHub webhook.
- **UI** moved to `plugins/qa-agent/src/ui/` with bodies verbatim — imports
  aliased (`QaSessionRow as AgentSession`, `QaAgentTask as QaTask`, …) so the
  3,300 moved lines diff clean. Three genuinely new pieces:
  - `BrowserViewer` becomes a required `ComponentType` prop the page hands
    down (explorer's `browserViewer` slot; a component reference so it
    crosses the RSC boundary).
  - `useActivityFeed` (app hook) became a plugin-local `use-activity-events`
    hook subscribing to the `/api/activity-feed` **endpoint** — the same URL
    `plugins/app-map`'s exploration progress already opens an `EventSource`
    against; a URL is a contract, not an import. Only the `events` half the
    QA client ever read is reproduced.
  - `timeAgo` is an 11-line verbatim copy (`ui/format.ts`) — below the
    threshold where a one-consumer `libs/` package earns its surface; the
    file says to promote it when a second plugin copies it.
- **Consumers repointed:** the `/qa-agent` page (composition + data fetch,
  plugin client + upgrade gate via `./ui/*` exports), the v1 catch-all route,
  the GitHub webhook, `src/lib/core/app-map-host.ts`'s three qa seams (now
  the ordinary composition-root cross-plugin call; the `ctx.jobs` future
  stays open and is re-documented honestly on both sides),
  `cancel-exploration.ts`, and app-map's `explore-progress-panel.tsx` (which
  now imports the plugin's `useQaAgent` via a `./ui/use-qa-agent` export).
- **`/api/qa-agent/[sessionId]` stayed in the app**, unchanged: 35 lines of
  core-table read through core queries and core auth, with nothing of the
  plugin's in it — §6.2's ratio test says it is not the plugin's route.

## 8. The costing pass: `spec-import`, `ai-routes`, `specs`

Run per recipe §1.5 (count core calls, group, compare to precedent); verdicts
recorded on each `PSEUDO_PLUGINS` entry and here. **Nothing was implemented
for any of them.**

| Orphan | LOC | Distinct `queries.*` | Other core coupling | Verdict |
| --- | --- | --- | --- | --- |
| `spec-import` | 1,569 | **16** | `@/lib/ai` + `runParallel`, **raw `claimEmbeddedBrowserForAgent`**, `@/lib/github` content, git-utils, `agent_sessions` writes | **Stop.** Groups to ~10 debt items, past the ~8–15 band, with a browser-conversion prerequisite (`ctx.browser`/`browserTools`) on top. Not reclassify-core: unlike `url-diff` it is a real feature (own dialog UI, own `spec_imports` table). It shrinks when the already-priced core PRs land (test-CRUD capability, `core/identity`, browserTools conversion). |
| `ai-routes` | 803 | **6** | raw EB claim (one call), GitHub content reads (token stays host-side), AI | **Migrate — as a fold into `authoring-ai`.** The prior entry's guess ("closer to route-scan's ~26") was wrong by 4×. `AuthoringAiHost.aiScanRoutes` already exists as the seam; folding retires it instead of declaring a sibling port. Its raw claim converts to the `browserTools` shape authoring-ai already uses. |
| `specs` | 643 | **14** | one AI call; otherwise pure spec/test/area CRUD on core tables | **Reclassify as core** (§1.6 row 2, the `route-scan` outcome): consumed exclusively by core UI (record panel, test-definition page, areas panel) plus one authoring-ai host method; a port at the stop line for a feature smaller than `ranger` is "a thin orchestration of core". The reclassification (CORE_SRC_PATHS-adjacent + CODEOWNERS) is its own change. |

The three verdicts differing is the argument for having costed them
separately rather than inheriting `spec-import`'s "oversized" label for all
three.

## 9. Behaviour changes, stated plainly

- **Planner `promptLogId` timing:** the substep's prompt-log link is recorded
  when the AI call *returns* (`AiResult.promptLogId`) rather than streamed
  mid-call via `onLogCreated`, which the capability deliberately does not
  expose. Same link, visible seconds later.
- **AI settings caching:** `ctx.ai` resolves provider settings once per
  context (one pipeline run) instead of once per call. A settings change
  mid-run applies to the next run — pre-migration it applied to the next
  *call*.
- **Trigger-path scope errors:** `startQaAgentFromTrigger` now returns
  `{ skipped: "QA agent not available on the team's plan" }` when the
  background scope cannot resolve at all (unknown team, or a repo that
  stopped belonging to the claimed team). Pre-migration only the unknown-team
  half of that was checked; the ownership check is new and strictly tighter,
  and all callers pass the repo's own teamId.
- **Functional-area creation** still happens up front per group (the
  pre-migration eager loop), preserved via `getOrCreateFunctionalArea` +
  id-carrying `createTest` rather than folding area resolution into the write.
- **One dead export dropped:** `getQaTaskBySession` (zero callers).
- **Nothing else.** The pipeline's control flow, the cascade order, the
  swarm's claim windows and flush throttles, every user-facing string
  (including skip/park/reply texts the integration test asserts on) are
  moved, not rewritten.

## 10. Verification

```
pnpm exec vitest run tools/architecture     29 passed (ratchet + graph + CODEOWNERS;
                                            one split-PR fixture updated — qa-agent
                                            was its lib/components example)
pnpm exec vitest run plugins/qa-agent       7 files, 106 passed
pnpm test                                   118 files passed, 1 failed —
                                            src/lib/logger.test.ts, the known
                                            pre-existing Node DEP0205 leak
pnpm exec tsc --noEmit -p tsconfig.json     clean
eslint (all changed paths)                  0 errors
node --check scripts/migrate.js             OK
pnpm install                                lockfile: workspace links only, 0 new
                                            resolution/integrity entries
pnpm build                                  see below
```

**Integration tests.** `qa-agent-billing-gate.integration.test.ts` was
updated (plugin import + a `getPluginRuntime()` await, the same boot a real
server performs) and **run for real** against a throwaway Postgres database
(`drizzle-kit push` onto a clean DB first — which also proved the plugin
schema lands through the config glob): **4/4 passed**, meaning the registry
boots the manifest, `core/data` accepts the `qa_agent_` namespace, the wiring
slot fills, and the trigger path's plan gate / quota / SSRF behaviour is
byte-compatible with the assertions written against the pre-migration code.
`qa-agent.integration.test.ts` (a full multi-minute run against
`the-internet.herokuapp.com` needing a live EB pool and an AI provider) had
its imports updated and type-checks, but was **not run** — no pool service or
provider credentials exist in this environment.

**The migrate step was exercised**, not just written: a throwaway DB seeded
with old-name tables, rows and live FKs; `node scripts/migrate.js` renamed,
preserved the rows, dropped both FKs, kept the UNIQUE. (The trailing
`push --force` in that same run hung against the deliberately-minimal seed
schema — an artifact of the two-column fake `repositories` table, not of the
step; push was verified separately on the clean DB above.)

**What is still unverified:** no `pnpm dev` click-through of the `/qa-agent`
page; no live pipeline run end-to-end (crawl, swarm, generate, heal); the
deletion hook was not fired against seeded rows (it is the explorer pattern
verbatim, and `manifests.test.ts` proves the registry demands it); comment
auto-attach of the `BrowserViewer` slot and the SSE narration hook were
reviewed, not clicked.

## 11. Paths

```
plugins/qa-agent/src/index.ts            manifest (browser, ai, data; schema; deletion)
plugins/qa-agent/src/wiring.ts           Symbol.for slot — runtime + host + data (explorer's shape)
plugins/qa-agent/src/host.ts             the 29-method port, grouped and future-annotated
plugins/qa-agent/src/actions.ts          the orchestrator + dispatchers (4,624 lines)
plugins/qa-agent/src/reads.ts            server-component/route reads
plugins/qa-agent/src/schema.ts           qa_agent_tasks + qa_agent_triggers (was schema.planned.ts)
plugins/qa-agent/src/deletion.ts         the cascade the DB no longer performs
plugins/qa-agent/src/data/{db,tasks,triggers}.ts
plugins/qa-agent/src/types.ts            narrowed session/step/metadata views (extended)
plugins/qa-agent/src/ui/                 11 moved components + format.ts + use-activity-events.ts

src/lib/core/qa-agent-host.ts            the fill — queries-only (host::db), satisfies assertions
src/lib/core/{manifests,runtime}.ts      registered; configureQaAgent({runtime, host, data})
src/lib/core/ai-capability.ts            +qa_auth_extract, +qa_plan, +qa_task_triage
src/lib/core/scheduler.ts                QA tick → plugin dispatcher
src/lib/core/app-map-host.ts             qa seams → plugin actions
src/lib/core/{agent-browser,auth-setup-resolution,quickstart-storage-shared}.ts   headers updated
plugins/quickstart/src/{host,index}.ts   shared-table story updated to mutual
plugins/app-map/src/host.ts              seam commentary updated
src/app/(app)/qa-agent/page.tsx          composition only; hands BrowserViewer down
src/app/(app)/app-map/{explore-progress-panel,cancel-exploration}.ts*  repointed
src/app/api/v1/[...slug]/route.ts        plugin reads/actions
src/app/api/webhooks/github/route.ts     plugin reads/actions
scripts/migrate.js                       migrateQaAgentTables() (fatal-catch)
Dockerfile, Dockerfile.migrate           +plugins/qa-agent/src/schema.ts COPY
packages/db/src/schema/agents.ts         two tables + three types removed
src/lib/db/queries.ts                    barrel note; two modules deleted
tools/architecture/boundaries.mjs        entry deleted; orphan verdicts recorded
tools/architecture/boundaries.test.ts    split-PR fixture updated

deleted: src/lib/qa-agent/, src/server/actions/qa-agent.ts,
         src/components/qa-agent/,
         src/lib/db/queries/{qa-tasks,qa-agent-triggers}.ts
```
