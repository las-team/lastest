import fs from 'fs';
import path from 'path';
import { db } from '@/lib/db';
import { repositories, testResults, testRuns, plannedScreenshots } from '@/lib/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { updateTeamStorageUsage, getTeamStorageUsage } from '@/lib/db/queries/storage';
import { STORAGE_ROOT } from './paths';

/**
 * Recursively calculate the total size in bytes of a directory.
 * Returns 0 if the directory doesn't exist.
 */
export function getDirSizeBytes(dirPath: string): number {
  try {
    const stat = fs.statSync(dirPath);
    if (!stat.isDirectory()) return stat.size;
  } catch {
    return 0;
  }

  let total = 0;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      total += getDirSizeBytes(fullPath);
    } else {
      try {
        total += fs.statSync(fullPath).size;
      } catch {
        // File may have been deleted between readdir and stat
      }
    }
  }

  return total;
}

/**
 * Get the size of a single file. Returns 0 if the file doesn't exist.
 */
function getFileSizeBytes(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

/**
 * Calculate total storage bytes used by a team across all their repositories.
 *
 * Repo-scoped directories (screenshots, baselines, fixtures, network-bodies) are
 * scanned directly by repo ID subdirectory. For file paths stored in DB columns
 * (videos, diffs, planned) that may not be repo-scoped, we query the DB and stat
 * each file individually.
 */
export async function calculateTeamStorageBytes(teamId: string): Promise<number> {
  const repos = await db
    .select({ id: repositories.id })
    .from(repositories)
    .where(eq(repositories.teamId, teamId));

  if (repos.length === 0) return 0;

  const repoIds = repos.map((r) => r.id);
  let totalBytes = 0;

  // 1. Repo-scoped directories — walk each repo's subdirectory
  const repoScopedDirs = ['screenshots', 'baselines', 'fixtures', 'network-bodies'];
  for (const dir of repoScopedDirs) {
    for (const repoId of repoIds) {
      totalBytes += getDirSizeBytes(path.join(STORAGE_ROOT, dir, repoId));
    }
  }

  // 2. DB-referenced file paths (videos, diffs) — query test results for team's repos
  const runs = await db
    .select({ id: testRuns.id })
    .from(testRuns)
    .where(inArray(testRuns.repositoryId, repoIds));

  if (runs.length > 0) {
    const runIds = runs.map((r) => r.id);

    // Process in batches to avoid huge IN clauses
    const BATCH_SIZE = 500;
    for (let i = 0; i < runIds.length; i += BATCH_SIZE) {
      const batch = runIds.slice(i, i + BATCH_SIZE);
      const results = await db
        .select({
          videoPath: testResults.videoPath,
          diffPath: testResults.diffPath,
        })
        .from(testResults)
        .where(inArray(testResults.testRunId, batch));

      for (const r of results) {
        if (r.videoPath) {
          totalBytes += getFileSizeBytes(path.join(STORAGE_ROOT, r.videoPath.replace(/^\//, '')));
        }
        if (r.diffPath) {
          totalBytes += getFileSizeBytes(path.join(STORAGE_ROOT, r.diffPath.replace(/^\//, '')));
        }
      }
    }
  }

  // 3. Planned screenshots — query by repo
  const planned = await db
    .select({ imagePath: plannedScreenshots.imagePath })
    .from(plannedScreenshots)
    .where(inArray(plannedScreenshots.repositoryId, repoIds));

  for (const p of planned) {
    if (p.imagePath) {
      totalBytes += getFileSizeBytes(path.join(STORAGE_ROOT, p.imagePath.replace(/^\//, '')));
    }
  }

  return totalBytes;
}

/**
 * Recalculate and persist the storage usage for a team.
 * Skips recalculation if last calculated less than 5 minutes ago (unless force=true).
 */
export async function recalculateTeamStorage(
  teamId: string,
  force = false
): Promise<{ usedBytes: number }> {
  if (!force) {
    const current = await getTeamStorageUsage(teamId);
    if (current?.storageLastCalculatedAt) {
      const age = Date.now() - current.storageLastCalculatedAt.getTime();
      if (age < 5 * 60 * 1000) {
        return { usedBytes: current.storageUsedBytes };
      }
    }
  }

  const usedBytes = await calculateTeamStorageBytes(teamId);
  await updateTeamStorageUsage(teamId, usedBytes);
  return { usedBytes };
}
