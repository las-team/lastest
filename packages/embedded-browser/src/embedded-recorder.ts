/**
 * Embedded Recorder
 *
 * Adapted from packages/runner/src/recorder.ts for the embedded browser.
 * Key differences:
 * - Receives an existing Browser instance (does NOT launch one)
 * - Creates a fresh BrowserContext + Page per recording session (full isolation)
 * - Setup runs upstream via testExecutor.runSetup; captured storageState is seeded into the recording context
 * - Closes the recording context/page on stop (browser stays alive)
 * - Sends events via callback
 */

import type { Browser, Page, BrowserContext } from "playwright";

/**
 * Callback for looking up a retained setup BrowserContext by setupId.
 * Wired by the caller (index.ts) to TestExecutor.getRetainedSetupContext —
 * avoids EmbeddedRecorder importing TestExecutor and keeps test surfaces
 * separate.
 */
export type RetainedSetupContextLookup = (setupId: string) => {
  context: BrowserContext;
  storageState?: unknown;
  viewport?: { width: number; height: number };
} | null;
import { browserRecordingScript } from "./browser-script.js";
import path from "path";
import fs from "fs";
import os from "os";

// Re-define minimal payload type to avoid cross-package imports
interface StartRecordingPayload {
  sessionId: string;
  targetUrl: string;
  viewport?: { width: number; height: number };
  selectorPriority?: Array<{
    type: string;
    enabled: boolean;
    priority: number;
  }>;
  pointerGestures?: boolean;
  cursorFPS?: number;
  setupSteps?: Array<{ code: string; codeHash: string }>;
  // setupContextId identifies a LIVE BrowserContext retained by TestExecutor
  // after a successful setup run. The recorder reuses it (creates a fresh
  // page in it) so the recording inherits cookies + localStorage +
  // sessionStorage + IndexedDB + in-memory auth. Test-runs use the same
  // pattern (line 401 in test-executor.ts).
  setupContextId?: string;
  // storageStateJson is the fallback when the retained context lookup fails
  // (e.g. context aged out via the sweeper). Only preserves cookies +
  // localStorage — modern SPAs storing auth in sessionStorage will end up
  // un-authed on this path. Setup must succeed and not age out for the
  // happy path.
  storageStateJson?: string;
}

export interface RecordingSelectorMatch {
  type: string;
  value: string;
  count: number;
}

export interface RecordingEventData {
  type: string;
  timestamp: number;
  sequence: number;
  status: "preview" | "committed";
  verification?: {
    syntaxValid: boolean;
    domVerified?: boolean;
    lastChecked?: number;
    selectorMatches?: RecordingSelectorMatch[];
    chosenSelector?: string;
    autoRepaired?: boolean;
  };
  data: Record<string, unknown>;
}

export interface AttachToPageOptions {
  selectorPriority?: Array<{
    type: string;
    enabled: boolean;
    priority: number;
  }>;
  pointerGestures?: boolean;
  cursorFPS?: number;
  // Debug-mode recordings don't render thumbnails anywhere in the UI —
  // skip the crop work and the base64 payload bloat for that path.
  captureThumbnails?: boolean;
}

export class EmbeddedRecorder {
  private page: Page | null = null;
  private context: BrowserContext | null = null;
  // false when context is a borrowed setup-context (TestExecutor owns it);
  // true when EmbeddedRecorder built a fresh context and must clean it up.
  private ownsContext = true;
  private events: RecordingEventData[] = [];
  private sequenceCounter = 0;
  private baseOrigin = "";
  private isRecording = false;
  private eventBatchInterval: ReturnType<typeof setInterval> | null = null;
  private pendingEvents: RecordingEventData[] = [];
  private onEvent: ((events: RecordingEventData[]) => void) | null = null;
  private nextClickIsDownload = false;
  private captureThumbnails = true;
  // Tracks which Page has already had __recordAction etc. exposed onto it —
  // Playwright throws if exposeFunction is called twice for the same name on
  // the same Page. Recording-from-here can attach to the same live debug
  // page more than once in a session without an intervening rewind.
  private exposedOnPage: Page | null = null;
  // Latest CDP screencast frame (base64 JPEG + device dims), fed by index.ts's
  // screencast callback. Element thumbnails are CROPPED FROM THIS FRAME instead
  // of taking a fresh screenshot of the page: any page capture
  // (page.screenshot / Page.captureScreenshot, in any mode) momentarily
  // contends with the active screencast and glitches a frame, which the live
  // viewer renders as a flicker on every click. Reusing a frame we already
  // have costs the page nothing.
  private latestFrame: { data: string; width: number; height: number } | null =
    null;

  /**
   * Start recording on a fresh context/page.
   * Returns the new page so the caller can attach screencast/input to it.
   *
   * `lookupRetainedSetupContext` is wired by index.ts to
   * TestExecutor.getRetainedSetupContext. When `payload.setupContextId` and
   * a matching retained context are available, the recording REUSES that
   * context instead of building a fresh one — preserving sessionStorage,
   * IndexedDB, and in-memory auth state that the storageState JSON drops.
   */
  async start(
    browser: Browser,
    payload: StartRecordingPayload,
    onEvent: (events: RecordingEventData[]) => void,
    lookupRetainedSetupContext?: RetainedSetupContextLookup,
  ): Promise<Page> {
    this.onEvent = onEvent;
    this.baseOrigin = new URL(payload.targetUrl).origin;
    this.events = [];
    this.sequenceCounter = 0;
    this.pendingEvents = [];

    const viewport = payload.viewport ?? { width: 1280, height: 720 };

    // Try to REUSE a retained setup context first — preserves full auth state
    // (sessionStorage / IndexedDB / in-memory) the JSON snapshot drops.
    let retainedContext: BrowserContext | null = null;
    if (payload.setupContextId && lookupRetainedSetupContext) {
      const entry = lookupRetainedSetupContext(payload.setupContextId);
      if (entry) {
        retainedContext = entry.context;
        console.log(
          `  [EmbeddedRecorder] Reusing live setup context (setupId=${payload.setupContextId})`,
        );
      } else {
        console.warn(
          `  [EmbeddedRecorder] Retained setup context ${payload.setupContextId} aged out — falling back to storageState JSON`,
        );
      }
    }

    if (retainedContext) {
      this.context = retainedContext;
      // Don't close the context on stop — it belongs to TestExecutor's
      // setupContexts map and is shared with the sweeper / future runs.
      this.ownsContext = false;
    } else {
      // Fallback: build a fresh context, seeded with storageState JSON if any.
      // Auth missing sessionStorage / IndexedDB ends up here.
      let parsedStorageState:
        | NonNullable<Parameters<Browser["newContext"]>[0]>["storageState"]
        | undefined;
      if (payload.storageStateJson) {
        try {
          parsedStorageState = JSON.parse(payload.storageStateJson);
        } catch (err) {
          console.warn(
            `  [EmbeddedRecorder] Bad storageStateJson, recording starts un-authed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      this.context = await browser.newContext({
        viewport,
        ignoreHTTPSErrors: true,
        acceptDownloads: true,
        ...(parsedStorageState ? { storageState: parsedStorageState } : {}),
      });
      this.ownsContext = true;
    }
    this.page = await this.context.newPage();
    await this.page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });

      // Intercept File System Access API (showSaveFilePicker) — convert to a regular
      // blob download so Playwright's download event fires and we can capture it.
      if (typeof window !== "undefined") {
        const _origSave = (window as unknown as Record<string, unknown>)
          .showSaveFilePicker as
          | ((...args: unknown[]) => Promise<unknown>)
          | undefined;
        (window as unknown as Record<string, unknown>).showSaveFilePicker =
          async function (...args: unknown[]) {
            // Extract suggested filename from options
            const opts = (args[0] ?? {}) as Record<string, unknown>;
            const suggestedName = (opts.suggestedName as string) || "download";

            // Create a fake FileSystemFileHandle that collects written data
            // then triggers a real <a download> click
            const chunks: BlobPart[] = [];
            const fakeHandle = {
              createWritable: async () => ({
                write: async (data: BlobPart) => {
                  chunks.push(data);
                },
                seek: async () => {},
                truncate: async () => {},
                close: async () => {
                  // Trigger a real download via <a> element
                  const blob = new Blob(chunks);
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = suggestedName;
                  a.style.display = "none";
                  document.body.appendChild(a);
                  a.click();
                  setTimeout(() => {
                    URL.revokeObjectURL(url);
                    a.remove();
                  }, 100);
                },
              }),
              getFile: async () => new File(chunks, suggestedName),
            };
            return fakeHandle;
          };
      }
    });

    // Setup chain already ran via testExecutor.runSetup in the caller
    // (packages/embedded-browser/src/index.ts case 'command:start_recording')
    // and its captured storageState is seeded into this.context above. We
    // just navigate to the target URL — cookies / localStorage from auth
    // setup are present from the first frame.
    await this.page.goto(payload.targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    await this.attachToPage(this.page, this.baseOrigin, payload, onEvent);

    // Record initial navigation — debug-mode attaches mid-session (the page
    // is already wherever the user/test left it), so this is start()-only.
    const relativePath = this.getRelativePath(payload.targetUrl);
    this.addEvent("navigation", { url: payload.targetUrl, relativePath });

    // Track navigation events
    this.page.on("framenavigated", (frame) => {
      if (frame === this.page?.mainFrame() && this.isRecording) {
        const url = frame.url();
        const rp = this.getRelativePath(url);
        this.addEvent("navigation", { url, relativePath: rp });
      }
    });

    console.log(
      `  [EmbeddedRecorder] Recording started, viewport: ${viewport.width}x${viewport.height}`,
    );
    return this.page;
  }

  /**
   * Wire event capture (exposeFunction + script injection + download/crash
   * handling + batching) onto an EXTERNALLY-OWNED, already-live page. Used
   * by debug-mode "Record from here" to attach to the live debugPage rather
   * than creating a fresh one (which is what `start()` does). `start()`
   * itself calls this after creating + navigating its own page, so both
   * flows share one capture implementation.
   *
   * Does NOT take ownership of the page/context — callers that borrow a
   * page must call `stop(false)` so cleanup doesn't close it.
   */
  async attachToPage(
    page: Page,
    baseOrigin: string,
    options: AttachToPageOptions,
    onEvent: (events: RecordingEventData[]) => void,
  ): Promise<void> {
    this.page = page;
    this.baseOrigin = baseOrigin;
    this.onEvent = onEvent;
    this.events = [];
    this.sequenceCounter = 0;
    this.pendingEvents = [];
    this.captureThumbnails = options.captureThumbnails ?? true;

    // Detect page crash/close to prevent using a dead page
    page.on("crash", () => {
      console.error("  [EmbeddedRecorder] Recording page crashed!");
      this.isRecording = false;
      if (this.eventBatchInterval) {
        clearInterval(this.eventBatchInterval);
        this.eventBatchInterval = null;
      }
    });

    page.on("close", () => {
      if (this.isRecording) {
        console.warn("  [EmbeddedRecorder] Recording page closed unexpectedly");
        this.isRecording = false;
        if (this.eventBatchInterval) {
          clearInterval(this.eventBatchInterval);
          this.eventBatchInterval = null;
        }
      }
    });

    // Set up recording event capture (exposeFunction + inject script)
    await this.setupRecording(page, options);

    this.isRecording = true;

    // Auto-detect downloads: retroactively mark the last click/mouse-down as download-triggering
    // and auto-save the file so the download completes without a file dialog
    const dlDir = path.join(os.tmpdir(), "lastest-eb-downloads");
    fs.mkdirSync(dlDir, { recursive: true });
    page.on("download", async (download) => {
      if (!this.isRecording) return;
      for (let i = this.events.length - 1; i >= 0; i--) {
        const ev = this.events[i];
        const isClick =
          ev.type === "action" &&
          (ev.data.action === "click" || ev.data.action === "rightclick");
        const isMouseDown = ev.type === "mouse-down";
        if (isClick || isMouseDown) {
          if (!ev.data.downloadWrap) {
            ev.data.downloadWrap = true;
            ev.data.autoDetected = true;
          }
          break;
        }
      }
      // Auto-save to temp dir so the download completes cleanly
      const safeName = path
        .basename(download.suggestedFilename())
        .replace(/\.\./g, "_");
      try {
        await download.saveAs(path.join(dlDir, safeName));
      } catch {
        /* best-effort */
      }
      // Auto-add download assertion to timeline
      this.addEvent("assertion", {
        assertionType: "downloadExists",
        downloadFilename: download.suggestedFilename(),
      });
    });

    // Batch events and send to server periodically. 150 ms keeps timeline
    // perceived latency under the Doherty threshold even with the 150 ms UI
    // poll on the other side.
    this.eventBatchInterval = setInterval(() => {
      this.flushPendingEvents();
    }, 150);
  }

  private async setupRecording(
    page: Page,
    options: AttachToPageOptions,
  ): Promise<void> {
    const selectorPriority = options.selectorPriority ?? [];
    const pointerGestures = options.pointerGestures ?? false;

    if (this.exposedOnPage === page) {
      // Already exposed __recordAction etc. on this exact Page object (a
      // second "record from here" on the same live debug page, with no
      // rewind in between) — exposeFunction would throw on re-registration.
      // Re-run the script injection only, which resets in-page listener
      // state for the new recording pass.
      const initArgs = {
        pointerGestures,
        cursorFPS: options.cursorFPS ?? 30,
        selectorPriority,
      };
      await page.addInitScript(browserRecordingScript, initArgs);
      await page.evaluate(browserRecordingScript, initArgs);
      return;
    }

    // Expose recording functions that forward events to the server
    await page.exposeFunction(
      "__recordAction",
      (
        action: string,
        selectors: Array<{ type: string; value: string }>,
        value?: string,
        boundingBox?: {
          x: number;
          y: number;
          width: number;
          height: number;
          clickX?: number;
          clickY?: number;
        },
        actionId?: string,
        modifiers?: string[],
      ) => {
        const primarySelector = selectors[0]?.value || "";
        // Use actual click position if available (critical for canvas elements),
        // otherwise fall back to element center (fine for buttons/inputs)
        const coordinates = boundingBox
          ? boundingBox.clickX != null && boundingBox.clickY != null
            ? {
                x: Math.round(boundingBox.clickX),
                y: Math.round(boundingBox.clickY),
              }
            : {
                x: Math.round(boundingBox.x + boundingBox.width / 2),
                y: Math.round(boundingBox.y + boundingBox.height / 2),
              }
          : undefined;

        const validSelectors = selectors.filter(
          (sel) =>
            sel.value && sel.value.trim() && !sel.value.includes("undefined"),
        );
        const hasValidSelectors = validSelectors.length > 0;
        const hasCoordsFallback =
          (action === "click" || action === "rightclick") &&
          coordinates !== undefined;
        const syntaxValid = hasValidSelectors || hasCoordsFallback;

        // Check if this click was pre-flagged as a download trigger
        const downloadWrap =
          (action === "click" || action === "rightclick") &&
          this.nextClickIsDownload
            ? true
            : undefined;
        if (downloadWrap) this.nextClickIsDownload = false;

        this.addEvent(
          "action",
          {
            action,
            selector: primarySelector,
            selectors,
            value,
            coordinates,
            actionId,
            modifiers:
              modifiers && modifiers.length > 0 ? modifiers : undefined,
            downloadWrap,
          },
          "committed",
          {
            syntaxValid,
            domVerified: undefined,
            lastChecked: undefined,
          },
        );

        // Best-effort element thumbnail (see runner recorder for rationale).
        // Skipped entirely for debug-mode recording — nothing in the debug
        // UI renders these, so there's no reason to pay the crop work or
        // grow the payload.
        if (actionId && boundingBox && this.captureThumbnails) {
          void this.captureElementThumbnail(actionId, boundingBox);
        }
      },
    );

    if (pointerGestures) {
      await page.exposeFunction(
        "__recordCursorMove",
        (x: number, y: number) => {
          this.addEvent("cursor-move", { coordinates: { x, y } });
        },
      );

      await page.exposeFunction(
        "__recordMouseEvent",
        (
          type: string,
          x: number,
          y: number,
          button: number,
          modifiers?: string[],
        ) => {
          // Check if this mouse-down was pre-flagged as a download trigger
          const downloadWrap =
            type === "down" && this.nextClickIsDownload ? true : undefined;
          if (downloadWrap) this.nextClickIsDownload = false;

          this.addEvent(type === "down" ? "mouse-down" : "mouse-up", {
            coordinates: { x, y },
            button,
            modifiers:
              modifiers && modifiers.length > 0 ? modifiers : undefined,
            downloadWrap,
          });
        },
      );
    }

    await page.exposeFunction(
      "__recordKeypress",
      (key: string, modifiers?: string[]) => {
        this.addEvent("keypress", {
          key,
          modifiers: modifiers && modifiers.length > 0 ? modifiers : undefined,
        });
      },
    );

    // Scroll tracking with coalescing (mirrors server-side recorder logic)
    await page.exposeFunction(
      "__recordScroll",
      (deltaX: number, deltaY: number, modifiers?: string[]) => {
        const mods = modifiers && modifiers.length > 0 ? modifiers : undefined;
        // Coalesce with previous scroll event if same modifiers
        if (this.events.length > 0) {
          const lastEvent = this.events[this.events.length - 1];
          if (lastEvent?.type === "scroll") {
            const lastMods = lastEvent.data.modifiers;
            if (JSON.stringify(lastMods) === JSON.stringify(mods)) {
              lastEvent.data.deltaX =
                ((lastEvent.data.deltaX as number) || 0) + deltaX;
              lastEvent.data.deltaY =
                ((lastEvent.data.deltaY as number) || 0) + deltaY;
              return;
            }
          }
        }
        this.addEvent("scroll", { deltaX, deltaY, modifiers: mods });
      },
    );

    await page.exposeFunction(
      "__recordHoverPreview",
      (elementInfo: Record<string, unknown>) => {
        // Replace previous hover-preview in pending batch
        if (this.events.length > 0) {
          const lastEvent = this.events[this.events.length - 1];
          if (
            lastEvent?.type === "hover-preview" &&
            lastEvent.status === "preview"
          ) {
            this.events.pop();
            this.sequenceCounter--;
            const pendingIdx = this.pendingEvents.findLastIndex(
              (e) => e.type === "hover-preview",
            );
            if (pendingIdx !== -1) this.pendingEvents.splice(pendingIdx, 1);
          }
        }
        this.addEvent("hover-preview", { elementInfo }, "preview");
      },
    );

    await page.exposeFunction(
      "__recordElementAssertion",
      (assertion: Record<string, unknown>) => {
        this.addEvent("assertion", { elementAssertion: assertion });
      },
    );

    await page.exposeFunction("__recordScreenshot", () => {
      this.takeScreenshot();
    });

    await page.exposeFunction(
      "__updateVerification",
      (
        actionId: string,
        verified: boolean,
        extra?: {
          selectorMatches?: RecordingSelectorMatch[];
          chosenSelector?: string;
          autoRepaired?: boolean;
        },
      ) => {
        const event = this.events.find((e) => e.data.actionId === actionId);
        if (event && event.verification) {
          event.verification.domVerified = verified;
          event.verification.lastChecked = Date.now();
          if (extra?.selectorMatches)
            event.verification.selectorMatches = extra.selectorMatches;
          if (extra?.chosenSelector)
            event.verification.chosenSelector = extra.chosenSelector;
          if (extra?.autoRepaired !== undefined)
            event.verification.autoRepaired = extra.autoRepaired;
          if (!this.pendingEvents.includes(event)) {
            this.pendingEvents.push(event);
          }
        }
      },
    );

    // Inject the browser-side recording script
    const initArgs = {
      pointerGestures,
      cursorFPS: options.cursorFPS ?? 30,
      selectorPriority,
    };

    await page.addInitScript(browserRecordingScript, initArgs);
    await page.evaluate(browserRecordingScript, initArgs);
    this.exposedOnPage = page;
  }

  private addEvent(
    type: string,
    data: Record<string, unknown>,
    status: "preview" | "committed" = "committed",
    verification?: NonNullable<RecordingEventData["verification"]>,
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

  /**
   * Best-effort capture of a small thumbnail centered on the just-clicked
   * element's bounding box. Embedded as a data URL on the action event so
   * the live timeline can render a visual confirmation. Capped at 240×240
   * to keep payloads small (~5–25 KB base64).
   */
  /** Fed by index.ts's screencast frame callback so thumbnails can be cropped
   *  from the live stream rather than captured separately. */
  setLatestFrame(data: string, width: number, height: number): void {
    this.latestFrame = { data, width, height };
  }

  private async captureElementThumbnail(
    actionId: string,
    boundingBox: { x: number; y: number; width: number; height: number },
  ): Promise<void> {
    if (!this.page) return;
    const frame = this.latestFrame;
    if (!frame) return; // no screencast frame yet — skip rather than capture
    try {
      const padding = 8;
      const maxSide = 240;
      const viewport = this.page.viewportSize() ?? { width: 1280, height: 720 };
      // boundingBox is viewport-relative CSS px; the frame is device px. Map
      // CSS → frame px so the crop lines up regardless of devicePixelRatio.
      const scaleX = frame.width / viewport.width;
      const scaleY = frame.height / viewport.height;
      const sx = Math.max(0, Math.round((boundingBox.x - padding) * scaleX));
      const sy = Math.max(0, Math.round((boundingBox.y - padding) * scaleY));
      const sw = Math.round(
        Math.min(
          (boundingBox.width + padding * 2) * scaleX,
          maxSide * scaleX,
          frame.width - sx,
        ),
      );
      const sh = Math.round(
        Math.min(
          (boundingBox.height + padding * 2) * scaleY,
          maxSide * scaleY,
          frame.height - sy,
        ),
      );
      if (sw < 1 || sh < 1) return;

      // Crop the already-streamed frame INSIDE the page using OffscreenCanvas.
      // This is pure off-thread computation — no DOM, no layout, no compositor
      // surface read — so it cannot glitch the live screencast (unlike
      // page.screenshot / Page.captureScreenshot, which do). Decode from a Blob
      // (not fetch()) to dodge any page CSP on data: URLs.
      const cropped = await this.page.evaluate(
        async (a: {
          frameData: string;
          sx: number;
          sy: number;
          sw: number;
          sh: number;
        }) => {
          try {
            const bin = atob(a.frameData);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            const blob = new Blob([bytes], { type: "image/jpeg" });
            const bmp = await createImageBitmap(blob, a.sx, a.sy, a.sw, a.sh);
            const canvas = new OffscreenCanvas(a.sw, a.sh);
            const ctx = canvas.getContext("2d");
            if (!ctx) return null;
            ctx.drawImage(bmp, 0, 0);
            bmp.close();
            const out = await canvas.convertToBlob({
              type: "image/jpeg",
              quality: 0.7,
            });
            const arr = new Uint8Array(await out.arrayBuffer());
            let s = "";
            for (let i = 0; i < arr.length; i++)
              s += String.fromCharCode(arr[i]);
            return btoa(s);
          } catch {
            return null;
          }
        },
        { frameData: frame.data, sx, sy, sw, sh },
      );

      if (!cropped) return;
      const event = this.events.find((e) => e.data.actionId === actionId);
      if (!event) return;
      event.data.thumbnailPath = `data:image/jpeg;base64,${cropped}`;
      if (!this.pendingEvents.includes(event)) {
        this.pendingEvents.push(event);
      }
    } catch {
      // best-effort: element gone, navigation in flight, or evaluate detached.
    }
  }

  private flushPendingEvents(): void {
    if (this.pendingEvents.length > 0 && this.onEvent) {
      this.onEvent([...this.pendingEvents]);
      this.pendingEvents = [];
    }
  }

  /**
   * User-initiated selector promotion from the timeline UI. Updates the
   * action event's chosenSelector + autoRepaired flag and re-queues for
   * emission so the generated test code at stop-time uses the new selector.
   * Only updates events that are still in committed state with the same
   * actionId — older sessions or stale IDs are silently ignored.
   */
  promoteSelector(actionId: string, selectorValue: string): void {
    const event = this.events.find((e) => e.data.actionId === actionId);
    if (!event) return;
    if (!event.verification) {
      event.verification = { syntaxValid: true };
    }
    event.verification.chosenSelector = selectorValue;
    event.verification.autoRepaired = true;
    if (!this.pendingEvents.includes(event)) {
      this.pendingEvents.push(event);
    }
  }

  private getRelativePath(url: string): string {
    if (url.startsWith(this.baseOrigin)) {
      return url.slice(this.baseOrigin.length) || "/";
    }
    return url;
  }

  /**
   * @param closePage Pass `false` when the page is borrowed (debug-mode
   * "Record from here") and owned/closed by someone else — e.g. the live
   * debug session keeps running on it, or `replayToStep` is about to tear
   * it down for an unrelated reason. Defaults to `true`, preserving the
   * full `/record` flow's existing behavior unchanged.
   */
  async stop(closePage = true): Promise<RecordingEventData[]> {
    console.log("  [EmbeddedRecorder] Stopping recording...");
    this.isRecording = false;

    if (this.eventBatchInterval) {
      clearInterval(this.eventBatchInterval);
      this.eventBatchInterval = null;
    }

    // Flush any remaining events
    this.flushPendingEvents();

    // Add completion event
    this.addEvent("complete", {});
    this.flushPendingEvents();

    // Close the recording page. Only close the context if we own it —
    // borrowed setup-contexts belong to TestExecutor's setupContexts map
    // and stay alive for the sweeper / future test runs.
    this.latestFrame = null;
    const closedPage = closePage && !!this.page;
    if (closedPage) await this.page!.close().catch(() => {});
    if (this.context && this.ownsContext)
      await this.context.close().catch(() => {});
    // When the page is NOT closed (debug "record from here" borrows the live
    // page), its exposeFunction bindings stay registered. Keep exposedOnPage
    // pointing at it so a second record-from-here on the same page takes the
    // re-inject-script branch in setupRecording instead of re-calling
    // exposeFunction → "Function has been already registered." Only clear it
    // when the page was actually torn down.
    const reusablePage = closedPage ? null : this.page;
    this.page = null;
    this.context = null;
    this.ownsContext = true;
    this.exposedOnPage = closedPage ? null : reusablePage;

    console.log(
      `  [EmbeddedRecorder] Recording stopped, ${this.events.length} events captured`,
    );
    return this.events;
  }

  /**
   * Capture a screenshot from the recording page and add it as a recording event.
   */
  async takeScreenshot(): Promise<{
    data: string;
    width: number;
    height: number;
  } | null> {
    if (!this.page || !this.isRecording) return null;
    try {
      const buffer = await this.page.screenshot({ fullPage: true });
      const viewport = this.page.viewportSize() || { width: 1280, height: 720 };
      const data = buffer.toString("base64");
      this.addEvent("screenshot", {
        screenshotData: data,
        width: viewport.width,
        height: viewport.height,
      });
      return { data, width: viewport.width, height: viewport.height };
    } catch (err) {
      console.error("[EmbeddedRecorder] Failed to take screenshot:", err);
      return null;
    }
  }

  /**
   * Create a page-level assertion event.
   */
  createAssertion(assertionType: string): void {
    if (!this.isRecording) return;
    this.addEvent("assertion", { assertionType });
  }

  /**
   * Create a wait event (fixed duration or wait-for-selector).
   * The recorder does not actually pause — codegen turns this into a
   * page.waitForTimeout / page.waitForSelector call at replay time.
   */
  createWait(payload: {
    waitType: "duration" | "selector";
    durationMs?: number;
    selector?: string;
    selectors?: Array<{ type: string; value: string }>;
    condition?: "visible" | "hidden";
    timeoutMs?: number;
  }): void {
    if (!this.isRecording) return;
    this.addEvent("wait", {
      waitType: payload.waitType,
      durationMs: payload.durationMs,
      selector: payload.selector,
      selectors: payload.selectors,
      condition: payload.condition,
      timeoutMs: payload.timeoutMs,
    });
  }

  /**
   * Insert a timestamp at the current cursor position in the browser.
   */
  async insertTimestamp(): Promise<void> {
    if (!this.isRecording || !this.page) return;
    const timestamp = new Date().toISOString();
    await this.page.keyboard.type(timestamp);
    this.addEvent("insert-timestamp", { timestampFormat: "iso" });
  }

  /**
   * Flag that the next click should be wrapped in downloads.waitForDownload().
   */
  flagDownload(): void {
    if (!this.isRecording) return;
    this.nextClickIsDownload = true;
    this.addEvent("download", {});
  }

  /**
   * Force cleanup recorder state when stop() throws or recording needs to be force-killed.
   */
  async forceCleanup(): Promise<void> {
    console.log("  [EmbeddedRecorder] Force cleanup...");
    this.isRecording = false;
    if (this.eventBatchInterval) {
      clearInterval(this.eventBatchInterval);
      this.eventBatchInterval = null;
    }
    this.pendingEvents = [];
    this.onEvent = null;
    this.latestFrame = null;
    if (this.page) await this.page.close().catch(() => {});
    // Only close borrowed contexts; setup-contexts are owned by TestExecutor.
    if (this.context && this.ownsContext)
      await this.context.close().catch(() => {});
    this.page = null;
    this.context = null;
    this.ownsContext = true;
    this.exposedOnPage = null;
  }

  isActive(): boolean {
    return this.isRecording;
  }

  getPage(): Page | null {
    return this.page;
  }

  getEventCount(): number {
    return this.events.length;
  }
}
