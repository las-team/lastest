/**
 * Debug Executor for Embedded Browser
 *
 * Step-by-step test execution using checkpoint-based pausing.
 * Receives pre-parsed steps from the server and executes them
 * one at a time (or in runs) on a fresh BrowserContext.
 */

import type { Browser, Page, BrowserContext } from 'playwright';
import type { StabilizationPayload } from './protocol.js';
import { setupFreezeScripts } from './stabilization.js';

// Types matching the protocol definitions
export interface DebugStep {
  id: number;
  code: string;
  label: string;
  lineStart: number;
  lineEnd: number;
  type: 'action' | 'navigation' | 'assertion' | 'screenshot' | 'wait' | 'variable' | 'log' | 'other';
}

export interface DebugStepResult {
  stepId: number;
  status: 'passed' | 'failed' | 'pending';
  durationMs: number;
  error?: string;
}

export interface DebugStatePayload {
  sessionId: string;
  testId: string;
  status: 'initializing' | 'paused' | 'stepping' | 'running' | 'completed' | 'error';
  currentStepIndex: number;
  steps: DebugStep[];
  stepResults: DebugStepResult[];
  code: string;
  error?: string;
  codeVersion: number;
}

export interface StartDebugPayload {
  sessionId: string;
  testId: string;
  code: string;
  cleanBody: string;
  steps: DebugStep[];
  targetUrl: string;
  viewport?: { width: number; height: number };
  storageState?: string;
  setupVariables?: Record<string, unknown>;
  stabilization?: StabilizationPayload;
}

export interface DebugActionPayload {
  sessionId: string;
  action: 'step_forward' | 'step_back' | 'run_to_end' | 'run_to_step' | 'update_code';
  stepIndex?: number;
  code?: string;
  cleanBody?: string;
  steps?: DebugStep[];
}

// -------- Pause Controller --------

class StopError extends Error {
  constructor() {
    super('Debug execution stopped');
    this.name = 'StopError';
  }
}

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

// -------- Debug Executor --------

export class EmbeddedDebugExecutor {
  private browser: Browser;
  private context: BrowserContext | null = null;
  private debugPage: Page | null = null;
  private pauseController: PauseController | null = null;

  private sessionId = '';
  private testId = '';
  private code = '';
  private cleanBody = '';
  private steps: DebugStep[] = [];
  private stepResults: DebugStepResult[] = [];
  private currentStepIndex = -1;
  private status: DebugStatePayload['status'] = 'initializing';
  private error?: string;
  private codeVersion = 0;
  private targetUrl = '';
  private viewport = { width: 1280, height: 720 };
  private storageState?: string;
  private setupVariables?: Record<string, unknown>;
  private stabilization?: StabilizationPayload;
  private generation = 0;

  constructor(browser: Browser) {
    this.browser = browser;
  }

  async start(payload: StartDebugPayload): Promise<void> {
    this.sessionId = payload.sessionId;
    this.testId = payload.testId;
    this.code = payload.code;
    this.cleanBody = payload.cleanBody;
    this.steps = payload.steps;
    this.stepResults = payload.steps.map(s => ({ stepId: s.id, status: 'pending' as const, durationMs: 0 }));
    this.currentStepIndex = -1;
    this.status = 'initializing';
    this.error = undefined;
    this.codeVersion = 0;
    this.targetUrl = payload.targetUrl;
    this.viewport = payload.viewport || { width: 1280, height: 720 };
    this.storageState = payload.storageState;
    this.setupVariables = payload.setupVariables;
    this.stabilization = payload.stabilization;
    this.generation++;

    await this.createContextAndPage();

    // Navigate to target URL
    if (this.debugPage && this.targetUrl) {
      try {
        await this.debugPage.goto(this.targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      } catch (err) {
        console.error('[DebugExecutor] Navigation failed:', err);
      }
    }

    this.currentStepIndex = 0;
    this.status = 'paused';

    // Start the execution loop in background
    const gen = this.generation;
    this.runExecution(gen).catch(err => {
      if (this.generation === gen) {
        this.status = 'error';
        this.error = err?.message || String(err);
      }
    });
  }

  async handleAction(action: string, payload?: DebugActionPayload): Promise<void> {
    switch (action) {
      case 'step_forward':
        if (this.pauseController) {
          this.status = 'stepping';
          this.pauseController.resume('paused');
        }
        break;

      case 'step_back': {
        if (this.currentStepIndex <= 0) break;
        const targetStep = this.currentStepIndex - 1;
        // Stop current execution
        this.pauseController?.stop();
        this.pauseController = null;
        await this.cleanupContextAndPage();
        // Re-create and re-execute from start to targetStep-1
        await this.createContextAndPage();
        if (this.debugPage && this.targetUrl) {
          try {
            await this.debugPage.goto(this.targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          } catch (err) {
            console.error('[DebugExecutor] Navigation failed on step back:', err);
          }
        }
        // Reset step results
        this.stepResults = this.steps.map(s => ({ stepId: s.id, status: 'pending' as const, durationMs: 0 }));
        this.currentStepIndex = 0;
        this.status = 'running';
        this.error = undefined;
        this.generation++;
        const gen = this.generation;
        this.runExecution(gen, targetStep).catch(err => {
          if (this.generation === gen) {
            this.status = 'error';
            this.error = err?.message || String(err);
          }
        });
        break;
      }

      case 'run_to_end':
        if (this.pauseController) {
          this.status = 'running';
          this.pauseController.resume('running');
        }
        break;

      case 'run_to_step':
        if (this.pauseController && payload?.stepIndex !== undefined) {
          this.status = 'running';
          this.pauseController.resume('run_to_step', payload.stepIndex);
        }
        break;

      case 'update_code':
        if (payload?.steps && payload?.cleanBody) {
          this.steps = payload.steps;
          this.cleanBody = payload.cleanBody;
          if (payload.code) this.code = payload.code;
          this.codeVersion++;

          // Check if changes affect already-executed steps
          const executedCount = this.stepResults.filter(r => r.status === 'passed').length;
          if (executedCount > 0 && payload.steps.length > 0) {
            // Resize stepResults to match new steps
            const newResults: DebugStepResult[] = payload.steps.map((s, idx) => {
              if (idx < this.stepResults.length && this.stepResults[idx].status === 'passed') {
                return this.stepResults[idx];
              }
              return { stepId: s.id, status: 'pending' as const, durationMs: 0 };
            });
            this.stepResults = newResults;

            // If current step is past the changed area, warn
            if (this.currentStepIndex < payload.steps.length) {
              this.error = 'Step back to apply code changes';
              this.status = 'error';
            }
          } else {
            this.stepResults = payload.steps.map(s => ({ stepId: s.id, status: 'pending' as const, durationMs: 0 }));
          }
        }
        break;
    }
  }

  async stop(): Promise<void> {
    this.pauseController?.stop();
    this.pauseController = null;
    this.status = 'completed';
    await this.cleanupContextAndPage();
  }

  getState(): DebugStatePayload {
    return {
      sessionId: this.sessionId,
      testId: this.testId,
      status: this.status,
      currentStepIndex: this.currentStepIndex,
      steps: this.steps,
      stepResults: this.stepResults,
      code: this.code,
      error: this.error,
      codeVersion: this.codeVersion,
    };
  }

  getPage(): Page | null {
    return this.debugPage;
  }

  // -------- Private Methods --------

  private async createContextAndPage(): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let parsedStorageState: any;
    if (this.storageState) {
      try {
        parsedStorageState = JSON.parse(this.storageState);
      } catch { /* ignore */ }
    }

    const needsStabilized = this.stabilization?.crossOsConsistency || this.stabilization?.freezeAnimations;

    this.context = await this.browser.newContext({
      viewport: this.viewport,
      ...(parsedStorageState ? { storageState: parsedStorageState } : {}),
      ...(needsStabilized ? { deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'UTC', colorScheme: 'light' as const } : {}),
      ...(this.stabilization?.freezeAnimations ? { reducedMotion: 'reduce' as const } : {}),
    });

    this.debugPage = await this.context.newPage();
    this.debugPage.setDefaultNavigationTimeout(30000);
    this.debugPage.setDefaultTimeout(15000);

    // Setup stabilization scripts
    if (this.stabilization) {
      await setupFreezeScripts(this.debugPage, this.stabilization);
    }
  }

  private async cleanupContextAndPage(): Promise<void> {
    if (this.debugPage) {
      await this.debugPage.close().catch(() => {});
      this.debugPage = null;
    }
    if (this.context) {
      await this.context.close().catch(() => {});
      this.context = null;
    }
  }

  private async runExecution(gen: number, runToStep?: number): Promise<void> {
    if (!this.debugPage) return;
    const page = this.debugPage;

    // Build helpers
    const logFn = (level: string, message: string) => {
      console.log(`  [${level.toUpperCase()}] [debug:${this.testId}] ${message}`);
    };

    const stepLogger = {
      log: (msg: string) => logFn('info', `Step: ${msg}`),
      warn: (msg: string) => logFn('warn', `[WARN] ${msg}`),
      error: (msg: string) => logFn('error', `Step error: ${msg}`),
      softExpect: async (fn: () => Promise<void>) => { try { await fn(); } catch { /* soft */ } },
      softAction: async (fn: () => Promise<void>) => { try { await fn(); } catch { /* soft */ } },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const expect = (target: any, message?: string) => {
      const msgPrefix = message ? `${message}: ` : '';
      const isPage = typeof target?.goto === 'function';
      const isLocator = typeof target?.click === 'function' && typeof target?.fill === 'function';
      if (isPage) {
        return {
          async toHaveTitle(expected: string | RegExp) {
            const title = await target.title();
            const regex = typeof expected === 'string' ? new RegExp(expected) : expected;
            if (!regex.test(title)) throw new Error(`${msgPrefix}Expected title "${title}" to match ${regex}`);
          },
          async toHaveURL(expected: string | RegExp) {
            const url = target.url();
            const regex = typeof expected === 'string' ? new RegExp(expected) : expected;
            if (!regex.test(url)) throw new Error(`${msgPrefix}Expected URL "${url}" to match ${regex}`);
          },
        };
      }
      if (isLocator) {
        return {
          async toBeVisible() { if (!await target.isVisible()) throw new Error(`${msgPrefix}Expected element to be visible`); },
          async toBeHidden() { if (await target.isVisible()) throw new Error(`${msgPrefix}Expected element to be hidden`); },
          async toHaveText(expected: string | RegExp) {
            const text = await target.textContent() || '';
            const regex = typeof expected === 'string' ? new RegExp(expected) : expected;
            if (!regex.test(text)) throw new Error(`${msgPrefix}Expected text "${text}" to match ${regex}`);
          },
          async toContainText(expected: string) {
            const text = await target.textContent() || '';
            if (!text.includes(expected)) throw new Error(`${msgPrefix}Expected text to contain "${expected}"`);
          },
          not: {
            async toBeVisible() { if (await target.isVisible()) throw new Error(`${msgPrefix}Expected element not to be visible`); },
          },
        };
      }
      return {
        toBe(expected: unknown) { if (target !== expected) throw new Error(`${msgPrefix}Expected ${JSON.stringify(expected)} but got ${JSON.stringify(target)}`); },
        toEqual(expected: unknown) { if (JSON.stringify(target) !== JSON.stringify(expected)) throw new Error(`${msgPrefix}Expected ${JSON.stringify(expected)} but got ${JSON.stringify(target)}`); },
        toBeTruthy() { if (!target) throw new Error(`${msgPrefix}Expected value to be truthy but got ${target}`); },
        toBeFalsy() { if (target) throw new Error(`${msgPrefix}Expected value to be falsy but got ${target}`); },
        toContain(expected: unknown) {
          if (Array.isArray(target)) { if (!target.includes(expected)) throw new Error(`${msgPrefix}Expected array to contain ${JSON.stringify(expected)}`); }
          else if (typeof target === 'string') { if (!target.includes(expected as string)) throw new Error(`${msgPrefix}Expected string to contain "${expected}"`); }
        },
        toHaveLength(expected: number) { if (target?.length !== expected) throw new Error(`${msgPrefix}Expected length ${expected} but got ${target?.length}`); },
        not: {
          toBe(expected: unknown) { if (target === expected) throw new Error(`${msgPrefix}Expected not to be ${JSON.stringify(expected)}`); },
          toBeTruthy() { if (target) throw new Error(`${msgPrefix}Expected value not to be truthy`); },
        },
      };
    };

    // locateWithFallback
    const locateWithFallback = async (
      pg: Page,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      selectors: Array<any>,
      action: string,
      value?: string | null,
      coords?: { x: number; y: number } | null,
      options?: Record<string, unknown> | null
    ) => {
      const validSelectors = selectors
        .map((sel: unknown) => {
          if (typeof sel === 'string') return { type: 'css', value: sel };
          if (sel && typeof sel === 'object' && 'type' in sel && 'value' in sel) return sel as { type: string; value: string };
          const legacy = sel as { selector?: string; css?: string; text?: string };
          return { type: 'css', value: legacy?.selector || legacy?.css || legacy?.text || '' };
        })
        .filter((s: { type: string; value: string }) => s.value && s.value.trim() && !s.value.includes('undefined'));

      for (const sel of validSelectors) {
        try {
          let locator;
          if (sel.type === 'ocr-text') {
            const text = sel.value.replace(/^ocr-text="/, '').replace(/"$/, '');
            locator = pg.getByText(text, { exact: false });
          } else if (sel.type === 'role-name') {
            const match = sel.value.match(/^role=(\w+)\[name="(.+)"\]$/);
            if (match) {
              locator = pg.getByRole(match[1] as 'button' | 'link' | 'heading', { name: match[2] });
            } else {
              locator = pg.locator(sel.value);
            }
          } else {
            locator = pg.locator(sel.value);
          }

          const target = locator.first();
          await target.waitFor({ timeout: 3000 });

          if (action === 'locate') return target;
          if (action === 'click') await target.click(options || {});
          else if (action === 'fill') await target.fill(value || '');
          else if (action === 'selectOption') await target.selectOption(value || '');
          else if (action === 'check') await target.check();
          else if (action === 'uncheck') await target.uncheck();

          return target;
        } catch {
          continue;
        }
      }

      if (action === 'click' && coords) {
        await pg.mouse.click(coords.x, coords.y, options || {});
        return;
      }
      if (action === 'fill' && coords) {
        await pg.mouse.click(coords.x, coords.y);
        await pg.keyboard.press('Control+a');
        await pg.keyboard.type(value || '');
        return;
      }

      throw new Error('No selector matched: ' + JSON.stringify(validSelectors));
    };

    // replayCursorPath (instant in debug mode)
    const replayCursorPath = async (pg: Page, moves: [number, number, number][]) => {
      for (const [x, y] of moves) {
        await pg.mouse.move(x, y);
      }
    };

    // Build instrumented code with checkpoints
    const steps = this.steps;
    let instrumentedBody = '';
    for (let i = 0; i < steps.length; i++) {
      instrumentedBody += `
  __currentStep = ${i};
  await __checkpoint(${i});
  __stepStart = Date.now();
  try {
    ${steps[i].code}
    __stepResults[${i}] = { stepId: ${steps[i].id}, status: 'passed', durationMs: Date.now() - __stepStart };
  } catch (__err) {
    __stepResults[${i}] = { stepId: ${steps[i].id}, status: 'failed', durationMs: Date.now() - __stepStart, error: __err?.message || String(__err) };
    throw __err;
  }
`;
    }

    // Create pause controller
    const initialMode = runToStep !== undefined ? 'run_to_step' : 'paused';
    const initialTarget = runToStep ?? 0;

    this.pauseController = new PauseController(initialMode, initialTarget, () => {
      if (this.generation === gen) {
        this.status = 'paused';
      }
    });

    const controller = this.pauseController;

    const checkpoint = async (stepIdx: number) => {
      if (this.generation !== gen) throw new StopError();
      this.currentStepIndex = stepIdx;
      await controller.waitIfNeeded(stepIdx);
      if (this.generation !== gen) throw new StopError();
      if (this.status !== 'running') {
        this.status = 'stepping';
      }
    };

    // Execute instrumented function
    try {
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      const stepResultsArray = this.stepResults;

      const wrappedBody = `
  let __currentStep = -1;
  let __stepStart = 0;
  ${instrumentedBody}
`;

      const debugFn = new AsyncFunction(
        'page', 'baseUrl', 'screenshotPath', 'stepLogger', 'expect',
        'locateWithFallback', 'replayCursorPath', '__stepResults', '__checkpoint',
        wrappedBody
      );

      await debugFn(
        page,
        this.targetUrl.replace(/\/+$/, ''),
        'screenshot.png',
        stepLogger,
        expect,
        locateWithFallback,
        replayCursorPath,
        stepResultsArray,
        checkpoint,
      );

      if (this.generation === gen) {
        this.status = 'completed';
        this.currentStepIndex = steps.length - 1;
      }
    } catch (err) {
      if (err instanceof StopError) {
        // Normal stop, don't set error
        return;
      }
      if (this.generation === gen) {
        this.status = 'error';
        this.error = err instanceof Error ? err.message : String(err);
      }
    }
  }
}
