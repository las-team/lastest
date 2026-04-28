'use server';

import { revalidatePath } from 'next/cache';
import path from 'path';
import fs from 'fs/promises';
import * as queries from '@/lib/db/queries';
import { requireRepoAccess } from '@/lib/auth';
import { STORAGE_DIRS } from '@/lib/storage/paths';
import { parseCsvBuffer } from '@/lib/csv/api';

const MAX_CSV_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_CACHED_ROWS = 1000;

const ALIAS_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

function validateAlias(alias: string): string | null {
  if (!alias) return 'Alias is required';
  if (alias.length > 64) return 'Alias too long (max 64 chars)';
  if (!ALIAS_PATTERN.test(alias)) {
    return 'Alias must start with a letter and contain only letters, digits, underscores, or hyphens';
  }
  return null;
}

async function ensureCsvDir(repositoryId: string) {
  const dir = path.join(STORAGE_DIRS['csv-sources'], repositoryId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function uploadCsvSource(
  repositoryId: string,
  alias: string,
  fileData: Uint8Array | Buffer,
  fileName: string,
) {
  const session = await requireRepoAccess(repositoryId);

  const fileBuffer = Buffer.isBuffer(fileData) ? fileData : Buffer.from(fileData);
  if (fileBuffer.length === 0) return { success: false, error: 'Empty file' };
  if (fileBuffer.length > MAX_CSV_SIZE) return { success: false, error: 'File exceeds 10MB limit' };

  const aliasError = validateAlias(alias);
  if (aliasError) return { success: false, error: aliasError };

  const existing = await queries.getCsvDataSourceByAlias(repositoryId, alias);
  if (existing) {
    return { success: false, error: `Alias "${alias}" already exists in this repo` };
  }

  let parsed;
  try {
    parsed = parseCsvBuffer(fileBuffer);
  } catch (e) {
    return { success: false, error: `Failed to parse CSV: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (parsed.headers.length === 0) {
    return { success: false, error: 'CSV has no header row' };
  }

  const dir = await ensureCsvDir(repositoryId);
  const safeName = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
  const stamped = `${Date.now()}_${safeName}`;
  const filePath = path.join(dir, stamped);
  await fs.writeFile(filePath, fileBuffer);
  const relativePath = `/csv-sources/${repositoryId}/${stamped}`;

  const cachedRows = parsed.rows.slice(0, MAX_CACHED_ROWS);

  const source = await queries.createCsvDataSource({
    repositoryId,
    teamId: session.team.id,
    alias,
    filename: safeName,
    storagePath: relativePath,
    cachedHeaders: parsed.headers,
    cachedData: cachedRows,
    rowCount: parsed.rowCount,
  });

  revalidatePath('/settings');
  revalidatePath('/tests');
  return { success: true, source };
}

export async function syncCsvSource(id: string, fileData?: Uint8Array | Buffer, fileName?: string) {
  const source = await queries.getCsvDataSource(id);
  if (!source) return { success: false, error: 'Not found' };
  if (!source.repositoryId) return { success: false, error: 'Source has no repository' };
  await requireRepoAccess(source.repositoryId);

  // Re-parse from disk if no new buffer passed
  let buf: Buffer;
  const incoming = fileData ? (Buffer.isBuffer(fileData) ? fileData : Buffer.from(fileData)) : null;
  if (incoming && incoming.length > 0) {
    if (incoming.length > MAX_CSV_SIZE) return { success: false, error: 'File exceeds 10MB limit' };
    buf = incoming;
  } else if (source.storagePath) {
    const abs = path.join(STORAGE_DIRS['csv-sources'], source.storagePath.replace(/^\/csv-sources\//, ''));
    try {
      buf = await fs.readFile(abs);
    } catch {
      return { success: false, error: 'Original file no longer on disk; re-upload required' };
    }
  } else {
    return { success: false, error: 'No buffer or stored file to sync from' };
  }

  let parsed;
  try {
    parsed = parseCsvBuffer(buf);
  } catch (e) {
    return { success: false, error: `Failed to parse CSV: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (parsed.headers.length === 0) {
    return { success: false, error: 'CSV has no header row' };
  }

  let storagePath = source.storagePath;
  let filename = source.filename;
  if (incoming && fileName) {
    const dir = await ensureCsvDir(source.repositoryId);
    const safeName = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
    const stamped = `${Date.now()}_${safeName}`;
    const filePath = path.join(dir, stamped);
    await fs.writeFile(filePath, incoming);
    storagePath = `/csv-sources/${source.repositoryId}/${stamped}`;
    filename = safeName;
  }

  await queries.updateCsvDataSource(id, {
    cachedHeaders: parsed.headers,
    cachedData: parsed.rows.slice(0, MAX_CACHED_ROWS),
    rowCount: parsed.rowCount,
    lastSyncedAt: new Date(),
    storagePath,
    filename,
  });

  revalidatePath('/settings');
  revalidatePath('/tests');
  return { success: true };
}

export async function deleteCsvSource(id: string) {
  const source = await queries.getCsvDataSource(id);
  if (!source) return { success: true };
  if (source.repositoryId) await requireRepoAccess(source.repositoryId);

  if (source.storagePath) {
    try {
      const abs = path.join(STORAGE_DIRS['csv-sources'], source.storagePath.replace(/^\/csv-sources\//, ''));
      await fs.unlink(abs);
    } catch {
      // best-effort
    }
  }
  await queries.deleteCsvDataSource(id);

  revalidatePath('/settings');
  revalidatePath('/tests');
  return { success: true };
}

export async function updateCsvSourceAlias(id: string, alias: string) {
  const source = await queries.getCsvDataSource(id);
  if (!source) return { success: false, error: 'Not found' };
  if (!source.repositoryId) return { success: false, error: 'Source has no repository' };
  await requireRepoAccess(source.repositoryId);

  const aliasError = validateAlias(alias);
  if (aliasError) return { success: false, error: aliasError };

  if (alias !== source.alias) {
    const conflict = await queries.getCsvDataSourceByAlias(source.repositoryId, alias);
    if (conflict) return { success: false, error: `Alias "${alias}" already exists` };
  }

  await queries.updateCsvDataSource(id, { alias });
  revalidatePath('/settings');
  revalidatePath('/tests');
  return { success: true };
}

export async function listCsvSources(repositoryId: string) {
  await requireRepoAccess(repositoryId);
  return queries.getCsvDataSources(repositoryId);
}
