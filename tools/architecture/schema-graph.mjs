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
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const SCHEMA = join(ROOT, "packages/db/src/schema.ts");

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

const src = readFileSync(SCHEMA, "utf8");

// ── Parse: exportName -> sqlName, and the source span of each table ──────────
const tables = new Map(); // exportName -> { sql, start, end, domain }
const declRe = /export const (\w+)\s*=\s*pgTable\(\s*["'`]([^"'`]+)["'`]/g;
const decls = [...src.matchAll(declRe)];

decls.forEach((m, i) => {
  const start = m.index;
  const end = i + 1 < decls.length ? decls[i + 1].index : src.length;
  tables.set(m[1], { sql: m[2], start, end, domain: domainOf(m[2]) });
});

const byExport = new Map([...tables].map(([k, v]) => [k, v]));

// ── Parse: FK edges, attributed to the table whose span contains them ────────
const edges = [];
const refRe = /\.references\(\s*\(\s*\)\s*=>\s*(\w+)\.(\w+)/g;
for (const m of src.matchAll(refRe)) {
  const from = [...tables].find(
    ([, v]) => m.index >= v.start && m.index < v.end,
  );
  if (!from) continue;
  const target = byExport.get(m[1]);
  if (!target) continue;
  edges.push({ fromTable: from[0], to: m[1] });
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
const softRefs = [];
const colRe =
  /(\w+):\s*(?:uuid|text|varchar)\(\s*["'`]([a-z0-9_]*_id)["'`]\s*\)([^,]*)/g;
for (const m of src.matchAll(colRe)) {
  const owner = [...tables].find(
    ([, v]) => m.index >= v.start && m.index < v.end,
  );
  if (!owner) continue;
  if (m[3].includes("references")) continue;
  softRefs.push({ table: owner[0], column: m[2] });
}

const json = process.argv.includes("--json");

if (json) {
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

  const unassigned = [...tables].filter(([, v]) => v.domain === "unassigned");
  console.log(`\nUnassigned tables (${unassigned.length}) — need a decision:`);
  for (const [, v] of unassigned) console.log(`    ${v.sql}`);
  console.log("");
}
