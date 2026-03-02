/**
 * CDP Screencast Manager
 *
 * Uses Chrome DevTools Protocol to stream frames from a Playwright page.
 * Handles start/stop/ack lifecycle and frame broadcasting.
 */

import type { CDPSession, Page } from 'playwright';

export interface ScreencastOptions {
  format?: 'jpeg' | 'png';
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

type FrameCallback = (frame: { data: string; width: number; height: number; timestamp: number }) => void;

export class ScreencastManager {
  private cdpSession: CDPSession | null = null;
  private running = false;
  private frameCallback: FrameCallback | null = null;
  private width: number;
  private height: number;

  constructor(
    private options: ScreencastOptions = {}
  ) {
    this.width = options.maxWidth ?? 1280;
    this.height = options.maxHeight ?? 720;
  }

  async start(page: Page, onFrame: FrameCallback): Promise<void> {
    if (this.running) {
      throw new Error('Screencast already running');
    }

    this.frameCallback = onFrame;
    this.cdpSession = await page.context().newCDPSession(page);
    this.running = true;

    this.cdpSession.on('Page.screencastFrame', (frame: ScreencastFrame) => {
      if (!this.running) return;

      // Relay frame to callback
      this.frameCallback?.({
        data: frame.data,
        width: frame.metadata.deviceWidth,
        height: frame.metadata.deviceHeight,
        timestamp: frame.metadata.timestamp ?? Date.now(),
      });

      // MUST acknowledge to receive next frame
      this.cdpSession?.send('Page.screencastFrameAck', {
        sessionId: frame.sessionId,
      }).catch(() => {
        // Ignore ack errors (session may be closing)
      });
    });

    await this.cdpSession.send('Page.startScreencast', {
      format: this.options.format ?? 'jpeg',
      quality: this.options.quality ?? 80,
      maxWidth: this.width,
      maxHeight: this.height,
      everyNthFrame: this.options.everyNthFrame ?? 1,
    });

    console.log(`[Screencast] Started (${this.width}x${this.height}, ${this.options.format ?? 'jpeg'} q${this.options.quality ?? 80})`);
  }

  async stop(): Promise<void> {
    if (!this.running || !this.cdpSession) return;

    this.running = false;
    this.frameCallback = null;

    try {
      await this.cdpSession.send('Page.stopScreencast');
      await this.cdpSession.detach();
    } catch {
      // Ignore errors during cleanup
    }

    this.cdpSession = null;
    console.log('[Screencast] Stopped');
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
        await this.cdpSession.send('Page.stopScreencast');
        await this.cdpSession.send('Page.startScreencast', {
          format: this.options.format ?? 'jpeg',
          quality: this.options.quality ?? 80,
          maxWidth: this.width,
          maxHeight: this.height,
          everyNthFrame: this.options.everyNthFrame ?? 1,
        });
      } catch (error) {
        console.error('[Screencast] Failed to update viewport:', error);
      }
    }
  }
}
