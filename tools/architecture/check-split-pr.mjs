#!/usr/bin/env node
/**
 * Split-PR check — §7.2 of `docs/architecture/core-plugin-refactor.md`.
 *
 *   node tools/architecture/check-split-pr.mjs [baseRef]
 *
 * "Core and plugin changes must be separate PRs. Land the core change first,
 * then the plugin change on top."
 *
 * Two severities, for the same reason the lint rules have two:
 *
 *   FAIL   the PR touches both `core/**` and `plugins/**`. That is the rule the
 *          RFC states, and it is free today because both trees are empty.
 *
 *   NOTICE the PR touches both today's core (§6.1, e.g. `src/lib/db`) and a
 *          pseudo-plugin (§6.3, e.g. `src/lib/qa-agent`). Failing on this now
 *          would block a large share of ordinary PRs and train everyone to slap
 *          the escape label on by reflex, which destroys the signal the label is
 *          supposed to carry. It is reported, not enforced — CODEOWNERS is what
 *          actually forces the core half to be reviewed today.
 *
 * Escape hatch for the hard failure: the `core-and-plugin` PR label, applied
 * deliberately, with the reason in the PR body. Bootstrapping a new capability
 * legitimately needs both.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import {
  CORE_PACKAGES,
  CORE_SRC_PATHS,
  PSEUDO_PLUGINS,
  pseudoPluginPaths,
} from "./boundaries.mjs";

const ESCAPE_LABEL = "core-and-plugin";

const CORE_TODAY = [...CORE_SRC_PATHS, ...CORE_PACKAGES];
const PLUGIN_TODAY = Object.entries(PSEUDO_PLUGINS).flatMap(([id, def]) =>
  // `files` is excluded: those live inside `src/lib/playwright`, which counts as
  // core until the §6.2 split lands. Counting them as plugin-side would make
  // every playwright change look like a split-PR violation.
  pseudoPluginPaths({ ...def, files: [] }).map((path) => ({ id, path })),
);

function changedFiles(baseRef) {
  const out = execFileSync(
    "git",
    ["diff", "--name-only", `${baseRef}...HEAD`],
    { encoding: "utf8" },
  );
  return out.split("\n").filter(Boolean);
}

function prLabels() {
  const path = process.env.GITHUB_EVENT_PATH;
  if (!path) return [];
  try {
    const event = JSON.parse(readFileSync(path, "utf8"));
    return (event.pull_request?.labels ?? []).map((l) => l.name);
  } catch {
    return [];
  }
}

const under = (file, dir) => file === dir || file.startsWith(`${dir}/`);

/** Exported for `boundaries.test.ts` — the branching here is the whole rule. */
export function classify(files) {
  return {
    targetCore: files.filter((f) => under(f, "core")),
    targetPlugin: files.filter((f) => under(f, "plugins")),
    todayCore: files.filter((f) => CORE_TODAY.some((d) => under(f, d))),
    todayPlugin: files.filter((f) =>
      PLUGIN_TODAY.some(({ path }) => under(f, path)),
    ),
  };
}

const list = (files) => files.map((f) => `      ${f}`).join("\n");

function main() {
  const baseRef = process.argv[2] ?? process.env.GITHUB_BASE_REF ?? "main";
  let files;
  try {
    files = changedFiles(baseRef);
  } catch (err) {
    console.error(`Could not diff against "${baseRef}": ${err.message}`);
    console.error("Pass a base ref explicitly, e.g. `origin/main`.");
    process.exit(2);
  }

  const zones = classify(files);
  const labels = prLabels();
  let failed = false;

  if (zones.targetCore.length && zones.targetPlugin.length) {
    if (labels.includes(ESCAPE_LABEL)) {
      console.log(
        `::notice::Core and plugin changed together, allowed by the "${ESCAPE_LABEL}" label.`,
      );
    } else {
      failed = true;
      console.log(
        "::error::Core and plugin changes must be separate PRs. Land the core " +
          "change first, then the plugin change on top. If this PR genuinely " +
          `bootstraps a new capability, add the "${ESCAPE_LABEL}" label and say ` +
          "why in the PR body.",
      );
      console.error(
        `\n  core/\n${list(zones.targetCore)}\n\n  plugins/\n${list(zones.targetPlugin)}\n`,
      );
    }
  }

  if (zones.todayCore.length && zones.todayPlugin.length) {
    console.log(
      "::notice::This PR changes both core (RFC §6.1) and feature code (§6.3). " +
        "Not blocked while the refactor is in progress, but the core half needs " +
        "an owner review — consider splitting it out.",
    );
    console.error(
      `\n  core (today)\n${list(zones.todayCore.slice(0, 20))}\n\n  feature\n${list(zones.todayPlugin.slice(0, 20))}\n`,
    );
  }

  if (!failed) {
    console.log(
      `Split-PR check passed (${files.length} changed file(s) against ${baseRef}).`,
    );
  }
  process.exit(failed ? 1 : 0);
}

// Importable for tests; only runs the check when invoked as a script.
if (process.env.VITEST !== "true") main();
