/**
 * Embedded Recorder
 *
 * Adapted from packages/runner/src/recorder.ts for the embedded browser.
 * Key differences:
 * - Receives an existing Browser instance (does NOT launch one)
 * - Creates a fresh BrowserContext + Page per recording session (full isolation)
 * - Runs setup code via executeSetupCode() before injecting recording script
 * - Closes the recording context/page on stop (browser stays alive)
 * - Sends events via callback
 */

import type { Browser, Page, BrowserContext } from 'playwright';
import { browserRecordingScript } from './browser-script.js';
import { executeSetupCode } from './setup-executor.js';

// Re-define minimal payload type to avoid cross-package imports
interface StartRecordingPayload {
  sessionId: string;
  targetUrl: string;
  viewport?: { width: number; height: number };
  selectorPriority?: Array<{ type: string; enabled: boolean; priority: number }>;
  pointerGestures?: boolean;
  cursorFPS?: number;
  setupSteps?: Array<{ code: string; codeHash: string }>;
}

interface RecordingEventData {
  type: string;
  timestamp: number;
  sequence: number;
  status: 'preview' | 'committed';
  verification?: {
    syntaxValid: boolean;
    domVerified?: boolean;
    lastChecked?: number;
  };
  data: Record<string, unknown>;
}

export class EmbeddedRecorder {
  private page: Page | null = null;
  private context: BrowserContext | null = null;
  private events: RecordingEventData[] = [];
  private sequenceCounter = 0;
  private baseOrigin = '';
  private isRecording = false;
  private eventBatchInterval: ReturnType<typeof setInterval> | null = null;
  private pendingEvents: RecordingEventData[] = [];
  private onEvent: ((events: RecordingEventData[]) => void) | null = null;
  private nextClickIsDownload = false;

  /**
   * Start recording on a fresh context/page.
   * Returns the new page so the caller can attach screencast/input to it.
   */
  async start(
    browser: Browser,
    payload: StartRecordingPayload,
    onEvent: (events: RecordingEventData[]) => void,
  ): Promise<Page> {
    this.onEvent = onEvent;
    this.baseOrigin = new URL(payload.targetUrl).origin;
    this.events = [];
    this.sequenceCounter = 0;
    this.pendingEvents = [];

    const viewport = payload.viewport ?? { width: 1280, height: 720 };

    // Create isolated context + page
    this.context = await browser.newContext({
      viewport,
      ignoreHTTPSErrors: true,
      acceptDownloads: true,
    });
    this.page = await this.context.newPage();

    // Detect page crash/close to prevent using a dead page
    this.page.on('crash', () => {
      console.error('  [EmbeddedRecorder] Recording page crashed!');
      this.isRecording = false;
      if (this.eventBatchInterval) { clearInterval(this.eventBatchInterval); this.eventBatchInterval = null; }
    });

    this.page.on('close', () => {
      if (this.isRecording) {
        console.warn('  [EmbeddedRecorder] Recording page closed unexpectedly');
        this.isRecording = false;
        if (this.eventBatchInterval) { clearInterval(this.eventBatchInterval); this.eventBatchInterval = null; }
      }
    });

    // Navigate to target URL
    await this.page.goto(payload.targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Run setup steps if provided
    if (payload.setupSteps?.length) {
      for (const step of payload.setupSteps) {
        try {
          console.log(`  [EmbeddedRecorder] Running setup step...`);
          await executeSetupCode(this.page, step.code, this.baseOrigin);
        } catch (err) {
          console.error(`  [EmbeddedRecorder] Setup step failed:`, err);
          throw err;
        }
      }
    }

    // Set up recording event capture (exposeFunction + inject script)
    await this.setupRecording(payload);

    this.isRecording = true;

    // Record initial navigation
    const relativePath = this.getRelativePath(payload.targetUrl);
    this.addEvent('navigation', { url: payload.targetUrl, relativePath });

    // Track navigation events
    this.page.on('framenavigated', (frame) => {
      if (frame === this.page?.mainFrame() && this.isRecording) {
        const url = frame.url();
        const rp = this.getRelativePath(url);
        this.addEvent('navigation', { url, relativePath: rp });
      }
    });

    // Auto-detect downloads: retroactively mark the last click/mouse-down as download-triggering
    this.page.on('download', () => {
      if (!this.isRecording) return;
      for (let i = this.events.length - 1; i >= 0; i--) {
        const ev = this.events[i];
        const isClick = ev.type === 'action' && (ev.data.action === 'click' || ev.data.action === 'rightclick');
        const isMouseDown = ev.type === 'mouse-down';
        if (isClick || isMouseDown) {
          if (!ev.data.downloadWrap) {
            ev.data.downloadWrap = true;
            ev.data.autoDetected = true;
          }
          break;
        }
      }
    });

    // Batch events and send to server periodically
    this.eventBatchInterval = setInterval(() => {
      this.flushPendingEvents();
    }, 500);

    console.log(`  [EmbeddedRecorder] Recording started, viewport: ${viewport.width}x${viewport.height}`);
    return this.page;
  }

  private async setupRecording(payload: StartRecordingPayload): Promise<void> {
    if (!this.page) return;

    const selectorPriority = payload.selectorPriority ?? [];
    const pointerGestures = payload.pointerGestures ?? false;

    // Expose recording functions that forward events to the server
    await this.page.exposeFunction('__recordAction', (
      action: string,
      selectors: Array<{ type: string; value: string }>,
      value?: string,
      boundingBox?: { x: number; y: number; width: number; height: number },
      actionId?: string,
      modifiers?: string[]
    ) => {
      const primarySelector = selectors[0]?.value || '';
      const coordinates = boundingBox
        ? { x: Math.round(boundingBox.x + boundingBox.width / 2), y: Math.round(boundingBox.y + boundingBox.height / 2) }
        : undefined;

      const validSelectors = selectors.filter(sel => sel.value && sel.value.trim() && !sel.value.includes('undefined'));
      const hasValidSelectors = validSelectors.length > 0;
      const hasCoordsFallback = action === 'click' && coordinates !== undefined;
      const syntaxValid = hasValidSelectors || hasCoordsFallback;

      // Check if this click was pre-flagged as a download trigger
      const downloadWrap = (action === 'click' || action === 'rightclick') && this.nextClickIsDownload ? true : undefined;
      if (downloadWrap) this.nextClickIsDownload = false;

      this.addEvent('action', {
        action, selector: primarySelector, selectors, value, coordinates, actionId,
        modifiers: modifiers && modifiers.length > 0 ? modifiers : undefined,
        downloadWrap,
      }, 'committed', {
        syntaxValid,
        domVerified: undefined,
        lastChecked: undefined,
      });
    });

    if (pointerGestures) {
      await this.page.exposeFunction('__recordCursorMove', (x: number, y: number) => {
        this.addEvent('cursor-move', { coordinates: { x, y } });
      });

      await this.page.exposeFunction('__recordMouseEvent', (type: string, x: number, y: number, button: number, modifiers?: string[]) => {
        // Check if this mouse-down was pre-flagged as a download trigger
        const downloadWrap = type === 'down' && this.nextClickIsDownload ? true : undefined;
        if (downloadWrap) this.nextClickIsDownload = false;

        this.addEvent(type === 'down' ? 'mouse-down' : 'mouse-up', {
          coordinates: { x, y }, button,
          modifiers: modifiers && modifiers.length > 0 ? modifiers : undefined,
          downloadWrap,
        });
      });
    }

    await this.page.exposeFunction('__recordKeypress', (key: string, modifiers?: string[]) => {
      this.addEvent('keypress', { key, modifiers: modifiers && modifiers.length > 0 ? modifiers : undefined });
    });

    await this.page.exposeFunction('__recordHoverPreview', (elementInfo: Record<string, unknown>) => {
      // Replace previous hover-preview in pending batch
      if (this.events.length > 0) {
        const lastEvent = this.events[this.events.length - 1];
        if (lastEvent?.type === 'hover-preview' && lastEvent.status === 'preview') {
          this.events.pop();
          this.sequenceCounter--;
          const pendingIdx = this.pendingEvents.findLastIndex(e => e.type === 'hover-preview');
          if (pendingIdx !== -1) this.pendingEvents.splice(pendingIdx, 1);
        }
      }
      this.addEvent('hover-preview', { elementInfo }, 'preview');
    });

    await this.page.exposeFunction('__recordElementAssertion', (assertion: Record<string, unknown>) => {
      this.addEvent('assertion', { elementAssertion: assertion });
    });

    await this.page.exposeFunction('__recordScreenshot', () => {
      this.takeScreenshot();
    });

    await this.page.exposeFunction('__updateVerification', (actionId: string, verified: boolean) => {
      const event = this.events.find(e => e.data.actionId === actionId);
      if (event && event.verification) {
        event.verification.domVerified = verified;
        event.verification.lastChecked = Date.now();
      }
    });

    // Inject the browser-side recording script
    const initArgs = {
      pointerGestures,
      cursorFPS: payload.cursorFPS ?? 30,
      selectorPriority,
    };

    await this.page.addInitScript(browserRecordingScript, initArgs);
    await this.page.evaluate(browserRecordingScript, initArgs);
  }

  private addEvent(
    type: string,
    data: Record<string, unknown>,
    status: 'preview' | 'committed' = 'committed',
    verification?: { syntaxValid: boolean; domVerified?: boolean; lastChecked?: number }
  ): void {
    const event: RecordingEventData = {
      type,
      timestamp: Date.now(),
      sequence: ++this.sequenceCounter,
      status,
      data,
    };

    if (verification) {
      event.verification = verification;
    }

    this.events.push(event);
    this.pendingEvents.push(event);
  }

  private flushPendingEvents(): void {
    if (this.pendingEvents.length > 0 && this.onEvent) {
      this.onEvent([...this.pendingEvents]);
      this.pendingEvents = [];
    }
  }

  private getRelativePath(url: string): string {
    if (url.startsWith(this.baseOrigin)) {
      return url.slice(this.baseOrigin.length) || '/';
    }
    return url;
  }

  async stop(): Promise<RecordingEventData[]> {
    console.log('  [EmbeddedRecorder] Stopping recording...');
    this.isRecording = false;

    if (this.eventBatchInterval) {
      clearInterval(this.eventBatchInterval);
      this.eventBatchInterval = null;
    }

    // Flush any remaining events
    this.flushPendingEvents();

    // Add completion event
    this.addEvent('complete', {});
    this.flushPendingEvents();

    // Close recording context+page (browser stays alive)
    if (this.page) await this.page.close().catch(() => {});
    if (this.context) await this.context.close().catch(() => {});
    this.page = null;
    this.context = null;

    console.log(`  [EmbeddedRecorder] Recording stopped, ${this.events.length} events captured`);
    return this.events;
  }

  /**
   * Capture a screenshot from the recording page and add it as a recording event.
   */
  async takeScreenshot(): Promise<{ data: string; width: number; height: number } | null> {
    if (!this.page || !this.isRecording) return null;
    try {
      const buffer = await this.page.screenshot({ fullPage: true });
      const viewport = this.page.viewportSize() || { width: 1280, height: 720 };
      const data = buffer.toString('base64');
      this.addEvent('screenshot', { screenshotData: data, width: viewport.width, height: viewport.height });
      return { data, width: viewport.width, height: viewport.height };
    } catch (err) {
      console.error('[EmbeddedRecorder] Failed to take screenshot:', err);
      return null;
    }
  }

  /**
   * Create a page-level assertion event.
   */
  createAssertion(assertionType: string): void {
    if (!this.isRecording) return;
    this.addEvent('assertion', { assertionType });
  }

  /**
   * Flag that the next click should be wrapped in downloads.waitForDownload().
   */
  flagDownload(): void {
    if (!this.isRecording) return;
    this.nextClickIsDownload = true;
    this.addEvent('download', {});
  }

  /**
   * Force cleanup recorder state when stop() throws or recording needs to be force-killed.
   */
  async forceCleanup(): Promise<void> {
    console.log('  [EmbeddedRecorder] Force cleanup...');
    this.isRecording = false;
    if (this.eventBatchInterval) {
      clearInterval(this.eventBatchInterval);
      this.eventBatchInterval = null;
    }
    this.pendingEvents = [];
    this.onEvent = null;
    if (this.page) await this.page.close().catch(() => {});
    if (this.context) await this.context.close().catch(() => {});
    this.page = null;
    this.context = null;
  }

  isActive(): boolean {
    return this.isRecording;
  }

  getPage(): Page | null {
    return this.page;
  }
}
