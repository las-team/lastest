'use server';

import { revalidatePath } from 'next/cache';
import * as queries from '@/lib/db/queries';
import type { SetupAuthType, SetupAuthConfig } from '@/lib/db/schema';
import { runApiSetup } from '@/lib/setup/api-seeder';
import type { SetupConfig, SetupContext } from '@/lib/setup/types';

export interface CreateSetupConfigInput {
  repositoryId: string;
  name: string;
  baseUrl: string;
  authType: SetupAuthType;
  authConfig?: SetupAuthConfig;
}

export interface UpdateSetupConfigInput {
  name?: string;
  baseUrl?: string;
  authType?: SetupAuthType;
  authConfig?: SetupAuthConfig;
}

/**
 * Get all setup configs for a repository
 */
export async function getSetupConfigs(repositoryId: string) {
  return queries.getSetupConfigs(repositoryId);
}

/**
 * Get a single setup config by ID
 */
export async function getSetupConfig(id: string) {
  return queries.getSetupConfig(id);
}

/**
 * Create a new setup config
 */
export async function createSetupConfig(data: CreateSetupConfigInput) {
  // Validate base URL
  try {
    new URL(data.baseUrl);
  } catch {
    throw new Error('Invalid base URL');
  }

  // Validate auth config based on type
  if (data.authType === 'bearer' && !data.authConfig?.token) {
    throw new Error('Bearer auth requires a token');
  }
  if (data.authType === 'basic' && (!data.authConfig?.username || !data.authConfig?.password)) {
    throw new Error('Basic auth requires username and password');
  }
  if (data.authType === 'custom' && !data.authConfig?.headers) {
    throw new Error('Custom auth requires headers');
  }

  const result = await queries.createSetupConfig({
    repositoryId: data.repositoryId,
    name: data.name,
    baseUrl: data.baseUrl,
    authType: data.authType,
    authConfig: data.authConfig || null,
  });

  revalidatePath('/settings/setup');
  return result;
}

/**
 * Update a setup config
 */
export async function updateSetupConfig(id: string, data: UpdateSetupConfigInput) {
  // Validate base URL if provided
  if (data.baseUrl) {
    try {
      new URL(data.baseUrl);
    } catch {
      throw new Error('Invalid base URL');
    }
  }

  await queries.updateSetupConfig(id, data);
  revalidatePath('/settings/setup');
  return { success: true };
}

/**
 * Delete a setup config
 */
export async function deleteSetupConfig(id: string) {
  await queries.deleteSetupConfig(id);
  revalidatePath('/settings/setup');
  return { success: true };
}

/**
 * Test a setup config by making a simple request
 */
export async function testSetupConfig(id: string): Promise<{ success: boolean; error?: string }> {
  const config = await queries.getSetupConfig(id);
  if (!config) {
    return { success: false, error: 'Setup config not found' };
  }

  try {
    // Create a simple test script that just makes a GET request
    const testScript = {
      id: 'test',
      repositoryId: config.repositoryId,
      name: 'Test Connection',
      type: 'api' as const,
      code: JSON.stringify({
        method: 'GET',
        endpoint: '/',
      }),
      description: null,
      createdAt: null,
      updatedAt: null,
    };

    const context: SetupContext = {
      baseUrl: config.baseUrl,
      variables: {},
      repositoryId: config.repositoryId,
    };

    const result = await runApiSetup(config as SetupConfig, testScript, context);

    return {
      success: result.success,
      error: result.error,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Test a specific API endpoint using a setup config
 */
export async function testApiEndpoint(
  configId: string,
  method: string,
  endpoint: string,
  body?: unknown
): Promise<{ success: boolean; error?: string; response?: unknown }> {
  const config = await queries.getSetupConfig(configId);
  if (!config) {
    return { success: false, error: 'Setup config not found' };
  }

  try {
    const url = `${config.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Apply auth
    if (config.authType === 'bearer' && config.authConfig?.token) {
      headers['Authorization'] = `Bearer ${config.authConfig.token}`;
    } else if (config.authType === 'basic' && config.authConfig?.username && config.authConfig?.password) {
      const credentials = Buffer.from(
        `${config.authConfig.username}:${config.authConfig.password}`
      ).toString('base64');
      headers['Authorization'] = `Basic ${credentials}`;
    } else if (config.authType === 'custom' && config.authConfig?.headers) {
      Object.assign(headers, config.authConfig.headers);
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const contentType = response.headers.get('content-type');
    let responseData: unknown;
    if (contentType?.includes('application/json')) {
      responseData = await response.json();
    } else {
      responseData = await response.text();
    }

    if (!response.ok) {
      return {
        success: false,
        error: `${response.status} ${response.statusText}`,
        response: responseData,
      };
    }

    return {
      success: true,
      response: responseData,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
