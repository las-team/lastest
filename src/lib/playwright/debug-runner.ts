/**
 * Debug runner for step-by-step test execution.
 * Singleton per repo (same pattern as PlaywrightRunner).
 */

import { chromium, firefox, webkit, Browser, Page, BrowserContext } from 'playwright';
import { FREEZE_ANIMATIONS_SCRIPT, CROSS_OS_CHROMIUM_ARGS } from './constants';
import { setupFreezeScripts } from './stabilization';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { v4 as uuid } from 'uuid';
import type { Test, PlaywrightSettings, EnvironmentConfig } from '@/lib/db/schema';
import { DEFAULT_STABILIZATION_SETTINGS } from '@/lib/db/schema';
import { getSelectorStats, recordSelectorSuccess, recordSelectorFailure } from '@/lib/db/queries';
import { getServerManager } from './server-manager';
import { getSetupOrchestrator, testNeedsSetup } from '@/lib/setup/setup-orchestrator';
import type { SetupContext } from '@/lib/setup/types';
import { createAppState, createExpect, stripTypeAnnotations } from './runner';
import { parseSteps, extractTestBody, removeInlineLocateWithFallback, type DebugStep } from './debug-parser';
import { STORAGE_DIRS } from '@/lib/storage/paths';

export interface StepResult {
  stepId: number;
  status: 'passed' | 'failed' | 'pending';
  durationMs: number;
  error?: string;
}

export interface DebugNetworkEntry {
  id: string;
  stepIndex: number;
  method: string;
  url: string;
  status: number | null;
  resourceType: string;
  startTime: number;
  duration: number | null;
  failed: boolean;
  errorText?: string;
}

export interface DebugConsoleEntry {
  id: string;
  stepIndex: number;
  type: string;
  text: string;
  timestamp: number;
}

export interface DebugState {
  sessionId: string;
  testId: string;
  status: 'initializing' | 'paused' | 'stepping' | 'running' | 'completed' | 'error';
  currentStepIndex: number;
  steps: DebugStep[];
  stepResults: StepResult[];
  code: string;
  error?: string;
  networkEntries: DebugNetworkEntry[];
  consoleEntries: DebugConsoleEntry[];
  traceUrl?: string;
}

export type DebugCommand =
  | { type: 'step_forward' }
  | { type: 'step_back' }
  | { type: 'run_to_end' }
  | { type: 'run_to_step'; stepIndex: number }
  | { type: 'update_code'; code: string }
  | { type: 'stop' };

const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export class DebugRunner {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private settings: PlaywrightSettings | null = null;
  private environmentConfig: EnvironmentConfig | null = null;
  private repositoryId: string | null = null;
  private test: Test | null = null;

  private state: DebugState | null = null;
  private commandResolve: ((cmd: DebugCommand) => void) | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0; // incremented on each start(), stale runSession() bails out

  // Network/console capture
  private networkEntries: DebugNetworkEntry[] = [];
  private networkSeq = 0;
  private consoleEntries: DebugConsoleEntry[] = [];

  // Trace capture
  private traceDir = '';
  private traceChunkIndex = 0;
  private tracingActive = false;

  getState(): DebugState | null {
    return this.state;
  }

  isActive(): boolean {
    return this.state !== null && this.state.status !== 'completed' && this.state.status !== 'error';
  }

  /**
   * Start a debug session for a test.
   */
  async start(
    test: Test,
    settings: PlaywrightSettings | null,
    environmentConfig: EnvironmentConfig | null,
    repositoryId: string | null
  ): Promise<string> {
    if (this.isActive()) {
      await this.stop();
    }

    this.generation++;
    this.test = test;
    this.settings = settings;
    this.environmentConfig = environmentConfig;
    this.repositoryId = repositoryId;

    const sessionId = uuid();
    const code = test.code || '';
    const body = extractTestBody(code);

    if (!body) {
      this.state = {
        sessionId,
        testId: test.id,
        status: 'error',
        currentStepIndex: -1,
        steps: [],
        stepResults: [],
        code,
        error: 'Could not parse test function body',
        networkEntries: [],
        consoleEntries: [],
      };
      return sessionId;
    }

    const cleanBody = removeInlineLocateWithFallback(stripTypeAnnotations(body));
    const steps = parseSteps(cleanBody);

    this.state = {
      sessionId,
      testId: test.id,
      status: 'initializing',
      currentStepIndex: -1,
      steps,
      stepResults: steps.map(s => ({ stepId: s.id, status: 'pending' as const, durationMs: 0 })),
      code,
      networkEntries: [],
      consoleEntries: [],
    };

    // Launch browser and run initialization in background
    // Capture generation so stale calls from prior start() bail out
    const gen = this.generation;
    this.runSession(gen).catch(err => {
      if (this.state && this.generation === gen) {
        this.state.status = 'error';
        this.state.error = err?.message || String(err);
      }
    });

    return sessionId;
  }

  /**
   * Send a command to the running debug session.
   */
  sendCommand(command: DebugCommand): boolean {
    if (!this.state) return false;

    if (command.type === 'stop') {
      this.stop();
      return true;
    }

    if (command.type === 'update_code') {
      this.handleCodeUpdate(command.code);
      return true;
    }

    if (this.commandResolve) {
      this.commandResolve(command);
      this.commandResolve = null;
      return true;
    }

    return false;
  }

  /**
   * Stop the debug session and clean up.
   */
  async stop(): Promise<void> {
    this.clearIdleTimer();

    if (this.state) {
      this.state.status = 'completed';
    }

    // Resolve any pending command to unblock the run loop
    if (this.commandResolve) {
      this.commandResolve({ type: 'stop' });
      this.commandResolve = null;
    }

    // Small delay to let the run loop process the stop
    await new Promise(r => setTimeout(r, 100));

    // Save final trace before closing context
    if (this.context && this.tracingActive && this.state) {
      const traceFile = `debug-${this.state.sessionId}-${this.traceChunkIndex}.zip`;
      const tracePath = path.join(this.traceDir || STORAGE_DIRS.traces, traceFile);
      fs.mkdirSync(path.dirname(tracePath), { recursive: true });
      await this.context.tracing.stop({ path: tracePath }).catch(() => {});
      this.state.traceUrl = `/traces/${traceFile}`;
      this.tracingActive = false;
    }

    if (this.context) {
      await this.context.close().catch(() => {});
      this.context = null;
      this.page = null;
    }
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
  }

  // ------- Private -------

  private resetIdleTimer() {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      this.stop();
    }, IDLE_TIMEOUT_MS);
  }

  private clearIdleTimer() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private async waitForCommand(): Promise<DebugCommand> {
    this.resetIdleTimer();
    return new Promise<DebugCommand>(resolve => {
      this.commandResolve = resolve;
    });
  }

  private handleCodeUpdate(newCode: string) {
    if (!this.state) return;

    const body = extractTestBody(newCode);
    if (!body) return;

    const cleanBody = removeInlineLocateWithFallback(stripTypeAnnotations(body));
    const newSteps = parseSteps(cleanBody);

    // Map executed steps to new indices
    const executedCount = this.state.currentStepIndex + 1;
    let mismatchAt = -1;

    for (let i = 0; i < executedCount && i < newSteps.length; i++) {
      if (newSteps[i].code.trim() !== this.state.steps[i].code.trim()) {
        mismatchAt = i;
        break;
      }
    }

    // Update steps
    const newResults: StepResult[] = newSteps.map((s, i) => {
      if (i < executedCount && (mismatchAt === -1 || i < mismatchAt)) {
        // Keep existing results for matching steps
        return this.state!.stepResults[i] || { stepId: s.id, status: 'pending' as const, durationMs: 0 };
      }
      return { stepId: s.id, status: 'pending' as const, durationMs: 0 };
    });

    this.state.steps = newSteps;
    this.state.stepResults = newResults;
    this.state.code = newCode;

    if (mismatchAt !== -1 && mismatchAt < executedCount) {
      this.state.error = `Code changed at step ${mismatchAt + 1}. Step back to apply changes.`;
    }
  }

  private getBrowserLauncher() {
    const browserType = this.settings?.browser || 'chromium';
    switch (browserType) {
      case 'firefox': return firefox;
      case 'webkit': return webkit;
      default: return chromium;
    }
  }

  private getViewport() {
    return {
      width: this.settings?.viewportWidth || 1280,
      height: this.settings?.viewportHeight || 720,
    };
  }

  private getActionTimeout() {
    return this.settings?.actionTimeout || 5000;
  }

  private async createPageAndContext(): Promise<{ context: BrowserContext; page: Page }> {
    if (!this.browser) throw new Error('Browser not launched');

    const viewport = this.getViewport();
    const context = await this.browser.newContext({
      viewport,
      ...(this.settings?.acceptAnyCertificate ? { ignoreHTTPSErrors: true } : {}),
    });
    const page = await context.newPage();

    // Freeze timestamps/random values if configured
    const stabilization = this.settings?.stabilization || DEFAULT_STABILIZATION_SETTINGS;
    await setupFreezeScripts(page, stabilization);

    // Freeze CSS + JS animations if enabled (uses addInitScript to persist across navigations)
    if (this.settings?.freezeAnimations) {
      await page.addInitScript(FREEZE_ANIMATIONS_SCRIPT);
    }

    // Start Playwright tracing
    const testName = this.test?.name || 'unknown';
    await context.tracing.start({ screenshots: true, snapshots: true, title: `Debug: ${testName}` });
    this.tracingActive = true;

    // Attach network listeners
    page.on('request', (req) => {
      const id = `${req.method()}-${req.url()}-${Date.now()}-${this.networkSeq++}`;
      const entry: DebugNetworkEntry = {
        id,
        stepIndex: this.state?.currentStepIndex ?? -1,
        method: req.method(),
        url: req.url(),
        status: null,
        resourceType: req.resourceType(),
        startTime: Date.now(),
        duration: null,
        failed: false,
      };
      this.networkEntries.push(entry);
      // Memory cap
      if (this.networkEntries.length > 500) {
        this.networkEntries = this.networkEntries.slice(-500);
      }
      if (this.state) this.state.networkEntries = this.networkEntries;
    });

    page.on('response', (resp) => {
      const entry = this.networkEntries.findLast(
        e => e.url === resp.url() && e.status === null
      );
      if (entry) {
        entry.status = resp.status();
        entry.duration = Date.now() - entry.startTime;
      }
      if (this.state) this.state.networkEntries = this.networkEntries;
    });

    page.on('requestfailed', (req) => {
      const entry = this.networkEntries.findLast(
        e => e.url === req.url() && e.status === null
      );
      if (entry) {
        entry.failed = true;
        entry.errorText = req.failure()?.errorText;
        entry.duration = Date.now() - entry.startTime;
      }
      if (this.state) this.state.networkEntries = this.networkEntries;
    });

    // Attach console listener
    page.on('console', (msg) => {
      this.consoleEntries.push({
        id: `console-${Date.now()}-${this.consoleEntries.length}`,
        stepIndex: this.state?.currentStepIndex ?? -1,
        type: msg.type(),
        text: msg.text(),
        timestamp: Date.now(),
      });
      // Memory cap
      if (this.consoleEntries.length > 500) {
        this.consoleEntries = this.consoleEntries.slice(-500);
      }
      if (this.state) this.state.consoleEntries = this.consoleEntries;
    });

    this.context = context;
    this.page = page;
    return { context, page };
  }

  /**
   * Flush the current trace chunk and start a new one. Returns the URL of the saved trace.
   */
  async flushTrace(): Promise<string | null> {
    if (!this.context || !this.tracingActive || !this.state) return null;
    const traceFile = `debug-${this.state.sessionId}-${this.traceChunkIndex}.zip`;
    const tracePath = path.join(this.traceDir || STORAGE_DIRS.traces, traceFile);
    fs.mkdirSync(path.dirname(tracePath), { recursive: true });
    await this.context.tracing.stop({ path: tracePath });
    this.state.traceUrl = `/traces/${traceFile}`;
    this.traceChunkIndex++;
    await this.context.tracing.start({
      screenshots: true,
      snapshots: true,
      title: `Debug chunk ${this.traceChunkIndex}`,
    });
    return this.state.traceUrl;
  }

  private cleanOldTraces() {
    try {
      const dir = this.traceDir;
      if (!fs.existsSync(dir)) return;
      const files = fs.readdirSync(dir);
      const oneHourAgo = Date.now() - 60 * 60 * 1000;
      for (const file of files) {
        if (!file.endsWith('.zip')) continue;
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs < oneHourAgo) {
          fs.unlinkSync(filePath);
        }
      }
    } catch { /* ignore cleanup errors */ }
  }

  private createLocateWithFallback(page: Page, testId: string) {
    return async (
      pg: Page,
      selectors: { type: string; value: string }[],
      action: string,
      value?: string | null,
      coords?: { x: number; y: number } | null
    ) => {
      const hash = crypto.createHash('sha256').update(JSON.stringify(selectors)).digest('hex').slice(0, 16);
      let validSelectors = selectors.filter(s => s.value && s.value.trim() && !s.value.includes('undefined'));

      try {
        const stats = await getSelectorStats(testId, hash);
        if (stats.length > 0) {
          const statsMap = new Map(stats.map(s => [`${s.selectorType}:${s.selectorValue}`, s]));
          validSelectors = validSelectors.sort((a, b) => {
            const aStats = statsMap.get(`${a.type}:${a.value}`);
            const bStats = statsMap.get(`${b.type}:${b.value}`);
            return (bStats?.successCount ?? 0) - (aStats?.successCount ?? 0);
          });
          validSelectors = validSelectors.filter(s => {
            const stat = statsMap.get(`${s.type}:${s.value}`);
            if (!stat) return true;
            return !((stat.totalAttempts ?? 0) >= 3 && (stat.successCount ?? 0) === 0);
          });
        }
      } catch { /* continue */ }

      for (const sel of validSelectors) {
        const start = Date.now();
        try {
          let locator;
          if (sel.type === 'ocr-text') {
            const text = sel.value.replace(/^ocr-text="/, '').replace(/"$/, '');
            locator = pg.getByText(text, { exact: false });
          } else if (sel.type === 'role-name') {
            const match = sel.value.match(/^role=(\w+)\[name="(.+)"\]$/);
            if (match) locator = pg.getByRole(match[1] as 'button' | 'link' | 'heading', { name: match[2] });
            else locator = pg.locator(sel.value);
          } else {
            locator = pg.locator(sel.value);
          }
          const target = locator.first();
          await target.waitFor({ timeout: 3000 });
          if (action === 'click') await target.click();
          else if (action === 'fill') await target.fill(value || '');
          else if (action === 'selectOption') await target.selectOption(value || '');
          recordSelectorSuccess(testId, hash, sel.type, sel.value, Date.now() - start).catch(() => {});
          return;
        } catch {
          recordSelectorFailure(testId, hash, sel.type, sel.value).catch(() => {});
          continue;
        }
      }
      if (action === 'click' && coords) {
        await pg.mouse.click(coords.x, coords.y);
        return;
      }
      throw new Error('No selector matched: ' + JSON.stringify(validSelectors));
    };
  }

  /** Check if this runSession invocation is still current */
  private isStale(gen: number): boolean {
    return this.generation !== gen;
  }

  /**
   * Main session loop. Runs in background after start().
   */
  private async runSession(gen: number): Promise<void> {
    if (!this.state || !this.test) return;

    try {
      // Bail out if a newer start() was called
      if (this.isStale(gen)) return;

      // Ensure server is running
      const serverManager = getServerManager();
      if (this.environmentConfig) {
        serverManager.setConfig(this.environmentConfig);
      }
      const serverStatus = await serverManager.ensureServerRunning();
      if (!serverStatus.ready) {
        throw new Error(serverStatus.error || 'Server not ready');
      }

      if (this.isStale(gen)) return;

      // Init trace directory
      this.traceDir = STORAGE_DIRS.traces;
      fs.mkdirSync(this.traceDir, { recursive: true });
      this.traceChunkIndex = 0;
      this.cleanOldTraces();

      // Launch browser (always headed for debug)
      const launcher = this.getBrowserLauncher();
      const stabilization = this.settings?.stabilization || DEFAULT_STABILIZATION_SETTINGS;
      const browserType = this.settings?.browser || 'chromium';
      const launchArgs = (stabilization.crossOsConsistency && browserType === 'chromium')
        ? CROSS_OS_CHROMIUM_ARGS
        : [];

      this.browser = await launcher.launch({
        headless: false,
        args: launchArgs.length > 0 ? launchArgs : undefined,
      });

      // If a newer start() fired while we were launching, close and bail
      if (this.isStale(gen)) {
        await this.browser.close().catch(() => {});
        this.browser = null;
        return;
      }

      await this.createPageAndContext();

      if (!this.page || !this.context) throw new Error('Failed to create page');

      // Resolve base URL
      const baseUrl = this.environmentConfig?.baseUrl || serverManager.resolveUrl('http://localhost:3000').replace(/\/$/, '') || 'http://localhost:3000';

      // Prepare screenshot path
      const screenshotDir = this.repositoryId
        ? path.join(STORAGE_DIRS.screenshots, this.repositoryId)
        : STORAGE_DIRS.screenshots;
      if (!fs.existsSync(screenshotDir)) {
        fs.mkdirSync(screenshotDir, { recursive: true });
      }
      const screenshotPath = path.join(screenshotDir, `debug-${this.state.sessionId}.png`);

      // Run setup if needed
      const test = this.test;
      if (await testNeedsSetup(test)) {
        const orchestrator = getSetupOrchestrator();
        const baseContext: SetupContext = {
          baseUrl: baseUrl.replace(/\/$/, ''),
          page: this.page,
          variables: {},
          repositoryId: this.repositoryId,
        };
        const setupResult = await orchestrator.runTestSetup(test, this.page, baseContext);
        if (!setupResult.success) {
          throw new Error(`Setup failed: ${setupResult.error}`);
        }
        // Wait for page to settle after setup
        const setupPageUrl = this.page.url();
        try {
          await this.page.waitForURL(
            url => url.toString() !== setupPageUrl,
            { timeout: 10000, waitUntil: 'networkidle' }
          );
        } catch { /* URL didn't change */ }
      }

      // Create helpers
      const expectFn = createExpect(this.getActionTimeout());
      const appStateFn = createAppState(this.page);
      const locateWithFallback = this.createLocateWithFallback(this.page, test.id);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const stepLogger = { log: (_msg: string) => { /* no-op in debug mode */ } };

      // Auto-execute variable and log steps at the start
      let firstActionIdx = 0;
      for (let i = 0; i < this.state.steps.length; i++) {
        const step = this.state.steps[i];
        if (step.type !== 'variable' && step.type !== 'log') {
          firstActionIdx = i;
          break;
        }
        if (i === this.state.steps.length - 1) {
          firstActionIdx = this.state.steps.length;
        }
      }

      // Execute initial variable/log steps
      if (firstActionIdx > 0) {
        await this.executeStepsRange(0, firstActionIdx - 1, {
          page: this.page, baseUrl, screenshotPath, stepLogger, expectFn, appStateFn, locateWithFallback,
        });
      }

      // Set initial position
      this.state.currentStepIndex = firstActionIdx > 0 ? firstActionIdx - 1 : -1;
      this.state.status = 'paused';

      // Main command loop
      while (true) {
        if (this.state.status === 'completed' || this.state.status === 'error') break;
        const cmd = await this.waitForCommand();

        if (cmd.type === 'stop') {
          this.state.status = 'completed';
          break;
        }

        if (cmd.type === 'step_forward') {
          const nextIdx = this.state.currentStepIndex + 1;
          if (nextIdx >= this.state.steps.length) {
            this.state.status = 'completed';
            break;
          }
          this.state.status = 'stepping';
          await this.executeSingleStep(nextIdx, {
            page: this.page!, baseUrl, screenshotPath, stepLogger, expectFn, appStateFn, locateWithFallback,
          });
          this.state.currentStepIndex = nextIdx;

          if (this.state.stepResults[nextIdx]?.status === 'failed') {
            this.state.status = 'error';
            this.state.error = this.state.stepResults[nextIdx].error;
          } else if (nextIdx >= this.state.steps.length - 1) {
            this.state.status = 'completed';
          } else {
            this.state.status = 'paused';
          }
        }

        else if (cmd.type === 'step_back') {
          if (this.state.currentStepIndex <= 0) continue;
          const targetIdx = this.state.currentStepIndex - 1;

          this.state.status = 'stepping';
          this.state.error = undefined;

          // Save trace chunk before closing context
          if (this.context && this.tracingActive) {
            const traceFile = `debug-${this.state.sessionId}-${this.traceChunkIndex}.zip`;
            const tracePath = path.join(this.traceDir || STORAGE_DIRS.traces, traceFile);
            fs.mkdirSync(path.dirname(tracePath), { recursive: true });
            await this.context.tracing.stop({ path: tracePath }).catch(() => {});
            this.state.traceUrl = `/traces/${traceFile}`;
            this.traceChunkIndex++;
            this.tracingActive = false;
          }

          // Reset: close page/context, recreate, re-execute 0..targetIdx
          if (this.context) {
            await this.context.close().catch(() => {});
            this.context = null;
            this.page = null;
          }

          // Clear network/console entries for replay
          this.networkEntries = [];
          this.networkSeq = 0;
          this.consoleEntries = [];
          if (this.state) {
            this.state.networkEntries = this.networkEntries;
            this.state.consoleEntries = this.consoleEntries;
          }

          await this.createPageAndContext();
          if (!this.page) throw new Error('Failed to recreate page');

          // Re-run setup if needed
          if (await testNeedsSetup(test)) {
            const orchestrator = getSetupOrchestrator();
            const baseContext: SetupContext = {
              baseUrl: baseUrl.replace(/\/$/, ''),
              page: this.page,
              variables: {},
              repositoryId: this.repositoryId,
            };
            const setupResult = await orchestrator.runTestSetup(test, this.page, baseContext);
            if (!setupResult.success) {
              this.state.status = 'error';
              this.state.error = `Setup failed on replay: ${setupResult.error}`;
              continue;
            }
            const setupPageUrl = this.page.url();
            try {
              await this.page.waitForURL(
                url => url.toString() !== setupPageUrl,
                { timeout: 10000, waitUntil: 'networkidle' }
              );
            } catch { /* URL didn't change */ }
          }

          // Recreate helpers with new page
          const newExpect = createExpect(this.getActionTimeout());
          const newAppState = createAppState(this.page);
          const newLocate = this.createLocateWithFallback(this.page, test.id);

          // Reset all step results
          for (let i = 0; i < this.state.stepResults.length; i++) {
            this.state.stepResults[i] = { stepId: i, status: 'pending', durationMs: 0 };
          }

          // Re-execute steps 0..targetIdx
          await this.executeStepsRange(0, targetIdx, {
            page: this.page, baseUrl, screenshotPath, stepLogger, expectFn: newExpect, appStateFn: newAppState, locateWithFallback: newLocate,
          });

          this.state.currentStepIndex = targetIdx;
          // Update helpers for subsequent steps
          Object.assign(expectFn, newExpect);
          Object.assign(appStateFn, newAppState);

          if (this.state.stepResults[targetIdx]?.status === 'failed') {
            this.state.status = 'error';
            this.state.error = this.state.stepResults[targetIdx].error;
          } else {
            this.state.status = 'paused';
          }
        }

        else if (cmd.type === 'run_to_end') {
          this.state.status = 'running';
          const startIdx = this.state.currentStepIndex + 1;
          for (let i = startIdx; i < this.state.steps.length; i++) {
            if (this.state.status !== 'running') break;
            await this.executeSingleStep(i, {
              page: this.page!, baseUrl, screenshotPath, stepLogger, expectFn, appStateFn, locateWithFallback,
            });
            this.state.currentStepIndex = i;
            if (this.state.stepResults[i]?.status === 'failed') {
              this.state.status = 'error';
              this.state.error = this.state.stepResults[i].error;
              break;
            }
          }
          if (this.state.status === 'running') {
            this.state.status = 'completed';
          }
        }

        else if (cmd.type === 'run_to_step') {
          const targetIdx = cmd.stepIndex;
          if (targetIdx <= this.state.currentStepIndex || targetIdx >= this.state.steps.length) continue;
          this.state.status = 'running';
          for (let i = this.state.currentStepIndex + 1; i <= targetIdx; i++) {
            if (this.state.status !== 'running') break;
            await this.executeSingleStep(i, {
              page: this.page!, baseUrl, screenshotPath, stepLogger, expectFn, appStateFn, locateWithFallback,
            });
            this.state.currentStepIndex = i;
            if (this.state.stepResults[i]?.status === 'failed') {
              this.state.status = 'error';
              this.state.error = this.state.stepResults[i].error;
              break;
            }
          }
          if (this.state.status === 'running') {
            this.state.status = 'paused';
          }
        }
      }

    } catch (err) {
      if (this.state) {
        this.state.status = 'error';
        this.state.error = err instanceof Error ? err.message : String(err);
      }
    }
  }

  /**
   * Build and execute a single step using cumulative code approach.
   */
  private async executeSingleStep(
    stepIdx: number,
    ctx: StepContext
  ): Promise<void> {
    if (!this.state) return;
    const step = this.state.steps[stepIdx];
    if (!step) return;

    const start = Date.now();
    try {
      // Build cumulative code: all previous steps + current step
      const cumulativeCode = this.state.steps
        .slice(0, stepIdx + 1)
        .map(s => s.code)
        .join('\n');

      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      const fn = new AsyncFunction(
        'page', 'baseUrl', 'screenshotPath', 'stepLogger', 'expect', 'appState', 'locateWithFallback',
        cumulativeCode
      );

      // For cumulative execution, we re-run everything but only care about errors on the last step
      // However, this is inefficient. Instead, use scope tracking approach.

      // Simpler: Just execute the current step's code directly.
      // Variables from previous steps are captured via closure in cumulative mode.
      // Actually, each step is a fresh AsyncFunction, so we need cumulative.

      await fn(ctx.page, ctx.baseUrl, ctx.screenshotPath, ctx.stepLogger, ctx.expectFn, ctx.appStateFn, ctx.locateWithFallback);

      this.state.stepResults[stepIdx] = {
        stepId: step.id,
        status: 'passed',
        durationMs: Date.now() - start,
      };
    } catch (err) {
      this.state.stepResults[stepIdx] = {
        stepId: step.id,
        status: 'failed',
        durationMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Execute a range of steps rapidly (for replay/init).
   */
  private async executeStepsRange(
    startIdx: number,
    endIdx: number,
    ctx: StepContext
  ): Promise<void> {
    if (!this.state) return;

    // Execute all steps in range as a single block for efficiency
    const cumulativeCode = this.state.steps
      .slice(startIdx, endIdx + 1)
      .map(s => s.code)
      .join('\n');

    if (!cumulativeCode.trim()) return;

    const start = Date.now();
    try {
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      const fn = new AsyncFunction(
        'page', 'baseUrl', 'screenshotPath', 'stepLogger', 'expect', 'appState', 'locateWithFallback',
        cumulativeCode
      );
      await fn(ctx.page, ctx.baseUrl, ctx.screenshotPath, ctx.stepLogger, ctx.expectFn, ctx.appStateFn, ctx.locateWithFallback);

      // Mark all steps as passed
      for (let i = startIdx; i <= endIdx; i++) {
        this.state.stepResults[i] = {
          stepId: this.state.steps[i].id,
          status: 'passed',
          durationMs: Math.round((Date.now() - start) / (endIdx - startIdx + 1)),
        };
      }
    } catch (err) {
      // Mark the last step as failed (we don't know which one failed)
      for (let i = startIdx; i <= endIdx; i++) {
        this.state.stepResults[i] = {
          stepId: this.state.steps[i].id,
          status: i === endIdx ? 'failed' : 'passed',
          durationMs: 0,
          error: i === endIdx ? (err instanceof Error ? err.message : String(err)) : undefined,
        };
      }
    }
  }
}

interface StepContext {
  page: Page;
  baseUrl: string;
  screenshotPath: string;
  stepLogger: { log: (msg: string) => void };
  expectFn: ReturnType<typeof createExpect>;
  appStateFn: ReturnType<typeof createAppState>;
  locateWithFallback: (
    pg: Page,
    selectors: { type: string; value: string }[],
    action: string,
    value?: string | null,
    coords?: { x: number; y: number } | null
  ) => Promise<void>;
}

// Singleton per repository
let debugInstance: DebugRunner | null = null;
let debugRepositoryId: string | null = null;

/**
 * Get (or create) the debug runner singleton.
 * - Called with no args: returns existing instance (for polling/commands).
 * - Called with a repoId: creates a new instance if repo changed.
 */
export function getDebugRunner(repositoryId?: string | null): DebugRunner {
  // When called without a repositoryId, return existing instance (polling path)
  if (repositoryId === undefined) {
    if (!debugInstance) {
      debugInstance = new DebugRunner();
    }
    return debugInstance;
  }

  const repoId = repositoryId ?? null;

  if (!debugInstance || debugRepositoryId !== repoId) {
    if (debugInstance?.isActive()) {
      // Force stop existing session
      debugInstance.stop().catch(() => {});
    }
    debugRepositoryId = repoId;
    debugInstance = new DebugRunner();
  }

  return debugInstance;
}
