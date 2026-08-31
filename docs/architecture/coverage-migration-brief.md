# `coverage` — migration survey (not yet costed to Go)

**Status:** survey only. `coverage` did not exist when RFC §9 phase 4 ran, so
it has never appeared in a burndown. It arrived on this branch as a feature
built against the pre-refactor layout and was rebased onto it; this document
records what that rebase resolved, and what a migration to `plugins/coverage`
would still have to do.

Nothing here has been migrated. The recipe §5 promotion described in §2 *has*
landed, because it was the cheapest way to close three real violations and
because §5 says a promotion is its own pass **before** a migration, never
inside one.

## 1. What the feature is

Coverage is measured over a **data space**, not a page count. A *dimension* is
a field with an enumerable value domain (country, call type, channel); a *cell*
is a combination of dimension values that actually occurs in the data. Cells
carry a weight, so the QA agent gets a principled stopping rule instead of a
hardcoded `MAX_PLAN_ITEMS = 20`.

Matrix execution is the same model applied to running: one test × N data rows =
N runs in one build, reduced by a greedy t-way covering set.

Cell↔run attribution is free — the executor already persists the resolved
assign-mode variable map on `test_results.assignedVariables`, and that map *is*
the cell coordinate of the run.

Four tables, all already `coverage_`-prefixed: `coverage_dimensions`,
`coverage_cells`, `coverage_cell_runs`, `coverage_snapshots`. Recipe §2.4's
rename hazard does not apply — this is the first feature since `playground`
where that was luck rather than work.

## 2. What the rebase resolved (recipe §5 promotion)

Registering `coverage` in `PSEUDO_PLUGINS` surfaced three violations. All three
are closed, and none of them by a migration:

| Edge | Resolution |
| --- | --- |
| `qa-agent` → `@/lib/coverage/{rollup,stop}` | `coverage-budget.ts` was sitting under `src/lib/qa-agent` while being coverage's own logic. Moved into `libs/coverage-model` as `budget.ts`. |
| `qa-agent` → `@/lib/coverage/budget` | The module is pure, so it is a library, not core (§5 row one). |
| `qa-agent` (action) → `@/lib/coverage/sync` | Routed through `src/lib/core/coverage-reads.ts`, the `share-reads.ts` / `data-sources-reads.ts` shape — and the same route `src/lib/core/scheduler.ts` already used for the other caller of `ensureFreshCoverage`. |

`libs/coverage-model` holds the pure half: profiling, cells, coords, weighting,
the stopping rule, matrix expansion, the row-filter grammar, the spec renderer,
the churn signal and the two read-only SUT profilers. It imports nothing.

Its **value types and `DEFAULT_*` policies moved with it**, and
`packages/db/src/schema/{coverage,tests}.ts` import and re-export them. That is
recipe §6.1 row one applied to a schema rather than to `eb-protocol`: no app
import path changed, `@/lib/db/schema` still exports `CoverageStopPolicy`,
`MatrixPolicy`, `DEFAULT_COVERAGE_ENVIRONMENT` and the rest. Table row types
cannot leave `packages/db` (they are `$inferSelect`), so the package narrows
them instead — `CellLike`, `DimensionLike`, `TestVariableLike` in `types.ts`.

**Two edges the walker cannot see** were resolved by the same promotion, and
would otherwise have been invisible (§1.6, the core→feature blind spot):

- `src/lib/execution/matrix-expand.ts` — core's own fan-out at the top of
  `executeTests()` — imported `@/lib/coverage/matrix`. It now imports the
  library. This is the honest shape: the fan-out is core's, the expansion
  algorithm is the model's.
- `src/components/tests/{matrix-policy-card,var-edit-dialog}.tsx` imported the
  model directly for client-side preview. Same fix.

## 3. Costing the host port (§1.5) — the survey

What is left in `src/lib/coverage` is the stateful half: `sync.ts`, `trend.ts`,
`profilers/index.ts`, `source-rows.ts`. Counting distinct **core** functions it
calls, grouped by what each one *is*:

| Group | Methods | Note |
| --- | --- | --- |
| Its own four tables | 0 | `ctx.data` — these are `coverage_*` rows, not core's |
| Historical run attribution | 3 | `getAssignedVariableRuns`, `getCoverageAttributionTimeline`, `getDataCellResults` all join `test_results` / `test_runs` / `builds`. One capability, three reads. |
| Tabular data sources | 2 | `csvDataSourceTablesForRepo`, `sheetDataSourceTablesForRepo` — already narrowed and already routed through `src/lib/core/data-sources-reads.ts`. Cross-**plugin**, so they must become host methods; they cannot become a direct import. |
| Repo authorization | 0 | `requireRepoAccess` becomes `contextFor(coveragePlugin, { repositoryId })` — recipe §1.7, the `explorer`/`ci` shape. |

**Port size ≈ 5, grouping to 2 items.** That is `api-test`'s tier — a Go by
§1.5's table. The three attribution reads are one missing capability ("give me
the assign-mode variable maps for this repo's runs"), which is the same shape
`ctx.tests` would grow into and is worth checking against before declaring it.

The two data-source methods are worth flagging under §1.5's "check your port
against the ports that already exist" rule: they are a **cross-plugin read of
another plugin's storage-backed rows**, and `data-sources` is the only plugin
that owns both a table and a blob. If a second consumer of that data appears,
the honest fix is a core capability, not a third narrow read.

## 4. What a migration would still have to do

1. Move the four tables to `plugins/coverage/src/schema.ts`. The names already
   satisfy `validateSchemaNamespace`, so `scripts/migrate.js` needs a **FK
   drop** but no rename (§7): three FKs to `repositories` (all `cascade`) and
   one to `test_results` (also `cascade`).
2. **`coverage_cell_runs.test_result_id → test_results.id` has no
   `DeletionTarget`.** It is not team, repo or user scoped — it hangs off a
   single test result. Recipe §2.1 row three: no hook can fire, so deleting a
   test result would leave orphaned attribution rows. This must be written into
   `host.ts` and `deletion.ts` and costed honestly; a fourth `DeletionTarget`
   is a core PR and must not be bolted onto the migration.
3. `onRepoDeleted` covers the other three tables.
4. The Coverage page (`src/app/(app)/coverage/`) moves to
   `plugins/coverage/src/ui/page.tsx` with the app keeping only the
   composition, per §6.
5. **~~Ten `"use server"` exports, four action ids.~~ Fixed — five exports
   remain, all with UI callers.** The production build minted ids for only 4 of
   the 10 exports in `src/server/actions/coverage.ts`. Per §8's table that was
   the "fewer, but not zero" case: the rest were unreachable from any client
   boundary — server components read the queries directly — so they were **dead
   actions**. Rather than move them as a `reads.ts`, they were deleted:
   `syncCoverageAction` and `profileFromSutAction` first (each has a note in the
   file saying why it must not come back), then
   `profileCoverageDimensionsAction`, `getCoverageReportAction`,
   `getCoverageTrendAction`, `listCoverageDimensionsAction` and
   `listCoverageCellsAction`. The five survivors are all dispatched from
   `coverage-client.tsx`. This was the same finding `ci` had (10 of 13), and was
   worth fixing whether or not the migration happens: a `"use server"` export
   nobody dispatches is an unauthenticated-by-default entry point.

## 5. What was NOT verified

Per recipe §9, stated explicitly:

- **No `db:push` was run.** The schema changes (four new tables, plus
  `tests.matrix_policy`, `test_results.{data_cell,matrix_index,matrix_total}`,
  `baselines.data_cell`) have been type-checked and the build compiles, but
  nothing has been pushed to a database, on this branch or any other.
- **No runtime click-through.** The Coverage page renders in the build's route
  table (`ƒ /coverage`) and typechecks; nobody has loaded it against real data
  on this base.
- **No SUT profiler was exercised.** `VaultProfiler` and `RestProfiler` have
  unit tests over fixtures; neither has run against a live Vault or REST
  endpoint since the rebase.
- ~~**The six dead actions in §4.5 were identified from the build manifest, not
  by tracing callers.**~~ Since resolved: each was traced by name across `src/`,
  `plugins/`, `packages/`, `libs/`, `scripts/`, `tools/` and `docs/`, found to
  have no caller, and deleted (see §4.5).
