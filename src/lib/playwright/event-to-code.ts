/**
 * Shared event-to-code-line conversion.
 * Used by both generateCodeFromRemoteEvents (recording.ts) and
 * generateBodyLinesFromEvents (debug-recorder.ts).
 */

export interface CodeGenEvent {
  type: string;
  timestamp: number;
  data: {
    action?: string;
    selector?: string;
    selectors?: Array<{ type: string; value: string }>;
    value?: string;
    url?: string;
    relativePath?: string;
    coordinates?: { x: number; y: number };
    button?: number;
    modifiers?: string[];
    key?: string;
    assertionType?: string;
    elementAssertion?: {
      type: string;
      selectors: Array<{ type: string; value: string }>;
      expectedValue?: string;
      attributeName?: string;
      attributeValue?: string;
    };
    deltaX?: number;
    deltaY?: number;
    downloadWrap?: boolean;
    autoDetected?: boolean;
    downloadFilename?: string;
  };
}

/**
 * Convert a list of recording events into code lines.
 * Each line is indented with `indent` (default 2 spaces).
 * Does NOT include function wrapper, imports, or helper declarations.
 */
export function eventsToCodeLines(
  events: CodeGenEvent[],
  baseOrigin: string,
  coordsEnabled: boolean,
  options?: { indent?: string; includeCursorReplay?: boolean }
): string[] {
  const indent = options?.indent ?? '  ';
  const includeCursorReplay = options?.includeCursorReplay ?? true;
  const lines: string[] = [];

  // Pre-process: deduplicate consecutive fill actions on the same element
  const deduped: CodeGenEvent[] = [];
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (event.type === 'action' && event.data.action === 'fill') {
      let j = i + 1;
      let skip = false;
      while (j < events.length) {
        const next = events[j];
        if (next.type === 'insert-timestamp') { skip = true; break; }
        if (next.type === 'action') {
          if (next.data.action === 'fill' && next.data.selector === event.data.selector) { skip = true; }
          break;
        }
        j++;
      }
      if (skip) continue;
    }
    deduped.push(event);
  }
  events = deduped;

  function getRelativePath(url: string): string {
    if (url.startsWith(baseOrigin)) {
      return url.slice(baseOrigin.length) || '/';
    }
    return url;
  }

  let lastAction = '';
  let lastEmittedEventType = '';
  let lastNavigatedPath = '';
  let cursorBatch: [number, number, number][] = [];
  let lastCursorTimestamp = 0;
  let lastCursorX = 640;
  let lastCursorY = 360;
  let nextClickIsDownload = false;
  let insideDownloadMouseWrap = false;

  const flushCursorBatch = () => {
    if (cursorBatch.length > 0 && includeCursorReplay) {
      const tuples = cursorBatch.map(t => `[${t[0]},${t[1]},${t[2]}]`).join(',');
      lines.push(`${indent}await replayCursorPath(page, [${tuples}]);`);
      cursorBatch = [];
    } else {
      cursorBatch = [];
    }
  };

  for (const event of events) {
    if (event.type === 'cursor-move' && event.data.coordinates) {
      const { x, y } = event.data.coordinates;
      const delay = lastCursorTimestamp > 0 ? event.timestamp - lastCursorTimestamp : 0;
      cursorBatch.push([x, y, delay]);
      lastCursorTimestamp = event.timestamp;
      lastCursorX = x;
      lastCursorY = y;
      continue;
    }

    flushCursorBatch();

    // Download marker: flag that the next click should be wrapped
    if (event.type === 'download') {
      nextClickIsDownload = true;
      continue;
    }

    if (event.type === 'navigation' && event.data.relativePath) {
      const relativePath = event.data.relativePath;
      if (relativePath === lastNavigatedPath && lastEmittedEventType === 'action') {
        // Skip duplicate navigation (revalidatePath refresh), just wait for mutation
        if (lastAction === 'click') {
          lines.push(`${indent}await page.waitForLoadState('networkidle').catch(() => {});`);
        }
      } else if (!lastAction.includes('goto')) {
        if (lastEmittedEventType === 'action' && lastAction === 'click') {
          lines.push(`${indent}await page.waitForLoadState('networkidle').catch(() => {});`);
        }
        lines.push(`${indent}await page.goto(buildUrl(baseUrl, '${relativePath}'));`);
        lines.push(`${indent}await page.waitForLoadState('networkidle').catch(() => {});`);
        lastNavigatedPath = relativePath;
      }
      lastAction = 'goto';
    } else if (event.type === 'action') {
      const { action, selector, selectors, value, coordinates, button, modifiers, downloadWrap } = event.data;

      // Skip LEFT click actions that follow mouse-up — pointer gestures already captured it
      // via mouse-down/up events, so the click action is a duplicate that can interfere.
      // Right-click is NOT skipped: pointer gesture handlers skip button=2, so the
      // contextmenu 'rightclick' action is the sole record and must always be emitted.
      if (action === 'click' && lastEmittedEventType === 'mouse-up') {
        continue;
      }

      const isRightClick = action === 'rightclick' || button === 2;
      const hasModifiers = modifiers && modifiers.length > 0;
      // Auto-detected downloads are handled by passive page.on('download') listener — no wrapping needed.
      // Only wrap if explicitly marked (not auto-detected) via nextClickIsDownload.
      const isDownloadClick = (action === 'click' || action === 'rightclick') && nextClickIsDownload;
      if (nextClickIsDownload && (action === 'click' || action === 'rightclick')) nextClickIsDownload = false;

      const clickOptParts: string[] = [];
      if (isRightClick) clickOptParts.push(`button: 'right'`);
      if (hasModifiers) clickOptParts.push(`modifiers: [${modifiers!.map(m => `'${m}'`).join(', ')}]`);
      const clickOptions = clickOptParts.length > 0 ? `{ ${clickOptParts.join(', ')} }` : 'null';

      // For download-wrapped clicks, collect lines in a buffer then wrap
      const clickLines: string[] = [];
      const target = isDownloadClick ? clickLines : lines;

      if (isDownloadClick) {
        lines.push(`${indent}// Wait for download triggered by click`);
        lines.push(`${indent}await downloads.waitForDownload(async () => {`);
      }
      const dIndent = isDownloadClick ? indent + '  ' : indent;

      if (selectors && selectors.length > 0) {
        const selectorsJson = JSON.stringify(selectors);
        const coordsArg = coordinates ? JSON.stringify(coordinates) : 'null';
        switch (action) {
          case 'click':
            target.push(`${dIndent}await locateWithFallback(page, ${selectorsJson}, 'click', null, ${coordsArg}${clickOptions !== 'null' ? `, ${clickOptions}` : ''});`);
            break;
          case 'rightclick':
            target.push(`${dIndent}await locateWithFallback(page, ${selectorsJson}, 'click', null, ${coordsArg}, ${clickOptions});`);
            break;
          case 'fill': {
            const escapedFillVal = (value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            target.push(`${dIndent}await locateWithFallback(page, ${selectorsJson}, 'fill', '${escapedFillVal}', ${coordsArg});`);
            break;
          }
          case 'selectOption': {
            const escapedOptVal = (value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            target.push(`${dIndent}await locateWithFallback(page, ${selectorsJson}, 'selectOption', '${escapedOptVal}', null);`);
            break;
          }
        }
      } else if (selector && selector.trim()) {
        switch (action) {
          case 'click':
            target.push(`${dIndent}await page.locator('${selector}').click(${clickOptions !== 'null' ? clickOptions : ''});`);
            break;
          case 'rightclick':
            target.push(`${dIndent}await page.locator('${selector}').click(${clickOptions});`);
            break;
          case 'fill': {
            const escapedFillVal = (value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            target.push(`${dIndent}await page.locator('${selector}').fill('${escapedFillVal}');`);
            break;
          }
          case 'selectOption': {
            const escapedOptVal = (value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            target.push(`${dIndent}await page.locator('${selector}').selectOption('${escapedOptVal}');`);
            break;
          }
        }
      } else if ((action === 'click' || action === 'rightclick') && coordinates) {
        target.push(`${dIndent}// Coordinate-only ${isRightClick ? 'right-' : ''}click (no selectors found)`);
        if (hasModifiers) {
          for (const mod of modifiers!) {
            target.push(`${dIndent}await page.keyboard.down('${mod}');`);
          }
        }
        target.push(`${dIndent}await page.mouse.click(${coordinates.x}, ${coordinates.y}${isRightClick ? `, { button: 'right' }` : ''});`);
        if (hasModifiers) {
          for (const mod of [...modifiers!].reverse()) {
            target.push(`${dIndent}await page.keyboard.up('${mod}');`);
          }
        }
      } else if (action === 'fill' && lastEmittedEventType === 'mouse-up') {
        // Text input already focused by previous click (e.g. canvas text editor) - just type
        const escapedValue = (value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        target.push(`${dIndent}await page.keyboard.type('${escapedValue}');`);
      } else if (action === 'fill' && coordinates) {
        const escapedValue = (value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        target.push(`${dIndent}// Coordinate-only fill (no selectors found) - click to focus then type`);
        target.push(`${dIndent}await page.mouse.click(${coordinates.x}, ${coordinates.y});`);
        target.push(`${dIndent}await page.waitForTimeout(100);`);
        target.push(`${dIndent}await page.keyboard.press('Control+a');`);
        target.push(`${dIndent}await page.keyboard.type('${escapedValue}');`);
      } else {
        target.push(`${dIndent}// Skipped ${action}: no valid selector or coordinates found`);
      }

      // Close download wrapper
      if (isDownloadClick) {
        lines.push(...clickLines);
        lines.push(`${indent}});`);
      }

      lastAction = action || '';
      lastEmittedEventType = 'action';
    } else if (event.type === 'screenshot') {
      lines.push(`${indent}await page.screenshot({ path: getScreenshotPath(), fullPage: true });`);
    } else if (event.type === 'assertion') {
      const { assertionType, url, elementAssertion } = event.data;

      if (elementAssertion) {
        const selectorsJson = JSON.stringify(elementAssertion.selectors);
        const assertType = elementAssertion.type;
        lines.push(`${indent}// Element assertion: ${assertType}`);
        lines.push(`${indent}{`);
        lines.push(`${indent}  const el = await locateWithFallback(page, ${selectorsJson}, 'locate', null, null);`);

        switch (assertType) {
          case 'toBeVisible': lines.push(`${indent}  await expect(el).toBeVisible();`); break;
          case 'toBeHidden': lines.push(`${indent}  await expect(el).toBeHidden();`); break;
          case 'toBeAttached': lines.push(`${indent}  await expect(el).toBeAttached();`); break;
          case 'toHaveAttribute':
            lines.push(`${indent}  await expect(el).toHaveAttribute('${elementAssertion.attributeName || ''}', '${elementAssertion.attributeValue || ''}');`);
            break;
          case 'toHaveText':
            lines.push(`${indent}  await expect(el).toHaveText('${(elementAssertion.expectedValue || '').replace(/'/g, "\\'")}');`);
            break;
          case 'toContainText':
            lines.push(`${indent}  await expect(el).toContainText('${(elementAssertion.expectedValue || '').replace(/'/g, "\\'")}');`);
            break;
          case 'toHaveValue':
            lines.push(`${indent}  await expect(el).toHaveValue('${(elementAssertion.expectedValue || '').replace(/'/g, "\\'")}');`);
            break;
          case 'toBeEnabled': lines.push(`${indent}  await expect(el).toBeEnabled();`); break;
          case 'toBeDisabled': lines.push(`${indent}  await expect(el).toBeDisabled();`); break;
          case 'toBeChecked': lines.push(`${indent}  await expect(el).toBeChecked();`); break;
        }
        lines.push(`${indent}}`);
      } else {
        switch (assertionType) {
          case 'pageLoad':
            lines.push(`${indent}// Assertion: Verify page has finished loading`);
            lines.push(`${indent}await page.waitForLoadState('load');`);
            break;
          case 'networkIdle':
            lines.push(`${indent}// Assertion: Verify no pending network requests`);
            lines.push(`${indent}await page.waitForLoadState('networkidle');`);
            break;
          case 'urlMatch': {
            lines.push(`${indent}// Assertion: Verify current URL matches expected`);
            const relativePath = getRelativePath(url || '');
            lines.push(`${indent}await expect(page).toHaveURL(buildUrl(baseUrl, '${relativePath}'));`);
            break;
          }
          case 'domContentLoaded':
            lines.push(`${indent}// Assertion: Verify DOM is ready`);
            lines.push(`${indent}await page.waitForLoadState('domcontentloaded');`);
            break;
          case 'downloadExists': {
            const dlName = event.data.downloadFilename;
            lines.push(`${indent}// Download assertion: ${dlName || 'fileDownloaded'}`);
            lines.push(`${indent}await downloads.waitForAny();`);
            lines.push(`${indent}expect(downloads.list().length).toBeGreaterThan(0);`);
            break;
          }
        }
      }
    } else if (event.type === 'mouse-down' && event.data.coordinates) {
      const { x, y } = event.data.coordinates;
      const modifiers = event.data.modifiers;
      const mouseButton = event.data.button;
      const buttonOpt = mouseButton === 2 ? `{ button: 'right' }` : '';
      // Auto-detected downloads handled by passive listener — only wrap explicit markers
      const isDownloadMouse = nextClickIsDownload;
      if (nextClickIsDownload) nextClickIsDownload = false;

      if (isDownloadMouse) {
        insideDownloadMouseWrap = true;
        lines.push(`${indent}// Wait for download triggered by click`);
        lines.push(`${indent}await downloads.waitForDownload(async () => {`);
      }
      const mIndent = insideDownloadMouseWrap ? indent + '  ' : indent;

      if (modifiers && modifiers.length > 0) {
        for (const mod of modifiers) {
          lines.push(`${mIndent}await page.keyboard.down('${mod}');`);
        }
      }
      lines.push(`${mIndent}await page.mouse.move(${x}, ${y});`);
      lines.push(`${mIndent}await page.mouse.down(${buttonOpt});`);
      lastEmittedEventType = 'mouse-down';
    } else if (event.type === 'mouse-up' && event.data.coordinates) {
      const { x, y } = event.data.coordinates;
      const modifiers = event.data.modifiers;
      const mouseButton = event.data.button;
      const buttonOpt = mouseButton === 2 ? `{ button: 'right' }` : '';
      const mIndent = insideDownloadMouseWrap ? indent + '  ' : indent;
      lines.push(`${mIndent}await page.mouse.move(${x}, ${y});`);
      lines.push(`${mIndent}await page.mouse.up(${buttonOpt});`);
      if (modifiers && modifiers.length > 0) {
        for (const mod of modifiers) {
          lines.push(`${mIndent}await page.keyboard.up('${mod}');`);
        }
      }
      if (insideDownloadMouseWrap) {
        lines.push(`${indent}});`);
        insideDownloadMouseWrap = false;
      }
      lastEmittedEventType = 'mouse-up';
    } else if (event.type === 'keypress' && event.data.key) {
      const { key, modifiers } = event.data;
      if (modifiers && modifiers.length > 0) {
        for (const mod of modifiers) {
          lines.push(`${indent}await page.keyboard.down('${mod}');`);
        }
      }
      lines.push(`${indent}await page.keyboard.press('${key}');`);
      if (modifiers && modifiers.length > 0) {
        for (const mod of [...modifiers].reverse()) {
          lines.push(`${indent}await page.keyboard.up('${mod}');`);
        }
      }
    } else if (event.type === 'keydown' && event.data.key) {
      const escapedKey = event.data.key.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      lines.push(`${indent}await page.keyboard.down('${escapedKey}');`);
    } else if (event.type === 'keyup' && event.data.key) {
      const escapedKey = event.data.key.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      lines.push(`${indent}await page.keyboard.up('${escapedKey}');`);
    } else if (event.type === 'insert-timestamp') {
      lines.push(`${indent}await page.keyboard.type(new Date().toISOString());`);
    } else if (event.type === 'scroll') {
      const deltaX = (event.data.deltaX as number) || 0;
      const deltaY = (event.data.deltaY as number) || 0;
      const scrollMods = event.data.modifiers;
      if (scrollMods && scrollMods.length > 0) {
        const modFlags: string[] = [];
        if (scrollMods.includes('Control')) modFlags.push('ctrlKey: true');
        if (scrollMods.includes('Shift')) modFlags.push('shiftKey: true');
        if (scrollMods.includes('Alt')) modFlags.push('altKey: true');
        if (scrollMods.includes('Meta')) modFlags.push('metaKey: true');
        lines.push(`${indent}await page.evaluate(({ x, y, dx, dy }) => {`);
        lines.push(`${indent}  const el = document.elementFromPoint(x, y) || document.documentElement;`);
        lines.push(`${indent}  el.dispatchEvent(new WheelEvent('wheel', { deltaX: dx, deltaY: dy, ${modFlags.join(', ')}, bubbles: true, cancelable: true, clientX: x, clientY: y }));`);
        lines.push(`${indent}}, { x: ${lastCursorX}, y: ${lastCursorY}, dx: ${deltaX}, dy: ${deltaY} });`);
      } else {
        lines.push(`${indent}await page.mouse.wheel(${deltaX}, ${deltaY});`);
      }
    }
  }

  flushCursorBatch();
  return lines;
}
