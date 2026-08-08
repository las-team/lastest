/**
 * ESLint config blocks for the architecture boundaries (§7.3).
 *
 * Generated from `boundaries.mjs` so the lint rules and the graph test
 * (`boundaries.test.ts`) can never disagree about what a plugin is.
 *
 * Severity is deliberately split:
 *
 *   error — `core/**` and `plugins/**`. Nothing lives there yet, so these are
 *           free today and already armed when the first package lands.
 *   warn  — today's `src/lib/<feature>` pseudo-plugins. `pnpm lint` stays green
 *           while the count is visible in the editor on every touched file.
 *           The *enforcement* for these is the ratchet in `boundaries.test.ts`;
 *           the warnings are the nudge.
 *
 * ESLint sees fewer violations than the graph test does (32 vs 42 at the time of
 * writing): `no-restricted-imports` only inspects static `import`/`export … from`
 * and top-level `require`, so a lazy `await import("@/lib/qa-agent/auth")` inside
 * a function body is invisible to it. That is exactly how several of the worst
 * cross-feature calls are written, which is why the ratchet — not the lint rule —
 * is the enforcement mechanism.
 */
import {
  CORE_GLOB,
  FORBIDDEN_CORE_IMPORTS,
  FORBIDDEN_LIB_IMPORTS,
  FORBIDDEN_PLUGIN_IMPORTS,
  LIB_GLOB,
  PACKAGED_PLUGIN_IMPORTS,
  PLUGIN_GLOB,
  PSEUDO_PLUGINS,
  crossPluginPatternsFor,
  pseudoPluginFiles,
} from "./boundaries.mjs";

/**
 * `no-restricted-imports` matches `group` patterns with **gitignore** semantics,
 * so a bare `playwright/*` also matches `@/lib/playwright/types` — a core module
 * that plugins are allowed to import. A leading `/` anchors the pattern to the
 * start of the specifier, and a trailing `/*` has to become `/**` because `*`
 * does not cross a `/`.
 *
 * Relative specifiers are left alone; anchoring them to "root" would never match.
 */
export function anchor(pattern) {
  if (pattern.startsWith(".")) return pattern;
  const anchored = `/${pattern}`;
  return anchored.endsWith("/*") ? `${anchored}*` : anchored;
}

const toPatterns = (rules) =>
  rules.flatMap((rule) =>
    rule.patterns.map((group) => ({
      group: [anchor(group)],
      message: rule.message,
    })),
  );

/** @returns {import("eslint").Linter.Config[]} */
export function architectureBoundaryRules() {
  const blocks = [];

  // ── Target layout: hard errors ──────────────────────────────────────────────
  blocks.push({
    name: "architecture/plugins",
    files: [PLUGIN_GLOB],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: toPatterns([
            ...FORBIDDEN_PLUGIN_IMPORTS,
            ...PACKAGED_PLUGIN_IMPORTS,
          ]),
        },
      ],
    },
  });

  blocks.push({
    name: "architecture/core",
    files: [CORE_GLOB],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: toPatterns(FORBIDDEN_CORE_IMPORTS) },
      ],
    },
  });

  blocks.push({
    name: "architecture/libs",
    files: [LIB_GLOB],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: toPatterns(FORBIDDEN_LIB_IMPORTS) },
      ],
    },
  });

  // ── Current layout: warnings, one block per pseudo-plugin ───────────────────
  // Per-plugin blocks are needed because the cross-plugin pattern list is
  // "every *other* plugin", which differs for each one.
  for (const [id, def] of Object.entries(PSEUDO_PLUGINS)) {
    const files = pseudoPluginFiles(def);
    if (files.length === 0) continue;

    blocks.push({
      name: `architecture/pseudo-plugin:${id}`,
      files,
      // A feature's own tests may reach for anything to build fixtures. The
      // graph walker skips them too — the two must agree or the burndown drifts.
      ignores: ["**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}"],
      rules: {
        "no-restricted-imports": [
          "warn",
          {
            patterns: [
              ...toPatterns(FORBIDDEN_PLUGIN_IMPORTS),
              {
                group: crossPluginPatternsFor(id).map(anchor),
                message:
                  `Plugin "${id}" must not import another feature directly. ` +
                  "Promote the shared part into core, or compose asynchronously " +
                  "via jobs/events. See core-plugin-refactor.md §4.3.",
              },
            ],
          },
        ],
      },
    });
  }

  return blocks;
}
