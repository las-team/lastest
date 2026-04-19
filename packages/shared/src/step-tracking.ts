/**
 * Step tracking instrumentation for test execution.
 *
 * Parses a test body into statements (step boundaries) and injects
 * `await __stepReached(N);` markers before each step.  Used by the local
 * runner, embedded-browser executor, and remote runner so the server can
 * persist exactly which steps were reached during execution.
 */

interface StatementBoundary {
  lineStart: number; // 1-based line in body
}

/**
 * Parse a test body into statement boundaries using a character-level scanner.
 * Returns the 1-based start line of each top-level statement.
 */
function parseStatementBoundaries(body: string): StatementBoundary[] {
  const lines = body.split('\n');
  const boundaries: StatementBoundary[] = [];

  let current = '';
  let depth = 0;
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

    if (trimmedLine === '' && current.trim() === '') continue;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      const next = line[i + 1];

      if (escaped) { current += ch; escaped = false; continue; }
      if (ch === '\\' && (inSingleQuote || inDoubleQuote || inTemplate)) { current += ch; escaped = true; continue; }

      if (inLineComment) { current += ch; continue; }
      if (inBlockComment) {
        current += ch;
        if (ch === '*' && next === '/') { current += '/'; i++; inBlockComment = false; }
        continue;
      }

      if (!inSingleQuote && !inDoubleQuote && !inTemplate) {
        if (ch === '/' && next === '/') { inLineComment = true; current += ch; continue; }
        if (ch === '/' && next === '*') { inBlockComment = true; current += ch; continue; }
      }

      if (ch === "'" && !inDoubleQuote && !inTemplate) { inSingleQuote = !inSingleQuote; current += ch; continue; }
      if (ch === '"' && !inSingleQuote && !inTemplate) { inDoubleQuote = !inDoubleQuote; current += ch; continue; }
      if (ch === '`' && !inSingleQuote && !inDoubleQuote) { inTemplate = !inTemplate; current += ch; continue; }

      if (inSingleQuote || inDoubleQuote || inTemplate) { current += ch; continue; }

      if (ch === '(' || ch === '[' || ch === '{') { depth++; current += ch; continue; }
      if (ch === ')' || ch === ']' || ch === '}') { depth--; current += ch; continue; }

      if (ch === ';' && depth === 0) {
        current += ch;
        const code = current.trim();
        if (code && code !== ';') {
          boundaries.push({ lineStart: currentStart + 1 });
        }
        current = '';
        const restOfLineAfterSemicolon = line.slice(i + 1);
        currentStart = lineIdx + (restOfLineAfterSemicolon.trim() !== '' ? 0 : 1);
        continue;
      }

      current += ch;
    }

    inLineComment = false;

    if (depth === 0 && current.trim() !== '') {
      const nextNonEmpty = lines.slice(lineIdx + 1).find(l => l.trim() !== '');
      if (nextNonEmpty) {
        const nextTrimmed = nextNonEmpty.trim();
        const isNewStatement = /^(await|const|let|var|if|for|while|do|switch|return|throw|stepLogger|expect|try|\/\/)/.test(nextTrimmed);
        const isContinuation = /^[.?]|^\)/.test(nextTrimmed) || /^(&&|\|\||[+\-*/%]=?)/.test(nextTrimmed);

        if (isNewStatement && !isContinuation) {
          const code = current.trim();
          if (code) {
            boundaries.push({ lineStart: currentStart + 1 });
          }
          current = '';
          currentStart = lineIdx + 1;
          continue;
        }
      }
    }

    if (current.trim() !== '' || depth > 0) {
      current += '\n';
    }
  }

  const remaining = current.trim();
  if (remaining) {
    boundaries.push({ lineStart: currentStart + 1 });
  }

  return boundaries;
}

/**
 * Instrument a transformed test body with step-tracking markers.
 *
 * Inserts `await __stepReached(N);` before each parsed statement (working
 * backwards to preserve line positions). The caller must provide the
 * `__stepReached` callback when constructing the AsyncFunction.
 */
export function instrumentStepTracking(body: string): { instrumentedBody: string; stepCount: number } {
  const boundaries = parseStatementBoundaries(body);
  if (boundaries.length === 0) return { instrumentedBody: body, stepCount: 0 };

  const lines = body.split('\n');

  for (let i = boundaries.length - 1; i >= 0; i--) {
    const lineIdx = boundaries[i].lineStart - 1;
    if (lineIdx < 0 || lineIdx > lines.length) continue;
    const indent = lines[lineIdx]?.match(/^(\s*)/)?.[1] ?? '';
    lines.splice(lineIdx, 0, `${indent}await __stepReached(${i});`);
  }

  return { instrumentedBody: lines.join('\n'), stepCount: boundaries.length };
}
