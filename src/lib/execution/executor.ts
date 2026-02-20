/**
 * Test Executor
 *
 * Unified interface for test execution that routes through either:
 * - Local Playwright runner (development, self-hosted)
 * - Remote runner (cloud deployment)
 *
 * Mode is determined by EXECUTION_MODE env variable or auto-detected.
 */

import { getExecutionMode, shouldUseLocalRunner } from './mode';
import { getRunner, type TestRunResult, type ProgressCallback } from '@/lib/playwright/runner';
import type { Test, EnvironmentConfig, PlaywrightSettings } from '@/lib/db/schema';
import type {
  RunTestCommand,
  ScreenshotUploadResponse,
} from '@/lib/ws/protocol';
import { createMessage } from '@/lib/ws/protocol';
import { queueCommand, getTestResults, getScreenshots } from '@/app/api/ws/runner/route';
import { runnerRegistry } from '@/lib/ws/runner-registry';
import { db } from '@/lib/db';
import { runners, tests as testsTable } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { createHash } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { STORAGE_DIRS } from '@/lib/storage/paths';

/**
 * Generate SHA256 hash of test code for integrity verification.
 */
function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

export interface ExecutionOptions {
  repositoryId?: string | null;
  teamId?: string;
  forceLocal?: boolean;
  headless?: boolean;
  environmentConfig?: EnvironmentConfig | null;
  playwrightSettings?: PlaywrightSettings | null;
  runnerId?: string; // 'local' or specific runner ID - if set, overrides mode detection
  maxParallelTests?: number; // Override parallel test setting (used for remote runners)
  setupContext?: { storageState?: string; variables?: Record<string, unknown> }; // Auth session + variables from setup scripts
  forceVideoRecording?: boolean; // Force video recording for this run regardless of global setting
}

export interface ExecutionProgress {
  completed: number;
  total: number;
  currentTestName?: string;
  currentStep?: string;
  activeCount?: number;
  activeTests?: string[];
}

/**
 * Execute tests using the appropriate runner (local or remote runner).
 */
export async function executeTests(
  tests: Test[],
  runId: string,
  options: ExecutionOptions,
  onProgress?: (progress: ExecutionProgress) => void,
  onResult?: (result: TestRunResult) => Promise<void>
): Promise<TestRunResult[]> {
  // If explicit runnerId is provided, use that routing
  if (options.runnerId) {
    if (options.runnerId === 'local') {
      console.log('Execution target: local (explicit)');
      return executeLocally(tests, runId, options, onProgress, onResult);
    }

    // Explicit runner ID provided - verify runner is available
    if (options.teamId) {
      const runner = await getAvailableRunnerById(options.teamId, options.runnerId);
      if (runner) {
        console.log(`Execution target: runner ${runner.id} (explicit)`);
        return executeViaRunner(tests, runId, runner.id, options, onProgress, onResult);
      }
      console.warn(`Runner ${options.runnerId} not available, falling back to local`);
    } else {
      console.warn('No teamId provided for runner execution, falling back to local');
    }
    return executeLocally(tests, runId, options, onProgress, onResult);
  }

  // Auto-detect mode (legacy behavior)
  const mode = getExecutionMode();
  const useLocal = shouldUseLocalRunner(options.forceLocal);

  console.log(`Execution mode: ${mode}, using local: ${useLocal}`);

  if (useLocal) {
    return executeLocally(tests, runId, options, onProgress, onResult);
  }

  // Runner mode requires teamId
  if (!options.teamId) {
    console.warn('No teamId provided for runner mode, falling back to local');
    return executeLocally(tests, runId, options, onProgress, onResult);
  }

  // Check if runner is available
  const runner = await getAvailableRunner(options.teamId);
  if (!runner) {
    console.warn('No runner available, falling back to local');
    return executeLocally(tests, runId, options, onProgress, onResult);
  }

  return executeViaRunner(tests, runId, runner.id, options, onProgress, onResult);
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
          activeCount: p.activeCount,
          activeTests: p.activeTests,
        });
      }
    : undefined;

  // maxParallelTests from settings is used by runner internally, but can be overridden
  return runner.runTests(tests, runId, progressCallback, onResult, options.headless, options.maxParallelTests, options.forceVideoRecording);
}

/**
 * Execute tests via remote runner.
 */
async function executeViaRunner(
  tests: Test[],
  runId: string,
  runnerId: string,
  options: ExecutionOptions,
  onProgress?: (progress: ExecutionProgress) => void,
  onResult?: (result: TestRunResult) => Promise<void>
): Promise<TestRunResult[]> {
  const results: TestRunResult[] = [];
  const baseUrl = (options.environmentConfig?.baseUrl || 'http://localhost:3000').replace(/\/+$/, '');
  const viewport = options.playwrightSettings
    ? {
        width: options.playwrightSettings.viewportWidth || 1280,
        height: options.playwrightSettings.viewportHeight || 720,
      }
    : undefined;

  const maxParallel = options.maxParallelTests ?? 1;
  const pending = [...tests];
  // Track in-flight tests: commandId → { testId, testName, startTime }
  const inFlight = new Map<string, { testId: string; testName: string; startTime: number }>();
  let completedCount = 0;
  const baseTimeout = options.playwrightSettings?.navigationTimeout || 120000;
  // Scale timeout for concurrency — parallel tests compete for resources
  const testTimeout = Math.max(baseTimeout * maxParallel, 300000);
  const pollInterval = 1000;

  const updateProgress = () => {
    const activeTests = [...inFlight.values()].map(r => r.testName);
    onProgress?.({
      completed: completedCount,
      total: tests.length,
      currentTestName: activeTests[0],
      activeCount: inFlight.size,
      activeTests,
    });
  };

  // Fill slots by validating, creating commands, and queuing them
  const fillSlots = async () => {
    while (inFlight.size < maxParallel && pending.length > 0) {
      const test = pending.shift()!;

      // Validate test exists in database and code matches (prevents fake testId injection)
      const dbTest = await db.query.tests.findFirst({
        where: eq(testsTable.id, test.id),
        columns: { id: true, code: true }
      });

      if (!dbTest || dbTest.code !== test.code) {
        console.error(`[Executor] Test ${test.id} not found or code mismatch`);
        results.push({
          testId: test.id,
          status: 'failed',
          durationMs: 0,
          screenshots: [],
          errorMessage: `Test validation failed: test not found or code mismatch`,
        });
        completedCount++;
        continue;
      }

      // Create run_test command with code hash for integrity verification
      const command = createMessage<RunTestCommand>('command:run_test', {
        testId: test.id,
        testRunId: runId,
        code: test.code,
        codeHash: hashCode(test.code),
        targetUrl: baseUrl,
        screenshotPath: `${runId}-${test.id}.png`,
        timeout: options.playwrightSettings?.navigationTimeout || 30000,
        repositoryId: options.repositoryId || undefined,
        viewport,
        storageState: options.setupContext?.storageState,
        setupVariables: options.setupContext?.variables,
      });

      // Queue command for runner (polling mode)
      queueCommand(runnerId, command);
      inFlight.set(command.id, { testId: test.id, testName: test.name, startTime: Date.now() });
    }
  };

  await fillSlots();
  updateProgress();

  // Single polling loop — avoids race condition where multiple pollers drain shared result queues
  while (inFlight.size > 0) {
    await new Promise((resolve) => setTimeout(resolve, pollInterval));

    // Process screenshots — match by correlationId to in-flight commands
    const screenshots = getScreenshots(runnerId);
    for (const screenshot of screenshots) {
      if (screenshot.type === 'response:screenshot') {
        const payload = (screenshot as ScreenshotUploadResponse).payload;
        if (inFlight.has(payload.correlationId)) {
          console.log(`[Executor] Saving screenshot: ${payload.filename}`);
          await saveScreenshotFromBase64(payload.data, payload.filename, options.repositoryId);
        }
      }
    }

    // Process test results — match by correlationId and dispatch
    const testResults = getTestResults(runnerId);
    for (const result of testResults) {
      const commandId = result.payload.correlationId;
      const info = inFlight.get(commandId);
      if (!info) continue;

      inFlight.delete(commandId);
      completedCount++;

      const payload = result.payload;

      // Save error screenshot if present
      let screenshotPath: string | undefined;
      if (payload.error?.screenshot) {
        const filename = `${runId}-${info.testId}-failure.png`;
        screenshotPath = await saveScreenshotFromBase64(payload.error.screenshot, filename, options.repositoryId);
      }

      const diskScreenshots = await findScreenshotsOnDisk(runId, info.testId, options.repositoryId);

      const testResult: TestRunResult = {
        testId: payload.testId,
        status: payload.status === 'error' || payload.status === 'timeout' || payload.status === 'cancelled' ? 'failed' : payload.status,
        durationMs: payload.durationMs,
        screenshotPath: screenshotPath || diskScreenshots[0]?.path,
        screenshots: diskScreenshots,
        errorMessage: payload.error?.message,
      };
      results.push(testResult);
      await onResult?.(testResult);
    }

    // Check for timeouts
    for (const [commandId, info] of inFlight) {
      if (Date.now() - info.startTime > testTimeout) {
        console.error(`[Executor] Test ${info.testId} timed out after ${testTimeout}ms`);
        inFlight.delete(commandId);
        completedCount++;
        const timeoutResult: TestRunResult = {
          testId: info.testId,
          status: 'failed',
          durationMs: testTimeout,
          screenshots: [],
          errorMessage: `Test execution timed out after ${testTimeout}ms`,
        };
        results.push(timeoutResult);
        await onResult?.(timeoutResult);
      }
    }

    // Fill more slots if any completed
    await fillSlots();
    updateProgress();
  }

  return results;
}

/**
 * Save base64 screenshot to filesystem.
 */
async function saveScreenshotFromBase64(
  base64Data: string,
  filename: string,
  repositoryId?: string | null
): Promise<string> {
  const baseDir = STORAGE_DIRS.screenshots;
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
 * Find screenshots saved to disk by the route handler.
 * Screenshots are saved with pattern: {runId}-{testId}-{label}.png
 * Checks both repository subfolder and root screenshots folder (for remote runner uploads).
 */
async function findScreenshotsOnDisk(
  runId: string,
  testId: string,
  repositoryId?: string | null
): Promise<{ path: string; label: string }[]> {
  const baseDir = STORAGE_DIRS.screenshots;
  const screenshots: { path: string; label: string }[] = [];
  const prefix = `${runId}-${testId}-`;

  // Check repository-specific directory first
  if (repositoryId) {
    const repoDir = path.join(baseDir, repositoryId);
    try {
      const files = await fs.readdir(repoDir);
      for (const f of files) {
        if (f.startsWith(prefix) && f.endsWith('.png')) {
          const label = f.replace(prefix, '').replace('.png', '');
          screenshots.push({ path: `/screenshots/${repositoryId}/${f}`, label });
        }
      }
    } catch {
      // Directory might not exist
    }
  }

  // Also check root screenshots directory (for remote runner uploads)
  try {
    const files = await fs.readdir(baseDir);
    for (const f of files) {
      if (f.startsWith(prefix) && f.endsWith('.png')) {
        const label = f.replace(prefix, '').replace('.png', '');
        const publicPath = `/screenshots/${f}`;
        // Avoid duplicates
        if (!screenshots.some(s => s.label === label)) {
          screenshots.push({ path: publicPath, label });
        }
      }
    }
  } catch {
    // Directory might not exist
  }

  if (screenshots.length > 0) {
    console.log(`[Executor] Found ${screenshots.length} screenshots on disk for ${testId}`);
  }

  return screenshots;
}

/**
 * Get an available runner for a team.
 */
async function getAvailableRunner(teamId: string) {
  // First try the in-memory registry (WebSocket connections)
  const wsRunner = runnerRegistry.getAvailableRunner(teamId);
  if (wsRunner) {
    return { id: wsRunner.runnerId, status: wsRunner.status };
  }

  // Fall back to database (polling runners)
  const dbRunner = await db
    .select()
    .from(runners)
    .where(and(eq(runners.teamId, teamId), eq(runners.status, 'online')))
    .limit(1)
    .get();

  return dbRunner;
}

/**
 * Get a specific runner by ID if it's available.
 */
async function getAvailableRunnerById(teamId: string, runnerId: string) {
  // First try the in-memory registry (WebSocket connections)
  const wsRunner = runnerRegistry.getRunner(runnerId);
  if (wsRunner && wsRunner.teamId === teamId && wsRunner.status !== 'offline') {
    return { id: wsRunner.runnerId, status: wsRunner.status };
  }

  // Fall back to database (polling runners)
  const dbRunner = await db
    .select()
    .from(runners)
    .where(and(eq(runners.id, runnerId), eq(runners.teamId, teamId), eq(runners.status, 'online')))
    .get();

  return dbRunner;
}

/**
 * Check if a runner is available for a team.
 */
export async function hasAvailableRunner(teamId: string): Promise<boolean> {
  const runner = await getAvailableRunner(teamId);
  return !!runner;
}

/**
 * Get execution mode information for display.
 */
export function getExecutionModeInfo(): {
  mode: 'local' | 'runner';
  description: string;
} {
  const mode = getExecutionMode();
  return {
    mode,
    description:
      mode === 'local'
        ? 'Tests run directly on this machine using Playwright'
        : 'Tests run on a remote runner connected to this server',
  };
}
