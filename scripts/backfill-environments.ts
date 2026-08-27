/**
 * One-shot backfill for the environment model (gap analysis B2).
 *
 * Gives every repository one `prod` environment, seeded from its existing
 * `environment_configs.baseUrl`, marked default.
 *
 * Why bother, when every scoping column is nullable and an environment-less
 * repo runs exactly as before? Because the interesting operation is the SECOND
 * environment. A consultant adding UAT to a repo that has no PROD row has
 * nowhere to promote baselines from and no way to say what the existing
 * approvals describe. Seeding the first one makes "add UAT" a one-step action
 * instead of a two-step one, and it is the step people forget.
 *
 * What it deliberately does NOT do: stamp `environmentKey` onto existing
 * baselines. Those approvals were made before environments existed and belong
 * to no environment in particular — leaving them NULL is what makes them
 * visible from every environment through the fallback chain. Claiming them for
 * `prod` would hide them from a UAT run that currently, correctly, uses them.
 * Use Settings → Environments → Promote when you actually want them claimed.
 *
 * Idempotent: a repo that already has any environment is skipped.
 *
 * Usage (DATABASE_URL must be set in env):
 *   pnpm tsx --env-file=.env.local scripts/backfill-environments.ts
 *   pnpm tsx --env-file=.env.local scripts/backfill-environments.ts --dry-run
 */
import { randomUUID } from "crypto";
import { sql } from "../src/lib/db";

const dryRun = process.argv.includes("--dry-run");

async function main() {
  const candidates = await sql<
    { id: string; name: string; base_url: string | null }[]
  >`
    SELECT r.id, r.name, ec.base_url
    FROM repositories r
    LEFT JOIN environment_configs ec ON ec.repository_id = r.id
    WHERE NOT EXISTS (SELECT 1 FROM environments e WHERE e.repository_id = r.id)
  `;

  console.log(
    `[backfill-environments] ${candidates.length} repo(s) without an environment`,
  );
  for (const r of candidates) {
    console.log(`  ${r.name} (${r.id}) → prod @ ${r.base_url ?? "(no url)"}`);
  }
  if (dryRun) {
    console.log("[backfill-environments] --dry-run: no writes performed");
    return;
  }

  let created = 0;
  for (const r of candidates) {
    await sql`
      INSERT INTO environments
        (id, repository_id, key, label, base_url, is_default, sort_order,
         created_at, updated_at)
      VALUES
        (${randomUUID()}, ${r.id}, 'prod', 'Production', ${r.base_url},
         true, 0, now(), now())
      ON CONFLICT DO NOTHING
    `;
    created += 1;
  }
  console.log(`[backfill-environments] created ${created} environment(s)`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[backfill-environments] failed:", err);
    process.exit(1);
  });
