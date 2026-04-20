/**
 * Test Executor
 *
 * Routes test execution through remote runners or embedded browsers.
 */

import type { TestRunResult } from '@/lib/playwright/types';
import type { Test, EnvironmentConfig, PlaywrightSettings, StabilizationSettings, NetworkRequest, DownloadRecord } from '@/lib/db/schema';
import { DEFAULT_STABILIZATION_SETTINGS } from '@/lib/db/schema';
import type {
  RunTestCommand,
  RunSetupCommand,
  StabilizationPayload,
} from '@/lib/ws/protocol';
import { createMessage } from '@/lib/ws/protocol';
import { queueCommandToDB, queueCancelCommandToDB } from '@/app/api/ws/runner/route';
import { getRecordingViewport } from '@/lib/db/queries';
import { runnerRegistry } from '@/lib/ws/runner-registry';
import { db } from '@/lib/db';
import { runners, tests as testsTable, backgroundJobs } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { createHash } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { STORAGE_DIRS, toRelativePath } from '@/lib/storage/paths';
import { getCrossOsFontCSS } from '@lastest/shared';
import {
  getCommandsByTestRun,
  getUnacknowledgedResults,
  acknowledgeResults,
  getRunnerCommandById,
  getTestFixtures,
} from '@/lib/db/queries';
import { isScreenshotBlankWhite } from '@/lib/diff/blank-detector';

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
  headless?: boolean;
  environmentConfig?: EnvironmentConfig | null;
  playwrightSettings?: PlaywrightSettings | null;
  runnerId?: string; // specific runner ID or 'auto' for fallback chain
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
 * Execute tests using the appropriate runner (remote runner or embedded browser).
 */
export async function executeTests(
  tests: Test[],
  runId: string,
  options: ExecutionOptions,
  onProgress?: (progress: ExecutionProgress) => void,
  onResult?: (result: TestRunResult) => Promise<void>
): Promise<TestRunResult[]> {
  // 'local' is no longer supported — redirect to fallback chain
  if (!options.runnerId || options.runnerId === 'local' || options.runnerId === 'auto') {
    console.log('Execution target: auto (fallback chain)');
    return executeFallbackChain(tests, runId, options, onProgress, onResult);
  }

  // Explicit runner ID provided - verify runner is available
  if (options.teamId) {
    const runner = await getAvailableRunnerById(options.teamId, options.runnerId);
    if (runner) {
      // If it's a system EB, redirect to pool-managed fallback chain
      if ('type' in runner && runner.type === 'embedded' && 'isSystem' in runner && runner.isSystem) {
        console.log(`Runner ${runner.id} is a pool EB, redirecting to auto`);
        return executeFallbackChain(tests, runId, options, onProgress, onResult);
      }
      console.log(`Execution target: runner ${runner.id} (explicit)`);
      return executeViaRunner(tests, runId, runner.id, options, onProgress, onResult);
    }
    // Also check system runners (cross-team) — redirect system EBs to pool
    const sysRunner = await getAvailableSystemRunnerById(options.runnerId);
    if (sysRunner) {
      // System runners that are embedded type are pool-managed
      if (sysRunner.type === 'embedded') {
        console.log(`System runner ${sysRunner.id} is a pool EB, redirecting to auto`);
        return executeFallbackChain(tests, runId, options, onProgress, onResult);
      }
      console.log(`Execution target: system runner ${sysRunner.id} (explicit)`);
      return executeViaRunner(tests, runId, sysRunner.id, options, onProgress, onResult);
    }
    console.warn(`Runner ${options.runnerId} not available, using fallback chain`);
  } else {
    console.warn('No teamId provided for runner execution, using fallback chain');
  }

  return executeFallbackChain(tests, runId, options, onProgress, onResult);
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

  let healthCheckCounter = 0;

  while (Date.now() - startTime < maxWait) {
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
    pollInterval = Math.min(pollInterval + 100, maxPollInterval);

    // Every ~5 polls, check if the runner is still online
    healthCheckCounter++;
    if (healthCheckCounter % 5 === 0) {
      const [runnerRow] = await db
        .select({ status: runners.status })
        .from(runners)
        .where(eq(runners.id, runnerId));
      if (runnerRow?.status === 'offline') {
        throw new Error(`Setup failed: Embedded browser went offline during setup (possible crash-loop). Check container logs for runner ${runnerId.slice(0, 8)}.`);
      }
    }

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
    const [runnerRecord] = await db.select({ maxParallelTests: runners.maxParallelTests }).from(runners).where(eq(runners.id, runnerId));
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
  // Scale timeout for concurrency — parallel tests compete for resources.
  // Floor of 10 min: under heavy pool concurrency (e.g. 30 EBs on one node),
  // Chromium gets CPU-starved and page.goto can take several minutes. A lower
  // floor caused healthy tests to be cancelled mid-run with `command:cancel_test`.
  const testTimeout = Math.max(baseTimeout * maxParallel, 600000);
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

      // Look up recording viewport for mismatch detection on remote runner
      let recordingViewport: { width: number; height: number } | undefined;
      try {
        const recVp = await getRecordingViewport(test.id);
        if (recVp?.viewportWidth && recVp?.viewportHeight) {
          recordingViewport = { width: recVp.viewportWidth, height: recVp.viewportHeight };
        }
      } catch {
        // Non-critical
      }

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
        consoleErrorMode: (options.playwrightSettings?.consoleErrorMode as 'fail' | 'warn' | 'ignore') || 'fail',
        networkErrorMode: (options.playwrightSettings?.networkErrorMode as 'fail' | 'warn' | 'ignore') || 'fail',
        ignoreExternalNetworkErrors: options.playwrightSettings?.ignoreExternalNetworkErrors ?? false,
        enableNetworkInterception: options.playwrightSettings?.enableNetworkInterception ?? false,
        browser: effectiveBrowser,
        fixtures: fixturePayloads,
        grantClipboardAccess: options.playwrightSettings?.grantClipboardAccess ?? false,
        acceptDownloads: options.playwrightSettings?.acceptDownloads ?? false,
        headed: options.headless === false,
        forceVideoRecording: options.forceVideoRecording || undefined,
        recordingViewport,
        lockViewportToRecording: options.playwrightSettings?.lockViewportToRecording ?? false,
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

      if (!testResultMsg && dbCmd.status !== 'timeout' && dbCmd.status !== 'failed') {
        // Result not yet stored — wait for next poll
        continue;
      }

      if (dbCmd.status === 'timeout' || (dbCmd.status === 'failed' && !testResultMsg)) {
        inFlight.delete(dbCmd.id);
        completedCount++;
        // No result payload — runner timed out or disconnected
        const errorMsg = dbCmd.status === 'timeout'
          ? `Test execution timed out`
          : `Runner disconnected during test execution`;
        const timeoutResult: TestRunResult = {
          testId: info.testId,
          status: 'failed',
          durationMs: Date.now() - info.startTime,
          screenshots: [],
          errorMessage: errorMsg,
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

      // Save video file if present in the result
      let videoPath: string | undefined;
      if (payload.videoPath) {
        // Video already saved to disk by the runner route handler
        videoPath = payload.videoPath as string;
      } else if (payload.videoData && payload.videoFilename) {
        try {
          const videoDir = path.join(STORAGE_DIRS.videos, options.repositoryId || 'default');
          await fs.mkdir(videoDir, { recursive: true });
          const videoDest = path.join(videoDir, payload.videoFilename as string);
          await fs.writeFile(videoDest, Buffer.from(payload.videoData as string, 'base64'));
          videoPath = toRelativePath(videoDest);
        } catch {
          // Video save is best-effort
        }
      }

      // Check for async network bodies file
      const networkBodiesResult = unacked.find(r => r.type === 'response:network_bodies');
      const networkBodiesPath = networkBodiesResult
        ? (networkBodiesResult.payload as Record<string, unknown>)?.path as string | undefined
        : undefined;

      const testResult: TestRunResult = {
        testId: (payload.testId as string) || info.testId,
        status: payload.status === 'error' || payload.status === 'timeout' || payload.status === 'cancelled' ? 'failed' : (payload.status as 'passed' | 'failed'),
        durationMs: (payload.durationMs as number) || 0,
        screenshotPath: allScreenshots[0]?.path,
        screenshots: allScreenshots,
        errorMessage: errorPayload?.message as string | undefined,
        consoleErrors: Array.isArray(payload.consoleErrors) && payload.consoleErrors.length > 0 ? payload.consoleErrors as string[] : undefined,
        networkRequests: Array.isArray(payload.networkRequests) && payload.networkRequests.length > 0 ? payload.networkRequests as NetworkRequest[] : undefined,
        downloads: Array.isArray(payload.downloads) && payload.downloads.length > 0 ? payload.downloads as DownloadRecord[] : undefined,
        softErrors: Array.isArray(payload.softErrors) && payload.softErrors.length > 0 ? payload.softErrors as string[] : undefined,
        videoPath,
        networkBodiesPath,
        domSnapshot: payload.domSnapshot as import('@/lib/db/schema').DomSnapshotData | undefined,
        lastReachedStep: typeof payload.lastReachedStep === 'number' ? payload.lastReachedStep : undefined,
        totalSteps: typeof payload.totalSteps === 'number' ? payload.totalSteps : undefined,
      };

      // Guardrail: a passed test whose screenshot is all-white is almost
      // certainly a race between navigation and capture under load (seen when
      // the EB pool saturates without setup). Surface it loudly instead of
      // letting it pollute baselines as a silent pass.
      if (testResult.status === 'passed' && allScreenshots[0]?.path) {
        try {
          if (await isScreenshotBlankWhite(allScreenshots[0].path)) {
            testResult.status = 'failed';
            testResult.errorMessage =
              'Screenshot is blank/white — navigation likely raced capture under pool pressure. Does this test need setup?';
          }
        } catch { /* best-effort */ }
      }

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
 * Worker-pool fan-out for the on-demand EB model: N concurrent workers, each
 * claiming its own EB and running exactly ONE test per claim, then releasing.
 *
 * Returns the collected results, or `null` if no EB could be claimed at all
 * (so the caller can fall through to the queue path).
 */
async function executeViaPoolWorkers(
  tests: Test[],
  runId: string,
  options: ExecutionOptions,
  maxParallelEBs: number,
  recordActualRunner: (runnerId: string) => Promise<void>,
  onProgress?: (progress: ExecutionProgress) => void,
  onResult?: (result: TestRunResult) => Promise<void>,
): Promise<TestRunResult[] | null> {
  const { claimOrProvisionPoolEB, releasePoolEB } = await import('@/server/actions/embedded-sessions');

  // When the pool is finite (e.g. docker-compose with 2 EBs locally) and we have
  // more workers than EBs, a worker's claim can legitimately return null. Wait
  // for another worker to release rather than marking the test skipped. In k8s
  // mode claimOrProvisionPoolEB already provisions on demand, so this mainly
  // helps localhost/compose mode and the k8s "at capacity" edge case.
  const claimMaxWaitMs = parseInt(process.env.EB_CLAIM_MAX_WAIT_MS || '120000', 10);
  const claimWithRetry = async () => {
    const deadline = Date.now() + claimMaxWaitMs;
    let wait = 500;
    while (Date.now() < deadline) {
      const c = await claimOrProvisionPoolEB();
      if (c) return c;
      await new Promise((r) => setTimeout(r, wait));
      wait = Math.min(wait * 2, 5000);
    }
    return null;
  };

  // Setup propagation model: each worker runs its own setup on its claimed EB once,
  // then passes `storageState: "persistent:<setupId>"` to every subsequent run_test
  // on that EB. The EB's TestExecutor.setupContexts Map reuses the live
  // BrowserContext — preserving cookies, localStorage, sessionStorage, IndexedDB,
  // and in-memory auth tokens (which `page.context().storageState()` drops).
  //
  // Fallback: if caller already provided a pre-computed setupContext.storageState
  // (no setupInfo to re-run), we pass that blob through as the cold-start state.
  const baseUrl = (options.environmentConfig?.baseUrl || 'http://localhost:3000').replace(/\/+$/, '');
  const viewport = options.playwrightSettings
    ? {
        width: options.playwrightSettings.viewportWidth || 1280,
        height: options.playwrightSettings.viewportHeight || 720,
      }
    : undefined;

  const results: TestRunResult[] = [];
  const resultMap = new Map<string, TestRunResult>();
  let nextIdx = 0;
  let completedCount = 0;
  let everClaimed = false;
  const workerCount = Math.min(maxParallelEBs, tests.length);

  const updateProgress = (activeCount: number, currentName?: string) => {
    onProgress?.({
      completed: completedCount,
      total: tests.length,
      currentTestName: currentName,
      activeCount,
      activeTests: currentName ? [currentName] : [],
    });
  };

  let activeWorkers = 0;

  type WorkerEB = { runnerId: string; sessionId: string | null };
  // Bounded setup retry: burst-starting many workers against one target URL
  // triggers network/DNS flakes (e.g. ERR_NETWORK_CHANGED) on a minority of
  // EBs. Retrying on a fresh EB almost always succeeds, so we back off and
  // retry rather than burning one test per failed setup. Cap retries so a
  // persistently-unreachable target doesn't loop forever.
  const MAX_SETUP_RETRIES = 5;
  const runWorker = async (workerId: number): Promise<void> => {
    // Each worker holds onto a single EB for as long as possible. Setup runs once
    // per EB. If the EB dies mid-sequence, we claim a fresh one and re-setup.
    let claimed: WorkerEB | null = null;
    let setupDone = false;
    let setupFailureStreak = 0;
    const workerSetupId = options.setupInfo ? `${runId}-w${workerId}` : null;

    const ensureEBWithSetup = async (): Promise<WorkerEB | null> => {
      // Claim a fresh EB if we don't hold one yet.
      if (!claimed) {
        const c = await claimWithRetry();
        if (!c) return null;
        claimed = c;
        setupDone = false;
        everClaimed = true;
        await recordActualRunner(c.runnerId);
        console.log(`[Worker ${workerId}] Claimed EB ${c.runnerId.slice(0, 8)}`);
      }

      // If we hold an EB but setup hasn't completed, RE-RUN setup. We don't
      // want to short-circuit on `claimed` while setupDone=false — otherwise
      // the worker proceeds to run tests with no persistent context (silent
      // data bug: tests hang on auth redirects and time out at 300s).
      if (options.setupInfo && workerSetupId && !setupDone) {
        try {
          await executeSetupViaRunner(
            options.setupInfo.code,
            workerSetupId,
            claimed.runnerId,
            baseUrl,
            viewport,
            options.playwrightSettings?.navigationTimeout ?? undefined,
            options.playwrightSettings,
          );
          setupDone = true;
          console.log(`[Worker ${workerId}] Setup completed on EB ${claimed.runnerId.slice(0, 8)} (persistent:${workerSetupId})`);
        } catch (err) {
          // Setup flake. By default, retry on the SAME EB — a fresh EB won't
          // help if the target URL is briefly contended. But if the error
          // signals the EB itself is unhealthy (offline/crash/command timeout,
          // OR the EB's network stack exhausted its goto retry ladder and
          // surfaced the `EB network unhealthy` tag), drop the EB so the next
          // iteration claims a fresh one. Signal failure via `return null` so
          // setupFailureStreak increments and we back off before retrying.
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[Worker ${workerId}] Setup failed on EB ${claimed.runnerId.slice(0, 8)}:`, err);
          if (/offline|crash|runner went|ECONNREFUSED|timed out|EB network unhealthy/i.test(msg)) {
            try { await releasePoolEB(claimed.runnerId); } catch { /* ignore */ }
            claimed = null;
          }
          return null;
        }
      }
      return claimed;
    };

    try {
      while (true) {
        // Don't reserve a test index until setup actually succeeds — otherwise
        // one setup flake per worker silently burns one test as "skipped".
        if (nextIdx >= tests.length) return;

        const eb = await ensureEBWithSetup();
        if (!eb) {
          setupFailureStreak++;
          if (setupFailureStreak >= MAX_SETUP_RETRIES) {
            // Target looks persistently unreachable from this worker. Mark
            // the next pending test as setup_failed so the failure surfaces
            // in the build report, then exit — peer workers may still succeed.
            const idx = nextIdx++;
            if (idx < tests.length) {
              const t = tests[idx]!;
              resultMap.set(t.id, {
                testId: t.id,
                status: 'setup_failed' as const,
                durationMs: 0,
                screenshots: [],
                errorMessage: `Setup failed ${MAX_SETUP_RETRIES} times in a row — worker giving up`,
              });
              completedCount++;
              updateProgress(activeWorkers, t.name);
            }
            return;
          }
          // Exponential back-off (0.5s, 1s, 2s, 4s, ...) — gives DNS/CNI
          // bursts time to quiesce and lets peer workers free an EB.
          const delayMs = 500 * 2 ** (setupFailureStreak - 1);
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }
        setupFailureStreak = 0;

        const myIdx = nextIdx++;
        if (myIdx >= tests.length) return;
        const test = tests[myIdx]!;

        // Prefer the live persistent context over serialized storageState.
        const effectiveSetup = workerSetupId && setupDone
          ? { storageState: `persistent:${workerSetupId}`, variables: options.setupContext?.variables }
          : options.setupContext;

        activeWorkers++;
        updateProgress(activeWorkers, test.name);
        let ebDied = false;
        try {
          const [oneResult] = await executeViaRunner(
            [test],
            runId,
            eb.runnerId,
            { ...options, setupContext: effectiveSetup, setupInfo: undefined, maxParallelTests: 1 },
            undefined, // progress emitted at the worker-pool level
            onResult,
          );
          if (oneResult) resultMap.set(test.id, oneResult);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[Worker ${workerId}] Error running test ${test.id}:`, err);
          resultMap.set(test.id, {
            testId: test.id,
            status: 'failed' as const,
            durationMs: 0,
            screenshots: [],
            errorMessage: msg,
          });
          // Heuristic: if the EB looks dead (went offline, crash-loop, command
          // timed out, or tagged as network-unhealthy by the in-pod goto retry
          // ladder), drop it so the next iteration claims a fresh one and
          // re-runs setup.
          if (/offline|crash|timed out|runner went|EB network unhealthy|page\.screenshot.*Target page.*closed|Target .*has been closed/i.test(msg)) {
            ebDied = true;
          }
        } finally {
          activeWorkers--;
          completedCount++;
          updateProgress(activeWorkers);
        }

        if (ebDied) {
          const dying = claimed as WorkerEB | null;
          if (dying) {
            try { await releasePoolEB(dying.runnerId); } catch { /* ignore */ }
          }
          claimed = null;
          setupDone = false;
        }
      }
    } finally {
      const held = claimed as WorkerEB | null;
      if (held) {
        try { await releasePoolEB(held.runnerId); } catch { /* ignore */ }
      }
    }
  };

  // Kick off workers in parallel
  const workers = Array.from({ length: workerCount }, (_, i) => runWorker(i + 1));
  await Promise.all(workers);

  // Preserve input order
  for (const t of tests) {
    const r = resultMap.get(t.id);
    if (r) {
      results.push(r);
    } else {
      // Defensive: every worker gave up on setup before reaching this test.
      // Surface it as setup_failed rather than silently dropping it.
      results.push({
        testId: t.id,
        status: 'setup_failed' as const,
        durationMs: 0,
        screenshots: [],
        errorMessage: 'Setup failed — all workers exhausted retries before reaching this test',
      });
    }
  }

  // If nothing ever got claimed, let the caller fall through to the queue path.
  return everClaimed ? results : null;
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
  const [dbRunner] = await db
    .select()
    .from(runners)
    .where(and(eq(runners.teamId, teamId), eq(runners.status, 'online')))
    .limit(1);

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
  const [dbRunner] = await db
    .select()
    .from(runners)
    .where(and(eq(runners.id, runnerId), eq(runners.teamId, teamId), eq(runners.status, 'online')));

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
  const [dbRunner] = await db
    .select()
    .from(runners)
    .where(and(eq(runners.isSystem, true), eq(runners.status, 'online')))
    .limit(1);

  return dbRunner;
}

/**
 * Get a specific system runner by ID if it's online.
 */
async function getAvailableSystemRunnerById(runnerId: string) {
  const [dbRunner] = await db
    .select()
    .from(runners)
    .where(and(eq(runners.id, runnerId), eq(runners.isSystem, true), eq(runners.status, 'online')));

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
  // Helper: record which runner actually executes the job
  const recordActualRunner = async (runnerId: string) => {
    if (options.jobId) {
      const { updateBackgroundJob } = await import('@/lib/db/queries/background-jobs');
      await updateBackgroundJob(options.jobId, { actualRunnerId: runnerId });
    }
  };

  // 1. Try team runner first
  if (options.teamId) {
    const teamRunner = await getAvailableRunner(options.teamId);
    if (teamRunner) {
      console.log(`Fallback chain: using team runner ${teamRunner.id}`);
      await recordActualRunner(teamRunner.id);
      return executeViaRunner(tests, runId, teamRunner.id, options, onProgress, onResult);
    }
  }

  // 2. Try system EB pool.
  //    Worker-pool fan-out: one EB per WORKER (not per test). Each worker runs its
  //    own setup on its claimed EB and then reuses that EB's live BrowserContext
  //    via `persistent:<setupId>` for every subsequent test. Preserves full setup
  //    state (cookies + localStorage + sessionStorage + IndexedDB + in-memory
  //    tokens) that `storageState()` serialization would drop.
  const maxParallelEBs = Math.max(1, options.playwrightSettings?.maxParallelEBs ?? 10);
  const canUseWorkerPool =
    tests.length > 1 &&
    maxParallelEBs > 1;
  if (canUseWorkerPool) {
    const poolResults = await executeViaPoolWorkers(
      tests,
      runId,
      options,
      maxParallelEBs,
      recordActualRunner,
      onProgress,
      onResult,
    );
    if (poolResults) return poolResults;
  }

  const { claimOrProvisionPoolEB, releasePoolEB } = await import('@/server/actions/embedded-sessions');
  const poolEB = await claimOrProvisionPoolEB();
  if (poolEB) {
    console.log(`Fallback chain: claimed pool EB ${poolEB.runnerId.slice(0, 8)}`);
    await recordActualRunner(poolEB.runnerId);
    try {
      return await executeViaRunner(tests, runId, poolEB.runnerId, options, onProgress, onResult);
    } finally {
      await releasePoolEB(poolEB.runnerId);
      console.log(`Fallback chain: released pool EB ${poolEB.runnerId.slice(0, 8)}`);
    }
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

