/**
 * Test Executor
 *
 * Unified interface for test execution that routes through either:
 * - Local Playwright runner (development, self-hosted)
 * - Remote runner (cloud deployment)
 *
 * Mode is determined by EXECUTION_MODE env variable or auto-detected.
 */

import { getExecutionMode, shouldUseLocalRunner, isLocalDisabled } from './mode';
import { getRunner, type TestRunResult, type ProgressCallback } from '@/lib/playwright/runner';
import type { Test, EnvironmentConfig, PlaywrightSettings, StabilizationSettings } from '@/lib/db/schema';
import { DEFAULT_STABILIZATION_SETTINGS } from '@/lib/db/schema';
import type {
  RunTestCommand,
  RunSetupCommand,
  StabilizationPayload,
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
import { getCrossOsFontCSS } from '@lastest/shared';
import {
  getCommandsByTestRun,
  getUnacknowledgedResults,
  acknowledgeResults,
  getRunnerCommandById,
  getTestFixtures,
} from '@/lib/db/queries';

/**
 * Generate SHA256 hash of test code for integrity verification.
 */
function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

/**
 * Build a StabilizationPayload from PlaywrightSettings for remote runners.
 */
function buildStabilizationPayload(settings?: PlaywrightSettings | null, testOverrides?: Partial<StabilizationSettings> | null): StabilizationPayload | undefined {
  if (!settings?.stabilization && !testOverrides) return undefined;
  const stab = { ...(settings?.stabilization || DEFAULT_STABILIZATION_SETTINGS), ...testOverrides };
  return {
    freezeTimestamps: stab.freezeTimestamps,
    frozenTimestamp: stab.frozenTimestamp,
    freezeRandomValues: stab.freezeRandomValues,
    randomSeed: stab.randomSeed,
    freezeAnimations: testOverrides?.freezeAnimations ?? settings?.freezeAnimations ?? false,
    crossOsConsistency: stab.crossOsConsistency,
    waitForNetworkIdle: stab.waitForNetworkIdle,
    networkIdleTimeout: stab.networkIdleTimeout,
    waitForDomStable: stab.waitForDomStable,
    domStableTimeout: stab.domStableTimeout,
    waitForFonts: stab.waitForFonts,
    waitForImages: stab.waitForImages,
    waitForImagesTimeout: stab.waitForImagesTimeout,
    ...(stab.crossOsConsistency ? { crossOsFontCSS: getCrossOsFontCSS() } : {}),
    waitForCanvasStable: stab.waitForCanvasStable,
    canvasStableTimeout: stab.canvasStableTimeout,
    canvasStableThreshold: stab.canvasStableThreshold,
    disableImageSmoothing: stab.disableImageSmoothing,
    roundCanvasCoordinates: stab.roundCanvasCoordinates,
    reseedRandomOnInput: stab.reseedRandomOnInput,
  };
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
  setupInfo?: { code: string; setupId: string }; // Setup code to run on remote runner before tests
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
  const localDisabled = isLocalDisabled();

  // If explicit runnerId is provided, use that routing
  if (options.runnerId) {
    if (options.runnerId === 'local') {
      if (localDisabled) {
        console.warn('Local runner disabled, redirecting to fallback chain');
        return executeFallbackChain(tests, runId, options, onProgress, onResult);
      }
      console.log('Execution target: local (explicit)');
      return executeLocally(tests, runId, options, onProgress, onResult);
    }

    if (options.runnerId === 'auto') {
      console.log('Execution target: auto (fallback chain)');
      return executeFallbackChain(tests, runId, options, onProgress, onResult);
    }

    // Explicit runner ID provided - verify runner is available
    if (options.teamId) {
      const runner = await getAvailableRunnerById(options.teamId, options.runnerId);
      if (runner) {
        console.log(`Execution target: runner ${runner.id} (explicit)`);
        return executeViaRunner(tests, runId, runner.id, options, onProgress, onResult);
      }
      // Also check system runners (cross-team)
      const sysRunner = await getAvailableSystemRunnerById(options.runnerId);
      if (sysRunner) {
        console.log(`Execution target: system runner ${sysRunner.id} (explicit)`);
        return executeViaRunner(tests, runId, sysRunner.id, options, onProgress, onResult);
      }
      console.warn(`Runner ${options.runnerId} not available, using fallback chain`);
    } else {
      console.warn('No teamId provided for runner execution, using fallback chain');
    }

    if (localDisabled) {
      return executeFallbackChain(tests, runId, options, onProgress, onResult);
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
    if (localDisabled) {
      console.warn('No teamId provided and local disabled, using fallback chain');
      return executeFallbackChain(tests, runId, options, onProgress, onResult);
    }
    console.warn('No teamId provided for runner mode, falling back to local');
    return executeLocally(tests, runId, options, onProgress, onResult);
  }

  // Check if team runner is available
  const runner = await getAvailableRunner(options.teamId);
  if (runner) {
    return executeViaRunner(tests, runId, runner.id, options, onProgress, onResult);
  }

  // No team runner — use fallback chain if local disabled
  if (localDisabled) {
    return executeFallbackChain(tests, runId, options, onProgress, onResult);
  }

  console.warn('No runner available, falling back to local');
  return executeLocally(tests, runId, options, onProgress, onResult);
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
  // Split tests into procedural and agent-mode
  const proceduralTests = tests.filter(t => t.executionMode !== 'agent');
  const agentTests = tests.filter(t => t.executionMode === 'agent');

  const allResults: TestRunResult[] = [];

  // Execute agent-mode tests via the agent executor
  if (agentTests.length > 0) {
    const { executeAgentTest } = await import('@/lib/playwright/agent-executor');
    const baseUrl = options.environmentConfig?.baseUrl || 'http://localhost:3000';

    for (const test of agentTests) {
      onProgress?.({
        completed: allResults.length,
        total: tests.length,
        currentTestName: test.name,
        activeCount: 1,
        activeTests: [test.name],
      });

      const screenshotPath = test.id; // Runner normalizes this
      const agentResult = await executeAgentTest(test, {
        baseUrl,
        screenshotPath,
        setupCode: options.setupContext?.storageState ? undefined : undefined,
        timeout: options.playwrightSettings?.timeout ?? 300_000,
        headless: options.headless,
      });

      const result: TestRunResult = {
        testId: agentResult.testId,
        status: agentResult.status === 'error' ? 'failed' : agentResult.status,
        durationMs: agentResult.duration,
        screenshots: agentResult.screenshots,
        errorMessage: agentResult.errorMessage,
      };

      allResults.push(result);
      if (onResult) await onResult(result);
    }
  }

  // Execute procedural tests via the standard runner
  if (proceduralTests.length > 0) {
    const runner = getRunner(options.repositoryId);

    if (options.environmentConfig) {
      runner.setEnvironmentConfig(options.environmentConfig);
    }
    if (options.playwrightSettings) {
      runner.setSettings(options.playwrightSettings);
    }

    const progressCallback = onProgress
      ? (p: ProgressCallback) => {
          onProgress({
            completed: allResults.length + p.completed,
            total: tests.length,
            currentTestName: p.currentTestName,
            activeCount: p.activeCount,
            activeTests: p.activeTests,
          });
        }
      : undefined;

    const proceduralResults = await runner.runTests(proceduralTests, runId, progressCallback, onResult, options.headless, options.maxParallelTests, options.forceVideoRecording);
    allResults.push(...proceduralResults);
  }

  return allResults;
}

/**
 * Execute setup on a remote runner before tests.
 * Queues a command:run_setup to the DB, polls for completion, and returns storageState.
 */
export async function executeSetupViaRunner(
  setupCode: string,
  setupId: string,
  runnerId: string,
  baseUrl: string,
  viewport?: { width: number; height: number },
  timeout?: number,
  playwrightSettings?: PlaywrightSettings | null,
  browser?: 'chromium' | 'firefox' | 'webkit',
): Promise<{ storageState?: string; variables?: Record<string, unknown> }> {
  const setupTimeout = timeout || 120000;

  const command = createMessage<RunSetupCommand>('command:run_setup', {
    setupId,
    code: setupCode,
    codeHash: hashCode(setupCode),
    targetUrl: baseUrl,
    timeout: setupTimeout,
    viewport,
    stabilization: buildStabilizationPayload(playwrightSettings),
    browser,
  });

  console.log(`[Executor] Queuing setup command ${command.id.slice(0, 8)} for runner ${runnerId}`);
  await queueCommandToDB(runnerId, command);

  // Poll DB for setup completion with adaptive interval (starts fast, backs off)
  let pollInterval = 250;
  const maxPollInterval = 500;
  const maxWait = setupTimeout + 30000; // Allow extra time for network overhead
  const startTime = Date.now();

  while (Date.now() - startTime < maxWait) {
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
    pollInterval = Math.min(pollInterval + 100, maxPollInterval);

    const dbCmd = await getRunnerCommandById(command.id);
    if (!dbCmd) continue;

    if (dbCmd.status === 'completed' || dbCmd.status === 'failed' || dbCmd.status === 'timeout') {
      // Get the result
      const results = await getUnacknowledgedResults([command.id]);
      const setupResult = results.find(r => r.type === 'response:setup_result');

      if (setupResult) {
        await acknowledgeResults(results.map(r => r.id));
        const payload = setupResult.payload as Record<string, unknown>;

        if (payload.status === 'passed') {
          console.log(`[Executor] Setup completed successfully on runner ${runnerId}`);
          return {
            storageState: payload.storageState as string | undefined,
            variables: payload.variables as Record<string, unknown> | undefined,
          };
        } else {
          throw new Error(`Remote setup failed: ${payload.error || 'Unknown error'}`);
        }
      }

      if (dbCmd.status === 'timeout') {
        throw new Error('Remote setup timed out');
      }

      if (dbCmd.status === 'failed') {
        throw new Error('Remote setup command failed');
      }
    }
  }

  throw new Error(`Remote setup polling timed out after ${maxWait}ms`);
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

  // Run setup on runner first if setupInfo is provided (remote setup)
  if (options.setupInfo) {
    console.log(`[Executor] Running setup on remote runner ${runnerId} before tests...`);
    const setupResult = await executeSetupViaRunner(
      options.setupInfo.code,
      options.setupInfo.setupId,
      runnerId,
      baseUrl,
      viewport,
      options.playwrightSettings?.navigationTimeout ?? undefined,
      options.playwrightSettings,
    );
    // Merge remote setup results into setupContext for test commands
    options.setupContext = {
      storageState: setupResult.storageState ?? options.setupContext?.storageState,
      variables: { ...options.setupContext?.variables, ...setupResult.variables },
    };
    console.log(`[Executor] Remote setup complete, storageState: ${setupResult.storageState ? 'yes' : 'no'}`);
  }

  // Load runner's maxParallelTests from DB if not provided in options
  let maxParallel = options.maxParallelTests ?? 1;
  if (!options.maxParallelTests) {
    const runnerRecord = await db.select({ maxParallelTests: runners.maxParallelTests }).from(runners).where(eq(runners.id, runnerId)).get();
    if (runnerRecord?.maxParallelTests) {
      maxParallel = runnerRecord.maxParallelTests;
    }
  }
  const pending = [...tests];
  // Track in-flight tests: commandId → { testId, testName, startTime }
  const inFlight = new Map<string, { testId: string; testName: string; startTime: number; completedSeenAt?: number }>();
  let completedCount = 0;
  let cancelled = false;
  const baseTimeout = options.playwrightSettings?.navigationTimeout || 120000;
  // Scale timeout for concurrency — parallel tests compete for resources
  const testTimeout = Math.max(baseTimeout * maxParallel, 300000);
  let pollInterval = 250;
  const maxPollInterval = 500;

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

      // Load test fixtures from DB and base64 encode for remote transfer
      const testFixtureRecords = await getTestFixtures(test.id);
      const fixturePayloads: Array<{ filename: string; data: string }> = [];
      for (const fixture of testFixtureRecords) {
        try {
          const absPath = path.join(STORAGE_DIRS.fixtures, fixture.storagePath.replace(/^\/fixtures\//, ''));
          const fileData = await fs.readFile(absPath);
          fixturePayloads.push({ filename: fixture.filename, data: fileData.toString('base64') });
        } catch (err) {
          console.warn(`[Executor] Failed to read fixture ${fixture.filename}: ${err}`);
        }
      }

      // Create run_test command with code hash for integrity verification
      // Per-test playwright overrides
      const pwOverrides = test.playwrightOverrides;
      const effectiveBrowser = pwOverrides?.browser ?? ((options.playwrightSettings?.browser as 'chromium' | 'firefox' | 'webkit') || undefined);
      const effectiveBaseUrl = pwOverrides?.baseUrl ?? baseUrl;
      const effectiveTimeout = pwOverrides?.navigationTimeout ?? testTimeout;

      const command = createMessage<RunTestCommand>('command:run_test', {
        testId: test.id,
        testRunId: runId,
        code: test.code,
        codeHash: hashCode(test.code),
        targetUrl: effectiveBaseUrl,
        screenshotPath: `${runId}-${test.id}.png`,
        timeout: effectiveTimeout,
        repositoryId: options.repositoryId || undefined,
        viewport: test.viewportOverride || viewport,
        storageState: options.setupContext?.storageState,
        setupVariables: options.setupContext?.variables,
        cursorPlaybackSpeed: pwOverrides?.cursorPlaybackSpeed ?? options.playwrightSettings?.cursorPlaybackSpeed ?? 1,
        stabilization: buildStabilizationPayload(options.playwrightSettings, test.stabilizationOverrides),
        browser: effectiveBrowser,
        fixtures: fixturePayloads,
        grantClipboardAccess: options.playwrightSettings?.grantClipboardAccess ?? false,
        acceptDownloads: options.playwrightSettings?.acceptDownloads ?? false,
        headed: options.headless === false,
      });

      // Queue command to DB
      await queueCommandToDB(runnerId, command);
      inFlight.set(command.id, { testId: test.id, testName: test.name, startTime: Date.now() });
    }
  };

  await fillSlots();
  updateProgress();

  // Poll DB for command completion and results
  let prevCompletedCount = completedCount;
  while (inFlight.size > 0) {
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
    pollInterval = Math.min(pollInterval + 100, maxPollInterval);

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

      if (dbCmd.status === 'timeout') {
        inFlight.delete(dbCmd.id);
        completedCount++;
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

      // Screenshots are uploaded AFTER the test result, so they may not be here yet.
      // If the runner reported screenshotCount, proceed as soon as all arrive.
      // Otherwise fall back to a 10s timeout for backward compatibility with older runners.
      const screenshotResults = unacked.filter(r => r.type === 'response:screenshot');
      const expectedCount = typeof payload.screenshotCount === 'number' ? payload.screenshotCount : undefined;
      const allScreenshotsReceived = expectedCount !== undefined && screenshotResults.length >= expectedCount;

      if (payload.status === 'passed' && !allScreenshotsReceived && expectedCount !== 0) {
        if (!info.completedSeenAt) {
          info.completedSeenAt = Date.now();
          continue; // Wait for screenshots on next poll
        }
        if (Date.now() - info.completedSeenAt < 10_000) {
          continue; // Still waiting for screenshots
        }
        // Exceeded 10s — process anyway with whatever we have
      }

      inFlight.delete(dbCmd.id);
      completedCount++;

      // Sort by capturedAt to restore capture order (parallel uploads arrive out of order)
      const sortedScreenshots = [...screenshotResults].sort((a, b) => {
        const aPayload = a.payload as Record<string, unknown>;
        const bPayload = b.payload as Record<string, unknown>;
        return ((aPayload.capturedAt as number) || 0) - ((bPayload.capturedAt as number) || 0);
      });

      let allScreenshots: { path: string; label: string }[] = sortedScreenshots.map((r, idx) => {
        const sp = r.payload as Record<string, unknown>;
        // Extract step label from filename (e.g. "runId-testId-Step_3.png" → "Step 3")
        const filename = (sp.filename as string) || '';
        const stepMatch = filename.match(/Step_(\d+)/);
        const label = stepMatch ? `Step ${stepMatch[1]}` : `Step ${idx + 1}`;
        return { path: sp.path as string, label };
      });

      // Fallback to disk scan if no DB screenshot entries found
      if (allScreenshots.length === 0) {
        allScreenshots = await findScreenshotsOnDisk(runId, info.testId, options.repositoryId);
      }

      const testResult: TestRunResult = {
        testId: (payload.testId as string) || info.testId,
        status: payload.status === 'error' || payload.status === 'timeout' || payload.status === 'cancelled' ? 'failed' : (payload.status as 'passed' | 'failed'),
        durationMs: (payload.durationMs as number) || 0,
        screenshotPath: allScreenshots[0]?.path,
        screenshots: allScreenshots,
        errorMessage: errorPayload?.message as string | undefined,
        softErrors: Array.isArray(payload.softErrors) && payload.softErrors.length > 0 ? payload.softErrors as string[] : undefined,
      };
      results.push(testResult);
      await onResult?.(testResult);

      // Acknowledge all results for this command (including screenshot entries)
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

    // Reset poll interval for fast pickup when a test just completed
    if (completedCount > prevCompletedCount) {
      pollInterval = 250;
      prevCompletedCount = completedCount;
    }
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
 * Get an available system runner (isSystem=true, any team).
 * System EBs are host-provided and available to all teams.
 */
async function getAvailableSystemRunner() {
  const dbRunner = await db
    .select()
    .from(runners)
    .where(and(eq(runners.isSystem, true), eq(runners.status, 'online')))
    .limit(1)
    .get();

  return dbRunner;
}

/**
 * Get a specific system runner by ID if it's online.
 */
async function getAvailableSystemRunnerById(runnerId: string) {
  const dbRunner = await db
    .select()
    .from(runners)
    .where(and(eq(runners.id, runnerId), eq(runners.isSystem, true), eq(runners.status, 'online')))
    .get();

  return dbRunner;
}

/**
 * Fallback chain: team runner → system EB → queue.
 * Used when local execution is disabled (cloud deployment).
 */
async function executeFallbackChain(
  tests: Test[],
  runId: string,
  options: ExecutionOptions,
  onProgress?: (progress: ExecutionProgress) => void,
  onResult?: (result: TestRunResult) => Promise<void>
): Promise<TestRunResult[]> {
  // 1. Try team runner first
  if (options.teamId) {
    const teamRunner = await getAvailableRunner(options.teamId);
    if (teamRunner) {
      console.log(`Fallback chain: using team runner ${teamRunner.id}`);
      return executeViaRunner(tests, runId, teamRunner.id, options, onProgress, onResult);
    }
  }

  // 2. Try system EB
  const systemRunner = await getAvailableSystemRunner();
  if (systemRunner) {
    console.log(`Fallback chain: using system EB ${systemRunner.id}`);
    return executeViaRunner(tests, runId, systemRunner.id, options, onProgress, onResult);
  }

  // 3. Queue — return empty results with "skipped" status
  // The background job stays pending with targetRunnerId=null.
  // When a runner comes online, the job processor picks it up.
  console.log('Fallback chain: no runner available, tests queued for later execution');
  return tests.map((test) => ({
    testId: test.id,
    status: 'skipped' as const,
    durationMs: 0,
    screenshots: [],
    errorMessage: 'Queued: waiting for an available runner',
  }));
}

/**
 * Get execution mode information for display.
 */
export function getExecutionModeInfo(): {
  mode: 'local' | 'runner' | 'embedded';
  description: string;
} {
  const mode = getExecutionMode();
  const descriptions: Record<string, string> = {
    local: 'Tests run directly on this machine using Playwright',
    runner: 'Tests run on a remote runner connected to this server',
    embedded: 'Tests run in an embedded browser container with live streaming',
  };
  return {
    mode,
    description: descriptions[mode] ?? descriptions.runner,
  };
}
