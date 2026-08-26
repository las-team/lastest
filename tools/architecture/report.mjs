#!/usr/bin/env node
/**
 * Architecture boundary report / burndown.
 *
 *   pnpm arch                # human-readable report
 *   pnpm arch:baseline       # rewrite baseline.json
 *
 * Rewriting the baseline is how you *lower* the ratchet after fixing violations.
 * Raising it is possible too — but it shows up as a diff in a committed file that
 * CODEOWNERS covers, which is the point.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  scanCompositionHosts,
  scanCoreSrc,
  scanPseudoPlugins,
  scanTargetLayout,
  tally,
  tallyByPluginRule,
} from "./graph.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const BASELINE_PATH = join(HERE, "baseline.json");

// The current layout is the pseudo-plugins *plus* the composition root's host
// adapters *plus* today's core (`CORE_SRC_PATHS`), which ratchet on the same
// `<plugin>::<rule>` key under the pseudo-plugin ids `host` and `core`. One
// list, one baseline.
const pseudo = [
  ...scanPseudoPlugins(ROOT),
  ...scanCompositionHosts(ROOT),
  ...scanCoreSrc(ROOT),
];
const target = scanTargetLayout(ROOT);

if (process.argv.includes("--baseline")) {
  const next = {
    $comment:
      "Burndown ratchet for docs/architecture/core-plugin-refactor.md §7. " +
      "Counts may only decrease. Regenerate with: pnpm arch:baseline",
    total: pseudo.length,
    byRule: tally(pseudo),
    byPluginRule: tallyByPluginRule(pseudo),
  };
  writeFileSync(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`wrote baseline.json — ${pseudo.length} violation(s)`);
} else {
  console.log(
    `\nArchitecture boundaries — ${pseudo.length} violation(s) in the current layout\n`,
  );
  for (const [rule, count] of Object.entries(tally(pseudo)).sort(
    (a, b) => b[1] - a[1],
  )) {
    console.log(`  ${String(count).padStart(3)}  ${rule}`);
  }

  /** @type {Record<string, typeof pseudo>} */
  const byPlugin = {};
  for (const v of pseudo) (byPlugin[v.plugin] ??= []).push(v);
  for (const [plugin, list] of Object.entries(byPlugin).sort(
    (a, b) => b[1].length - a[1].length,
  )) {
    console.log(`\n  ${plugin} (${list.length})`);
    for (const v of list) {
      console.log(
        `    ${v.rule.padEnd(13)} ${v.specifier.padEnd(38)} ${v.file}:${v.line}`,
      );
    }
  }

  console.log(
    `\n\nTarget layout (core/** + plugins/**): ${target.length} violation(s) — must be 0`,
  );
  for (const v of target) {
    console.log(
      `    ${v.rule.padEnd(13)} ${v.specifier.padEnd(38)} ${v.file}:${v.line}`,
    );
  }
  console.log("");
}
