'use server';

import { revalidatePath } from 'next/cache';
import * as queries from '@/lib/db/queries';
import { requireTeamAccess, requireRepoAccess } from '@/lib/auth';
import type { EnvironmentMode } from '@/lib/db/schema';

export interface EnvironmentConfigInput {
  repositoryId?: string | null;
  mode: EnvironmentMode;
  baseUrl: string;
  startCommand?: string | null;
  healthCheckUrl?: string | null;
  healthCheckTimeout?: number;
  reuseExistingServer?: boolean;
}

/**
 * Get environment config for a repository
 */
export async function getEnvironmentConfig(repositoryId?: string | null) {
  return queries.getEnvironmentConfig(repositoryId);
}

/**
 * Save environment config
 */
export async function saveEnvironmentConfig(data: EnvironmentConfigInput) {
  if (data.repositoryId) await requireRepoAccess(data.repositoryId);
  else await requireTeamAccess();
  const result = await queries.upsertEnvironmentConfig(data.repositoryId ?? null, {
    mode: data.mode,
    baseUrl: data.baseUrl.replace(/\/+$/, ''),
    startCommand: data.startCommand,
    healthCheckUrl: data.healthCheckUrl,
    healthCheckTimeout: data.healthCheckTimeout ?? 60000,
    reuseExistingServer: data.reuseExistingServer ?? true,
  });

  revalidatePath('/settings');
  return result;
}

/**
 * Test server connection at given URL
 */
export async function testServerConnection(url: string): Promise<{
  success: boolean;
  statusCode?: number;
  error?: string;
  responseTime?: number;
}> {
  await requireTeamAccess();

  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const responseTime = Date.now() - startTime;

    return {
      success: response.ok || response.status < 500,
      statusCode: response.status,
      responseTime,
    };
  } catch (error) {
    const responseTime = Date.now() - startTime;
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Connection failed',
      responseTime,
    };
  }
}

/**
 * Save a branch-specific base URL on the repository
 */
export async function saveBranchBaseUrl(repositoryId: string, branch: string, baseUrl: string) {
  await requireRepoAccess(repositoryId);
  const repo = await queries.getRepository(repositoryId);
  if (!repo) throw new Error('Repository not found');
  const urls = (repo.branchBaseUrls as Record<string, string>) ?? {};
  urls[branch] = baseUrl.replace(/\/+$/, '');
  await queries.updateRepository(repositoryId, { branchBaseUrls: urls });
  revalidatePath('/run');
}

/**
 * Get current server status
 */
export async function getServerStatus(repositoryId?: string | null) {
  const config = await queries.getEnvironmentConfig(repositoryId);
  return {
    mode: config?.mode || 'manual',
    baseUrl: config?.baseUrl || 'http://localhost:3000',
  };
}
