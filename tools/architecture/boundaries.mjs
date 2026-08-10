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
 * `plugins/<id>/` and picks up the error-level rules instead. `explorer` is the
 * first to have done so — its entry is gone from the map below, and its five
 * violations went with it.
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
  "app-map": { lib: ["src/lib/app-map"], actions: ["app-map.ts"] },
  demo: { lib: ["src/lib/demo"], actions: ["demo.ts", "demo-notes.ts"] },
  share: {
    lib: ["src/lib/share"],
    actions: ["public-shares.ts"],
    components: ["src/components/share"],
  },
  gamification: {
    lib: ["src/lib/gamification", "src/lib/awards"],
    actions: ["gamification.ts"],
    components: ["src/components/gamification", "src/components/awards"],
  },
  launch: { lib: ["src/lib/launch"], actions: [] },
  "api-test": {
    lib: ["src/lib/api-test"],
    actions: ["api-tests.ts"],
    components: ["src/components/api-tests"],
  },
  "url-diff": { lib: ["src/lib/url-diff"], actions: ["url-diff.ts"] },
  rca: { lib: ["src/lib/rca"], actions: ["rca.ts"] },
  "design-system": {
    lib: ["src/lib/design-system"],
    actions: ["design-system-overrides.ts"],
  },
  a11y: { lib: ["src/lib/a11y"], actions: [] },
  playground: { lib: ["src/lib/playground"], actions: [] },
  "data-sources": {
    lib: ["src/lib/csv", "src/lib/google-sheets"],
    actions: ["csv-sources.ts", "google-sheets.ts", "spec-import.ts"],
  },
  scm: {
    lib: ["src/lib/github", "src/lib/gitlab"],
    actions: ["github-actions.ts", "gitlab-pipelines.ts"],
  },
  scheduling: {
    lib: ["src/lib/scheduling", "src/lib/scanner"],
    actions: ["schedules.ts", "scanner.ts"],
  },
  // §6.2 — the `src/lib/playwright` split. `lib` stays empty; these plugins own
  // named files inside a directory that is otherwise core.
  recorder: {
    lib: ["src/lib/recording"],
    files: [
      "src/lib/playwright/debug-recorder.ts",
      "src/lib/playwright/event-to-code.ts",
      "src/lib/playwright/debug-parser.ts",
    ],
    actions: ["recording.ts"],
    components: ["src/components/recording"],
  },
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
      "src/lib/playwright/quickstart-templates.ts",
      "src/lib/playwright/static-scout.ts",
    ],
    actions: ["quickstart-agent.ts"],
    components: ["src/components/quickstart"],
  },
  ranger: {
    lib: [],
    files: ["src/lib/playwright/ranger.ts"],
    actions: ["ranger-agent.ts"],
  },
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
