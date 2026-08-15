"use server";

import { revalidatePath } from "next/cache";

import { parseCsvBuffer } from "@lastest/csv";
import {
  getSheetData,
  getSpreadsheetInfo,
  listSpreadsheets,
  type DriveFile,
  type SheetData,
  type SpreadsheetInfo,
} from "@lastest/google-sheets";

import { orm, type DataSourcesDb } from "./data/db";
import * as q from "./data/queries";
import { dataSourcesPlugin } from "./index";
import type { CsvDataSource, GoogleSheetsDataSource } from "./schema";
import { dataSourcesWiring } from "./wiring";

/**
 * The data-sources plugin's server actions — a move of
 * `src/server/actions/csv-sources.ts` and the data-source half of
 * `src/server/actions/google-sheets.ts` (the account/OAuth half of that file
 * — `getValidAccessToken`'s refresh logic — stayed core; see
 * `host.googleSheetsAccessToken`).
 *
 * ### Where the team/repo id comes from
 *
 * `repoScope(repositoryId)` calls `runtime.contextFor(dataSourcesPlugin,
 * { repositoryId })` — `resolveScope` authorizes the caller against that
 * repo and returns a session-derived team, the same shape
 * `explorer`/`app-map`/`ci` use (recipe §1.7). `teamScope()` calls it with no
 * scope request at all, for the three actions that operate on the team's
 * connected Google account rather than on a specific repo's data sources;
 * `resolveScope` falls through to `requireTeamAccess()`.
 *
 * ### CSV bytes moved from the filesystem to `ctx.storage`
 *
 * The pre-migration code wrote uploaded files under
 * `STORAGE_DIRS["csv-sources"]/<repositoryId>/<timestamp>_<name>` and stored
 * that path in the row. A plugin cannot import `fs`/`path`/
 * `@/lib/storage/paths` (rule 1) and does not need to: `ctx.storage` is
 * tenant-quota-checked blob storage, namespaced by `(teamId, pluginId)`
 * automatically. Each source's bytes live at the deterministic key
 * `csv/<id>` — no path column to store or go stale, and re-sync-from-disk
 * (`syncCsvSource` with no new upload) reads the same key back.
 */

const MAX_CSV_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_CACHED_ROWS = 1000;
const ALIAS_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

function validateAlias(alias: string): string | null {
  if (!alias) return "Alias is required";
  if (alias.length > 64) return "Alias too long (max 64 chars)";
  if (!ALIAS_PATTERN.test(alias)) {
    return "Alias must start with a letter and contain only letters, digits, underscores, or hyphens";
  }
  return null;
}

async function repoScope(repositoryId: string) {
  const { runtime, data, host } = dataSourcesWiring();
  const ctx = await runtime.contextFor(dataSourcesPlugin, { repositoryId });
  return {
    teamId: ctx.team.id,
    repositoryId: ctx.repo!.id,
    db: orm(data),
    storage: ctx.storage,
    host,
  };
}

async function teamScope() {
  const { runtime, data, host } = dataSourcesWiring();
  const ctx = await runtime.contextFor(dataSourcesPlugin);
  return { teamId: ctx.team.id, db: orm(data), host };
}

function revalidateSettingsAndTests(): void {
  revalidatePath("/settings");
  revalidatePath("/tests");
}

// ============================================
// CSV sources
// ============================================

export async function uploadCsvSource(
  repositoryId: string,
  alias: string,
  fileData: Uint8Array | Buffer,
  fileName: string,
): Promise<{ success: boolean; source?: CsvDataSource; error?: string }> {
  const { teamId, db, storage } = await repoScope(repositoryId);

  const fileBuffer = Buffer.isBuffer(fileData)
    ? fileData
    : Buffer.from(fileData);
  if (fileBuffer.length === 0) return { success: false, error: "Empty file" };
  if (fileBuffer.length > MAX_CSV_SIZE)
    return { success: false, error: "File exceeds 10MB limit" };

  const aliasError = validateAlias(alias);
  if (aliasError) return { success: false, error: aliasError };

  const existing = await q.getCsvDataSourceByAlias(db, repositoryId, alias);
  if (existing) {
    return {
      success: false,
      error: `Alias "${alias}" already exists in this repo`,
    };
  }

  let parsed;
  try {
    parsed = parseCsvBuffer(fileBuffer);
  } catch (e) {
    return {
      success: false,
      error: `Failed to parse CSV: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  if (parsed.headers.length === 0) {
    return { success: false, error: "CSV has no header row" };
  }

  const id = crypto.randomUUID();
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  await storage.put(`csv/${id}`, fileBuffer, { contentType: "text/csv" });

  const cachedRows = parsed.rows.slice(0, MAX_CACHED_ROWS);
  const source = await q.createCsvDataSource(db, {
    id,
    repositoryId,
    teamId,
    alias,
    filename: safeName,
    cachedHeaders: parsed.headers,
    cachedData: cachedRows,
    rowCount: parsed.rowCount,
  });

  revalidateSettingsAndTests();
  return { success: true, source };
}

export async function syncCsvSource(
  id: string,
  fileData?: Uint8Array | Buffer,
  fileName?: string,
): Promise<{ success: boolean; error?: string }> {
  const source = await lookupCsvSource(id);
  if (!source) return { success: false, error: "Not found" };
  const { db, storage } = await repoScope(source.repositoryId);

  const incoming = fileData
    ? Buffer.isBuffer(fileData)
      ? fileData
      : Buffer.from(fileData)
    : null;

  let buf: Buffer;
  if (incoming && incoming.length > 0) {
    if (incoming.length > MAX_CSV_SIZE)
      return { success: false, error: "File exceeds 10MB limit" };
    buf = incoming;
  } else {
    const stored = await storage.get(`csv/${id}`);
    if (!stored) {
      return {
        success: false,
        error: "Original file no longer in storage; re-upload required",
      };
    }
    buf = Buffer.from(stored);
  }

  let parsed;
  try {
    parsed = parseCsvBuffer(buf);
  } catch (e) {
    return {
      success: false,
      error: `Failed to parse CSV: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  if (parsed.headers.length === 0) {
    return { success: false, error: "CSV has no header row" };
  }

  let filename = source.filename;
  if (incoming) {
    await storage.put(`csv/${id}`, incoming, { contentType: "text/csv" });
    if (fileName) filename = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  }

  await q.updateCsvDataSource(db, id, {
    cachedHeaders: parsed.headers,
    cachedData: parsed.rows.slice(0, MAX_CACHED_ROWS),
    rowCount: parsed.rowCount,
    lastSyncedAt: new Date(),
    filename,
  });

  revalidateSettingsAndTests();
  return { success: true };
}

export async function deleteCsvSource(
  id: string,
): Promise<{ success: boolean }> {
  const source = await lookupCsvSource(id);
  if (!source) return { success: true };
  const { db, storage } = await repoScope(source.repositoryId);

  await storage.delete(`csv/${id}`).catch(() => {});
  await q.deleteCsvDataSource(db, id);

  revalidateSettingsAndTests();
  return { success: true };
}

export async function updateCsvSourceAlias(
  id: string,
  alias: string,
): Promise<{ success: boolean; error?: string }> {
  const source = await lookupCsvSource(id);
  if (!source) return { success: false, error: "Not found" };
  const { db } = await repoScope(source.repositoryId);

  const aliasError = validateAlias(alias);
  if (aliasError) return { success: false, error: aliasError };

  if (alias !== source.alias) {
    const conflict = await q.getCsvDataSourceByAlias(
      db,
      source.repositoryId,
      alias,
    );
    if (conflict)
      return { success: false, error: `Alias "${alias}" already exists` };
  }

  await q.updateCsvDataSource(db, id, { alias });
  revalidateSettingsAndTests();
  return { success: true };
}

export async function listCsvSources(
  repositoryId: string,
): Promise<CsvDataSource[]> {
  const { db } = await repoScope(repositoryId);
  return q.getCsvDataSources(db, repositoryId);
}

/**
 * Reads without authorizing — `syncCsvSource`/`deleteCsvSource`/
 * `updateCsvSourceAlias` take only an id, so the repo (and therefore the
 * authorization check) is not known until the row is read. `repoScope`
 * immediately after this is what actually authorizes the caller; a lookup
 * alone grants nothing.
 */
async function lookupCsvSource(id: string): Promise<CsvDataSource | null> {
  // No wiring scope yet — read through the team-scoped handle is not
  // possible without one, so this uses the same unscoped `db()` the
  // deletion hook uses, purely to resolve which repo owns `id`.
  const database: DataSourcesDb = orm(dataSourcesWiring().data);
  return q.getCsvDataSource(database, id);
}

// ============================================
// Google Sheets — account
// ============================================

export async function getGoogleSheetsAccountInfo(): Promise<{
  id: string;
  googleEmail: string;
  googleName: string | null;
  createdAt: Date | null;
} | null> {
  const { teamId, host } = await teamScope();
  return host.googleSheetsAccountInfo(teamId);
}

export async function disconnectGoogleSheets(): Promise<{
  success: boolean;
}> {
  const { teamId, host } = await teamScope();
  await host.disconnectGoogleSheets(teamId);
  revalidatePath("/settings");
  return { success: true };
}

export async function listAvailableSpreadsheets(): Promise<{
  success: boolean;
  spreadsheets?: DriveFile[];
  error?: string;
}> {
  const { teamId, host } = await teamScope();
  const auth = await host.googleSheetsAccessToken(teamId);
  if (!auth) return { success: false, error: "Google Sheets not connected" };
  try {
    const spreadsheets = await listSpreadsheets(auth.token);
    return { success: true, spreadsheets };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to list spreadsheets",
    };
  }
}

export async function getSpreadsheetDetails(spreadsheetId: string): Promise<{
  success: boolean;
  info?: SpreadsheetInfo;
  error?: string;
}> {
  const { teamId, host } = await teamScope();
  const auth = await host.googleSheetsAccessToken(teamId);
  if (!auth) return { success: false, error: "Google Sheets not connected" };
  try {
    const info = await getSpreadsheetInfo(auth.token, spreadsheetId);
    return { success: true, info };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to get spreadsheet info",
    };
  }
}

export async function previewSheetData(
  spreadsheetId: string,
  sheetName: string,
  maxRows: number = 10,
): Promise<{ success: boolean; data?: SheetData; error?: string }> {
  const { teamId, host } = await teamScope();
  const auth = await host.googleSheetsAccessToken(teamId);
  if (!auth) return { success: false, error: "Google Sheets not connected" };
  try {
    const data = await getSheetData(
      auth.token,
      spreadsheetId,
      sheetName,
      maxRows,
    );
    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to preview sheet data",
    };
  }
}

// ============================================
// Google Sheets — data sources
// ============================================

export async function importSheetDataSource(data: {
  repositoryId: string;
  spreadsheetId: string;
  spreadsheetName: string;
  sheetName: string;
  sheetGid?: number;
  alias: string;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const { teamId, db, host } = await repoScope(data.repositoryId);

  const auth = await host.googleSheetsAccessToken(teamId);
  if (!auth) return { success: false, error: "Google Sheets not connected" };

  const existing = await q.getGoogleSheetsDataSourceByAlias(
    db,
    data.repositoryId,
    data.alias,
  );
  if (existing) {
    return { success: false, error: `Alias "${data.alias}" is already in use` };
  }

  try {
    const sheetData = await getSheetData(
      auth.token,
      data.spreadsheetId,
      data.sheetName,
      100,
    );

    const source = await q.createGoogleSheetsDataSource(db, {
      id: crypto.randomUUID(),
      repositoryId: data.repositoryId,
      teamId,
      googleSheetsAccountId: auth.accountId,
      spreadsheetId: data.spreadsheetId,
      spreadsheetName: data.spreadsheetName,
      sheetName: data.sheetName,
      sheetGid: data.sheetGid,
      alias: data.alias,
      cachedHeaders: sheetData.headers,
      cachedData: sheetData.rows,
    });

    revalidateSettingsAndTests();
    return { success: true, id: source.id };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to import sheet",
    };
  }
}

export async function syncDataSource(
  dataSourceId: string,
): Promise<{ success: boolean; error?: string }> {
  const source = await lookupGoogleSheetsSource(dataSourceId);
  if (!source) return { success: false, error: "Data source not found" };
  const { teamId, db, host } = await repoScope(source.repositoryId);
  if (source.teamId !== teamId) {
    return {
      success: false,
      error: "Forbidden: Data source does not belong to your team",
    };
  }

  const auth = await host.googleSheetsAccessToken(teamId);
  if (!auth) return { success: false, error: "Google Sheets not connected" };

  try {
    const range = source.dataRange || source.sheetName;
    const sheetData = await getSheetData(
      auth.token,
      source.spreadsheetId,
      range,
      100,
    );

    await q.updateGoogleSheetsDataSource(db, dataSourceId, {
      cachedHeaders: sheetData.headers,
      cachedData: sheetData.rows,
      lastSyncedAt: new Date(),
    });

    revalidateSettingsAndTests();
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to sync data",
    };
  }
}

export async function deleteDataSource(
  dataSourceId: string,
): Promise<{ success: boolean; error?: string }> {
  const source = await lookupGoogleSheetsSource(dataSourceId);
  if (!source) return { success: false, error: "Data source not found" };
  const { teamId, db } = await repoScope(source.repositoryId);
  if (source.teamId !== teamId) {
    return {
      success: false,
      error: "Forbidden: Data source does not belong to your team",
    };
  }
  await q.deleteGoogleSheetsDataSource(db, dataSourceId);
  revalidateSettingsAndTests();
  return { success: true };
}

export async function getDataSources(
  repositoryId: string,
): Promise<GoogleSheetsDataSource[]> {
  const { db } = await repoScope(repositoryId);
  return q.getGoogleSheetsDataSources(db, repositoryId);
}

export async function updateDataSourceAlias(
  dataSourceId: string,
  alias: string,
  repositoryId: string,
): Promise<{ success: boolean; error?: string }> {
  const { teamId, db } = await repoScope(repositoryId);
  const source = await q.getGoogleSheetsDataSource(db, dataSourceId);
  if (!source) return { success: false, error: "Data source not found" };
  if (source.teamId !== teamId || source.repositoryId !== repositoryId) {
    return {
      success: false,
      error: "Forbidden: Data source does not belong to that repository",
    };
  }

  const existing = await q.getGoogleSheetsDataSourceByAlias(
    db,
    repositoryId,
    alias,
  );
  if (existing && existing.id !== dataSourceId) {
    return { success: false, error: `Alias "${alias}" is already in use` };
  }

  await q.updateGoogleSheetsDataSource(db, dataSourceId, { alias });
  revalidateSettingsAndTests();
  return { success: true };
}

async function lookupGoogleSheetsSource(
  id: string,
): Promise<GoogleSheetsDataSource | null> {
  const database: DataSourcesDb = orm(dataSourcesWiring().data);
  return q.getGoogleSheetsDataSource(database, id);
}
