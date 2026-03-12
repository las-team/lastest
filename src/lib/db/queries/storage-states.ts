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
}) {
  let cookieCount = 0;
  let originCount = 0;
  try {
    const parsed = JSON.parse(data.storageStateJson);
    cookieCount = Array.isArray(parsed.cookies) ? parsed.cookies.length : 0;
    originCount = Array.isArray(parsed.origins) ? parsed.origins.length : 0;
  } catch {}

  const id = crypto.randomUUID();
  await db.insert(storageStates).values({
    id,
    repositoryId: data.repositoryId,
    name: data.name,
    storageStateJson: data.storageStateJson,
    cookieCount,
    originCount,
  });
  return { id };
}

export async function deleteStorageState(id: string) {
  await db.delete(storageStates).where(eq(storageStates.id, id));
}
