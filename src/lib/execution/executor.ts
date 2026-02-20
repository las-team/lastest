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
} from '@/lib/ws/protocol';
import { createMessage } from '@/lib/ws/protocol';
import { queueCommandToDB, queueCancelCommandToDB } from '@/app/api/ws/runner/route';
import { runnerRegistry } from '@/lib/ws/runner-registry';
import { db } from '@/lib/db';
import { runners, tests as testsTable, backgroundJobs } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { createHash } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { STORAGE_DIRS } from '@/lib/storage/paths';
import {
  getCommandsByTestRun,
  getUnacknowledgedResults,
  acknowledgeResults,
} from '@/lib/db/queries';

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
  jobId?: string; // Background job ID for cancellation checks
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
 * Commands are queued to the DB. The runner claims them on heartbeat.
 * Executor polls the DB for completion and results.
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
  let cancelled = false;
  const baseTimeout = options.playwrightSettings?.navigationTimeout || 120000;
  // Scale timeout for concurrency — parallel tests compete for resources
  const testTimeout = Math.max(baseTimeout * maxParallel, 300000);
  const pollInterval = 1000;

  // Check if the background job has been cancelled
  const checkCancelled = async (): Promise<boolean> => {
    if (!options.jobId) return false;
    const job = await db.query.backgroundJobs.findFirst({
      where: eq(backgroundJobs.id, options.jobId),
      columns: { status: true, error: true },
    });
    return job?.error === 'Cancelled by user' || job?.status === 'failed';
  };

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

  // Fill slots by validating, creating commands, and queuing them to DB
  const fillSlots = async () => {
    if (cancelled) return;
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
        timeout: testTimeout,
        repositoryId: options.repositoryId || undefined,
        viewport,
        storageState: options.setupContext?.storageState,
        setupVariables: options.setupContext?.variables,
      });

      // Queue command to DB
      await queueCommandToDB(runnerId, command);
      inFlight.set(command.id, { testId: test.id, testName: test.name, startTime: Date.now() });
    }
  };

  await fillSlots();
  updateProgress();

  // Poll DB for command completion and results
  while (inFlight.size > 0) {
    await new Promise((resolve) => setTimeout(resolve, pollInterval));

    // Check if the job was cancelled — stop launching new tests and drain in-flight
    if (!cancelled && await checkCancelled()) {
      cancelled = true;
      // Clear pending so no more tests get queued
      pending.length = 0;
      // Send cancel to the remote runner for in-flight tests
      await queueCancelCommandToDB(runnerId, runId, 'Cancelled by user');
      // Mark remaining in-flight as failed and break out
      for (const [commandId, info] of inFlight) {
        inFlight.delete(commandId);
        completedCount++;
        results.push({
          testId: info.testId,
          status: 'failed',
          durationMs: 0,
          screenshots: [],
          errorMessage: 'Cancelled by user',
        });
      }
      break;
    }

    // Check command statuses in DB
    const dbCommands = await getCommandsByTestRun(runId);

    for (const dbCmd of dbCommands) {
      const info = inFlight.get(dbCmd.id);
      if (!info) continue;

      // Only process completed/failed commands
      if (dbCmd.status !== 'completed' && dbCmd.status !== 'failed' && dbCmd.status !== 'timeout') {
        continue;
      }

      // Get unacknowledged results for this command
      const unacked = await getUnacknowledgedResults([dbCmd.id]);
      const testResultMsg = unacked.find(r => r.type === 'response:test_result');

      if (!testResultMsg && dbCmd.status !== 'timeout') {
        // Result not yet stored — wait for next poll
        continue;
      }

      inFlight.delete(dbCmd.id);
      completedCount++;

      if (dbCmd.status === 'timeout') {
        // Timed out — no result payload
        const timeoutResult: TestRunResult = {
          testId: info.testId,
          status: 'failed',
          durationMs: testTimeout,
          screenshots: [],
          errorMessage: `Test execution timed out`,
        };
        results.push(timeoutResult);
        await onResult?.(timeoutResult);
        continue;
      }

      // Parse the test result payload
      const payload = testResultMsg!.payload as Record<string, unknown>;
      const errorPayload = payload.error as Record<string, unknown> | undefined;

      // Find screenshots on disk (already saved by route handler)
      const diskScreenshots = await findScreenshotsOnDisk(runId, info.testId, options.repositoryId);

      const testResult: TestRunResult = {
        testId: (payload.testId as string) || info.testId,
        status: payload.status === 'error' || payload.status === 'timeout' || payload.status === 'cancelled' ? 'failed' : (payload.status as 'passed' | 'failed'),
        durationMs: (payload.durationMs as number) || 0,
        screenshotPath: diskScreenshots[0]?.path,
        screenshots: diskScreenshots,
        errorMessage: errorPayload?.message as string | undefined,
        softErrors: Array.isArray(payload.softErrors) && payload.softErrors.length > 0 ? payload.softErrors as string[] : undefined,
      };
      results.push(testResult);
      await onResult?.(testResult);

      // Acknowledge all results for this command
      const resultIds = unacked.map(r => r.id);
      if (resultIds.length > 0) {
        await acknowledgeResults(resultIds);
      }
    }

    // Check for timeouts
    for (const [commandId, info] of inFlight) {
      if (Date.now() - info.startTime > testTimeout) {
        console.error(`[Executor] Test ${info.testId} timed out after ${testTimeout}ms`);
        // Cancel the stale test on the runner so it frees resources
        await queueCancelCommandToDB(runnerId, runId, `Server-side timeout after ${testTimeout}ms`);
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
          const label = f.replace(prefix, '').replace('.png', '').replace(/_/g, ' ');
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
        const label = f.replace(prefix, '').replace('.png', '').replace(/_/g, ' ');
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
