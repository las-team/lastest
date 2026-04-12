/**
 * Shared selector extraction logic.
 *
 * Provides a serializable function body that can be injected into any page via
 * `page.evaluate()` to extract selectors from DOM elements — without requiring
 * the full recording script to be injected first.
 *
 * Used by:
 * - inspect element (point-and-click on live stream)
 * - DOM snapshot (download all selectors)
 */

export interface InspectElementResult {
  tag: string;
  id?: string;
  textContent?: string;
  boundingBox: { x: number; y: number; width: number; height: number };
  selectors: Array<{ type: string; value: string }>;
}

export interface DomSnapshotResult {
  elements: InspectElementResult[];
  url: string;
  timestamp: number;
}

export type SelectorPriorityConfig = Array<{ type: string; enabled: boolean; priority: number }>;

/**
 * Evaluate in page context: returns all selectors for the element at (x, y).
 * Also injects a brief highlight overlay on the element.
 */
export async function inspectElementAtPoint(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page: { evaluate: (fn: any, arg?: any) => Promise<any>; url?: () => string },
  x: number,
  y: number,
  selectorPriority: SelectorPriorityConfig,
): Promise<InspectElementResult | null> {
  return page.evaluate(
    ([px, py, priorityArg]: [number, number, SelectorPriorityConfig]) => {
      const priority = priorityArg;

      // --- inline selector utils (must be self-contained for evaluate) ---

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
        return DYNAMIC_ID_PATTERNS.some((p) => p.test(id));
      }

      function getImplicitRole(element: HTMLElement): string | null {
        const tagRoles: Record<string, string> = {
          BUTTON: 'button',
          A: 'link',
          INPUT:
            element.getAttribute('type') === 'checkbox'
              ? 'checkbox'
              : element.getAttribute('type') === 'radio'
                ? 'radio'
                : element.getAttribute('type') === 'submit'
                  ? 'button'
                  : 'textbox',
          SELECT: 'combobox',
          TEXTAREA: 'textbox',
          IMG: 'img',
          NAV: 'navigation',
          MAIN: 'main',
          HEADER: 'banner',
          FOOTER: 'contentinfo',
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
            const classes = classAttr
              .split(' ')
              .filter((c) => c && !c.includes(':') && !c.startsWith('_'))
              .slice(0, 2)
              .map((c) => c.replace(/([[\]()#.>+~=|^$*!@])/g, '\\$1'));
            if (classes.length > 0) {
              selector += '.' + classes.join('.');
            }
          }
          path.unshift(selector);
          current = current.parentElement;
        }
        return path.slice(-3).join(' > ');
      }

      const INTERACTIVE_ROLES = new Set([
        'button', 'option', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
        'tab', 'treeitem', 'link', 'switch', 'radio', 'checkbox',
        'combobox', 'listitem',
      ]);

      const INTERACTIVE_TAGS = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'LI']);

      function findBestTarget(el: HTMLElement): HTMLElement {
        let current: HTMLElement | null = el;
        while (current && current !== document.body && current !== document.documentElement) {
          const role = current.getAttribute('role');
          if (role && INTERACTIVE_ROLES.has(role)) return current;
          if (INTERACTIVE_TAGS.has(current.tagName)) return current;
          if (current.dataset.testid) return current;
          if (current.hasAttribute('tabindex') || (current.getAttribute('aria-label') && current !== el)) return current;
          current = current.parentElement;
        }
        return el;
      }

      function generateAllSelectors(element: HTMLElement): Array<{ type: string; value: string }> {
        const allSelectors: Map<string, string> = new Map();

        if (element.dataset.testid) {
          allSelectors.set('data-testid', `[data-testid="${element.dataset.testid}"]`);
        }
        if (element.id && !isProbablyDynamicId(element.id)) {
          allSelectors.set('id', `#${element.id}`);
        }

        const labelText = (
          (element.id ? (document.querySelector(`label[for="${element.id}"]`) as HTMLElement)?.textContent?.trim() : null) ||
          (element.closest('label') as HTMLElement)?.textContent?.trim() ||
          (element.getAttribute('aria-labelledby')
            ? document.getElementById(element.getAttribute('aria-labelledby')!)?.textContent?.trim()
            : null)
        )?.slice(0, 50) || null;
        if (labelText) {
          allSelectors.set('label', `label="${labelText}"`);
        }

        const role = element.getAttribute('role') || getImplicitRole(element);
        const accessibleName =
          element.getAttribute('aria-label') ||
          element.getAttribute('title') ||
          labelText ||
          element.textContent?.trim().slice(0, 30);
        if (role && accessibleName) {
          allSelectors.set('role-name', `role=${role}[name="${accessibleName}"]`);
        }

        // Heading context
        if (!element.textContent?.trim() || element.querySelector('svg')) {
          const interactiveTag = element.closest('button, a, [role="button"]');
          const target = interactiveTag || element;
          const heading =
            target.closest('h1, h2, h3, h4, h5, h6') ||
            target.parentElement?.closest('h1, h2, h3, h4, h5, h6');
          if (heading) {
            const headingClone = heading.cloneNode(true) as HTMLElement;
            headingClone.querySelectorAll('button, svg, [role="button"]').forEach((el) => el.remove());
            const headingText = headingClone.textContent?.trim().slice(0, 50);
            if (headingText && headingText.length > 1) {
              const hTag = heading.tagName.toLowerCase();
              const targetTag = (target as HTMLElement).tagName.toLowerCase();
              allSelectors.set('heading-context', `${hTag}:has-text("${headingText}") ${targetTag}`);
            }
          }
        }

        const ariaLabel = element.getAttribute('aria-label');
        if (ariaLabel) {
          allSelectors.set('aria-label', `[aria-label="${ariaLabel}"]`);
        }

        const elRole = element.getAttribute('role');
        if (
          element.tagName === 'BUTTON' || element.tagName === 'A' ||
          element.tagName === 'LI' || element.tagName === 'LABEL' ||
          (elRole && INTERACTIVE_ROLES.has(elRole))
        ) {
          const text = element.textContent?.trim().slice(0, 30);
          if (text) {
            allSelectors.set('text', `text="${text}"`);
          }
        }

        if (!allSelectors.has('text') && element.children.length === 0) {
          const leafText = element.textContent?.trim().slice(0, 30);
          if (leafText && leafText.length > 0) {
            allSelectors.set('text', `text="${leafText}"`);
          }
        }

        const placeholder = element.getAttribute('placeholder');
        if (placeholder) {
          allSelectors.set('placeholder', `[placeholder="${placeholder}"]`);
        }

        const name = element.getAttribute('name');
        if (name && !isProbablyDynamicId(name)) {
          allSelectors.set('name', `[name="${name}"]`);
        }

        const cssPath = generateCssPath(element);
        if (cssPath) {
          allSelectors.set('css-path', cssPath);
        }

        // Filter + sort by priority config
        const enabledConfigs = (priority as Array<{ type: string; enabled: boolean; priority: number }>)
          .filter((config) => config.enabled && config.type !== 'ocr-text')
          .sort((a, b) => a.priority - b.priority);

        const selectors: Array<{ type: string; value: string }> = [];
        for (const config of enabledConfigs) {
          const value = allSelectors.get(config.type);
          if (value) {
            selectors.push({ type: config.type, value });
          }
        }

        // Also include any selectors NOT in the priority list (so user sees everything)
        for (const [type, value] of allSelectors) {
          if (!selectors.some((s) => s.type === type)) {
            selectors.push({ type, value });
          }
        }

        return selectors;
      }

      // --- actual inspection logic ---
      // Use the exact element at the cursor (no walking up to ancestors).
      // CDP Overlay handles hover highlighting natively.

      const el = document.elementFromPoint(px, py) as HTMLElement | null;
      if (!el || el === document.body || el === document.documentElement) return null;

      const selectors = generateAllSelectors(el);
      const rect = el.getBoundingClientRect();

      return {
        tag: el.tagName.toLowerCase(),
        id: el.id || undefined,
        textContent: el.textContent?.trim().slice(0, 100) || undefined,
        boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        selectors,
      };
    },
    [x, y, selectorPriority],
  ) as Promise<InspectElementResult | null>;
}

/**
 * Evaluate in page context: walk all interactive elements, return selectors for each.
 */
export async function getAllDomSelectors(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page: { evaluate: (fn: any, arg?: any) => Promise<any>; url?: () => string },
  selectorPriority: SelectorPriorityConfig,
): Promise<DomSnapshotResult> {
  const elements = (await page.evaluate(
    ([priorityArg]: [SelectorPriorityConfig]) => {
      const priority = priorityArg;

      // --- inline selector utils (duplicated — must be self-contained) ---

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
        return DYNAMIC_ID_PATTERNS.some((p) => p.test(id));
      }

      function getImplicitRole(element: HTMLElement): string | null {
        const tagRoles: Record<string, string> = {
          BUTTON: 'button',
          A: 'link',
          INPUT:
            element.getAttribute('type') === 'checkbox'
              ? 'checkbox'
              : element.getAttribute('type') === 'radio'
                ? 'radio'
                : element.getAttribute('type') === 'submit'
                  ? 'button'
                  : 'textbox',
          SELECT: 'combobox',
          TEXTAREA: 'textbox',
          IMG: 'img',
          NAV: 'navigation',
          MAIN: 'main',
          HEADER: 'banner',
          FOOTER: 'contentinfo',
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
            const classes = classAttr
              .split(' ')
              .filter((c) => c && !c.includes(':') && !c.startsWith('_'))
              .slice(0, 2)
              .map((c) => c.replace(/([[\]()#.>+~=|^$*!@])/g, '\\$1'));
            if (classes.length > 0) {
              selector += '.' + classes.join('.');
            }
          }
          path.unshift(selector);
          current = current.parentElement;
        }
        return path.slice(-3).join(' > ');
      }

      const INTERACTIVE_ROLES = new Set([
        'button', 'option', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
        'tab', 'treeitem', 'link', 'switch', 'radio', 'checkbox',
        'combobox', 'listitem',
      ]);

      function generateAllSelectors(element: HTMLElement): Array<{ type: string; value: string }> {
        const allSelectors: Map<string, string> = new Map();

        if (element.dataset.testid) {
          allSelectors.set('data-testid', `[data-testid="${element.dataset.testid}"]`);
        }
        if (element.id && !isProbablyDynamicId(element.id)) {
          allSelectors.set('id', `#${element.id}`);
        }

        const labelText = (
          (element.id ? (document.querySelector(`label[for="${element.id}"]`) as HTMLElement)?.textContent?.trim() : null) ||
          (element.closest('label') as HTMLElement)?.textContent?.trim() ||
          (element.getAttribute('aria-labelledby')
            ? document.getElementById(element.getAttribute('aria-labelledby')!)?.textContent?.trim()
            : null)
        )?.slice(0, 50) || null;
        if (labelText) {
          allSelectors.set('label', `label="${labelText}"`);
        }

        const role = element.getAttribute('role') || getImplicitRole(element);
        const accessibleName =
          element.getAttribute('aria-label') ||
          element.getAttribute('title') ||
          labelText ||
          element.textContent?.trim().slice(0, 30);
        if (role && accessibleName) {
          allSelectors.set('role-name', `role=${role}[name="${accessibleName}"]`);
        }

        if (!element.textContent?.trim() || element.querySelector('svg')) {
          const interactiveTag = element.closest('button, a, [role="button"]');
          const target = interactiveTag || element;
          const heading =
            target.closest('h1, h2, h3, h4, h5, h6') ||
            target.parentElement?.closest('h1, h2, h3, h4, h5, h6');
          if (heading) {
            const headingClone = heading.cloneNode(true) as HTMLElement;
            headingClone.querySelectorAll('button, svg, [role="button"]').forEach((el) => el.remove());
            const headingText = headingClone.textContent?.trim().slice(0, 50);
            if (headingText && headingText.length > 1) {
              const hTag = heading.tagName.toLowerCase();
              const targetTag = (target as HTMLElement).tagName.toLowerCase();
              allSelectors.set('heading-context', `${hTag}:has-text("${headingText}") ${targetTag}`);
            }
          }
        }

        const ariaLabel = element.getAttribute('aria-label');
        if (ariaLabel) {
          allSelectors.set('aria-label', `[aria-label="${ariaLabel}"]`);
        }

        const elRole = element.getAttribute('role');
        if (
          element.tagName === 'BUTTON' || element.tagName === 'A' ||
          element.tagName === 'LI' || element.tagName === 'LABEL' ||
          (elRole && INTERACTIVE_ROLES.has(elRole))
        ) {
          const text = element.textContent?.trim().slice(0, 30);
          if (text) {
            allSelectors.set('text', `text="${text}"`);
          }
        }

        if (!allSelectors.has('text') && element.children.length === 0) {
          const leafText = element.textContent?.trim().slice(0, 30);
          if (leafText && leafText.length > 0) {
            allSelectors.set('text', `text="${leafText}"`);
          }
        }

        const placeholder = element.getAttribute('placeholder');
        if (placeholder) {
          allSelectors.set('placeholder', `[placeholder="${placeholder}"]`);
        }

        const name = element.getAttribute('name');
        if (name && !isProbablyDynamicId(name)) {
          allSelectors.set('name', `[name="${name}"]`);
        }

        const cssPath = generateCssPath(element);
        if (cssPath) {
          allSelectors.set('css-path', cssPath);
        }

        const enabledConfigs = (priority as Array<{ type: string; enabled: boolean; priority: number }>)
          .filter((config) => config.enabled && config.type !== 'ocr-text')
          .sort((a, b) => a.priority - b.priority);

        const selectors: Array<{ type: string; value: string }> = [];
        for (const config of enabledConfigs) {
          const value = allSelectors.get(config.type);
          if (value) {
            selectors.push({ type: config.type, value });
          }
        }

        for (const [type, value] of allSelectors) {
          if (!selectors.some((s) => s.type === type)) {
            selectors.push({ type, value });
          }
        }

        return selectors;
      }

      // --- walk all interactive elements ---

      const SELECTOR = 'a, button, input, select, textarea, [role], [data-testid], [tabindex], [aria-label], label, li, [onclick]';
      const nodeList = document.querySelectorAll(SELECTOR);
      const seen = new Set<HTMLElement>();
      const results: Array<{
        tag: string;
        id?: string;
        textContent?: string;
        boundingBox: { x: number; y: number; width: number; height: number };
        selectors: Array<{ type: string; value: string }>;
      }> = [];

      const MAX_ELEMENTS = 5000;
      let count = 0;

      for (const node of nodeList) {
        if (count >= MAX_ELEMENTS) break;
        const el = node as HTMLElement;
        if (seen.has(el)) continue;
        seen.add(el);

        const rect = el.getBoundingClientRect();
        // Skip zero-size or off-screen elements
        if (rect.width === 0 && rect.height === 0) continue;

        const selectors = generateAllSelectors(el);
        if (selectors.length === 0) continue;

        results.push({
          tag: el.tagName.toLowerCase(),
          id: el.id || undefined,
          textContent: el.textContent?.trim().slice(0, 100) || undefined,
          boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          selectors,
        });
        count++;
      }

      return results;
    },
    [selectorPriority],
  )) as InspectElementResult[];

  return {
    elements: elements || [],
    url: typeof page.url === 'function' ? page.url() : '',
    timestamp: Date.now(),
  };
}
