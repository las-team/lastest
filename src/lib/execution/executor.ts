/**
 * Test Executor
 *
 * Unified interface for test execution that routes through either:
 * - Local Playwright runner (development, self-hosted)
 * - Remote agent (cloud deployment)
 *
 * Mode is determined by EXECUTION_MODE env variable or auto-detected.
 */

import { getExecutionMode, shouldUseLocalRunner } from './mode';
import { getRunner, type TestRunResult, type ProgressCallback } from '@/lib/playwright/runner';
import type { Test, EnvironmentConfig, PlaywrightSettings } from '@/lib/db/schema';
import type {
  RunTestCommand,
  TestResultResponse,
  TestProgressResponse,
  ScreenshotUploadResponse,
} from '@/lib/ws/protocol';
import { createMessage } from '@/lib/ws/protocol';
import { queueCommand, getTestResults, getScreenshots } from '@/app/api/ws/agent/route';
import { agentRegistry } from '@/lib/ws/agent-registry';
import { db } from '@/lib/db';
import { agents } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import fs from 'fs/promises';
import path from 'path';

export interface ExecutionOptions {
  repositoryId?: string | null;
  teamId?: string;
  forceLocal?: boolean;
  headless?: boolean;
  environmentConfig?: EnvironmentConfig | null;
  playwrightSettings?: PlaywrightSettings | null;
  agentId?: string; // 'local' or specific agent ID - if set, overrides mode detection
}

export interface ExecutionProgress {
  completed: number;
  total: number;
  currentTestName?: string;
  currentStep?: string;
}

/**
 * Execute tests using the appropriate runner (local or remote agent).
 */
export async function executeTests(
  tests: Test[],
  runId: string,
  options: ExecutionOptions,
  onProgress?: (progress: ExecutionProgress) => void,
  onResult?: (result: TestRunResult) => Promise<void>
): Promise<TestRunResult[]> {
  const mode = getExecutionMode();
  const useLocal = shouldUseLocalRunner(options.forceLocal);

  console.log(`Execution mode: ${mode}, using local: ${useLocal}`);

  if (useLocal) {
    return executeLocally(tests, runId, options, onProgress, onResult);
  }

  // Agent mode requires teamId
  if (!options.teamId) {
    console.warn('No teamId provided for agent mode, falling back to local');
    return executeLocally(tests, runId, options, onProgress, onResult);
  }

  // Check if agent is available
  const agent = await getAvailableAgent(options.teamId);
  if (!agent) {
    console.warn('No agent available, falling back to local');
    return executeLocally(tests, runId, options, onProgress, onResult);
  }

  return executeViaAgent(tests, runId, agent.id, options, onProgress, onResult);
}

/**
 * Execute tests locally using Playwright runner.
 */
async function executeLocally(
  tests: Test[],
  runId: string,
  options: ExecutionOptions,
  onProgress?: (progress: ExecutionProgress) => void,
  onResult?: (result: TestRunResult) => Promise<void>
): Promise<TestRunResult[]> {
  const runner = getRunner(options.repositoryId);

  // Configure runner
  if (options.environmentConfig) {
    runner.setEnvironmentConfig(options.environmentConfig);
  }
  if (options.playwrightSettings) {
    runner.setSettings(options.playwrightSettings);
  }

  const progressCallback = onProgress
    ? (p: ProgressCallback) => {
        onProgress({
          completed: p.completed,
          total: p.total,
          currentTestName: p.currentTestName,
        });
      }
    : undefined;

  return runner.runTests(tests, runId, progressCallback, onResult, options.headless);
}

/**
 * Execute tests via remote agent.
 */
async function executeViaAgent(
  tests: Test[],
  runId: string,
  agentId: string,
  options: ExecutionOptions,
  onProgress?: (progress: ExecutionProgress) => void,
  onResult?: (result: TestRunResult) => Promise<void>
): Promise<TestRunResult[]> {
  const results: TestRunResult[] = [];
  const baseUrl = options.environmentConfig?.baseUrl || 'http://localhost:3000';
  const viewport = options.playwrightSettings
    ? {
        width: options.playwrightSettings.viewportWidth || 1280,
        height: options.playwrightSettings.viewportHeight || 720,
      }
    : undefined;

  for (let i = 0; i < tests.length; i++) {
    const test = tests[i];

    onProgress?.({
      completed: i,
      total: tests.length,
      currentTestName: test.name,
    });

    // Create run_test command
    const command = createMessage<RunTestCommand>('command:run_test', {
      testId: test.id,
      testRunId: runId,
      code: test.code,
      targetUrl: test.targetUrl || baseUrl,
      screenshotPath: `${runId}-${test.id}.png`,
      timeout: options.playwrightSettings?.navigationTimeout || 30000,
      viewport,
    });

    // Queue command for agent (polling mode)
    queueCommand(agentId, command);

    // Wait for result (poll with timeout)
    const result = await waitForTestResult(agentId, command.id, runId, test.id, options.repositoryId);
    results.push(result);

    await onResult?.(result);

    onProgress?.({
      completed: i + 1,
      total: tests.length,
      currentTestName: test.name,
    });
  }

  return results;
}

/**
 * Wait for test result from agent (polling mode).
 */
async function waitForTestResult(
  agentId: string,
  commandId: string,
  runId: string,
  testId: string,
  repositoryId?: string | null,
  timeout: number = 120000
): Promise<TestRunResult> {
  const startTime = Date.now();
  const pollInterval = 1000;

  while (Date.now() - startTime < timeout) {
    // Check for screenshots first (may arrive before result)
    const screenshots = getScreenshots(agentId);
    for (const screenshot of screenshots) {
      if (screenshot.type === 'response:screenshot') {
        const payload = (screenshot as ScreenshotUploadResponse).payload;
        if (payload.correlationId === commandId) {
          // Save screenshot to filesystem
          await saveScreenshotFromBase64(payload.data, payload.filename, repositoryId);
        }
      }
    }

    // Check for test results
    const results = getTestResults(agentId);
    for (const result of results) {
      if (result.payload.correlationId === commandId) {
        // Found our result
        const payload = result.payload;

        // Build screenshot path
        let screenshotPath: string | undefined;
        if (payload.error?.screenshot) {
          const filename = `${runId}-${testId}-failure.png`;
          screenshotPath = await saveScreenshotFromBase64(
            payload.error.screenshot,
            filename,
            repositoryId
          );
        }

        return {
          testId: payload.testId,
          status: payload.status === 'error' || payload.status === 'timeout' ? 'failed' : payload.status,
          durationMs: payload.durationMs,
          screenshotPath,
          screenshots: [], // Will be populated from saved screenshots
          errorMessage: payload.error?.message,
        };
      }
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  // Timeout - return failed result
  return {
    testId,
    status: 'failed',
    durationMs: timeout,
    screenshots: [],
    errorMessage: `Test execution timed out after ${timeout}ms`,
  };
}

/**
 * Save base64 screenshot to filesystem.
 */
async function saveScreenshotFromBase64(
  base64Data: string,
  filename: string,
  repositoryId?: string | null
): Promise<string> {
  const baseDir = './public/screenshots';
  const dir = repositoryId ? path.join(baseDir, repositoryId) : baseDir;

  // Ensure directory exists
  await fs.mkdir(dir, { recursive: true });

  const filePath = path.join(dir, filename);
  const buffer = Buffer.from(base64Data, 'base64');
  await fs.writeFile(filePath, buffer);

  // Return public path
  return repositoryId ? `/screenshots/${repositoryId}/${filename}` : `/screenshots/${filename}`;
}

/**
 * Get an available agent for a team.
 */
async function getAvailableAgent(teamId: string) {
  // First try the in-memory registry (WebSocket connections)
  const wsAgent = agentRegistry.getAvailableAgent(teamId);
  if (wsAgent) {
    return { id: wsAgent.agentId, status: wsAgent.status };
  }

  // Fall back to database (polling agents)
  const dbAgent = await db
    .select()
    .from(agents)
    .where(and(eq(agents.teamId, teamId), eq(agents.status, 'online')))
    .limit(1)
    .get();

  return dbAgent;
}

/**
 * Check if an agent is available for a team.
 */
export async function hasAvailableAgent(teamId: string): Promise<boolean> {
  const agent = await getAvailableAgent(teamId);
  return !!agent;
}

/**
 * Get execution mode information for display.
 */
export function getExecutionModeInfo(): {
  mode: 'local' | 'agent';
  description: string;
} {
  const mode = getExecutionMode();
  return {
    mode,
    description:
      mode === 'local'
        ? 'Tests run directly on this machine using Playwright'
        : 'Tests run on a remote agent connected to this server',
  };
}
