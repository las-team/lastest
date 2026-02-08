#!/usr/bin/env tsx

/**
 * Cleanup orphaned setup references
 * Run with: pnpm tsx scripts/cleanup-setup.ts
 */

import { cleanupOrphanedSetupReferences } from '@/lib/db/queries';

async function main() {
  console.log('🧹 Cleaning up orphaned setup references...');

  const result = await cleanupOrphanedSetupReferences();

  console.log(`✅ Cleanup complete! Cleared ${result.cleanedCount} orphaned references.`);

  if (result.cleanedCount === 0) {
    console.log('👍 No orphaned references found - database is clean!');
  }
}

main().catch((error) => {
  console.error('❌ Cleanup failed:', error);
  process.exit(1);
});
