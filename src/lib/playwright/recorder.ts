import { chromium, Browser, Page, BrowserContext } from 'playwright';
import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs';
import type { ActionSelector, SelectorType } from '@/lib/db/schema';

export type AssertionType = 'pageLoad' | 'networkIdle' | 'urlMatch' | 'domContentLoaded';

export interface RecordingEvent {
  type: 'action' | 'navigation' | 'screenshot' | 'error' | 'complete' | 'assertion';
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
    await this.page.exposeFunction('__recordAction', (action: string, selectors: ActionSelector[], value?: string) => {
      // Store both multi-selector array and legacy single selector for backwards compatibility
      const primarySelector = selectors[0]?.value || '';
      this.addEvent('action', { action, selector: primarySelector, selectors, value });
    });

    // Inject interaction tracking script - MUST await
    await this.page.addInitScript(() => {
      // Type definition for selectors captured in browser context
      interface BrowserActionSelector {
        type: string;
        value: string;
      }

      document.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const selectors = generateAllSelectors(target);
        // @ts-ignore
        window.__recordAction?.('click', selectors);
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
      `// Multi-selector fallback helper`,
      `async function locateWithFallback(page, selectors, action, value) {`,
      `  for (const sel of selectors) {`,
      `    try {`,
      `      const locator = page.locator(sel.value);`,
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
