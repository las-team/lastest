import { chromium, Browser, Page, BrowserContext } from 'playwright';
import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs';

export interface RecordingEvent {
  type: 'action' | 'navigation' | 'screenshot' | 'error' | 'complete';
  timestamp: number;
  data: {
    action?: string;
    selector?: string;
    value?: string;
    url?: string;
    screenshotPath?: string;
    error?: string;
    code?: string;
  };
}

export interface RecordingSession {
  id: string;
  url: string;
  startedAt: Date;
  events: RecordingEvent[];
  generatedCode: string;
}

export class PlaywrightRecorder extends EventEmitter {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private session: RecordingSession | null = null;
  private lastCompletedSession: RecordingSession | null = null;
  private screenshotDir: string;
  private isRecording = false;

  constructor(screenshotDir: string = './public/screenshots') {
    super();
    this.screenshotDir = screenshotDir;
  }

  async startRecording(url: string, sessionId: string): Promise<void> {
    if (this.isRecording) {
      throw new Error('Already recording');
    }

    // Ensure screenshot directory exists
    if (!fs.existsSync(this.screenshotDir)) {
      fs.mkdirSync(this.screenshotDir, { recursive: true });
    }

    this.lastCompletedSession = null; // Clear any previous completed session
    this.session = {
      id: sessionId,
      url,
      startedAt: new Date(),
      events: [],
      generatedCode: '',
    };

    try {
      this.browser = await chromium.launch({
        headless: false,
        args: ['--start-maximized'],
      });

      this.context = await this.browser.newContext({
        viewport: { width: 1280, height: 720 },
        ignoreHTTPSErrors: true, // Ignore SSL errors for local dev
      });

      this.page = await this.context.newPage();

      // Setup event listeners BEFORE navigation (must await these)
      await this.setupEventListeners();

      // Navigate to initial URL
      await this.page.goto(url, { waitUntil: 'domcontentloaded' });
      this.addEvent('navigation', { url });

      this.isRecording = true;
      this.emit('started', { sessionId, url });
    } catch (error) {
      await this.cleanup();
      throw error;
    }
  }

  private async setupEventListeners(): Promise<void> {
    if (!this.page) return;

    // Track navigation
    this.page.on('framenavigated', (frame) => {
      if (frame === this.page?.mainFrame()) {
        this.addEvent('navigation', { url: frame.url() });
      }
    });

    // Track page close to stop recording
    this.page.on('close', () => {
      if (this.isRecording) {
        this.stopRecording().catch(() => {});
      }
    });

    // Expose function to track interactions from the page - MUST await
    await this.page.exposeFunction('__recordAction', (action: string, selector: string, value?: string) => {
      this.addEvent('action', { action, selector, value });
    });

    // Inject interaction tracking script - MUST await
    await this.page.addInitScript(() => {
      document.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const selector = generateSelector(target);
        // @ts-ignore
        window.__recordAction?.('click', selector);
      }, true);

      document.addEventListener('input', (e) => {
        const target = e.target as HTMLInputElement;
        const selector = generateSelector(target);
        // @ts-ignore
        window.__recordAction?.('fill', selector, target.value);
      }, true);

      document.addEventListener('change', (e) => {
        const target = e.target as HTMLSelectElement;
        if (target.tagName === 'SELECT') {
          const selector = generateSelector(target);
          // @ts-ignore
          window.__recordAction?.('selectOption', selector, target.value);
        }
      }, true);

      function generateSelector(element: HTMLElement): string {
        // Try data-testid first
        if (element.dataset.testid) {
          return `[data-testid="${element.dataset.testid}"]`;
        }

        // Try ID
        if (element.id) {
          return `#${element.id}`;
        }

        // Try role + name
        const role = element.getAttribute('role');
        const name = element.getAttribute('aria-label') || element.textContent?.trim().slice(0, 30);
        if (role && name) {
          return `role=${role}[name="${name}"]`;
        }

        // Try button/link text
        if (element.tagName === 'BUTTON' || element.tagName === 'A') {
          const text = element.textContent?.trim().slice(0, 30);
          if (text) {
            return `text="${text}"`;
          }
        }

        // Fallback to CSS path
        const path: string[] = [];
        let current: HTMLElement | null = element;
        while (current && current !== document.body) {
          let selector = current.tagName.toLowerCase();
          if (current.className) {
            selector += '.' + current.className.split(' ').filter(c => c && !c.includes(':')).join('.');
          }
          path.unshift(selector);
          current = current.parentElement;
        }
        return path.slice(-3).join(' > ');
      }
    });
  }

  private addEvent(type: RecordingEvent['type'], data: RecordingEvent['data']) {
    if (!this.session) return;

    const event: RecordingEvent = {
      type,
      timestamp: Date.now(),
      data,
    };

    this.session.events.push(event);
    this.emit('event', event);
  }

  async takeScreenshot(): Promise<string | null> {
    if (!this.page || !this.session) return null;

    const filename = `${this.session.id}-${Date.now()}.png`;
    const filepath = path.join(this.screenshotDir, filename);

    await this.page.screenshot({ path: filepath, fullPage: false });
    this.addEvent('screenshot', { screenshotPath: `/screenshots/${filename}` });

    return `/screenshots/${filename}`;
  }

  async stopRecording(): Promise<RecordingSession | null> {
    if (!this.isRecording || !this.session) {
      // Return last completed session if available (for when browser was closed)
      return this.lastCompletedSession;
    }

    this.isRecording = false;

    // Generate Playwright code from events
    this.session.generatedCode = this.generateCode();
    this.addEvent('complete', { code: this.session.generatedCode });

    const session = { ...this.session };
    this.lastCompletedSession = session; // Store for retrieval

    await this.cleanup();
    this.emit('stopped', session);

    return session;
  }

  getLastCompletedSession(): RecordingSession | null {
    return this.lastCompletedSession;
  }

  clearLastCompletedSession(): void {
    this.lastCompletedSession = null;
  }

  private generateCode(): string {
    if (!this.session) return '';

    const lines: string[] = [
      `import { test, expect } from '@playwright/test';`,
      '',
      `test('${this.session.id}', async ({ page }) => {`,
    ];

    let lastAction = '';
    for (const event of this.session.events) {
      if (event.type === 'navigation' && event.data.url) {
        // Only add goto for the first navigation or if URL changed significantly
        if (!lastAction.includes('goto')) {
          lines.push(`  await page.goto('${event.data.url}');`);
        }
        lastAction = 'goto';
      } else if (event.type === 'action') {
        const { action, selector, value } = event.data;
        switch (action) {
          case 'click':
            lines.push(`  await page.locator('${selector}').click();`);
            break;
          case 'fill':
            lines.push(`  await page.locator('${selector}').fill('${value || ''}');`);
            break;
          case 'selectOption':
            lines.push(`  await page.locator('${selector}').selectOption('${value || ''}');`);
            break;
        }
        lastAction = action || '';
      } else if (event.type === 'screenshot') {
        lines.push(`  await page.screenshot({ path: '${event.data.screenshotPath}' });`);
      }
    }

    lines.push('});', '');
    return lines.join('\n');
  }

  private async cleanup() {
    if (this.page) {
      await this.page.close().catch(() => {});
      this.page = null;
    }
    if (this.context) {
      await this.context.close().catch(() => {});
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
    this.session = null;
  }

  getSession(): RecordingSession | null {
    return this.session;
  }

  isActive(): boolean {
    return this.isRecording;
  }
}

// Singleton instance for the recorder
let recorderInstance: PlaywrightRecorder | null = null;

export function getRecorder(): PlaywrightRecorder {
  if (!recorderInstance) {
    recorderInstance = new PlaywrightRecorder();
  }
  return recorderInstance;
}
