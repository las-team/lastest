#!/usr/bin/env node
/**
 * Table cross-reference map for `packages/db/src/schema.ts`.
 *
 *   pnpm schema:graph            # per-table FK in/out + the domain cut report
 *   pnpm schema:graph --json     # machine-readable, for the split tooling
 *
 * Exists because the honest blocker on splitting a 5,766-line, 97-table schema
 * is not the mechanical move — it is that nobody can say which tables reference
 * which without reading all of it. This answers that question directly, and the
 * "cut edges" section is the list of FKs that would cross a module boundary if
 * the schema were split along the proposed lines.
 *
 * Lexical, not a type-checker: it reads `pgTable("name", …)` declarations and
 * `.references(() => other.col)` calls. That is exactly the information drizzle
 * itself uses to emit FK constraints, so it cannot miss a real FK — but it will
 * not see a relationship that exists only by convention (an `xId` column with no
 * `.references()`), which is itself worth knowing.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

/**
 * Read every schema source. `packages/db/src/schema.ts` used to hold all 98
 * tables; it is now a barrel over `packages/db/src/schema/*.ts`. Both shapes are
 * handled so the tool works before and after the split — and so it keeps
 * working if some tables stay in the barrel.
 *
 * Concatenating the modules is sound here because the analysis is per-table and
 * lexical: table spans are delimited by the next `pgTable` declaration, and a
 * file boundary is just another delimiter.
 */
function readSchemaSources() {
  /** @type {Array<{ module: string | null, text: string }>} */
  const parts = [];
  const barrel = join(ROOT, "packages/db/src/schema.ts");
  if (existsSync(barrel)) {
    parts.push({ module: null, text: readFileSync(barrel, "utf8") });
  }

  const dir = join(ROOT, "packages/db/src/schema");
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).sort()) {
      if (f.endsWith(".ts") && !f.endsWith(".test.ts")) {
        parts.push({
          module: f.replace(/\.ts$/, ""),
          text: readFileSync(join(dir, f), "utf8"),
        });
      }
    }
  }

  // Plugin-owned schemas, once features start moving out (core-scope.md §7).
  const plugins = join(ROOT, "plugins");
  if (existsSync(plugins)) {
    for (const p of readdirSync(plugins).sort()) {
      const f = join(plugins, p, "src/schema.ts");
      if (existsSync(f)) {
        parts.push({ module: `plugin:${p}`, text: readFileSync(f, "utf8") });
      }
    }
  }

  if (parts.length === 0) {
    throw new Error("No schema sources found under packages/db/src");
  }
  return parts;
}

/**
 * Import edges between the schema modules themselves.
 *
 * Distinct from the FK graph: this is what actually decides whether the split is
 * legal ESM. Circular imports happen to work for drizzle — `.references(() => x)`
 * defers the dereference and type imports erase — but they are fragile enough
 * to be worth failing a test over rather than discovering later.
 */
export function schemaModuleImports() {
  const dir = join(ROOT, "packages/db/src/schema");
  /** @type {Map<string, string[]>} */
  const graph = new Map();
  if (!existsSync(dir)) return graph;

  for (const f of readdirSync(dir).sort()) {
    if (!f.endsWith(".ts") || f.endsWith(".test.ts")) continue;
    const text = readFileSync(join(dir, f), "utf8");
    const deps = new Set();
    for (const m of text.matchAll(/from\s+["']\.\/([a-z0-9-]+)["']/g)) {
      deps.add(m[1]);
    }
    graph.set(f.replace(/\.ts$/, ""), [...deps].sort());
  }
  return graph;
}

/** Cycles in the module import graph, as paths. Empty when acyclic. */
export function schemaModuleCycles() {
  const graph = schemaModuleImports();
  const cycles = [];
  const state = new Map(); // 0 = visiting, 1 = done

  const walk = (node, path) => {
    if (state.get(node) === 1) return;
    if (state.get(node) === 0) {
      cycles.push([...path.slice(path.indexOf(node)), node].join(" → "));
      return;
    }
    state.set(node, 0);
    for (const dep of graph.get(node) ?? []) walk(dep, [...path, node]);
    state.set(node, 1);
  };

  for (const node of graph.keys()) walk(node, []);
  return [...new Set(cycles)];
}

/**
 * Proposed module boundaries. A table not matched by any rule lands in
 * `unassigned`, which is a finding, not a default.
 *
 * Ordered: first match wins, so put specific prefixes before general ones.
 */
const DOMAINS = [
  [
    "identity",
    /^(users|teams|sessions?|accounts?|verification|user_invitations|user_consents|api_tokens|oauth|subscription|stripe_webhook_events|team_)/,
  ],
  ["repos", /^(repositories|repo_|github_|gitlab_|prs?$|pull_requests)/],
  [
    "tests",
    /^(tests|test_|assertions|functional_areas|routes?$|route_|planned_)/,
  ],
  [
    "runs",
    /^(builds?$|build_|test_runs|test_results|runners|runner_|embedded_sessions|background_jobs|schedules?$)/,
  ],
  [
    "visual",
    /^(visual_diffs|baselines?$|.*_baselines|ignore_regions|step_comparisons|step_layer_|change_map)/,
  ],
  [
    "settings",
    /^(.*_settings|setup_|teardown_|storage_states|test_fixtures|csv_|google_sheets|spec_imports|variable_)/,
  ],
  ["agents", /^(agent_|qa_|explorer_|app_map|rca_)/],
  [
    "growth",
    /^(gamification_|bug_blitz|score_events|user_scores|achievements|playground_|launch_|repo_awards|public_shares|.*demo_notes|activity_events|analytics_)/,
  ],
];

function domainOf(table) {
  for (const [name, re] of DOMAINS) if (re.test(table)) return name;
  return "unassigned";
}

const parts = readSchemaSources();

// ── Parse: exportName -> sqlName, per source file ────────────────────────────
// Once the schema is split, a table's module IS its domain — no guessing. The
// `DOMAINS` regex is only the fallback for tables still sitting in one big file.
const tables = new Map(); // exportName -> { sql, module, domain, span }
const declRe = /export const (\w+)\s*=\s*pgTable\(\s*["'`]([^"'`]+)["'`]/g;

/** @type {Array<{ table: string, text: string }>} */
const spans = [];

for (const { module, text } of parts) {
  const decls = [...text.matchAll(declRe)];
  decls.forEach((m, i) => {
    const end = i + 1 < decls.length ? decls[i + 1].index : text.length;
    tables.set(m[1], {
      sql: m[2],
      module,
      domain: module ?? domainOf(m[2]),
    });
    spans.push({ table: m[1], text: text.slice(m.index, end) });
  });
}

const byExport = tables;

// ── Parse: FK edges, attributed to the table whose span contains them ────────
const edges = [];
const refRe = /\.references\(\s*\(\s*\)\s*=>\s*(\w+)\.(\w+)/g;
for (const { table, text } of spans) {
  for (const m of text.matchAll(refRe)) {
    if (!byExport.has(m[1])) continue;
    edges.push({ fromTable: table, to: m[1] });
  }
}

const fkEdges = edges.map((e) => ({
  from: e.fromTable,
  to: e.to,
  fromSql: tables.get(e.fromTable).sql,
  toSql: tables.get(e.to).sql,
  fromDomain: tables.get(e.fromTable).domain,
  toDomain: tables.get(e.to).domain,
}));

// ── Also flag convention-only relationships: an `xId` column with no FK ───────
// These are invisible to drizzle and to any FK-based tooling, so nobody can tell
// a deliberate soft reference from a forgotten constraint. 104 of them is the
// real reason the schema feels unknowable — see core-scope.md §7.
const softRefs = [];
const colRe =
  /(\w+):\s*(?:uuid|text|varchar)\(\s*["'`]([a-z0-9_]*_id)["'`]\s*\)([^,]*)/g;
for (const { table, text } of spans) {
  for (const m of text.matchAll(colRe)) {
    if (m[3].includes("references")) continue;
    softRefs.push({ table, column: m[2] });
  }
}

// Only print when run as a script — `boundaries.test.ts` imports the cycle
// helpers above and must not get a report dumped into the test output.
const isMain = process.argv[1] && process.argv[1].endsWith("schema-graph.mjs");
const json = process.argv.includes("--json");

if (!isMain) {
  // nothing to do on import
} else if (json) {
  console.log(
    JSON.stringify(
      {
        tables: [...tables].map(([exportName, v]) => ({
          exportName,
          sql: v.sql,
          domain: v.domain,
        })),
        fkEdges,
        softRefs,
      },
      null,
      2,
    ),
  );
} else {
  const inbound = new Map();
  const outbound = new Map();
  for (const e of fkEdges) {
    outbound.set(e.from, (outbound.get(e.from) ?? 0) + 1);
    inbound.set(e.to, (inbound.get(e.to) ?? 0) + 1);
  }

  console.log(
    `\n${tables.size} tables, ${fkEdges.length} foreign keys, ${softRefs.length} convention-only *_id columns\n`,
  );

  // Domain sizes
  const domainCount = new Map();
  for (const [, v] of tables)
    domainCount.set(v.domain, (domainCount.get(v.domain) ?? 0) + 1);
  console.log("Proposed modules:");
  for (const [d, n] of [...domainCount].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(3)}  ${d}`);
  }

  // The load-bearing tables — most referenced
  console.log(
    "\nMost-referenced tables (these are the ones a split must not cut):",
  );
  for (const [t, n] of [...inbound].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(
      `  ${String(n).padStart(3)} inbound  ${tables.get(t).sql.padEnd(28)} [${tables.get(t).domain}]`,
    );
  }

  // Cut edges: FKs that cross a proposed module boundary
  const cut = fkEdges.filter((e) => e.fromDomain !== e.toDomain);
  const cutPairs = new Map();
  for (const e of cut) {
    const k = `${e.fromDomain} → ${e.toDomain}`;
    cutPairs.set(k, (cutPairs.get(k) ?? 0) + 1);
  }
  console.log(
    `\n${cut.length} of ${fkEdges.length} FKs cross a proposed module boundary:`,
  );
  for (const [k, n] of [...cutPairs].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(3)}  ${k}`);
  }

  // The ones that matter most for the plugin story: anything pointing INTO agents/growth
  const intoFeature = fkEdges.filter(
    (e) =>
      ["agents", "growth"].includes(e.toDomain) &&
      !["agents", "growth"].includes(e.fromDomain),
  );
  console.log(
    `\nCore → feature FKs (these BLOCK extraction; core must not depend on a plugin): ${intoFeature.length}`,
  );
  for (const e of intoFeature) {
    console.log(`    ${e.fromSql} → ${e.toSql}`);
  }

  // Domain-level cycles. If `identity.ts` imports from `repos.ts` and vice
  // versa, splitting the file that way creates a circular ESM import. It
  // happens to work here — `.references(() => x)` defers the dereference and
  // type imports erase — but it is fragile enough that whoever does the split
  // should know before, not after.
  const domainEdges = new Map();
  for (const e of fkEdges) {
    if (e.fromDomain === e.toDomain) continue;
    if (!domainEdges.has(e.fromDomain))
      domainEdges.set(e.fromDomain, new Set());
    domainEdges.get(e.fromDomain).add(e.toDomain);
  }
  const cycles = [];
  for (const [a, targets] of domainEdges) {
    for (const b of targets) {
      if (a < b && domainEdges.get(b)?.has(a)) cycles.push([a, b]);
    }
  }
  console.log(
    `\nDomain-level import cycles a per-module split would create: ${cycles.length}`,
  );
  for (const [a, b] of cycles) {
    const ab = fkEdges.filter((e) => e.fromDomain === a && e.toDomain === b);
    const ba = fkEdges.filter((e) => e.fromDomain === b && e.toDomain === a);
    console.log(`    ${a} ⇄ ${b}`);
    for (const e of [...ab, ...ba]) {
      console.log(`        ${e.fromSql} → ${e.toSql}`);
    }
  }

  const unassigned = [...tables].filter(([, v]) => v.domain === "unassigned");
  console.log(`\nUnassigned tables (${unassigned.length}) — need a decision:`);
  for (const [, v] of unassigned) console.log(`    ${v.sql}`);
  console.log("");
}
