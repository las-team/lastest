/**
 * Remote Recorder for Runner
 * Launches a headed browser on the runner machine, captures user interactions,
 * and sends events back to the server.
 */

import { chromium, firefox, webkit, Browser, Page, BrowserContext } from 'playwright';
import type { StartRecordingCommandPayload, RecordingEventData } from './protocol.js';
import { browserRecordingScript } from './browser-script.js';

export class RemoteRecorder {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private context: BrowserContext | null = null;
  private events: RecordingEventData[] = [];
  private sequenceCounter = 0;
  private sessionId = '';
  private baseOrigin = '';
  private isRecording = false;
  private eventBatchInterval: ReturnType<typeof setInterval> | null = null;
  private pendingEvents: RecordingEventData[] = [];
  private onEvent: ((events: RecordingEventData[]) => void) | null = null;

  async start(
    payload: StartRecordingCommandPayload,
    onEvent: (events: RecordingEventData[]) => void,
    onStopped: () => void
  ): Promise<void> {
    this.sessionId = payload.sessionId;
    this.onEvent = onEvent;
    this.baseOrigin = new URL(payload.targetUrl).origin;
    this.events = [];
    this.sequenceCounter = 0;
    this.pendingEvents = [];

    const browserType = payload.browser ?? 'chromium';
    const launcher = browserType === 'firefox' ? firefox : browserType === 'webkit' ? webkit : chromium;

    console.log(`  [Recorder] Launching ${browserType} browser (headed)...`);

    this.browser = await launcher.launch({
      headless: false,
      args: ['--start-maximized'],
    });

    const viewport = payload.viewport ?? { width: 1280, height: 720 };
    this.context = await this.browser.newContext({
      viewport,
      ignoreHTTPSErrors: true,
    });
    this.page = await this.context.newPage();

    // Set up recording event capture
    await this.setupRecording(payload);

    // Navigate to target URL
    await this.page.goto(payload.targetUrl, { waitUntil: 'domcontentloaded' });

    this.isRecording = true;

    // Record initial navigation
    const relativePath = this.getRelativePath(payload.targetUrl);
    this.addEvent('navigation', { url: payload.targetUrl, relativePath });

    // Batch events and send to server periodically. 150 ms keeps perceived
    // timeline latency under the Doherty threshold (~400 ms end-to-end with
    // a 150 ms client poll on top).
    this.eventBatchInterval = setInterval(() => {
      this.flushPendingEvents();
    }, 150);

    // Handle browser close (user closed the window)
    this.browser.on('disconnected', () => {
      if (this.isRecording) {
        console.log('  [Recorder] Browser disconnected, stopping recording');
        this.isRecording = false;
        this.flushPendingEvents();
        onStopped();
      }
    });

    // Track navigation events
    this.page.on('framenavigated', (frame) => {
      if (frame === this.page?.mainFrame() && this.isRecording) {
        const url = frame.url();
        const relativePath = this.getRelativePath(url);
        this.addEvent('navigation', { url, relativePath });
      }
    });

    console.log(`  [Recorder] Recording started, viewport: ${viewport.width}x${viewport.height}`);
  }

  private async setupRecording(payload: StartRecordingCommandPayload): Promise<void> {
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
      const hasCoordsFallback = (action === 'click' || action === 'rightclick' || action === 'fill') && coordinates !== undefined;
      const syntaxValid = hasValidSelectors || hasCoordsFallback;

      this.addEvent('action', {
        action, selector: primarySelector, selectors, value, coordinates, actionId,
        modifiers: modifiers && modifiers.length > 0 ? modifiers : undefined,
      }, 'committed', {
        syntaxValid,
        domVerified: undefined,
        lastChecked: undefined,
      });

      // Best-effort element thumbnail. Fires immediately so the timeline can
      // show a visual confirmation of what was clicked, but never awaited —
      // a slow screenshot must not block the user's next interaction.
      if (actionId && boundingBox) {
        void this.captureElementThumbnail(actionId, boundingBox);
      }
    });

    if (pointerGestures) {
      await this.page.exposeFunction('__recordCursorMove', (x: number, y: number) => {
        this.addEvent('cursor-move', { coordinates: { x, y } });
      });

      await this.page.exposeFunction('__recordMouseEvent', (type: string, x: number, y: number, button: number, modifiers?: string[]) => {
        this.addEvent(type === 'down' ? 'mouse-down' : 'mouse-up', {
          coordinates: { x, y }, button,
          modifiers: modifiers && modifiers.length > 0 ? modifiers : undefined,
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
          // Also remove from pending
          const pendingIdx = this.pendingEvents.findLastIndex(e => e.type === 'hover-preview');
          if (pendingIdx !== -1) this.pendingEvents.splice(pendingIdx, 1);
        }
      }
      this.addEvent('hover-preview', { elementInfo }, 'preview');
    });

    await this.page.exposeFunction('__recordElementAssertion', (assertion: Record<string, unknown>) => {
      this.addEvent('assertion', { elementAssertion: assertion });
    });

    await this.page.exposeFunction('__updateVerification', (
      actionId: string,
      verified: boolean,
      extra?: {
        selectorMatches?: Array<{ type: string; value: string; count: number }>;
        chosenSelector?: string;
        autoRepaired?: boolean;
      },
    ) => {
      const event = this.events.find(e => e.data.actionId === actionId);
      if (event && event.verification) {
        event.verification.domVerified = verified;
        event.verification.lastChecked = Date.now();
        if (extra?.selectorMatches) event.verification.selectorMatches = extra.selectorMatches;
        if (extra?.chosenSelector) event.verification.chosenSelector = extra.chosenSelector;
        if (extra?.autoRepaired !== undefined) event.verification.autoRepaired = extra.autoRepaired;
        // Re-queue for emission so the server (and UI poll) sees the updated
        // verification — events and pendingEvents share refs, so if it's
        // still pending the same flush carries the update; if it was already
        // flushed, the dedup-by-sequence in getRemoteRecordingEvents picks
        // the newer copy.
        if (!this.pendingEvents.includes(event)) {
          this.pendingEvents.push(event);
        }
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
    verification?: NonNullable<RecordingEventData['verification']>
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

  /**
   * Best-effort capture of a small thumbnail centered on the just-clicked
   * element's bounding box. Embedded as a data URL on the action event so
   * the live timeline can render a visual confirmation of what the user
   * clicked. Padded by 8 px and capped at 240×240 so the payload stays
   * small (typical ~5–25 KB base64).
   */
  private async captureElementThumbnail(
    actionId: string,
    boundingBox: { x: number; y: number; width: number; height: number },
  ): Promise<void> {
    if (!this.page) return;
    try {
      const padding = 8;
      const maxSide = 240;
      const x = Math.max(0, boundingBox.x - padding);
      const y = Math.max(0, boundingBox.y - padding);
      const width = Math.max(1, Math.min(boundingBox.width + padding * 2, maxSide));
      const height = Math.max(1, Math.min(boundingBox.height + padding * 2, maxSide));
      const buf = await this.page.screenshot({
        clip: { x, y, width, height },
        animations: 'disabled',
        timeout: 500,
      });
      const event = this.events.find(e => e.data.actionId === actionId);
      if (!event) return;
      event.data.thumbnailPath = `data:image/png;base64,${buf.toString('base64')}`;
      if (!this.pendingEvents.includes(event)) {
        this.pendingEvents.push(event);
      }
    } catch {
      // Element gone, navigation in flight, or screenshot timeout — skip.
    }
  }

  async takeScreenshot(): Promise<{ data: string; width: number; height: number } | null> {
    if (!this.page || !this.isRecording) return null;

    try {
      const buffer = await this.page.screenshot({ fullPage: true });
      const base64 = buffer.toString('base64');
      // Get viewport dimensions
      const viewport = this.page.viewportSize() ?? { width: 1280, height: 720 };

      // Add screenshot event
      this.addEvent('screenshot', { screenshotPath: `remote-screenshot-${Date.now()}.png` });

      return { data: base64, width: viewport.width, height: viewport.height };
    } catch (err) {
      console.error('  [Recorder] Screenshot failed:', err);
      return null;
    }
  }

  async stop(): Promise<RecordingEventData[]> {
    console.log('  [Recorder] Stopping recording...');
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

    await this.cleanup();

    console.log(`  [Recorder] Recording stopped, ${this.events.length} events captured`);
    return this.events;
  }

  isActive(): boolean {
    return this.isRecording;
  }

  getEvents(): RecordingEventData[] {
    return this.events;
  }

  private async cleanup(): Promise<void> {
    if (this.page) await this.page.close().catch(() => {});
    if (this.context) await this.context.close().catch(() => {});
    if (this.browser) await this.browser.close().catch(() => {});
    this.page = null;
    this.context = null;
    this.browser = null;
  }
}
