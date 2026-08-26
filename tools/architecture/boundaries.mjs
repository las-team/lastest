/**
 * Architecture boundary map — the single source of truth for §3/§7 of
 * `docs/architecture/core-plugin-refactor.md`.
 *
 * Consumed by:
 *   - `eslint.config.mjs`               → no-restricted-imports rules
 *   - `tools/architecture/graph.mjs`    → the import-graph walker
 *   - `tools/architecture/boundaries.test.ts` → the ratchet test (`pnpm test`)
 *
 * Two layouts are described at once, deliberately:
 *
 *   TARGET  `core/**` + `plugins/**` — the layout the RFC migrates to. Rules here
 *           are **error** from day one. Nothing lives there yet, so they cost
 *           nothing and they are already armed when the first package lands.
 *
 *   CURRENT `src/lib/<feature>` + `src/server/actions/<feature>.ts` — today's
 *           layout, treated as *pseudo-plugins*. Rules here are **warn**, and the
 *           violation count is ratcheted by the test so it can only go down.
 *
 * Deleting an entry from `PSEUDO_PLUGINS` is how a feature graduates: it moves to
 * `plugins/<id>/` and picks up the error-level rules instead. `explorer` was the
 * first to have done so; `design-system` and `a11y` followed in RFC §9 phase 3 —
 * all three entries are gone from the map below, and their violations with them.
 * `rca` is the first of RFC §9 phase 4 and went the same way; `app-map` is the
 * second, `launch` the third, `api-test` the fourth, `playground` the fifth,
 * `gamification` the sixth, `ci` the seventh — the last of which graduated
 * an entry that turned out to be two features, half of it core, see the `scm`
 * note in PSEUDO_PLUGINS below — and `share` the eighth, whose port (15
 * methods) is the largest of any phase-4 plugin so far. `captions.ts` /
 * `generate-captions.ts`, formerly under `src/lib/share/`, moved to
 * `src/lib/demo-captions/` instead of the plugin — see the migration result
 * doc for why; that directory is now an explicit `CORE_SRC_PATHS` entry.
 * `awards` is the ninth, an 8-method port `share`'s migration
 * was done partly to unblock — see `docs/architecture/awards-migration-result.md`.
 * `ranger` is the tenth, and the first out of the §6.2 `src/lib/playwright`
 * split: one method (`assertSafeOutboundUrl`) and one table (`ranger_sessions`,
 * replacing its slice of the shared `agent_sessions` — the same move `explorer`
 * made first). See `docs/architecture/ranger-migration-result.md`. `recorder`
 * is the eleventh, and the second out of the §6.2 split: `event-to-code.ts`
 * and `debug-parser.ts`, formerly listed under its `files`, turned out to be
 * core's own code (imported by `execution/executor.ts` and
 * `playwright/assertion-parser.ts`) misfiled next to the feature that
 * happened to use them too — both are pure, so they went to
 * `libs/recording-codegen` rather than into the plugin or into
 * `CORE_SRC_PATHS`. See `docs/architecture/recorder-migration-result.md`.
 * `data-sources` is the twelfth: cached, alias-keyed CSV/Google-Sheets test
 * data. Its map entry named three files; `spec-import.ts` was never this
 * feature (zero shared table/type/import with csv/google-sheets in either
 * direction — it is AI story extraction and test generation) and split into
 * its own uncosted `PSEUDO_PLUGINS["spec-import"]` entry below rather than
 * migrating with them. The Google Sheets OAuth token refresh — the one
 * credential-touching piece inside the migrated files — moved to
 * `src/lib/core/data-sources-host.ts` rather than `CORE_SRC_PATHS` (it has
 * exactly one caller, unlike `github`/`gitlab` OAuth). See
 * `docs/architecture/data-sources-migration-result.md`.
 * `scheduling` is the thirteenth: recurring build schedules and the
 * settings-page cron UI. Its map entry named two action modules;
 * `scanner.ts` was never this feature (zero shared table/type/import with
 * schedules/cron in either direction — it is route discovery and smoke-test
 * generation) and split into its own uncosted
 * `PSEUDO_PLUGINS["route-scan"]` entry below, the same call `data-sources`
 * made for `spec-import.ts`. The costed part was cheap — **1 host
 * method**, `ranger`'s tier — but `src/lib/scheduling/scheduler.ts`, sitting
 * next to it by directory convention, was not this feature either: three of
 * its four tick handlers dispatch *other* plugins' triggers, and
 * `core/jobs`'s own `worker.ts` already documented it as "the app's
 * scheduler" before this migration existed. Reclassified (§1.6) to
 * `src/lib/core/scheduler.ts` rather than left in place with a
 * `CORE_SRC_PATHS` entry, since it is composition-root code, not a
 * standalone boundary module. See
 * `docs/architecture/scheduling-migration-result.md`.
 * `quickstart` is the fourteenth and last of RFC §9 phase 4, and the third
 * (after `recorder`, `ranger`) out of the §6.2 `src/lib/playwright` split.
 * Its map entry named two files under `src/lib/playwright`; only one of them
 * was ever this feature. The migrated part's largest finding was sideways,
 * not core-ward (recipe §1.6.2): `storage-capture.ts` and
 * `quickstart-notes.ts` were also called directly by `qa-agent`/`demo`, two
 * other still-unmigrated pseudo-plugins at the time, so both moved to
 * `src/lib/core/` as shared composition-root code both sides call, rather
 * than becoming plugin exports a pseudo-plugin may not import. See
 * `docs/architecture/quickstart-migration-result.md`.
 *
 * `authoring-ai` is the fifteenth, unblocked by `54e05d08 core: AI browser
 * tools capability` (`AiCallOptions.browserTools`) after being costed and
 * stopped — see `docs/architecture/authoring-ai-migration-result.md`.
 *
 * **The pseudo-plugin residue pass** then resolved five entries that had
 * been split out of earlier migrations and left uncosted. They did not
 * resolve the same way, which is the point: `quickstart-scout` **migrated**
 * (the same core PR that unblocked `authoring-ai` unblocked it, at zero
 * further core cost); `static-scout` was **promoted to `libs/static-scout`**
 * (zero imports, zero core calls, one caller — never a plugin candidate);
 * `route-scan` was **reclassified core** (~26 `queries.*` calls for 327 LOC,
 * past recipe §1.5's stop line — `url-diff`'s verdict, and its reusable half
 * was already `libs/route-scan`); `demo` was **deleted and reclassified**
 * (two dead actions removed, two lib files core); and `demo-captions` got
 * the explicit `CORE_SRC_PATHS` entry it never had. See the RFC's status
 * line and `quickstart-migration-result.md` §12.
 *
 * `qa-agent` — the flagship, deliberately last — has now graduated to
 * `plugins/qa-agent/` (RFC §9 phase 4's sixteenth and final feature
 * migration): manifest, 29-method host port, actions, UI, and its two tables
 * (`qa_tasks` renamed to `qa_agent_tasks` by `migrateQaAgentTables()` in
 * `scripts/migrate.js`; sessions deliberately stayed in core's
 * `agent_sessions`, `kind: "qa"` — the `quickstart` shared-encryption
 * precedent, applied from the other side). See
 * `docs/architecture/qa-agent-migration-result.md`.
 *
 * What is left in `PSEUDO_PLUGINS` is the orphan trio `spec-import` /
 * `ai-routes` / `specs` — formerly uncosted; **costed as part of the
 * qa-agent migration** (recipe §1.5's counting discipline, recorded on each
 * entry below and in the qa-agent result doc §8). The verdicts differ, which
 * is the point of costing them separately: `ai-routes` is a Go (fold into
 * `authoring-ai`), `specs` wants reclassification as core, and `spec-import`
 * is a genuine stop at today's capability set. None of the three is
 * implemented here — an entry's verdict is a recorded decision for whoever
 * picks it up, not a side effect of somebody else's migration.
 */

/** Zone globs for the target layout. */
export const CORE_GLOB = "core/**/*.{ts,tsx}";
export const PLUGIN_GLOB = "plugins/**/*.{ts,tsx}";
/**
 * The third tier (`docs/architecture/core-scope.md` §3). Shared code that is
 * *useful to many* but guards nothing — no tenancy, capacity, money or
 * credential boundary. Importable by core and plugins alike, with no review
 * gate. Its existence is what stops every reusable helper from drifting into
 * core, which is how the RFC's core got to nine modules.
 */
export const LIB_GLOB = "libs/**/*.{ts,tsx}";

/**
 * Packages that are core by nature and stay in `packages/` (§3). Listed here so
 * CODEOWNERS, the split-PR check and the graph test agree on what "core" means.
 */
export const CORE_PACKAGES = [
  "packages/db",
  "packages/eb-protocol",
  "packages/pool-service",
  "packages/embedded-browser",
  "packages/shared",
];

/**
 * Paths inside `src/` that are core today (§6.1). A pseudo-plugin importing these
 * is fine — that is the whole point. They are enumerated so the walker can tell
 * "plugin → core" (allowed) from "plugin → plugin" (not allowed).
 */
export const CORE_SRC_PATHS = [
  "src/lib/db",
  "src/lib/eb",
  "src/lib/execution",
  "src/lib/diff",
  "src/lib/ai",
  "src/lib/auth",
  "src/lib/billing",
  "src/lib/security",
  "src/lib/rate-limit",
  "src/lib/verify",
  "src/lib/comparison",
  "src/lib/ws",
  "src/lib/storage",
  "src/lib/ocr",
  "src/lib/http",
  "src/lib/settings",
  "src/lib/constants",
  "src/lib/vars",
  "src/lib/hooks",
  "src/lib/utils",
  "src/lib/logger",
  "src/lib/crypto",
  "src/lib/crypto-fields",
  // Setup/teardown orchestration is part of the execution substrate (§6.1), not
  // a feature: every run resolves and runs it.
  "src/lib/setup",
  // Ad-hoc URL capture + diff. Was a pseudo-plugin (`url-diff`) until the
  // in-app page and sidebar entry were removed; what is left has no user
  // surface at all and exists only to serve `POST /api/v1/snapshot` and
  // `POST /api/v1/diff` (docs/specs/url-diff-integration.md). A documented
  // public API is core by any reading of core-scope.md §2 — it is the thing
  // other people build against.
  "src/lib/url-diff",
  // What is left of `src/lib/github` and `src/lib/gitlab` after
  // `@lastest/plugin-ci` took the CI-configuration half (RFC §9 phase 4):
  // OAuth authorize/exchange/refresh, encrypted token resolution, webhook
  // signature verification, and repo-content reads. Every one of those is a
  // credential boundary or is imported by something that is —
  // `src/lib/auth/auth.ts`, `src/lib/ai/codebase-intelligence.ts`,
  // `src/lib/change-map/compute.ts` — so `core-scope.md` §2 puts them in core
  // and the `scm` PSEUDO_PLUGINS entry is gone rather than shrunk.
  //
  // The plugin half (`github/actions.ts`, `github/workflow-yaml.ts`,
  // `gitlab/pipelines.ts`, `gitlab/ci-yaml.ts`) had exactly one consumer each:
  // its own action module. Reading the import lists rather than the directory
  // names is what made the split obvious — the same lesson `launch` recorded.
  "src/lib/github",
  "src/lib/gitlab",
  // The core half of the §6.2 split. The plugin half is enumerated per plugin
  // below; anything not named there stays core by default.
  "src/lib/playwright",
  // `demo` was never a migration candidate (RFC's `ranger-migration-result.md`
  // §2): `excalidraw-seed.ts` and `sandbox-seeds.ts` are called exclusively
  // from core-classified auth/onboarding code (`src/lib/auth/demo.ts`,
  // `src/server/actions/repos.ts`, `src/server/actions/onboarding.ts`). Its
  // two server actions, `signInAsDemo` and `generateNotesForBuild`, had zero
  // callers anywhere in the app (confirmed dead, re-verified before
  // deletion) and are gone, not carried forward.
  "src/lib/demo",
  // `demo-captions` — `captions.ts` (AI vision-pass caption generation) and
  // `generate-captions.ts` (build ↔ captions glue) — was never `share`'s:
  // its action module was never listed under that feature's `PSEUDO_PLUGINS`
  // entry, only its lib files were (see `share-migration-result.md` §4). Its
  // only two callers are `src/server/actions/captions.ts` and the
  // core-classified catch-all API route, both app-level, so it stays core
  // rather than gaining a `PSEUDO_PLUGINS` entry it never actually had.
  "src/lib/demo-captions",
];

/**
 * Dirs under `src/lib/` that are deliberately *unclassified*: the RFC does not
 * name them as core (§6.1) or as a plugin (§6.3), and guessing would put fake
 * numbers in the burndown. They are neither audited nor exempt — classifying one
 * is a decision for whoever migrates it.
 */
export const UNCLASSIFIED_SRC_PATHS = [
  "src/lib/change-map",
  "src/lib/email",
  "src/lib/integrations",
  "src/lib/legal",
  "src/lib/playback",
  "src/lib/selector-recommendations.ts",
  "src/lib/smart-selection",
  "src/lib/templates",
];

/**
 * Today's features, keyed by the plugin id they will carry in `plugins/<id>/`.
 *
 * `lib`        — feature directories under `src/lib/`
 * `files`      — individual files inside an otherwise-core dir (the §6.2 split)
 * `actions`    — server-action modules under `src/server/actions/`
 * `components` — feature component directories under `src/components/`
 *
 * The set is exactly §6.2 + §6.3 of the RFC. Nothing is added speculatively:
 * an entry here is a claim that the feature is destined for `plugins/<id>/`.
 *
 * Order matters only for readability; the walker builds a path→plugin index.
 */
export const PSEUDO_PLUGINS = {
  // `qa-agent` graduated to `plugins/qa-agent/` (RFC §9 phase 4, sixteenth
  // and last feature migration) — see
  // `docs/architecture/qa-agent-migration-result.md`. `src/lib/qa-agent`,
  // `src/server/actions/qa-agent.ts` and `src/components/qa-agent` are
  // deleted, not left as re-exports; the domain layer that migrated ahead in
  // the browser pass (`plugins/qa-agent/src/domain/`) is now internal to the
  // package rather than exported back to app code.
  // `demo`'s entry is gone — see the `CORE_SRC_PATHS` comment above for
  // `src/lib/demo`. It was never a migration candidate.
  // `awards` graduated to `plugins/awards/` (RFC §9 phase 4, ninth plugin) —
  // see `docs/architecture/awards-migration-result.md`. It was split out of
  // the original `gamification` map entry once reading the import lists
  // showed it shared nothing with Beat-the-Bot (no import in either
  // direction) and was a different shape entirely: repo award tiers computed
  // from build/test/diff history, a badge SVG endpoint, and a public page.
  // `share` migrated ahead of it (RFC §9 phase 4, eighth plugin) specifically
  // to unblock the two-way cross-read this feature needed with `share`'s own
  // table — see `src/lib/core/share-reads.ts` and
  // `src/lib/core/awards-host.ts`.
  // `data-sources` graduated to `plugins/data-sources/` (RFC §9 phase 4,
  // twelfth plugin) — see `docs/architecture/data-sources-migration-result.md`.
  // Its map entry named three files; only two of them were this feature.
  // `spec-import.ts` shares no table, type or import with csv/google-sheets
  // in either direction — it is AI-driven user-story extraction and test
  // generation, not a data source — so it did not move with them. It gets
  // its own entry below, uncosted, rather than being silently dropped from
  // the burndown.
  //
  // COSTED (qa-agent migration's §1.5 pass — evidence in
  // `qa-agent-migration-result.md` §8): 1,569 LOC calling **16 distinct
  // `queries.*` symbols** plus five more core modules (`@/lib/ai` +
  // `runParallel`, `@/lib/eb/claim-for-agent` — a RAW EB claim, the shape
  // `authoring-ai` had to wait for `AiCallOptions.browserTools` to shed —
  // `@/lib/github` content reads, `git-utils`, `agent_sessions` persistence).
  // Groups to ~10 debt items, past the recipe's ~8–15 band with a
  // browser-conversion prerequisite on top. **Verdict: stop** — the
  // `url-diff` row of §1.6's table, *without* the reclassify-core consolation:
  // unlike `url-diff` this is a real feature (its own dialog UI, its own
  // `spec_imports` table, AI story extraction) rather than a documented public
  // API, so it stays a pseudo-plugin until the port shrinks. What would
  // shrink it is already on the phase-5 list: the test-CRUD capability
  // (declared by api-test/quickstart/qa-agent), `core/identity`, and
  // converting its raw claim to `ctx.browser`/`browserTools`.
  "spec-import": {
    lib: [],
    actions: ["spec-import.ts"],
  },
  // `coverage` is new — it did not exist when phase 4 ran, so it has never
  // been costed as a migration. Data-driven coverage: dimension profiling
  // over CSV/Sheet caches and historical `test_results.assignedVariables`,
  // the cells that actually occur, a t-way stopping rule, and matrix
  // execution (one test x N data rows = N runs in one build).
  //
  // Entered on the ledger rather than left invisible, for the reason
  // `ai-routes` was: without an entry `crossPluginPatternsFor()` generates no
  // pattern for it and every edge into or out of it is unenforced. Adding it
  // surfaced three real violations, all now closed by the recipe §5 promotion
  // that landed with it rather than by a migration:
  //
  //   - The pure model — profiling, cells, weighting, the stopping rule,
  //     matrix expansion, the row-filter grammar, the spec renderer, the two
  //     SUT profilers — moved to `libs/coverage-model`. It imports nothing
  //     (§5 row one). Its value types and `DEFAULT_*` policies moved with it
  //     and `packages/db/src/schema/{coverage,tests}.ts` now import and
  //     re-export them, so `@/lib/db/schema` exports the same names as before
  //     — the arrangement the schema already had with `@lastest/eb-protocol`.
  //     Row types stay in the schema; the package narrows them (`CellLike`,
  //     `DimensionLike`, `TestVariableLike`).
  //   - `coverage-budget.ts` was sitting under `src/lib/qa-agent` while being
  //     coverage's own logic. It moved into the model as `budget.ts`, and its
  //     `MAX_PLAN_ITEMS` import became an injected `hardCap` — the planner
  //     owns its wall-clock ceiling, the model measures a data space.
  //   - `src/server/actions/qa-agent.ts` calling `ensureFreshCoverage`
  //     directly now routes through `src/lib/core/coverage-reads.ts`, the
  //     `share-reads.ts` / `data-sources-reads.ts` shape, and the same route
  //     `src/lib/core/scheduler.ts` already used for the other caller.
  //
  // What is left below is the genuinely stateful half — the queries, sync
  // orchestration, snapshots, attribution and the SUT profilers' execution.
  // It has NOT been costed for a migration; see
  // `docs/architecture/coverage-migration-brief.md` for the survey.
  coverage: {
    lib: ["src/lib/coverage"],
    actions: ["coverage.ts"],
    components: ["src/app/(app)/coverage"],
  },
  // `ai-routes` is `authoring-ai`'s second sideways orphan, and it is here for
  // the same reason `spec-import` is: to exist on the ledger at all. Until now
  // its only classification anywhere was prose in
  // `authoring-ai-migration-result.md` §2 — no `PSEUDO_PLUGINS` entry, so
  // `crossPluginPatternsFor()` had no pattern to generate for it and the
  // `authoring-ai` → `ai-routes.ts` edge was invisible to `pnpm arch` while
  // `authoring-ai` was still a pseudo-plugin (`plugin-migration-recipe.md`
  // §1.6.2, RFC progress note). That particular edge is legal today —
  // `authoring-ai` graduated, and it reaches this file through one
  // `AuthoringAiHost.aiScanRoutes` method filled by the composition root, the
  // `app-map` shape for calling an unmigrated neighbour — so adding the entry
  // moves the counter by 0. What it buys is forward cover: `qa-agent`, the one
  // pseudo-plugin left, now gets a generated pattern for these paths instead of
  // a blind spot, and the feature stops being unclassified in the one place
  // that is supposed to hold the classification.
  //
  // Uncosted, like `spec-import` — this entry is classification, not a
  // commitment to migrate. AI route scanning from repo source
  // (`aiScanRoutes`), live MCP exploration (`mcpExploreRoutes`) and branch-diff
  // scanning (`scanBranchDiff`) over core's `routes`/`functionalAreas` tables:
  // 799 LOC with its own three-component UI surface. Whether it graduates to a
  // plugin, folds into `authoring-ai`, or reclassifies to core the way
  // `route-scan` did is a costing exercise nobody had run — note the shape is
  // closer to `route-scan`'s (heavy `queries.*` against core tables) than to
  // `ranger`'s.
  //
  // COSTED (qa-agent migration's §1.5 pass): that guess was wrong — 803 LOC
  // calling only **6 distinct `queries.*` symbols** (3 route reads/writes, 1
  // area create, AI settings → `ctx.ai`, a GitHub token resolve that stays
  // host-side), nowhere near `route-scan`'s ~26. **Verdict: migrate — as a
  // fold into `authoring-ai`**, not a standalone plugin: `authoring-ai`
  // already reaches this file through `AuthoringAiHost.aiScanRoutes` (the
  // composition-root seam its own migration left), the two share the
  // AI-route-scanning domain outright, and the fold retires that host method
  // instead of declaring a sibling port. Its one raw
  // `claimEmbeddedBrowserForAgent` call (mcpExploreRoutes) converts to the
  // `ctx.browser` + `AiCallOptions.browserTools` shape `authoring-ai`
  // already uses. Evidence in `qa-agent-migration-result.md` §8.
  "ai-routes": {
    lib: [],
    actions: ["ai-routes.ts"],
  },
  // `specs` is the second of the pair, added with `ai-routes` for the same
  // reason and on the same terms: it was the *other* file
  // `authoring-ai-migration-result.md` §4 left as an unclassified orphan, and
  // splitting them would just leave the ledger half-corrected. 643 LOC of
  // test-spec CRUD and area plan/spec sync over core's `functionalAreas`/
  // `tests` tables, three component callers plus one
  // `AuthoringAiHost.syncAreaPlanAndSpecs` method.
  //
  // COSTED (qa-agent migration's §1.5 pass): 643 LOC calling **14 distinct
  // `queries.*` symbols**, essentially all of them spec/test/area CRUD
  // against core tables (`test_specs`, `tests`, `functional_areas`) with no
  // domain layer of its own — a port at the stop line for a feature smaller
  // than `ranger`. **Verdict: reclassify as core** (§1.6's second row, the
  // `route-scan` outcome): test specs are core's own test-authoring surface
  // — consumed by the record panel, the test-definition page and the areas
  // panel, all core UI — and "a thin orchestration of core" is exactly the
  // shape §1.5 says not to wrap in a keyhole port. Implementing that
  // reclassification (a `CORE_SRC_PATHS`-adjacent decision plus CODEOWNERS)
  // is its own change, deliberately not bundled here. Evidence in
  // `qa-agent-migration-result.md` §8.
  specs: {
    lib: [],
    actions: ["specs.ts"],
  },
  // `scm` is gone, and it is the first entry to graduate as **two things**.
  // RFC §6.3 mapped it to all of `src/lib/github` + `src/lib/gitlab` + two
  // action modules; reading the import lists split it cleanly:
  //
  //   - CI configuration (workflow/CI-file generation, provider REST calls,
  //     the two config tables, the settings cards) → `plugins/ci/`.
  //   - OAuth, tokens, webhook verification, repo-content reads → core. They
  //     are listed in CORE_SRC_PATHS above; see the comment there.
  //
  // The plugin is named `ci`, not `scm`, deliberately: core now owns the
  // source-control *credentials*, so a plugin called `scm` would be a lie about
  // where the boundary is.
  //
  // `scheduling` graduated to `plugins/scheduling/` (RFC §9 phase 4,
  // thirteenth plugin) — see
  // `docs/architecture/scheduling-migration-result.md`. Its map entry named
  // two action modules; only `schedules.ts` was this feature. `scanner.ts`
  // shares no table, type or import with schedules/cron in either
  // direction — it is repository route discovery, functional-area creation
  // and smoke-test generation against core's `routes`/`functionalAreas`/
  // `tests` tables, with a port that would run past recipe §1.5's stop line.
  // It got its own uncosted `PSEUDO_PLUGINS["route-scan"]` entry rather than
  // migrating with them or being silently dropped from the burndown — the
  // same call `data-sources` made for `spec-import.ts`.
  //
  // `route-scan`'s entry is gone: costing it out found ~26 distinct
  // `queries.*` calls for 327 LOC of feature code, past recipe §1.5's stop
  // line and larger than the feature it would serve — `url-diff`'s shape,
  // not `ranger`'s. Reclassified as core rather than migrated (`scanner.ts`
  // stays at `src/server/actions/scanner.ts`, unmoved); the actual reusable
  // boundary already lives one layer down, in the already-promoted
  // `libs/route-scan` package that `qa-agent.ts` also imports directly,
  // sidestepping `scanner.ts` entirely.
  // §6.2 — the `src/lib/playwright` split. `lib` stays empty; these plugins own
  // named files inside a directory that is otherwise core.
  //
  // `recorder` graduated to `plugins/recorder/` (RFC §9 phase 4, eleventh
  // plugin) — see `docs/architecture/recorder-migration-result.md`. Its
  // `debug-recorder.ts` was deleted rather than migrated (zero callers,
  // confirmed dead); `event-to-code.ts` and `debug-parser.ts` went to
  // `libs/recording-codegen`, not the plugin — both are pure and core's own
  // `execution/executor.ts` / `playwright/assertion-parser.ts` import them
  // too.
  // `authoring-ai` graduated to `plugins/authoring-ai/` (RFC §9 phase 4,
  // fifteenth plugin), unblocked by `54e05d08 core: AI browser tools
  // capability` (`AiCallOptions.browserTools`) — see
  // `docs/architecture/authoring-ai-migration-result.md` for the original
  // stop/re-cost history. `generator-agent.ts`/`healer-agent.ts`/
  // `enhancer-agent.ts`/`planner-agent.ts` and the `planners/` directory are
  // deleted, not left as re-exports; every MCP-driven call now passes
  // `ctx.ai.generate({ browserTools: session })` a `BrowserSession` from
  // `ctx.browser.withBrowser(...)`, never a raw CDP endpoint. Blocker (2)'s
  // two sideways calls (`spec-import.ts`, `ai-routes.ts`) did not resolve —
  // they are host-port methods filled by the composition root
  // (`src/lib/core/authoring-ai-host.ts`), the `app-map` shape for a call
  // into an unmigrated neighbour. Both remain unclassified orphans.
  // `quickstart` graduated to `plugins/quickstart/` (RFC §9 phase 4,
  // fourteenth and last plugin) — see
  // `docs/architecture/quickstart-migration-result.md`. `src/lib/quickstart`,
  // `src/server/actions/quickstart-agent.ts` and `src/components/quickstart`
  // are deleted, not left as re-exports. `quickstart-scout.ts` did NOT
  // migrate at the time — it hit the same raw-CDP-to-MCP blocker that
  // stopped `authoring-ai` — and got its own uncosted
  // `PSEUDO_PLUGINS["quickstart-scout"]` entry, reached from the plugin
  // through five `QuickstartHost` methods instead of an import.
  //
  // That entry is now gone too: `54e05d08 core: AI browser tools capability`
  // (`AiCallOptions.browserTools`) unblocked it, exactly as
  // `authoring-ai-migration-result.md` predicted it would unblock both. The
  // scout moved into the plugin as `plugins/quickstart/src/scout.ts` and
  // drives the browser through `ctx.ai.generate({ browserTools: session })`
  // on a session from `ctx.browser.withBrowser(...)`. All five host methods
  // were retired, plus `getStorageStateJson` — `BrowserClaimOptions.
  // storageStateId` injects by id, so the credential material no longer
  // crosses the boundary at all. See `quickstart-migration-result.md` §12.
  // `static-scout.ts` was never `quickstart` — zero shared import, table or
  // type with `quickstart-scout.ts` in either direction, just the word
  // "scout" in both names, and it turned out to need no core primitive at
  // all: zero imports, one caller (the core-classified catch-all API route,
  // `POST /api/v1/scout`, also exposed over MCP as `lastest_scout_url`). Not
  // a plugin candidate at any size — promoted to `libs/static-scout`
  // (core-scope.md §3, same tier as `libs/route-scan`) instead of migrating,
  // dropping, or leaving it attached to a plugin that no longer exists.
  // `ranger` graduated to `plugins/ranger/` (RFC §9 phase 4, tenth plugin) —
  // see `docs/architecture/ranger-migration-result.md`. The first plugin out
  // of the §6.2 split: `src/lib/playwright/ranger.ts` is deleted, not left as
  // a re-export, so `src/lib/playwright` now has three `files` owners instead
  // of four.
};

/**
 * Module specifiers a plugin must never import directly, with the capability that
 * replaces each. This list *is* R4: every entry is a way to reach the platform
 * without going through core.
 */
export const FORBIDDEN_PLUGIN_IMPORTS = [
  {
    id: "browser",
    patterns: [
      "playwright",
      "playwright-core",
      "playwright/*",
      "@playwright/test",
      "@playwright/test/*",
      "chromium-bidi",
    ],
    message:
      "Plugins must not drive a browser directly. Use `ctx.browser` (@lastest/core-browser).",
  },
  {
    id: "pool-service",
    patterns: ["@lastest/pool-service", "@lastest/pool-service/*"],
    message:
      "Plugins must not claim EBs directly. Use `ctx.browser.withBrowser()`.",
  },
  {
    // `@lastest/core-browser` itself is fine — it is core, and a plugin
    // importing its types or error classes is ordinary. The `/internal`
    // subpath is not: it exists solely so the composition root can turn a
    // `BrowserSession` back into a CDP endpoint when filling
    // `AiCallOptions.browserTools`. Reachable from a plugin, it would undo the
    // one sentence `core/contracts/src/browser.ts` makes about the session
    // type ("notably absent is any way to obtain the CDP URL or the pod
    // address"), which is the whole reason `browserTools` could be added
    // without relaxing anything.
    id: "browser-internal",
    patterns: ["@lastest/core-browser/internal"],
    message:
      "`@lastest/core-browser/internal` resolves a session to a pod address and is composition-root-only. A plugin passes the opaque session to `ctx.ai.generate({ browserTools })` instead.",
  },
  {
    id: "db",
    patterns: ["@lastest/db", "@lastest/db/*", "pg", "postgres"],
    message: "Plugins must not open the database directly. Use `ctx.data`.",
  },
  {
    id: "ai",
    patterns: [
      "@anthropic-ai/*",
      "openai",
      "openai/*",
      "ollama",
      "@google/generative-ai",
    ],
    message: "Plugins must not call AI providers directly. Use `ctx.ai`.",
  },
];

/**
 * Restrictions that only make sense for a *pseudo*-plugin — code still sitting
 * in `src/`, sharing the app's `db` handle with all 98 tables on it.
 *
 * The explorer migration is what forced this split out of the `db` rule above.
 * That rule banned `drizzle-orm` outright, which made `manifest.schema`
 * unimplementable: declaring a table needs `pgTable` from `drizzle-orm/pg-core`
 * and a `where` clause needs `eq` from `drizzle-orm`. Neither opens a
 * connection — spike S2 made the same point about `@lastest/db/schema`.
 *
 * So the ban was aimed at the wrong noun. What a plugin must never import is a
 * *connection* (`@lastest/db`, `pg`, `postgres`), and that stays banned
 * everywhere. The query builder is banned only here, in the current layout,
 * where importing it means writing raw SQL against core tables through the
 * shared handle — which is exactly what the eight remaining violations are.
 *
 * A packaged plugin does not get the same carve-out for free. Its query builder
 * is bound to a schema `core/data` validated as `<id>_`-prefixed, and it cannot
 * import `@lastest/db` to get another one. Those two facts are the guarantee;
 * banning `drizzle-orm` was never part of it.
 */
export const PSEUDO_PLUGIN_IMPORTS = [
  {
    id: "db",
    patterns: ["drizzle-orm", "drizzle-orm/*"],
    message:
      "Feature code must not query the database directly. Use the query layer in src/lib/db/queries, or migrate to a plugin and use `ctx.data`.",
  },
];

/** Extra restrictions that only make sense once a plugin is a real package. */
export const PACKAGED_PLUGIN_IMPORTS = [
  {
    id: "app",
    patterns: ["@/*"],
    message:
      "Plugins must not import Next.js app code. Use @lastest/kernel + the capabilities on `ctx`.",
  },
  {
    id: "cross-plugin",
    patterns: ["@lastest/plugin-*", "../../*/src/*"],
    message:
      "Plugins must not import other plugins. Compose via `ctx.jobs` / `ctx.events`.",
  },
];

/** Core must never learn that a plugin exists, or that Next.js exists. */
export const FORBIDDEN_CORE_IMPORTS = [
  {
    id: "core-to-plugin",
    patterns: ["@lastest/plugin-*", "../../plugins/*", "@/lib/plugins/*"],
    message:
      "Core must not know about plugins. Invert the dependency: expose a capability and let the plugin call it.",
  },
  {
    id: "core-to-app",
    patterns: ["@/*"],
    message:
      "Core must not import the Next.js app — the composition root (src/lib/core/runtime.ts) injects app primitives as host implementations instead. See src/lib/core/*-host.ts.",
  },
];

/**
 * The same `core-to-plugin` ban as above, aimed at **today's** core — the
 * `CORE_SRC_PATHS` ledger — instead of at the target layout's `core/**`.
 *
 * `FORBIDDEN_CORE_IMPORTS` has always described a directory that is still
 * empty, so the rule it states most loudly ("core must never learn that a
 * plugin exists") was enforced only where nothing lives. Meanwhile the ledger
 * fifty lines up enumerates the code that *is* core today, and nothing counted
 * what it imported. Five files had drifted through the gap, all of them core
 * reaching for a plugin's **domain logic**: WCAG scoring, design-token
 * comparison, an API-test runner. The arrow pointed exactly the wrong way.
 *
 * Only the `core-to-plugin` half is reused. `core-to-app` cannot apply here and
 * never will: today's core lives *inside* the Next.js app and reaches its
 * neighbours through `@/…` on every other line. That rule is a statement about
 * the layout core is migrating *to*, and asserting it against `src/` would
 * report a thousand violations describing a move nobody has made yet. The
 * patterns are duplicated rather than derived so this list reads as a list;
 * `boundaries.test.ts` asserts the two stay identical.
 *
 * **Severity is warn, and the ratchet is above zero** — unlike
 * `FORBIDDEN_HOST_IMPORTS` below, which was written after its violations were
 * already fixed. This one is written with one real violation still standing
 * (`src/lib/execution/executor.ts` → `@lastest/plugin-api-test/runner`, a
 * lazy `await import` inside the step dispatcher). That is feature *runtime*,
 * not shared math: it drives an HTTP request, redacts secrets and writes
 * evidence, so it cannot be promoted to `libs/` the way the other four were.
 * It wants an inverted dependency — a capability core exposes and the plugin
 * fills — which is a core PR, not an import swap. Counted where it can be
 * seen, in the burndown, exactly as `video-fallback` was left counted in
 * `shared-dependency-promotions.md` §4.
 *
 * The other four are gone as of this rule's arrival, and they are gone the way
 * `core-scope.md` §3 says shared code should go — **promoted to `libs/`**, not
 * exempted:
 *
 *   - `@lastest/plugin-a11y/wcag-score` → `libs/wcag-score`, killing three
 *     (`src/lib/diff/a11y-diff.ts`, `src/lib/db/queries/builds.ts`,
 *     `src/lib/url-diff/capture.ts`).
 *   - `@lastest/plugin-design-system/tokens` → `libs/design-tokens`, killing
 *     one (`src/lib/execution/executor.ts`).
 *
 * Both were pure arithmetic over `@lastest/eb-protocol` types that core needed
 * as badly as the plugin did — the `libs/` tier exists precisely so that fact
 * does not have to be settled by either importing the other.
 */
export const FORBIDDEN_CORE_SRC_IMPORTS = [
  {
    id: "core-to-plugin",
    patterns: ["@lastest/plugin-*", "../../plugins/*", "@/lib/plugins/*"],
    /**
     * The one sanctioned exception, expressed as a file carve-out rather than
     * as a baseline entry — and the distinction is the point.
     *
     * A baseline entry means *"wrong, not fixed yet, may only decrease"*. That
     * would be a lie about this import: `src/lib/verify/check-layers.ts` is the
     * check-layer registration point, and importing each plugin's narrow
     * `./check-layer` subpath is the shape the file's own header argues for at
     * length — it is client-bundled, so it must NOT go through
     * `src/lib/core/manifests.ts`, whose manifests eagerly pull in every
     * plugin's `schema`/`deletion` (drizzle-orm and friends). The alternative
     * is not a smaller import, it is drizzle in the browser bundle.
     *
     * Baselining it would also be actively harmful: the ratchet is per
     * `<plugin>::<rule>` key, so parking two sanctioned imports in
     * `core::core-to-plugin` would raise the allowance that the *unsanctioned*
     * executor import is measured against, and a third plugin contributing a
     * check layer would then look like a regression while a genuinely new
     * violation somewhere else in core would not. Encoding the exemption in
     * the rule keeps the counted number meaning only "core reached into a
     * plugin's domain logic".
     *
     * This is the same call `FORBIDDEN_HOST_IMPORTS` makes below with
     * `allowTypeImports` and with `@/lib/db` listed as an exact specifier: a
     * carve-out that is *permanent and correct* belongs in the rule's shape,
     * where it can carry its reasoning, not in a ratchet file that promises
     * someone will delete it.
     *
     * Deliberately narrow — one file, listed literally. `src/lib/core/` needs
     * no entry: it is the composition root, is not in `CORE_SRC_PATHS`, and
     * knowing every plugin by name is its entire job.
     */
    allowFiles: ["src/lib/verify/check-layers.ts"],
    message:
      "Core must not import a plugin's domain logic. If both sides genuinely " +
      "need it, promote the shared part to libs/ (core-scope.md §3) — that is " +
      "what libs/wcag-score and libs/design-tokens are. If it is feature " +
      "runtime, invert the dependency: expose a capability and let the plugin " +
      "call it.",
  },
];

/**
 * The composition root's host adapters — `src/lib/core/*-host.ts`, the files
 * that fill a plugin's host port with app primitives.
 *
 * None of the rules above reach them, and that gap is why this one exists.
 * `src/lib/core` is not a `PSEUDO_PLUGINS` entry (it never will be — it is the
 * wiring, not a feature), so the `drizzle-orm` ban in `PSEUDO_PLUGIN_IMPORTS`
 * does not apply; and `FORBIDDEN_CORE_IMPORTS` describes the *target* layout's
 * `core/**`, where importing `@/…` at all is the violation. Four hosts had
 * drifted into the gap: `share`, `quickstart`, `design-system` and `recorder`
 * were each writing `db.select().from(<core table>)` inline. That is a second
 * query layer — one with no tenancy filter, no encryption-on-write and no
 * activity event — growing next to the owned one in `src/lib/db/queries/`,
 * which every compliant host (`awards-host.ts` is the model) delegates to.
 *
 * So the ban here is narrower than the plugin one: not "no database", but "no
 * database *except* through the query layer". `@/lib/db/queries` and its
 * submodules are deliberately absent from the patterns — they are the thing a
 * host is supposed to call, and `@/lib/db` is listed as an exact specifier
 * rather than a prefix precisely so it cannot swallow them.
 *
 * **Type-only imports are not counted** (`allowTypeImports`). `import type
 * { Repository } from "@/lib/db/schema"` is erased before anything runs: it
 * opens no connection and writes no row. That is the same distinction that
 * moved `drizzle-orm` out of the plugin `db` rule and into
 * `PSEUDO_PLUGIN_IMPORTS` in the first place — what must never cross the line
 * is a *handle*, not the name of a shape. Four already-compliant hosts
 * (`app-map`, `authoring-ai`, `ci`, `events`) map rows to plugin DTOs through
 * exactly such an import, so counting them would make the rule fire hardest on
 * the code it is meant to describe as correct. The inline form
 * (`import { type A } from "x"`) is still counted — see the note on
 * `isTypeOnlyFromClause` in `graph.mjs` for why erring that way is the safe
 * direction.
 */
export const HOST_GLOB = "src/lib/core/*-host.ts";

export const FORBIDDEN_HOST_IMPORTS = [
  {
    id: "db",
    patterns: [
      "@/lib/db",
      "@/lib/db/schema",
      "@lastest/db",
      "@lastest/db/*",
      "drizzle-orm",
      "drizzle-orm/*",
    ],
    allowTypeImports: true,
    message:
      "A host adapter must not query the database directly. Call the owned " +
      "query layer in src/lib/db/queries — that is where tenancy filters, " +
      "encryption-on-write and activity events live. Type-only imports of " +
      "schema shapes are fine.",
  },
];

/**
 * Libraries are shared, but they are still below both other tiers: a lib that
 * imports a plugin would smuggle a feature into everything that uses the lib,
 * and a lib reaching into the Next.js app is not a lib.
 */
export const FORBIDDEN_LIB_IMPORTS = [
  {
    id: "lib-to-plugin",
    patterns: ["@lastest/plugin-*", "../../plugins/*"],
    message:
      "A library must not import a plugin — that would pull a feature into every consumer. Invert it: the plugin depends on the lib.",
  },
  {
    id: "lib-to-app",
    patterns: ["@/*"],
    message:
      "A library must not import Next.js app code. Move what it needs into the lib, or leave the code in the app.",
  },
];

/**
 * Cross-plugin import rule for the CURRENT layout. A pseudo-plugin importing
 * another pseudo-plugin's `@/lib/<id>` is the `plugin → plugin` violation.
 */
/** Every repo-relative source path a pseudo-plugin owns (dirs and files). */
export function pseudoPluginPaths(def) {
  return [
    ...def.lib,
    ...(def.files ?? []),
    ...(def.components ?? []),
    ...(def.actions ?? []).map((f) => `src/server/actions/${f}`),
  ];
}

/**
 * `@/…` specifiers that belong to some *other* pseudo-plugin — i.e. the
 * `plugin → plugin` violation, expressed as ESLint import patterns.
 */
export function crossPluginPatternsFor(pluginId) {
  return Object.entries(PSEUDO_PLUGINS)
    .filter(([id]) => id !== pluginId)
    .flatMap(([, def]) => pseudoPluginPaths(def))
    .map((p) => {
      const alias = `@/${p.replace(/^src\//, "")}`;
      // A file entry is imported without its extension; a dir entry by subpath.
      return /\.tsx?$/.test(p) ? alias.replace(/\.tsx?$/, "") : `${alias}/*`;
    });
}

/** All source globs owned by a pseudo-plugin, for ESLint `files`. */
export function pseudoPluginFiles(def) {
  return pseudoPluginPaths(def).map((p) =>
    /\.tsx?$/.test(p) ? p : `${p}/**/*.{ts,tsx}`,
  );
}

/**
 * The same shape for today's core, so the ESLint block mirroring
 * `scanCoreSrc` covers exactly the ledger the walker walks. A `CORE_SRC_PATHS`
 * entry may be a directory or a single file, as `UNCLASSIFIED_SRC_PATHS`
 * already shows.
 */
export function coreSrcFiles() {
  return CORE_SRC_PATHS.map((p) =>
    /\.tsx?$/.test(p) ? p : `${p}/**/*.{ts,tsx}`,
  );
}
