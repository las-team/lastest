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
 * What is left in `PSEUDO_PLUGINS` is `qa-agent` — the flagship, deliberately
 * last, and now the source of every remaining counted violation — plus
 * `spec-import`, oversized and genuinely unresolved.
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
  "qa-agent": {
    lib: ["src/lib/qa-agent"],
    actions: ["qa-agent.ts"],
    components: ["src/components/qa-agent"],
  },
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
  "spec-import": {
    lib: [],
    actions: ["spec-import.ts"],
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
