/**
 * Execution Mode Detection
 *
 * Determines whether tests should run locally or via remote runner.
 *
 * Modes:
 * - 'local': Direct Playwright execution on same machine (development, self-hosted)
 * - 'runner': Route through remote runner via WebSocket (cloud deployment)
 */

export type ExecutionMode = 'local' | 'runner';

/**
 * Get the current execution mode from environment.
 * Defaults to 'local' in development, 'runner' in production.
 */
export function getExecutionMode(): ExecutionMode {
  const envMode = process.env.EXECUTION_MODE as ExecutionMode | undefined;

  if (envMode === 'local' || envMode === 'runner') {
    return envMode;
  }

  // Default: local in development, runner in production
  if (process.env.NODE_ENV === 'development') {
    return 'local';
  }

  return 'runner';
}

/**
 * Check if running in local execution mode.
 */
export function isLocalMode(): boolean {
  return getExecutionMode() === 'local';
}

/**
 * Check if running in runner execution mode.
 */
export function isRunnerMode(): boolean {
  return getExecutionMode() === 'runner';
}

/**
 * Force local mode override for specific operations.
 * Used when explicitly running tests locally regardless of env.
 */
export function shouldUseLocalRunner(forceLocal?: boolean): boolean {
  if (forceLocal) return true;
  return isLocalMode();
}
