/**
 * One-shot backfill for `public_shares.kind` (added in §0 of the share
 * presentation fixes).
 *
 * A share is a "demo" (outreach QuickStart walkthrough) rather than a
 * "regression" share iff its repository has any `build_demo_notes` row —
 * QuickStart writes demo notes for every demo run (on the pre-rerun build), and
 * the ordinary operator/regression flow never does. The column defaults to
 * "regression" at the schema level, so this only needs to flip the demo shares.
 *
 * Idempotent: re-running is a no-op (already-demo rows stay demo). Safe to run
 * after `pnpm db:push` has added the column.
 *
 * Usage (DATABASE_URL must be set in env):
 *   pnpm tsx --env-file=.env.local scripts/backfill-share-kind.ts
 *   pnpm tsx --env-file=.env.local scripts/backfill-share-kind.ts --dry-run
 */
import { sql } from "../src/lib/db";

const dryRun = process.argv.includes("--dry-run");

async function main() {
  // Preview which shares would flip, for the operator's sanity.
  const candidates = await sql<
    { id: string; slug: string; kind: string; repository_id: string | null }[]
  >`
    SELECT ps.id, ps.slug, ps.kind, ps.repository_id
    FROM public_shares ps
    WHERE ps.kind <> 'demo'
      AND EXISTS (
        SELECT 1
        FROM build_demo_notes bdn
        JOIN builds b ON b.id = bdn.build_id
        JOIN test_runs tr ON tr.id = b.test_run_id
        WHERE tr.repository_id = ps.repository_id
      )
  `;

  console.log(
    `[backfill-share-kind] ${candidates.length} share(s) will flip regression -> demo`,
  );
  for (const c of candidates) {
    console.log(`  ${c.slug}  (repo ${c.repository_id ?? "?"})`);
  }

  if (dryRun) {
    console.log("[backfill-share-kind] --dry-run: no writes performed");
    return;
  }

  const updated = await sql`
    UPDATE public_shares ps
    SET kind = 'demo'
    WHERE ps.kind <> 'demo'
      AND EXISTS (
        SELECT 1
        FROM build_demo_notes bdn
        JOIN builds b ON b.id = bdn.build_id
        JOIN test_runs tr ON tr.id = b.test_run_id
        WHERE tr.repository_id = ps.repository_id
      )
  `;
  console.log(`[backfill-share-kind] updated ${updated.count} row(s)`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[backfill-share-kind] failed:", err);
    process.exit(1);
  });
