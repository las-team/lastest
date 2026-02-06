'use server';

import { revalidatePath } from 'next/cache';
import * as queries from '@/lib/db/queries';
import { requireTeamAccess, requireRepoAccess } from '@/lib/auth';
import { getServerManager } from '@/lib/playwright/server-manager';
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
    baseUrl: data.baseUrl,
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
  const serverManager = getServerManager();
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
 * Get current server status
 */
export async function getServerStatus(repositoryId?: string | null) {
  const config = await queries.getEnvironmentConfig(repositoryId);
  const serverManager = getServerManager();

  // Configure server manager with latest config
  if (config && config.id) {
    serverManager.setConfig(config);
  }

  const status = await serverManager.getStatus();
  return {
    ...status,
    mode: config?.mode || 'manual',
    baseUrl: config?.baseUrl || 'http://localhost:3000',
  };
}

/**
 * Manually start the managed server
 */
export async function startManagedServer(repositoryId?: string | null): Promise<{
  success: boolean;
  error?: string;
}> {
  if (repositoryId) await requireRepoAccess(repositoryId);
  else await requireTeamAccess();
  const config = await queries.getEnvironmentConfig(repositoryId);

  if (!config || config.mode !== 'managed') {
    return { success: false, error: 'Not in managed mode' };
  }

  if (!config.startCommand) {
    return { success: false, error: 'No start command configured' };
  }

  const serverManager = getServerManager();
  serverManager.setConfig(config);

  const result = await serverManager.ensureServerRunning();
  return {
    success: result.ready,
    error: result.error,
  };
}

/**
 * Stop the managed server
 */
export async function stopManagedServer(): Promise<void> {
  await requireTeamAccess();
  const serverManager = getServerManager();
  await serverManager.stopManagedServer();
}
