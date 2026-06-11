#!/usr/bin/env node
/**
 * One-shot dedupe for the `selector_stats` table.
 *
 * The pre-unique-index recorders did SELECT-then-INSERT, so concurrent test
 * runs could create duplicate rows per (test_id, selector_array_hash,
 * selector_type, selector_value), splitting success/failure counts across
 * rows. The schema now declares `uniq_selector_stats_test_hash_type_value`;
 * `pnpm db:push` will refuse to create it while duplicates exist.
 *
 * This script merges each duplicate group into its lowest-id row (counts
 * summed, avg response time success-weighted, latest last_used_at kept) and
 * deletes the rest. Re-running is safe: with no duplicates both statements
 * are no-ops.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... node scripts/dedupe-selector-stats.mjs
 *   (falls back to the local dev default when DATABASE_URL is unset)
 */
import postgres from "postgres";

const connectionString =
  process.env.DATABASE_URL ||
  "postgresql://lastest:lastest@localhost:5432/lastest";

const sql = postgres(connectionString, { max: 1 });

try {
  const result = await sql.begin(async (tx) => {
    const merged = await tx`
      WITH agg AS (
        SELECT
          MIN(id) AS keep_id,
          SUM(COALESCE(success_count, 0))::int AS s,
          SUM(COALESCE(failure_count, 0))::int AS f,
          SUM(COALESCE(total_attempts, 0))::int AS t,
          CASE
            WHEN SUM(COALESCE(success_count, 0)) FILTER (WHERE avg_response_time_ms IS NOT NULL) > 0
            THEN ROUND(
              SUM(avg_response_time_ms::numeric * COALESCE(success_count, 0)) FILTER (WHERE avg_response_time_ms IS NOT NULL)
              / SUM(COALESCE(success_count, 0)) FILTER (WHERE avg_response_time_ms IS NOT NULL)
            )::int
            ELSE NULL
          END AS avg_ms,
          MAX(last_used_at) AS lu
        FROM selector_stats
        GROUP BY test_id, selector_array_hash, selector_type, selector_value
        HAVING COUNT(*) > 1
      )
      UPDATE selector_stats ss
      SET success_count = agg.s,
          failure_count = agg.f,
          total_attempts = agg.t,
          avg_response_time_ms = agg.avg_ms,
          last_used_at = agg.lu
      FROM agg
      WHERE ss.id = agg.keep_id
    `;

    const deleted = await tx`
      DELETE FROM selector_stats ss
      USING (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY test_id, selector_array_hash, selector_type, selector_value
                 ORDER BY id
               ) AS rn
        FROM selector_stats
      ) d
      WHERE ss.id = d.id AND d.rn > 1
    `;

    return { merged: merged.count, deleted: deleted.count };
  });

  console.log(
    `selector_stats dedupe: merged ${result.merged} group(s), deleted ${result.deleted} duplicate row(s).`,
  );
  if (result.deleted === 0) {
    console.log("No duplicates found — table is already clean.");
  }
} finally {
  await sql.end();
}
