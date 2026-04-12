/**
 * Browser-side recording script for the remote runner.
 * Injected into the target page to capture user interactions.
 *
 * This is the same script used by the server-side recorder (src/lib/playwright/recorder.ts).
 * It must be kept in sync with the server version.
 *
 * The script captures: clicks, fills, selects, keyboard, scroll/wheel, mouse gestures,
 * hover previews, element assertions (Shift+right-click), and DOM verification.
 *
 * Exposed functions (must be registered via page.exposeFunction before injection):
 * - __recordAction(action, selectors, value, boundingBox, actionId, modifiers)
 * - __recordKeypress(key, modifiers)
 * - __recordCursorMove(x, y)           [if pointerGestures enabled]
 * - __recordMouseEvent(type, x, y, button, modifiers) [if pointerGestures enabled]
 * - __recordHoverPreview(elementInfo)
 * - __recordElementAssertion(assertion)
 * - __updateVerification(actionId, verified)
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export const browserRecordingScript = ({ pointerGestures: pg, cursorFPS: fps, selectorPriority: priority }: {
  pointerGestures: boolean;
  cursorFPS: number;
  selectorPriority: Array<{ type: string; enabled: boolean; priority: number }>;
}) => {
  interface BrowserActionSelector {
    type: string;
    value: string;
  }

  interface BrowserSelectorConfig {
    type: string;
    enabled: boolean;
    priority: number;
  }

  type BrowserKeyboardModifier = 'Alt' | 'Control' | 'Shift' | 'Meta';
  const activeModifiers: Set<BrowserKeyboardModifier> = new Set();

  document.addEventListener('keydown', (e) => {
    // Ctrl+Shift+S: take screenshot
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      e.stopPropagation();
      // @ts-expect-error - exposed function
      window.__recordScreenshot?.();
      return;
    }
    if (e.key === 'Alt' || e.key === 'Control' || e.key === 'Shift' || e.key === 'Meta') {
      activeModifiers.add(e.key as BrowserKeyboardModifier);
    } else {
      const target = e.target as HTMLElement;
      const isEditable = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      const isSpecialKey = e.key.length > 1 || activeModifiers.size > 0;
      if (!isEditable || isSpecialKey) {
        const modifiers = getActiveModifiers();
        // @ts-expect-error - exposed function
        window.__recordKeypress?.(e.key, modifiers);
      }
    }
  }, true);

  document.addEventListener('keyup', (e) => {
    if (e.key === 'Alt' || e.key === 'Control' || e.key === 'Shift' || e.key === 'Meta') {
      activeModifiers.delete(e.key as BrowserKeyboardModifier);
    }
  }, true);

  window.addEventListener('blur', () => {
    activeModifiers.clear();
  });

  function getActiveModifiers(): BrowserKeyboardModifier[] {
    return Array.from(activeModifiers);
  }

  // Drag/draw detection
  let mouseDownState: { x: number; y: number; time: number } | null = null;
  const DRAG_THRESHOLD_PX = 10;
  const DRAG_THRESHOLD_MS = 300;

  document.addEventListener('mousedown', (e) => {
    mouseDownState = { x: e.clientX, y: e.clientY, time: Date.now() };
  }, true);

  document.addEventListener('mouseup', () => {
    setTimeout(() => { mouseDownState = null; }, 50);
  }, true);

  let actionIdCounter = 0;
  function generateActionId(): string {
    return `action-${Date.now()}-${++actionIdCounter}`;
  }

  // Capture selectors at pointerdown time for fallback.
  // Radix UI (and similar) remove elements from DOM on selection, causing click
  // to retarget to body/wrapper with useless selectors. pointerdown fires first.
  let pointerDownSelectors: BrowserActionSelector[] | null = null;
  let pointerDownBoundingBox: { x: number; y: number; width: number; height: number; clickX: number; clickY: number } | null = null;
  let pointerCleanupTimer: ReturnType<typeof setTimeout> | null = null;
  let pointerDownClickRecorded = false;
  let pointerDownDeferTimer: ReturnType<typeof setTimeout> | null = null;

  // Walk up DOM to find nearest interactive ancestor for better selectors.
  // e.g. clicking <span> inside <div role="option"> should capture the option.
  function findBestTarget(el: HTMLElement): HTMLElement {
    const INTERACTIVE = new Set([
      'button', 'option', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
      'tab', 'treeitem', 'link', 'switch', 'radio', 'checkbox',
      'combobox', 'listitem'
    ]);
    const INTERACTIVE_TAGS = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'LI']);
    let current: HTMLElement | null = el;
    while (current && current !== document.body && current !== document.documentElement) {
      const role = current.getAttribute('role');
      if (role && INTERACTIVE.has(role)) return current;
      if (INTERACTIVE_TAGS.has(current.tagName)) return current;
      if (current.dataset.testid) return current;
      if (current.hasAttribute('tabindex') || (current.getAttribute('aria-label') && current !== el)) return current;
      current = current.parentElement;
    }
    return el; // no interactive ancestor found, use original
  }

  document.addEventListener('pointerdown', (e: PointerEvent) => {
    if (pointerCleanupTimer) { clearTimeout(pointerCleanupTimer); pointerCleanupTimer = null; }
    if (pointerDownDeferTimer) { clearTimeout(pointerDownDeferTimer); pointerDownDeferTimer = null; }
    const rawTarget = e.target as HTMLElement;
    const target = findBestTarget(rawTarget);
    pointerDownSelectors = generateAllSelectors(target);
    const rect = target.getBoundingClientRect();
    pointerDownBoundingBox = { x: rect.x, y: rect.y, width: rect.width, height: rect.height, clickX: e.clientX, clickY: e.clientY };
    pointerDownClickRecorded = false;

    // Safety net: if the element is removed from DOM and no click event fires
    // (Radix Select handles selection on pointerup and unmounts before click),
    // record the action directly from pointerdown data.
    const savedSelectors = pointerDownSelectors;
    const savedBoundingBox = pointerDownBoundingBox;
    if (savedSelectors && savedSelectors.length > 0) {
      pointerDownDeferTimer = setTimeout(() => {
        if (!pointerDownClickRecorded && !document.contains(target) && savedSelectors.length > 0) {
          const modifiers = getActiveModifiers();
          // @ts-expect-error - exposed function
          window.__recordAction?.('click', savedSelectors, undefined, savedBoundingBox, generateActionId(), modifiers);
        }
        pointerDownDeferTimer = null;
      }, 300);
    }
  }, true);

  document.addEventListener('pointerup', () => {
    pointerCleanupTimer = setTimeout(() => { pointerDownSelectors = null; pointerDownBoundingBox = null; pointerCleanupTimer = null; }, 500);
  }, true);

  // Capture mouseover selectors as second fallback (fires well before click)
  let hoverSelectors: BrowserActionSelector[] | null = null;
  let hoverBoundingBox: { x: number; y: number; width: number; height: number; clickX: number; clickY: number } | null = null;
  document.addEventListener('mouseover', (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target || target === document.body || target === document.documentElement) return;
    const sels = generateAllSelectors(target);
    if (sels.length > 0) {
      hoverSelectors = sels;
      const rect = target.getBoundingClientRect();
      hoverBoundingBox = { x: rect.x, y: rect.y, width: rect.width, height: rect.height, clickX: e.clientX, clickY: e.clientY };
    }
  }, true);

  document.addEventListener('click', (e) => {
    pointerDownClickRecorded = true; // Prevent deferred pointerdown from double-recording
    if (mouseDownState) {
      const dx = Math.abs(e.clientX - mouseDownState.x);
      const dy = Math.abs(e.clientY - mouseDownState.y);
      const distance = Math.sqrt(dx * dx + dy * dy);
      const duration = Date.now() - mouseDownState.time;
      if (distance > DRAG_THRESHOLD_PX || (duration > DRAG_THRESHOLD_MS && distance > 3)) {
        return;
      }
    }
    if (pg) return;
    const target = e.target as HTMLElement;
    let selectors = generateAllSelectors(target);
    const rect = target.getBoundingClientRect();
    let boundingBox: { x: number; y: number; width: number; height: number; clickX?: number; clickY?: number } = { x: rect.x, y: rect.y, width: rect.width, height: rect.height, clickX: e.clientX, clickY: e.clientY };

    // Check if click-generated selectors are useful (not just body/html css-path)
    const hasUsefulSelectors = selectors.length > 0 &&
      !(selectors.length === 1 && selectors[0].type === 'css-path' &&
        (selectors[0].value === 'body' || selectors[0].value === 'html'));

    // Fallback 1: use pointerdown selectors (captured before DOM removal)
    if (!hasUsefulSelectors && pointerDownSelectors && pointerDownSelectors.length > 0) {
      selectors = pointerDownSelectors;
      if (pointerDownBoundingBox) {
        boundingBox = pointerDownBoundingBox;
      }
    }

    // Fallback 2: use mouseover/hover selectors (last element hovered before click)
    const stillNoSelectors = selectors.length === 0 ||
      (selectors.length === 1 && selectors[0].type === 'css-path' &&
        (selectors[0].value === 'body' || selectors[0].value === 'html'));
    if (stillNoSelectors && hoverSelectors && hoverSelectors.length > 0) {
      selectors = hoverSelectors;
      if (hoverBoundingBox) {
        boundingBox = hoverBoundingBox;
      }
    }

    const modifiers = getActiveModifiers();
    // @ts-expect-error - exposed function
    window.__recordAction?.('click', selectors, undefined, boundingBox, generateActionId(), modifiers);
  }, true);

  document.addEventListener('input', (e) => {
    const target = e.target as HTMLInputElement;
    const inputType = target.type?.toLowerCase();
    if (inputType === 'radio' || inputType === 'checkbox' || inputType === 'submit' || inputType === 'button' || inputType === 'reset' || inputType === 'file') {
      return;
    }
    const selectors = generateAllSelectors(target);
    const rect = target.getBoundingClientRect();
    const boundingBox = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    // @ts-expect-error - exposed function
    window.__recordAction?.('fill', selectors, target.value, boundingBox, generateActionId());
  }, true);

  document.addEventListener('change', (e) => {
    const target = e.target as HTMLSelectElement;
    if (target.tagName === 'SELECT') {
      const selectors = generateAllSelectors(target);
      // @ts-expect-error - exposed function
      window.__recordAction?.('selectOption', selectors, target.value, undefined, generateActionId());
    }
  }, true);

  // Wheel/scroll tracking with debounce and modifier capture
  let scrollAccumX = 0;
  let scrollAccumY = 0;
  let scrollModifiers: string[] = [];
  let scrollFlushTimer: ReturnType<typeof setTimeout> | null = null;
  const SCROLL_DEBOUNCE_MS = 100;
  document.addEventListener('wheel', (e: WheelEvent) => {
    scrollAccumX += e.deltaX;
    scrollAccumY += e.deltaY;
    if (!scrollFlushTimer) {
      const eventMods: string[] = [];
      if (e.ctrlKey) eventMods.push('Control');
      if (e.shiftKey) eventMods.push('Shift');
      if (e.altKey) eventMods.push('Alt');
      if (e.metaKey) eventMods.push('Meta');
      scrollModifiers = eventMods;
    }
    if (scrollFlushTimer) clearTimeout(scrollFlushTimer);
    scrollFlushTimer = setTimeout(() => {
      if (scrollAccumX !== 0 || scrollAccumY !== 0) {
        // @ts-expect-error - exposed function
        window.__recordScroll?.(Math.round(scrollAccumX), Math.round(scrollAccumY), scrollModifiers.length > 0 ? scrollModifiers : undefined);
        scrollAccumX = 0;
        scrollAccumY = 0;
        scrollModifiers = [];
      }
      scrollFlushTimer = null;
    }, SCROLL_DEBOUNCE_MS);
  }, { passive: true, capture: true });

  // Detect dynamic IDs (react-select-23-input, mui-7, :r1a:, select_99, etc.)
  const DYNAMIC_ID_PATTERNS = [
    /^react-select-\d+-/,
    /^headlessui-\w+-\d+$/,
    /^mui-\d+$/,
    /^:r[a-z0-9]+:$/,
    /^radix-/,
    /^ember\d+$/,
    /^[a-z]+[-_]\d{2,}$/i,
    /[a-f0-9]{8,}/,
    /\d{4,}/,
  ];
  function isProbablyDynamicId(id: string): boolean {
    if (id.includes('undefined')) return true;
    return DYNAMIC_ID_PATTERNS.some(p => p.test(id));
  }

  function generateAllSelectors(element: HTMLElement): BrowserActionSelector[] {
    const allSelectors: Map<string, string> = new Map();

    // data-testid
    if (element.dataset.testid) {
      allSelectors.set('data-testid', `[data-testid="${element.dataset.testid}"]`);
    }

    // ID — skip dynamic IDs (react-select-23-input, etc.)
    if (element.id && !isProbablyDynamicId(element.id)) {
      allSelectors.set('id', `#${element.id}`);
    }

    // Label (associated <label> element — most robust for form fields)
    const labelText = (
      (element.id ? document.querySelector(`label[for="${element.id}"]`)?.textContent?.trim() : null) ||
      element.closest('label')?.textContent?.trim() ||
      (element.getAttribute('aria-labelledby')
        ? document.getElementById(element.getAttribute('aria-labelledby')!)?.textContent?.trim()
        : null)
    )?.slice(0, 50) || null;
    if (labelText) {
      allSelectors.set('label', `label="${labelText}"`);
    }

    // Role + name (ARIA) — use label text as fallback for accessible name
    const role = element.getAttribute('role') || getImplicitRole(element);
    const accessibleName = element.getAttribute('aria-label') ||
      element.getAttribute('title') ||
      labelText ||
      element.textContent?.trim().slice(0, 30);
    if (role && accessibleName) {
      allSelectors.set('role-name', `role=${role}[name="${accessibleName}"]`);
    }

    // Heading context — for icon-only buttons/elements near headings
    // Generates Playwright selectors like: h4:has-text("Okmányok") button
    if (!element.textContent?.trim() || element.querySelector('svg')) {
      const interactiveTag = element.closest('button, a, [role="button"]');
      const target = interactiveTag || element;
      const heading = target.closest('h1, h2, h3, h4, h5, h6') ||
        target.parentElement?.closest('h1, h2, h3, h4, h5, h6');
      if (heading) {
        const headingClone = heading.cloneNode(true) as HTMLElement;
        headingClone.querySelectorAll('button, svg, [role="button"]').forEach(el => el.remove());
        const headingText = headingClone.textContent?.trim().slice(0, 50);
        if (headingText && headingText.length > 1) {
          const hTag = heading.tagName.toLowerCase();
          const targetTag = target.tagName.toLowerCase();
          allSelectors.set('heading-context', `${hTag}:has-text("${headingText}") ${targetTag}`);
        }
      }
    }

    // aria-label
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) {
      allSelectors.set('aria-label', `[aria-label="${ariaLabel}"]`);
    }

    // Text content (for interactive elements)
    const INTERACTIVE_ROLES = new Set([
      'button', 'option', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
      'tab', 'treeitem', 'link', 'switch', 'radio', 'checkbox',
      'combobox', 'listitem'
    ]);
    const elRole = element.getAttribute('role');
    if (element.tagName === 'BUTTON' || element.tagName === 'A' ||
        element.tagName === 'LI' || element.tagName === 'LABEL' ||
        (elRole && INTERACTIVE_ROLES.has(elRole))) {
      const text = element.textContent?.trim().slice(0, 30);
      if (text) {
        allSelectors.set('text', `text="${text}"`);
      }
    }

    // Leaf element fallback: text for elements with no children
    if (!allSelectors.has('text') && element.children.length === 0) {
      const leafText = element.textContent?.trim().slice(0, 30);
      if (leafText && leafText.length > 0) {
        allSelectors.set('text', `text="${leafText}"`);
      }
    }

    // Placeholder
    const placeholder = element.getAttribute('placeholder');
    if (placeholder) {
      allSelectors.set('placeholder', `[placeholder="${placeholder}"]`);
    }

    // Name attribute (skip dynamic names like select_99)
    const name = element.getAttribute('name');
    if (name && !isProbablyDynamicId(name)) {
      allSelectors.set('name', `[name="${name}"]`);
    }

    // CSS path fallback
    const cssPath = generateCssPath(element);
    if (cssPath) {
      allSelectors.set('css-path', cssPath);
    }

    // Filter by enabled selectors and sort by priority
    const enabledConfigs = (priority as BrowserSelectorConfig[])
      .filter(config => config.enabled && config.type !== 'ocr-text')
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

  function generateCssPath(element: HTMLElement): string {
    const path: string[] = [];
    let current: HTMLElement | null = element;
    while (current && current !== document.body) {
      let selector = current.tagName.toLowerCase();
      const classAttr = current.getAttribute('class');
      if (classAttr) {
        const classes = classAttr.split(' ')
          .filter(c => c && !c.includes(':') && !c.startsWith('_'))
          .slice(0, 2)
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

  // Cursor move tracking
  if (pg) {
    const interval = Math.round(1000 / fps);
    let lastTime = 0;
    document.addEventListener('mousemove', (e: MouseEvent) => {
      const now = Date.now();
      if (now - lastTime >= interval) {
        lastTime = now;
        // @ts-expect-error - exposed function
        window.__recordCursorMove?.(e.clientX, e.clientY);
      }
    }, true);

    document.addEventListener('mousedown', (e: MouseEvent) => {
      // Skip right-click — contextmenu handler records it as 'rightclick' action
      if (e.button === 2) return;
      const modifiers = getActiveModifiers();
      // @ts-expect-error - exposed function
      window.__recordMouseEvent?.('down', e.clientX, e.clientY, e.button, modifiers);
    }, true);

    document.addEventListener('mouseup', (e: MouseEvent) => {
      if (e.button === 2) return;
      const modifiers = getActiveModifiers();
      // @ts-expect-error - exposed function
      window.__recordMouseEvent?.('up', e.clientX, e.clientY, e.button, modifiers);
    }, true);
  }

  // Hover preview tracking
  let lastHoverTime = 0;
  document.addEventListener('mouseover', (e: MouseEvent) => {
    const now = Date.now();
    if (now - lastHoverTime < 200) return;
    lastHoverTime = now;
    const target = e.target as HTMLElement;
    if (!target || target === document.body || target === document.documentElement) return;

    let potentialAction: 'click' | 'fill' | 'select' | undefined;
    const tagName = target.tagName.toUpperCase();
    if (tagName === 'INPUT' || tagName === 'TEXTAREA') {
      potentialAction = 'fill';
    } else if (tagName === 'SELECT') {
      potentialAction = 'select';
    } else if (tagName === 'BUTTON' || tagName === 'A' || target.getAttribute('role') === 'button' || target.onclick) {
      potentialAction = 'click';
    } else {
      potentialAction = 'click';
    }

    const selectors = generateAllSelectors(target);
    const primarySelector = selectors[0]?.value || '';

    // @ts-expect-error - exposed function
    window.__recordHoverPreview?.({
      tagName: target.tagName.toLowerCase(),
      id: target.id || undefined,
      textContent: target.textContent?.trim().slice(0, 30) || undefined,
      potentialAction,
      potentialSelector: primarySelector,
      selectors,
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
    if (element.textContent?.trim()) {
      options.push({ type: 'toHaveText', label: 'Assert text equals', needsValue: true });
      options.push({ type: 'toContainText', label: 'Assert text contains', needsValue: true });
    }
    if (tagName === 'INPUT' || tagName === 'TEXTAREA') {
      options.push({ type: 'toHaveValue', label: 'Assert value equals', needsValue: true });
      options.push({ type: 'toBeEnabled', label: 'Assert enabled' });
      options.push({ type: 'toBeDisabled', label: 'Assert disabled' });
    }
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
    menu.style.cssText = `position:fixed;z-index:2147483647;background:#1f2937;border:1px solid #374151;border-radius:6px;padding:4px 0;min-width:180px;box-shadow:0 10px 25px rgba(0,0,0,0.3);font-family:system-ui,-apple-system,sans-serif;font-size:13px;color:#e5e7eb;`;
    const header = document.createElement('div');
    header.style.cssText = `padding:6px 12px;border-bottom:1px solid #374151;font-size:11px;color:#9ca3af;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
    const tagDisplay = element.tagName.toLowerCase();
    const idDisplay = element.id ? `#${element.id}` : '';
    header.textContent = `<${tagDisplay}>${idDisplay}`;
    menu.appendChild(header);
    for (const opt of options) {
      const item = document.createElement('div');
      item.style.cssText = `padding:6px 12px;cursor:pointer;transition:background 0.1s;`;
      item.textContent = opt.label;
      item.addEventListener('mouseenter', () => { item.style.background = '#374151'; });
      item.addEventListener('mouseleave', () => { item.style.background = 'transparent'; });
      item.addEventListener('click', (e) => { e.stopPropagation(); handleAssertionSelection(opt, element); });
      menu.appendChild(item);
    }
    let finalX = x;
    let finalY = y;
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    if (finalX + rect.width > window.innerWidth) finalX = window.innerWidth - rect.width - 10;
    if (finalY + rect.height > window.innerHeight) finalY = window.innerHeight - rect.height - 10;
    menu.style.left = `${finalX}px`;
    menu.style.top = `${finalY}px`;
    assertionMenuElement = menu;
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
    if (e.key === 'Escape') hideAssertionMenu();
  }

  function handleAssertionSelection(opt: AssertionOption, element: HTMLElement): void {
    const selectors = generateAllSelectors(element);
    let expectedValue: string | undefined;
    let attributeName: string | undefined;
    let attributeValue: string | undefined;
    if (opt.needsAttribute) {
      const promptResult = prompt('Enter attribute name (e.g., "href", "class"):');
      if (!promptResult) { hideAssertionMenu(); return; }
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
    // @ts-expect-error - exposed function
    window.__recordElementAssertion?.({ type: opt.type, selectors, expectedValue, attributeName, attributeValue });
    hideAssertionMenu();
  }

  document.addEventListener('contextmenu', (e) => {
    const rawTarget = e.target as HTMLElement;
    if (!rawTarget || rawTarget === document.body || rawTarget === document.documentElement) return;

    // Shift+right-click opens the assertion menu instead of recording a right-click
    if (e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      showAssertionMenu(e.clientX, e.clientY, rawTarget);
      return;
    }

    // Record a plain right-click action — do NOT preventDefault so the app's
    // own context menu (e.g. Excalidraw) still fires. Mirror the left-click handler's
    // selector-resolution logic so Radix/unmounted targets still get useful selectors.
    const target = findBestTarget(rawTarget);
    let selectors = generateAllSelectors(target);
    const rect = target.getBoundingClientRect();
    let boundingBox: { x: number; y: number; width: number; height: number; clickX?: number; clickY?: number } =
      { x: rect.x, y: rect.y, width: rect.width, height: rect.height, clickX: e.clientX, clickY: e.clientY };

    const hasUsefulSelectors = selectors.length > 0 &&
      !(selectors.length === 1 && selectors[0].type === 'css-path' &&
        (selectors[0].value === 'body' || selectors[0].value === 'html'));

    if (!hasUsefulSelectors && pointerDownSelectors && pointerDownSelectors.length > 0) {
      selectors = pointerDownSelectors;
      if (pointerDownBoundingBox) boundingBox = pointerDownBoundingBox;
    }

    const stillNoSelectors = selectors.length === 0 ||
      (selectors.length === 1 && selectors[0].type === 'css-path' &&
        (selectors[0].value === 'body' || selectors[0].value === 'html'));
    if (stillNoSelectors && hoverSelectors && hoverSelectors.length > 0) {
      selectors = hoverSelectors;
      if (hoverBoundingBox) boundingBox = hoverBoundingBox;
    }

    const modifiers = getActiveModifiers();
    // @ts-expect-error - exposed function
    window.__recordAction?.('rightclick', selectors, undefined, boundingBox, generateActionId(), modifiers);
  }, true);

  // DOM verification system
  interface PendingVerification {
    actionId: string;
    selectors: BrowserActionSelector[];
    verified: boolean;
  }
  const pendingVerifications: PendingVerification[] = [];

  const originalRecordAction = (window as any).__recordAction;
  if (originalRecordAction) {
    (window as any).__recordAction = (action: string, selectors: BrowserActionSelector[], value?: string, boundingBox?: { x: number; y: number; width: number; height: number }, actionId?: string) => {
      originalRecordAction(action, selectors, value, boundingBox, actionId);
      if (!actionId) return;
      const validSelectors = selectors.filter(sel => sel.value && sel.value.trim() && !sel.value.includes('undefined'));
      if (validSelectors.length > 0) {
        pendingVerifications.push({ actionId, selectors: validSelectors, verified: false });
        if (pendingVerifications.length > 50) pendingVerifications.shift();
      }
    };
  }

  setInterval(() => {
    for (const pending of pendingVerifications) {
      if (pending.verified) continue;
      const found = pending.selectors.some(sel => {
        try {
          if (sel.type === 'role-name' || sel.type === 'text' || sel.type === 'ocr-text') return true;
          return document.querySelector(sel.value) !== null;
        } catch { return false; }
      });
      if (found) {
        pending.verified = true;
        // @ts-expect-error - exposed function
        window.__updateVerification?.(pending.actionId, true);
      }
    }
  }, 1000);
};
