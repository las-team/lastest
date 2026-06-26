/**
 * Debug Executor for Embedded Browser
 *
 * Step-by-step test execution using checkpoint-based pausing.
 * Receives pre-parsed steps from the server and executes them
 * one at a time (or in runs) on a fresh BrowserContext.
 */

import type { Browser, Page, BrowserContext } from "playwright";
import type { StabilizationPayload } from "./protocol.js";
import { setupFreezeScripts } from "./stabilization.js";
import { isUsableSelectorValue } from "@lastest/shared";
import { EmbeddedRecorder } from "./embedded-recorder.js";

// Types matching the protocol definitions
export interface DebugStep {
  id: number;
  code: string;
  label: string;
  lineStart: number;
  lineEnd: number;
  type:
    | "action"
    | "navigation"
    | "assertion"
    | "screenshot"
    | "wait"
    | "variable"
    | "log"
    | "other";
}

export interface DebugStepResult {
  stepId: number;
  status: "passed" | "failed" | "pending";
  durationMs: number;
  error?: string;
}

export type RecordingAnchorReason =
  | "cursor"
  | "last_passing"
  | "fallback_cursor";

// Mirrors the inline event shape on RecordingEventPayload.events in
// src/lib/ws/protocol.ts / EmbeddedRecorder's RecordingEventData — kept as a
// separate declaration here since packages/embedded-browser has no
// dependency on app-side or ws-protocol code.
export interface RecordingEventData {
  type: string;
  timestamp: number;
  sequence: number;
  status: "preview" | "committed";
  verification?: {
    syntaxValid: boolean;
    domVerified?: boolean;
    lastChecked?: number;
    selectorMatches?: Array<{ type: string; value: string; count: number }>;
    chosenSelector?: string;
    autoRepaired?: boolean;
  };
  data: Record<string, unknown>;
}

export interface DebugStatePayload {
  sessionId: string;
  testId: string;
  status:
    | "initializing"
    | "paused"
    | "stepping"
    | "running"
    | "completed"
    | "error";
  currentStepIndex: number;
  steps: DebugStep[];
  stepResults: DebugStepResult[];
  code: string;
  error?: string;
  codeVersion: number;
  isRecording: boolean;
  recordedEventCount: number;
  recordingAnchorIndex?: number;
  recordingAnchorReason?: RecordingAnchorReason;
  spliceMode?: "replace" | "insert";
  targetUrl?: string;
  // Set exactly once, on the first getState() tick after stop_recording
  // finishes. Drained (nulled) by getState() itself right after reading it.
  pendingRecordingEvents?: RecordingEventData[];
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
  selectorPriority?: Array<{
    type: string;
    enabled: boolean;
    priority: number;
  }>;
  pointerGestures?: boolean;
  cursorFPS?: number;
}

export interface DebugActionPayload {
  sessionId: string;
  action:
    | "step_forward"
    | "step_back"
    | "run_to_end"
    | "run_to_step"
    | "update_code"
    | "start_recording"
    | "stop_recording"
    | "cancel_recording";
  stepIndex?: number;
  code?: string;
  cleanBody?: string;
  steps?: DebugStep[];
  spliceMode?: "replace" | "insert";
}

// -------- Pause Controller --------

class StopError extends Error {
  constructor() {
    super("Debug execution stopped");
    this.name = "StopError";
  }
}

class PauseController {
  private mode: "paused" | "running" | "run_to_step" | "stopped";
  private target: number;
  private pendingResolve: (() => void) | null = null;
  private pendingReject: ((err: Error) => void) | null = null;
  private onPause: () => void;
  // A resume that arrived while no checkpoint was waiting (the previous step
  // was still executing). Without buffering, that user action (step_forward /
  // run_to_end clicked mid-step) was silently dropped and the session looked
  // unresponsive — the user had to click again.
  private queuedResume: {
    mode: "paused" | "running" | "run_to_step";
    target?: number;
  } | null = null;

  constructor(
    mode: "paused" | "running" | "run_to_step",
    target: number,
    onPause: () => void,
  ) {
    this.mode = mode;
    this.target = target;
    this.onPause = onPause;
  }

  async waitIfNeeded(stepIdx: number): Promise<void> {
    if (this.mode === "stopped") throw new StopError();
    if (this.mode === "running") return;
    if (this.mode === "run_to_step" && stepIdx < this.target) return;

    // Consume a resume that was issued while the previous step was running.
    if (this.queuedResume) {
      const q = this.queuedResume;
      this.queuedResume = null;
      this.mode = q.mode;
      if (q.target !== undefined) this.target = q.target;
      if (this.mode === "running") return;
      if (this.mode === "run_to_step" && stepIdx < this.target) return;
      // mode === "paused" means single-step: execute this step, pause at next.
      if (this.mode === "paused") return;
    }

    if (this.mode === "run_to_step") this.mode = "paused";
    this.onPause();

    return new Promise<void>((resolve, reject) => {
      this.pendingResolve = resolve;
      this.pendingReject = reject;
    });
  }

  resume(newMode: "paused" | "running" | "run_to_step", target?: number): void {
    if (!this.pendingResolve) {
      // Nothing is waiting (a step is mid-execution) — buffer for the next
      // checkpoint instead of dropping the action.
      this.queuedResume = { mode: newMode, target };
      return;
    }
    this.mode = newMode;
    if (target !== undefined) this.target = target;
    const resolve = this.pendingResolve;
    this.pendingResolve = null;
    this.pendingReject = null;
    resolve?.();
  }

  stop(): void {
    this.mode = "stopped";
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

  private sessionId = "";
  private testId = "";
  private code = "";
  private cleanBody = "";
  private steps: DebugStep[] = [];
  private stepResults: DebugStepResult[] = [];
  private currentStepIndex = -1;
  private status: DebugStatePayload["status"] = "initializing";
  private error?: string;
  private codeVersion = 0;
  private targetUrl = "";
  private viewport = { width: 1280, height: 720 };
  private storageState?: string;
  private setupVariables?: Record<string, unknown>;
  private stabilization?: StabilizationPayload;
  private selectorPriority?: Array<{
    type: string;
    enabled: boolean;
    priority: number;
  }>;
  private pointerGestures?: boolean;
  private cursorFPS?: number;
  private generation = 0;
  // Set when update_code changes the step list while an execution built from
  // the OLD instrumented body is still alive. Resuming that body would run
  // stale code (the inserted/edited steps would silently not exist), so any
  // resume while stale triggers a replay with the new code instead.
  private staleCode = false;

  // -------- Recording ("Record from here") state --------
  private recorder: EmbeddedRecorder | null = null;
  private spliceMode: "replace" | "insert" | null = null;
  private recordingAnchorIndex = -1;
  private recordingAnchorReason: RecordingAnchorReason | null = null;
  // Set once by stopRecordingAndCollect(), drained (nulled) by getState().
  private pendingRecordingEvents: RecordingEventData[] | null = null;

  constructor(browser: Browser) {
    this.browser = browser;
  }

  async start(payload: StartDebugPayload): Promise<void> {
    // A new debug session is starting (or this executor instance is being
    // reused) — any recorder left attached to the OLD page must be stopped
    // before that page is torn down, or its page.on("close") handler fires
    // defensively but the recorder's internal state is left dangling.
    if (this.recorder) {
      await this.recorder.forceCleanup();
      this.recorder = null;
    }
    this.spliceMode = null;
    this.recordingAnchorIndex = -1;
    this.recordingAnchorReason = null;
    this.pendingRecordingEvents = null;

    this.sessionId = payload.sessionId;
    this.testId = payload.testId;
    this.code = payload.code;
    this.cleanBody = payload.cleanBody;
    this.steps = payload.steps;
    this.stepResults = payload.steps.map((s) => ({
      stepId: s.id,
      status: "pending" as const,
      durationMs: 0,
    }));
    this.currentStepIndex = -1;
    this.status = "initializing";
    this.error = undefined;
    this.codeVersion = 0;
    this.staleCode = false;
    this.targetUrl = payload.targetUrl;
    this.viewport = payload.viewport || { width: 1280, height: 720 };
    this.storageState = payload.storageState;
    this.setupVariables = payload.setupVariables;
    this.stabilization = payload.stabilization;
    this.selectorPriority = payload.selectorPriority;
    this.pointerGestures = payload.pointerGestures;
    this.cursorFPS = payload.cursorFPS;
    this.generation++;

    await this.createContextAndPage();

    // Navigate to target URL
    if (this.debugPage && this.targetUrl) {
      try {
        await this.debugPage.goto(this.targetUrl, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
      } catch (err) {
        console.error("[DebugExecutor] Navigation failed:", err);
      }
    }

    this.currentStepIndex = 0;
    this.status = "paused";

    // Start the execution loop in background
    const gen = this.generation;
    this.runExecution(gen).catch((err) => {
      if (this.generation === gen) {
        this.status = "error";
        this.error = err?.message || String(err);
      }
    });
  }

  private async replayToStep(targetStep: number): Promise<void> {
    this.pauseController?.stop();
    this.pauseController = null;
    await this.cleanupContextAndPage();
    await this.createContextAndPage();
    if (this.debugPage && this.targetUrl) {
      try {
        await this.debugPage.goto(this.targetUrl, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
      } catch (err) {
        console.error("[DebugExecutor] Navigation failed on replay:", err);
      }
    }
    this.stepResults = this.steps.map((s) => ({
      stepId: s.id,
      status: "pending" as const,
      durationMs: 0,
    }));
    this.currentStepIndex = 0;
    this.status = "running";
    this.error = undefined;
    this.staleCode = false;
    this.generation++;
    const gen = this.generation;
    this.runExecution(gen, targetStep).catch((err) => {
      if (this.generation === gen) {
        this.status = "error";
        this.error = err?.message || String(err);
      }
    });
  }

  private findLastPassingStepIndex(): number {
    for (let i = this.stepResults.length - 1; i >= 0; i--) {
      if (this.stepResults[i].status === "passed") return i;
    }
    return -1;
  }

  /**
   * Begin "Record from here". On a failed step, rewinds to the last
   * passing step (or falls back to the cursor step if none passed) so the
   * live page has a clean DOM to record against. On a paused-not-failed
   * step, anchors at the cursor with no rewind.
   */
  private async startRecordingFromHere(
    spliceMode: "replace" | "insert",
  ): Promise<void> {
    this.spliceMode = spliceMode;

    if (this.status === "error") {
      const lastPassing = this.findLastPassingStepIndex();
      if (lastPassing >= 0) {
        this.recordingAnchorIndex = lastPassing;
        this.recordingAnchorReason = "last_passing";
        // +1: replayToStep's target is "pause BEFORE this step index runs",
        // which is the same instant as "right after step lastPassing
        // finished" — the same convention step_forward's stale-code branch
        // already uses (Math.max(0, currentStepIndex + 1) above).
        await this.replayToStep(lastPassing + 1);
      } else {
        this.recordingAnchorIndex = Math.max(0, this.currentStepIndex);
        this.recordingAnchorReason = "fallback_cursor";
      }
    } else {
      this.recordingAnchorIndex = Math.max(0, this.currentStepIndex);
      this.recordingAnchorReason = "cursor";
    }

    if (!this.debugPage) return;
    this.recorder ??= new EmbeddedRecorder();
    await this.recorder.attachToPage(
      this.debugPage,
      new URL(this.targetUrl).origin,
      {
        selectorPriority: this.selectorPriority,
        pointerGestures: this.pointerGestures,
        cursorFPS: this.cursorFPS,
        captureThumbnails: false,
      },
      () => {
        // Events stay buffered in the recorder; nothing to push live here —
        // getState() reports recordedEventCount via recorder.getEventCount().
      },
    );
  }

  private async stopRecordingAndCollect(): Promise<void> {
    if (!this.recorder) return;
    const events = await this.recorder.stop(false);
    this.pendingRecordingEvents = events;
    // spliceMode + recordingAnchorIndex/Reason are intentionally retained —
    // getState() must report them alongside pendingRecordingEvents so the
    // server's consumeStopRecording knows whether to replace or insert. They
    // are cleared on the next start_recording / cancel, not here.
  }

  private async cancelRecording(): Promise<void> {
    if (!this.recorder) return;
    await this.recorder.stop(false); // discard returned events
    this.spliceMode = null;
    this.recordingAnchorIndex = -1;
    this.recordingAnchorReason = null;
    this.pendingRecordingEvents = null;
  }

  async handleAction(
    action: string,
    payload?: DebugActionPayload,
  ): Promise<void> {
    switch (action) {
      case "step_forward":
        if (this.staleCode) {
          // The running body predates the latest code edit — re-run with the
          // new code and land paused right after the current step (so an
          // inserted step right after it is the next thing to execute).
          await this.replayToStep(Math.max(0, this.currentStepIndex + 1));
          break;
        }
        if (this.pauseController) {
          this.status = "stepping";
          this.pauseController.resume("paused");
        }
        break;

      case "step_back": {
        if (this.currentStepIndex <= 0) break;
        await this.replayToStep(this.currentStepIndex - 1);
        break;
      }

      case "run_to_end":
        if (this.staleCode) {
          await this.replayToStep(this.steps.length);
          break;
        }
        if (this.pauseController) {
          this.status = "running";
          this.pauseController.resume("running");
        }
        break;

      case "run_to_step": {
        if (payload?.stepIndex === undefined) break;
        const targetIdx = payload.stepIndex;
        if (targetIdx < 0 || targetIdx >= this.steps.length) break;
        if (targetIdx === this.currentStepIndex && !this.staleCode) break;

        if (
          targetIdx > this.currentStepIndex &&
          this.pauseController &&
          !this.staleCode &&
          this.status !== "completed" &&
          this.status !== "error"
        ) {
          // FORWARD: resume existing execution
          this.status = "running";
          this.pauseController.resume("run_to_step", targetIdx);
        } else {
          // BACKWARD, forward from completed/error, or stale code: full replay
          await this.replayToStep(targetIdx);
        }
        break;
      }

      case "update_code":
        if (payload?.steps && payload?.cleanBody) {
          this.steps = payload.steps;
          this.cleanBody = payload.cleanBody;
          if (payload.code) this.code = payload.code;
          this.codeVersion++;
          // The spliced code has now round-tripped back from the server — the
          // recording is consumed. Clear the splice metadata so getState() stops
          // re-reporting the events (which would make the server re-splice).
          this.pendingRecordingEvents = null;
          this.spliceMode = null;
          this.recordingAnchorIndex = -1;
          this.recordingAnchorReason = null;
          // The live execution (if any) was instrumented from the OLD body —
          // resuming it would silently run stale code. Any subsequent control
          // action replays with the new code instead (see staleCode checks).
          this.staleCode = true;

          // Check if changes affect already-executed steps
          const executedCount = this.stepResults.filter(
            (r) => r.status === "passed",
          ).length;
          if (executedCount > 0 && payload.steps.length > 0) {
            // Resize stepResults to match new steps
            const newResults: DebugStepResult[] = payload.steps.map(
              (s, idx) => {
                if (
                  idx < this.stepResults.length &&
                  this.stepResults[idx].status === "passed"
                ) {
                  return this.stepResults[idx];
                }
                return {
                  stepId: s.id,
                  status: "pending" as const,
                  durationMs: 0,
                };
              },
            );
            this.stepResults = newResults;

            // Steps already ran with the old code — surface that the next
            // control action re-executes from the start with the new code.
            // Keep the legacy "Step back to apply" marker: the debug UI keys
            // its soft-warning banner off that substring.
            if (this.currentStepIndex < payload.steps.length) {
              this.error =
                "Code changed — Step back to apply, or any step action will re-run from the start with the new code";
              this.status = "error";
            }
          } else {
            this.stepResults = payload.steps.map((s) => ({
              stepId: s.id,
              status: "pending" as const,
              durationMs: 0,
            }));
          }
        }
        break;

      case "start_recording":
        if (payload?.spliceMode) {
          await this.startRecordingFromHere(payload.spliceMode);
        }
        break;

      case "stop_recording":
        await this.stopRecordingAndCollect();
        break;

      case "cancel_recording":
        await this.cancelRecording();
        break;
    }
  }

  async stop(): Promise<void> {
    if (this.recorder) {
      await this.recorder.forceCleanup();
      this.recorder = null;
    }
    this.pauseController?.stop();
    this.pauseController = null;
    this.status = "completed";
    await this.cleanupContextAndPage();
  }

  getState(): DebugStatePayload {
    // pendingRecordingEvents is reported on EVERY tick until the splice lands.
    // It used to be drained here (one-shot), but the server reads state on its
    // own poll cycle that races the runner's WS push — a single drained push
    // could be missed or overwritten by a later null push, so the splice never
    // ran. The events are now cleared deterministically when the spliced
    // update_code round-trips back (handleAction "update_code"), or on the next
    // start_recording / cancel_recording.
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
      isRecording: this.recorder?.isActive() ?? false,
      recordedEventCount: this.recorder?.getEventCount() ?? 0,
      recordingAnchorIndex:
        this.recordingAnchorIndex >= 0 ? this.recordingAnchorIndex : undefined,
      recordingAnchorReason: this.recordingAnchorReason ?? undefined,
      spliceMode: this.spliceMode ?? undefined,
      targetUrl: this.targetUrl || undefined,
      pendingRecordingEvents: this.pendingRecordingEvents ?? undefined,
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
      } catch {
        /* ignore */
      }
    }

    const needsStabilized =
      this.stabilization?.crossOsConsistency ||
      this.stabilization?.freezeAnimations;

    this.context = await this.browser.newContext({
      viewport: this.viewport,
      ...(parsedStorageState ? { storageState: parsedStorageState } : {}),
      ...(needsStabilized
        ? {
            deviceScaleFactor: 1,
            locale: "en-US",
            timezoneId: "UTC",
            colorScheme: "light" as const,
          }
        : {}),
      ...(this.stabilization?.freezeAnimations
        ? { reducedMotion: "reduce" as const }
        : {}),
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
      console.log(
        `  [${level.toUpperCase()}] [debug:${this.testId}] ${message}`,
      );
    };

    const stepLogger = {
      log: (msg: string) => logFn("info", `Step: ${msg}`),
      warn: (msg: string) => logFn("warn", `[WARN] ${msg}`),
      error: (msg: string) => logFn("error", `Step error: ${msg}`),
      softExpect: async (fn: () => Promise<void>) => {
        try {
          await fn();
        } catch {
          /* soft */
        }
      },
      softAction: async (fn: () => Promise<void>) => {
        try {
          await fn();
        } catch {
          /* soft */
        }
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const expect = (target: any, message?: string) => {
      const msgPrefix = message ? `${message}: ` : "";
      const isPage = typeof target?.goto === "function";
      const isLocator =
        typeof target?.click === "function" &&
        typeof target?.fill === "function";
      if (isPage) {
        return {
          async toHaveTitle(expected: string | RegExp) {
            const title = await target.title();
            const regex =
              typeof expected === "string" ? new RegExp(expected) : expected;
            if (!regex.test(title))
              throw new Error(
                `${msgPrefix}Expected title "${title}" to match ${regex}`,
              );
          },
          async toHaveURL(expected: string | RegExp) {
            const url = target.url();
            const regex =
              typeof expected === "string" ? new RegExp(expected) : expected;
            if (!regex.test(url))
              throw new Error(
                `${msgPrefix}Expected URL "${url}" to match ${regex}`,
              );
          },
        };
      }
      if (isLocator) {
        return {
          async toBeVisible() {
            if (!(await target.isVisible()))
              throw new Error(`${msgPrefix}Expected element to be visible`);
          },
          async toBeHidden() {
            if (await target.isVisible())
              throw new Error(`${msgPrefix}Expected element to be hidden`);
          },
          async toHaveText(expected: string | RegExp) {
            const text = (await target.textContent()) || "";
            const regex =
              typeof expected === "string" ? new RegExp(expected) : expected;
            if (!regex.test(text))
              throw new Error(
                `${msgPrefix}Expected text "${text}" to match ${regex}`,
              );
          },
          async toContainText(expected: string) {
            const text = (await target.textContent()) || "";
            if (!text.includes(expected))
              throw new Error(
                `${msgPrefix}Expected text to contain "${expected}"`,
              );
          },
          not: {
            async toBeVisible() {
              if (await target.isVisible())
                throw new Error(
                  `${msgPrefix}Expected element not to be visible`,
                );
            },
          },
        };
      }
      return {
        toBe(expected: unknown) {
          if (target !== expected)
            throw new Error(
              `${msgPrefix}Expected ${JSON.stringify(expected)} but got ${JSON.stringify(target)}`,
            );
        },
        toEqual(expected: unknown) {
          if (JSON.stringify(target) !== JSON.stringify(expected))
            throw new Error(
              `${msgPrefix}Expected ${JSON.stringify(expected)} but got ${JSON.stringify(target)}`,
            );
        },
        toBeTruthy() {
          if (!target)
            throw new Error(
              `${msgPrefix}Expected value to be truthy but got ${target}`,
            );
        },
        toBeFalsy() {
          if (target)
            throw new Error(
              `${msgPrefix}Expected value to be falsy but got ${target}`,
            );
        },
        toContain(expected: unknown) {
          if (Array.isArray(target)) {
            if (!target.includes(expected))
              throw new Error(
                `${msgPrefix}Expected array to contain ${JSON.stringify(expected)}`,
              );
          } else if (typeof target === "string") {
            if (!target.includes(expected as string))
              throw new Error(
                `${msgPrefix}Expected string to contain "${expected}"`,
              );
          }
        },
        toHaveLength(expected: number) {
          if (target?.length !== expected)
            throw new Error(
              `${msgPrefix}Expected length ${expected} but got ${target?.length}`,
            );
        },
        not: {
          toBe(expected: unknown) {
            if (target === expected)
              throw new Error(
                `${msgPrefix}Expected not to be ${JSON.stringify(expected)}`,
              );
          },
          toBeTruthy() {
            if (target)
              throw new Error(`${msgPrefix}Expected value not to be truthy`);
          },
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
      options?: Record<string, unknown> | null,
    ) => {
      const validSelectors = selectors
        .map((sel: unknown) => {
          if (typeof sel === "string") return { type: "css", value: sel };
          if (sel && typeof sel === "object" && "type" in sel && "value" in sel)
            return sel as { type: string; value: string };
          const legacy = sel as {
            selector?: string;
            css?: string;
            text?: string;
          };
          return {
            type: "css",
            value: legacy?.selector || legacy?.css || legacy?.text || "",
          };
        })
        .filter((s: { type: string; value: string }) =>
          isUsableSelectorValue(s.value),
        );

      for (const sel of validSelectors) {
        try {
          let locator;
          if (sel.type === "ocr-text") {
            const text = sel.value.replace(/^ocr-text="/, "").replace(/"$/, "");
            locator = pg.getByText(text, { exact: false });
          } else if (sel.type === "label") {
            locator = pg.getByLabel(
              sel.value.replace(/^label="/, "").replace(/"$/, ""),
            );
          } else if (sel.type === "alt-text") {
            locator = pg.getByAltText(
              sel.value.replace(/^alt-text="/, "").replace(/"$/, ""),
            );
          } else if (sel.type === "title") {
            locator = pg.getByTitle(
              sel.value.replace(/^title="/, "").replace(/"$/, ""),
            );
          } else if (sel.type === "role-name") {
            const match = sel.value.match(/^role=(\w+)\[name="(.+)"\]$/);
            if (match) {
              locator = pg.getByRole(
                match[1] as "button" | "link" | "heading",
                { name: match[2] },
              );
            } else {
              locator = pg.locator(sel.value);
            }
          } else {
            locator = pg.locator(sel.value);
          }

          const target = locator.first();
          await target.waitFor({ timeout: 3000 });

          if (action === "locate") return target;
          if (action === "click") await target.click(options || {});
          else if (action === "fill") await target.fill(value || "");
          else if (action === "selectOption")
            await target.selectOption(value || "");
          else if (action === "check") await target.check();
          else if (action === "uncheck") await target.uncheck();

          return target;
        } catch {
          continue;
        }
      }

      if (action === "click" && coords) {
        await pg.mouse.click(coords.x, coords.y, options || {});
        return;
      }
      if (action === "fill" && coords) {
        await pg.mouse.click(coords.x, coords.y);
        await pg.keyboard.press("Control+a");
        await pg.keyboard.type(value || "");
        return;
      }

      throw new Error("No selector matched: " + JSON.stringify(validSelectors));
    };

    // replayCursorPath (instant in debug mode)
    const replayCursorPath = async (
      pg: Page,
      moves: [number, number, number][],
    ) => {
      for (const [x, y] of moves) {
        await pg.mouse.move(x, y);
      }
    };

    // Build instrumented code with checkpoints
    // IMPORTANT: Steps are placed at the top-level of the function body (no try/catch
    // wrapping per step) so that `let` variables and function declarations remain in
    // the same scope. This matches the local debug runner's approach.
    const steps = this.steps;
    const codeParts: string[] = [];
    for (let i = 0; i < steps.length; i++) {
      codeParts.push(`await __checkpoint(${i});`);
      codeParts.push(steps[i].code);
    }
    // Final checkpoint marks last step as done
    codeParts.push(`await __checkpoint(${steps.length});`);
    const instrumentedBody = codeParts.join("\n");

    // Create pause controller
    const initialMode = runToStep !== undefined ? "run_to_step" : "paused";
    const initialTarget = runToStep ?? 0;

    this.pauseController = new PauseController(
      initialMode,
      initialTarget,
      () => {
        if (this.generation === gen) {
          this.status = "paused";
        }
      },
    );

    const controller = this.pauseController;
    const totalSteps = steps.length;
    const stepStartTimes: number[] = new Array(totalSteps).fill(0);
    let executingStepIdx = -1;

    const checkpoint = async (n: number) => {
      if (this.generation !== gen) throw new StopError();
      const now = Date.now();

      // Mark previous step as passed
      if (n > 0 && n <= totalSteps) {
        const prev = n - 1;
        this.stepResults[prev] = {
          stepId: steps[prev].id,
          status: "passed",
          durationMs: now - stepStartTimes[prev],
        };
        this.currentStepIndex = prev;
      }

      // All steps done
      if (n >= totalSteps) return;

      // About to start step n
      executingStepIdx = n;
      stepStartTimes[n] = now;
      this.currentStepIndex = n;

      await controller.waitIfNeeded(n);
      if (this.generation !== gen) throw new StopError();
      if (this.status !== "running") {
        this.status = "stepping";
      }
    };

    // Execute instrumented function
    try {
      const AsyncFunction = Object.getPrototypeOf(
        async function () {},
      ).constructor;

      const debugFn = new AsyncFunction(
        "page",
        "baseUrl",
        "screenshotPath",
        "stepLogger",
        "expect",
        "locateWithFallback",
        "replayCursorPath",
        "__checkpoint",
        instrumentedBody,
      );

      await debugFn(
        page,
        this.targetUrl.replace(/\/+$/, ""),
        "screenshot.png",
        stepLogger,
        expect,
        locateWithFallback,
        replayCursorPath,
        checkpoint,
      );

      if (this.generation === gen) {
        this.status = "completed";
        this.currentStepIndex = steps.length - 1;
      }
    } catch (err) {
      if (err instanceof StopError) {
        // Normal stop, don't set error
        return;
      }
      // Mark current step as failed
      if (this.generation === gen) {
        if (executingStepIdx >= 0 && executingStepIdx < totalSteps) {
          this.stepResults[executingStepIdx] = {
            stepId: steps[executingStepIdx].id,
            status: "failed",
            durationMs: Date.now() - stepStartTimes[executingStepIdx],
            error: err instanceof Error ? err.message : String(err),
          };
          this.currentStepIndex = executingStepIdx;
        }
        this.status = "error";
        this.error = err instanceof Error ? err.message : String(err);
      }
    }
  }
}
