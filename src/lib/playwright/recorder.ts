import { chromium, firefox, webkit, Browser, Page, BrowserContext } from 'playwright';
import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs';
import type { ActionSelector, SelectorType, SelectorConfig } from '@/lib/db/schema';
import { DEFAULT_SELECTOR_PRIORITY } from '@/lib/db/schema';
import { extractText, terminateWorker } from './ocr';

export type AssertionType = 'pageLoad' | 'networkIdle' | 'urlMatch' | 'domContentLoaded';

export interface ElementInfo {
  tagName: string;
  id?: string;
  textContent?: string;
  potentialAction?: 'click' | 'fill' | 'select';
  potentialSelector?: string;
}

export interface RecordingEvent {
  type: 'action' | 'navigation' | 'screenshot' | 'error' | 'complete' | 'assertion' | 'cursor-move' | 'mouse-down' | 'mouse-up' | 'hover-preview';
  timestamp: number;
  sequence: number;
  status: 'preview' | 'committed';
  data: {
    action?: string;
    selector?: string; // Legacy single selector
    selectors?: ActionSelector[]; // Multi-selector array
    value?: string;
    url?: string;
    relativePath?: string; // baseURL-relative path
    screenshotPath?: string;
    error?: string;
    code?: string;
    assertionType?: AssertionType;
    coordinates?: { x: number; y: number };
    button?: number; // mouse button for mouse-down/up
    elementInfo?: ElementInfo; // for hover-preview
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
  private selectorPriority: SelectorConfig[] = DEFAULT_SELECTOR_PRIORITY;
  private pendingOcrPromises: Promise<void>[] = [];
  private baseOrigin: string = '';
  private sequenceCounter: number = 0;
  private viewportWidth: number = 1280;
  private viewportHeight: number = 720;
  private browserType: 'chromium' | 'firefox' | 'webkit' = 'chromium';
  private headless: boolean = false;

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

  setSelectorPriority(priority: SelectorConfig[]) {
    this.selectorPriority = priority;
  }

  setViewport(width: number, height: number) {
    this.viewportWidth = width;
    this.viewportHeight = height;
  }

  setBrowserType(browser: 'chromium' | 'firefox' | 'webkit') {
    this.browserType = browser;
  }

  setHeadless(headless: boolean) {
    this.headless = headless;
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
    this.baseOrigin = new URL(url).origin;
    this.sequenceCounter = 0;
    this.session = {
      id: sessionId,
      url,
      startedAt: new Date(),
      events: [],
      generatedCode: '',
    };

    try {
      const browserLauncher = this.browserType === 'firefox' ? firefox
        : this.browserType === 'webkit' ? webkit
        : chromium;
      this.browser = await browserLauncher.launch({
        headless: this.headless,
        args: ['--start-maximized'],
      });

      this.context = await this.browser.newContext({
        viewport: { width: this.viewportWidth, height: this.viewportHeight },
        ignoreHTTPSErrors: true, // Ignore SSL errors for local dev
      });

      this.page = await this.context.newPage();

      // Setup event listeners BEFORE navigation (must await these)
      await this.setupEventListeners();

      // Navigate to initial URL
      await this.page.goto(url, { waitUntil: 'domcontentloaded' });
      const relativePath = this.getRelativePath(url);
      this.addEvent('navigation', { url, relativePath });

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
        const frameUrl = frame.url();
        const relativePath = this.getRelativePath(frameUrl);
        this.addEvent('navigation', { url: frameUrl, relativePath });
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
      // Include coordinates for fallback clicking when selectors fail
      const coordinates = boundingBox ? { x: Math.round(boundingBox.x + boundingBox.width / 2), y: Math.round(boundingBox.y + boundingBox.height / 2) } : undefined;
      this.addEvent('action', { action, selector: primarySelector, selectors, value, coordinates });
      const event = this.session?.events[this.session.events.length - 1];

      // Run OCR asynchronously if enabled and bounding box is large enough
      if (this.ocrEnabled && boundingBox && boundingBox.width > 10 && boundingBox.height > 10 && this.page && event) {
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

      // Mouse down/up tracking for pointer gestures
      await this.page.exposeFunction('__recordMouseEvent', (type: 'down' | 'up', x: number, y: number, button: number) => {
        this.addEvent(type === 'down' ? 'mouse-down' : 'mouse-up', { coordinates: { x, y }, button });
      });
    }

    // Hover preview tracking (always enabled)
    await this.page.exposeFunction('__recordHoverPreview', (elementInfo: ElementInfo) => {
      // Replace any existing preview event (only keep latest)
      if (this.session) {
        const lastEvent = this.session.events[this.session.events.length - 1];
        if (lastEvent?.type === 'hover-preview' && lastEvent.status === 'preview') {
          this.session.events.pop();
          this.sequenceCounter--; // Reuse the sequence number
        }
      }
      this.addEvent('hover-preview', { elementInfo }, 'preview');
    });

    const pointerGestures = this.settings.pointerGestures;
    const cursorFPS = this.settings.cursorFPS;
    const selectorPriority = this.selectorPriority;

    // Inject interaction tracking script - MUST await
    await this.page.addInitScript(({ pointerGestures: pg, cursorFPS: fps, selectorPriority: priority }) => {
      // Type definition for selectors captured in browser context
      interface BrowserActionSelector {
        type: string;
        value: string;
      }

      interface BrowserSelectorConfig {
        type: string;
        enabled: boolean;
        priority: number;
      }

      // Track mousedown for drag/draw detection
      let mouseDownState: { x: number; y: number; time: number } | null = null;
      const DRAG_THRESHOLD_PX = 10; // Movement threshold to consider it a drag
      const DRAG_THRESHOLD_MS = 300; // Time threshold for long press + movement

      document.addEventListener('mousedown', (e) => {
        mouseDownState = { x: e.clientX, y: e.clientY, time: Date.now() };
      }, true);

      document.addEventListener('mouseup', () => {
        // Clear after a short delay to allow click event to check it
        setTimeout(() => { mouseDownState = null; }, 50);
      }, true);

      document.addEventListener('click', (e) => {
        // Skip if this was a drag/draw operation (mouse moved significantly while held)
        if (mouseDownState) {
          const dx = Math.abs(e.clientX - mouseDownState.x);
          const dy = Math.abs(e.clientY - mouseDownState.y);
          const distance = Math.sqrt(dx * dx + dy * dy);
          const duration = Date.now() - mouseDownState.time;

          // Skip recording if: moved > threshold OR (long press AND any movement)
          if (distance > DRAG_THRESHOLD_PX || (duration > DRAG_THRESHOLD_MS && distance > 3)) {
            return; // This was a drag/draw, not a click
          }
        }

        const target = e.target as HTMLElement;
        const selectors = generateAllSelectors(target);
        const rect = target.getBoundingClientRect();
        const boundingBox = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        // @ts-ignore
        window.__recordAction?.('click', selectors, undefined, boundingBox);
      }, true);

      document.addEventListener('input', (e) => {
        const target = e.target as HTMLInputElement;
        // Skip non-fillable input types (radio, checkbox, etc.)
        const inputType = target.type?.toLowerCase();
        if (inputType === 'radio' || inputType === 'checkbox' || inputType === 'submit' || inputType === 'button' || inputType === 'reset' || inputType === 'file') {
          return;
        }
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

      // Generate ALL available selectors for an element, filtered and ordered by priority settings
      function generateAllSelectors(element: HTMLElement): BrowserActionSelector[] {
        // Build a map of all possible selectors
        const allSelectors: Map<string, string> = new Map();

        // data-testid
        if (element.dataset.testid) {
          allSelectors.set('data-testid', `[data-testid="${element.dataset.testid}"]`);
        }

        // ID (skip dynamic/invalid IDs containing 'undefined' or random-looking patterns)
        if (element.id && !element.id.includes('undefined')) {
          allSelectors.set('id', `#${element.id}`);
        }

        // Role + name (ARIA)
        const role = element.getAttribute('role') || getImplicitRole(element);
        const accessibleName = element.getAttribute('aria-label') ||
          element.getAttribute('title') ||
          element.textContent?.trim().slice(0, 30);
        if (role && accessibleName) {
          allSelectors.set('role-name', `role=${role}[name="${accessibleName}"]`);
        }

        // aria-label
        const ariaLabel = element.getAttribute('aria-label');
        if (ariaLabel) {
          allSelectors.set('aria-label', `[aria-label="${ariaLabel}"]`);
        }

        // Text content (for buttons/links)
        if (element.tagName === 'BUTTON' || element.tagName === 'A' ||
            element.getAttribute('role') === 'button') {
          const text = element.textContent?.trim().slice(0, 30);
          if (text) {
            allSelectors.set('text', `text="${text}"`);
          }
        }

        // Placeholder (for inputs/textareas)
        const placeholder = element.getAttribute('placeholder');
        if (placeholder) {
          allSelectors.set('placeholder', `[placeholder="${placeholder}"]`);
        }

        // Name attribute (for form elements)
        const name = element.getAttribute('name');
        if (name) {
          allSelectors.set('name', `[name="${name}"]`);
        }

        // CSS path fallback
        const cssPath = generateCssPath(element);
        if (cssPath) {
          allSelectors.set('css-path', cssPath);
        }

        // Filter by enabled selectors and sort by priority
        const enabledConfigs = (priority as BrowserSelectorConfig[])
          .filter(config => config.enabled && config.type !== 'ocr-text') // OCR is handled separately
          .sort((a, b) => a.priority - b.priority);

        const selectors: BrowserActionSelector[] = [];
        for (const config of enabledConfigs) {
          const value = allSelectors.get(config.type);
          if (value) {
            selectors.push({ type: config.type, value });
          }
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
          // Use getAttribute to handle SVG elements (className is SVGAnimatedString, not string)
          const classAttr = current.getAttribute('class');
          if (classAttr) {
            const classes = classAttr.split(' ')
              .filter(c => c && !c.includes(':') && !c.startsWith('_'))
              .slice(0, 2)
              // Escape special CSS characters in class names (Tailwind arbitrary values like rounded-[inherit])
              .map(c => c.replace(/([[\]()#.>+~=|^$*!@])/g, '\\$1'));
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

        // Mouse down/up events
        document.addEventListener('mousedown', (e: MouseEvent) => {
          // @ts-ignore
          window.__recordMouseEvent?.('down', e.clientX, e.clientY, e.button);
        }, true);

        document.addEventListener('mouseup', (e: MouseEvent) => {
          // @ts-ignore
          window.__recordMouseEvent?.('up', e.clientX, e.clientY, e.button);
        }, true);
      }

      // Hover preview tracking (throttled, always enabled)
      let lastHoverTime = 0;
      document.addEventListener('mouseover', (e: MouseEvent) => {
        const now = Date.now();
        if (now - lastHoverTime < 200) return;
        lastHoverTime = now;
        const target = e.target as HTMLElement;
        if (!target || target === document.body || target === document.documentElement) return;

        // Determine potential action based on element type
        let potentialAction: 'click' | 'fill' | 'select' | undefined;
        const tagName = target.tagName.toUpperCase();
        if (tagName === 'INPUT' || tagName === 'TEXTAREA') {
          potentialAction = 'fill';
        } else if (tagName === 'SELECT') {
          potentialAction = 'select';
        } else if (tagName === 'BUTTON' || tagName === 'A' || target.getAttribute('role') === 'button' || target.onclick) {
          potentialAction = 'click';
        } else {
          potentialAction = 'click'; // Default to click for most elements
        }

        // Generate primary selector for preview
        const selectors = generateAllSelectors(target);
        const primarySelector = selectors[0]?.value || '';

        // @ts-ignore
        window.__recordHoverPreview?.({
          tagName: target.tagName.toLowerCase(),
          id: target.id || undefined,
          textContent: target.textContent?.trim().slice(0, 30) || undefined,
          potentialAction,
          potentialSelector: primarySelector,
        });
      }, true);
    }, { pointerGestures, cursorFPS, selectorPriority });
  }

  private getRelativePath(url: string): string {
    if (url.startsWith(this.baseOrigin)) {
      return url.slice(this.baseOrigin.length) || '/';
    }
    return url;
  }

  private addEvent(type: RecordingEvent['type'], data: RecordingEvent['data'], status: 'preview' | 'committed' = 'committed') {
    if (!this.session) return;

    const event: RecordingEvent = {
      type,
      timestamp: Date.now(),
      sequence: ++this.sequenceCounter,
      status,
      data,
    };

    this.session.events.push(event);
    this.emit('event', event);
  }

  async takeScreenshot(): Promise<string | null> {
    if (!this.page || !this.session) return null;

    const filename = `${this.session.id}-${Date.now()}.png`;
    const filepath = path.join(this.screenshotDir, filename);

    await this.page.screenshot({ path: filepath, fullPage: true });

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
    const coordsEnabled = this.selectorPriority.find(s => s.type === 'coords')?.enabled ?? true;

    const lines: string[] = [
      `import { Page } from 'playwright';`,
      '',
      `export async function test(page: Page, baseUrl: string, screenshotPath: string, stepLogger: any) {`,
      `  // Multi-selector fallback helper with coordinate fallback for clicks`,
      `  async function locateWithFallback(page, selectors, action, value, coords) {`,
      `    const validSelectors = selectors.filter(sel => sel.value && sel.value.trim() && !sel.value.includes('undefined'));`,
      `    for (const sel of validSelectors) {`,
      `      try {`,
      `        let locator;`,
      `        if (sel.type === 'ocr-text') {`,
      `          const text = sel.value.replace(/^ocr-text="/, '').replace(/"$/, '');`,
      `          locator = page.getByText(text, { exact: false });`,
      `        } else if (sel.type === 'role-name') {`,
      `          // Parse role=button[name="Label"] format and use getByRole`,
      `          const match = sel.value.match(/^role=(\\w+)\\[name="(.+)"\\]$/);`,
      `          if (match) {`,
      `            locator = page.getByRole(match[1], { name: match[2] });`,
      `          } else {`,
      `            locator = page.locator(sel.value);`,
      `          }`,
      `        } else {`,
      `          locator = page.locator(sel.value);`,
      `        }`,
      `        await locator.waitFor({ timeout: 3000 });`,
      `        if (action === 'click') await locator.click();`,
      `        else if (action === 'fill') await locator.fill(value || '');`,
      `        else if (action === 'selectOption') await locator.selectOption(value || '');`,
      `        return;`,
      `      } catch { continue; }`,
      `    }`,
      ...(coordsEnabled ? [
      `    // Coordinate fallback for clicks when all selectors fail`,
      `    if (action === 'click' && coords) {`,
      `      console.log('Falling back to coordinate click at', coords.x, coords.y);`,
      `      await page.mouse.click(coords.x, coords.y);`,
      `      return;`,
      `    }`,
      ] : []),
      `    throw new Error('No selector matched: ' + JSON.stringify(validSelectors));`,
      `  }`,
      ``,
    ];

    if (hasCursorEvents) {
      lines.push(
        `  // Replay cursor path helper`,
        `  async function replayCursorPath(page, moves) {`,
        `    for (const [x, y, delay] of moves) {`,
        `      await page.mouse.move(x, y);`,
        `      if (delay > 0) await page.waitForTimeout(delay);`,
        `    }`,
        `  }`,
        ``,
      );
    }

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

      if (event.type === 'navigation' && event.data.relativePath) {
        // Only add goto for the first navigation or if URL changed significantly
        if (!lastAction.includes('goto')) {
          const relativePath = event.data.relativePath;
          lines.push(`  await page.goto(\`\${baseUrl}${relativePath}\`);`);
        }
        lastAction = 'goto';
      } else if (event.type === 'action') {
        const { action, selector, selectors, value, coordinates } = event.data;

        // Use multi-selector format if available
        if (selectors && selectors.length > 0) {
          const selectorsJson = JSON.stringify(selectors);
          const coordsArg = coordinates ? JSON.stringify(coordinates) : 'null';
          switch (action) {
            case 'click':
              lines.push(`  await locateWithFallback(page, ${selectorsJson}, 'click', null, ${coordsArg});`);
              break;
            case 'fill':
              lines.push(`  await locateWithFallback(page, ${selectorsJson}, 'fill', '${value || ''}', null);`);
              break;
            case 'selectOption':
              lines.push(`  await locateWithFallback(page, ${selectorsJson}, 'selectOption', '${value || ''}', null);`);
              break;
          }
        } else if (selector && selector.trim()) {
          // Fallback to legacy single selector (only if non-empty)
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
        } else {
          // No selectors available - use coordinate fallback for clicks
          if (action === 'click' && coordinates) {
            lines.push(`  // Coordinate-only click (no selectors found)`);
            lines.push(`  await page.mouse.click(${coordinates.x}, ${coordinates.y});`);
          } else {
            lines.push(`  // Skipped ${action}: no valid selector or coordinates found`);
          }
        }
        lastAction = action || '';
      } else if (event.type === 'screenshot') {
        lines.push(`  await page.screenshot({ path: screenshotPath });`);
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
            const relativePath = this.getRelativePath(url || '');
            lines.push(`  await expect(page).toHaveURL(\`\${baseUrl}${relativePath}\`);`);
            break;
          case 'domContentLoaded':
            lines.push(`  // Assertion: Verify DOM is ready`);
            lines.push(`  await page.waitForLoadState('domcontentloaded');`);
            break;
        }
      }
    }

    flushCursorBatch();
    lines.push('}', '');
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
