/**
 * URL-Diff artefact janitor.
 *
 * Walks `storage/url-diffs/` and deletes any subdirectory whose mtime is
 * older than `maxAgeMs`. Conservatively never touches dirs younger than
 * `MIN_AGE_MS` (5 min) so concurrent in-flight captures aren't deleted.
 */

import path from 'node:path';
import { promises as fs } from 'node:fs';

import { STORAGE_DIRS } from '@/lib/storage/paths';

const MIN_AGE_MS = 5 * 60 * 1000;

export async function cleanupExpiredUrlDiffs(maxAgeMs = 60 * 60 * 1000): Promise<{ deleted: number }> {
  const root = STORAGE_DIRS['url-diffs'];
  let entries: string[] = [];
  try {
    entries = await fs.readdir(root);
  } catch {
    return { deleted: 0 };
  }
  const now = Date.now();
  let deleted = 0;
  for (const name of entries) {
    const dir = path.join(root, name);
    let stat;
    try {
      stat = await fs.stat(dir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    const ageMs = now - stat.mtimeMs;
    if (ageMs < MIN_AGE_MS) continue;
    if (ageMs < maxAgeMs) continue;
    try {
      await fs.rm(dir, { recursive: true, force: true });
      deleted++;
    } catch (err) {
      console.warn(`[url-diff] Failed to remove ${dir}:`, err);
    }
  }
  return { deleted };
}
