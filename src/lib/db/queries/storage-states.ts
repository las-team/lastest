import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { storageStates } from '@/lib/db/schema';

export async function getStorageStates(repositoryId: string | null) {
  if (!repositoryId) return [];
  return db.select().from(storageStates).where(eq(storageStates.repositoryId, repositoryId));
}

export async function getStorageState(id: string) {
  const rows = await db.select().from(storageStates).where(eq(storageStates.id, id));
  return rows[0] ?? null;
}

export async function createStorageState(data: {
  repositoryId: string | null;
  name: string;
  storageStateJson: string;
  // Provenance metadata — optional; null/undefined preserves prior behaviour.
  authFlavor?: string | null;
  tokenLocations?: string[] | null;
  firebaseApiKey?: string | null;
  expiresAt?: Date | null;
}) {
  let cookieCount = 0;
  let originCount = 0;
  // includesIndexedDB is derived from the captured blob rather than caller-supplied
  // so we can't be wrong about it. Playwright v1.51+ emits `indexedDB` per origin
  // when `{ indexedDB: true }` was passed at capture time.
  let includesIndexedDB = false;
  try {
    const parsed = JSON.parse(data.storageStateJson);
    cookieCount = Array.isArray(parsed.cookies) ? parsed.cookies.length : 0;
    originCount = Array.isArray(parsed.origins) ? parsed.origins.length : 0;
    if (Array.isArray(parsed.origins)) {
      includesIndexedDB = parsed.origins.some((o: unknown) => {
        if (!o || typeof o !== 'object') return false;
        const idb = (o as { indexedDB?: unknown }).indexedDB;
        return Array.isArray(idb) && idb.length > 0;
      });
    }
  } catch {}

  const rows = await db.insert(storageStates).values({
    repositoryId: data.repositoryId,
    name: data.name,
    storageStateJson: data.storageStateJson,
    cookieCount,
    originCount,
    includesIndexedDB,
    authFlavor: data.authFlavor ?? null,
    tokenLocations: data.tokenLocations ?? null,
    firebaseApiKey: data.firebaseApiKey ?? null,
    expiresAt: data.expiresAt ?? null,
  }).returning();
  return rows[0];
}

export async function deleteStorageState(id: string) {
  await db.delete(storageStates).where(eq(storageStates.id, id));
}
