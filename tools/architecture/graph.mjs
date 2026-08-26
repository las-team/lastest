/**
 * Dependency-free import-graph walker for the architecture boundaries (§7.5).
 *
 * Deliberately not `dependency-cruiser`: the rules are a dozen path predicates
 * over a specifier string, and a lexical scan is enough for that. It costs no
 * dependency and runs in well under a second over ~250k LOC, so it can live in
 * `pnpm test` rather than in a nightly job.
 *
 * The one thing it must get right is *not* counting code inside strings. This
 * repo generates Playwright test source as template literals — `src/lib/demo`
 * alone contains 32 occurrences of ``import { Page } from 'playwright'`` inside
 * backticks. Counting those would put 42% noise into the burndown metric, so
 * `stripNonCode()` blanks template literals and comments before matching.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";

import {
  CORE_PACKAGES,
  CORE_SRC_PATHS,
  FORBIDDEN_CORE_IMPORTS,
  FORBIDDEN_CORE_SRC_IMPORTS,
  FORBIDDEN_HOST_IMPORTS,
  FORBIDDEN_LIB_IMPORTS,
  FORBIDDEN_PLUGIN_IMPORTS,
  HOST_GLOB,
  PACKAGED_PLUGIN_IMPORTS,
  PSEUDO_PLUGIN_IMPORTS,
  PSEUDO_PLUGINS,
  pseudoPluginPaths,
} from "./boundaries.mjs";

const SOURCE_EXT = /\.(ts|tsx|mts|cts)$/;
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "dist",
  "build",
  "out",
  ".claude",
  ".recovery",
]);

/** Static import/export-from, dynamic import(), and require(). */
const SPECIFIER_RE =
  /(?:\bfrom\s*|\bimport\s*|\brequire\s*)\(?\s*["']([^"']+)["']/g;

export function listSourceFiles(root, dir) {
  const abs = join(root, dir);
  let entries;
  try {
    entries = readdirSync(abs, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".") continue;
    const rel = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...listSourceFiles(root, rel));
    } else if (SOURCE_EXT.test(entry.name)) {
      out.push(rel.split(sep).join("/"));
    }
  }
  return out;
}

/**
 * Blank out comments and template-literal bodies, preserving line structure so
 * reported line numbers stay accurate. Quoted strings are *kept*, because the
 * import specifier itself is one.
 *
 * Scanning is line-scoped for quoted strings: a `'`/`"` string cannot span a
 * newline in JS, so state is reset each line. That bounds the blast radius of a
 * mis-lex (e.g. a regex literal containing a quote) to a single line instead of
 * letting it swallow the rest of the file. Only template literals and block
 * comments are allowed to carry state across lines.
 */
export function stripNonCode(src) {
  const lines = src.split("\n");
  let inTemplate = false;
  let inBlockComment = false;

  return lines
    .map((line) => {
      let out = "";
      let i = 0;
      let quote = null;

      while (i < line.length) {
        const ch = line[i];
        const next = line[i + 1];

        if (inBlockComment) {
          if (ch === "*" && next === "/") {
            inBlockComment = false;
            out += "  ";
            i += 2;
          } else {
            out += " ";
            i += 1;
          }
          continue;
        }

        if (inTemplate) {
          if (ch === "\\") {
            out += "  ";
            i += 2;
          } else if (ch === "`") {
            inTemplate = false;
            out += " ";
            i += 1;
          } else {
            out += " ";
            i += 1;
          }
          continue;
        }

        if (quote) {
          out += ch;
          if (ch === "\\") {
            out += next ?? "";
            i += 2;
          } else {
            if (ch === quote) quote = null;
            i += 1;
          }
          continue;
        }

        if (ch === "/" && next === "/") break; // line comment: drop the rest
        if (ch === "/" && next === "*") {
          inBlockComment = true;
          out += "  ";
          i += 2;
          continue;
        }
        if (ch === "`") {
          inTemplate = true;
          out += " ";
          i += 1;
          continue;
        }
        if (ch === "'" || ch === '"') {
          quote = ch;
          out += ch;
          i += 1;
          continue;
        }

        out += ch;
        i += 1;
      }

      return out;
    })
    .join("\n");
}

/**
 * Is this specifier reached through a statement-level `import type … from` /
 * `export type … from`? Those are erased at compile time, so they create no
 * runtime edge, and a rule may opt out of counting them with
 * `allowTypeImports`. Rules that do not say so keep counting everything, which
 * is the behaviour every rule had before this flag existed.
 *
 * Found by walking back from the specifier to the nearest `import`/`export`
 * keyword, because the `from` clause of a multi-line `import type { … }` can
 * sit several lines below it. Only the `from` form can be type-only: a dynamic
 * `import("x")` or a `require("x")` carries its keyword *inside* the match
 * rather than before it, so the leading test rejects them outright instead of
 * letting the lookback find some earlier, unrelated import.
 *
 * The inline form (`import { type A } from "x"`) is deliberately NOT treated
 * as type-only. The statement is still a value import as far as the emitted
 * module graph is concerned, and for a rule whose whole job is to notice a
 * handle crossing a line, over-counting is the safe direction to be wrong in.
 */
function isTypeOnlyFromClause(code, matched, matchIndex) {
  if (!/^from\b/.test(matched)) return false;
  const before = code.slice(0, matchIndex);
  let kw = -1;
  for (const m of before.matchAll(/\b(?:import|export)\b/g)) kw = m.index;
  if (kw === -1) return false;
  return /^(?:import|export)\s+type\b/.test(before.slice(kw));
}

/**
 * Same scan as `importsOf`, on source already in hand. Exported so the rules
 * can be unit-tested without a fixture file on disk, the way `stripNonCode` is.
 *
 * @returns {Array<{ specifier: string, line: number, typeOnly: boolean }>}
 */
export function importsIn(src) {
  const code = stripNonCode(src);
  const specs = [];
  for (const m of code.matchAll(SPECIFIER_RE)) {
    const line = code.slice(0, m.index).split("\n").length;
    specs.push({
      specifier: m[1],
      line,
      typeOnly: isTypeOnlyFromClause(code, m[0], m.index),
    });
  }
  return specs;
}

/** @returns {Array<{ specifier: string, line: number, typeOnly: boolean }>} */
export function importsOf(root, relPath) {
  try {
    return importsIn(readFileSync(join(root, relPath), "utf8"));
  } catch {
    return [];
  }
}

/**
 * Does one rule fire on one import? The single place `allowTypeImports` is
 * honoured, so every scan below agrees about it.
 */
function ruleMatches(rule, imp) {
  if (rule.allowTypeImports && imp.typeOnly) return false;
  return rule.patterns.some((p) => matchesPattern(imp.specifier, p));
}

/** Glob-lite: only `*` (single segment) and a trailing `/*` are supported. */
export function matchesPattern(specifier, pattern) {
  if (!pattern.includes("*")) return specifier === pattern;
  const re = new RegExp(
    "^" +
      pattern
        .split("*")
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("[^\\s]*") +
      "$",
  );
  return re.test(specifier);
}

function buildPseudoIndex() {
  /** @type {Array<{ id: string, path: string, isFile: boolean }>} */
  const index = [];
  for (const [id, def] of Object.entries(PSEUDO_PLUGINS)) {
    for (const p of pseudoPluginPaths(def)) {
      index.push({ id, path: p, isFile: SOURCE_EXT.test(p) });
    }
  }
  // Longest path first, so `src/lib/playwright/ranger.ts` (ranger) is matched
  // before any shorter prefix could claim it.
  return index.sort((a, b) => b.path.length - a.path.length);
}

const PSEUDO_INDEX = buildPseudoIndex();

/**
 * Which pseudo-plugin owns this repo-relative path, if any. Accepts both a
 * concrete file (`src/lib/explorer/tester.ts`) and an import target with the
 * extension stripped (`src/lib/playwright/ranger`).
 */
export function pluginOwning(relPath) {
  const bare = relPath.replace(SOURCE_EXT, "");
  const hit = PSEUDO_INDEX.find((e) => {
    if (e.isFile) return bare === e.path.replace(SOURCE_EXT, "");
    return relPath === e.path || relPath.startsWith(`${e.path}/`);
  });
  return hit?.id;
}

/** Resolve `@/lib/foo/bar` → `src/lib/foo/bar` so specifiers can be classified. */
function specifierToRepoPath(specifier) {
  if (specifier.startsWith("@/")) return `src/${specifier.slice(2)}`;
  return undefined;
}

function isCoreSpecifier(specifier) {
  const repoPath = specifierToRepoPath(specifier);
  if (repoPath) {
    return CORE_SRC_PATHS.some(
      (p) => repoPath === p || repoPath.startsWith(`${p}/`),
    );
  }
  return CORE_PACKAGES.some((p) => specifier === `@lastest/${p.split("/")[1]}`);
}

/**
 * Walk the CURRENT layout (`src/lib/<feature>` pseudo-plugins) and return every
 * boundary violation. This is the burndown metric — see `baseline.json`.
 */
export function scanPseudoPlugins(root) {
  /** @type {Array<{ rule: string, plugin: string, file: string, line: number, specifier: string }>} */
  const violations = [];

  for (const [id, def] of Object.entries(PSEUDO_PLUGINS)) {
    for (const target of pseudoPluginPaths(def)) {
      const files = SOURCE_EXT.test(target)
        ? [target]
        : listSourceFiles(root, target);

      for (const file of files) {
        // A plugin's own tests may reach for anything to build fixtures.
        if (/\.(test|spec)\.tsx?$/.test(file)) continue;

        for (const imp of importsOf(root, file)) {
          const { specifier, line } = imp;
          for (const rule of [
            ...FORBIDDEN_PLUGIN_IMPORTS,
            ...PSEUDO_PLUGIN_IMPORTS,
          ]) {
            if (ruleMatches(rule, imp)) {
              violations.push({
                rule: rule.id,
                plugin: id,
                file,
                line,
                specifier,
              });
            }
          }

          const repoPath = specifierToRepoPath(specifier);
          if (repoPath) {
            const owner = pluginOwning(repoPath);
            if (owner && owner !== id) {
              violations.push({
                rule: "cross-plugin",
                plugin: id,
                file,
                line,
                specifier,
              });
            }
          }
        }
      }
    }
  }

  return violations;
}

/**
 * Walk the TARGET layout (`core/**` + `plugins/**`). These are hard errors — the
 * dirs are empty today, so the count must stay at zero forever.
 */
export function scanTargetLayout(root) {
  /** @type {Array<{ rule: string, zone: string, file: string, line: number, specifier: string }>} */
  const violations = [];

  const zones = [
    {
      zone: "plugin",
      dir: "plugins",
      rules: [...FORBIDDEN_PLUGIN_IMPORTS, ...PACKAGED_PLUGIN_IMPORTS],
    },
    { zone: "core", dir: "core", rules: FORBIDDEN_CORE_IMPORTS },
    { zone: "lib", dir: "libs", rules: FORBIDDEN_LIB_IMPORTS },
  ];

  for (const { zone, dir, rules } of zones) {
    for (const file of listSourceFiles(root, dir)) {
      if (/\.(test|spec)\.tsx?$/.test(file)) continue;
      for (const imp of importsOf(root, file)) {
        for (const rule of rules) {
          if (ruleMatches(rule, imp)) {
            violations.push({
              rule: rule.id,
              zone,
              file,
              line: imp.line,
              specifier: imp.specifier,
            });
          }
        }
      }
    }
  }

  return violations;
}

/**
 * Walk the composition root's host adapters (`src/lib/core/*-host.ts`) — see
 * `FORBIDDEN_HOST_IMPORTS` in `boundaries.mjs` for what they are and why they
 * needed a rule of their own.
 *
 * Violations carry `plugin: "host"` rather than a `zone`, so they ratchet
 * through the same `<plugin>::<rule>` key as everything else in the current
 * layout (`host::db`) instead of needing a second baseline mechanism. The
 * baseline stands at zero: unlike the pseudo-plugin counts this rule was
 * introduced *after* the violations it describes were fixed, not before.
 */
export function scanCompositionHosts(root) {
  /** @type {Array<{ rule: string, plugin: string, file: string, line: number, specifier: string }>} */
  const violations = [];

  for (const file of listSourceFiles(root, "src/lib/core")) {
    if (!matchesPattern(file, HOST_GLOB)) continue;
    for (const imp of importsOf(root, file)) {
      for (const rule of FORBIDDEN_HOST_IMPORTS) {
        if (ruleMatches(rule, imp)) {
          violations.push({
            rule: rule.id,
            plugin: "host",
            file,
            line: imp.line,
            specifier: imp.specifier,
          });
        }
      }
    }
  }

  return violations;
}

/**
 * Walk **today's** core — every file under `CORE_SRC_PATHS` — for the
 * `core-to-plugin` ban. See `FORBIDDEN_CORE_SRC_IMPORTS` in `boundaries.mjs`
 * for why the target-layout rule needed a second home, and why its sanctioned
 * exception is a file carve-out rather than a baseline entry.
 *
 * Violations carry `plugin: "core"`, so they ratchet through the same
 * `<plugin>::<rule>` key as everything else in the current layout
 * (`core::core-to-plugin`) — the mechanism `scanCompositionHosts` established
 * with `host::db`, and for the same reason: one baseline file, not three.
 *
 * Two files are skipped, both to keep the counter honest rather than kind:
 * a rule's own `allowFiles`, and any file a pseudo-plugin owns. The latter can
 * only happen through a §6.2 `files` entry — a plugin-destined file sitting
 * inside an otherwise-core directory like `src/lib/playwright` — and
 * `scanPseudoPlugins` already counts those against the plugin. There are none
 * today; the guard is here so the §6.2 split cannot make one violation appear
 * twice under two different names.
 */
export function scanCoreSrc(root) {
  /** @type {Array<{ rule: string, plugin: string, file: string, line: number, specifier: string }>} */
  const violations = [];

  for (const target of CORE_SRC_PATHS) {
    const files = SOURCE_EXT.test(target)
      ? [target]
      : listSourceFiles(root, target);

    for (const file of files) {
      // Same carve-out the pseudo-plugin and target-layout walkers make: a
      // test may reach for anything to build a fixture.
      if (/\.(test|spec)\.tsx?$/.test(file)) continue;
      if (pluginOwning(file)) continue;

      for (const imp of importsOf(root, file)) {
        for (const rule of FORBIDDEN_CORE_SRC_IMPORTS) {
          if (rule.allowFiles?.includes(file)) continue;
          if (ruleMatches(rule, imp)) {
            violations.push({
              rule: rule.id,
              plugin: "core",
              file,
              line: imp.line,
              specifier: imp.specifier,
            });
          }
        }
      }
    }
  }

  return violations;
}

/** `{ [ruleId]: count }`. */
export function tally(violations) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const v of violations) counts[v.rule] = (counts[v.rule] ?? 0) + 1;
  return counts;
}

/**
 * `{ "<plugin>::<rule>": count }` — the ratchet key.
 *
 * Keyed per *pair* rather than per rule so a plugin cannot trade one violation
 * for another somewhere else and keep the headline number flat.
 */
export function tallyByPluginRule(violations) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const v of violations) {
    const key = `${v.plugin}::${v.rule}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : 1)),
  );
}

export { isCoreSpecifier };
