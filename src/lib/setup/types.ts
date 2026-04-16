import type { Page } from 'playwright';

/**
 * Types for the setup system that runs before tests.
 */

// Setup script stored in database
export interface SetupScript {
  id: string;
  repositoryId: string | null;
  name: string;
  type: 'playwright' | 'api';
  code: string;
  description?: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

// API seeding configuration
export interface SetupConfig {
  id: string;
  repositoryId: string | null;
  name: string;
  baseUrl: string;
  authType: 'none' | 'bearer' | 'basic' | 'custom';
  authConfig: SetupAuthConfig | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface SetupAuthConfig {
  token?: string;         // For bearer auth
  username?: string;      // For basic auth
  password?: string;      // For basic auth
  headers?: Record<string, string>; // For custom auth
}

// Context passed to setup scripts - accumulates variables from higher levels
export interface SetupContext {
  baseUrl: string;
  page?: Page;              // For Playwright scripts
  variables: Record<string, unknown>;  // Shared state between setups
  repositoryId?: string | null;
  storageState?: string;    // JSON from context.storageState() — carries cookies/localStorage across browser contexts
}

// Result returned from running a setup
export interface SetupResult {
  success: boolean;
  error?: string;
  variables?: Record<string, unknown>;  // Pass data to tests
  duration: number;
}

// API script format (stored as JSON in code field for API type scripts)
export interface ApiScriptDefinition {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  endpoint: string;
  headers?: Record<string, string>;
  body?: unknown;
  // Extract variables from response using dot notation paths
  extractVariables?: Record<string, string>;
}

// Setup source - either a test ID or a script ID
export interface SetupSource {
  testId?: string | null;
  scriptId?: string | null;
}

// Resolved setup - the actual test or script to run
export interface ResolvedSetup {
  type: 'test' | 'script' | 'none';
  test?: {
    id: string;
    name: string;
    code: string;
    targetUrl: string | null;
  };
  script?: SetupScript;
}

// Setup execution level
export type SetupLevel = 'build' | 'test';

// Setup status for builds
export type SetupStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

// Combined setup info for UI display
export interface SetupInfo {
  level: SetupLevel;
  type: 'test' | 'script' | 'none';
  name?: string;
  status?: SetupStatus;
  duration?: number;
  error?: string;
}
