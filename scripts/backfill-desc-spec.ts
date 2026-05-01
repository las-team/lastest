/**
 * One-shot backfill: drains the legacy `tests.description` and
 * `functional_areas.description` columns into the new canonical homes
 * (`test_specs.spec` and `functional_areas.agent_plan`).
 *
 * Run **once, before** `pnpm db:push` drops the columns. Idempotent — re-runs
 * are no-ops because writers stop emitting once the columns vanish.
 *
 * Usage (DATABASE_URL must be set in env):
 *   pnpm tsx --env-file=.env.local scripts/backfill-desc-spec.ts
 *   pnpm tsx --env-file=.env.local scripts/backfill-desc-spec.ts --dry-run
 */
import { sql } from '../src/lib/db';
import { createHash } from 'node:crypto';

const dryRun = process.argv.includes('--dry-run');

interface AreaRow {
  id: string;
  description: string | null;
  agent_plan: string | null;
}

interface TestRow {
  id: string;
  repository_id: string | null;
  functional_area_id: string | null;
  name: string;
  code: string;
  description: string | null;
  spec_id: string | null;
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ${table}
        AND column_name = ${column}
    ) AS exists
  `;
  return rows[0]?.exists ?? false;
}

async function backfillAreas() {
  if (!(await columnExists('functional_areas', 'description'))) {
    console.log('[areas] description column already gone — skipping');
    return { migrated: 0, appended: 0, skipped: 0 };
  }

  const rows = (await sql`
    SELECT id, description, agent_plan
    FROM functional_areas
    WHERE description IS NOT NULL AND length(trim(description)) > 0
  `) as unknown as AreaRow[];

  let migrated = 0;
  let appended = 0;
  let skipped = 0;

  for (const row of rows) {
    const desc = row.description!.trim();
    if (!row.agent_plan || row.agent_plan.trim() === '') {
      if (!dryRun) {
        await sql`
          UPDATE functional_areas
          SET agent_plan = ${desc},
              plan_generated_at = COALESCE(plan_generated_at, now())
          WHERE id = ${row.id}
        `;
      }
      migrated++;
    } else if (row.agent_plan.includes(desc)) {
      skipped++;
    } else {
      const merged = `${row.agent_plan}\n\n## Notes\n\n${desc}`;
      if (!dryRun) {
        await sql`
          UPDATE functional_areas
          SET agent_plan = ${merged}
          WHERE id = ${row.id}
        `;
      }
      appended++;
    }
  }

  return { migrated, appended, skipped };
}

async function backfillTests() {
  if (!(await columnExists('tests', 'description'))) {
    console.log('[tests] description column already gone — skipping');
    return { specsCreated: 0, conflicts: 0, skipped: 0 };
  }

  const rows = (await sql`
    SELECT id, repository_id, functional_area_id, name, code, description, spec_id
    FROM tests
    WHERE description IS NOT NULL
      AND length(trim(description)) > 0
      AND deleted_at IS NULL
  `) as unknown as TestRow[];

  let specsCreated = 0;
  let conflicts = 0;
  let skipped = 0;

  for (const row of rows) {
    const existingSpec = (await sql`
      SELECT id, spec FROM test_specs WHERE test_id = ${row.id} LIMIT 1
    `) as unknown as { id: string; spec: string }[];

    if (existingSpec.length > 0) {
      const oldDesc = row.description!.trim();
      if (!existingSpec[0].spec.includes(oldDesc)) {
        conflicts++;
        console.warn(`[tests] conflict on ${row.id} ("${row.name}"): existing spec lacks the legacy description content. Skipping; merge manually if needed.`);
      } else {
        skipped++;
      }
      continue;
    }

    const codeHash = createHash('sha256').update(row.code).digest('hex');
    if (!dryRun) {
      const inserted = (await sql`
        INSERT INTO test_specs (id, repository_id, test_id, functional_area_id, title, spec, source, status, code_hash, created_at, updated_at)
        VALUES (gen_random_uuid()::text, ${row.repository_id}, ${row.id}, ${row.functional_area_id}, ${row.name}, ${row.description!.trim()}, 'manual', 'has_test', ${codeHash}, now(), now())
        RETURNING id
      `) as unknown as { id: string }[];
      const newSpecId = inserted[0]?.id;
      if (newSpecId && !row.spec_id) {
        await sql`UPDATE tests SET spec_id = ${newSpecId} WHERE id = ${row.id}`;
      }
    }
    specsCreated++;
  }

  return { specsCreated, conflicts, skipped };
}

async function main() {
  console.log(dryRun ? 'DRY RUN — no writes will be made' : 'APPLYING backfill');
  console.log('---');

  const areaResult = await backfillAreas();
  console.log(`[areas] migrated=${areaResult.migrated} appended=${areaResult.appended} skipped=${areaResult.skipped}`);

  const testResult = await backfillTests();
  console.log(`[tests] specs_created=${testResult.specsCreated} conflicts=${testResult.conflicts} skipped=${testResult.skipped}`);

  if (testResult.conflicts > 0) {
    console.log('---');
    console.log('Conflicts found. Review manually before dropping the columns.');
  }

  console.log('---');
  console.log(dryRun ? 'Done (dry-run).' : 'Done. Now run pnpm db:push to drop the legacy columns.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => sql.end());
