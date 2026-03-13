/**
 * Debug recording injection utility.
 * Injects recording event listeners into an existing Playwright Page
 * during a debug session. Does NOT own the browser/context.
 */

import type { Page } from 'playwright';
import type { CodeGenEvent } from './event-to-code';
import { eventsToCodeLines } from './event-to-code';

export interface DebugRecordingSession {
  events: CodeGenEvent[];
  isActive: boolean;
  startedAt: number;
}

interface InjectOptions {
  onEvent?: (eventCount: number) => void;
}

/**
 * Inject recording listeners into an existing debug page.
 * Uses `__debugRecord*` prefix to avoid conflicts with any existing recorder functions.
 *
 * @param page - The Playwright page to inject into
 * @param baseUrl - The base URL of the app being tested
 * @param alreadyExposed - If true, skip exposeFunction calls (re-recording on same page)
 * @param options - Callbacks
 * @returns session and cleanup function
 */
export async function injectRecordingListeners(
  page: Page,
  baseUrl: string,
  alreadyExposed: boolean,
  options?: InjectOptions
): Promise<{ session: DebugRecordingSession; cleanup: () => Promise<void> }> {
  const session: DebugRecordingSession = {
    events: [],
    isActive: true,
    startedAt: Date.now(),
  };

  // Fill coalescing state
  let lastFillSelector = '';
  let lastFillTimestamp = 0;
  const FILL_COALESCE_MS = 500;

  const addEvent = (event: CodeGenEvent) => {
    if (!session.isActive) return;
    session.events.push(event);
    options?.onEvent?.(session.events.length);
  };

  if (!alreadyExposed) {
    // Expose bridge functions from browser → Node.js
    await page.exposeFunction('__debugRecordAction', (
      action: string,
      selectors: Array<{ type: string; value: string }>,
      value?: string,
      coordinates?: { x: number; y: number }
    ) => {
      // Fill coalescing: merge consecutive fills on same selector
      if (action === 'fill' && selectors.length > 0) {
        const selectorKey = JSON.stringify(selectors[0]);
        const now = Date.now();
        if (selectorKey === lastFillSelector && (now - lastFillTimestamp) < FILL_COALESCE_MS) {
          // Replace the last fill event
          const lastIdx = session.events.length - 1;
          if (lastIdx >= 0 && session.events[lastIdx].type === 'action' && session.events[lastIdx].data.action === 'fill') {
            session.events[lastIdx].data.value = value;
            session.events[lastIdx].timestamp = now;
            options?.onEvent?.(session.events.length);
            lastFillTimestamp = now;
            return;
          }
        }
        lastFillSelector = selectorKey;
        lastFillTimestamp = now;
      } else {
        lastFillSelector = '';
      }

      addEvent({
        type: 'action',
        timestamp: Date.now(),
        data: { action, selectors, value, coordinates },
      });
    });

    await page.exposeFunction('__debugRecordKeypress', (key: string, modifiers?: string[]) => {
      addEvent({
        type: 'keypress',
        timestamp: Date.now(),
        data: { key, modifiers: modifiers && modifiers.length > 0 ? modifiers : undefined },
      });
    });

    await page.exposeFunction('__debugRecordScroll', (deltaX: number, deltaY: number) => {
      addEvent({
        type: 'scroll',
        timestamp: Date.now(),
        data: { deltaX, deltaY },
      });
    });
  }

  // Navigation tracking
  const onFrameNavigated = (frame: import('playwright').Frame) => {
    if (frame !== page.mainFrame()) return;
    if (!session.isActive) return;
    const url = frame.url();
    try {
      const parsedUrl = new URL(url);
      const baseOrigin = new URL(baseUrl).origin;
      if (parsedUrl.origin === baseOrigin) {
        addEvent({
          type: 'navigation',
          timestamp: Date.now(),
          data: { relativePath: parsedUrl.pathname + parsedUrl.search, url },
        });
      }
    } catch { /* ignore invalid URLs */ }
  };
  page.on('framenavigated', onFrameNavigated);

  // Browser-side init script for capturing user interactions
  const initFn = () => {
    // Guard against double-injection
    if ((window as unknown as Record<string, unknown>).__debugRecordingActive) return;
    (window as unknown as Record<string, unknown>).__debugRecordingActive = true;

    type Modifier = 'Alt' | 'Control' | 'Shift' | 'Meta';
    const activeModifiers: Set<Modifier> = new Set();

    document.addEventListener('keydown', (e) => {
      if ((window as unknown as Record<string, unknown>).__debugRecordingDisabled) return;
      if (e.key === 'Alt' || e.key === 'Control' || e.key === 'Shift' || e.key === 'Meta') {
        activeModifiers.add(e.key as Modifier);
      } else {
        const target = e.target as HTMLElement;
        const isEditable = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
        const isSpecialKey = e.key.length > 1 || activeModifiers.size > 0;
        if (!isEditable || isSpecialKey) {
          // @ts-expect-error - exposed function
          window.__debugRecordKeypress?.(e.key, Array.from(activeModifiers));
        }
      }
    }, true);

    document.addEventListener('keyup', (e) => {
      if (e.key === 'Alt' || e.key === 'Control' || e.key === 'Shift' || e.key === 'Meta') {
        activeModifiers.delete(e.key as Modifier);
      }
    }, true);

    window.addEventListener('blur', () => {
      activeModifiers.clear();
    });

    // Generate selectors for an element
    function generateSelectors(element: HTMLElement): Array<{ type: string; value: string }> {
      const selectors: Array<{ type: string; value: string }> = [];

      if (element.dataset.testid) {
        selectors.push({ type: 'data-testid', value: `[data-testid="${element.dataset.testid}"]` });
      }
      if (element.id && !element.id.includes('undefined')) {
        selectors.push({ type: 'id', value: `#${element.id}` });
      }
      const role = element.getAttribute('role') || getImplicitRole(element);
      const accessibleName = element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent?.trim().slice(0, 30);
      if (role && accessibleName) {
        selectors.push({ type: 'role-name', value: `role=${role}[name="${accessibleName}"]` });
      }
      const ariaLabel = element.getAttribute('aria-label');
      if (ariaLabel) {
        selectors.push({ type: 'aria-label', value: `[aria-label="${ariaLabel}"]` });
      }
      const INTERACTIVE_ROLES = new Set([
        'button', 'option', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
        'tab', 'treeitem', 'link', 'switch', 'radio', 'checkbox',
        'combobox', 'listitem'
      ]);
      const elRole = element.getAttribute('role');
      if ((element.tagName === 'BUTTON' || element.tagName === 'A' ||
           element.tagName === 'LI' || element.tagName === 'LABEL' ||
           (elRole && INTERACTIVE_ROLES.has(elRole))) && element.textContent?.trim()) {
        selectors.push({ type: 'text', value: `text="${element.textContent.trim().slice(0, 30)}"` });
      }
      const placeholder = element.getAttribute('placeholder');
      if (placeholder) {
        selectors.push({ type: 'placeholder', value: `[placeholder="${placeholder}"]` });
      }
      const name = element.getAttribute('name');
      if (name) {
        selectors.push({ type: 'name', value: `[name="${name}"]` });
      }
      // Leaf element fallback: generate text selector for elements with no children and short text
      if (!selectors.some(s => s.type === 'text') && element.children.length === 0) {
        const leafText = element.textContent?.trim().slice(0, 30);
        if (leafText && leafText.length > 0) {
          selectors.push({ type: 'text', value: `text="${leafText}"` });
        }
      }
      // CSS path fallback
      selectors.push({ type: 'css-path', value: getCssPath(element) });

      return selectors;
    }

    function getImplicitRole(el: HTMLElement): string | null {
      const tag = el.tagName.toLowerCase();
      if (tag === 'li') {
        const parent = el.closest('[role="listbox"], [role="menu"], [role="tablist"], [role="tree"]');
        if (parent) {
          const parentRole = parent.getAttribute('role');
          if (parentRole === 'listbox') return 'option';
          if (parentRole === 'menu') return 'menuitem';
        }
        return 'listitem';
      }
      if (tag === 'button') return 'button';
      if (tag === 'a' && el.hasAttribute('href')) return 'link';
      if (tag === 'input') {
        const type = (el as HTMLInputElement).type;
        if (type === 'checkbox') return 'checkbox';
        if (type === 'radio') return 'radio';
        if (type === 'submit' || type === 'button') return 'button';
        return 'textbox';
      }
      if (tag === 'textarea') return 'textbox';
      if (tag === 'select') return 'combobox';
      return null;
    }

    function getCssPath(el: HTMLElement): string {
      const parts: string[] = [];
      let current: HTMLElement | null = el;
      while (current && current !== document.body) {
        let selector = current.tagName.toLowerCase();
        if (current.id) {
          selector = `#${current.id}`;
          parts.unshift(selector);
          break;
        }
        const parent: HTMLElement | null = current.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter(c => c.tagName === current!.tagName);
          if (siblings.length > 1) {
            const idx = siblings.indexOf(current) + 1;
            selector += `:nth-of-type(${idx})`;
          }
        }
        parts.unshift(selector);
        current = parent;
      }
      return parts.join(' > ');
    }

    // Walk up DOM to find nearest interactive ancestor for better selectors.
    function findBestTarget(el: HTMLElement): HTMLElement {
      const INTERACTIVE_ROLES = new Set([
        'button', 'option', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
        'tab', 'treeitem', 'link', 'switch', 'radio', 'checkbox',
        'combobox', 'listitem'
      ]);
      const INTERACTIVE_TAGS = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'LI']);
      let current: HTMLElement | null = el;
      while (current && current !== document.body && current !== document.documentElement) {
        const role = current.getAttribute('role');
        if (role && INTERACTIVE_ROLES.has(role)) return current;
        if (INTERACTIVE_TAGS.has(current.tagName)) return current;
        if (current.dataset.testid) return current;
        current = current.parentElement;
      }
      return el;
    }

    // Capture pointerdown target selectors for fallback (dropdown options removed from DOM before click fires).
    // Uses pointerdown instead of mousedown because Radix UI (and similar) call preventDefault()
    // on pointerdown which suppresses mousedown entirely. Capture-phase pointerdown fires first.
    let pointerDownTarget: HTMLElement | null = null;
    let pointerDownSelectors: Array<{ type: string; value: string }> | null = null;
    let pointerDownCoords: { x: number; y: number } | null = null;
    let pointerCleanupTimer: ReturnType<typeof setTimeout> | null = null;
    let pointerDownDeferTimer: ReturnType<typeof setTimeout> | null = null;
    let pointerDownClickRecorded = false;
    document.addEventListener('pointerdown', (e: PointerEvent) => {
      if (pointerCleanupTimer) { clearTimeout(pointerCleanupTimer); pointerCleanupTimer = null; }
      if (pointerDownDeferTimer) { clearTimeout(pointerDownDeferTimer); pointerDownDeferTimer = null; }
      const rawTarget = e.target as HTMLElement;
      const target = findBestTarget(rawTarget);
      pointerDownTarget = target;
      pointerDownSelectors = generateSelectors(target);
      pointerDownCoords = { x: e.clientX, y: e.clientY };
      pointerDownClickRecorded = false;

      // Deferred recording: if click never fires (Radix removes element), record from pointerdown
      const savedSelectors = pointerDownSelectors;
      const savedCoords = pointerDownCoords;
      if (savedSelectors && savedSelectors.length > 0) {
        pointerDownDeferTimer = setTimeout(() => {
          if (!pointerDownClickRecorded && !document.contains(target) && savedSelectors.length > 0) {
            // @ts-expect-error - exposed function
            window.__debugRecordAction?.('click', savedSelectors, undefined, savedCoords);
          }
          pointerDownDeferTimer = null;
        }, 300);
      }
    }, true);
    document.addEventListener('pointerup', () => {
      pointerCleanupTimer = setTimeout(() => { pointerDownTarget = null; pointerDownSelectors = null; pointerDownCoords = null; pointerCleanupTimer = null; }, 500);
    }, true);

    // Capture mouseover selectors as second fallback (fires before click, unaffected by DOM removal)
    let hoverSelectors: Array<{ type: string; value: string }> | null = null;
    let hoverCoords: { x: number; y: number } | null = null;
    document.addEventListener('mouseover', (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target || target === document.body || target === document.documentElement) return;
      const sels = generateSelectors(target);
      if (sels.length > 0) {
        hoverSelectors = sels;
        hoverCoords = { x: e.clientX, y: e.clientY };
      }
    }, true);

    // Click listener
    document.addEventListener('click', (e) => {
      if ((window as unknown as Record<string, unknown>).__debugRecordingDisabled) return;
      pointerDownClickRecorded = true; // Prevent deferred pointerdown from double-recording
      const target = e.target as HTMLElement;
      let selectors = generateSelectors(target);
      let coords = { x: e.clientX, y: e.clientY };

      const hasUsefulSelectors = selectors.length > 0 &&
        !(selectors.length === 1 && selectors[0].type === 'css-path' &&
          (selectors[0].value === 'body' || selectors[0].value === 'html'));

      // Fallback 1: pointerdown selectors
      if (!hasUsefulSelectors && pointerDownTarget && target !== pointerDownTarget &&
          pointerDownSelectors && pointerDownSelectors.length > 0) {
        selectors = pointerDownSelectors;
        if (pointerDownCoords) coords = pointerDownCoords;
      }

      // Fallback 2: mouseover/hover selectors
      const stillNoSelectors = selectors.length === 0 ||
        (selectors.length === 1 && selectors[0].type === 'css-path' &&
          (selectors[0].value === 'body' || selectors[0].value === 'html'));
      if (stillNoSelectors && hoverSelectors && hoverSelectors.length > 0) {
        selectors = hoverSelectors;
        if (hoverCoords) coords = hoverCoords;
      }

      // @ts-expect-error - exposed function
      window.__debugRecordAction?.('click', selectors, undefined, coords);
    }, true);

    // Input listener (fill coalescing happens on the Node side)
    document.addEventListener('input', (e) => {
      if ((window as unknown as Record<string, unknown>).__debugRecordingDisabled) return;
      const target = e.target as HTMLInputElement;
      const inputType = target.type?.toLowerCase();
      if (inputType === 'radio' || inputType === 'checkbox' || inputType === 'submit' || inputType === 'button' || inputType === 'reset' || inputType === 'file') {
        return;
      }
      const selectors = generateSelectors(target);
      // @ts-expect-error - exposed function
      window.__debugRecordAction?.('fill', selectors, target.value, undefined);
    }, true);

    // Select change listener
    document.addEventListener('change', (e) => {
      if ((window as unknown as Record<string, unknown>).__debugRecordingDisabled) return;
      const target = e.target as HTMLSelectElement;
      if (target.tagName === 'SELECT') {
        const selectors = generateSelectors(target);
        // @ts-expect-error - exposed function
        window.__debugRecordAction?.('selectOption', selectors, target.value, undefined);
      }
    }, true);

    // Scroll listener (debounced)
    let scrollTimer: ReturnType<typeof setTimeout> | null = null;
    let accDeltaX = 0;
    let accDeltaY = 0;
    document.addEventListener('wheel', (e) => {
      if ((window as unknown as Record<string, unknown>).__debugRecordingDisabled) return;
      accDeltaX += e.deltaX;
      accDeltaY += e.deltaY;
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        // @ts-expect-error - exposed function
        window.__debugRecordScroll?.(accDeltaX, accDeltaY);
        accDeltaX = 0;
        accDeltaY = 0;
        scrollTimer = null;
      }, 150);
    }, { passive: true, capture: true });
  };

  // Inject into current page and future navigations
  await page.addInitScript(initFn);
  await page.evaluate(initFn);

  const cleanup = async () => {
    session.isActive = false;
    page.off('framenavigated', onFrameNavigated);
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>).__debugRecordingDisabled = true;
      (window as unknown as Record<string, unknown>).__debugRecordingActive = false;
    }).catch(() => {});
  };

  return { session, cleanup };
}

/**
 * Convert debug recording session events into code lines (no function wrapper).
 * Lines are NOT indented (caller adds indentation as needed).
 */
export function generateBodyLinesFromEvents(
  events: CodeGenEvent[],
  baseOrigin: string
): string[] {
  return eventsToCodeLines(events, baseOrigin, true, {
    indent: '  ',
    includeCursorReplay: false,
  });
}
