import { readdir, stat } from "fs/promises";
import path from "path";

const VIDEO_ROOT = path.join(process.cwd(), "storage", "videos");

/**
 * Fallback video discovery: executor.ts writes webms to
 *   storage/videos/<repositoryId>/<sessionId>-<testId>.webm
 * but sometimes doesn't persist `test_results.video_path`. When the DB
 * column is null, this scans the repo's video dir (preferring the newest
 * match) and returns the public `/videos/...` URL — rewritten to
 * /api/media/videos/... by next.config, already public behind proxy.ts.
 * Returns null on any error (missing dir, no match).
 */
/**
 * Exact-file variant of `resolveTestVideoUrl` for a specific result row: the
 * EB names recordings `<testRunId>-<testId>.webm`, so when a row's
 * `video_path` is null (historical best-effort save) we can still check
 * whether that run's file made it to disk. One stat, no directory scan.
 */
export async function resolveResultVideoUrl(
  repositoryId: string | null | undefined,
  testRunId: string | null | undefined,
  testId: string | null | undefined,
): Promise<string | null> {
  if (!repositoryId || !testRunId || !testId) return null;
  const name = `${testRunId}-${testId}.webm`;
  try {
    await stat(path.join(VIDEO_ROOT, repositoryId, name));
  } catch {
    return null;
  }
  return `/videos/${repositoryId}/${name}`;
}

export async function resolveTestVideoUrl(
  repositoryId: string | null | undefined,
  testId: string | null | undefined,
): Promise<string | null> {
  if (!repositoryId || !testId) return null;
  const dir = path.join(VIDEO_ROOT, repositoryId);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return null;
  }
  const suffix = `-${testId}.webm`;
  const candidates = entries.filter((e) => e.endsWith(suffix));
  if (candidates.length === 0) return null;

  // Pick the newest — multiple retries produce multiple webms for the same
  // test, and the latest is the one the user most likely expects.
  let newest: { name: string; mtime: number } | null = null;
  for (const name of candidates) {
    try {
      const s = await stat(path.join(dir, name));
      const mtime = s.mtimeMs;
      if (!newest || mtime > newest.mtime) newest = { name, mtime };
    } catch {
      /* skip */
    }
  }
  const match = newest?.name ?? candidates[0];
  return `/videos/${repositoryId}/${match}`;
}
