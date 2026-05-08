'use server';

import * as queries from '@/lib/db/queries';
import { getCurrentUser, requireRepoAccess, requireTeamAccess } from '@/lib/auth';
import {
  listSpreadsheets,
  getSpreadsheetInfo,
  getSheetData,
  refreshAccessToken,
} from '@/lib/google-sheets/api';
import type { DriveFile, SpreadsheetInfo, SheetData } from '@/lib/google-sheets/api';
import { revalidatePath } from 'next/cache';

/**
 * Get a valid access token for the team's Google Sheets account.
 * Refreshes automatically if expired.
 */
async function getValidAccessToken(): Promise<{ token: string; accountId: string } | null> {
  const user = await getCurrentUser();
  if (!user?.teamId) return null;

  const account = await queries.getGoogleSheetsAccount(user.teamId);
  if (!account) return null;

  // Check if token is expired (with 5-minute buffer)
  const isExpired = account.tokenExpiresAt && account.tokenExpiresAt.getTime() < Date.now() + 5 * 60 * 1000;

  if (isExpired && account.refreshToken) {
    const refreshed = await refreshAccessToken(account.refreshToken);
    if (refreshed) {
      await queries.updateGoogleSheetsAccountTokens(
        account.id,
        refreshed.access_token,
        new Date(Date.now() + refreshed.expires_in * 1000)
      );
      return { token: refreshed.access_token, accountId: account.id };
    }
  }

  return { token: account.accessToken, accountId: account.id };
}

/**
 * Get the connected Google Sheets account info.
 */
export async function getGoogleSheetsAccountInfo() {
  const user = await getCurrentUser();
  if (!user?.teamId) return null;

  const account = await queries.getGoogleSheetsAccount(user.teamId);
  if (!account) return null;

  return {
    id: account.id,
    googleEmail: account.googleEmail,
    googleName: account.googleName,
    createdAt: account.createdAt,
  };
}

/**
 * Disconnect Google Sheets account.
 */
export async function disconnectGoogleSheets() {
  const user = await getCurrentUser();
  if (!user?.teamId) return { success: false, error: 'Not authenticated' };

  await queries.deleteGoogleSheetsAccount(user.teamId);
  revalidatePath('/settings');
  return { success: true };
}

/**
 * List available spreadsheets from the connected Google account.
 */
export async function listAvailableSpreadsheets(): Promise<{
  success: boolean;
  spreadsheets?: DriveFile[];
  error?: string;
}> {
  const auth = await getValidAccessToken();
  if (!auth) return { success: false, error: 'Google Sheets not connected' };

  try {
    const spreadsheets = await listSpreadsheets(auth.token);
    return { success: true, spreadsheets };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to list spreadsheets' };
  }
}

/**
 * Get info about a specific spreadsheet (including its sheets/tabs).
 */
export async function getSpreadsheetDetails(spreadsheetId: string): Promise<{
  success: boolean;
  info?: SpreadsheetInfo;
  error?: string;
}> {
  const auth = await getValidAccessToken();
  if (!auth) return { success: false, error: 'Google Sheets not connected' };

  try {
    const info = await getSpreadsheetInfo(auth.token, spreadsheetId);
    return { success: true, info };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to get spreadsheet info' };
  }
}

/**
 * Preview data from a specific sheet tab.
 */
export async function previewSheetData(
  spreadsheetId: string,
  sheetName: string,
  maxRows: number = 10
): Promise<{
  success: boolean;
  data?: SheetData;
  error?: string;
}> {
  const auth = await getValidAccessToken();
  if (!auth) return { success: false, error: 'Google Sheets not connected' };

  try {
    const data = await getSheetData(auth.token, spreadsheetId, sheetName, maxRows);
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to preview sheet data' };
  }
}

/**
 * Import a sheet as a data source for a repository.
 */
export async function importSheetDataSource(data: {
  repositoryId: string;
  spreadsheetId: string;
  spreadsheetName: string;
  sheetName: string;
  sheetGid?: number;
  alias: string;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  await requireRepoAccess(data.repositoryId);
  const user = await getCurrentUser();
  if (!user?.teamId) return { success: false, error: 'Not authenticated' };

  const auth = await getValidAccessToken();
  if (!auth) return { success: false, error: 'Google Sheets not connected' };

  // Validate alias is unique for this repository
  const existing = await queries.getGoogleSheetsDataSourceByAlias(data.repositoryId, data.alias);
  if (existing) {
    return { success: false, error: `Alias "${data.alias}" is already in use` };
  }

  // Fetch initial data
  try {
    const sheetData = await getSheetData(auth.token, data.spreadsheetId, data.sheetName, 100);

    const source = await queries.createGoogleSheetsDataSource({
      repositoryId: data.repositoryId,
      teamId: user.teamId,
      googleSheetsAccountId: auth.accountId,
      spreadsheetId: data.spreadsheetId,
      spreadsheetName: data.spreadsheetName,
      sheetName: data.sheetName,
      sheetGid: data.sheetGid,
      alias: data.alias,
      cachedHeaders: sheetData.headers,
      cachedData: sheetData.rows,
    });

    revalidatePath('/settings');
    revalidatePath('/tests');
    return { success: true, id: source.id };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to import sheet' };
  }
}

/**
 * Sync/refresh cached data from a data source.
 */
export async function syncDataSource(dataSourceId: string): Promise<{
  success: boolean;
  error?: string;
}> {
  const session = await requireTeamAccess();
  const source = await queries.getGoogleSheetsDataSource(dataSourceId);
  if (!source) return { success: false, error: 'Data source not found' };
  if (source.teamId !== session.team.id) {
    return { success: false, error: 'Forbidden: Data source does not belong to your team' };
  }

  const auth = await getValidAccessToken();
  if (!auth) return { success: false, error: 'Google Sheets not connected' };

  try {
    const range = source.dataRange || source.sheetName;
    const sheetData = await getSheetData(auth.token, source.spreadsheetId, range, 100);

    await queries.updateGoogleSheetsDataSource(dataSourceId, {
      cachedHeaders: sheetData.headers,
      cachedData: sheetData.rows,
      lastSyncedAt: new Date(),
    });

    revalidatePath('/settings');
    revalidatePath('/tests');
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to sync data' };
  }
}

/**
 * Delete a data source.
 */
export async function deleteDataSource(dataSourceId: string): Promise<{
  success: boolean;
  error?: string;
}> {
  const session = await requireTeamAccess();
  const source = await queries.getGoogleSheetsDataSource(dataSourceId);
  if (!source) return { success: false, error: 'Data source not found' };
  if (source.teamId !== session.team.id) {
    return { success: false, error: 'Forbidden: Data source does not belong to your team' };
  }
  await queries.deleteGoogleSheetsDataSource(dataSourceId);
  revalidatePath('/settings');
  revalidatePath('/tests');
  return { success: true };
}

/**
 * Get all data sources for a repository.
 */
export async function getDataSources(repositoryId: string) {
  await requireRepoAccess(repositoryId);
  return queries.getGoogleSheetsDataSources(repositoryId);
}

/**
 * Update data source alias.
 */
export async function updateDataSourceAlias(
  dataSourceId: string,
  alias: string,
  repositoryId: string
): Promise<{ success: boolean; error?: string }> {
  const session = await requireRepoAccess(repositoryId);
  const source = await queries.getGoogleSheetsDataSource(dataSourceId);
  if (!source) return { success: false, error: 'Data source not found' };
  if (source.teamId !== session.team.id || source.repositoryId !== repositoryId) {
    return { success: false, error: 'Forbidden: Data source does not belong to that repository' };
  }

  // Check uniqueness
  const existing = await queries.getGoogleSheetsDataSourceByAlias(repositoryId, alias);
  if (existing && existing.id !== dataSourceId) {
    return { success: false, error: `Alias "${alias}" is already in use` };
  }

  await queries.updateGoogleSheetsDataSource(dataSourceId, { alias });
  revalidatePath('/settings');
  revalidatePath('/tests');
  return { success: true };
}
