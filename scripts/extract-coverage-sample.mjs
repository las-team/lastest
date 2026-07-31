#!/usr/bin/env node
/**
 * Extract sample data sets from the Lastest database as CSVs, for exercising
 * the data-coverage model without a customer's data.
 *
 * Lastest's own tables are a genuinely good sample: test runs have browsers,
 * viewports, statuses and branches — bounded value domains with real, uneven
 * volume, which is exactly the shape the coverage model is designed for. A
 * synthetic fixture with tidy uniform distributions would hide the behaviour
 * that matters (log-scaled volume weighting, non-occurring combinations).
 *
 * Usage:
 *   DATABASE_URL=... node scripts/extract-coverage-sample.mjs [outDir]
 *
 * Then upload the CSVs on the Coverage page and press Re-profile.
 */

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const OUT_DIR = process.argv[2] ?? "storage/coverage-samples";

const DATASETS = [
  {
    name: "test-executions",
    description:
      "One row per test result: browser x viewport x status x branch. The " +
      "canonical shape — several bounded dimensions with skewed volume.",
    sql: `
      SELECT
        COALESCE(tr.browser, 'chromium')            AS browser,
        COALESCE(tr.viewport, 'unknown')            AS viewport,
        COALESCE(tr.status, 'unknown')              AS status,
        COALESCE(run.git_branch, 'unknown')         AS branch,
        CASE WHEN tr.is_flaky THEN 'flaky' ELSE 'stable' END AS stability,
        CASE
          WHEN tr.duration_ms IS NULL   THEN 'unknown'
          WHEN tr.duration_ms < 5000    THEN 'fast'
          WHEN tr.duration_ms < 30000   THEN 'medium'
          ELSE 'slow'
        END                                          AS speed_band
      FROM test_results tr
      JOIN test_runs run ON run.id = tr.test_run_id
      ORDER BY tr.id
      LIMIT 5000
    `,
  },
  {
    name: "visual-diffs",
    description:
      "Diff outcomes by browser and status — a narrower space, useful for " +
      "seeing pairwise reduction bite on a small dimension set.",
    sql: `
      SELECT
        COALESCE(vd.status, 'unknown')                AS diff_status,
        COALESCE(vd.browser, 'chromium')              AS browser,
        COALESCE(vd.step_label, 'full-page')          AS step_label,
        -- percentage_difference is stored as text; cast defensively so a
        -- non-numeric legacy value cannot abort the whole extract.
        CASE
          WHEN vd.percentage_difference IS NULL THEN 'unknown'
          WHEN vd.percentage_difference !~ '^[0-9.]+$' THEN 'unknown'
          WHEN vd.percentage_difference::numeric = 0  THEN 'identical'
          WHEN vd.percentage_difference::numeric < 1  THEN 'minor'
          WHEN vd.percentage_difference::numeric < 10 THEN 'moderate'
          ELSE 'major'
        END                                            AS severity
      FROM visual_diffs vd
      ORDER BY vd.id
      LIMIT 5000
    `,
  },
  {
    name: "test-catalog",
    description:
      "The test suite itself by type, execution mode and area — shows how a " +
      "dimension with a dominant value (most tests are 'browser') is weighted.",
    sql: `
      SELECT
        COALESCE(t.test_type, 'browser')        AS test_type,
        COALESCE(t.execution_mode, 'procedural') AS execution_mode,
        CASE WHEN t.quarantined THEN 'quarantined' ELSE 'active' END AS quarantine_state,
        COALESCE(fa.name, 'unassigned')          AS functional_area
      FROM tests t
      LEFT JOIN functional_areas fa ON fa.id = t.functional_area_id
      WHERE t.deleted_at IS NULL
      ORDER BY t.id
      LIMIT 5000
    `,
  },
];

function toCsv(rows) {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => escape(r[h])).join(",")),
  ].join("\n");
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const sql = postgres(url, { max: 1 });
  await mkdir(OUT_DIR, { recursive: true });

  let wrote = 0;
  for (const ds of DATASETS) {
    let rows;
    try {
      rows = await sql.unsafe(ds.sql);
    } catch (err) {
      console.warn(`! ${ds.name}: query failed — ${err.message}`);
      continue;
    }
    if (rows.length === 0) {
      console.warn(`! ${ds.name}: no rows, skipped`);
      continue;
    }

    const file = path.join(OUT_DIR, `${ds.name}.csv`);
    await writeFile(file, toCsv(rows), "utf8");
    wrote += 1;

    // Report the distinct-value profile so it is obvious up front which
    // columns will survive the dimension cardinality filters.
    const headers = Object.keys(rows[0]);
    const profile = headers
      .map((h) => `${h}=${new Set(rows.map((r) => r[h])).size}`)
      .join(", ");
    console.log(`✓ ${file}  (${rows.length} rows)`);
    console.log(`    ${ds.description}`);
    console.log(`    distinct values: ${profile}`);
  }

  await sql.end();
  if (wrote === 0) {
    console.error("\nNo datasets written — is this database populated?");
    process.exit(1);
  }
  console.log(
    `\n${wrote} sample dataset(s) in ${OUT_DIR}. Upload them on the Coverage page, then enable the dimensions you want measured.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
