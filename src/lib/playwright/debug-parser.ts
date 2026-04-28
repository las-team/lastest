/**
 * Statement parser for debug mode.
 * Splits test function body into discrete executable steps.
 */

export interface DebugStep {
  id: number;
  code: string;           // executable statement text
  label: string;          // from stepLogger.log() or auto-generated
  lineStart: number;      // line in original source (1-based)
  lineEnd: number;
  type: 'action' | 'navigation' | 'assertion' | 'screenshot' | 'wait' | 'variable' | 'log' | 'other';
}

/**
 * Extract the function body from test code.
 * Supports:
 *   1. export async function test(page, ...) { BODY }
 *   2. Legacy Playwright test format: test('name', async ({ page }) => { BODY });
 *   3. Raw code (no wrapper) — returned as-is
 */
export function extractTestBody(code: string): string | null {
  if (!code || !code.trim()) return null;

  // Standard format: export async function test(page, ...) { BODY }
  const funcMatch = code.match(
    /export\s+async\s+function\s+test\s*\(\s*page[^)]*\)\s*\{([\s\S]*)\}\s*$/
  );
  if (funcMatch) return funcMatch[1];

  // Legacy Playwright test format: test('...', async ({ page }) => { BODY });
  const legacyMatch = code.match(
    /test\([^,]+,\s*async\s*\(\{\s*page\s*\}\)\s*=>\s*\{([\s\S]*)\}\);?\s*$/
  );
  if (legacyMatch) return legacyMatch[1];

  // Raw code (no function wrapper) — treat entire code as body.
  // Strip import lines at the top before returning.
  const lines = code.split('\n');
  const bodyLines: string[] = [];
  let pastImports = false;
  for (const line of lines) {
    if (!pastImports && (line.trim().startsWith('import ') || line.trim() === '')) {
      continue;
    }
    pastImports = true;
    bodyLines.push(line);
  }
  const body = bodyLines.join('\n').trim();
  return body || null;
}

/**
 * Classify a statement into a step type based on its content.
 */
function classifyStatement(code: string): DebugStep['type'] {
  const trimmed = code.trim();

  if (/^stepLogger\.log\s*\(/.test(trimmed)) return 'log';
  if (/^(const|let|var)\s+/.test(trimmed)) return 'variable';
  if (/expect\s*\(/.test(trimmed)) return 'assertion';
  if (/\.screenshot\s*\(/.test(trimmed)) return 'screenshot';
  if (/\.goto\s*\(/.test(trimmed) || /\.navigate\s*\(/.test(trimmed)) return 'navigation';
  // Helpers before generic waitFor — they contain "waitFor" but are actions
  if (/downloads\.\w+/.test(trimmed) || /clipboard\.\w+/.test(trimmed) || /network\.\w+/.test(trimmed)) return 'action';
  if (/\.waitFor/.test(trimmed) || /waitForTimeout/.test(trimmed) || /waitForURL/.test(trimmed) || /waitForLoadState/.test(trimmed) || /waitForSelector/.test(trimmed)) return 'wait';
  if (/\.(click|fill|press|type|check|uncheck|selectOption|hover|dblclick|dragTo|setInputFiles|focus|blur)\s*\(/.test(trimmed)) return 'action';
  if (/locateWithFallback\s*\(/.test(trimmed)) return 'action';
  if (/replayCursorPath\s*\(/.test(trimmed)) return 'action';
  if (/page\.mouse\.\w+\s*\(/.test(trimmed)) return 'action';
  if (/page\.keyboard\.\w+\s*\(/.test(trimmed)) return 'action';
  if (/page\.\w+\s*\(/.test(trimmed)) return 'action';

  return 'other';
}

/**
 * Extract the raw selector array from a `locateWithFallback(...)` call so the
 * UI can hash it (`hashSelectors` in `@lastest/shared`) and look up rows in
 * `selector_stats`. Returns null if the line isn't a locate call or the
 * literal can't be JSON-parsed (e.g. the array is built dynamically).
 */
export function extractSelectorArray(
  code: string,
): { selectors: { type: string; value: string }[]; action: string } | null {
  const m = code.match(/locateWithFallback\s*\(\s*page\s*,\s*(\[[\s\S]+?\])\s*,\s*['"](\w+)['"]/);
  if (!m) return null;
  try {
    const selectors = JSON.parse(m[1]) as { type: string; value: string }[];
    if (!Array.isArray(selectors)) return null;
    return { selectors, action: m[2] };
  } catch {
    return null;
  }
}

/**
 * Pick the most human-readable selector from a locateWithFallback JSON array.
 * Priority: role-name > id > placeholder > text > ocr-text > css-path
 */
function extractBestSelector(code: string): { selector: string; action: string; value?: string } | null {
  const actionMatch = code.match(/locateWithFallback\s*\(\s*page\s*,\s*\[(.+?)\]\s*,\s*['"](\w+)['"]/);
  if (!actionMatch) return null;

  const action = actionMatch[2];
  const jsonStr = '[' + actionMatch[1] + ']';

  // Extract fill/selectOption value (4th argument) — match after the action name
  const valueMatch = code.match(/,\s*'(?:fill|selectOption)'\s*,\s*'((?:[^'\\]|\\.)*)'/);
  const actionValue = valueMatch ? valueMatch[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\') : undefined;

  let selectors: { type: string; value: string }[];
  try {
    selectors = JSON.parse(jsonStr);
  } catch {
    return { selector: '...', action, value: actionValue };
  }

  const priority = ['role-name', 'data-testid', 'id', 'aria-label', 'name', 'placeholder', 'text', 'ocr-text', 'css-path'];
  selectors.sort((a, b) => {
    const ai = priority.indexOf(a.type);
    const bi = priority.indexOf(b.type);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  const best = selectors[0];
  if (!best) return { selector: '...', action, value: actionValue };

  const result = (selector: string) => ({ selector, action, value: actionValue });

  // Format the selector for display
  if (best.type === 'role-name') {
    const m = best.value.match(/^role=(\w+)\[name="(.+)"\]$/);
    if (m) return result(`${m[1]} "${m[2]}"`);
    return result(best.value);
  }
  if (best.type === 'data-testid') {
    const m = best.value.match(/\[data-testid="(.+?)"\]/);
    return result(m ? `testid "${m[1]}"` : best.value);
  }
  if (best.type === 'id') return result(best.value);
  if (best.type === 'aria-label') {
    const m = best.value.match(/\[aria-label="(.+?)"\]/);
    return result(m ? `"${m[1]}"` : best.value);
  }
  if (best.type === 'name') {
    const m = best.value.match(/\[name="(.+?)"\]/);
    return result(m ? `name "${m[1]}"` : best.value);
  }
  if (best.type === 'placeholder') {
    const m = best.value.match(/\[placeholder="(.+?)"\]/);
    return result(m ? `"${m[1]}"` : best.value);
  }
  if (best.type === 'text') {
    const m = best.value.match(/text="(.+?)"/);
    return result(m ? `"${m[1]}"` : best.value);
  }
  if (best.type === 'ocr-text') {
    const m = best.value.match(/ocr-text="(.+?)"/);
    return result(m ? `"${m[1]}"` : best.value);
  }

  // css-path: truncate if long
  const css = best.value.length > 30 ? best.value.slice(0, 27) + '...' : best.value;
  return result(css);
}

/**
 * Extract the fill/type/selectOption value from an action step's code
 * so the UI can render it as an editable input.
 *
 * Returns the unescaped value, or null if the step has no editable value.
 * The returned string is the in-memory representation (quotes and backslashes
 * un-escaped); callers re-escape before writing back to source.
 */
export function extractEditableValue(step: DebugStep): string | null {
  if (step.type !== 'action') return null;
  const code = step.code.trim();
  const unescape = (s: string) => s.replace(/\\'/g, "'").replace(/\\\\/g, '\\');

  // locateWithFallback(page, [...selectors...], 'fill', 'VALUE', ...)
  // The selectors JSON can contain ']' inside string values (e.g. CSS attribute
  // selectors), so we match the action marker directly instead of trying to
  // span the bracketed arg.
  const lwfFill = code.match(/locateWithFallback\s*\([\s\S]*?,\s*'fill'\s*,\s*'((?:[^'\\]|\\.)*)'/);
  if (lwfFill) return unescape(lwfFill[1]);

  const lwfSelect = code.match(/locateWithFallback\s*\([\s\S]*?,\s*'selectOption'\s*,\s*'((?:[^'\\]|\\.)*)'/);
  if (lwfSelect) return unescape(lwfSelect[1]);

  // Chained .fill('VALUE'[, { options }])
  const fillMatch = code.match(/\.fill\s*\(\s*'((?:[^'\\]|\\.)*)'\s*(?:,[^)]*)?\)/);
  if (fillMatch) return unescape(fillMatch[1]);

  // page.keyboard.type('VALUE'[, { delay }])
  const typeMatch = code.match(/\.keyboard\.type\s*\(\s*'((?:[^'\\]|\\.)*)'\s*(?:,[^)]*)?\)/);
  if (typeMatch) return unescape(typeMatch[1]);

  // Chained .selectOption('VALUE'[, { options }])
  const selOptMatch = code.match(/\.selectOption\s*\(\s*'((?:[^'\\]|\\.)*)'\s*(?:,[^)]*)?\)/);
  if (selOptMatch) return unescape(selOptMatch[1]);

  return null;
}

/**
 * Extract a locator description from Playwright chained calls like
 * page.getByRole('link', { name: 'Tests' }).click()
 */
function extractLocatorTarget(code: string): string | null {
  const getByRole = code.match(/\.getByRole\s*\(\s*['"](\w+)['"]\s*,\s*\{\s*name:\s*['"](.+?)['"]/);
  if (getByRole) return `${getByRole[1]} "${getByRole[2]}"`;

  const getByText = code.match(/\.getByText\s*\(\s*['"](.+?)['"]/);
  if (getByText) return `"${getByText[1]}"`;

  const getByLabel = code.match(/\.getByLabel\s*\(\s*['"](.+?)['"]/);
  if (getByLabel) return `"${getByLabel[1]}"`;

  const getByPlaceholder = code.match(/\.getByPlaceholder\s*\(\s*['"](.+?)['"]/);
  if (getByPlaceholder) return `"${getByPlaceholder[1]}"`;

  const getByTestId = code.match(/\.getByTestId\s*\(\s*['"](.+?)['"]/);
  if (getByTestId) return `testid "${getByTestId[1]}"`;

  const locator = code.match(/\.locator\s*\(\s*['"](.+?)['"]/);
  if (locator) {
    const sel = locator[1];
    return sel.length > 30 ? sel.slice(0, 27) + '...' : sel;
  }

  return null;
}

/**
 * Generate a human-readable label for a step.
 */
function generateLabel(code: string, type: DebugStep['type']): string {
  const trimmed = code.trim();

  // For log steps, extract the message
  if (type === 'log') {
    const match = trimmed.match(/stepLogger\.log\s*\(\s*['"`](.+?)['"`]\s*\)/);
    return match ? match[1] : 'Log';
  }

  // For variable declarations, show the variable name
  if (type === 'variable') {
    const match = trimmed.match(/^(?:const|let|var)\s+(\w+)/);
    return match ? `Declare ${match[1]}` : 'Variable';
  }

  // For navigation
  if (type === 'navigation') {
    const match = trimmed.match(/\.goto\s*\(\s*['"`]?([^'"`)\s]+)/);
    if (match) return `Navigate to ${match[1]}`;
    return 'Navigate';
  }

  // For assertions — extract target + matcher
  if (type === 'assertion') {
    const negated = /\.not\./.test(trimmed);
    const neg = negated ? 'not ' : '';

    // expect(page).toHaveURL(...)
    const urlMatch = trimmed.match(/\.toHaveURL\s*\(\s*\/(.*?)\/\s*\)/);
    if (urlMatch) return `Assert URL ${neg}matches /${urlMatch[1]}/`;

    // expect(page).toHaveTitle(...)
    const titleMatch = trimmed.match(/\.toHaveTitle\s*\(\s*(.+?)\s*\)/);
    if (titleMatch) return `Assert title ${neg}matches ${titleMatch[1]}`;

    // expect(page.getByRole/getByText/etc)
    const target = extractLocatorTarget(trimmed);
    // Extract matcher: .toBeVisible(), .toBeEmpty(), .toHaveText(), etc.
    const matcherMatch = trimmed.match(/\.(toBe\w+|toHave\w+|toContain\w+)\s*\(/);
    const matcher = matcherMatch?.[1];
    const friendlyMatcher = matcher
      ? matcher.replace(/^toBe/, '').replace(/^toHave/, 'has ').replace(/^toContain/, 'contains ').toLowerCase()
      : 'visible';

    if (target) return `Assert ${target} ${neg}${friendlyMatcher}`;

    // expect(varName).toBeVisible()
    const varMatch = trimmed.match(/expect\s*\(\s*(\w+)\s*\)/);
    if (varMatch && varMatch[1] !== 'page') return `Assert ${varMatch[1]} ${neg}${friendlyMatcher}`;

    return 'Assert';
  }

  // For actions
  if (type === 'action') {
    // locateWithFallback — parse selectors + action
    if (/locateWithFallback/.test(trimmed)) {
      const info = extractBestSelector(trimmed);
      if (info) {
        if (info.action === 'fill' && info.value) {
          const truncVal = info.value.length > 20 ? info.value.slice(0, 17) + '...' : info.value;
          return `Fill ${info.selector} "${truncVal}"`;
        }
        if (info.action === 'selectOption' && info.value) {
          const truncVal = info.value.length > 20 ? info.value.slice(0, 17) + '...' : info.value;
          return `Select "${truncVal}" in ${info.selector}`;
        }
        const actionLabel = info.action === 'click' ? 'Click' : info.action === 'fill' ? 'Fill' : info.action === 'selectOption' ? 'Select' : info.action;
        return `${actionLabel} ${info.selector}`;
      }
      return 'Locate & interact';
    }

    // Mouse actions
    if (/\.mouse\.down\s*\(/.test(trimmed)) return 'Mouse down';
    if (/\.mouse\.up\s*\(/.test(trimmed)) return 'Mouse up';
    const mouseClickMatch = trimmed.match(/\.mouse\.click\s*\(\s*(\d+)\s*,\s*(\d+)/);
    if (mouseClickMatch) return `Click at (${mouseClickMatch[1]}, ${mouseClickMatch[2]})`;
    const mouseMoveMatch = trimmed.match(/\.mouse\.move\s*\(\s*(\d+)\s*,\s*(\d+)/);
    if (mouseMoveMatch) return `Mouse move to (${mouseMoveMatch[1]}, ${mouseMoveMatch[2]})`;

    // replayCursorPath — keep short
    if (/replayCursorPath/.test(trimmed)) return 'Cursor path';

    // Keyboard
    if (/\.keyboard\.type\s*\(\s*new\s+Date\(\)\.toISOString\(\)/.test(trimmed)) return 'Type current timestamp';
    const typeMatch = trimmed.match(/\.keyboard\.type\s*\(\s*['"]([^'"]{0,30})['"]/);
    if (typeMatch) return `Type "${typeMatch[1]}"`;
    const pressMatch = trimmed.match(/\.press\s*\(\s*['"]([^'"]+)['"]/);
    if (pressMatch) return `Press ${pressMatch[1]}`;

    // downloads/clipboard/network helpers
    if (/downloads\.waitForDownload/.test(trimmed)) return 'Wait for download';
    if (/clipboard\.copy/.test(trimmed)) return 'Copy to clipboard';
    if (/clipboard\.paste/.test(trimmed)) return 'Paste from clipboard';
    if (/network\.mock/.test(trimmed)) return 'Mock network request';
    if (/network\.block/.test(trimmed)) return 'Block network request';

    // Chained Playwright actions: page.getByRole(...).click()
    const target = extractLocatorTarget(trimmed);
    if (target) {
      if (/\.click\s*\(/.test(trimmed)) return `Click ${target}`;
      if (/\.fill\s*\(/.test(trimmed)) {
        const val = trimmed.match(/\.fill\s*\(\s*['"]([^'"]{0,20})/);
        return val ? `Fill ${target} "${val[1]}"` : `Fill ${target}`;
      }
      if (/\.selectOption\s*\(/.test(trimmed)) {
        const optVal = trimmed.match(/\.selectOption\s*\(\s*['"]([^'"]{0,20})/);
        return optVal ? `Select "${optVal[1]}" in ${target}` : `Select option in ${target}`;
      }
      if (/\.hover\s*\(/.test(trimmed)) return `Hover ${target}`;
      if (/\.check\s*\(/.test(trimmed)) return `Check ${target}`;
      if (/\.uncheck\s*\(/.test(trimmed)) return `Uncheck ${target}`;
      if (/\.dblclick\s*\(/.test(trimmed)) return `Double-click ${target}`;
      if (/\.focus\s*\(/.test(trimmed)) return `Focus ${target}`;
      return `Interact with ${target}`;
    }

    // Try to extract any selector string from the code for fallback labels
    const anySelectorMatch = trimmed.match(/page\s*\.\s*\w+\s*\(\s*['"]([^'"]{1,40})['"]/);
    const fallbackTarget = anySelectorMatch
      ? (anySelectorMatch[1].length > 30 ? anySelectorMatch[1].slice(0, 27) + '...' : anySelectorMatch[1])
      : null;

    // Plain click/fill with locator string
    const clickMatch = trimmed.match(/\.click\s*\(/);
    if (clickMatch) {
      const locMatch = trimmed.match(/\.locator\s*\(\s*['"](.+?)['"]\s*\)/);
      if (locMatch) return `Click ${locMatch[1].length > 30 ? locMatch[1].slice(0, 27) + '...' : locMatch[1]}`;
      return fallbackTarget ? `Click ${fallbackTarget}` : 'Click';
    }
    const fillMatch = trimmed.match(/\.fill\s*\(\s*['"](.{0,20})/);
    if (fillMatch) return fallbackTarget ? `Fill ${fallbackTarget} "${fillMatch[1]}"` : `Fill "${fillMatch[1]}"`;

    return fallbackTarget ? `Action on ${fallbackTarget}` : 'Action';
  }

  // For waits — show what's waited on
  if (type === 'wait') {
    const timeoutMatch = trimmed.match(/waitForTimeout\s*\(\s*(\d+)/);
    if (timeoutMatch) return `Wait ${timeoutMatch[1]}ms`;
    const urlMatch = trimmed.match(/waitForURL\s*\(\s*\/(.*?)\/\s*\)/);
    if (urlMatch) return `Wait for URL /${urlMatch[1]}/`;
    const urlStrMatch = trimmed.match(/waitForURL\s*\(\s*['"](.+?)['"]/);
    if (urlStrMatch) return `Wait for URL ${urlStrMatch[1]}`;
    const loadMatch = trimmed.match(/waitForLoadState\s*\(\s*['"](\w+)['"]/);
    if (loadMatch) return `Wait for ${loadMatch[1]}`;
    const selectorMatch = trimmed.match(/waitForSelector\s*\(\s*['"](.+?)['"]/);
    if (selectorMatch) return `Wait for ${selectorMatch[1].length > 25 ? selectorMatch[1].slice(0, 22) + '...' : selectorMatch[1]}`;
    return 'Wait';
  }

  if (type === 'screenshot') return 'Screenshot';

  // Truncate long code for label
  const short = trimmed.length > 40 ? trimmed.slice(0, 37) + '...' : trimmed;
  return short;
}

/**
 * Parse test body into discrete executable steps.
 *
 * Approach: Character-level scanner tracking brace/bracket/paren depth.
 * Statement boundaries at depth-0 semicolons or newlines followed by
 * statement-starting keywords.
 */
export function parseSteps(body: string): DebugStep[] {
  const lines = body.split('\n');
  const statements: { code: string; lineStart: number; lineEnd: number }[] = [];

  let current = '';
  let depth = 0; // tracks {} () [] nesting
  let currentStart = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escaped = false;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    const trimmedLine = line.trim();

    // Skip empty lines when not in a statement.
    // Advance currentStart so the next statement's lineStart reflects where it
    // actually begins, not the line of the previous `;`. Otherwise blank gaps
    // (e.g. lines left behind by line-preserving strip of inline helpers) get
    // absorbed into the next step's range.
    if (trimmedLine === '' && current.trim() === '') {
      currentStart = lineIdx + 1;
      continue;
    }

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      const next = line[i + 1];

      if (escaped) {
        current += ch;
        escaped = false;
        continue;
      }

      if (ch === '\\' && (inSingleQuote || inDoubleQuote || inTemplate)) {
        current += ch;
        escaped = true;
        continue;
      }

      // Handle comments
      if (inLineComment) {
        current += ch;
        continue;
      }
      if (inBlockComment) {
        current += ch;
        if (ch === '*' && next === '/') {
          current += '/';
          i++;
          inBlockComment = false;
        }
        continue;
      }

      if (!inSingleQuote && !inDoubleQuote && !inTemplate) {
        if (ch === '/' && next === '/') {
          inLineComment = true;
          current += ch;
          continue;
        }
        if (ch === '/' && next === '*') {
          inBlockComment = true;
          current += ch;
          continue;
        }
      }

      // Track string state
      if (ch === "'" && !inDoubleQuote && !inTemplate) {
        inSingleQuote = !inSingleQuote;
        current += ch;
        continue;
      }
      if (ch === '"' && !inSingleQuote && !inTemplate) {
        inDoubleQuote = !inDoubleQuote;
        current += ch;
        continue;
      }
      if (ch === '`' && !inSingleQuote && !inDoubleQuote) {
        inTemplate = !inTemplate;
        current += ch;
        continue;
      }

      if (inSingleQuote || inDoubleQuote || inTemplate) {
        current += ch;
        continue;
      }

      // Track nesting depth
      if (ch === '(' || ch === '[' || ch === '{') {
        depth++;
        current += ch;
        continue;
      }
      if (ch === ')' || ch === ']' || ch === '}') {
        depth--;
        current += ch;
        continue;
      }

      // Semicolons at depth 0 are statement boundaries
      if (ch === ';' && depth === 0) {
        current += ch;
        const code = current.trim();
        if (code && code !== ';') {
          statements.push({
            code,
            lineStart: currentStart + 1, // 1-based
            lineEnd: lineIdx + 1,
          });
        }
        current = '';
        currentStart = lineIdx;
        continue;
      }

      current += ch;
    }

    // End of line
    inLineComment = false;

    // Check if current statement is complete at depth 0
    // New line with a statement-starting keyword means new statement
    if (depth === 0 && current.trim() !== '') {
      const nextNonEmpty = lines.slice(lineIdx + 1).find(l => l.trim() !== '');
      if (nextNonEmpty) {
        const nextTrimmed = nextNonEmpty.trim();
        const isNewStatement = /^(await|const|let|var|if|for|while|do|switch|return|throw|stepLogger|expect|try|\/\/)/.test(nextTrimmed);
        // Also check if next line is NOT a continuation (chained call, etc.)
        const isContinuation = /^[.?]|^\)/.test(nextTrimmed) || /^(&&|\|\||[+\-*/%]=?)/.test(nextTrimmed);

        if (isNewStatement && !isContinuation) {
          const code = current.trim();
          if (code) {
            statements.push({
              code,
              lineStart: currentStart + 1,
              lineEnd: lineIdx + 1,
            });
          }
          current = '';
          currentStart = lineIdx + 1;
          continue;
        }
      }
    }

    // Add newline to current for multi-line statements
    if (current.trim() !== '' || depth > 0) {
      current += '\n';
    }
  }

  // Flush remaining
  const remaining = current.trim();
  if (remaining) {
    statements.push({
      code: remaining,
      lineStart: currentStart + 1,
      lineEnd: lines.length,
    });
  }

  // Convert to DebugSteps, merging log labels
  const steps: DebugStep[] = [];
  let pendingLabel: string | null = null;

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const type = classifyStatement(stmt.code);

    if (type === 'log') {
      // Extract label for next non-log step
      const match = stmt.code.match(/stepLogger\.log\s*\(\s*['"`](.+?)['"`]\s*\)/);
      pendingLabel = match ? match[1] : null;

      // Still add the log step
      steps.push({
        id: steps.length,
        code: stmt.code,
        label: pendingLabel || 'Log',
        lineStart: stmt.lineStart,
        lineEnd: stmt.lineEnd,
        type: 'log',
      });
      continue;
    }

    const label = pendingLabel || generateLabel(stmt.code, type);
    pendingLabel = null;

    steps.push({
      id: steps.length,
      code: stmt.code,
      label,
      lineStart: stmt.lineStart,
      lineEnd: stmt.lineEnd,
      type,
    });
  }

  return steps;
}

/**
 * Replace [startIdx, endIdx) in `body` with `placeholder`, but pad the
 * placeholder with trailing newlines so the total line count of `body` is
 * preserved. Step line numbers parsed from the cleaned body must line up
 * with line numbers in the displayed source (which still contains the
 * stripped helper declaration).
 */
function spliceWithLinePreservation(
  body: string,
  startIdx: number,
  endIdx: number,
  placeholder: string,
): string {
  const removed = body.slice(startIdx, endIdx);
  const removedNewlines = (removed.match(/\n/g) || []).length;
  const placeholderNewlines = (placeholder.match(/\n/g) || []).length;
  const padding = '\n'.repeat(Math.max(0, removedNewlines - placeholderNewlines));
  return body.slice(0, startIdx) + placeholder + padding + body.slice(endIdx);
}

/**
 * Remove the inline locateWithFallback function declaration from test body.
 * Same logic as runner.ts — the debug runner provides its own.
 */
export function removeInlineLocateWithFallback(body: string): string {
  if (!body.includes('async function locateWithFallback(')) return body;

  const startMatch = body.match(/async function locateWithFallback\s*\([^)]*\)\s*\{/);
  if (!startMatch || startMatch.index === undefined) return body;

  const startIdx = startMatch.index;
  const braceStart = body.indexOf('{', startIdx);
  let depth = 1;
  let endIdx = braceStart + 1;
  while (depth > 0 && endIdx < body.length) {
    if (body[endIdx] === '{') depth++;
    else if (body[endIdx] === '}') depth--;
    endIdx++;
  }

  let result = spliceWithLinePreservation(
    body,
    startIdx,
    endIdx,
    '/* locateWithFallback provided by runner */',
  );
  // Fix legacy page.keyboard.selectAll() → keyboard.press('Control+a')
  result = result.replace(/page\.keyboard\.selectAll\(\)/g, "page.keyboard.press('Control+a')");
  return result;
}

/**
 * Remove the inline replayCursorPath function declaration from test body.
 * Same balanced-brace pattern as removeInlineLocateWithFallback.
 * The debug runner provides its own speed-aware version.
 */
export function removeInlineReplayCursorPath(body: string): string {
  if (!body.includes('async function replayCursorPath(')) return body;

  const startMatch = body.match(/async function replayCursorPath\s*\([^)]*\)\s*\{/);
  if (!startMatch || startMatch.index === undefined) return body;

  const startIdx = startMatch.index;
  const braceStart = body.indexOf('{', startIdx);
  let depth = 1;
  let endIdx = braceStart + 1;
  while (depth > 0 && endIdx < body.length) {
    if (body[endIdx] === '{') depth++;
    else if (body[endIdx] === '}') depth--;
    endIdx++;
  }

  return spliceWithLinePreservation(
    body,
    startIdx,
    endIdx,
    '/* replayCursorPath provided by runner */',
  );
}

/**
 * Instrument a transformed test body with step-tracking markers.
 *
 * Parses the body into steps then inserts `await __stepReached(N);` before
 * each step (working backwards to preserve line positions).  The caller
 * provides the `__stepReached` callback when constructing the AsyncFunction.
 *
 * Returns the instrumented body and the total step count so the runner can
 * persist both values alongside the test result.
 */
export function instrumentStepTracking(body: string): { instrumentedBody: string; stepCount: number } {
  const steps = parseSteps(body);
  if (steps.length === 0) return { instrumentedBody: body, stepCount: 0 };

  const lines = body.split('\n');

  // Insert backwards so earlier insertions don't shift later line indices
  for (let i = steps.length - 1; i >= 0; i--) {
    const lineIdx = steps[i].lineStart - 1; // lineStart is 1-based
    if (lineIdx < 0 || lineIdx > lines.length) continue;
    const indent = lines[lineIdx]?.match(/^(\s*)/)?.[1] ?? '';
    lines.splice(lineIdx, 0, `${indent}await __stepReached(${i});`);
  }

  return { instrumentedBody: lines.join('\n'), stepCount: steps.length };
}
