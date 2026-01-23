import { chromium, Browser, Page, BrowserContext } from 'playwright';
import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs';
import type { ActionSelector, SelectorType } from '@/lib/db/schema';
import { extractText, terminateWorker } from './ocr';

export type AssertionType = 'pageLoad' | 'networkIdle' | 'urlMatch' | 'domContentLoaded';

export interface RecordingEvent {
  type: 'action' | 'navigation' | 'screenshot' | 'error' | 'complete' | 'assertion' | 'cursor-move';
  timestamp: number;
  data: {
    action?: string;
    selector?: string; // Legacy single selector
    selectors?: ActionSelector[]; // Multi-selector array
    value?: string;
    url?: string;
    screenshotPath?: string;
    error?: string;
    code?: string;
    assertionType?: AssertionType;
    coordinates?: { x: number; y: number };
  };
}

export interface RecordingSession {
  id: string;
  url: string;
  startedAt: Date;
  events: RecordingEvent[];
  generatedCode: string;
}

export interface CursorSettings {
  pointerGestures: boolean;
  cursorFPS: number;
}

export class PlaywrightRecorder extends EventEmitter {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private session: RecordingSession | null = null;
  private lastCompletedSession: RecordingSession | null = null;
  private screenshotDir: string;
  private isRecording = false;
  private repositoryId: string | null;
  private settings: CursorSettings = { pointerGestures: false, cursorFPS: 30 };
  private ocrEnabled = false;
  private pendingOcrPromises: Promise<void>[] = [];

  constructor(repositoryId?: string | null, screenshotDir?: string) {
    super();
    this.repositoryId = repositoryId ?? null;
    // Build screenshot directory path: include repositoryId if provided
    const baseDir = screenshotDir ?? './public/screenshots';
    this.screenshotDir = this.repositoryId
      ? path.join(baseDir, this.repositoryId)
      : baseDir;
  }

  setSettings(settings: CursorSettings) {
    this.settings = settings;
  }

  setOcrEnabled(enabled: boolean) {
    this.ocrEnabled = enabled;
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
    await this.page.exposeFunction('__recordAction', (action: string, selectors: ActionSelector[], value?: string, boundingBox?: { x: number; y: number; width: number; height: number }) => {
      // Store both multi-selector array and legacy single selector for backwards compatibility
      const primarySelector = selectors[0]?.value || '';
      const event: RecordingEvent = {
        type: 'action',
        timestamp: Date.now(),
        data: { action, selector: primarySelector, selectors, value },
      };
      if (this.session) {
        this.session.events.push(event);
        this.emit('event', event);
      }

      // Run OCR asynchronously if enabled and bounding box is large enough
      if (this.ocrEnabled && boundingBox && boundingBox.width > 10 && boundingBox.height > 10 && this.page) {
        const ocrPromise = (async () => {
          try {
            const buffer = await this.page!.screenshot({
              clip: { x: boundingBox.x, y: boundingBox.y, width: boundingBox.width, height: boundingBox.height },
            });
            const text = await extractText(Buffer.from(buffer));
            if (text && event.data.selectors) {
              event.data.selectors.push({ type: 'ocr-text' as SelectorType, value: `ocr-text="${text}"` });
            }
          } catch { /* OCR failure is non-fatal */ }
        })();
        this.pendingOcrPromises.push(ocrPromise);
      }
    });

    // Expose cursor move tracking if pointer gestures enabled
    if (this.settings.pointerGestures) {
      await this.page.exposeFunction('__recordCursorMove', (x: number, y: number) => {
        this.addEvent('cursor-move', { coordinates: { x, y } });
      });
    }

    const pointerGestures = this.settings.pointerGestures;
    const cursorFPS = this.settings.cursorFPS;

    // Inject interaction tracking script - MUST await
    await this.page.addInitScript(({ pointerGestures: pg, cursorFPS: fps }) => {
      // Type definition for selectors captured in browser context
      interface BrowserActionSelector {
        type: string;
        value: string;
      }

      document.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const selectors = generateAllSelectors(target);
        const rect = target.getBoundingClientRect();
        const boundingBox = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        // @ts-ignore
        window.__recordAction?.('click', selectors, undefined, boundingBox);
      }, true);

      document.addEventListener('input', (e) => {
        const target = e.target as HTMLInputElement;
        const selectors = generateAllSelectors(target);
        // @ts-ignore
        window.__recordAction?.('fill', selectors, target.value);
      }, true);

      document.addEventListener('change', (e) => {
        const target = e.target as HTMLSelectElement;
        if (target.tagName === 'SELECT') {
          const selectors = generateAllSelectors(target);
          // @ts-ignore
          window.__recordAction?.('selectOption', selectors, target.value);
        }
      }, true);

      // Generate ALL available selectors for an element
      function generateAllSelectors(element: HTMLElement): BrowserActionSelector[] {
        const selectors: BrowserActionSelector[] = [];

        // 1. data-testid (highest priority)
        if (element.dataset.testid) {
          selectors.push({
            type: 'data-testid',
            value: `[data-testid="${element.dataset.testid}"]`,
          });
        }

        // 2. ID
        if (element.id) {
          selectors.push({
            type: 'id',
            value: `#${element.id}`,
          });
        }

        // 3. Role + name (ARIA)
        const role = element.getAttribute('role') || getImplicitRole(element);
        const accessibleName = element.getAttribute('aria-label') ||
          element.getAttribute('title') ||
          element.textContent?.trim().slice(0, 30);
        if (role && accessibleName) {
          selectors.push({
            type: 'role-name',
            value: `role=${role}[name="${accessibleName}"]`,
          });
        }

        // 4. aria-label
        const ariaLabel = element.getAttribute('aria-label');
        if (ariaLabel) {
          selectors.push({
            type: 'aria-label',
            value: `[aria-label="${ariaLabel}"]`,
          });
        }

        // 5. Text content (for buttons/links)
        if (element.tagName === 'BUTTON' || element.tagName === 'A' ||
            element.getAttribute('role') === 'button') {
          const text = element.textContent?.trim().slice(0, 30);
          if (text) {
            selectors.push({
              type: 'text',
              value: `text="${text}"`,
            });
          }
        }

        // 6. CSS path fallback
        const cssPath = generateCssPath(element);
        if (cssPath) {
          selectors.push({
            type: 'css-path',
            value: cssPath,
          });
        }

        return selectors;
      }

      // Get implicit ARIA role for common elements
      function getImplicitRole(element: HTMLElement): string | null {
        const tagRoles: Record<string, string> = {
          'BUTTON': 'button',
          'A': 'link',
          'INPUT': element.getAttribute('type') === 'checkbox' ? 'checkbox' :
                   element.getAttribute('type') === 'radio' ? 'radio' :
                   element.getAttribute('type') === 'submit' ? 'button' : 'textbox',
          'SELECT': 'combobox',
          'TEXTAREA': 'textbox',
          'IMG': 'img',
          'NAV': 'navigation',
          'MAIN': 'main',
          'HEADER': 'banner',
          'FOOTER': 'contentinfo',
        };
        return tagRoles[element.tagName] || null;
      }

      // Generate CSS path selector
      function generateCssPath(element: HTMLElement): string {
        const path: string[] = [];
        let current: HTMLElement | null = element;
        while (current && current !== document.body) {
          let selector = current.tagName.toLowerCase();
          if (current.className) {
            const classes = current.className.split(' ')
              .filter(c => c && !c.includes(':') && !c.startsWith('_'))
              .slice(0, 2);
            if (classes.length > 0) {
              selector += '.' + classes.join('.');
            }
          }
          path.unshift(selector);
          current = current.parentElement;
        }
        return path.slice(-3).join(' > ');
      }

      // Throttled cursor move tracking
      if (pg) {
        const interval = Math.round(1000 / fps);
        let lastTime = 0;
        document.addEventListener('mousemove', (e: MouseEvent) => {
          const now = Date.now();
          if (now - lastTime >= interval) {
            lastTime = now;
            // @ts-ignore
            window.__recordCursorMove?.(e.clientX, e.clientY);
          }
        }, true);
      }
    }, { pointerGestures, cursorFPS });
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

    // Build public path with repositoryId if present
    const publicPath = this.repositoryId
      ? `/screenshots/${this.repositoryId}/${filename}`
      : `/screenshots/${filename}`;

    this.addEvent('screenshot', { screenshotPath: publicPath });

    return publicPath;
  }

  async createAssertion(assertionType: AssertionType): Promise<boolean> {
    if (!this.page || !this.session) return false;

    // Capture current URL for urlMatch assertions
    const url = this.page.url();
    this.addEvent('assertion', { assertionType, url });

    return true;
  }

  async stopRecording(): Promise<RecordingSession | null> {
    if (!this.isRecording || !this.session) {
      // Return last completed session if available (for when browser was closed)
      return this.lastCompletedSession;
    }

    this.isRecording = false;

    // Await all pending OCR extractions before generating code
    if (this.pendingOcrPromises.length > 0) {
      await Promise.allSettled(this.pendingOcrPromises);
      this.pendingOcrPromises = [];
    }
    await terminateWorker();

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

    const hasCursorEvents = this.session.events.some(e => e.type === 'cursor-move');

    const lines: string[] = [
      `import { test, expect } from '@playwright/test';`,
      '',
      `// Multi-selector fallback helper`,
      `async function locateWithFallback(page, selectors, action, value) {`,
      `  for (const sel of selectors) {`,
      `    try {`,
      `      let locator;`,
      `      if (sel.type === 'ocr-text') {`,
      `        const text = sel.value.replace(/^ocr-text="/, '').replace(/"$/, '');`,
      `        locator = page.getByText(text, { exact: false });`,
      `      } else {`,
      `        locator = page.locator(sel.value);`,
      `      }`,
      `      await locator.waitFor({ timeout: 2000 });`,
      `      if (action === 'click') await locator.click();`,
      `      else if (action === 'fill') await locator.fill(value || '');`,
      `      else if (action === 'selectOption') await locator.selectOption(value || '');`,
      `      return;`,
      `    } catch { continue; }`,
      `  }`,
      `  throw new Error('No selector matched: ' + JSON.stringify(selectors));`,
      `}`,
      '',
    ];

    if (hasCursorEvents) {
      lines.push(
        `// Replay cursor path helper`,
        `async function replayCursorPath(page, moves) {`,
        `  for (const [x, y, delay] of moves) {`,
        `    await page.mouse.move(x, y);`,
        `    if (delay > 0) await page.waitForTimeout(delay);`,
        `  }`,
        `}`,
        '',
      );
    }

    lines.push(`test('${this.session.id}', async ({ page }) => {`);

    let lastAction = '';
    let cursorBatch: [number, number, number][] = [];
    let lastCursorTimestamp = 0;

    const flushCursorBatch = () => {
      if (cursorBatch.length > 0) {
        const tuples = cursorBatch.map(t => `[${t[0]},${t[1]},${t[2]}]`).join(',');
        lines.push(`  await replayCursorPath(page, [${tuples}]);`);
        cursorBatch = [];
      }
    };

    for (const event of this.session.events) {
      if (event.type === 'cursor-move' && event.data.coordinates) {
        const { x, y } = event.data.coordinates;
        const delay = lastCursorTimestamp > 0 ? event.timestamp - lastCursorTimestamp : 0;
        cursorBatch.push([x, y, delay]);
        lastCursorTimestamp = event.timestamp;
        continue;
      }

      // Flush any pending cursor moves before other events
      flushCursorBatch();

      if (event.type === 'navigation' && event.data.url) {
        // Only add goto for the first navigation or if URL changed significantly
        if (!lastAction.includes('goto')) {
          lines.push(`  await page.goto('${event.data.url}');`);
        }
        lastAction = 'goto';
      } else if (event.type === 'action') {
        const { action, selector, selectors, value } = event.data;

        // Use multi-selector format if available
        if (selectors && selectors.length > 0) {
          const selectorsJson = JSON.stringify(selectors);
          switch (action) {
            case 'click':
              lines.push(`  await locateWithFallback(page, ${selectorsJson}, 'click');`);
              break;
            case 'fill':
              lines.push(`  await locateWithFallback(page, ${selectorsJson}, 'fill', '${value || ''}');`);
              break;
            case 'selectOption':
              lines.push(`  await locateWithFallback(page, ${selectorsJson}, 'selectOption', '${value || ''}');`);
              break;
          }
        } else {
          // Fallback to legacy single selector
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
        }
        lastAction = action || '';
      } else if (event.type === 'screenshot') {
        lines.push(`  await page.screenshot({ path: '${event.data.screenshotPath}' });`);
      } else if (event.type === 'assertion') {
        const { assertionType, url } = event.data;
        // Generate assertion code based on type
        switch (assertionType) {
          case 'pageLoad':
            lines.push(`  // Assertion: Verify page has finished loading`);
            lines.push(`  await page.waitForLoadState('load');`);
            break;
          case 'networkIdle':
            lines.push(`  // Assertion: Verify no pending network requests`);
            lines.push(`  await page.waitForLoadState('networkidle');`);
            break;
          case 'urlMatch':
            lines.push(`  // Assertion: Verify current URL matches expected`);
            lines.push(`  await expect(page).toHaveURL('${url}');`);
            break;
          case 'domContentLoaded':
            lines.push(`  // Assertion: Verify DOM is ready`);
            lines.push(`  await page.waitForLoadState('domcontentloaded');`);
            break;
        }
      }
    }

    flushCursorBatch();
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

// Singleton instance for the recorder (keyed by repositoryId)
let recorderInstance: PlaywrightRecorder | null = null;
let currentRepositoryId: string | null = null;

export function getRecorder(repositoryId?: string | null): PlaywrightRecorder {
  const repoId = repositoryId ?? null;

  // If repositoryId changed, create a new recorder instance
  if (!recorderInstance || currentRepositoryId !== repoId) {
    // Only create new instance if not currently recording
    if (recorderInstance?.isActive()) {
      return recorderInstance;
    }
    currentRepositoryId = repoId;
    recorderInstance = new PlaywrightRecorder(repoId);
  }

  return recorderInstance;
}
