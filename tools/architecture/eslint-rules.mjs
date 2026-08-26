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
  FORBIDDEN_CORE_SRC_IMPORTS,
  FORBIDDEN_HOST_IMPORTS,
  FORBIDDEN_LIB_IMPORTS,
  FORBIDDEN_PLUGIN_IMPORTS,
  HOST_GLOB,
  LIB_GLOB,
  PACKAGED_PLUGIN_IMPORTS,
  PLUGIN_GLOB,
  PSEUDO_PLUGIN_IMPORTS,
  PSEUDO_PLUGINS,
  coreSrcFiles,
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

/**
 * The `FORBIDDEN_HOST_IMPORTS` shape needs two things the blocks above do not.
 *
 * First, exact specifiers must stay exact. `group` patterns use gitignore
 * semantics, where a pattern naming a directory also matches everything under
 * it — so a `patterns` entry for `@/lib/db` would fire on `@/lib/db/queries`,
 * the one import these files are *supposed* to have. A pattern with no `*`
 * therefore becomes a `paths` entry, matched by equality; only the wildcards
 * stay in `patterns`.
 *
 * Second, `allowTypeImports`, which the core `no-restricted-imports` does not
 * understand — hence the `@typescript-eslint/` rule at the callsite. See the
 * `FORBIDDEN_HOST_IMPORTS` comment in `boundaries.mjs` for why type-only
 * imports are exempt.
 */
function toHostRestrictions(rules) {
  const paths = [];
  const patterns = [];
  for (const rule of rules) {
    const allowTypeImports = rule.allowTypeImports === true;
    for (const p of rule.patterns) {
      if (p.includes("*")) {
        patterns.push({
          group: [anchor(p)],
          allowTypeImports,
          message: rule.message,
        });
      } else {
        paths.push({ name: p, allowTypeImports, message: rule.message });
      }
    }
  }
  return { paths, patterns };
}

/** @returns {import("eslint").Linter.Config[]} */
export function architectureBoundaryRules() {
  const blocks = [];

  // ── Target layout: hard errors ──────────────────────────────────────────────
  // `scanTargetLayout` in graph.mjs (the CI ratchet backing these) skips
  // `.test.ts`/`.spec.ts` files — a feature's own tests may reach for anything
  // to build fixtures, same carve-out the pseudo-plugin blocks below have.
  // These blocks have to say so too, or ESLint disagrees with the ratchet it's
  // meant to mirror on every touched test file.
  const TARGET_LAYOUT_TEST_IGNORES = [
    "**/*.test.{ts,tsx}",
    "**/*.spec.{ts,tsx}",
  ];

  blocks.push({
    name: "architecture/plugins",
    files: [PLUGIN_GLOB],
    ignores: TARGET_LAYOUT_TEST_IGNORES,
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
    ignores: TARGET_LAYOUT_TEST_IGNORES,
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
    ignores: TARGET_LAYOUT_TEST_IGNORES,
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: toPatterns(FORBIDDEN_LIB_IMPORTS) },
      ],
    },
  });

  // ── Composition root: the host adapters ─────────────────────────────────────
  // `src/lib/core/*-host.ts` is inside `src/`, so unlike the target-layout
  // globs above this block covers files that exist and are edited daily. It is
  // still `error` rather than the pseudo-plugins' `warn`: those are warnings
  // because their ratchet stands above zero and `pnpm lint` has to stay green
  // through the burndown, whereas this rule was added *after* its violations
  // were fixed and its baseline is zero. There is nothing to be lenient about.
  //
  // No test carve-out here, unlike every block above: the glob ends in
  // `-host.ts`, so a `*.test.ts` cannot match it in the first place. The
  // `scanCompositionHosts` walker skips nothing for the same reason — the two
  // agree by construction rather than by a duplicated ignore list.
  blocks.push({
    name: "architecture/core-hosts",
    files: [HOST_GLOB],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        toHostRestrictions(FORBIDDEN_HOST_IMPORTS),
      ],
    },
  });

  // ── Today's core: the other half of the `core-to-plugin` ban ────────────────
  // Mirrors `scanCoreSrc` — `architecture/core` above covers the target
  // layout's still-empty `core/**`; this covers the `CORE_SRC_PATHS` ledger,
  // which is where core actually lives today.
  //
  // `warn`, unlike `architecture/core-hosts` right above it, and the reason is
  // the one stated at the top of this file: severity follows the ratchet, not
  // the rule's importance. The host rule landed at zero and can afford `error`;
  // this one landed with a real violation still standing
  // (`executor.ts` → `@lastest/plugin-api-test/runner`), so `error` would mean
  // `pnpm lint` is red until somebody inverts a dependency. The enforcement is
  // the ratchet in `boundaries.test.ts`; the warning is the nudge — exactly the
  // arrangement the pseudo-plugin blocks below have.
  //
  // The sanctioned check-layer registration point is an `ignores` entry rather
  // than a pattern exception, because it is the *file* that is blessed and not
  // any particular specifier. `scanCoreSrc` skips the same list via the rule's
  // `allowFiles`, so ESLint and the ratchet disagree about nothing.
  blocks.push({
    name: "architecture/core-src",
    files: coreSrcFiles(),
    ignores: [
      ...TARGET_LAYOUT_TEST_IGNORES,
      ...FORBIDDEN_CORE_SRC_IMPORTS.flatMap((r) => r.allowFiles ?? []),
    ],
    rules: {
      "no-restricted-imports": [
        "warn",
        { patterns: toPatterns(FORBIDDEN_CORE_SRC_IMPORTS) },
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
              ...toPatterns([
                ...FORBIDDEN_PLUGIN_IMPORTS,
                ...PSEUDO_PLUGIN_IMPORTS,
              ]),
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
