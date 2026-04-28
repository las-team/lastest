import path from 'path';

/**
 * Centralized storage paths — all media files live under `storage/` (outside `public/`).
 * Served to clients via the authenticated `/api/media/[...path]` route.
 */

export const STORAGE_ROOT = path.join(process.cwd(), 'storage');

export const STORAGE_DIRS = {
  screenshots: path.join(STORAGE_ROOT, 'screenshots'),
  diffs: path.join(STORAGE_ROOT, 'diffs'),
  baselines: path.join(STORAGE_ROOT, 'baselines'),
  traces: path.join(STORAGE_ROOT, 'traces'),
  videos: path.join(STORAGE_ROOT, 'videos'),
  planned: path.join(STORAGE_ROOT, 'planned'),
  'bug-reports': path.join(STORAGE_ROOT, 'bug-reports'),
  fixtures: path.join(STORAGE_ROOT, 'fixtures'),
  'network-bodies': path.join(STORAGE_ROOT, 'network-bodies'),
  'csv-sources': path.join(STORAGE_ROOT, 'csv-sources'),
} as const;

/** Subdirectory names allowed by the media API route. */
export const ALLOWED_STORAGE_SUBDIRS = new Set(Object.keys(STORAGE_DIRS));

/**
 * Map a URL-style path (e.g. `/screenshots/repo/file.png`) to an absolute filesystem path
 * under the storage root.
 *
 * Returns `null` if the path attempts traversal or targets a disallowed subdirectory.
 */
export function resolveStoragePath(urlPath: string): string | null {
  // Strip leading slash
  const cleaned = urlPath.replace(/^\/+/, '');

  // Block traversal
  if (cleaned.includes('..')) return null;

  const firstSlash = cleaned.indexOf('/');
  const subdir = firstSlash === -1 ? cleaned : cleaned.slice(0, firstSlash);

  if (!ALLOWED_STORAGE_SUBDIRS.has(subdir)) return null;

  return path.join(STORAGE_ROOT, cleaned);
}

/**
 * Convert an absolute storage path back to a URL-relative path.
 * e.g. `/home/user/project/storage/diffs/abc.png` → `/diffs/abc.png`
 */
export function toRelativePath(absPath: string): string {
  return '/' + path.relative(STORAGE_ROOT, absPath).split(path.sep).join('/');
}
