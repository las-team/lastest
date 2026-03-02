import { db } from '../index';
import {
  specImports,
  googleSheetsAccounts,
  googleSheetsDataSources,
  composeConfigs,
  agentSessions,
} from '../schema';
import type {
  NewSpecImport,
  NewGoogleSheetsAccount,
  NewGoogleSheetsDataSource,
  NewComposeConfig,
  NewAgentSession,
  AgentSessionStatus,
  AgentStepState,
  AgentStepId,
  AgentSessionMetadata,
} from '../schema';
import { eq, desc, and, or } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

// Spec Imports
export async function createSpecImport(data: Omit<NewSpecImport, 'id' | 'createdAt'>) {
  const id = uuid();
  const now = new Date();
  await db.insert(specImports).values({ ...data, id, createdAt: now });
  return { id, ...data, createdAt: now };
}

export async function updateSpecImport(
  id: string,
  data: Partial<Pick<NewSpecImport, 'status' | 'extractedStories' | 'areasCreated' | 'testsCreated' | 'error' | 'completedAt'>>
) {
  await db.update(specImports).set(data).where(eq(specImports.id, id));
}

export async function getSpecImport(id: string) {
  return db.select().from(specImports).where(eq(specImports.id, id)).get();
}

export async function getSpecImportsByRepo(repositoryId: string) {
  return db
    .select()
    .from(specImports)
    .where(eq(specImports.repositoryId, repositoryId))
    .orderBy(desc(specImports.createdAt))
    .all();
}

// ============================================
// Google Sheets Data Sources
// ============================================

export async function getGoogleSheetsAccount(teamId?: string | null) {
  if (!teamId) return null;
  return db
    .select()
    .from(googleSheetsAccounts)
    .where(eq(googleSheetsAccounts.teamId, teamId))
    .get() || null;
}

export async function upsertGoogleSheetsAccount(data: {
  teamId: string;
  googleUserId: string;
  googleEmail: string;
  googleName?: string | null;
  accessToken: string;
  refreshToken?: string | null;
  tokenExpiresAt?: Date | null;
}) {
  const existing = await db
    .select()
    .from(googleSheetsAccounts)
    .where(eq(googleSheetsAccounts.teamId, data.teamId))
    .get();

  if (existing) {
    await db
      .update(googleSheetsAccounts)
      .set({
        googleUserId: data.googleUserId,
        googleEmail: data.googleEmail,
        googleName: data.googleName,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken || existing.refreshToken,
        tokenExpiresAt: data.tokenExpiresAt,
      })
      .where(eq(googleSheetsAccounts.id, existing.id));
    return { ...existing, ...data };
  }

  const id = uuid();
  const newAccount: NewGoogleSheetsAccount = {
    id,
    teamId: data.teamId,
    googleUserId: data.googleUserId,
    googleEmail: data.googleEmail,
    googleName: data.googleName,
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    tokenExpiresAt: data.tokenExpiresAt,
    createdAt: new Date(),
  };

  await db.insert(googleSheetsAccounts).values(newAccount);
  return newAccount;
}

export async function updateGoogleSheetsAccountTokens(
  accountId: string,
  accessToken: string,
  tokenExpiresAt: Date
) {
  await db
    .update(googleSheetsAccounts)
    .set({ accessToken, tokenExpiresAt })
    .where(eq(googleSheetsAccounts.id, accountId));
}

export async function deleteGoogleSheetsAccount(teamId: string) {
  // Delete all data sources first
  const account = await getGoogleSheetsAccount(teamId);
  if (account) {
    await db
      .delete(googleSheetsDataSources)
      .where(eq(googleSheetsDataSources.googleSheetsAccountId, account.id));
    await db
      .delete(googleSheetsAccounts)
      .where(eq(googleSheetsAccounts.id, account.id));
  }
}

// Data Sources

export async function getGoogleSheetsDataSources(repositoryId?: string | null) {
  if (!repositoryId) return [];
  return db
    .select()
    .from(googleSheetsDataSources)
    .where(eq(googleSheetsDataSources.repositoryId, repositoryId))
    .all();
}

export async function getGoogleSheetsDataSource(id: string) {
  return db
    .select()
    .from(googleSheetsDataSources)
    .where(eq(googleSheetsDataSources.id, id))
    .get() || null;
}

export async function getGoogleSheetsDataSourceByAlias(repositoryId: string, alias: string) {
  return db
    .select()
    .from(googleSheetsDataSources)
    .where(
      and(
        eq(googleSheetsDataSources.repositoryId, repositoryId),
        eq(googleSheetsDataSources.alias, alias)
      )
    )
    .get() || null;
}

export async function createGoogleSheetsDataSource(data: {
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
}) {
  const id = uuid();
  const now = new Date();
  const newSource: NewGoogleSheetsDataSource = {
    id,
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

  await db.insert(googleSheetsDataSources).values(newSource);
  return { ...newSource };
}

export async function updateGoogleSheetsDataSource(
  id: string,
  data: Partial<{
    alias: string;
    headerRow: number;
    dataRange: string | null;
    cachedHeaders: string[] | null;
    cachedData: string[][] | null;
    lastSyncedAt: Date;
  }>
) {
  await db
    .update(googleSheetsDataSources)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(googleSheetsDataSources.id, id));
}

export async function deleteGoogleSheetsDataSource(id: string) {
  await db
    .delete(googleSheetsDataSources)
    .where(eq(googleSheetsDataSources.id, id));
}

// ============================================
// Compose Configs
// ============================================

export async function getComposeConfig(repositoryId: string, branch: string) {
  return db
    .select()
    .from(composeConfigs)
    .where(and(
      eq(composeConfigs.repositoryId, repositoryId),
      eq(composeConfigs.branch, branch),
    ))
    .get() ?? null;
}

export async function upsertComposeConfig(
  repositoryId: string,
  branch: string,
  data: { selectedTestIds: string[]; excludedTestIds: string[]; versionOverrides: Record<string, string> },
) {
  const existing = await db
    .select()
    .from(composeConfigs)
    .where(and(
      eq(composeConfigs.repositoryId, repositoryId),
      eq(composeConfigs.branch, branch),
    ))
    .get();

  if (existing) {
    await db
      .update(composeConfigs)
      .set({
        selectedTestIds: data.selectedTestIds,
        excludedTestIds: data.excludedTestIds,
        versionOverrides: data.versionOverrides,
        updatedAt: new Date(),
      })
      .where(eq(composeConfigs.id, existing.id));
    return { ...existing, ...data, updatedAt: new Date() };
  } else {
    const id = uuid();
    const newConfig: NewComposeConfig = {
      id,
      repositoryId,
      branch,
      selectedTestIds: data.selectedTestIds,
      excludedTestIds: data.excludedTestIds,
      versionOverrides: data.versionOverrides,
      updatedAt: new Date(),
    };
    await db.insert(composeConfigs).values(newConfig);
    return newConfig;
  }
}

// ============================================
// Agent Sessions
// ============================================

export async function createAgentSession(data: Omit<NewAgentSession, 'id'>) {
  const id = uuid();
  const now = new Date();
  await db.insert(agentSessions).values({
    ...data,
    id,
    createdAt: now,
    updatedAt: now,
  });
  return db.select().from(agentSessions).where(eq(agentSessions.id, id)).get()!;
}

export async function getAgentSession(id: string) {
  return db.select().from(agentSessions).where(eq(agentSessions.id, id)).get();
}

export async function getActiveAgentSession(repositoryId: string) {
  return db
    .select()
    .from(agentSessions)
    .where(
      and(
        eq(agentSessions.repositoryId, repositoryId),
        or(
          eq(agentSessions.status, 'active'),
          eq(agentSessions.status, 'paused'),
        ),
      ),
    )
    .orderBy(desc(agentSessions.createdAt))
    .get();
}

export async function updateAgentSession(
  id: string,
  data: {
    status?: AgentSessionStatus;
    currentStepId?: AgentStepId;
    steps?: AgentStepState[];
    metadata?: AgentSessionMetadata;
    completedAt?: Date;
  },
) {
  await db
    .update(agentSessions)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(agentSessions.id, id));
}
