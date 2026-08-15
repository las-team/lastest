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
 * doc for why. `awards` is the ninth, an 8-method port `share`'s migration
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
];

/**
 * Dirs under `src/lib/` that are deliberately *unclassified*: the RFC does not
 * name them as core (§6.1) or as a plugin (§6.3), and guessing would put fake
 * numbers in the burndown. They are neither audited nor exempt — classifying one
 * is a decision for whoever migrates it.
 */
export const UNCLASSIFIED_SRC_PATHS = [
  "src/lib/analytics",
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
  demo: { lib: ["src/lib/demo"], actions: ["demo.ts", "demo-notes.ts"] },
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
  "data-sources": {
    lib: ["src/lib/csv", "src/lib/google-sheets"],
    actions: ["csv-sources.ts", "google-sheets.ts", "spec-import.ts"],
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
  scheduling: {
    lib: ["src/lib/scheduling"],
    actions: ["schedules.ts", "scanner.ts"],
  },
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
  "authoring-ai": {
    lib: [],
    files: [
      "src/lib/playwright/generator-agent.ts",
      "src/lib/playwright/healer-agent.ts",
      "src/lib/playwright/enhancer-agent.ts",
      "src/lib/playwright/planner-agent.ts",
      "src/lib/playwright/planner-merger.ts",
      "src/lib/playwright/planner-types.ts",
      "src/lib/playwright/planners",
      "src/lib/playwright/scenario-grouping.ts",
    ],
    actions: [],
  },
  quickstart: {
    lib: ["src/lib/quickstart"],
    files: [
      "src/lib/playwright/quickstart-scout.ts",
      "src/lib/playwright/static-scout.ts",
    ],
    actions: ["quickstart-agent.ts"],
    components: ["src/components/quickstart"],
  },
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
