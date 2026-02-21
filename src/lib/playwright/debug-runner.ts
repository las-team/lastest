/**
 * Debug runner for step-by-step test execution.
 * Uses checkpoint-based execution: one instrumented function with
 * pause points between steps, avoiding O(n^2) cumulative re-execution.
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
import { createAppState, createExpect, stripTypeAnnotations, validateTestCode } from './runner';
import { parseSteps, extractTestBody, removeInlineLocateWithFallback, removeInlineReplayCursorPath, type DebugStep } from './debug-parser';
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

// -------- Checkpoint Execution Support --------

class StopError extends Error {
  constructor() {
    super('Debug execution stopped');
    this.name = 'StopError';
  }
}

/**
 * Controls flow at checkpoint boundaries in the instrumented function.
 * Modes: paused (wait), running (pass-through), run_to_step (pass until target), stopped (throw).
 */
class PauseController {
  private mode: 'paused' | 'running' | 'run_to_step' | 'stopped';
  private target: number;
  private pendingResolve: (() => void) | null = null;
  private pendingReject: ((err: Error) => void) | null = null;
  private onPause: () => void;

  constructor(mode: 'paused' | 'running' | 'run_to_step', target: number, onPause: () => void) {
    this.mode = mode;
    this.target = target;
    this.onPause = onPause;
  }

  async waitIfNeeded(stepIdx: number): Promise<void> {
    if (this.mode === 'stopped') throw new StopError();
    if (this.mode === 'running') return;
    if (this.mode === 'run_to_step' && stepIdx < this.target) return;

    // Transition run_to_step → paused when target reached
    if (this.mode === 'run_to_step') this.mode = 'paused';
    this.onPause();

    return new Promise<void>((resolve, reject) => {
      this.pendingResolve = resolve;
      this.pendingReject = reject;
    });
  }

  resume(newMode: 'paused' | 'running' | 'run_to_step', target?: number): void {
    this.mode = newMode;
    if (target !== undefined) this.target = target;
    const resolve = this.pendingResolve;
    this.pendingResolve = null;
    this.pendingReject = null;
    resolve?.();
  }

  stop(): void {
    this.mode = 'stopped';
    const reject = this.pendingReject;
    this.pendingResolve = null;
    this.pendingReject = null;
    reject?.(new StopError());
  }
}

// -------- Debug Runner --------

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
  private generation = 0;
  private pauseController: PauseController | null = null;

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

    const cleanBody = removeInlineReplayCursorPath(
      removeInlineLocateWithFallback(stripTypeAnnotations(body))
    );
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

    // Abort running instrumented function
    this.pauseController?.stop();
    this.pauseController = null;

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

    const cleanBody = removeInlineReplayCursorPath(
      removeInlineLocateWithFallback(stripTypeAnnotations(body))
    );
    const newSteps = parseSteps(cleanBody);

    const executedCount = this.state.currentStepIndex + 1;
    let mismatchAt = -1;

    for (let i = 0; i < executedCount && i < newSteps.length; i++) {
      if (newSteps[i].code.trim() !== this.state.steps[i].code.trim()) {
        mismatchAt = i;
        break;
      }
    }

    const newResults: StepResult[] = newSteps.map((s, i) => {
      if (i < executedCount && (mismatchAt === -1 || i < mismatchAt)) {
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
      ...(this.settings?.freezeAnimations ? { reducedMotion: 'reduce' } : {}),
      ...(this.settings?.grantClipboardAccess ? { permissions: ['clipboard-read', 'clipboard-write'] } : {}),
      ...(this.settings?.acceptDownloads ? { acceptDownloads: true } : {}),
    });
    const page = await context.newPage();

    // Freeze timestamps/random values if configured
    const stabilization = this.settings?.stabilization || DEFAULT_STABILIZATION_SETTINGS;
    await setupFreezeScripts(page, stabilization);

    // Freeze CSS + JS animations if enabled
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
   * Flush the current trace chunk and start a new one.
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

  private isStale(gen: number): boolean {
    return this.generation !== gen;
  }

  /**
   * Create all 12 helper parameters matching the main runner's signature.
   */
  private createHelpers(page: Page, testId: string) {
    const expectFn = createExpect(this.getActionTimeout());
    const appStateFn = createAppState(page);
    const locateWithFallback = this.createLocateWithFallback(page, testId);

    /* eslint-disable @typescript-eslint/no-unused-vars */
    const stepLogger = {
      log: (_msg: string) => { /* no-op in debug mode */ },
      warn: (_msg: string) => { /* captured by soft error wrapping */ },
    };
    /* eslint-enable @typescript-eslint/no-unused-vars */

    // File upload helper
    const fileUpload = async (selector: string, filePaths: string | string[]) => {
      const locator = page.locator(selector);
      await locator.setInputFiles(Array.isArray(filePaths) ? filePaths : [filePaths]);
    };

    // Clipboard helper — available when grantClipboardAccess is enabled
    const clipboard = this.settings?.grantClipboardAccess ? {
      copy: async (text: string) => {
        await page.evaluate((t) => navigator.clipboard.writeText(t), text);
      },
      paste: async () => {
        return await page.evaluate(() => navigator.clipboard.readText());
      },
      pasteInto: async (selector: string) => {
        await page.locator(selector).focus();
        await page.keyboard.press('Control+V');
      },
    } : null;

    // Downloads helper — available when acceptDownloads is enabled
    const dlDir = this.settings?.acceptDownloads
      ? path.join(STORAGE_DIRS.screenshots, this.repositoryId || 'default', 'downloads')
      : '';
    if (dlDir) fs.mkdirSync(dlDir, { recursive: true });
    const dlList: Array<{ suggestedFilename: string; path: string }> = [];
    const downloads = this.settings?.acceptDownloads ? {
      waitForDownload: async (triggerAction: () => Promise<void>) => {
        const [download] = await Promise.all([
          page.waitForEvent('download'),
          triggerAction(),
        ]);
        const safeName = path.basename(download.suggestedFilename()).replace(/\.\./g, '_');
        const savePath = path.join(dlDir, safeName);
        await download.saveAs(savePath);
        dlList.push({ suggestedFilename: safeName, path: savePath });
        return { filename: safeName, path: savePath };
      },
      list: () => dlList,
    } : null;

    // Network interception helper — available when enableNetworkInterception is enabled
    const network = this.settings?.enableNetworkInterception ? {
      mock: async (urlPattern: string, response: { status?: number; body?: string; contentType?: string; json?: unknown }) => {
        await page.route(urlPattern, async (route) => {
          await route.fulfill({
            status: response.status ?? 200,
            contentType: response.contentType ?? (response.json ? 'application/json' : 'text/plain'),
            body: response.json ? JSON.stringify(response.json) : (response.body ?? ''),
          });
        });
      },
      block: async (urlPattern: string) => {
        await page.route(urlPattern, (route) => route.abort());
      },
      passthrough: async (urlPattern: string) => {
        await page.unroute(urlPattern);
      },
      capture: (urlPattern: string) => {
        const captured: Array<{ url: string; method: string; postData?: string }> = [];
        page.on('request', (req) => {
          if (new RegExp(urlPattern).test(req.url())) {
            captured.push({ url: req.url(), method: req.method(), postData: req.postData() ?? undefined });
          }
        });
        return { requests: captured };
      },
    } : null;

    // Speed-aware replayCursorPath — respects cursorPlaybackSpeed setting
    const cursorPlaybackSpeed = this.settings?.cursorPlaybackSpeed ?? 1;
    const replayCursorPath = async (pg: Page, moves: [number, number, number][]) => {
      for (const [x, y, delay] of moves) {
        await pg.mouse.move(x, y);
        if (delay > 0 && cursorPlaybackSpeed > 0) {
          await pg.waitForTimeout(Math.round(delay / cursorPlaybackSpeed));
        }
      }
    };

    return { expectFn, appStateFn, locateWithFallback, stepLogger, fileUpload, clipboard, downloads, network, replayCursorPath };
  }

  /**
   * Build instrumented code: step code interleaved with __checkpoint() calls,
   * with soft error wrapping on await statements.
   */
  private buildInstrumentedCode(steps: DebugStep[]): string {
    const parts: string[] = [];
    for (let i = 0; i < steps.length; i++) {
      parts.push(`await __checkpoint(${i});`);
      parts.push(steps[i].code);
    }
    // Final checkpoint marks last step as done
    parts.push(`await __checkpoint(${steps.length});`);

    let code = parts.join('\n');

    // Soft error wrapping: wrap standalone await statements in try/catch
    // (same regex as main runner) — skip screenshots and checkpoints
    code = code.replace(/^(\s*)(await\s+.+;)\s*$/gm, (_match, indent, stmt) => {
      if (stmt.includes('.screenshot(')) return `${indent}${stmt}`;
      if (stmt.includes('__checkpoint(')) return `${indent}${stmt}`;
      return `${indent}try { ${stmt} } catch(__softErr) { stepLogger.warn(typeof __softErr === 'object' && __softErr !== null && 'message' in __softErr ? __softErr.message : String(__softErr)); }`;
    });

    return code;
  }

  /**
   * Compute index of first non-variable/log step.
   */
  private getFirstActionIndex(steps: DebugStep[]): number {
    for (let i = 0; i < steps.length; i++) {
      if (steps[i].type !== 'variable' && steps[i].type !== 'log') return i;
    }
    return steps.length;
  }

  /**
   * Run setup steps if the test requires them.
   */
  private async runSetupIfNeeded(test: Test, page: Page, baseUrl: string): Promise<void> {
    if (!await testNeedsSetup(test)) return;
    const orchestrator = getSetupOrchestrator();
    const baseContext: SetupContext = {
      baseUrl: baseUrl.replace(/\/$/, ''),
      page,
      variables: {},
      repositoryId: this.repositoryId,
    };
    const setupResult = await orchestrator.runTestSetup(test, page, baseContext);
    if (!setupResult.success) {
      throw new Error(`Setup failed: ${setupResult.error}`);
    }
    const setupPageUrl = page.url();
    try {
      await page.waitForURL(
        url => url.toString() !== setupPageUrl,
        { timeout: 10000, waitUntil: 'networkidle' }
      );
    } catch { /* URL didn't change */ }
  }

  /**
   * Resolve Google Sheets {{sheet:...}} references in step code.
   */
  private async resolveSheetReferences(steps: DebugStep[]): Promise<void> {
    const hasSheetRefs = steps.some(s => s.code.includes('{{sheet:'));
    if (!hasSheetRefs) return;

    try {
      const { resolveSheetReferences } = await import('@/lib/google-sheets/resolver');
      const { getGoogleSheetsDataSources } = await import('@/lib/db/queries');
      const repoId = this.test?.repositoryId || this.repositoryId;
      if (!repoId) return;
      const dataSources = await getGoogleSheetsDataSources(repoId);
      if (dataSources.length === 0) return;
      for (const step of steps) {
        if (step.code.includes('{{sheet:')) {
          const result = resolveSheetReferences(step.code, dataSources);
          step.code = result.resolvedCode;
        }
      }
    } catch { /* ignore resolution failures */ }
  }

  /**
   * Launch instrumented execution. Returns a promise that resolves when all steps
   * complete or rejects on hard error / StopError.
   */
  private launchExecution(
    steps: DebugStep[],
    pauseCtrl: PauseController,
    page: Page,
    baseUrl: string,
    screenshotPath: string,
    helpers: ReturnType<typeof this.createHelpers>,
  ): Promise<void> {
    const state = this.state!;
    const totalSteps = steps.length;
    const stepStartTimes: number[] = new Array(totalSteps).fill(0);
    let executingStepIdx = -1;

    const __checkpoint = async (n: number) => {
      const now = Date.now();

      // Mark previous step as passed
      if (n > 0 && n <= totalSteps) {
        const prev = n - 1;
        state.stepResults[prev] = {
          stepId: steps[prev].id,
          status: 'passed',
          durationMs: now - stepStartTimes[prev],
        };
        state.currentStepIndex = prev;
      }

      // All steps done
      if (n >= totalSteps) return;

      // About to start step n
      executingStepIdx = n;
      stepStartTimes[n] = now;

      await pauseCtrl.waitIfNeeded(n);
    };

    const instrumentedCode = this.buildInstrumentedCode(steps);

    // Validate before execution
    try {
      validateTestCode(instrumentedCode);
    } catch (err) {
      return Promise.reject(err);
    }

    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const fn = new AsyncFunction(
      'page', 'baseUrl', 'screenshotPath', 'stepLogger', 'expect', 'appState',
      'locateWithFallback', 'fileUpload', 'clipboard', 'downloads', 'network',
      'replayCursorPath', '__checkpoint',
      instrumentedCode,
    );

    return fn(
      page, baseUrl, screenshotPath, helpers.stepLogger, helpers.expectFn, helpers.appStateFn,
      helpers.locateWithFallback, helpers.fileUpload, helpers.clipboard, helpers.downloads,
      helpers.network, helpers.replayCursorPath, __checkpoint,
    ).catch((err: unknown) => {
      if (err instanceof StopError) throw err; // propagate StopError as-is

      // Mark current step as failed
      if (executingStepIdx >= 0 && executingStepIdx < totalSteps) {
        state.stepResults[executingStepIdx] = {
          stepId: steps[executingStepIdx].id,
          status: 'failed',
          durationMs: Date.now() - stepStartTimes[executingStepIdx],
          error: err instanceof Error ? err.message : String(err),
        };
        state.currentStepIndex = executingStepIdx;
      }
      throw err; // re-throw for runSession to handle
    });
  }

  /**
   * Main session loop. Runs in background after start().
   */
  private async runSession(gen: number): Promise<void> {
    if (!this.state || !this.test) return;

    try {
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
      await this.runSetupIfNeeded(test, this.page, baseUrl);

      // Resolve Google Sheets references
      const steps = this.state.steps;
      await this.resolveSheetReferences(steps);

      // Determine first action step (skip leading variable/log steps)
      const firstActionIdx = this.getFirstActionIndex(steps);

      // Create helpers
      let helpers = this.createHelpers(this.page, test.id);

      // Choose initial PauseController mode
      let initMode: 'paused' | 'running' | 'run_to_step';
      let initTarget: number;
      if (firstActionIdx >= steps.length) {
        // All steps are variables/logs — run them all
        initMode = 'running';
        initTarget = 0;
      } else if (firstActionIdx > 0) {
        // Auto-execute leading variable/log steps
        initMode = 'run_to_step';
        initTarget = firstActionIdx;
      } else {
        initMode = 'paused';
        initTarget = 0;
      }

      let pauseCtrl = new PauseController(initMode, initTarget, () => {
        if (this.state) this.state.status = 'paused';
      });
      this.pauseController = pauseCtrl;

      // Launch instrumented execution in background
      const startExecution = (pc: PauseController, h: ReturnType<typeof this.createHelpers>, pg: Page) => {
        this.launchExecution(steps, pc, pg, baseUrl, screenshotPath, h).then(() => {
          if (this.state && this.state.status !== 'completed' && this.state.status !== 'error') {
            this.state.status = 'completed';
          }
          // Unblock command loop
          if (this.commandResolve) {
            this.commandResolve({ type: 'stop' });
            this.commandResolve = null;
          }
        }).catch((err) => {
          if (err instanceof StopError) return; // expected abort
          const execError = err instanceof Error ? err : new Error(String(err));
          if (this.state) {
            this.state.status = 'error';
            this.state.error = execError.message;
          }
          // Unblock command loop
          if (this.commandResolve) {
            this.commandResolve({ type: 'stop' });
            this.commandResolve = null;
          }
        });
      };

      startExecution(pauseCtrl, helpers, this.page);

      // Command loop
      while (true) {
        if (this.state.status === 'completed') break;
        if (this.isStale(gen)) break;

        const cmd = await this.waitForCommand();

        if (cmd.type === 'stop') {
          pauseCtrl.stop();
          if (this.state.status !== 'error') {
            this.state.status = 'completed';
          }
          break;
        }

        // step_back — always allowed (even after error), requires currentStepIndex > 0
        if (cmd.type === 'step_back') {
          if (this.state.currentStepIndex <= 0) continue;
          const targetIdx = this.state.currentStepIndex - 1;

          this.state.status = 'stepping';
          this.state.error = undefined;

          // Abort current execution
          pauseCtrl.stop();
          // Give execution promise time to settle
          await new Promise(r => setTimeout(r, 50));

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

          // Close context (keep browser)
          if (this.context) {
            await this.context.close().catch(() => {});
            this.context = null;
            this.page = null;
          }

          // Clear network/console for replay
          this.networkEntries = [];
          this.networkSeq = 0;
          this.consoleEntries = [];
          this.state.networkEntries = this.networkEntries;
          this.state.consoleEntries = this.consoleEntries;

          // Recreate page and context
          await this.createPageAndContext();
          if (!this.page) throw new Error('Failed to recreate page');

          // Re-run setup
          await this.runSetupIfNeeded(test, this.page, baseUrl);

          // Recreate helpers with new page
          helpers = this.createHelpers(this.page, test.id);

          // Reset all step results
          for (let i = 0; i < this.state.stepResults.length; i++) {
            this.state.stepResults[i] = { stepId: steps[i].id, status: 'pending', durationMs: 0 };
          }

          // New PauseController: run_to_step replaying 0..targetIdx, then pause
          pauseCtrl = new PauseController('run_to_step', targetIdx + 1, () => {
            if (this.state) this.state.status = 'paused';
          });
          this.pauseController = pauseCtrl;

          // Restart execution
          startExecution(pauseCtrl, helpers, this.page);
          continue;
        }

        // Other commands require paused state
        if (this.state.status !== 'paused') continue;

        if (cmd.type === 'step_forward') {
          const nextIdx = this.state.currentStepIndex + 1;
          if (nextIdx >= steps.length) {
            this.state.status = 'completed';
            break;
          }
          this.state.status = 'stepping';
          pauseCtrl.resume('paused');
        }

        else if (cmd.type === 'run_to_end') {
          this.state.status = 'running';
          pauseCtrl.resume('running');
        }

        else if (cmd.type === 'run_to_step') {
          const targetIdx = cmd.stepIndex;
          if (targetIdx <= this.state.currentStepIndex || targetIdx >= steps.length) continue;
          this.state.status = 'running';
          // Target is targetIdx+1 because checkpoint(targetIdx+1) fires AFTER step targetIdx completes
          pauseCtrl.resume('run_to_step', targetIdx + 1);
        }
      }

    } catch (err) {
      if (this.state) {
        this.state.status = 'error';
        this.state.error = err instanceof Error ? err.message : String(err);
      }
    }
  }
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
  if (repositoryId === undefined) {
    if (!debugInstance) {
      debugInstance = new DebugRunner();
    }
    return debugInstance;
  }

  const repoId = repositoryId ?? null;

  if (!debugInstance || debugRepositoryId !== repoId) {
    if (debugInstance?.isActive()) {
      debugInstance.stop().catch(() => {});
    }
    debugRepositoryId = repoId;
    debugInstance = new DebugRunner();
  }

  return debugInstance;
}
