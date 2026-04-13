import fs from 'fs';
import path from 'path';
import { getTeamStorageUsage, getOldestTestRunsForTeam, deleteTestRunAndResults } from '@/lib/db/queries/storage';
import { recalculateTeamStorage } from './calculator';
import { STORAGE_ROOT } from './paths';

/**
 * Clean up oldest test run data for a team until storage drops below the target.
 * Deletes test runs (oldest first), their results, visual diffs, and associated files.
 * Never deletes standalone baselines or planned screenshots.
 */
export async function cleanupTeamStorage(
  teamId: string,
  targetBytes?: number
): Promise<{ deletedRuns: number; freedBytes: number }> {
  const usage = await getTeamStorageUsage(teamId);
  if (!usage) return { deletedRuns: 0, freedBytes: 0 };

  const target = targetBytes ?? Math.floor(usage.storageQuotaBytes * 0.9);
  const startingBytes = usage.storageUsedBytes;

  if (startingBytes <= target) {
    return { deletedRuns: 0, freedBytes: 0 };
  }

  let deletedRuns = 0;

  // Loop: delete oldest runs in batches until under target
  while (true) {
    const oldestRuns = await getOldestTestRunsForTeam(teamId, 10);
    if (oldestRuns.length === 0) break;

    for (const run of oldestRuns) {
      const filePaths = await deleteTestRunAndResults(run.id);

      // Delete files from disk
      for (const filePath of filePaths) {
        try {
          const absPath = path.join(STORAGE_ROOT, filePath.replace(/^\//, ''));
          fs.unlinkSync(absPath);
        } catch {
          // File already deleted or doesn't exist — ignore
        }
      }

      deletedRuns++;
    }

    // Recalculate and check if we're under target
    const { usedBytes } = await recalculateTeamStorage(teamId, true);
    if (usedBytes <= target) break;
  }

  const { usedBytes: finalBytes } = await recalculateTeamStorage(teamId, true);
  const freedBytes = Math.max(0, startingBytes - finalBytes);

  return { deletedRuns, freedBytes };
}
