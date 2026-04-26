import { db } from '../index';
import { csvDataSources } from '../schema';
import type { NewCsvDataSource } from '../schema';
import { and, eq } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

export async function getCsvDataSources(repositoryId?: string | null) {
  if (!repositoryId) return [];
  return db.select().from(csvDataSources).where(eq(csvDataSources.repositoryId, repositoryId));
}

export async function getCsvDataSource(id: string) {
  const [row] = await db.select().from(csvDataSources).where(eq(csvDataSources.id, id));
  return row || null;
}

export async function getCsvDataSourceByAlias(repositoryId: string, alias: string) {
  const [row] = await db
    .select()
    .from(csvDataSources)
    .where(and(eq(csvDataSources.repositoryId, repositoryId), eq(csvDataSources.alias, alias)));
  return row || null;
}

export async function createCsvDataSource(data: {
  repositoryId: string;
  teamId: string;
  alias: string;
  filename: string;
  storagePath?: string | null;
  cachedHeaders: string[];
  cachedData: string[][];
  rowCount: number;
}) {
  const id = uuid();
  const now = new Date();
  const newSource: NewCsvDataSource = {
    id,
    repositoryId: data.repositoryId,
    teamId: data.teamId,
    alias: data.alias,
    filename: data.filename,
    storagePath: data.storagePath ?? null,
    cachedHeaders: data.cachedHeaders,
    cachedData: data.cachedData,
    rowCount: data.rowCount,
    lastSyncedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(csvDataSources).values(newSource);
  return newSource;
}

export async function updateCsvDataSource(
  id: string,
  data: Partial<{
    alias: string;
    filename: string;
    storagePath: string | null;
    cachedHeaders: string[];
    cachedData: string[][];
    rowCount: number;
    lastSyncedAt: Date;
  }>,
) {
  await db
    .update(csvDataSources)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(csvDataSources.id, id));
}

export async function deleteCsvDataSource(id: string) {
  await db.delete(csvDataSources).where(eq(csvDataSources.id, id));
}
