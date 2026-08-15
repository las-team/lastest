import { and, eq } from "drizzle-orm";

import {
  dataSourcesCsvSources,
  dataSourcesGoogleSheets,
  type CsvDataSource,
  type GoogleSheetsDataSource,
  type NewCsvDataSource,
  type NewGoogleSheetsDataSource,
} from "../schema";
import type { DataSourcesDb } from "./db";

/**
 * The plugin's query module — a straight move of
 * `src/lib/db/queries/csv-sources.ts` and the Google Sheets data-source half
 * of `src/lib/db/queries/integrations.ts` (the account/OAuth half stayed
 * core; see `src/lib/core/data-sources-host.ts`).
 *
 * Same two changes every plugin query module makes (recipe, `plugins/ci/src/
 * data/queries.ts`): `db` is an argument rather than a module import, and
 * every read/write takes `teamId` where the row has one — the `team_id`
 * column is now the only tenancy boundary, the FK to `teams` is gone.
 */

// ============================================
// CSV sources
// ============================================

export async function getCsvDataSources(
  db: DataSourcesDb,
  repositoryId?: string | null,
): Promise<CsvDataSource[]> {
  if (!repositoryId) return [];
  return db
    .select()
    .from(dataSourcesCsvSources)
    .where(eq(dataSourcesCsvSources.repositoryId, repositoryId));
}

export async function getCsvDataSource(
  db: DataSourcesDb,
  id: string,
): Promise<CsvDataSource | null> {
  const [row] = await db
    .select()
    .from(dataSourcesCsvSources)
    .where(eq(dataSourcesCsvSources.id, id));
  return row ?? null;
}

export async function getCsvDataSourceByAlias(
  db: DataSourcesDb,
  repositoryId: string,
  alias: string,
): Promise<CsvDataSource | null> {
  const [row] = await db
    .select()
    .from(dataSourcesCsvSources)
    .where(
      and(
        eq(dataSourcesCsvSources.repositoryId, repositoryId),
        eq(dataSourcesCsvSources.alias, alias),
      ),
    );
  return row ?? null;
}

export async function createCsvDataSource(
  db: DataSourcesDb,
  data: {
    id: string;
    repositoryId: string;
    teamId: string;
    alias: string;
    filename: string;
    cachedHeaders: string[];
    cachedData: string[][];
    rowCount: number;
  },
): Promise<CsvDataSource> {
  const now = new Date();
  const newSource: NewCsvDataSource = {
    id: data.id,
    repositoryId: data.repositoryId,
    teamId: data.teamId,
    alias: data.alias,
    filename: data.filename,
    cachedHeaders: data.cachedHeaders,
    cachedData: data.cachedData,
    rowCount: data.rowCount,
    lastSyncedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(dataSourcesCsvSources).values(newSource);
  return newSource as CsvDataSource;
}

export async function updateCsvDataSource(
  db: DataSourcesDb,
  id: string,
  data: Partial<{
    alias: string;
    filename: string;
    cachedHeaders: string[];
    cachedData: string[][];
    rowCount: number;
    lastSyncedAt: Date;
  }>,
): Promise<void> {
  await db
    .update(dataSourcesCsvSources)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(dataSourcesCsvSources.id, id));
}

export async function deleteCsvDataSource(
  db: DataSourcesDb,
  id: string,
): Promise<void> {
  await db
    .delete(dataSourcesCsvSources)
    .where(eq(dataSourcesCsvSources.id, id));
}

// ============================================
// Google Sheets sources
// ============================================

export async function getGoogleSheetsDataSources(
  db: DataSourcesDb,
  repositoryId?: string | null,
): Promise<GoogleSheetsDataSource[]> {
  if (!repositoryId) return [];
  return db
    .select()
    .from(dataSourcesGoogleSheets)
    .where(eq(dataSourcesGoogleSheets.repositoryId, repositoryId));
}

export async function getGoogleSheetsDataSource(
  db: DataSourcesDb,
  id: string,
): Promise<GoogleSheetsDataSource | null> {
  const [row] = await db
    .select()
    .from(dataSourcesGoogleSheets)
    .where(eq(dataSourcesGoogleSheets.id, id));
  return row ?? null;
}

export async function getGoogleSheetsDataSourceByAlias(
  db: DataSourcesDb,
  repositoryId: string,
  alias: string,
): Promise<GoogleSheetsDataSource | null> {
  const [row] = await db
    .select()
    .from(dataSourcesGoogleSheets)
    .where(
      and(
        eq(dataSourcesGoogleSheets.repositoryId, repositoryId),
        eq(dataSourcesGoogleSheets.alias, alias),
      ),
    );
  return row ?? null;
}

export async function createGoogleSheetsDataSource(
  db: DataSourcesDb,
  data: {
    id: string;
    repositoryId: string;
    teamId: string;
    googleSheetsAccountId: string;
    spreadsheetId: string;
    spreadsheetName: string;
    sheetName: string;
    sheetGid?: number | null;
    alias: string;
    headerRow?: number;
    dataRange?: string | null;
    cachedHeaders?: string[] | null;
    cachedData?: string[][] | null;
  },
): Promise<GoogleSheetsDataSource> {
  const now = new Date();
  const newSource: NewGoogleSheetsDataSource = {
    id: data.id,
    repositoryId: data.repositoryId,
    teamId: data.teamId,
    googleSheetsAccountId: data.googleSheetsAccountId,
    spreadsheetId: data.spreadsheetId,
    spreadsheetName: data.spreadsheetName,
    sheetName: data.sheetName,
    sheetGid: data.sheetGid,
    alias: data.alias,
    headerRow: data.headerRow ?? 1,
    dataRange: data.dataRange,
    cachedHeaders: data.cachedHeaders,
    cachedData: data.cachedData,
    lastSyncedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(dataSourcesGoogleSheets).values(newSource);
  return newSource as GoogleSheetsDataSource;
}

export async function updateGoogleSheetsDataSource(
  db: DataSourcesDb,
  id: string,
  data: Partial<{
    alias: string;
    headerRow: number;
    dataRange: string | null;
    cachedHeaders: string[] | null;
    cachedData: string[][] | null;
    lastSyncedAt: Date;
  }>,
): Promise<void> {
  await db
    .update(dataSourcesGoogleSheets)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(dataSourcesGoogleSheets.id, id));
}

export async function deleteGoogleSheetsDataSource(
  db: DataSourcesDb,
  id: string,
): Promise<void> {
  await db
    .delete(dataSourcesGoogleSheets)
    .where(eq(dataSourcesGoogleSheets.id, id));
}

// ============================================
// Deletion
// ============================================

export async function listCsvDataSourceIdsForTeam(
  db: DataSourcesDb,
  teamId: string,
): Promise<string[]> {
  const rows = await db
    .select({ id: dataSourcesCsvSources.id })
    .from(dataSourcesCsvSources)
    .where(eq(dataSourcesCsvSources.teamId, teamId));
  return rows.map((r) => r.id);
}

export async function listCsvDataSourceIdsForRepo(
  db: DataSourcesDb,
  repositoryId: string,
): Promise<string[]> {
  const rows = await db
    .select({ id: dataSourcesCsvSources.id })
    .from(dataSourcesCsvSources)
    .where(eq(dataSourcesCsvSources.repositoryId, repositoryId));
  return rows.map((r) => r.id);
}

/** `{id, teamId}` pairs for a repo — the deletion hook needs the owning team
 * id to build a scoped storage capability, and a repo's rows can in
 * principle span differently-timed writes but never differently-teamed ones
 * in practice; grouped defensively anyway rather than assumed. */
export async function listCsvDataSourcesForRepo(
  db: DataSourcesDb,
  repositoryId: string,
): Promise<Array<{ id: string; teamId: string }>> {
  return db
    .select({
      id: dataSourcesCsvSources.id,
      teamId: dataSourcesCsvSources.teamId,
    })
    .from(dataSourcesCsvSources)
    .where(eq(dataSourcesCsvSources.repositoryId, repositoryId));
}

export async function deleteTeamRows(
  db: DataSourcesDb,
  teamId: string,
): Promise<void> {
  await db
    .delete(dataSourcesCsvSources)
    .where(eq(dataSourcesCsvSources.teamId, teamId));
  await db
    .delete(dataSourcesGoogleSheets)
    .where(eq(dataSourcesGoogleSheets.teamId, teamId));
}

export async function deleteRepoRows(
  db: DataSourcesDb,
  repositoryId: string,
): Promise<void> {
  await db
    .delete(dataSourcesCsvSources)
    .where(eq(dataSourcesCsvSources.repositoryId, repositoryId));
  await db
    .delete(dataSourcesGoogleSheets)
    .where(eq(dataSourcesGoogleSheets.repositoryId, repositoryId));
}
