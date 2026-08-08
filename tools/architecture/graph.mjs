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
  FORBIDDEN_PLUGIN_IMPORTS,
  PACKAGED_PLUGIN_IMPORTS,
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

/** @returns {Array<{ specifier: string, line: number }>} */
export function importsOf(root, relPath) {
  let src;
  try {
    src = readFileSync(join(root, relPath), "utf8");
  } catch {
    return [];
  }
  const code = stripNonCode(src);
  const specs = [];
  for (const m of code.matchAll(SPECIFIER_RE)) {
    const line = code.slice(0, m.index).split("\n").length;
    specs.push({ specifier: m[1], line });
  }
  return specs;
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

        for (const { specifier, line } of importsOf(root, file)) {
          for (const rule of FORBIDDEN_PLUGIN_IMPORTS) {
            if (rule.patterns.some((p) => matchesPattern(specifier, p))) {
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
  ];

  for (const { zone, dir, rules } of zones) {
    for (const file of listSourceFiles(root, dir)) {
      if (/\.(test|spec)\.tsx?$/.test(file)) continue;
      for (const { specifier, line } of importsOf(root, file)) {
        for (const rule of rules) {
          if (rule.patterns.some((p) => matchesPattern(specifier, p))) {
            violations.push({ rule: rule.id, zone, file, line, specifier });
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
