import { mkdir, link, rm, stat } from 'fs/promises';
import path from 'path';
import { resolveStoragePath } from '@/lib/storage/paths';
import { isValidShareSlug } from '@/lib/share/slug';

const SHARE_ROOT = path.join(process.cwd(), 'public', 'share');

// Hard links, not symlinks. Symlinks pointing into storage/ cause Next 16's
// chokidar-based watcher (followSymlinks: true) to traverse storage/'s
// ~26k files, which tips SWC over into a napi_create_string_utf8 OOM.
// Hard links are just another directory entry for the same inode — the
// watcher sees a plain .png and there is nothing to traverse into.
export async function ensureShareSymlinks(
  slug: string,
  allowedPaths: Iterable<string>,
): Promise<void> {
  if (!isValidShareSlug(slug)) return;
  const base = path.join(SHARE_ROOT, slug);

  for (const raw of allowedPaths) {
    if (!raw) continue;
    const source = resolveStoragePath(raw);
    if (!source) continue;

    const rel = raw.replace(/^\/+/, '');
    const target = path.join(base, rel);

    await mkdir(path.dirname(target), { recursive: true });
    try {
      await link(source, target);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') continue;
      if (code === 'ENOENT') continue; // source file missing — skip silently
      throw err;
    }
  }
}

export async function removeShareSymlinks(slug: string): Promise<void> {
  if (!isValidShareSlug(slug)) return;
  await rm(path.join(SHARE_ROOT, slug), { recursive: true, force: true });
}

// Exposed for tests / debugging.
export async function shareMediaExists(slug: string): Promise<boolean> {
  if (!isValidShareSlug(slug)) return false;
  try {
    const s = await stat(path.join(SHARE_ROOT, slug));
    return s.isDirectory();
  } catch {
    return false;
  }
}
