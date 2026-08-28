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
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// The `.mjs` siblings are deliberately dependency-free and plain JS; tsc infers
// their types through `allowJs`, so these imports need no directives.
import {
  CORE_PACKAGES,
  CORE_SRC_PATHS,
  FORBIDDEN_CORE_IMPORTS,
  FORBIDDEN_CORE_SRC_IMPORTS,
  FORBIDDEN_HOST_IMPORTS,
  PSEUDO_PLUGINS,
  pseudoPluginPaths,
} from "./boundaries.mjs";
import {
  importsIn,
  matchesPattern,
  scanCompositionHosts,
  scanCoreSrc,
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
  // The pseudo-plugins plus the composition root's host adapters plus today's
  // core, which carry `plugin: "host"` / `plugin: "core"` so they ratchet on
  // the same `<plugin>::<rule>` key (`host::db`, `core::core-to-plugin`)
  // rather than needing a second baseline file.
  const violations = [
    ...scanPseudoPlugins(ROOT),
    ...scanCompositionHosts(ROOT),
    ...scanCoreSrc(ROOT),
  ] as Violation[];
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

describe("composition-root hosts (src/lib/core/*-host.ts)", () => {
  it("reaches the database only through src/lib/db/queries", () => {
    // Ratcheted at zero above like everything else, but asserted on its own
    // here so the failure names the actual problem — "a host adapter grew its
    // own query layer" — instead of a `host::db` count going from 0 to 1.
    const violations = scanCompositionHosts(ROOT) as Violation[];
    expect(
      violations.map(format),
      "A host adapter must not hold the db handle, a schema table object or a " +
        "drizzle operator. Move the query into src/lib/db/queries — the owned " +
        "layer where tenancy filters, encryption-on-write and activity events " +
        "live — and call it from here. See src/lib/core/awards-host.ts.",
    ).toEqual([]);
  });

  it("does not count a type-only schema import", () => {
    // Four compliant hosts (app-map, authoring-ai, ci, events) map rows to
    // plugin DTOs through exactly this import. It is erased at compile time,
    // so it opens no connection — counting it would fire the rule hardest on
    // the code it is meant to bless.
    const [imp] = importsIn(
      'import type {\n  Repository,\n  Runner,\n} from "@/lib/db/schema";',
    ) as Array<{ specifier: string; typeOnly: boolean }>;
    expect(imp.specifier).toBe("@/lib/db/schema");
    expect(imp.typeOnly).toBe(true);
  });

  it("counts a value import of the same module", () => {
    const [imp] = importsIn('import { db } from "@/lib/db";') as Array<{
      typeOnly: boolean;
    }>;
    expect(imp.typeOnly).toBe(false);
  });

  it("counts a dynamic import even after a type-only one", () => {
    // The lookback that finds `import type` must not walk past a dynamic
    // `import("…")` and pick up an unrelated earlier statement.
    const imports = importsIn(
      'import type { X } from "@/lib/db/schema";\nconst { db } = await import("@/lib/db");',
    ) as Array<{ specifier: string; typeOnly: boolean }>;
    expect(imports.map((i) => [i.specifier, i.typeOnly])).toEqual([
      ["@/lib/db/schema", true],
      ["@/lib/db", false],
    ]);
  });

  it("leaves the query layer itself importable", () => {
    // The whole point of the rule is that hosts call these, so `@/lib/db` has
    // to be an exact specifier and not a prefix — the mistake that would
    // otherwise ban the one import every compliant host makes.
    const patterns = (
      FORBIDDEN_HOST_IMPORTS as Array<{ patterns: string[] }>
    ).flatMap((r) => r.patterns);
    const allowed = [
      "@/lib/db/queries",
      "@/lib/db/queries/activity-events",
      "@/lib/auth",
    ];
    const wronglyBanned = allowed.filter((s) =>
      patterns.some((p) => matchesPattern(s, p)),
    );
    expect(wronglyBanned).toEqual([]);

    // …and the things it is meant to catch still match.
    const banned = [
      "@/lib/db",
      "@/lib/db/schema",
      "drizzle-orm",
      "@lastest/db",
    ];
    const missed = banned.filter(
      (s) => !patterns.some((p) => matchesPattern(s, p)),
    );
    expect(missed).toEqual([]);
  });
});

describe("today's core (CORE_SRC_PATHS)", () => {
  /**
   * The walker takes a root, so a planted violation goes in a throwaway tree
   * rather than in `src/`. Nothing here can leave a stray file behind for
   * `tsc`/`eslint` to trip over, and the fixture can contain the one shape
   * that would otherwise be impossible to assert on: a core file that really
   * does import a plugin.
   */
  const withFixtureRoot = (files: Record<string, string>) => {
    const root = mkdtempSync(join(tmpdir(), "arch-core-src-"));
    try {
      for (const [rel, body] of Object.entries(files)) {
        mkdirSync(dirname(join(root, rel)), { recursive: true });
        writeFileSync(join(root, rel), body);
      }
      return scanCoreSrc(root) as Violation[];
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };

  const PLUGIN_IMPORT = 'import { thing } from "@lastest/plugin-a11y/host";\n';

  it("imports no plugin domain logic beyond the one counted violation", () => {
    // Ratcheted at 1 above like everything else, but asserted by *content*
    // here so a failure names the actual problem — "core reached into a
    // plugin" and which one — instead of a `core::core-to-plugin` count going
    // from 1 to 2.
    //
    // The survivor is feature runtime, not shared math: `runApiTest` issues
    // the request, redacts secrets and writes evidence. It cannot be promoted
    // to `libs/` the way `wcag-score` and `design-tokens` were; it wants an
    // inverted dependency, which is a core PR.
    const violations = scanCoreSrc(ROOT) as Violation[];
    expect(
      violations.map(format),
      "Core must not import a plugin's domain logic. Promote the shared part " +
        "to libs/ (core-scope.md §3 — see libs/wcag-score, libs/design-tokens), " +
        "or invert the dependency and let the plugin call a capability.",
    ).toEqual([
      format({
        rule: "core-to-plugin",
        specifier: "@lastest/plugin-api-test/runner",
        file: "src/lib/execution/executor.ts",
        line: 403,
      }),
    ]);
  });

  it("counts a planted violation", () => {
    const violations = withFixtureRoot({
      "src/lib/diff/planted.ts": PLUGIN_IMPORT,
    });
    expect(violations.map((v) => [v.plugin, v.rule, v.file])).toEqual([
      ["core", "core-to-plugin", "src/lib/diff/planted.ts"],
    ]);
  });

  it("does not count the sanctioned check-layer registration point", () => {
    // `src/lib/verify/check-layers.ts` imports each plugin's narrow
    // `./check-layer` subpath deliberately: it is bundled into client
    // components, so it must not go through `src/lib/core/manifests.ts`, whose
    // manifests eagerly pull in every plugin's schema (and drizzle-orm with
    // it). A file carve-out, not a baseline entry — see the `allowFiles`
    // comment in boundaries.mjs for why that distinction matters to the count.
    expect(
      withFixtureRoot({ "src/lib/verify/check-layers.ts": PLUGIN_IMPORT }),
    ).toEqual([]);
  });

  it("points its carve-out at a file that exists and needs one", () => {
    // An `allowFiles` entry that has gone stale — renamed file, moved
    // directory — is worse than no entry: it exempts nothing and hides
    // nothing, silently. Both halves are checked: the path resolves, and the
    // file it names genuinely does import a plugin, so the exemption is still
    // doing work rather than describing history.
    const allowed = (
      FORBIDDEN_CORE_SRC_IMPORTS as Array<{ allowFiles?: string[] }>
    ).flatMap((r) => r.allowFiles ?? []);
    expect(allowed).not.toEqual([]);

    for (const rel of allowed) {
      const src = readFileSync(join(ROOT, rel), "utf8");
      expect(src, `${rel} no longer imports a plugin`).toContain(
        "@lastest/plugin-",
      );
    }
  });

  it("ignores a test file, like every other walker", () => {
    expect(
      withFixtureRoot({ "src/lib/diff/planted.test.ts": PLUGIN_IMPORT }),
    ).toEqual([]);
  });

  it("bans exactly what the target-layout rule bans", () => {
    // The two lists are duplicated so each reads as a list (see the
    // FORBIDDEN_CORE_SRC_IMPORTS comment). Duplication is only safe if
    // something notices when it stops being duplication.
    const target = (
      FORBIDDEN_CORE_IMPORTS as Array<{ id: string; patterns: string[] }>
    ).find((r) => r.id === "core-to-plugin");
    const current = (
      FORBIDDEN_CORE_SRC_IMPORTS as Array<{ id: string; patterns: string[] }>
    ).find((r) => r.id === "core-to-plugin");
    expect(target?.patterns).toEqual(current?.patterns);
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
      // `actions` entries are all the ledger holds now: `qa-agent` — the last
      // entry with `lib`/`components` keys, and this test's example for both
      // (after explorer, then quickstart) — graduated in RFC §9 phase 4, so
      // the three costed orphan action modules are what remains and only the
      // `actions` key can be proven against the live map. (The
      // `lib`/`components` branches of `pseudoPluginPaths` are exercised by
      // nothing live any more; if a future entry regrows them, restore an
      // example here.) `spec-import.ts` was `src/server/actions/rca.ts` until
      // rca graduated, then `url-diff.ts` until that feature was reclassified
      // core, then `demo.ts` until that entry was dropped.
      "src/server/actions/spec-import.ts",
    ]);
    expect(z.todayCore).toEqual([
      "src/lib/db/queries/tests.ts",
      "packages/pool-service/src/client.ts",
    ]);
    expect(z.todayPlugin).toEqual(["src/server/actions/spec-import.ts"]);
  });

  it("counts a src/lib/playwright change as core only, not as a feature", () => {
    // Until the §6.2 split lands for the rest of the directory it stays mixed
    // and core-owned; treating its plugin-destined files as feature code would
    // make every change to it look like a split-PR violation. `ranger.ts` was
    // the example here until `ranger` graduated to `plugins/` (RFC §9 phase 4,
    // tenth plugin) — `debug-recorder.ts` is `recorder`'s, not yet migrated.
    const z = classify(["src/lib/playwright/debug-recorder.ts"]);
    expect(z.todayCore).toEqual(["src/lib/playwright/debug-recorder.ts"]);
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
