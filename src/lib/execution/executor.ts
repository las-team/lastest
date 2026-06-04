/**
 * Test Executor
 *
 * Routes test execution through remote runners or embedded browsers.
 */

import type { TestRunResult } from '@/lib/playwright/types';
import type { Test, EnvironmentConfig, PlaywrightSettings, StabilizationSettings, NetworkRequest, DownloadRecord } from '@/lib/db/schema';
import { DEFAULT_STABILIZATION_SETTINGS } from '@/lib/db/schema';
import {
  deriveCheckModes,
  mergeWithTestOverrides,
  pickTestModeOverrides,
  type CheckMode,
} from '@/lib/verify/check-modes';
import type {
  RunTestCommand,
  RunSetupCommand,
  StabilizationPayload,
} from '@/lib/ws/protocol';
import { createMessage } from '@/lib/ws/protocol';
import { queueCommandToDB, queueCancelCommandToDB } from '@/app/api/ws/runner/route';
import { getRecordingViewport } from '@/lib/db/queries';
import { runnerRegistry } from '@/lib/ws/runner-registry';
import { mergeDesignSystemConfig, isConfigUsable } from '@/lib/design-system/tokens';
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
  getGoogleSheetsDataSources,
  getCsvDataSources,
  getSelectorStatsForTest,
} from '@/lib/db/queries';
import { extractTestBody, parseSteps } from '@/lib/playwright/debug-parser';
import { resolveVarReferencesAsync, pickRowsForVariables, resolveAssignedValuesAsync, type AIVarRuntime } from '@/lib/vars/resolver';
import { resolveSheetReferences } from '@/lib/google-sheets/resolver';
import { resolveCsvReferences } from '@/lib/csv/resolver';
import type { GoogleSheetsDataSource, CsvDataSource, TestVariable } from '@/lib/db/schema';
import { getAISettings } from '@/lib/db/queries';
import { generateWithAI, type AIProviderConfig } from '@/lib/ai';
import { buildAIVarPrompt, sanitizeAIVarOutput } from '@/lib/vars/ai-presets';
/**
 * Generate SHA256 hash of test code for integrity verification.
 */
function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

/**
 * Build an AI runtime for resolving `ai-generated` variables at run time. Returns
 * `null` when the configured provider has no usable credentials — callers
 * (resolveSingleVarAsync) then fall back to the cached value or fail clearly.
 */
async function buildAIVarRuntime(repositoryId?: string | null): Promise<AIVarRuntime | null> {
  const settings = await getAISettings(repositoryId ?? undefined);
  if (!settings) return null;

  const provider = settings.provider as AIProviderConfig['provider'];
  // Skip the local CLI provider for AI vars: it's the default fallback when
  // nothing has been configured, and silently spawning a CLI subprocess per
  // variable per run would be slow and fragile in CI / containers.
  if (provider === 'claude-cli') return null;
  if (provider === 'openrouter' && !settings.openrouterApiKey) return null;
  if (provider === 'anthropic' && !settings.anthropicApiKey) return null;
  if (provider === 'openai' && !settings.openaiApiKey) return null;
  if (provider === 'ollama' && !settings.ollamaModel) return null;

  const config: AIProviderConfig = {
    provider,
    openrouterApiKey: settings.openrouterApiKey ?? undefined,
    openrouterModel: settings.openrouterModel ?? undefined,
    agentSdkPermissionMode: (settings.agentSdkPermissionMode ?? undefined) as AIProviderConfig['agentSdkPermissionMode'],
    agentSdkModel: settings.agentSdkModel ?? undefined,
    agentSdkWorkingDir: settings.agentSdkWorkingDir ?? undefined,
    ollamaBaseUrl: settings.ollamaBaseUrl ?? undefined,
    ollamaModel: settings.ollamaModel ?? undefined,
    anthropicApiKey: settings.anthropicApiKey ?? undefined,
    anthropicModel: settings.anthropicModel ?? undefined,
    openaiApiKey: settings.openaiApiKey ?? undefined,
    openaiModel: settings.openaiModel ?? undefined,
    customInstructions: settings.customInstructions ?? undefined,
  };

  return {
    async generate(variable: TestVariable): Promise<string> {
      const prompt = buildAIVarPrompt(variable);
      if (!prompt) throw new Error(`AI variable "${variable.name}" has no prompt`);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20_000);
      try {
        const raw = await generateWithAI(
          config,
          prompt,
          'You generate short, realistic test data values. Output the value verbatim — no quotes, no labels, no commentary.',
          {
            actionType: 'generate_var_value',
            repositoryId: repositoryId ?? undefined,
            signal: controller.signal,
          },
        );
        const cleaned = sanitizeAIVarOutput(raw);
        if (!cleaned) throw new Error(`AI returned empty value for "${variable.name}"`);
        return cleaned;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

/**
 * Resolve {{sheet:...}}, {{csv:...}}, and {{var:...}} references in test code
 * before sending to the runner. Also returns the extract-mode TestVariable
 * specs the runner should pull from page fields after the test body completes.
 */
async function resolveTestCodeForRunner(
  test: Test,
  gsheetSources: GoogleSheetsDataSource[],
  csvSources: CsvDataSource[],
  ai: AIVarRuntime | null,
): Promise<{
  resolvedCode: string;
  extractVariables: Array<{
    name: string;
    targetSelector: string;
    attribute?: 'value' | 'textContent' | 'innerText' | 'innerHTML';
  }>;
  /** Resolved value for every assign-mode var, keyed by var name. Persisted
   *  on the test_results row so the Vars-tab "Last run" column has data for
   *  assign-mode rows (especially with random/increment row strategies). */
  assignedVariables: Record<string, string>;
  /** Updated cursor map for increment-mode vars — caller writes back to
   *  tests.variableRowCursors. Empty when nothing changed. */
  nextRowCursors: Record<string, number>;
  /** Newly generated AI-var values keyed by TestVariable.id — caller writes
   *  back to tests.aiVarLastValues. Empty when no AI calls happened. */
  nextAiLastValues: Record<string, string>;
  /** Pre-flight resolution errors that should fail the run before sending
   *  it to the runner (e.g. AI failure with no cached fallback). */
  preflightErrors: string[];
}> {
  let code = test.code;
  // Direct {{sheet:...}} references
  if (gsheetSources.length > 0 && code.includes('{{sheet:')) {
    const r = resolveSheetReferences(code, gsheetSources);
    code = r.resolvedCode;
  }
  // Direct {{csv:...}} references
  if (csvSources.length > 0 && code.includes('{{csv:')) {
    const r = resolveCsvReferences(code, csvSources);
    code = r.resolvedCode;
  }
  // Pre-pick rows for increment/random vars once per run so all {{var:x}}
  // occurrences agree on a single row (per-run, not per-occurrence).
  const { rowPicks, nextCursors } = pickRowsForVariables(
    test.variables,
    gsheetSources,
    csvSources,
    test.variableRowCursors ?? null,
  );

  const aiCache = test.aiVarLastValues ?? undefined;
  const preflightErrors: string[] = [];
  let nextAiLastValues: Record<string, string> = {};

  // {{var:...}} references — resolve via TestVariables (assign-mode only)
  if (test.variables && test.variables.length > 0 && code.includes('{{var:')) {
    const r = await resolveVarReferencesAsync(code, test.variables, gsheetSources, csvSources, rowPicks, ai, aiCache);
    code = r.resolvedCode;
    nextAiLastValues = { ...nextAiLastValues, ...r.nextLastValues };
    if (r.hardError) {
      preflightErrors.push(...r.errors);
    }
  }

  const { values: assignedVariables, nextLastValues: assignedNextLastValues } = await resolveAssignedValuesAsync(
    test.variables,
    gsheetSources,
    csvSources,
    rowPicks,
    ai,
    aiCache,
    nextAiLastValues,
  );
  nextAiLastValues = { ...nextAiLastValues, ...assignedNextLastValues };

  const extractVariables = (test.variables ?? [])
    .filter(v => v.mode === 'extract' && !!v.targetSelector)
    .map(v => ({
      name: v.name,
      targetSelector: v.targetSelector!,
      attribute: v.attribute,
    }));

  return {
    resolvedCode: code,
    extractVariables,
    assignedVariables,
    nextRowCursors: nextCursors,
    nextAiLastValues,
    preflightErrors,
  };
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
  cursorPlaybackSpeedOverride?: number; // One-shot per-call override (e.g. recording preview replay at 2x); takes precedence over per-test/global settings
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
  headed?: boolean,
): Promise<{ storageState?: string; storageStateJson?: string; variables?: Record<string, unknown> }> {
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
    headed: headed || undefined,
    // Apply UA override to the setup context too — auth handshakes are exactly
    // where Cloudflare Turnstile / Clerk reject HeadlessChrome fingerprints.
    userAgentOverride: playwrightSettings?.userAgentOverride || undefined,
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
            storageStateJson: payload.storageStateJson as string | undefined,
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

  // Load gsheet/csv sources once for this run — used to resolve {{sheet:}}, {{csv:}}, {{var:}} tokens.
  const gsheetSources = options.repositoryId ? await getGoogleSheetsDataSources(options.repositoryId) : [];
  const csvSources = options.repositoryId ? await getCsvDataSources(options.repositoryId) : [];

  // Resolve the diff-sensitivity text-diff toggle once per run. The EB pod
  // can't reach the host's settings DB, so each `command:run_test` payload
  // carries the boolean inline.
  //
  // Source of truth is the per-check 3-way mode (textMode). When it's
  // explicitly set the cogwheel modal owns the value; otherwise we fall
  // back to the legacy textDiffEnabled boolean on diff_sensitivity_settings
  // for repos that predate the migration.
  let textCaptureEnabled = false;
  let repoCheckModes = deriveCheckModes(options.playwrightSettings ?? null);
  try {
    const { getDiffSensitivitySettings } = await import('@/lib/db/queries');
    const diffSettings = await getDiffSensitivitySettings(options.repositoryId ?? null);
    repoCheckModes = deriveCheckModes({
      ...(options.playwrightSettings ?? {}),
      textDiffEnabled: diffSettings?.textDiffEnabled ?? null,
    });
    textCaptureEnabled = repoCheckModes.text !== 'disable';
  } catch (err) {
    console.warn('[executor] Failed to load diff-sensitivity settings for text capture:', err);
  }
  // Build the AI runtime once per run. Returns null when no provider is
  // configured — resolveSingleVarAsync then falls back to the cached value
  // or surfaces a clear preflight error.
  let aiVarRuntime: AIVarRuntime | null = null;
  try {
    aiVarRuntime = await buildAIVarRuntime(options.repositoryId);
  } catch (err) {
    console.warn('[executor] Failed to build AI var runtime:', err);
  }

  // Track in-flight tests: commandId → { testId, testName, startTime, effectiveTimeout }
  // `effectiveTimeout` is the budget we handed to the EB (`command.timeout`).
  // The per-row stalled-check uses `effectiveTimeout + EB_DRAIN_GRACE_MS` as the
  // host's deadline so the EB always loses the race and POSTs its `Test
  // execution timed out` test_result + screenshots before we give up. Without
  // the grace, both sides fire at the same instant — host marks [EB-stalled],
  // EB closes context, late test_result is dropped, screenshots fail with
  // "Target page, context or browser has been closed".
  const inFlight = new Map<string, { testId: string; testName: string; startTime: number; effectiveTimeout: number; completedSeenAt?: number; assignedVariables?: Record<string, string>; sentDesignSystem?: boolean }>();
  let completedCount = 0;
  let cancelled = false;
  // Extra wall-clock the host waits AFTER the EB's own command.timeout fires,
  // so the EB has time to close its context, capture a final screenshot, and
  // POST `response:test_result` before the host gives up and marks the
  // command timed out itself.
  const EB_DRAIN_GRACE_MS = 30_000;
  const baseTimeout = options.playwrightSettings?.navigationTimeout || 120000;
  // Scale timeout for concurrency — parallel tests compete for resources.
  // Floor was 10 min, but the build watchdog `markStaleJobsAsCrashed`
  // (`background-jobs.ts:182`) flips a job to `failed` after 5 min of no
  // `lastActivityAt` tick. With a 10-min per-test floor, a silently-dying
  // EB would freeze the polling loop for 5 min, watchdog would kill the
  // build as `blocked` with no per-test attribution, and the user would
  // see "Build aborted mid-run — recovered 12 of 25 cases" instead of the
  // real signal (the 13th test's EB hung). Floor of 4 min stays under the
  // watchdog so the timeout path fires first: per-test `failed` row with
  // `Test execution timed out after 240000ms`, build continues with the
  // remaining tests. Trade-off: legitimately slow tests under heavy pool
  // concurrency now cancel where they wouldn't before — bump the
  // watchdog threshold (or add claim-wait heartbeats) before raising
  // pool concurrency past current levels.
  const testTimeout = Math.max(baseTimeout * maxParallel, 240000);
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

      // Resolve {{sheet:}}, {{csv:}}, {{var:}} tokens before sending. Hash the resolved code
      // so the runner's integrity check matches what it actually executes.
      const { resolvedCode, extractVariables, assignedVariables, nextRowCursors, nextAiLastValues, preflightErrors } =
        await resolveTestCodeForRunner(test, gsheetSources, csvSources, aiVarRuntime);

      // Hard pre-flight failure — e.g. an AI variable referenced in the code
      // could not be resolved AND has no cached fallback. Don't ship the test
      // to the runner with unresolved {{var:...}} tokens; mark it failed
      // immediately with a clear error message.
      if (preflightErrors.length > 0) {
        results.push({
          testId: test.id,
          status: 'failed',
          durationMs: 0,
          screenshots: [],
          errorMessage: `Variable resolution failed: ${preflightErrors.join('; ')}`,
        });
        completedCount++;
        continue;
      }

      // Persist the updated row cursors so increment-mode vars walk forward
      // across runs. Best-effort — never fail the run on a cursor write fail.
      if (Object.keys(nextRowCursors).length > 0) {
        try {
          await db.update(testsTable)
            .set({ variableRowCursors: nextRowCursors })
            .where(eq(testsTable.id, test.id));
        } catch (err) {
          console.warn(`[executor] Failed to persist variableRowCursors for test ${test.id}:`, err);
        }
      }

      // Persist newly generated AI-var values so 'fixed' refresh-mode reuses
      // them and 'random' mode has a fallback when AI later becomes
      // unavailable. Best-effort — never fail the run on a cache write.
      if (Object.keys(nextAiLastValues).length > 0) {
        try {
          const merged = { ...(test.aiVarLastValues ?? {}), ...nextAiLastValues };
          await db.update(testsTable)
            .set({ aiVarLastValues: merged })
            .where(eq(testsTable.id, test.id));
        } catch (err) {
          console.warn(`[executor] Failed to persist aiVarLastValues for test ${test.id}:`, err);
        }
      }

      // Default-ON `all_steps_executed`: only off when the user explicitly
      // persisted a severity:'warn' rule in stepCriteria. Mirrors the synthesis
      // logic in src/lib/execution/evaluation.ts.
      const failOnRuntimeError = !(test.stepCriteria ?? []).some(c =>
        c.rules.some(r => r.kind === 'all_steps_executed' && r.severity === 'warn'),
      );

      // Parse steps from the resolved code so the runner can emit per-step
      // lifecycle events keyed to the same indices the host UI uses. Compute
      // here (single source of truth) rather than re-deriving on the runner.
      const resolvedBody = extractTestBody(resolvedCode) ?? '';
      const parsedSteps = resolvedBody ? parseSteps(resolvedBody) : [];

      // Fetch all selector_stats rows for this test so the runner / EB can
      // sort fallback candidates by historical success without a per-action
      // DB round-trip. Best-effort — first run of any test sees an empty
      // list, runner falls back to the captured order.
      let selectorStatsForRunner: Awaited<ReturnType<typeof getSelectorStatsForTest>> = [];
      try {
        selectorStatsForRunner = await getSelectorStatsForTest(test.id);
      } catch (err) {
        console.warn(`[executor] Failed to load selector_stats for test ${test.id}:`, err);
      }

      // Compute the design-system payload up front so we can log whether
      // the harvester was opted into for this test — silent skips ("toggle
      // on but tokens empty" or "merge produced no usable config") are the
      // #1 cause of "Design tab: not captured" support reports. Without
      // this log there's no way to tell from the dev server output whether
      // the EB was even told to run.
      // Effective per-test check modes: repo modes overridden by sparse
      // per-test mode keys (`visualMode`, `textMode`, …). Reads the new
      // `*Mode` fields first; falls back to the legacy
      // `networkErrorMode`/`consoleErrorMode` for rows written before the
      // per-test migration.
      const perTestCheckModes = mergeWithTestOverrides(
        repoCheckModes,
        pickTestModeOverrides(pwOverrides ?? null),
      );
      const checkModeToErr = (m: CheckMode): 'fail' | 'warn' | 'ignore' =>
        m === 'enforce' ? 'fail' : m === 'log' ? 'warn' : 'ignore';

      const designSystemPayload = (() => {
        if (perTestCheckModes.design === 'disable') return undefined;
        const effective = mergeDesignSystemConfig(
          options.playwrightSettings?.designSystem ?? null,
          test.designSystemOverrides ?? null,
        );
        if (!effective) {
          console.warn(`[executor] design-system: toggle on but no token bundle for test ${test.id}; upload one on the Setup tab.`);
          return undefined;
        }
        if (!isConfigUsable(effective)) {
          console.warn(`[executor] design-system: token bundle has 0 usable values for test ${test.id}; re-upload may be required.`);
          return undefined;
        }
        if (effective.enabled === false) return undefined;
        const tokenCount = Object.values(effective.tokens ?? {}).reduce<number>(
          (n, list) => n + (Array.isArray(list) ? list.length : 0),
          0,
        );
        console.log(`[executor] design-system: sending ${tokenCount} tokens to EB for test ${test.id}`);
        return {
          tokens: effective.tokens,
          ignoredCategories: effective.ignoredCategories,
          maxViolationsPerScreenshot: effective.maxViolationsPerScreenshot,
        };
      })();

      const command = createMessage<RunTestCommand>('command:run_test', {
        testId: test.id,
        testRunId: runId,
        code: resolvedCode,
        codeHash: hashCode(resolvedCode),
        targetUrl: effectiveBaseUrl,
        screenshotPath: `${runId}-${test.id}.png`,
        timeout: effectiveTimeout,
        repositoryId: options.repositoryId || undefined,
        viewport: test.viewportOverride || viewport,
        storageState: options.setupContext?.storageState,
        setupVariables: options.setupContext?.variables,
        cursorPlaybackSpeed: options.cursorPlaybackSpeedOverride ?? pwOverrides?.cursorPlaybackSpeed ?? options.playwrightSettings?.cursorPlaybackSpeed ?? 1,
        stabilization: buildStabilizationPayload(options.playwrightSettings, test.stabilizationOverrides),
        consoleErrorMode: checkModeToErr(perTestCheckModes.console),
        networkErrorMode: checkModeToErr(perTestCheckModes.network),
        ignoreExternalNetworkErrors: options.playwrightSettings?.ignoreExternalNetworkErrors ?? true,
        enableNetworkInterception: perTestCheckModes.network !== 'disable',
        // Repo-level allowlist for documented 3rd-party noise hosts. Null on the row
        // means "use the EB default" (DEFAULT_CONSOLE_ERROR_IGNORE_HOSTS); the EB
        // applies the filter BEFORE the consoleErrorMode fail gate.
        consoleErrorIgnoreHosts: options.playwrightSettings?.consoleErrorIgnoreHosts ?? undefined,
        // UA override — when set, EB passes to newContext({ userAgent }) so Chromium
        // sends a stable Chrome string instead of HeadlessChrome.
        userAgentOverride: options.playwrightSettings?.userAgentOverride || undefined,
        // Without this, the runner never invokes axe-core. Gated on the
        // per-check 3-way mode — both `enforce` and `log` enable capture;
        // `disable` skips the axe run.
        enableA11y: perTestCheckModes.a11y !== 'disable',
        // Design-system token compliance payload computed above so the
        // host-side log fires before the command is queued.
        designSystem: designSystemPayload,
        browser: effectiveBrowser,
        fixtures: fixturePayloads,
        grantClipboardAccess: options.playwrightSettings?.grantClipboardAccess ?? false,
        acceptDownloads: options.playwrightSettings?.acceptDownloads ?? false,
        headed: options.headless === false,
        forceVideoRecording: options.forceVideoRecording || undefined,
        recordingViewport,
        lockViewportToRecording: options.playwrightSettings?.lockViewportToRecording ?? false,
        extractVariables: extractVariables.length > 0 ? extractVariables : undefined,
        failOnRuntimeError,
        steps: parsedSteps.length > 0 ? parsedSteps.map(s => ({
          id: s.id,
          label: s.label,
          lineStart: s.lineStart,
          lineEnd: s.lineEnd,
          type: s.type,
        })) : undefined,
        // Pass the host-parsed assertions so the runner can wrap each
        // `expect(...)` line with a structured pass/fail recorder. The
        // criteria evaluator on the host keys on these ids to fail the test
        // when a user-pinned assertion failed.
        assertions: (test.assertions ?? []).map(a => ({
          id: a.id,
          codeLineStart: a.codeLineStart,
          codeLineEnd: a.codeLineEnd,
        })),
        selectorStats: selectorStatsForRunner.length > 0 ? selectorStatsForRunner : undefined,
        selectorTimeoutMs:
          pwOverrides?.selectorTimeoutMs
          ?? options.playwrightSettings?.selectorTimeoutMs
          ?? 3000,
        textCaptureEnabled,
      });

      // Queue command to DB
      await queueCommandToDB(runnerId, command);
      inFlight.set(command.id, {
        testId: test.id,
        testName: test.name,
        startTime: Date.now(),
        effectiveTimeout,
        assignedVariables: Object.keys(assignedVariables).length > 0 ? assignedVariables : undefined,
        sentDesignSystem: !!designSystemPayload,
      });
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
        assertionResults: Array.isArray(payload.assertionResults) && payload.assertionResults.length > 0
          ? payload.assertionResults as import('@/lib/db/schema').AssertionResult[]
          : undefined,
        videoPath,
        networkBodiesPath,
        domSnapshot: payload.domSnapshot as import('@/lib/db/schema').DomSnapshotData | undefined,
        lastReachedStep: typeof payload.lastReachedStep === 'number' ? payload.lastReachedStep : undefined,
        totalSteps: typeof payload.totalSteps === 'number' ? payload.totalSteps : undefined,
        extractedVariables: payload.extractedVariables && typeof payload.extractedVariables === 'object'
          ? payload.extractedVariables as Record<string, string>
          : undefined,
        // Host-resolved values for assign-mode vars on this run. Stored
        // alongside extractedVariables so the Vars-tab "Last run" column has
        // data for both modes (especially with random/increment row picks).
        assignedVariables: info.assignedVariables,
        logs: Array.isArray(payload.logs) && payload.logs.length > 0
          ? payload.logs as Array<{ timestamp: number; level: string; message: string }>
          : undefined,
        // EB ships a11yViolations / a11yPassesCount on the response payload
        // when `enableA11y` was set on the command. Forward them onto the
        // TestRunResult so `createTestResult` persists them; otherwise the
        // verify A11y tab classifies the layer as `absent` even when axe-core
        // ran and the EB captured violations.
        a11yViolations: Array.isArray(payload.a11yViolations)
          ? payload.a11yViolations as import('@/lib/db/schema').A11yViolation[]
          : undefined,
        a11yPassesCount: typeof payload.a11yPassesCount === 'number'
          ? payload.a11yPassesCount
          : undefined,
        // Same forwarding pattern as a11y — EB ships violations + rules-checked
        // count when the design-system toggle is on; otherwise both stay
        // undefined and the verify Design pane classifies the layer absent.
        designSystemViolations: Array.isArray(payload.designSystemViolations)
          ? payload.designSystemViolations as import('@/lib/db/schema').DesignSystemViolation[]
          : undefined,
        designSystemRulesChecked: typeof payload.designSystemRulesChecked === 'number'
          ? payload.designSystemRulesChecked
          : undefined,
        designSystemTokenUsage: payload.designSystemTokenUsage && typeof payload.designSystemTokenUsage === 'object'
          ? payload.designSystemTokenUsage as import('@/lib/db/schema').DesignSystemTokenUsage
          : undefined,
        urlTrajectory: Array.isArray(payload.urlTrajectory) && payload.urlTrajectory.length > 0
          ? payload.urlTrajectory as import('@/lib/db/schema').UrlTrajectoryStep[]
          : undefined,
        webVitals: Array.isArray(payload.webVitals) && payload.webVitals.length > 0
          ? payload.webVitals as import('@/lib/db/schema').WebVitalsSample[]
          : undefined,
        storageStateSnapshot: payload.storageStateSnapshot && typeof payload.storageStateSnapshot === 'object'
          ? payload.storageStateSnapshot as import('@/lib/db/schema').StorageStateSnapshot
          : undefined,
      };

      // Stale-EB detector: we sent a token bundle but the EB didn't return
      // either of the design-system fields. The most common cause is the
      // EB Docker image being older than this host's source — `pnpm
      // stack:refresh:eb` (k3d) or redeploying the EB container
      // (Olares/Zima) picks up the new harvester.
      if (
        info.sentDesignSystem &&
        !Array.isArray(payload.designSystemViolations) &&
        typeof payload.designSystemRulesChecked !== 'number'
      ) {
        console.warn(
          `[executor] design-system: EB returned no harvest for test ${info.testId} despite tokens being sent. ` +
          `Most likely the EB image predates the design-system harvester — rebuild with \`pnpm stack:refresh:eb\` (k3d) or redeploy the EB container.`,
        );
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
      // Per-row deadline = EB's own budget + drain grace. Without the grace
      // the host and EB fire simultaneously and race for who marks the test
      // failed first; the host always wins (poll loop is faster than a
      // forced context.close) and the EB's real test_result + screenshots
      // get orphaned. Grace lets the EB POST first, normal completion path
      // runs.
      const hostDeadlineMs = info.effectiveTimeout + EB_DRAIN_GRACE_MS;
      if (Date.now() - info.startTime > hostDeadlineMs) {
        // Probe the runner row to disambiguate "EB died" vs "test code hung".
        // Hard-failures inside a test (page.goto stuck, await never resolves)
        // produce the same surface symptom as the EB itself dying (pod OOM,
        // CNI yank, kubelet eviction): no results post for testTimeout. The
        // recovery is different though — a dead EB warrants retry on a fresh
        // pod, while a hung test should surface as-is and not burn a second
        // EB. Tagging the dead-EB case with `[EB-dead]` makes the pool path's
        // EB_INFRA_ERR_RX match and triggers `runOneTest`'s retry.
        const runnerRow = await db
          .select({ status: runners.status, lastSeen: runners.lastSeen, name: runners.name })
          .from(runners)
          .where(eq(runners.id, runnerId))
          .limit(1)
          .then((rows) => rows[0])
          .catch(() => undefined);
        const lastSeenMs = runnerRow?.lastSeen
          ? Date.now() - new Date(runnerRow.lastSeen).getTime()
          : -1;
        // 90s matches the runner-side heartbeat reaper grace (cleanup-loop's
        // SESSION_TIMEOUT_MS=60s + headroom). If lastSeen is older than that,
        // the EB has effectively gone away even if the row hasn't flipped to
        // 'offline' yet.
        const runnerDead = !runnerRow
          || runnerRow.status === 'offline'
          || (lastSeenMs >= 0 && lastSeenMs > 90_000);

        const lastSeenStr = lastSeenMs >= 0 ? `${Math.round(lastSeenMs / 1000)}s ago` : 'never';

        // Snapshot the EB pod's status + last 80 log lines from k8s on EVERY
        // timeout (not just runnerDead). When the runner is alive but the
        // test code hung, the pod logs are the only window into what the
        // test-executor was doing — often this is an early Chromium init
        // stall (`browser.newContext` / `testContext.newPage` hanging on a
        // CPU-starved or memory-pressured node) where the runner-client is
        // happily heartbeating while the test-executor never reached
        // `instrumentStepTracking` (so `lastReachedStep` / `totalSteps`
        // stay null in the result). Best-effort, no-op if not in k8s mode.
        let podDiagnostics = '';
        if (runnerRow?.name) {
          try {
            const { getEBPodInfo, jobNameForRunnerName } = await import('@/lib/eb/provisioner');
            const jobName = jobNameForRunnerName(runnerRow.name);
            if (jobName) {
              const info = await getEBPodInfo(jobName, 80);
              if (info) {
                const headerBits = [
                  `pod=${info.podName}`,
                  `phase=${info.phase}`,
                  info.reason ? `reason=${info.reason}` : '',
                  info.exitCode !== undefined ? `exitCode=${info.exitCode}` : '',
                  info.message ? `message=${info.message.slice(0, 200)}` : '',
                ].filter(Boolean).join(' ');
                const trimmedLogs = (info.logs || '').slice(-2000); // last 2KB of stdout
                podDiagnostics = `\n[EB-pod ${headerBits}]\n${trimmedLogs}`;
              }
            }
          } catch (err) {
            console.warn('[Executor] getEBPodInfo threw:', err instanceof Error ? err.message : err);
          }
        }

        // Distinguish three timeout flavours for triage:
        //   - EB-dead:    runner row gone / offline / heartbeat stale → pod
        //                 death (OOMKilled, CNI yank, eviction) → retry on a
        //                 fresh EB via `runOneTest`'s `EB_INFRA_ERR_RX` match.
        //   - EB-stalled: runner alive AND the EB never POSTed ANY response
        //                 for this command. The EB picked up the command
        //                 (claimedAt is set on `runner_commands`) but never
        //                 produced even a screenshot, step_event, or partial
        //                 test_result → test-executor is hung in early init
        //                 (browser.newContext / page.addInitScript / first
        //                 page.goto, often CPU-starved on the node). Tag as
        //                 EB-stalled so it matches `EB_INFRA_ERR_RX` and
        //                 retries on a fresh EB — the user's test never ran.
        //   - test-hung:  runner alive AND the EB POSTed at least one
        //                 response → test code is itself stuck (await never
        //                 resolves, deep selector retry, infinite
        //                 waitForFunction). Surface as-is; retry won't help.
        // One probe row is enough to know "EB sent something"; we don't need
        // a full count. We also pull the step_event beacon payload so the
        // diagnostic message can quote "stopped at step N of M" instead of a
        // bare "test code hung".
        const { runnerCommandResults } = await import('@/lib/db/schema');
        const probe = await db
          .select({ id: runnerCommandResults.id, type: runnerCommandResults.type, payload: runnerCommandResults.payload })
          .from(runnerCommandResults)
          .where(eq(runnerCommandResults.commandId, commandId))
          .catch(() => [] as Array<{ id: string; type: string; payload: Record<string, unknown> | null }>);
        const responseCount = probe.length;
        const stepBeacon = probe.find((r) => r.type === 'response:step_event');
        const beaconPayload = (stepBeacon?.payload ?? null) as { stepIndex?: number; totalSteps?: number; status?: string } | null;
        // `EB-stalled` means the EB never produced any signal at all (no step
        // events, no screenshots, no partial results). The presence of a
        // step_event beacon proves the test code is running, so `EB-stalled`
        // would misroute the failure through EB_INFRA_ERR_RX → wasted retry
        // on a fresh EB. Demote to test-hung in that case.
        const ebStalledNoStart = !runnerDead && responseCount === 0;
        const stepProgress = beaconPayload && typeof beaconPayload.stepIndex === 'number' && typeof beaconPayload.totalSteps === 'number'
          ? ` (stopped at step ${beaconPayload.stepIndex} of ${beaconPayload.totalSteps}${beaconPayload.status ? `, last status: ${beaconPayload.status}` : ''})`
          : '';
        const errorMessage = runnerDead
          ? `[EB-dead] runner went offline mid-test (status=${runnerRow?.status ?? 'missing'}, lastSeen=${lastSeenStr}, hostDeadline=${hostDeadlineMs}ms, ebBudget=${info.effectiveTimeout}ms)${podDiagnostics}`
          : ebStalledNoStart
            ? `[EB-stalled] EB picked up the command but never POSTed a response within ${hostDeadlineMs}ms (runner alive ${lastSeenStr}; Chromium/CDP init likely stuck on the EB pod before the test body ran)${podDiagnostics}`
            : `Test execution timed out after ${hostDeadlineMs}ms (runner alive, test code hung; last reported activity ${lastSeenStr}; ${responseCount} partial response(s) received)${stepProgress}${podDiagnostics}`;

        console.error(`[Executor] Test ${info.testId} timed out: ${errorMessage}`);
        // Cancel the stale test on the runner so it frees resources (no-op if
        // the runner is already dead — the cancel command just gets reaped
        // alongside the dead runner's other commands).
        await queueCancelCommandToDB(runnerId, runId, errorMessage);
        inFlight.delete(commandId);
        completedCount++;
        const timeoutResult: TestRunResult = {
          testId: info.testId,
          status: 'failed',
          durationMs: testTimeout,
          screenshots: [],
          errorMessage,
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
 * Dispatch tests to the system EB pool with strict 1-job-1-EB isolation.
 *
 * Setup (if any) runs ONCE on a dedicated EB; its serialized storageState is
 * broadcast to every subsequent test-EB. This keeps seed scripts and account
 * signups single-execution, and guarantees no browser context / CDP session
 * crosses test boundaries.
 *
 * Each test then claims a fresh EB, applies the broadcast storageState cold,
 * runs the test, and releases the EB. Concurrency is bounded by
 * `maxParallelEBs`; provisioning scales to meet demand (see
 * `src/lib/eb/provisioner.ts`). Per-test retry is limited to one extra EB
 * attempt for genuinely dead EB infra.
 *
 * Returns the collected results, or `null` if no EB could be claimed at all
 * (so the caller can fall through to the queue path).
 */
/**
 * GET the EB pod's /health endpoint (port 9224, exposed by
 * `packages/embedded-browser/src/index.ts`'s health server). Used to
 * disambiguate "Target has been closed" style Playwright errors:
 *   - probe 200 → EB is alive, error is test-code → don't burn another EB
 *   - probe fails / non-200 → EB is dead → retry on a fresh EB
 *
 * Looks up `embedded_sessions.containerUrl` (set at register time to
 * http://<host>:<streamPort>) and swaps the port to 9224. 2s timeout so the
 * probe can't stall dispatch when the pod is actually offline. See
 * docs/eb-and-setup-plan.md B5.
 */
async function probeEBHealth(runnerId: string): Promise<boolean> {
  try {
    const { db } = await import('@/lib/db');
    const { embeddedSessions } = await import('@/lib/db/schema');
    const { eq } = await import('drizzle-orm');
    const [row] = await db
      .select({ containerUrl: embeddedSessions.containerUrl })
      .from(embeddedSessions)
      .where(eq(embeddedSessions.runnerId, runnerId))
      .limit(1);
    if (!row?.containerUrl) return false;
    const healthUrl = row.containerUrl.replace(/:(\d+)(?=$|\/)/, ':9224') + '/health';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    try {
      const res = await fetch(healthUrl, { signal: controller.signal });
      return res.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // Treat any probe error (DNS, timeout, abort) as "dead" so we err toward
    // retrying. The cost of a false dead-EB classification is one EB; the cost
    // of a false alive classification is a confusing test failure.
    return false;
  }
}

/**
 * Mark the just-completed test_result row as a dead-EB attempt so operators
 * can see how often the executor is silently retrying due to EB infrastructure
 * failures (CNI churn, Chromium crash, runner-client disconnect, etc.).
 *
 * `executeViaRunner`'s polling loop ALREADY persisted the failed result via
 * `onResult` before `runOneTest` got to inspect it, so we don't insert a new
 * row — we update the most recent failed row for this (testRunId, testId)
 * that bears one of our infra tags. Setting `isFlaky=true` excludes it from
 * the post-build retry loop in `builds.ts:980+` (the executor's own
 * MAX_EB_ATTEMPTS retry already handles infra). Prefixing the errorMessage
 * with `[EB-dead attempt N]` makes the cause grep-able in the verify board.
 *
 * Falls back to INSERT only if no recent row matches — that path is fire-and-
 * forget and never throws: a missed marker is better than a build failing on
 * a logging hiccup. See docs/eb-and-setup-plan.md B4.
 */
async function persistDeadEBAttempt(
  testRunId: string,
  testId: string,
  attempt: number,
  errorMessage: string,
): Promise<void> {
  const tagged = `[EB-dead attempt ${attempt}] ${errorMessage}`.slice(0, 4000);
  try {
    const { db: dbRw } = await import('@/lib/db');
    const { testResults: trTable } = await import('@/lib/db/schema');
    const { eq: eqOp, and: andOp } = await import('drizzle-orm');
    // Find the failed row for this (testRunId, testId) that's NOT already
    // marked flaky — that's the one `executeViaRunner` just persisted via
    // its onResult call. test_results has no createdAt column, so we rely
    // on `isFlaky=false` to exclude rows from prior dead-EB attempts in the
    // same run (those get flipped to isFlaky=true by this same code).
    const [row] = await dbRw
      .select({ id: trTable.id })
      .from(trTable)
      .where(andOp(
        eqOp(trTable.testRunId, testRunId),
        eqOp(trTable.testId, testId),
        eqOp(trTable.status, 'failed'),
        eqOp(trTable.isFlaky, false),
      ))
      .limit(1);
    if (row) {
      await dbRw.update(trTable)
        .set({
          isFlaky: true,
          errorMessage: tagged, // tagged already contains the original errorMessage
        })
        .where(eqOp(trTable.id, row.id));
      return;
    }
    // Fallback: no recent row to update — insert a marker row instead.
    const { createTestResult } = await import('@/lib/db/queries');
    await createTestResult({
      testRunId,
      testId,
      status: 'failed',
      screenshots: [],
      errorMessage: tagged,
      durationMs: 0,
      isFlaky: true,
    });
    return;
  } catch (err) {
    console.warn('[Dispatch] persistDeadEBAttempt failed (non-fatal):', err);
  }
}

async function executeViaPoolWorkers(
  tests: Test[],
  runId: string,
  options: ExecutionOptions,
  maxParallelEBs: number,
  recordActualRunner: (runnerId: string) => Promise<void>,
  onProgress?: (progress: ExecutionProgress) => void,
  onResult?: (result: TestRunResult) => Promise<void>,
): Promise<TestRunResult[] | null> {
  if (tests.length === 0) return [];
  const { claimOrProvisionPoolEB, releasePoolEB } = await import('@/server/actions/embedded-sessions');
  const { incBuildDispatch, decBuildDispatch, prewarmForBuild, ensureWarmPool, isKubernetesMode } =
    await import('@/lib/eb/provisioner');

  // Suppress per-release warm-pool refill while this build is dispatching.
  // ensureWarmPool no-ops; the build's claimOrProvisionPoolEB handles
  // provisioning on demand. Without this, every test release spawns up to
  // `warmPoolMin` replacement EBs that the build doesn't need and that get
  // reaped idle after TTL. See docs/eb-and-setup-plan.md B1.
  incBuildDispatch();

  // Pre-launch one EB per concurrent worker (plus one for the broadcast
  // setup, when configured) so the first batch of tests doesn't pay the
  // sequential cold-start cost. Throttled by awaitLaunchSlot internally.
  // See docs/eb-and-setup-plan.md B3.
  if (isKubernetesMode()) {
    const prewarmTarget = Math.min(maxParallelEBs, tests.length) + (options.setupInfo ? 1 : 0);
    prewarmForBuild(prewarmTarget).catch((err) => {
      console.warn('[Dispatch] prewarmForBuild failed (non-fatal):', err);
    });
  }
  try {

  const claimMaxWaitMs = parseInt(process.env.EB_CLAIM_MAX_WAIT_MS || '120000', 10);
  const claimWithRetry = async () => {
    const deadline = Date.now() + claimMaxWaitMs;
    let wait = 500;
    while (Date.now() < deadline) {
      const c = await claimOrProvisionPoolEB({ purpose: 'build' });
      if (c) return c;
      await new Promise((r) => setTimeout(r, wait));
      wait = Math.min(wait * 2, 5000);
    }
    return null;
  };

  const baseUrl = (options.environmentConfig?.baseUrl || 'http://localhost:3000').replace(/\/+$/, '');
  const viewport = options.playwrightSettings
    ? {
        width: options.playwrightSettings.viewportWidth || 1280,
        height: options.playwrightSettings.viewportHeight || 720,
      }
    : undefined;

  // One extra attempt if the first EB turns out to be dead-on-arrival (setup
  // throws with an infra-failure signature, or the test result surfaces a
  // "Target has been closed" style error). Anything beyond that is almost
  // certainly the test itself, not infra — surface the failure.
  const MAX_EB_ATTEMPTS = 2;
  // Split the dead-EB classifier (B5):
  //   - INFRA_RX matches things only the EB infra produces (refused conn,
  //     crash, runner registration loss) — retry immediately, no probe.
  //   - MAYBE_INFRA_RX matches Playwright-side messages that often coincide
  //     with EB failure but also occur in legitimate test cleanup
  //     ("Target has been closed", "page.screenshot ... Target page closed").
  //     We probe the EB's /health before deciding to burn another EB.
  const EB_INFRA_ERR_RX = /offline|crash|runner went|ECONNREFUSED|EB network unhealthy|EB-stalled/i;
  const EB_MAYBE_INFRA_ERR_RX = /Target .*has been closed|page\.screenshot.*Target page.*closed/i;
  // Explicit tag the executor emits for test-code-hung timeouts (runner alive,
  // ≥1 partial response received). Must NOT be treated as infra; the test was
  // actually running and the user's code is to blame.
  const TEST_HUNG_RX = /\(runner alive — test code hung;/;
  const isDeadEBError = async (msg: string, runnerId: string): Promise<boolean> => {
    // Only inspect the first line of the error. The executor appends a pod-
    // log tail (`[EB-pod …]\n<last 80 stdout lines>`) for diagnostics, and
    // that tail routinely contains "Target page, context or browser has been
    // closed" warnings emitted by Playwright AFTER the executor cancelled
    // the test on timeout — a substring match against the full message would
    // misclassify legit test-code hangs as dead-EB and burn a second pod.
    const firstLine = msg.split('\n')[0] ?? msg;
    // Explicit test-hung tag always wins — never retry.
    if (TEST_HUNG_RX.test(firstLine)) return false;
    // Explicit infra tags trigger retry without probing.
    if (EB_INFRA_ERR_RX.test(firstLine)) return true;
    if (!EB_MAYBE_INFRA_ERR_RX.test(firstLine)) return false;
    // Ambiguous Playwright "Target has been closed" — probe /health. If
    // reachable + 200, the EB is alive and this is a test-code issue; don't
    // waste another EB. If probe fails, treat as dead.
    return !(await probeEBHealth(runnerId));
  };

  const resultMap = new Map<string, TestRunResult>();
  let completedCount = 0;
  let activeCount = 0;
  let everClaimed = false;

  const updateProgress = (currentName?: string) => {
    onProgress?.({
      completed: completedCount,
      total: tests.length,
      currentTestName: currentName,
      activeCount,
      activeTests: currentName ? [currentName] : [],
    });
  };

  // ── One-shot broadcast setup ────────────────────────────────────────────
  // Run setup once on a dedicated EB. Capture its storageState as JSON so
  // every test-EB can cold-start from the same authenticated/seeded state.
  // Side-effecting setup (seed inserts, signups, API keys) runs exactly once.
  // The EB carrying the live setup context dies right after — we intentionally
  // don't reference it downstream, since cross-EB live-context reuse is the
  // very bug this dispatcher exists to prevent.
  let effectiveOptions = options;
  if (options.setupInfo) {
    let setupErr: string | undefined;
    for (let attempt = 1; attempt <= MAX_EB_ATTEMPTS; attempt++) {
      const eb = await claimWithRetry();
      if (!eb) {
        setupErr = `Could not claim an EB for broadcast setup within ${claimMaxWaitMs}ms`;
        break;
      }
      everClaimed = true;
      // Don't record the setup EB as the job's actualRunnerId. The recording
      // UI polls actualRunnerId to find which EB to attach its BrowserViewer
      // to; if it locks on the setup EB, that EB gets released as soon as
      // setup finishes and the viewer ends up with a dead/cleared streamUrl.
      // The test EB (recorded in runOneTest) is the only user-visible runner.
      console.log(`[Dispatch] Claimed EB ${eb.runnerId.slice(0, 8)} for broadcast setup (attempt ${attempt}/${MAX_EB_ATTEMPTS})`);
      try {
        const setupResult = await executeSetupViaRunner(
          options.setupInfo.code,
          `${runId}-setup`,
          eb.runnerId,
          baseUrl,
          viewport,
          options.playwrightSettings?.navigationTimeout ?? undefined,
          options.playwrightSettings,
        );
        // Prefer `storageStateJson` (portable JSON blob) over `storageState`
        // (may be a `persistent:<setupId>` marker pinned to the setup EB
        // that's about to be released). Each test-EB parses the JSON cold.
        const broadcastState = setupResult.storageStateJson ?? options.setupContext?.storageState;
        if (!setupResult.storageStateJson) {
          console.warn(`[Dispatch] Setup returned no storageStateJson — tests will cold-start without injected state. Expected for no-auth apps; surprising otherwise.`);
        }
        effectiveOptions = {
          ...options,
          setupInfo: undefined,
          setupContext: {
            storageState: broadcastState,
            variables: { ...options.setupContext?.variables, ...setupResult.variables },
          },
        };
        console.log(`[Dispatch] Broadcast setup complete (storageState: ${broadcastState ? 'captured' : 'none'})`);
        setupErr = undefined;
        break;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setupErr = msg;
        // Only retry on infra-looking failures — a real setup bug (script
        // error, bad selector, wrong URL) shouldn't consume EBs.
        if (attempt < MAX_EB_ATTEMPTS && await isDeadEBError(msg, eb.runnerId)) {
          console.warn(`[Dispatch] Broadcast setup hit dead-EB on attempt ${attempt}, retrying: ${msg}`);
          continue;
        }
        break;
      } finally {
        try { await releasePoolEB(eb.runnerId); } catch { /* ignore */ }
      }
    }
    if (setupErr) {
      console.error(`[Dispatch] Broadcast setup failed: ${setupErr}`);
      // Every test fails with the same setup error — there's no per-test
      // retry that can rescue a broken seed script or unreachable target.
      const failed = tests.map(t => ({
        testId: t.id,
        status: 'setup_failed' as const,
        durationMs: 0,
        screenshots: [],
        errorMessage: `Broadcast setup failed: ${setupErr}`,
      }));
      for (const r of failed) {
        try { await onResult?.(r); } catch (err) { console.error('[Dispatch] onResult threw for broadcast-setup-failed test:', err); }
      }
      return everClaimed ? failed : null;
    }
  }

  const fireResult = async (r: TestRunResult): Promise<TestRunResult> => {
    try { await onResult?.(r); } catch (err) { console.error('[Dispatch] onResult threw:', err); }
    return r;
  };

  const runOneTest = async (test: Test): Promise<TestRunResult> => {
    let lastError: string | undefined;
    for (let attempt = 1; attempt <= MAX_EB_ATTEMPTS; attempt++) {
      const eb = await claimWithRetry();
      if (!eb) {
        return fireResult({
          testId: test.id,
          status: 'setup_failed',
          durationMs: 0,
          screenshots: [],
          errorMessage: `Could not claim an EB within ${claimMaxWaitMs}ms`,
        });
      }
      everClaimed = true;
      await recordActualRunner(eb.runnerId);
      console.log(`[Dispatch] Claimed EB ${eb.runnerId.slice(0, 8)} for "${test.name}" (attempt ${attempt}/${MAX_EB_ATTEMPTS})`);

      try {
        const [result] = await executeViaRunner(
          [test],
          runId,
          eb.runnerId,
          { ...effectiveOptions, maxParallelTests: 1 },
          undefined,
          onResult,
        );

        // [Dispatch] result-shape log: blank-render runs return status=passed with no error
        // and may return 0 screenshots or odd label counts. Pair this with the EB-side
        // [Shot] line (which reports byte size + body content) when triaging.
        const screenshotCount = result?.screenshots?.length ?? 0;
        const labels = (result?.screenshots ?? []).map(s => s.label).join(',') || 'none';
        console.log(
          `[Dispatch] Test "${test.name}" attempt ${attempt} returned: status=${result?.status} screenshots=${screenshotCount} labels=[${labels}] error=${result?.errorMessage?.slice(0, 100) ?? 'none'}`,
        );

        if (!result) {
          lastError = 'Runner returned no result';
          continue;
        }

        const deadResult = result.status === 'failed'
          && !!result.errorMessage
          && attempt < MAX_EB_ATTEMPTS
          && await isDeadEBError(result.errorMessage, eb.runnerId);
        if (deadResult) {
          lastError = result.errorMessage!;
          console.warn(`[Dispatch] Dead-EB result on attempt ${attempt} for "${test.name}", retrying: ${lastError}`);
          await persistDeadEBAttempt(runId, test.id, attempt, lastError);
          continue;
        }
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        lastError = msg;
        if (attempt < MAX_EB_ATTEMPTS && await isDeadEBError(msg, eb.runnerId)) {
          console.warn(`[Dispatch] Dead-EB exception on attempt ${attempt} for "${test.name}", retrying: ${msg}`);
          await persistDeadEBAttempt(runId, test.id, attempt, msg);
          continue;
        }
        return fireResult({
          testId: test.id,
          status: 'failed',
          durationMs: 0,
          screenshots: [],
          errorMessage: msg,
        });
      } finally {
        try { await releasePoolEB(eb.runnerId); } catch { /* ignore */ }
      }
    }
    return fireResult({
      testId: test.id,
      status: 'setup_failed',
      durationMs: 0,
      screenshots: [],
      errorMessage: lastError || `Exhausted ${MAX_EB_ATTEMPTS} EB attempts`,
    });
  };

  console.log(`[Dispatch] Starting build run=${runId} — ${tests.length} tests, concurrency=${maxParallelEBs}`);

  // Semaphore: bound concurrent per-test dispatches. Each slot holds exactly
  // one EB for exactly one test — 1-job-1-EB.
  let inFlight = 0;
  const waiters: Array<() => void> = [];
  const acquire = () => new Promise<void>((resolve) => {
    if (inFlight < maxParallelEBs) {
      inFlight++;
      resolve();
    } else {
      waiters.push(() => { inFlight++; resolve(); });
    }
  });
  const release = () => {
    inFlight--;
    const next = waiters.shift();
    if (next) next();
  };

  await Promise.all(tests.map(async (test) => {
    await acquire();
    activeCount++;
    updateProgress(test.name);
    try {
      const r = await runOneTest(test);
      resultMap.set(test.id, r);
    } finally {
      activeCount--;
      completedCount++;
      updateProgress();
      release();
    }
  }));

  console.log(`[Dispatch] Build run=${runId} done — ${completedCount}/${tests.length} tests dispatched`);

  const results: TestRunResult[] = [];
  for (const t of tests) {
    const r = resultMap.get(t.id);
    if (r) {
      results.push(r);
    } else {
      const missing: TestRunResult = {
        testId: t.id,
        status: 'setup_failed',
        durationMs: 0,
        screenshots: [],
        errorMessage: 'Dispatch ended without recording a result',
      };
      try { await onResult?.(missing); } catch (err) { console.error('[Dispatch] onResult threw for missing-result test:', err); }
      results.push(missing);
    }
  }

  return everClaimed ? results : null;
  } finally {
    decBuildDispatch();
    // Let the warm pool catch up exactly once after the build finishes.
    // Fire-and-forget so the build response isn't blocked on a pool refill.
    ensureWarmPool().catch((err) => {
      console.warn('[Dispatch] post-build ensureWarmPool failed:', err);
    });
  }
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

  // 2. Try system EB pool. Every test gets a fresh EB (1-job-1-EB); the
  //    dispatcher is the single entry point whether there are 1 test or 100,
  //    serial or parallel. Returns null only if no EB could ever be claimed,
  //    letting us fall through to the queue path.
  const maxParallelEBs = Math.max(1, options.playwrightSettings?.maxParallelEBs ?? 10);
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

