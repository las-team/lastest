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
  if (/\.waitFor/.test(trimmed) || /waitForTimeout/.test(trimmed) || /waitForURL/.test(trimmed) || /waitForLoadState/.test(trimmed) || /waitForSelector/.test(trimmed)) return 'wait';
  if (/\.(click|fill|press|type|check|uncheck|selectOption|hover|dblclick|dragTo|setInputFiles|focus|blur)\s*\(/.test(trimmed)) return 'action';
  if (/locateWithFallback\s*\(/.test(trimmed)) return 'action';
  if (/page\.\w+\s*\(/.test(trimmed)) return 'action';

  return 'other';
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

  // For actions
  if (type === 'action') {
    const clickMatch = trimmed.match(/\.click\s*\(/);
    if (clickMatch) return 'Click';
    const fillMatch = trimmed.match(/\.fill\s*\(\s*['"`](.{0,20})/);
    if (fillMatch) return `Fill "${fillMatch[1]}..."`;
    const pressMatch = trimmed.match(/\.press\s*\(\s*['"`](\w+)/);
    if (pressMatch) return `Press ${pressMatch[1]}`;
    if (/locateWithFallback/.test(trimmed)) return 'Locate & interact';
    return 'Action';
  }

  if (type === 'assertion') return 'Assert';
  if (type === 'screenshot') return 'Screenshot';
  if (type === 'wait') return 'Wait';

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

    // Skip empty lines when not in a statement
    if (trimmedLine === '' && current.trim() === '') {
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

  return body.slice(0, startIdx) + '/* locateWithFallback provided by runner */' + body.slice(endIdx);
}
