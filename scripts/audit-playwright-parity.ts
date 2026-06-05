/**
 * Out-of-app Playwright runner parity audit.
 *
 * Walks every live row in `tests` on the chosen DB source(s), reproduces
 * both the *old* and *new* runner pipelines against each `code` blob, and
 * emits a markdown report with one verdict per test:
 *
 *   GREEN              — extracts identically under both pipelines (no
 *                        behaviour change).
 *   YELLOW             — becomes more supported under the new pipeline
 *                        (framework-shape extraction succeeded, or a
 *                        matcher the new shim covers is referenced).
 *   RED                — still unsupported even after the new pipeline
 *                        (something exotic, e.g. test.describe with
 *                        multiple tests, top-level `require()`,
 *                        BrowserContext-only code).
 *   BLOCKER            — extracts today but does NOT extract under the
 *                        new pipeline. Must be 0; any non-zero count is
 *                        a regression and the PR must be held.
 *
 * The script is strictly read-only: it opens a `postgres` client that
 * runs SELECT statements only (grep the source — no INSERT/UPDATE/DELETE).
 *
 *   Local:    DATABASE_URL (default postgresql://lastest:lastest@localhost:5432/lastest)
 *   Olares:   OLARES_DATABASE_URL (port-forward the prod postgres yourself)
 *
 * Usage:
 *   pnpm tsx scripts/audit-playwright-parity.ts --source=local
 *   pnpm tsx scripts/audit-playwright-parity.ts --source=olares --out=/tmp/parity-prod.md
 *   pnpm tsx scripts/audit-playwright-parity.ts --source=both
 */

import postgres from "postgres";
import fs from "fs";
import path from "path";
import {
  extractTestBody,
  validateTestCode,
  stripTypeAnnotations,
} from "../packages/shared/src/index";

// ─── CLI parsing ─────────────────────────────────────────────────────────
type SourceName = "local" | "olares";
interface Args {
  sources: SourceName[];
  out: string | null;
  limit: number;
}

function parseArgs(): Args {
  const a: Args = { sources: ["local"], out: null, limit: 0 };
  for (const raw of process.argv.slice(2)) {
    const [key, val] = raw.split("=", 2);
    switch (key) {
      case "--source":
      case "--sources": {
        if (val === "both") a.sources = ["local", "olares"];
        else a.sources = val.split(",").map((s) => s.trim() as SourceName);
        break;
      }
      case "--out":
        a.out = val;
        break;
      case "--limit":
        a.limit = Number(val);
        break;
      case "--help":
      case "-h":
        console.log(
          "Usage: pnpm tsx scripts/audit-playwright-parity.ts [--source=local|olares|both] [--out=PATH] [--limit=N]",
        );
        process.exit(0);
      default:
        console.error(`Unknown arg: ${raw}`);
        process.exit(2);
    }
  }
  return a;
}

// ─── Connection ─────────────────────────────────────────────────────────
function connectionUrlFor(source: SourceName): string {
  if (source === "local") {
    return (
      process.env.DATABASE_URL ||
      "postgresql://lastest:lastest@localhost:5432/lastest"
    );
  }
  const url = process.env.OLARES_DATABASE_URL;
  if (!url) {
    console.error(
      "OLARES_DATABASE_URL is not set. Port-forward the prod postgres yourself, then:\n" +
        "  export OLARES_DATABASE_URL=postgresql://USER:PASS@localhost:15432/DBNAME\n" +
        "and re-run. (--source=local skips Olares.)",
    );
    process.exit(2);
  }
  return url;
}

function makeClient(source: SourceName) {
  return postgres(connectionUrlFor(source), {
    max: 4,
    prepare: false,
    onnotice: () => {},
  });
}

// ─── Today's pipeline (the prior body extractor — kept verbatim) ─────────
const LEGACY_TEST_RE =
  /export\s+async\s+function\s+test\s*\(\s*page[^)]*\)\s*\{([\s\S]*)\}\s*$/;
const LEGACY_SETUP_RE =
  /export\s+async\s+function\s+setup\s*\(\s*page[^)]*\)\s*\{([\s\S]*)\}\s*$/;

function todayExtract(code: string): { body: string; matched: boolean } {
  const m = code.match(LEGACY_SETUP_RE) ?? code.match(LEGACY_TEST_RE);
  if (m) return { body: m[1], matched: true };
  return { body: code, matched: false };
}

// ─── Matcher / helper scanners ───────────────────────────────────────────
const PRIOR_SHIM_MATCHERS = new Set([
  "toBe",
  "toEqual",
  "toBeTruthy",
  "toBeFalsy",
  "toContain",
  "toHaveLength",
  "toBeGreaterThan",
  "toBeGreaterThanOrEqual",
  "toBeLessThan",
  "toMatch",
  "toHaveURL",
  "toHaveTitle",
  "toBeVisible",
  "toBeHidden",
  "toHaveText",
  "toContainText",
]);

const ADDED_MATCHERS = new Set([
  "toBeAttached",
  "toBeEnabled",
  "toBeDisabled",
  "toBeChecked",
  "toBeFocused",
  "toBeEditable",
  "toBeEmpty",
  "toBeInViewport",
  "toHaveValue",
  "toHaveAttribute",
  "toHaveCount",
  "toHaveClass",
  "toHaveCSS",
  "toHaveJSProperty",
  "toHaveRole",
  "toStrictEqual",
  "toBeNull",
  "toBeUndefined",
  "toBeNaN",
  "toBeCloseTo",
  "toBeInstanceOf",
  "toBeLessThanOrEqual",
  "toHaveScreenshot",
]);

const HELPER_REFS = [
  "fileUpload",
  "clipboard",
  "network.",
  "fixtures",
  "replayCursorPath",
  "locateWithFallback",
  "stepLogger",
] as const;

interface BodyScan {
  matchers: string[]; // matcher names referenced via `.toXxx(`
  helpers: string[]; // helper names referenced
  hasMultilineAwait: boolean; // any line ending in a continuation operator after `await`
  hasTopLevelImport: boolean;
  hasFrameworkTestCall: boolean; // `test('name', async ({ page }) => ...)`
}

function scanBody(body: string): BodyScan {
  // Only count matchers that live inside an `expect(...)` statement —
  // otherwise plain JS methods like `.toLowerCase(` get misclassified as
  // Playwright matchers. We accumulate text from each `expect(` occurrence
  // to the next top-level `;` (or end-of-line if no semicolon) and extract
  // `.toXxx(` from that slice.
  const matcherSet = new Set<string>();
  const matcherRe = /\.(to[A-Z]\w*)\s*\(/g;
  let cursor = 0;
  while (cursor < body.length) {
    const i = body.indexOf("expect(", cursor);
    if (i < 0) break;
    // Slice up to the end of the statement (next `;` at depth 0 ish). For
    // robustness against multi-line chains, just take the next 400 chars.
    const slice = body.slice(i, Math.min(i + 400, body.length));
    let m;
    matcherRe.lastIndex = 0;
    while ((m = matcherRe.exec(slice))) matcherSet.add(m[1]);
    cursor = i + 7;
  }

  const helpers = HELPER_REFS.filter((h) => body.includes(h));

  const lines = body.split("\n");
  let multilineAwait = false;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t.startsWith("await ")) continue;
    if (!t.endsWith(";") && !t.endsWith("}") && !t.endsWith(")")) {
      multilineAwait = true;
      break;
    }
    if (t.endsWith(".") || t.endsWith(",") || t.endsWith("+")) {
      multilineAwait = true;
      break;
    }
  }

  const hasTopLevelImport = /^\s*import\s+[\w{*,\s]+from\s+['"]/m.test(body);
  const hasFrameworkTestCall =
    /\btest(?:\.(?:only|skip|fixme))?\s*\(\s*['"`][^'"`]*['"`]\s*,(?:\s*\{[^}]*\}\s*,)?\s*async\s*\(\s*\{/.test(
      body,
    );

  return {
    matchers: [...matcherSet],
    helpers,
    hasMultilineAwait: multilineAwait,
    hasTopLevelImport,
    hasFrameworkTestCall,
  };
}

// ─── Per-test verdict ───────────────────────────────────────────────────
type Verdict = "GREEN" | "YELLOW" | "RED" | "BLOCKER";

interface AuditRow {
  source: SourceName;
  id: string;
  name: string;
  repoName: string;
  areaName: string | null;
  bytes: number;
  todayExtracted: boolean;
  todayParses: boolean;
  newExtractShape: "legacy-export" | "framework-test" | "whole-code";
  newParses: boolean;
  matchersUsed: string[];
  matchersNewlySupported: string[];
  matchersStillMissing: string[];
  helpersUsed: string[];
  flags: {
    multilineAwait: boolean;
    topLevelImport: boolean;
    frameworkTestCall: boolean;
  };
  verdict: Verdict;
  reason: string;
}

function audit(row: {
  id: string;
  code: string;
  name: string;
  repoName: string;
  areaName: string | null;
  source: SourceName;
}): AuditRow {
  const code = row.code ?? "";
  const today = todayExtract(code);
  const todayParse = validateTestCode(today.body);
  const newExt = extractTestBody(code, { allowSetup: true });
  const newBodyStripped = (() => {
    try {
      return stripTypeAnnotations(newExt.body);
    } catch {
      return newExt.body;
    }
  })();
  const newParse = validateTestCode(newExt.body);
  const scan = scanBody(newBodyStripped);

  const knownAll = new Set([...PRIOR_SHIM_MATCHERS, ...ADDED_MATCHERS]);
  const matchersNewlySupported = scan.matchers.filter(
    (m) => ADDED_MATCHERS.has(m) && !PRIOR_SHIM_MATCHERS.has(m),
  );
  const matchersStillMissing = scan.matchers.filter((m) => !knownAll.has(m));

  let verdict: Verdict;
  let reason = "";

  const extractedTodayOK = today.matched && todayParse.valid;
  const extractedNewOK = newExt.shape !== "whole-code" && newParse.valid;
  const becameSupported = !extractedTodayOK && extractedNewOK;
  const gainedMatcher = matchersNewlySupported.length > 0;
  const stillBroken =
    !extractedNewOK &&
    matchersStillMissing.length === 0 &&
    newExt.shape === "whole-code";

  if (extractedTodayOK && !extractedNewOK) {
    verdict = "BLOCKER";
    reason = "Extracts under old pipeline but NOT under new — regression";
  } else if (becameSupported) {
    verdict = "YELLOW";
    reason = `Now extracts as ${newExt.shape}`;
  } else if (gainedMatcher) {
    verdict = "YELLOW";
    reason = `Uses ${matchersNewlySupported.join(", ")} (new shim covers these)`;
  } else if (
    extractedTodayOK &&
    extractedNewOK &&
    matchersStillMissing.length === 0
  ) {
    verdict = "GREEN";
    reason = "Behaviour unchanged";
  } else if (matchersStillMissing.length > 0) {
    verdict = "RED";
    reason = `Uses unsupported matchers: ${matchersStillMissing.join(", ")}`;
  } else if (stillBroken) {
    verdict = "RED";
    reason = "Falls through to whole-code fallback under new pipeline";
  } else {
    verdict = "GREEN";
    reason = "No detectable change";
  }

  return {
    source: row.source,
    id: row.id,
    name: row.name,
    repoName: row.repoName,
    areaName: row.areaName,
    bytes: code.length,
    todayExtracted: today.matched,
    todayParses: todayParse.valid,
    newExtractShape: newExt.shape,
    newParses: newParse.valid,
    matchersUsed: scan.matchers,
    matchersNewlySupported,
    matchersStillMissing,
    helpersUsed: scan.helpers,
    flags: {
      multilineAwait: scan.hasMultilineAwait,
      topLevelImport: scan.hasTopLevelImport,
      frameworkTestCall: scan.hasFrameworkTestCall,
    },
    verdict,
    reason,
  };
}

// ─── Output ─────────────────────────────────────────────────────────────
function fmtCount(rows: AuditRow[], v: Verdict): string {
  return String(rows.filter((r) => r.verdict === v).length);
}

function topByCount(values: string[], n: number): Array<[string, number]> {
  const c = new Map<string, number>();
  for (const v of values) c.set(v, (c.get(v) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

function renderMarkdown(rows: AuditRow[]): string {
  const total = rows.length;
  const lines: string[] = [];
  lines.push("# Playwright runner parity audit");
  lines.push("");
  lines.push(`- Generated: ${new Date().toISOString()}`);
  lines.push(`- Total tests scanned: ${total}`);
  lines.push("");
  lines.push("## Verdict counts");
  lines.push("");
  lines.push("| Verdict | Count | Meaning |");
  lines.push("|---|---|---|");
  lines.push(
    `| GREEN | ${fmtCount(rows, "GREEN")} | extracts identically under both pipelines, no new matchers needed |`,
  );
  lines.push(
    `| YELLOW | ${fmtCount(rows, "YELLOW")} | now extracts or now uses a newly-supported matcher (net gain) |`,
  );
  lines.push(
    `| RED | ${fmtCount(rows, "RED")} | still unsupported after this PR (known gap, not a regression) |`,
  );
  lines.push(
    `| BLOCKER | ${fmtCount(rows, "BLOCKER")} | extracts today but NOT under new pipeline (regression — HOLD) |`,
  );
  lines.push("");

  const blockers = rows.filter((r) => r.verdict === "BLOCKER");
  if (blockers.length > 0) {
    lines.push("## BLOCKERS (must investigate before merge)");
    lines.push("");
    for (const b of blockers) {
      lines.push(
        `- \`${b.source}\` test ${b.id.slice(0, 8)}… (${b.repoName}/${b.name}) — ${b.reason}`,
      );
    }
    lines.push("");
  }

  lines.push("## Most-used matchers (top 15)");
  lines.push("");
  const allMatchers = rows.flatMap((r) => r.matchersUsed);
  for (const [name, n] of topByCount(allMatchers, 15)) {
    const tag =
      ADDED_MATCHERS.has(name) && !PRIOR_SHIM_MATCHERS.has(name)
        ? " **(new)**"
        : !PRIOR_SHIM_MATCHERS.has(name) && !ADDED_MATCHERS.has(name)
          ? " **(still missing)**"
          : "";
    lines.push(`- \`${name}\` — ${n}${tag}`);
  }
  lines.push("");

  lines.push("## Newly-supported matcher hits (top 10)");
  lines.push("");
  const newlyAll = rows.flatMap((r) => r.matchersNewlySupported);
  for (const [name, n] of topByCount(newlyAll, 10)) {
    lines.push(`- \`${name}\` — ${n} tests gain support`);
  }
  if (newlyAll.length === 0) lines.push("- (none observed in this corpus)");
  lines.push("");

  lines.push("## Still-missing matchers (top 10)");
  lines.push("");
  const missingAll = rows.flatMap((r) => r.matchersStillMissing);
  for (const [name, n] of topByCount(missingAll, 10)) {
    lines.push(`- \`${name}\` — ${n} tests`);
  }
  if (missingAll.length === 0)
    lines.push("- (no unsupported matchers detected)");
  lines.push("");

  lines.push("## Pattern flags (counts)");
  lines.push("");
  lines.push(
    `- Top-level \`import\` lines (stripped in both runners now): ${rows.filter((r) => r.flags.topLevelImport).length}`,
  );
  lines.push(
    `- Framework-style \`test('name', async ({ page }) => …)\` bodies: ${rows.filter((r) => r.flags.frameworkTestCall).length}`,
  );
  lines.push(
    `- Multi-line \`await\` statements (deferred soft-wrap fix, see plan): ${rows.filter((r) => r.flags.multilineAwait).length}`,
  );
  lines.push("");

  lines.push("## Per-test table (first 200)");
  lines.push("");
  lines.push(
    "| Source | id | repo / name | bytes | today→new shape | verdict | reason |",
  );
  lines.push("|---|---|---|---|---|---|---|");
  for (const r of rows.slice(0, 200)) {
    const shapeDelta = `${r.todayExtracted ? "legacy" : "fallback"} → ${r.newExtractShape}`;
    lines.push(
      `| ${r.source} | \`${r.id.slice(0, 8)}\` | ${escapeMd(r.repoName)} / ${escapeMd(r.name)} | ${r.bytes} | ${shapeDelta} | ${r.verdict} | ${escapeMd(r.reason)} |`,
    );
  }
  if (rows.length > 200) lines.push("");
  if (rows.length > 200)
    lines.push(`_(${rows.length - 200} more rows truncated)_`);

  return lines.join("\n") + "\n";
}

function escapeMd(s: string): string {
  return (s || "").replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
}

// ─── Main ──────────────────────────────────────────────────────────────
async function auditSource(
  source: SourceName,
  limit: number,
): Promise<AuditRow[]> {
  const sql = makeClient(source);
  try {
    // Read-only SELECT — no mutation possible.
    const query = sql`
      SELECT t.id AS id, t.code AS code, t.name AS name,
             COALESCE(r.name, '<no-repo>') AS repo_name,
             fa.name AS area_name
      FROM tests t
      LEFT JOIN repositories r ON t.repository_id = r.id
      LEFT JOIN functional_areas fa ON t.functional_area_id = fa.id
      WHERE t.deleted_at IS NULL
      ORDER BY t.created_at DESC NULLS LAST
      ${limit > 0 ? sql`LIMIT ${limit}` : sql``}
    `;
    const rows = (await query) as unknown as Array<{
      id: string;
      code: string;
      name: string;
      repo_name: string;
      area_name: string | null;
    }>;
    console.error(`[${source}] scanned ${rows.length} tests`);
    return rows.map((row) =>
      audit({
        id: row.id,
        code: row.code,
        name: row.name,
        repoName: row.repo_name,
        areaName: row.area_name,
        source,
      }),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function main() {
  const args = parseArgs();
  const all: AuditRow[] = [];
  for (const src of args.sources) {
    try {
      const rows = await auditSource(src, args.limit);
      all.push(...rows);
    } catch (err) {
      console.error(
        `[${src}] audit failed:`,
        err instanceof Error ? err.message : err,
      );
      if (args.sources.length === 1) process.exit(1);
    }
  }

  const md = renderMarkdown(all);
  if (args.out) {
    fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
    fs.writeFileSync(args.out, md);
    console.error(`Wrote ${all.length} rows → ${args.out}`);
  } else {
    process.stdout.write(md);
  }

  const blockers = all.filter((r) => r.verdict === "BLOCKER").length;
  if (blockers > 0) {
    console.error(
      `\n❌ ${blockers} BLOCKER(s) — pipeline regresses against this corpus`,
    );
    process.exit(3);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
