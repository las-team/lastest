import fs from 'fs';
import path from 'path';
import { getTeamStorageUsage, getOldestTestRunsForTeam, deleteTestRunAndResults } from '@/lib/db/queries/storage';
import { recalculateTeamStorage } from './calculator';
import { STORAGE_ROOT } from './paths';

// Storage subdirectories that are partitioned by repository id. Everything
// under `storage/<dir>/<repoId>/...` is owned by that repo and can be torn
// down when the repo is deleted. Job-scoped dirs (bug-reports, url-diffs)
// are intentionally excluded — those carry job ids, not repo ids.
const REPO_SCOPED_STORAGE_DIRS = [
  'screenshots',
  'diffs',
  'baselines',
  'traces',
  'videos',
  'planned',
  'fixtures',
  'network-bodies',
  'csv-sources',
] as const;

/**
 * Best-effort removal of every repo-scoped storage directory for `repoId`.
 * Missing directories are a no-op; any unexpected error is logged and
 * swallowed so callers (typically `deleteRepository`) can finish the DB
 * deletion even if the disk is in a weird state.
 */
export async function deleteRepoStorage(repoId: string): Promise<void> {
  for (const dir of REPO_SCOPED_STORAGE_DIRS) {
    const target = path.join(STORAGE_ROOT, dir, repoId);
    try {
      await fs.promises.rm(target, { recursive: true, force: true });
    } catch (err) {
      console.warn(`[deleteRepoStorage] failed to remove ${target}:`, err);
    }
  }
}

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
