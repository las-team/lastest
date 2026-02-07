import type { Page } from 'playwright';
import type { StabilizationSettings } from '@/lib/db/schema';

/**
 * Apply dynamic content masking to the page before taking a screenshot.
 * Walks DOM text nodes and masks content matching configured patterns.
 * Idempotent via data-lastest-masked attribute.
 */
export async function applyDynamicMasking(
  page: Page,
  settings: Pick<StabilizationSettings, 'maskPatterns' | 'maskStyle' | 'maskColor'>
): Promise<void> {
  const { maskPatterns, maskStyle, maskColor } = settings;

  await page.evaluate(
    ({ patterns, style, color }) => {
      // Build regex patterns based on selected pattern types
      const regexes: RegExp[] = [];

      if (patterns.includes('timestamps')) {
        // ISO 8601: 2024-01-15T12:30:00Z, 2024-01-15T12:30:00.000Z
        regexes.push(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})/g);
        // MM/DD/YYYY or DD/MM/YYYY
        regexes.push(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g);
        // HH:MM:SS or HH:MM
        regexes.push(/\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?\b/g);
        // Month DD, YYYY (e.g., "January 15, 2024")
        regexes.push(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4}\b/g);
      }

      if (patterns.includes('relative-times')) {
        regexes.push(/\b(?:just now|a? ?(?:few|couple)?\s*(?:second|minute|hour|day|week|month|year)s?\s+ago|yesterday|today|tomorrow)\b/gi);
        regexes.push(/\b\d+\s*(?:second|minute|hour|day|week|month|year)s?\s+ago\b/gi);
      }

      if (patterns.includes('uuids')) {
        regexes.push(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi);
      }

      if (patterns.includes('session-ids')) {
        // Long hex strings (16+ chars) or base64-like tokens
        regexes.push(/\b[0-9a-f]{16,}\b/gi);
        regexes.push(/\b[A-Za-z0-9+/]{20,}={0,2}\b/g);
      }

      if (regexes.length === 0) return;

      // Walk all text nodes in the document
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        null
      );

      const nodesToMask: { node: Text; parent: HTMLElement }[] = [];

      let textNode: Text | null;
      while ((textNode = walker.nextNode() as Text | null)) {
        const parent = textNode.parentElement as HTMLElement | null;
        if (!parent) continue;

        // Skip already-masked elements
        if (parent.hasAttribute('data-lastest-masked')) continue;

        // Skip script/style elements
        const tag = parent.tagName.toLowerCase();
        if (tag === 'script' || tag === 'style' || tag === 'noscript') continue;

        const text = textNode.textContent || '';
        const hasMatch = regexes.some(re => {
          re.lastIndex = 0;
          return re.test(text);
        });

        if (hasMatch) {
          nodesToMask.push({ node: textNode, parent });
        }
      }

      // Apply masks
      for (const { node, parent } of nodesToMask) {
        parent.setAttribute('data-lastest-masked', 'true');

        if (style === 'solid-color') {
          // Overlay the parent element with a solid color
          const rect = parent.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            parent.style.position = parent.style.position || 'relative';
            const overlay = document.createElement('div');
            overlay.setAttribute('data-lastest-masked', 'overlay');
            overlay.style.cssText = `
              position: absolute;
              top: 0;
              left: 0;
              width: 100%;
              height: 100%;
              background: ${color};
              z-index: 999999;
              pointer-events: none;
            `;
            parent.appendChild(overlay);
          }
        } else {
          // Replace text with placeholder
          let replacedText = node.textContent || '';
          for (const re of regexes) {
            re.lastIndex = 0;
            replacedText = replacedText.replace(re, '[MASKED]');
          }
          node.textContent = replacedText;
        }
      }
    },
    { patterns: maskPatterns, style: maskStyle, color: maskColor }
  );
}
