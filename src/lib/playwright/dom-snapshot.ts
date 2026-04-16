/**
 * DOM Snapshot Capture — extracts interactive element metadata from a live page.
 *
 * Captures element tag, id, text, bounding box, and multi-strategy selectors.
 * Used during recording (baseline) and test execution (current) to enable
 * DOM-level diffing for AI fixing and visual diff overlay.
 *
 * The page.evaluate() payload is self-contained (no external imports) so it
 * works with both local Playwright pages and remote runners.
 */

import type { Page } from 'playwright';
import type { DomSnapshotData, DomSnapshotElement } from '@/lib/db/schema';

export type { DomSnapshotData, DomSnapshotElement };

/**
 * Capture a DOM snapshot from a live Playwright page.
 * Returns interactive element metadata (not full HTML) — typically 10-50KB.
 */
export async function captureDomSnapshot(page: Page): Promise<DomSnapshotData> {
  let url = '';
  try {
    url = page.url();
  } catch {
    // page may be closed
  }

  const elements = await page.evaluate(() => {
    // --- Dynamic ID detection (self-contained) ---
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

    function getImplicitRole(element: HTMLElement): string | null {
      const tagRoles: Record<string, string> = {
        BUTTON: 'button',
        A: 'link',
        INPUT:
          element.getAttribute('type') === 'checkbox' ? 'checkbox'
            : element.getAttribute('type') === 'radio' ? 'radio'
            : element.getAttribute('type') === 'submit' ? 'button'
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
      const parts: string[] = [];
      let current: HTMLElement | null = element;
      while (current && current !== document.body) {
        let selector = current.tagName.toLowerCase();
        const classAttr = current.getAttribute('class');
        if (classAttr) {
          const classes = classAttr
            .split(' ')
            .filter(c => c && !c.includes(':') && !c.startsWith('_'))
            .slice(0, 2)
            .map(c => c.replace(/([[\]()#.>+~=|^$*!@])/g, '\\$1'));
          if (classes.length > 0) {
            selector += '.' + classes.join('.');
          }
        }
        parts.unshift(selector);
        current = current.parentElement;
      }
      return parts.slice(-3).join(' > ');
    }

    const INTERACTIVE_ROLES = new Set([
      'button', 'option', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
      'tab', 'treeitem', 'link', 'switch', 'radio', 'checkbox',
      'combobox', 'listitem',
    ]);

    function generateAllSelectors(element: HTMLElement): Array<{ type: string; value: string }> {
      const allSelectors = new Map<string, string>();

      if (element.dataset.testid) {
        allSelectors.set('data-testid', `[data-testid="${element.dataset.testid}"]`);
      }
      if (element.id && !isProbablyDynamicId(element.id)) {
        allSelectors.set('id', `#${element.id}`);
      }

      const labelText = (
        (element.id ? (document.querySelector(`label[for="${CSS.escape(element.id)}"]`) as HTMLElement)?.textContent?.trim() : null) ||
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

      // Return in priority order: data-testid, id, label, role-name, aria-label, text, placeholder, name, css-path
      const PRIORITY_ORDER = ['data-testid', 'id', 'label', 'role-name', 'aria-label', 'text', 'placeholder', 'name', 'css-path'];
      const selectors: Array<{ type: string; value: string }> = [];
      for (const type of PRIORITY_ORDER) {
        const value = allSelectors.get(type);
        if (value) selectors.push({ type, value });
      }
      // Add any remaining selectors not in priority order
      for (const [type, value] of allSelectors) {
        if (!selectors.some(s => s.type === type)) {
          selectors.push({ type, value });
        }
      }
      return selectors;
    }

    // --- Walk all interactive elements ---
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
  }).catch(() => [] as DomSnapshotElement[]);

  return {
    elements: elements as DomSnapshotElement[],
    url,
    timestamp: Date.now(),
  };
}
