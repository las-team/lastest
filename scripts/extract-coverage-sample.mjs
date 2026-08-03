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
 * SCOPED TO ONE REPOSITORY. Coverage is repo-scoped everywhere else in the
 * product, and pooling every repo into one extract is not a bigger sample, it
 * is a different (wrong) population: unrelated repos' functional areas pile
 * into one column until it trips the free-text cardinality cap, and step
 * labels become a bag of strings no single suite ever produced. Defaults to
 * the repository with the most test results.
 *
 * Usage:
 *   DATABASE_URL=... node scripts/extract-coverage-sample.mjs [outDir] [--repo <id|full_name|name>]
 *
 * Then upload the CSVs on the Coverage page and press Re-profile.
 */

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const argv = process.argv.slice(2);
const repoFlagIndex = argv.findIndex((a) => a === "--repo");
const REPO_ARG = repoFlagIndex === -1 ? null : argv[repoFlagIndex + 1];
const OUT_DIR =
  argv.filter((a, i) => !a.startsWith("--") && i !== repoFlagIndex + 1)[0] ??
  "storage/coverage-samples";

/**
 * `impact` collapses each check layer's heterogeneous evidence to one 3-level
 * band, so a single dimension spans every layer. Without it the column would
 * mean something different per layer and could not be a value domain at all.
 */
const IMPACT_SQL = `
  CASE l.layer
    WHEN 'visual' THEN
      -- percentageDifference is stored as TEXT; guard the cast so one legacy
      -- non-numeric value cannot abort the whole extract.
      CASE
        WHEN l.payload->>'percentageDifference' !~ '^[0-9.]+$' THEN 'none'
        WHEN (l.payload->>'percentageDifference')::numeric = 0 THEN 'none'
        WHEN (l.payload->>'percentageDifference')::numeric < 1 THEN 'low'
        ELSE 'high'
      END
    WHEN 'network' THEN
      CASE
        WHEN COALESCE((l.payload->>'newErrorCount')::int, 0) > 0 THEN 'high'
        WHEN COALESCE((l.payload->>'added')::int, 0)
           + COALESCE((l.payload->>'removed')::int, 0)
           + COALESCE((l.payload->>'changed')::int, 0) > 0 THEN 'low'
        ELSE 'none'
      END
    WHEN 'a11y' THEN
      CASE
        WHEN COALESCE(jsonb_array_length(l.payload->'newViolations'), 0) > 0 THEN 'high'
        WHEN COALESCE(jsonb_array_length(l.payload->'disappeared'), 0) > 0 THEN 'low'
        ELSE 'none'
      END
    WHEN 'consoleDiff' THEN
      -- countDelta is a fingerprint->delta MAP, not a scalar, so the bands come
      -- from the two arrays instead: a new console fingerprint is a regression,
      -- one that disappeared is an improvement.
      CASE
        WHEN COALESCE(jsonb_array_length(l.payload->'newFingerprints'), 0) > 0 THEN 'high'
        WHEN COALESCE(jsonb_array_length(l.payload->'disappeared'), 0) > 0 THEN 'low'
        ELSE 'none'
      END
    WHEN 'url' THEN
      CASE WHEN COALESCE(jsonb_array_length(l.payload->'divergedSteps'), 0) > 0
           THEN 'high' ELSE 'none' END
    WHEN 'variable' THEN
      CASE WHEN COALESCE(jsonb_array_length(l.payload->'changes'), 0) > 0
           THEN 'low' ELSE 'none' END
    WHEN 'perf' THEN
      CASE WHEN l.payload->'deltas' IS NOT NULL AND l.payload->'deltas' <> '{}'::jsonb
           THEN 'low' ELSE 'none' END
    ELSE 'none'
  END
`;

const DATASETS = [
  {
    name: "test-executions",
    description:
      "One row per test result: browser x viewport x status x branch x " +
      "functional area. The canonical shape — several bounded dimensions with " +
      "skewed volume. viewport is also split into its components, which the " +
      "profiler will accept but which carry no information beyond `viewport` " +
      "itself until a second viewport is actually exercised.",
    sql: (repo) => `
      SELECT
        COALESCE(tr.browser, 'chromium')            AS browser,
        COALESCE(tr.viewport, 'unknown')            AS viewport,
        COALESCE(split_part(tr.viewport, 'x', 1), 'unknown') AS viewport_width,
        COALESCE(split_part(tr.viewport, 'x', 2), 'unknown') AS viewport_height,
        CASE
          WHEN tr.viewport IS NULL THEN 'unknown'
          WHEN split_part(tr.viewport, 'x', 1) ~ '^[0-9]+$'
           AND split_part(tr.viewport, 'x', 1)::int >= 1024 THEN 'desktop'
          WHEN split_part(tr.viewport, 'x', 1) ~ '^[0-9]+$'
           AND split_part(tr.viewport, 'x', 1)::int >= 768 THEN 'tablet'
          ELSE 'mobile'
        END                                          AS device_class,
        COALESCE(tr.status, 'unknown')              AS status,
        COALESCE(run.git_branch, 'unknown')         AS branch,
        CASE WHEN tr.is_flaky THEN 'flaky' ELSE 'stable' END AS stability,
        CASE
          WHEN tr.duration_ms IS NULL   THEN 'unknown'
          WHEN tr.duration_ms < 5000    THEN 'fast'
          WHEN tr.duration_ms < 30000   THEN 'medium'
          ELSE 'slow'
        END                                          AS speed_band,
        COALESCE(fa.name, 'unassigned')              AS functional_area
      FROM test_results tr
      JOIN test_runs run ON run.id = tr.test_run_id
      LEFT JOIN tests t ON t.id = tr.test_id
      LEFT JOIN functional_areas fa ON fa.id = t.functional_area_id
      WHERE run.repository_id = '${repo}'
      ORDER BY tr.id
      LIMIT 5000
    `,
  },
  {
    name: "visual-diffs",
    description:
      "Diff outcomes by browser and status — a narrower space, useful for " +
      "seeing pairwise reduction bite on a small dimension set.",
    sql: (repo) => `
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
      JOIN builds b ON b.id = vd.build_id
      JOIN test_runs run ON run.id = b.test_run_id
      WHERE run.repository_id = '${repo}'
      ORDER BY vd.id
      LIMIT 5000
    `,
  },
  {
    name: "test-catalog",
    description:
      "The test suite itself by type, execution mode and area — shows how a " +
      "dimension with a dominant value (most tests are 'browser') is weighted.",
    sql: (repo) => `
      SELECT
        COALESCE(t.test_type, 'browser')        AS test_type,
        COALESCE(t.execution_mode, 'procedural') AS execution_mode,
        CASE WHEN t.quarantined THEN 'quarantined' ELSE 'active' END AS quarantine_state,
        COALESCE(fa.name, 'unassigned')          AS functional_area
      FROM tests t
      LEFT JOIN functional_areas fa ON fa.id = t.functional_area_id
      WHERE t.deleted_at IS NULL
        AND t.repository_id = '${repo}'
      ORDER BY t.id
      LIMIT 5000
    `,
  },
  {
    name: "step-comparisons",
    description:
      "One row per (step comparison x check layer) — which comparison engines " +
      "actually ran on a step, and what each concluded. Layers are a per-row " +
      "SUBSET, not a fixed set, so 'which engines ran together' is a genuine " +
      "occurring-combination question rather than a cartesian one.",
    sql: (repo) => `
      SELECT
        l.layer                                       AS layer,
        sc.verdict                                    AS verdict,
        ${IMPACT_SQL}                                 AS impact,
        COALESCE(sc.step_label, 'full-page')          AS step_label
      FROM step_comparisons sc
      JOIN builds b ON b.id = sc.build_id
      JOIN test_runs run ON run.id = b.test_run_id
      CROSS JOIN LATERAL (
        SELECT key AS layer, value AS payload FROM jsonb_each(sc.layers)
      ) l
      WHERE run.repository_id = '${repo}'
        AND jsonb_typeof(sc.layers) = 'object'
      ORDER BY sc.id, l.layer
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

/** Resolve --repo, or default to the repository with the most test results. */
async function resolveRepo(sql) {
  if (REPO_ARG) {
    const [row] = await sql`
      SELECT id, full_name, name FROM repositories
      WHERE id = ${REPO_ARG} OR full_name = ${REPO_ARG} OR name = ${REPO_ARG}
      LIMIT 1`;
    if (!row) throw new Error(`no repository matching "${REPO_ARG}"`);
    return row;
  }
  const [row] = await sql`
    SELECT r.id, r.full_name, r.name, count(tr.id) AS results
    FROM repositories r
    JOIN test_runs run ON run.repository_id = r.id
    JOIN test_results tr ON tr.test_run_id = run.id
    GROUP BY r.id, r.full_name, r.name
    ORDER BY count(tr.id) DESC
    LIMIT 1`;
  if (!row) throw new Error("no repository has any test results");
  return row;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const sql = postgres(url, { max: 1 });
  await mkdir(OUT_DIR, { recursive: true });

  const repo = await resolveRepo(sql);
  console.log(
    `repository: ${repo.full_name ?? repo.name} (${repo.id})` +
      (REPO_ARG ? "" : "  [default: most test results — override with --repo]"),
  );

  let wrote = 0;
  for (const ds of DATASETS) {
    let rows;
    try {
      rows = await sql.unsafe(ds.sql(repo.id));
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
    console.error("\nNo datasets written — is this repository populated?");
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
