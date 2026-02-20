import { chromium, firefox, webkit, Browser, Page, BrowserContext } from 'playwright';
import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs';
import type { ActionSelector, SelectorType, SelectorConfig } from '@/lib/db/schema';
import { DEFAULT_SELECTOR_PRIORITY } from '@/lib/db/schema';
import { extractText, terminateWorker, warmupWorker } from './ocr';
import { getSetupOrchestrator } from '@/lib/setup/setup-orchestrator';
import { STORAGE_DIRS } from '@/lib/storage/paths';

export interface SetupStep {
  stepType: 'test' | 'script';
  testId?: string | null;
  scriptId?: string | null;
}

export interface SetupOptions {
  testId?: string | null;
  scriptId?: string | null;
  steps?: SetupStep[];
}

export type AssertionType = 'pageLoad' | 'networkIdle' | 'urlMatch' | 'domContentLoaded';

// Element-specific assertion types for Shift+right-click menu
export type ElementAssertionType =
  | 'toBeVisible'
  | 'toBeHidden'
  | 'toBeAttached'
  | 'toHaveAttribute'
  | 'toHaveText'
  | 'toContainText'
  | 'toHaveValue'
  | 'toBeEnabled'
  | 'toBeDisabled'
  | 'toBeChecked';

export interface ElementAssertion {
  type: ElementAssertionType;
  selectors: ActionSelector[];
  expectedValue?: string; // For toHaveText, toContainText, toHaveValue
  attributeName?: string; // For toHaveAttribute
  attributeValue?: string; // For toHaveAttribute
}

export interface ElementInfo {
  tagName: string;
  id?: string;
  textContent?: string;
  potentialAction?: 'click' | 'fill' | 'select';
  potentialSelector?: string;
  selectors?: ActionSelector[]; // Full selector array for hover-preview
}

export interface VerificationStatus {
  syntaxValid: boolean;    // Tier 1: Has valid selectors or coords
  domVerified?: boolean;   // Tier 2: DOM verification result (async)
  lastChecked?: number;    // Timestamp of last DOM check
}

// Keyboard modifiers for modifier key tracking (ALT/CTRL+drag support)
export type KeyboardModifier = 'Alt' | 'Control' | 'Shift' | 'Meta';

export interface RecordingEvent {
  type: 'action' | 'navigation' | 'screenshot' | 'error' | 'complete' | 'assertion' | 'cursor-move' | 'mouse-down' | 'mouse-up' | 'hover-preview' | 'keypress' | 'keydown' | 'keyup' | 'scroll';
  timestamp: number;
  sequence: number;
  status: 'preview' | 'committed';
  verification?: VerificationStatus; // Verification status for actions
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
    modifiers?: KeyboardModifier[]; // active keyboard modifiers during action
    key?: string; // key name for keypress events
    keyCode?: string; // physical key code (e.g. 'Digit1', 'KeyA') for layout-independent replay
    elementInfo?: ElementInfo; // for hover-preview
    actionId?: string; // unique ID for verification tracking
    elementAssertion?: ElementAssertion; // for element assertions via Shift+right-click
    deltaX?: number; // scroll delta X
    deltaY?: number; // scroll delta Y
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
  private clipboardAccess: boolean = false;
  private verificationUpdates: Map<string, { verified: boolean; timestamp: number }> = new Map();

  constructor(repositoryId?: string | null, screenshotDir?: string) {
    super();
    this.repositoryId = repositoryId ?? null;
    // Build screenshot directory path: include repositoryId if provided
    const baseDir = screenshotDir ?? STORAGE_DIRS.screenshots;
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

  setClipboardAccess(enabled: boolean) {
    this.clipboardAccess = enabled;
  }

  async startRecording(url: string, sessionId: string, setupOptions?: SetupOptions): Promise<void> {
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
        ...(this.clipboardAccess ? { permissions: ['clipboard-read', 'clipboard-write'] } : {}),
      });

      this.page = await this.context.newPage();

      // Navigate to initial URL first
      await this.page.goto(url, { waitUntil: 'domcontentloaded' });

      // Eagerly start OCR worker initialization (runs in parallel with setup/listener setup)
      if (this.ocrEnabled) {
        warmupWorker();
      }

      // Run setup if configured (before setting up event listeners to avoid capturing setup actions)
      if (setupOptions) {
        const orchestrator = getSetupOrchestrator();
        const context = { baseUrl: this.baseOrigin, variables: {} };

        if (setupOptions.steps && setupOptions.steps.length > 0) {
          // Multi-step setup: run each step sequentially
          let currentContext = context;
          for (const step of setupOptions.steps) {
            const stepTestId = step.stepType === 'test' ? step.testId : null;
            const stepScriptId = step.stepType === 'script' ? step.scriptId : null;
            const result = await orchestrator.resolveAndRunSetup(stepTestId, stepScriptId, this.page, currentContext);
            if (!result.success) {
              throw new Error(`Setup failed: ${result.error}`);
            }
            if (result.variables) {
              currentContext = { ...currentContext, variables: { ...currentContext.variables, ...result.variables } };
            }
          }
        } else if (setupOptions.testId || setupOptions.scriptId) {
          // Legacy single-step setup
          const setupResult = await orchestrator.resolveAndRunSetup(
            setupOptions.testId,
            setupOptions.scriptId,
            this.page,
            context
          );
          if (!setupResult.success) {
            throw new Error(`Setup failed: ${setupResult.error}`);
          }
        }
      }

      // Setup event listeners AFTER setup completes (to avoid capturing setup actions)
      await this.setupEventListeners();

      // Record initial navigation event (after setup, page may be on a different URL)
      const currentUrl = this.page.url();
      const relativePath = this.getRelativePath(currentUrl);
      this.addEvent('navigation', { url: currentUrl, relativePath });

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

    // Track file chooser dialogs for file upload recording
    this.page.on('filechooser', (fileChooser) => {
      const element = fileChooser.element();
      const selector = element ? 'input[type="file"]' : 'input[type="file"]';
      this.addEvent('action', {
        action: 'setInputFiles',
        selector,
        selectors: [{ type: 'css-path' as SelectorType, value: selector }],
        value: '/* replace with file path(s) */',
      });
    });

    // Expose function to track interactions from the page - MUST await
    // actionId is a unique ID generated by the browser for verification tracking
    // modifiers is an array of active keyboard modifiers (Alt, Control, Shift, Meta)
    await this.page.exposeFunction('__recordAction', (action: string, selectors: ActionSelector[], value?: string, boundingBox?: { x: number; y: number; width: number; height: number; clickX?: number; clickY?: number }, actionId?: string, modifiers?: KeyboardModifier[]) => {
      // Store both multi-selector array and legacy single selector for backwards compatibility
      const primarySelector = selectors[0]?.value || '';
      // Use actual click position if available (critical for canvas elements),
      // otherwise fall back to element center (fine for buttons/inputs)
      const coordinates = boundingBox
        ? (boundingBox.clickX != null && boundingBox.clickY != null
            ? { x: Math.round(boundingBox.clickX), y: Math.round(boundingBox.clickY) }
            : { x: Math.round(boundingBox.x + boundingBox.width / 2), y: Math.round(boundingBox.y + boundingBox.height / 2) })
        : undefined;

      // Tier 1 syntax validation: check if action has valid selectors or coordinate fallback
      const validSelectors = selectors.filter(sel => sel.value && sel.value.trim() && !sel.value.includes('undefined'));
      const hasValidSelectors = validSelectors.length > 0;
      const hasCoordsFallback = (action === 'click' || action === 'rightclick' || action === 'fill') && coordinates !== undefined;
      const syntaxValid = hasValidSelectors || hasCoordsFallback;

      // Store button for right-clicks
      const button = action === 'rightclick' ? 2 : undefined;

      // Coalesce consecutive fill actions on the same element (input fires per-keystroke)
      if (action === 'fill' && this.session?.events.length) {
        const lastEvent = this.session.events[this.session.events.length - 1];
        if (lastEvent.type === 'action' && lastEvent.data.action === 'fill' && lastEvent.data.selector === primarySelector) {
          lastEvent.data.value = value;
          lastEvent.data.coordinates = coordinates;
          lastEvent.data.actionId = actionId;
          this.emit('event', lastEvent);
          return;
        }
      }

      this.addEvent('action', { action, selector: primarySelector, selectors, value, coordinates, actionId, button, modifiers: modifiers && modifiers.length > 0 ? modifiers : undefined }, 'committed', {
        syntaxValid,
        domVerified: undefined, // Will be set by async verification
        lastChecked: undefined,
      });
      const event = this.session?.events[this.session.events.length - 1];

      // Run OCR asynchronously if enabled and bounding box is large enough
      if (this.ocrEnabled && boundingBox && boundingBox.width > 10 && boundingBox.height > 10 && this.page && event) {
        console.log(`[Recorder OCR] Enabled, capturing region ${boundingBox.width}x${boundingBox.height} at (${Math.round(boundingBox.x)},${Math.round(boundingBox.y)})`);
        const ocrPromise = (async () => {
          try {
            const buffer = await this.page!.screenshot({
              clip: { x: boundingBox.x, y: boundingBox.y, width: boundingBox.width, height: boundingBox.height },
            });
            const text = await extractText(Buffer.from(buffer));
            if (text && event.data.selectors) {
              console.log(`[Recorder OCR] Success: "${text.slice(0, 50)}"`);
              event.data.selectors.push({ type: 'ocr-text' as SelectorType, value: `ocr-text="${text}"` });
            } else {
              console.log('[Recorder OCR] No text extracted');
            }
          } catch (err) {
            console.warn('[Recorder OCR] Failed:', err instanceof Error ? err.message : String(err));
          }
        })();
        this.pendingOcrPromises.push(ocrPromise);
      }
    });

    // Expose cursor move tracking if pointer gestures enabled
    if (this.settings.pointerGestures) {
      await this.page.exposeFunction('__recordCursorMove', (x: number, y: number) => {
        this.addEvent('cursor-move', { coordinates: { x, y } });
      });

      // Mouse down/up tracking for pointer gestures with modifier support
      await this.page.exposeFunction('__recordMouseEvent', (type: 'down' | 'up', x: number, y: number, button: number, modifiers?: KeyboardModifier[]) => {
        this.addEvent(type === 'down' ? 'mouse-down' : 'mouse-up', { coordinates: { x, y }, button, modifiers: modifiers && modifiers.length > 0 ? modifiers : undefined });
      });
    }

    // Screenshot capture via Ctrl+Shift+S hotkey
    await this.page.exposeFunction('__recordScreenshot', () => {
      this.takeScreenshot();
    });

    // Keypress tracking for keyboard interactions
    await this.page.exposeFunction('__recordKeypress', (key: string, modifiers?: KeyboardModifier[], keyCode?: string) => {
      this.addEvent('keypress', { key, modifiers: modifiers && modifiers.length > 0 ? modifiers : undefined, keyCode: keyCode || undefined });
    });

    // Keydown/keyup tracking for held keys (Space for tool activation in canvas apps)
    await this.page.exposeFunction('__recordKeydown', (key: string, keyCode?: string) => {
      this.addEvent('keydown', { key, keyCode: keyCode || undefined });
    });
    await this.page.exposeFunction('__recordKeyup', (key: string, keyCode?: string) => {
      this.addEvent('keyup', { key, keyCode: keyCode || undefined });
    });

    // Scroll tracking with coalescing
    await this.page.exposeFunction('__recordScroll', (deltaX: number, deltaY: number, modifiers?: KeyboardModifier[]) => {
      const mods = modifiers && modifiers.length > 0 ? modifiers : undefined;
      // Coalesce with previous scroll event if same modifiers
      if (this.session?.events.length) {
        const lastEvent = this.session.events[this.session.events.length - 1];
        if (lastEvent.type === 'scroll') {
          const lastMods = lastEvent.data.modifiers;
          const sameModifiers = JSON.stringify(lastMods) === JSON.stringify(mods);
          if (sameModifiers) {
            lastEvent.data.deltaX = (lastEvent.data.deltaX || 0) + deltaX;
            lastEvent.data.deltaY = (lastEvent.data.deltaY || 0) + deltaY;
            this.emit('event', lastEvent);
            return;
          }
        }
      }
      this.addEvent('scroll', { deltaX, deltaY, modifiers: mods });
    });

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

    // Element assertion recording via Shift+right-click menu
    await this.page.exposeFunction('__recordElementAssertion', (assertion: ElementAssertion) => {
      this.addEvent('assertion', { elementAssertion: assertion });
    });

    // Async DOM verification callback - updates event verification status
    await this.page.exposeFunction('__updateVerification', (actionId: string, verified: boolean) => {
      if (!this.session) return;
      const event = this.session.events.find(e => e.data.actionId === actionId);
      if (event && event.verification) {
        event.verification.domVerified = verified;
        event.verification.lastChecked = Date.now();
        // Track update for polling
        this.verificationUpdates.set(actionId, { verified, timestamp: Date.now() });
        this.emit('verification-update', { actionId, verified });
      }
    });

    const pointerGestures = this.settings.pointerGestures;
    const cursorFPS = this.settings.cursorFPS;
    const selectorPriority = this.selectorPriority;

    const initArgs = { pointerGestures, cursorFPS, selectorPriority };

    // Inject interaction tracking script - MUST await
    // This function is used both for addInitScript (future navigations) and evaluate (current page)
    const initFn = ({ pointerGestures: pg, cursorFPS: fps, selectorPriority: priority }: { pointerGestures: boolean; cursorFPS: number; selectorPriority: typeof selectorPriority }) => {
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

      // Keyboard modifier tracking for ALT/CTRL/Space+drag support
      type BrowserKeyboardModifier = 'Alt' | 'Control' | 'Shift' | 'Meta';
      const activeModifiers: Set<BrowserKeyboardModifier> = new Set();

      // Space key tracking: record as explicit keydown/keyup events
      // so apps (like Excalidraw) receive Space and can activate tools (e.g. hand/pan)
      let spaceDown = false;

      document.addEventListener('keydown', (e) => {
        // Ctrl+Shift+S → capture screenshot (don't record as keypress)
        if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 's') {
          e.preventDefault();
          e.stopPropagation();
          // @ts-expect-error
          window.__recordScreenshot?.();
          return;
        }
        if (e.key === 'Alt' || e.key === 'Control' || e.key === 'Shift' || e.key === 'Meta') {
          activeModifiers.add(e.key as BrowserKeyboardModifier);
        } else if (e.key === ' ') {
          // Handle ALL space keydowns here (including repeats) to prevent them from falling through
          const target = e.target as HTMLElement;
          const isEditable = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
          if (!isEditable && !e.repeat && !spaceDown) {
            spaceDown = true;
            // Record as explicit keydown event so playback sends Space to the app
            // @ts-expect-error
            window.__recordKeydown?.(' ', 'Space');
          }
          // Repeat keydowns for space are intentionally ignored
        } else {
          // Record non-modifier keypresses (skip if inside input/textarea to avoid duplicate recording with fill)
          const target = e.target as HTMLElement;
          const isEditable = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
          // Only record special keys (Enter, Escape, Tab, Arrow keys, etc.) or keypresses with modifiers
          const isSpecialKey = e.key.length > 1 || activeModifiers.size > 0;
          if (!isEditable || isSpecialKey) {
            const modifiers = getActiveModifiers();
            // @ts-expect-error
            window.__recordKeypress?.(e.key, modifiers, e.code);
          }
        }
      }, true);

      document.addEventListener('keyup', (e) => {
        if (e.key === 'Alt' || e.key === 'Control' || e.key === 'Shift' || e.key === 'Meta') {
          activeModifiers.delete(e.key as BrowserKeyboardModifier);
        } else if (e.key === ' ') {
          if (spaceDown) {
            spaceDown = false;
            // Record explicit keyup event
            // @ts-expect-error
            window.__recordKeyup?.(' ', 'Space');
          }
        }
      }, true);

      // Clear modifiers on window blur (user switched apps)
      window.addEventListener('blur', () => {
        activeModifiers.clear();
        spaceDown = false;
      });

      function getActiveModifiers(): BrowserKeyboardModifier[] {
        return Array.from(activeModifiers);
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

      // Generate unique action IDs for verification tracking
      let actionIdCounter = 0;
      function generateActionId(): string {
        return `action-${Date.now()}-${++actionIdCounter}`;
      }

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

        // When pointer gestures are enabled, mouse-down/mouse-up already captures clicks
        // Skip the click action to avoid duplicates
        if (pg) return;

        const target = e.target as HTMLElement;
        const selectors = generateAllSelectors(target);
        // Pass actual click position for coordinate fallback (element center is wrong for canvas)
        const rect = target.getBoundingClientRect();
        const boundingBox = { x: rect.x, y: rect.y, width: rect.width, height: rect.height, clickX: e.clientX, clickY: e.clientY };
        const modifiers = getActiveModifiers();
        // @ts-expect-error
        window.__recordAction?.('click', selectors, undefined, boundingBox, generateActionId(), modifiers);
      }, true);

      document.addEventListener('input', (e) => {
        const target = e.target as HTMLInputElement;
        // Skip non-fillable input types (radio, checkbox, etc.)
        const inputType = target.type?.toLowerCase();
        if (inputType === 'radio' || inputType === 'checkbox' || inputType === 'submit' || inputType === 'button' || inputType === 'reset' || inputType === 'file') {
          return;
        }
        const selectors = generateAllSelectors(target);
        const rect = target.getBoundingClientRect();
        const boundingBox = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        // @ts-expect-error
        window.__recordAction?.('fill', selectors, target.value, boundingBox, generateActionId());
      }, true);

      document.addEventListener('change', (e) => {
        const target = e.target as HTMLSelectElement;
        if (target.tagName === 'SELECT') {
          const selectors = generateAllSelectors(target);
          // @ts-expect-error
          window.__recordAction?.('selectOption', selectors, target.value, undefined, generateActionId());
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
        document.addEventListener('pointermove', (e: PointerEvent) => {
          const now = Date.now();
          if (now - lastTime >= interval) {
            lastTime = now;
            // @ts-expect-error
            window.__recordCursorMove?.(e.clientX, e.clientY);
          }
        }, true);

        // Pointer down/up events with modifier tracking
        // Use pointer events instead of mouse events — some apps (e.g. Excalidraw hand tool)
        // call preventDefault() on pointerdown which suppresses mousedown entirely
        document.addEventListener('pointerdown', (e: PointerEvent) => {
          if (e.pointerType !== 'mouse') return;
          const modifiers = getActiveModifiers();
          // @ts-expect-error
          window.__recordMouseEvent?.('down', e.clientX, e.clientY, e.button, modifiers);
        }, true);

        document.addEventListener('pointerup', (e: PointerEvent) => {
          if (e.pointerType !== 'mouse') return;
          const modifiers = getActiveModifiers();
          // @ts-expect-error
          window.__recordMouseEvent?.('up', e.clientX, e.clientY, e.button, modifiers);
        }, true);
      }

      // Wheel/scroll tracking with debounce and modifier capture
      let scrollAccumX = 0;
      let scrollAccumY = 0;
      let scrollModifiers: BrowserKeyboardModifier[] = [];
      let scrollFlushTimer: ReturnType<typeof setTimeout> | null = null;
      const SCROLL_DEBOUNCE_MS = 100;
      document.addEventListener('wheel', (e: WheelEvent) => {
        scrollAccumX += e.deltaX;
        scrollAccumY += e.deltaY;
        // Capture modifiers from the wheel event itself (more reliable than keydown tracking)
        if (!scrollFlushTimer) {
          const eventMods: BrowserKeyboardModifier[] = [];
          if (e.ctrlKey) eventMods.push('Control');
          if (e.shiftKey) eventMods.push('Shift');
          if (e.altKey) eventMods.push('Alt');
          if (e.metaKey) eventMods.push('Meta');
          scrollModifiers = eventMods;
        }
        if (scrollFlushTimer) clearTimeout(scrollFlushTimer);
        scrollFlushTimer = setTimeout(() => {
          if (scrollAccumX !== 0 || scrollAccumY !== 0) {
            // @ts-expect-error
            window.__recordScroll?.(Math.round(scrollAccumX), Math.round(scrollAccumY), scrollModifiers.length > 0 ? scrollModifiers : undefined);
            scrollAccumX = 0;
            scrollAccumY = 0;
            scrollModifiers = [];
          }
          scrollFlushTimer = null;
        }, SCROLL_DEBOUNCE_MS);
      }, { passive: true, capture: true });

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

        // Generate full selectors array for preview
        const selectors = generateAllSelectors(target);
        const primarySelector = selectors[0]?.value || '';

        // @ts-expect-error
        window.__recordHoverPreview?.({
          tagName: target.tagName.toLowerCase(),
          id: target.id || undefined,
          textContent: target.textContent?.trim().slice(0, 30) || undefined,
          potentialAction,
          potentialSelector: primarySelector,
          selectors, // Pass full selector array for better hover preview
        });
      }, true);

      // ========== Element Assertion Menu (Shift+Right-Click) ==========
      type ElementAssertionTypeInBrowser =
        | 'toBeVisible' | 'toBeHidden' | 'toBeAttached' | 'toHaveAttribute'
        | 'toHaveText' | 'toContainText' | 'toHaveValue'
        | 'toBeEnabled' | 'toBeDisabled' | 'toBeChecked';

      interface AssertionOption {
        type: ElementAssertionTypeInBrowser;
        label: string;
        needsValue?: boolean;
        needsAttribute?: boolean;
      }

      let assertionMenuElement: HTMLDivElement | null = null;
      let assertionMenuTarget: HTMLElement | null = null;

      function getAssertionOptions(element: HTMLElement): AssertionOption[] {
        const options: AssertionOption[] = [
          { type: 'toBeVisible', label: 'Assert visible' },
          { type: 'toBeHidden', label: 'Assert hidden' },
          { type: 'toBeAttached', label: 'Assert attached' },
          { type: 'toHaveAttribute', label: 'Assert has attribute...', needsAttribute: true },
        ];

        const tagName = element.tagName.toUpperCase();
        const inputType = (element as HTMLInputElement).type?.toLowerCase();

        // Text assertions for elements with text content
        if (element.textContent?.trim()) {
          options.push({ type: 'toHaveText', label: 'Assert text equals', needsValue: true });
          options.push({ type: 'toContainText', label: 'Assert text contains', needsValue: true });
        }

        // Input-specific assertions
        if (tagName === 'INPUT' || tagName === 'TEXTAREA') {
          options.push({ type: 'toHaveValue', label: 'Assert value equals', needsValue: true });
          options.push({ type: 'toBeEnabled', label: 'Assert enabled' });
          options.push({ type: 'toBeDisabled', label: 'Assert disabled' });
        }

        // Checkbox/radio-specific assertions
        if (inputType === 'checkbox' || inputType === 'radio') {
          options.push({ type: 'toBeChecked', label: 'Assert checked' });
        }

        return options;
      }

      function showAssertionMenu(x: number, y: number, element: HTMLElement): void {
        hideAssertionMenu();

        assertionMenuTarget = element;
        const options = getAssertionOptions(element);

        const menu = document.createElement('div');
        menu.id = '__lastest_assertion_menu';
        menu.style.cssText = `
          position: fixed;
          z-index: 2147483647;
          background: #1f2937;
          border: 1px solid #374151;
          border-radius: 6px;
          padding: 4px 0;
          min-width: 180px;
          box-shadow: 0 10px 25px rgba(0,0,0,0.3);
          font-family: system-ui, -apple-system, sans-serif;
          font-size: 13px;
          color: #e5e7eb;
        `;

        // Header showing element info
        const header = document.createElement('div');
        header.style.cssText = `
          padding: 6px 12px;
          border-bottom: 1px solid #374151;
          font-size: 11px;
          color: #9ca3af;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        `;
        const tagDisplay = element.tagName.toLowerCase();
        const idDisplay = element.id ? `#${element.id}` : '';
        header.textContent = `<${tagDisplay}>${idDisplay}`;
        menu.appendChild(header);

        // Add assertion options
        for (const opt of options) {
          const item = document.createElement('div');
          item.style.cssText = `
            padding: 6px 12px;
            cursor: pointer;
            transition: background 0.1s;
          `;
          item.textContent = opt.label;
          item.addEventListener('mouseenter', () => {
            item.style.background = '#374151';
          });
          item.addEventListener('mouseleave', () => {
            item.style.background = 'transparent';
          });
          item.addEventListener('click', (e) => {
            e.stopPropagation();
            handleAssertionSelection(opt, element);
          });
          menu.appendChild(item);
        }

        // Position menu, ensuring it stays on screen
        let finalX = x;
        let finalY = y;
        document.body.appendChild(menu);
        const rect = menu.getBoundingClientRect();
        if (finalX + rect.width > window.innerWidth) {
          finalX = window.innerWidth - rect.width - 10;
        }
        if (finalY + rect.height > window.innerHeight) {
          finalY = window.innerHeight - rect.height - 10;
        }
        menu.style.left = `${finalX}px`;
        menu.style.top = `${finalY}px`;

        assertionMenuElement = menu;

        // Close menu on click outside or Escape
        setTimeout(() => {
          document.addEventListener('click', hideAssertionMenu, { once: true });
          document.addEventListener('keydown', handleEscapeKey);
        }, 0);
      }

      function hideAssertionMenu(): void {
        if (assertionMenuElement) {
          assertionMenuElement.remove();
          assertionMenuElement = null;
          assertionMenuTarget = null;
          document.removeEventListener('keydown', handleEscapeKey);
        }
      }

      function handleEscapeKey(e: KeyboardEvent): void {
        if (e.key === 'Escape') {
          hideAssertionMenu();
        }
      }

      function handleAssertionSelection(opt: AssertionOption, element: HTMLElement): void {
        const selectors = generateAllSelectors(element);
        let expectedValue: string | undefined;
        let attributeName: string | undefined;
        let attributeValue: string | undefined;

        if (opt.needsAttribute) {
          const promptResult = prompt('Enter attribute name (e.g., "href", "class"):');
          if (!promptResult) {
            hideAssertionMenu();
            return;
          }
          attributeName = promptResult;
          attributeValue = element.getAttribute(attributeName) || '';
        }

        if (opt.needsValue) {
          if (opt.type === 'toHaveText' || opt.type === 'toContainText') {
            expectedValue = element.textContent?.trim() || '';
          } else if (opt.type === 'toHaveValue') {
            expectedValue = (element as HTMLInputElement).value || '';
          }
        }

        // @ts-expect-error
        window.__recordElementAssertion?.({
          type: opt.type,
          selectors,
          expectedValue,
          attributeName,
          attributeValue,
        });

        hideAssertionMenu();
      }

      // Right-click handling: Shift+Right-click = assertion menu, plain right-click = record context menu click
      document.addEventListener('contextmenu', (e) => {
        if (e.shiftKey) {
          // Shift+Right-click: show assertion menu
          e.preventDefault();
          e.stopPropagation();

          const target = e.target as HTMLElement;
          if (!target || target === document.body || target === document.documentElement) return;

          showAssertionMenu(e.clientX, e.clientY, target);
        } else {
          // Plain right-click: record as a right-click action
          const target = e.target as HTMLElement;
          const selectors = generateAllSelectors(target);
          const rect = target.getBoundingClientRect();
          const boundingBox = { x: rect.x, y: rect.y, width: rect.width, height: rect.height, clickX: e.clientX, clickY: e.clientY };
          const modifiers = getActiveModifiers();
          // @ts-expect-error
          window.__recordAction?.('rightclick', selectors, undefined, boundingBox, generateActionId(), modifiers);
        }
      }, true);

      // Async DOM verification system
      // Track pending verifications for actions by actionId
      interface PendingVerification {
        actionId: string;
        selectors: BrowserActionSelector[];
        verified: boolean;
      }
      const pendingVerifications: PendingVerification[] = [];

      // Store original __recordAction to intercept and track verifications
      const originalRecordAction = (window as { __recordAction?: (action: string, selectors: BrowserActionSelector[], value?: string, boundingBox?: { x: number; y: number; width: number; height: number }, actionId?: string) => void }).__recordAction;

      if (originalRecordAction) {
        (window as { __recordAction?: (action: string, selectors: BrowserActionSelector[], value?: string, boundingBox?: { x: number; y: number; width: number; height: number }, actionId?: string) => void }).__recordAction = (action, selectors, value, boundingBox, actionId) => {
          // Call original
          originalRecordAction(action, selectors, value, boundingBox, actionId);

          // Add to pending verifications if has selectors and actionId
          if (!actionId) return;
          const validSelectors = selectors.filter(sel => sel.value && sel.value.trim() && !sel.value.includes('undefined'));
          if (validSelectors.length > 0) {
            pendingVerifications.push({
              actionId,
              selectors: validSelectors,
              verified: false,
            });
            // Keep only last 50 verifications to avoid memory growth
            if (pendingVerifications.length > 50) {
              pendingVerifications.shift();
            }
          }
        };
      }

      // Verification loop - runs every 1s to check if selectors can find elements
      setInterval(() => {
        for (const pending of pendingVerifications) {
          if (pending.verified) continue; // Already verified

          // Try each selector to see if element can be found
          const found = pending.selectors.some(sel => {
            try {
              // Handle special selector types
              if (sel.type === 'role-name') {
                // Can't easily test role selectors in browser, assume valid
                return true;
              }
              if (sel.type === 'text') {
                // Text selectors are hard to test, assume valid
                return true;
              }
              if (sel.type === 'ocr-text') {
                // OCR selectors can't be tested in browser
                return true;
              }
              // Standard CSS selectors
              return document.querySelector(sel.value) !== null;
            } catch {
              return false;
            }
          });

          if (found) {
            pending.verified = true;
            // @ts-expect-error
            window.__updateVerification?.(pending.actionId, true);
          }
        }
      }, 1000);
    };

    // addInitScript handles future navigations (SPA route changes that create new documents)
    await this.page.addInitScript(initFn, initArgs);

    // evaluate injects into the CURRENT page immediately (addInitScript doesn't retroactively inject)
    await this.page.evaluate(initFn, initArgs);
  }

  private getRelativePath(url: string): string {
    if (url.startsWith(this.baseOrigin)) {
      return url.slice(this.baseOrigin.length) || '/';
    }
    return url;
  }

  private addEvent(type: RecordingEvent['type'], data: RecordingEvent['data'], status: 'preview' | 'committed' = 'committed', verification?: VerificationStatus) {
    if (!this.session) return;

    const event: RecordingEvent = {
      type,
      timestamp: Date.now(),
      sequence: ++this.sequenceCounter,
      status,
      data,
    };

    if (verification) {
      event.verification = verification;
    }

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

  /** Map e.code (physical key) to the base unshifted key name for Playwright */
  private static keyCodeToBaseKey(code: string): string | null {
    if (code.startsWith('Digit')) return code[5]; // Digit1 → 1
    if (code.startsWith('Key')) return code.slice(3).toLowerCase(); // KeyA → a
    const map: Record<string, string> = {
      Backquote: '`', Minus: '-', Equal: '=',
      BracketLeft: '[', BracketRight: ']', Backslash: '\\',
      Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
      Space: ' ',
    };
    return map[code] ?? null;
  }

  private generateCode(): string {
    if (!this.session) return '';

    const hasCursorEvents = this.session.events.some(e => e.type === 'cursor-move');
    const coordsEnabled = this.selectorPriority.find(s => s.type === 'coords')?.enabled ?? true;

    const lines: string[] = [
      `import { Page } from 'playwright';`,
      '',
      `export async function test(page: Page, baseUrl: string, screenshotPath: string, stepLogger: any) {`,
      `  // Helper to build URLs safely (handles trailing/leading slashes)`,
      `  function buildUrl(base, path) {`,
      `    const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;`,
      `    const cleanPath = path.startsWith('/') ? path : '/' + path;`,
      `    return cleanBase + cleanPath;`,
      `  }`,
      ``,
      `  // Helper to generate unique screenshot paths`,
      `  let screenshotStep = 0;`,
      `  function getScreenshotPath() {`,
      `    screenshotStep++;`,
      `    const ext = screenshotPath.lastIndexOf('.');`,
      `    if (ext > 0) {`,
      `      return screenshotPath.slice(0, ext) + '-step' + screenshotStep + screenshotPath.slice(ext);`,
      `    }`,
      `    return screenshotPath + '-step' + screenshotStep;`,
      `  }`,
      ``,
      `  // Multi-selector fallback helper with coordinate fallback for clicks`,
      `  async function locateWithFallback(page, selectors, action, value, coords, options) {`,
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
      `        // Use .first() to handle multiple matches (e.g., header + footer nav links)`,
      `        const target = locator.first();`,
      `        await target.waitFor({ timeout: 3000 });`,
      `        if (action === 'locate') return target; // Return locator for assertions`,
      `        if (action === 'click') await target.click(options || {});`,
      `        else if (action === 'fill') await target.fill(value || '');`,
      `        else if (action === 'selectOption') await target.selectOption(value || '');`,
      `        return target;`,
      `      } catch { continue; }`,
      `    }`,
      ...(coordsEnabled ? [
      `    // Coordinate fallback for clicks when all selectors fail`,
      `    if (action === 'click' && coords) {`,
      `      console.log('Falling back to coordinate click at', coords.x, coords.y);`,
      `      await page.mouse.click(coords.x, coords.y, options || {});`,
      `      return;`,
      `    }`,
      `    // Coordinate fallback for fill - click to focus then type`,
      `    if (action === 'fill' && coords) {`,
      `      console.log('Falling back to coordinate fill at', coords.x, coords.y);`,
      `      await page.mouse.click(coords.x, coords.y);`,
      `      await page.keyboard.selectAll();`,
      `      await page.keyboard.type(value || '');`,
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

    // Escape a string value for embedding in single-quoted JS strings
    const escStr = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r');

    let lastAction = '';
    let lastEmittedEventType = ''; // Track last non-cursor event for context-aware code gen
    let cursorBatch: [number, number, number][] = [];
    let lastCursorTimestamp = 0;
    let lastCursorX = 640;
    let lastCursorY = 360;

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
        lastCursorX = x;
        lastCursorY = y;
        continue;
      }

      // Flush any pending cursor moves before other events
      flushCursorBatch();

      if (event.type === 'navigation' && event.data.relativePath) {
        // Only add goto for the first navigation or if URL changed significantly
        if (!lastAction.includes('goto')) {
          const relativePath = event.data.relativePath;
          lines.push(`  await page.goto(buildUrl(baseUrl, '${relativePath}'));`);
        }
        lastAction = 'goto';
      } else if (event.type === 'action') {
        const { action, selector, selectors, value, coordinates, button, modifiers } = event.data;
        const isRightClick = action === 'rightclick' || button === 2;
        const hasModifiers = modifiers && modifiers.length > 0;

        // Build click options object with button and modifiers
        const clickOptParts: string[] = [];
        if (isRightClick) clickOptParts.push(`button: 'right'`);
        if (hasModifiers) clickOptParts.push(`modifiers: [${modifiers!.map((m: string) => `'${m}'`).join(', ')}]`);
        const clickOptions = clickOptParts.length > 0 ? `{ ${clickOptParts.join(', ')} }` : 'null';

        // Press modifier keys before action (for coordinate fallback paths)
        const emitModDown = () => {
          if (hasModifiers) {
            for (const mod of modifiers!) {
              lines.push(`  await page.keyboard.down('${mod}');`);
            }
          }
        };
        const emitModUp = () => {
          if (hasModifiers) {
            for (const mod of [...modifiers!].reverse()) {
              lines.push(`  await page.keyboard.up('${mod}');`);
            }
          }
        };

        // Use multi-selector format if available
        if (selectors && selectors.length > 0) {
          const selectorsJson = JSON.stringify(selectors);
          const coordsArg = coordinates ? JSON.stringify(coordinates) : 'null';
          switch (action) {
            case 'click':
              lines.push(`  await locateWithFallback(page, ${selectorsJson}, 'click', null, ${coordsArg}${clickOptions !== 'null' ? `, ${clickOptions}` : ''});`);
              break;
            case 'rightclick':
              lines.push(`  await locateWithFallback(page, ${selectorsJson}, 'click', null, ${coordsArg}, ${clickOptions});`);
              break;
            case 'fill':
              lines.push(`  await locateWithFallback(page, ${selectorsJson}, 'fill', '${escStr(value || '')}', ${coordsArg});`);
              break;
            case 'selectOption':
              lines.push(`  await locateWithFallback(page, ${selectorsJson}, 'selectOption', '${escStr(value || '')}', null);`);
              break;
          }
        } else if (selector && selector.trim()) {
          // Fallback to legacy single selector (only if non-empty)
          switch (action) {
            case 'click':
              lines.push(`  await page.locator('${selector}').click(${clickOptions !== 'null' ? clickOptions : ''});`);
              break;
            case 'rightclick':
              lines.push(`  await page.locator('${selector}').click(${clickOptions});`);
              break;
            case 'fill':
              lines.push(`  await page.locator('${selector}').fill('${escStr(value || '')}');`);
              break;
            case 'selectOption':
              lines.push(`  await page.locator('${selector}').selectOption('${escStr(value || '')}');`);
              break;
          }
        } else {
          // No selectors available - use coordinate fallback
          if ((action === 'click' || action === 'rightclick') && coordinates) {
            lines.push(`  // Coordinate-only ${isRightClick ? 'right-' : ''}click (no selectors found)`);
            emitModDown();
            lines.push(`  await page.mouse.click(${coordinates.x}, ${coordinates.y}${isRightClick ? `, { button: 'right' }` : ''});`);
            emitModUp();
          } else if (action === 'fill' && coordinates) {
            if (lastEmittedEventType === 'mouse-up') {
              // Text input already focused by previous click (e.g. canvas text editor) - just type
              lines.push(`  await page.keyboard.type('${escStr(value || '')}');`);
            } else {
              lines.push(`  // Coordinate-only fill (no selectors found) - click to focus then type`);
              lines.push(`  await page.mouse.click(${coordinates.x}, ${coordinates.y});`);
              lines.push(`  await page.keyboard.selectAll();`);
              lines.push(`  await page.keyboard.type('${escStr(value || '')}');`);
            }
          } else {
            lines.push(`  // Skipped ${action}: no valid selector or coordinates found`);
          }
        }
        lastAction = action || '';
        lastEmittedEventType = 'action';
      } else if (event.type === 'screenshot') {
        lines.push(`  await page.screenshot({ path: getScreenshotPath(), fullPage: true });`);
      } else if (event.type === 'assertion') {
        const { assertionType, url, elementAssertion } = event.data;

        // Handle element assertions (from Shift+right-click menu)
        if (elementAssertion) {
          const selectorsJson = JSON.stringify(elementAssertion.selectors);
          const assertType = elementAssertion.type;
          lines.push(`  // Element assertion: ${assertType}`);
          lines.push(`  {`);
          lines.push(`    const el = await locateWithFallback(page, ${selectorsJson}, 'locate', null, null);`);

          // Generate the appropriate expect() call based on assertion type
          switch (assertType) {
            case 'toBeVisible':
              lines.push(`    await expect(el).toBeVisible();`);
              break;
            case 'toBeHidden':
              lines.push(`    await expect(el).toBeHidden();`);
              break;
            case 'toBeAttached':
              lines.push(`    await expect(el).toBeAttached();`);
              break;
            case 'toHaveAttribute':
              lines.push(`    await expect(el).toHaveAttribute('${elementAssertion.attributeName || ''}', '${elementAssertion.attributeValue || ''}');`);
              break;
            case 'toHaveText':
              lines.push(`    await expect(el).toHaveText('${(elementAssertion.expectedValue || '').replace(/'/g, "\\'")}');`);
              break;
            case 'toContainText':
              lines.push(`    await expect(el).toContainText('${(elementAssertion.expectedValue || '').replace(/'/g, "\\'")}');`);
              break;
            case 'toHaveValue':
              lines.push(`    await expect(el).toHaveValue('${(elementAssertion.expectedValue || '').replace(/'/g, "\\'")}');`);
              break;
            case 'toBeEnabled':
              lines.push(`    await expect(el).toBeEnabled();`);
              break;
            case 'toBeDisabled':
              lines.push(`    await expect(el).toBeDisabled();`);
              break;
            case 'toBeChecked':
              lines.push(`    await expect(el).toBeChecked();`);
              break;
          }
          lines.push(`  }`);
        } else {
          // Handle page-level assertions
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
              lines.push(`  await expect(page).toHaveURL(buildUrl(baseUrl, '${relativePath}'));`);
              break;
            case 'domContentLoaded':
              lines.push(`  // Assertion: Verify DOM is ready`);
              lines.push(`  await page.waitForLoadState('domcontentloaded');`);
              break;
          }
        }
      } else if (event.type === 'mouse-down' && event.data.coordinates) {
        const { x, y } = event.data.coordinates;
        const modifiers = event.data.modifiers;
        const mouseButton = event.data.button;
        const buttonOpt = mouseButton === 2 ? `{ button: 'right' }` : '';
        // Press modifier keys before mouse down
        if (modifiers && modifiers.length > 0) {
          for (const mod of modifiers) {
            lines.push(`  await page.keyboard.down('${mod}');`);
          }
        }
        lines.push(`  await page.mouse.move(${x}, ${y});`);
        lines.push(`  await page.mouse.down(${buttonOpt});`);
        lastEmittedEventType = 'mouse-down';
      } else if (event.type === 'mouse-up' && event.data.coordinates) {
        const { x, y } = event.data.coordinates;
        const modifiers = event.data.modifiers;
        const mouseButton = event.data.button;
        const buttonOpt = mouseButton === 2 ? `{ button: 'right' }` : '';
        lines.push(`  await page.mouse.move(${x}, ${y});`);
        lines.push(`  await page.mouse.up(${buttonOpt});`);
        // Release modifier keys after mouse up
        if (modifiers && modifiers.length > 0) {
          for (const mod of modifiers) {
            lines.push(`  await page.keyboard.up('${mod}');`);
          }
        }
        lastEmittedEventType = 'mouse-up';
      } else if (event.type === 'keypress' && event.data.key) {
        const { key, modifiers, keyCode } = event.data;
        // When Shift is a modifier and e.key is a single char, e.key is the shifted result
        // (e.g. Shift+1 → '!' on US, '\'' on other layouts). Use the physical keyCode
        // to get the base key so Shift+1 replays as Shift+1, not Shift+<shifted-char>.
        let pressKey = key;
        const hasShift = modifiers && modifiers.includes('Shift');
        if (hasShift && key.length === 1 && keyCode) {
          const baseKey = PlaywrightRecorder.keyCodeToBaseKey(keyCode);
          if (baseKey) pressKey = baseKey;
        }
        const escapedKey = pressKey.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        // Press modifier keys before the key
        if (modifiers && modifiers.length > 0) {
          for (const mod of modifiers) {
            lines.push(`  await page.keyboard.down('${mod}');`);
          }
        }
        lines.push(`  await page.keyboard.press('${escapedKey}');`);
        // Release modifier keys after the key
        if (modifiers && modifiers.length > 0) {
          for (const mod of [...modifiers].reverse()) {
            lines.push(`  await page.keyboard.up('${mod}');`);
          }
        }
        lastEmittedEventType = 'keypress';
      } else if (event.type === 'keydown' && event.data.key) {
        const escapedKey = event.data.key.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        lines.push(`  await page.keyboard.down('${escapedKey}');`);
        lastEmittedEventType = 'keydown';
      } else if (event.type === 'keyup' && event.data.key) {
        const escapedKey = event.data.key.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        lines.push(`  await page.keyboard.up('${escapedKey}');`);
        lastEmittedEventType = 'keyup';
      } else if (event.type === 'scroll') {
        const deltaX = event.data.deltaX || 0;
        const deltaY = event.data.deltaY || 0;
        const scrollMods = event.data.modifiers;
        if (scrollMods && scrollMods.length > 0) {
          // Dispatch WheelEvent via evaluate with modifier flags set directly on the event
          // (keyboard.down + mouse.wheel doesn't propagate modifier state to the wheel event)
          const modFlags: string[] = [];
          if (scrollMods.includes('Control')) modFlags.push('ctrlKey: true');
          if (scrollMods.includes('Shift')) modFlags.push('shiftKey: true');
          if (scrollMods.includes('Alt')) modFlags.push('altKey: true');
          if (scrollMods.includes('Meta')) modFlags.push('metaKey: true');
          lines.push(`  await page.evaluate(({ x, y, dx, dy }) => {`);
          lines.push(`    const el = document.elementFromPoint(x, y) || document.documentElement;`);
          lines.push(`    el.dispatchEvent(new WheelEvent('wheel', { deltaX: dx, deltaY: dy, ${modFlags.join(', ')}, bubbles: true, cancelable: true, clientX: x, clientY: y }));`);
          lines.push(`  }, { x: ${lastCursorX}, y: ${lastCursorY}, dx: ${deltaX}, dy: ${deltaY} });`);
        } else {
          lines.push(`  await page.mouse.wheel(${deltaX}, ${deltaY});`);
        }
        lastEmittedEventType = 'scroll';
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

  // Get and clear pending verification updates
  getVerificationUpdates(): Array<{ actionId: string; verified: boolean }> {
    const updates = Array.from(this.verificationUpdates.entries()).map(([actionId, data]) => ({
      actionId,
      verified: data.verified,
    }));
    this.verificationUpdates.clear();
    return updates;
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
