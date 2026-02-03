/**
 * Execution Mode Detection
 *
 * Determines whether tests should run locally or via remote agent.
 *
 * Modes:
 * - 'local': Direct Playwright execution on same machine (development, self-hosted)
 * - 'agent': Route through remote agent via WebSocket (cloud deployment)
 */

export type ExecutionMode = 'local' | 'agent';

/**
 * Get the current execution mode from environment.
 * Defaults to 'local' in development, 'agent' in production.
 */
export function getExecutionMode(): ExecutionMode {
  const envMode = process.env.EXECUTION_MODE as ExecutionMode | undefined;

  if (envMode === 'local' || envMode === 'agent') {
    return envMode;
  }

  // Default: local in development, agent in production
  if (process.env.NODE_ENV === 'development') {
    return 'local';
  }

  return 'agent';
}

/**
 * Check if running in local execution mode.
 */
export function isLocalMode(): boolean {
  return getExecutionMode() === 'local';
}

/**
 * Check if running in agent execution mode.
 */
export function isAgentMode(): boolean {
  return getExecutionMode() === 'agent';
}

/**
 * Force local mode override for specific operations.
 * Used when explicitly running tests locally regardless of env.
 */
export function shouldUseLocalRunner(forceLocal?: boolean): boolean {
  if (forceLocal) return true;
  return isLocalMode();
}
