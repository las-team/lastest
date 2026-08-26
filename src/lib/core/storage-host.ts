import "server-only";

import fs from "node:fs/promises";
import path from "node:path";

import type { HostBlobRef, StorageHost } from "@lastest/core-storage";

import { STORAGE_ROOT } from "@/lib/storage/paths";
import {
  DEFAULT_STORAGE_QUOTA_BYTES,
  getTeamStorageUsage,
} from "@/lib/db/queries";
import { signStorageGrant } from "@/lib/core/storage-grant";

/**
 * The app's fill for `StorageHost`.
 *
 * Local filesystem under `storage/plugin-data/<namespaced key>` — the key
 * arrives already namespaced by `(teamId, pluginId)`, so the directory layout
 * itself is the isolation, the same principle `deleteRepoStorage` already
 * relies on for repo-scoped directories.
 *
 * **Deliberately independent of `teams.storageUsedBytes`.** That counter is
 * recalculated by `recalculateTeamStorage` over the *existing* feature
 * directories (screenshots, diffs, baselines, …) and knows nothing about
 * plugin blobs — folding plugin usage into it would mean the next
 * recalculation silently erases it. `usedBytes` instead sums this directory
 * tree directly, on demand. `storageQuotaBytes` (the ceiling) is read from the
 * same team row: one number, borrowed as the limit, not touched as an
 * accumulator.
 *
 * **TTL is enforced lazily, not by a reaper.** An expired blob is treated as
 * absent by `get`/`head`/`list` and best-effort deleted the next time
 * something looks at it. Acceptable for a capability with no consumer yet;
 * worth a real sweep job once one exists and TTLs are actually used.
 */

const PLUGIN_STORAGE_ROOT = path.join(STORAGE_ROOT, "plugin-data");

interface BlobMeta {
  readonly contentType: string;
  readonly createdAt: string;
  readonly ttlSeconds?: number;
}

function physicalPath(key: string): string {
  return path.join(PLUGIN_STORAGE_ROOT, key);
}

function metaPath(key: string): string {
  return `${physicalPath(key)}.meta.json`;
}

async function readMeta(key: string): Promise<BlobMeta | null> {
  try {
    const raw = await fs.readFile(metaPath(key), "utf8");
    return JSON.parse(raw) as BlobMeta;
  } catch {
    return null;
  }
}

function isExpired(meta: BlobMeta): boolean {
  if (!meta.ttlSeconds) return false;
  const createdAt = new Date(meta.createdAt).getTime();
  return Date.now() > createdAt + meta.ttlSeconds * 1000;
}

async function removeBlob(key: string): Promise<void> {
  await fs.rm(physicalPath(key), { force: true });
  await fs.rm(metaPath(key), { force: true });
}

async function blobRefFor(key: string): Promise<HostBlobRef | null> {
  const meta = await readMeta(key);
  if (!meta) return null;
  if (isExpired(meta)) {
    await removeBlob(key);
    return null;
  }
  try {
    const stat = await fs.stat(physicalPath(key));
    return {
      key,
      bytes: stat.size,
      contentType: meta.contentType,
      createdAt: new Date(meta.createdAt),
    };
  } catch {
    return null;
  }
}

/** Recursively list every non-meta file under `dir`, as keys relative to `PLUGIN_STORAGE_ROOT`. */
async function walkKeys(dir: string): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const keys: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      keys.push(...(await walkKeys(full)));
    } else if (!entry.name.endsWith(".meta.json")) {
      keys.push(path.relative(PLUGIN_STORAGE_ROOT, full));
    }
  }
  return keys;
}

/** Every live (non-expired) blob ref under `prefix`. Shared by `list` and `usedBytes`. */
async function listRefs(prefix: string): Promise<HostBlobRef[]> {
  const dir = path.join(PLUGIN_STORAGE_ROOT, prefix);
  const keys = await walkKeys(dir);
  const refs = await Promise.all(keys.map((k) => blobRefFor(k)));
  return refs.filter((r): r is HostBlobRef => r !== null);
}

export const appStorageHost: StorageHost = {
  async put(key, data, opts) {
    const target = physicalPath(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, data);
    const meta: BlobMeta = {
      contentType: opts.contentType ?? "application/octet-stream",
      createdAt: new Date().toISOString(),
      ttlSeconds: opts.ttlSeconds,
    };
    await fs.writeFile(metaPath(key), JSON.stringify(meta));
    const ref = await blobRefFor(key);
    // `blobRefFor` can only return null here if the write above failed
    // silently, which `fs.writeFile` does not do — it throws instead.
    if (!ref) throw new Error(`Failed to write storage blob "${key}"`);
    return ref;
  },

  async get(key) {
    const meta = await readMeta(key);
    if (!meta || isExpired(meta)) {
      if (meta) await removeBlob(key);
      return null;
    }
    try {
      return new Uint8Array(await fs.readFile(physicalPath(key)));
    } catch {
      return null;
    }
  },

  head(key) {
    return blobRefFor(key);
  },

  async list(prefix) {
    return listRefs(prefix);
  },

  async delete(key) {
    await removeBlob(key);
  },

  async usedBytes(prefix) {
    const refs = await listRefs(prefix);
    return refs.reduce((sum, r) => sum + r.bytes, 0);
  },

  async quotaLimitBytes(teamId) {
    const usage = await getTeamStorageUsage(teamId);
    return usage?.storageQuotaBytes ?? DEFAULT_STORAGE_QUOTA_BYTES;
  },

  async signedUrl(key, opts) {
    const grant = signStorageGrant(key, opts);
    if (!grant) return null;
    // No `NextRequest` is available here — `signedUrl()` may be called from a
    // background job with no request in flight — so this mirrors
    // `src/lib/email/index.ts`'s fallback rather than `getPublicUrl()`, which
    // needs one.
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    return `${appUrl}/api/plugin-storage?grant=${encodeURIComponent(grant)}`;
  },
};
