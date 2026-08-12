/**
 * Architecture boundary enforcement — §7.5 of
 * `docs/architecture/core-plugin-refactor.md`.
 *
 * Two jobs:
 *
 *   1. The TARGET layout (`core/**` + `plugins/**`) must be clean. Hard failure.
 *      Empty today, so this costs nothing and is armed before the first package
 *      lands — a plugin that reaches for Playwright fails `pnpm test`, not review.
 *
 *   2. The CURRENT layout is ratcheted against `baseline.json`. New violations
 *      fail; removing one and forgetting to lower the baseline also fails, so the
 *      number tracks reality instead of drifting upward quietly.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// The `.mjs` siblings are deliberately dependency-free and plain JS; tsc infers
// their types through `allowJs`, so these imports need no directives.
import {
  CORE_PACKAGES,
  CORE_SRC_PATHS,
  PSEUDO_PLUGINS,
  pseudoPluginPaths,
} from "./boundaries.mjs";
import {
  scanPseudoPlugins,
  scanTargetLayout,
  stripNonCode,
  tallyByPluginRule,
} from "./graph.mjs";
import { classify } from "./check-split-pr.mjs";
import { schemaModuleCycles, schemaModuleImports } from "./schema-graph.mjs";

type Violation = {
  rule: string;
  file: string;
  line: number;
  specifier: string;
  plugin?: string;
  zone?: string;
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASELINE = JSON.parse(
  readFileSync(join(ROOT, "tools/architecture/baseline.json"), "utf8"),
) as { total: number; byPluginRule: Record<string, number> };

const format = (v: Violation) =>
  `${v.rule.padEnd(13)} ${v.specifier.padEnd(38)} ${v.file}:${v.line}`;

describe("target layout (core/** + plugins/**)", () => {
  it("has no boundary violations", () => {
    const violations = scanTargetLayout(ROOT) as Violation[];
    expect(
      violations.map(format),
      "core/ and plugins/ must obey the §3 dependency rule with no exceptions",
    ).toEqual([]);
  });
});

describe("current layout burndown", () => {
  const violations = scanPseudoPlugins(ROOT) as Violation[];
  const actual = tallyByPluginRule(violations) as Record<string, number>;

  it("introduces no new boundary violation", () => {
    const regressions: string[] = [];

    for (const [key, count] of Object.entries(actual)) {
      const allowed = BASELINE.byPluginRule[key] ?? 0;
      if (count > allowed) {
        const [plugin, rule] = key.split("::");
        const offenders = violations
          .filter((v) => v.plugin === plugin && v.rule === rule)
          .map((v) => `\n      ${format(v)}`)
          .join("");
        regressions.push(`${key}: ${count} > ${allowed} allowed${offenders}`);
      }
    }

    expect(
      regressions,
      "New violations of the core/plugin boundary. Route this through core " +
        "(ctx.browser / ctx.data / ctx.ai / ctx.jobs) instead of importing directly. " +
        "See docs/architecture/core-plugin-refactor.md §4.",
    ).toEqual([]);
  });

  it("keeps baseline.json in sync when violations are removed", () => {
    const stale = Object.entries(BASELINE.byPluginRule)
      .filter(([key, allowed]) => (actual[key] ?? 0) < allowed)
      .map(
        ([key, allowed]) =>
          `${key}: ${actual[key] ?? 0} actual < ${allowed} baseline`,
      );

    expect(
      stale,
      "Violations were fixed — lower the ratchet with `pnpm arch:baseline` so it " +
        "cannot silently drift back up.",
    ).toEqual([]);
  });

  it("reports a total matching the baseline", () => {
    expect(violations.length).toBe(BASELINE.total);
  });
});

describe("boundary map", () => {
  it("assigns every path to at most one plugin", () => {
    const owners = new Map<string, string>();
    const clashes: string[] = [];

    for (const [id, def] of Object.entries(PSEUDO_PLUGINS)) {
      for (const path of pseudoPluginPaths(def) as string[]) {
        const existing = owners.get(path);
        if (existing) clashes.push(`${path}: ${existing} and ${id}`);
        owners.set(path, id);
      }
    }

    expect(clashes).toEqual([]);
  });
});

describe("CODEOWNERS", () => {
  const owned = readFileSync(join(ROOT, ".github/CODEOWNERS"), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split(/\s+/)[0]);

  const isCovered = (path: string) =>
    owned.some((rule) => {
      const bare = rule.replace(/^\//, "").replace(/\/$/, "");
      return path === bare || path.startsWith(`${bare}/`);
    });

  it("covers every core path in the boundary map", () => {
    const uncovered = [...CORE_SRC_PATHS, ...CORE_PACKAGES].filter(
      (p: string) =>
        // `src/lib/foo` may be owned as either `src/lib/foo/` or `src/lib/foo.ts`
        !isCovered(p) && !isCovered(`${p}.ts`),
    );

    expect(
      uncovered,
      "These are core (RFC §6.1) but no CODEOWNERS rule protects them, so a " +
        "change could merge without an owner review. Add them to .github/CODEOWNERS.",
    ).toEqual([]);
  });

  it("does not claim ownership of a plugin's own directories", () => {
    // Owning plugin source would defeat the point: a feature PR must not need a
    // core review.
    //
    // `def.files` is exempt, and only `def.files`. It exists solely for the §6.2
    // `src/lib/playwright` split — a directory that is core-owned as a whole
    // while containing files destined for four different plugins. The RFC calls
    // that split "the one most likely to be wrong on the first attempt" and
    // defers it to phase 4, so until it happens the safe reading is that the
    // whole mixed directory needs an owner review. Over-protecting a contested
    // boundary is the right direction to err in.
    const claimed = Object.entries(PSEUDO_PLUGINS)
      .flatMap(([id, def]) =>
        (pseudoPluginPaths({ ...def, files: [] }) as string[]).map(
          (p) => `${id}: ${p}`,
        ),
      )
      .filter((entry) => isCovered(entry.split(": ")[1]));

    expect(claimed).toEqual([]);
  });
});

describe("split-PR check", () => {
  it("separates target-layout core from target-layout plugins", () => {
    const z = classify([
      "core/browser/src/index.ts",
      "plugins/explorer/src/index.ts",
      "README.md",
    ]);
    expect(z.targetCore).toEqual(["core/browser/src/index.ts"]);
    expect(z.targetPlugin).toEqual(["plugins/explorer/src/index.ts"]);
  });

  it("recognises today's core and today's features", () => {
    const z = classify([
      "src/lib/db/queries/tests.ts",
      "packages/pool-service/src/client.ts",
      "src/lib/qa-agent/crawl.ts",
      // A `components` entry, to prove the third key is classified too. It was
      // `src/components/explorer/…` until explorer graduated to `plugins/`.
      "src/components/quickstart/quickstart-client.tsx",
      // An `actions` entry. It was `src/server/actions/rca.ts` until rca
      // graduated in RFC §9 phase 4.
      "src/server/actions/url-diff.ts",
    ]);
    expect(z.todayCore).toEqual([
      "src/lib/db/queries/tests.ts",
      "packages/pool-service/src/client.ts",
    ]);
    expect(z.todayPlugin).toEqual([
      "src/lib/qa-agent/crawl.ts",
      "src/components/quickstart/quickstart-client.tsx",
      "src/server/actions/url-diff.ts",
    ]);
  });

  it("counts a src/lib/playwright change as core only, not as a feature", () => {
    // Until the §6.2 split lands the directory is mixed and core-owned; treating
    // its plugin-destined files as feature code would make every change to it
    // look like a split-PR violation.
    const z = classify(["src/lib/playwright/ranger.ts"]);
    expect(z.todayCore).toEqual(["src/lib/playwright/ranger.ts"]);
    expect(z.todayPlugin).toEqual([]);
  });

  it("does not match on a path prefix that is not a directory boundary", () => {
    const z = classify(["src/lib/database-notes.md", "coreutils/x.ts"]);
    expect(z.todayCore).toEqual([]);
    expect(z.targetCore).toEqual([]);
  });
});

describe("schema modules", () => {
  it("has an acyclic import graph", () => {
    // The 5,810-line schema.ts was split into per-domain modules. Circular
    // imports between them happen to work for drizzle — `.references(() => x)`
    // defers the dereference and type imports erase — but they are fragile, and
    // the split was designed to avoid them: `scm` exists as its own module
    // precisely because leaving GitHub/GitLab config in `repos` creates
    // identity ⇄ repos and repos ⇄ runs. Without this test that reverts silently
    // the first time someone adds an import.
    expect(schemaModuleCycles() as string[]).toEqual([]);
  });

  it("keeps `shared` and `eb-protocol` as sinks", () => {
    // These are the leaves that make the graph acyclic: a type needed by two
    // domains goes in `shared` instead of one domain importing another
    // sideways. If they grow imports, the layout has started to rot.
    const graph = schemaModuleImports() as Map<string, string[]>;
    expect(graph.get("shared")).toEqual([]);
    expect(graph.get("eb-protocol")).toEqual([]);
  });
});

describe("stripNonCode", () => {
  it("keeps real import specifiers", () => {
    const code = stripNonCode(`import { chromium } from "playwright";`);
    expect(code).toContain('"playwright"');
  });

  it("drops imports written inside generated-code template literals", () => {
    // This repo emits Playwright test source as template literals; counting those
    // as real imports put 32 false positives into the burndown.
    const code = stripNonCode(
      "const t = `import { Page } from 'playwright';\\nawait page.goto(u);`;",
    );
    expect(code).not.toContain("playwright");
  });

  it("drops imports inside comments", () => {
    expect(stripNonCode(`// import x from "playwright";`)).not.toContain(
      "playwright",
    );
    expect(stripNonCode(`/* import x from "playwright"; */`)).not.toContain(
      "playwright",
    );
  });

  it("preserves line numbers", () => {
    const src = '`a\nb\nc`;\nimport x from "playwright";';
    const out = stripNonCode(src);
    expect(out.split("\n")).toHaveLength(4);
    expect(out.split("\n")[3]).toContain("playwright");
  });

  it("does not let an unterminated quote swallow later lines", () => {
    // A regex literal containing a quote can mis-lex; state resets each line so
    // the damage is bounded to that line.
    const src = 'const re = /["\']/;\nimport x from "playwright";';
    expect(stripNonCode(src).split("\n")[1]).toContain("playwright");
  });
});
