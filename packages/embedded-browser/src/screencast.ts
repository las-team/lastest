/**
 * CDP Screencast Manager
 *
 * Uses Chrome DevTools Protocol to stream frames from a Playwright page.
 * Handles start/stop/ack lifecycle and frame broadcasting.
 */

import type { CDPSession, Page } from "playwright";

export interface ScreencastOptions {
  format?: "jpeg" | "png";
  quality?: number;
  maxWidth?: number;
  maxHeight?: number;
  everyNthFrame?: number;
}

export interface ScreencastFrame {
  data: string; // base64 encoded image
  metadata: {
    offsetTop: number;
    pageScaleFactor: number;
    deviceWidth: number;
    deviceHeight: number;
    scrollOffsetX: number;
    scrollOffsetY: number;
    timestamp?: number;
  };
  sessionId: number;
}

type FrameCallback = (frame: {
  data: string;
  width: number;
  height: number;
  timestamp: number;
}) => void;

export class ScreencastManager {
  private cdpSession: CDPSession | null = null;
  private currentPage: Page | null = null;
  private running = false;
  private frameCallback: FrameCallback | null = null;
  private width: number;
  private height: number;
  private ackFailCount = 0;
  private recovering = false;
  private lastFrameAt = 0;
  private frameWatchdog: ReturnType<typeof setInterval> | null = null;

  constructor(private options: ScreencastOptions = {}) {
    this.width = options.maxWidth ?? 1280;
    this.height = options.maxHeight ?? 720;
  }

  async start(page: Page, onFrame: FrameCallback): Promise<void> {
    // Always tear down any previous CDP session first. The old guard only
    // stopped when `running` was true, but the ack-failure path clears
    // `running` WITHOUT detaching — restarting on top of that leaked the old
    // session + frame listener, whose stale acks then poisoned the new stream.
    await this.stop();

    this.frameCallback = onFrame;
    this.ackFailCount = 0;
    this.currentPage = page;
    const session = await page.context().newCDPSession(page);
    this.cdpSession = session;
    this.running = true;

    session.on("Page.screencastFrame", (frame: ScreencastFrame) => {
      // Ignore frames from a superseded session (start() was called again).
      if (!this.running || this.cdpSession !== session) return;

      this.lastFrameAt = Date.now();

      // Relay frame to callback
      this.frameCallback?.({
        data: frame.data,
        width: frame.metadata.deviceWidth,
        height: frame.metadata.deviceHeight,
        timestamp: frame.metadata.timestamp ?? Date.now(),
      });

      // MUST acknowledge to receive next frame
      session
        .send("Page.screencastFrameAck", {
          sessionId: frame.sessionId,
        })
        .then(() => {
          this.ackFailCount = 0;
        })
        .catch(() => {
          if (this.cdpSession !== session) return;
          // Track consecutive ack failures — if CDP session is broken,
          // Chrome stops sending frames and the stream silently dies.
          this.ackFailCount++;
          if (this.ackFailCount >= 3) {
            console.error(
              "[Screencast] Multiple frame ack failures — CDP session likely broken, attempting restart",
            );
            void this.recover(session);
          }
        });
    });

    await session.send("Page.startScreencast", {
      format: this.options.format ?? "jpeg",
      quality: this.options.quality ?? 80,
      maxWidth: this.width,
      maxHeight: this.height,
      everyNthFrame: this.options.everyNthFrame ?? 1,
    });

    // Frame watchdog: an idle page legitimately produces no frames, but a
    // wedged screencast (lost ack, renderer hiccup) looks identical — the
    // viewer shows a stale picture while clicks demonstrably reach the page.
    // Re-kicking start/stop on the live session is cheap, forces Chrome to
    // emit a fresh frame immediately, and recovers a broken ack chain. If the
    // session itself is dead, the sends throw and we fall through to a full
    // detach/re-attach recovery.
    this.lastFrameAt = Date.now();
    this.frameWatchdog = setInterval(() => {
      if (!this.running || this.cdpSession !== session) return;
      if (Date.now() - this.lastFrameAt < 30_000) return;
      this.lastFrameAt = Date.now(); // avoid re-kicking every tick while idle
      session
        .send("Page.stopScreencast")
        .then(() =>
          session.send("Page.startScreencast", {
            format: this.options.format ?? "jpeg",
            quality: this.options.quality ?? 80,
            maxWidth: this.width,
            maxHeight: this.height,
            everyNthFrame: this.options.everyNthFrame ?? 1,
          }),
        )
        .catch(() => {
          console.error(
            "[Screencast] Watchdog re-kick failed — CDP session dead, re-attaching",
          );
          void this.recover(session);
        });
    }, 10_000);

    console.log(
      `[Screencast] Started (${this.width}x${this.height}, ${this.options.format ?? "jpeg"} q${this.options.quality ?? 80})`,
    );
  }

  /**
   * Tear down the broken CDP session and re-attach to the same page so the
   * stream self-heals instead of freezing until the next recording/debug
   * transition restarts it.
   */
  private async recover(fromSession: CDPSession): Promise<void> {
    if (this.recovering || this.cdpSession !== fromSession) return;
    this.recovering = true;
    const page = this.currentPage;
    const callback = this.frameCallback;
    try {
      await this.stop();
      if (page && callback && !page.isClosed()) {
        await this.start(page, callback);
        console.log("[Screencast] Recovered after ack failures");
      }
    } catch (err) {
      console.error("[Screencast] Recovery failed:", err);
    } finally {
      this.recovering = false;
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    this.frameCallback = null;
    this.currentPage = null;

    if (this.frameWatchdog) {
      clearInterval(this.frameWatchdog);
      this.frameWatchdog = null;
    }

    const session = this.cdpSession;
    this.cdpSession = null;
    if (!session) return;

    try {
      await session.send("Page.stopScreencast");
    } catch {
      // Ignore errors during cleanup
    }
    try {
      await session.detach();
    } catch {
      // Ignore errors during cleanup
    }

    console.log("[Screencast] Stopped");
  }

  isRunning(): boolean {
    return this.running;
  }

  async updateViewport(width: number, height: number): Promise<void> {
    this.width = width;
    this.height = height;

    if (this.running && this.cdpSession) {
      // Restart screencast with new dimensions
      try {
        await this.cdpSession.send("Page.stopScreencast");
        await this.cdpSession.send("Page.startScreencast", {
          format: this.options.format ?? "jpeg",
          quality: this.options.quality ?? 80,
          maxWidth: this.width,
          maxHeight: this.height,
          everyNthFrame: this.options.everyNthFrame ?? 1,
        });
      } catch (error) {
        console.error("[Screencast] Failed to update viewport:", error);
      }
    }
  }
}
