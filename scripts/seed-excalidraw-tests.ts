/**
 * CLI: seed the dexilion-team/excalidraw repo with sample tests.
 *
 * Run: pnpm tsx scripts/seed-excalidraw-tests.ts
 *
 * Force re-seed (wipe existing tests/areas first):
 *   pnpm tsx scripts/seed-excalidraw-tests.ts --force
 *
 * The repo data + seeder live in `src/lib/demo/excalidraw-seed.ts` so the
 * demo bootstrap (`src/lib/auth/demo.ts`) can reuse them.
 */
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { repositories } from '@/lib/db/schema';
import {
  EXCALIDRAW_REPO_FULL_NAME,
  seedExcalidrawTests,
} from '@/lib/demo/excalidraw-seed';

async function main() {
  console.log(`Looking up repo ${EXCALIDRAW_REPO_FULL_NAME}...`);
  const [repo] = await db
    .select()
    .from(repositories)
    .where(eq(repositories.fullName, EXCALIDRAW_REPO_FULL_NAME));
  if (!repo) {
    console.error(`Repository ${EXCALIDRAW_REPO_FULL_NAME} not found. Create it first or sign in as demo to bootstrap it.`);
    process.exit(1);
  }

  const force = process.argv.includes('--force');
  const inserted = await seedExcalidrawTests(repo.id, {
    force,
    log: (m) => console.log(m),
  });
  console.log(`Done. ${inserted} tests inserted.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
