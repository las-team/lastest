/**
 * Transforms Playwright Inspector (codegen) output to the Lastest runner format.
 *
 * Input format (PW codegen):
 * ```
 * import { test, expect } from '@playwright/test';
 *
 * test('test', async ({ page }) => {
 *   await page.goto('https://example.com/path');
 *   await page.getByRole('button', { name: 'Submit' }).click();
 *   // ...
 * });
 * ```
 *
 * Output format (Lastest runner):
 * ```
 * export async function test(page, baseUrl, screenshotPath, stepLogger) {
 *   const buildUrl = (base, path) => new URL(path, base).href;
 *   const getScreenshotPath = (label) => screenshotPath.replace('.png', `-${label}.png`);
 *
 *   await page.goto(buildUrl(baseUrl, '/path'));
 *   await page.getByRole('button', { name: 'Submit' }).click();
 *   // ...
 * }
 * ```
 */

export function transformPlaywrightCode(rawCode: string, recordedUrl?: string): string {
  if (!rawCode || rawCode.trim() === '') {
    return generateEmptyTemplate();
  }

  // Extract the base URL from the recorded URL
  let baseUrlOrigin = '';
  if (recordedUrl) {
    try {
      const url = new URL(recordedUrl);
      baseUrlOrigin = url.origin;
    } catch {
      // Invalid URL, will use empty string
    }
  }

  // Extract test body from different PW codegen formats
  let testBody = extractTestBody(rawCode);

  // If no test body found, try to use the raw code as-is (maybe it's just statements)
  if (!testBody) {
    testBody = rawCode;
  }

  // Transform page.goto calls to use buildUrl
  testBody = transformGotoStatements(testBody, baseUrlOrigin);

  // Remove any remaining import statements
  testBody = removeImports(testBody);

  // Clean up the code
  testBody = cleanupCode(testBody);

  // Wrap in our function signature
  return wrapInRunnerFormat(testBody);
}

/**
 * Extract the test body from Playwright codegen output
 */
function extractTestBody(code: string): string | null {
  // Pattern 1: test('...', async ({ page }) => { ... });
  const testBlockMatch = code.match(
    /test\s*\(\s*['"`][^'"`]*['"`]\s*,\s*async\s*\(\s*\{\s*page\s*\}\s*\)\s*=>\s*\{([\s\S]*)\}\s*\)\s*;?\s*$/
  );
  if (testBlockMatch) {
    return testBlockMatch[1].trim();
  }

  // Pattern 2: test('...', async ({ page }) => { ... }) without trailing semicolon
  const testBlockMatch2 = code.match(
    /test\s*\(\s*['"`][^'"`]*['"`]\s*,\s*async\s*\(\s*\{\s*page\s*\}\s*\)\s*=>\s*\{([\s\S]*?)\}\s*\)/
  );
  if (testBlockMatch2) {
    return testBlockMatch2[1].trim();
  }

  // Pattern 3: Just async function body (some codegen outputs)
  const asyncFnMatch = code.match(/async\s*\(\s*\{\s*page\s*\}\s*\)\s*=>\s*\{([\s\S]*)\}/);
  if (asyncFnMatch) {
    return asyncFnMatch[1].trim();
  }

  // Pattern 4: Multiple test blocks - take the first one
  const multiTestMatch = code.match(
    /test\s*\(\s*['"`][^'"`]*['"`]\s*,\s*async\s*\(\s*\{\s*page\s*\}\s*\)\s*=>\s*\{([\s\S]*?)\}\s*\)\s*;/
  );
  if (multiTestMatch) {
    return multiTestMatch[1].trim();
  }

  return null;
}

/**
 * Transform page.goto() calls to use buildUrl helper
 */
function transformGotoStatements(code: string, baseUrlOrigin: string): string {
  // Match page.goto('https://example.com/path') or page.goto("...")
  const gotoRegex = /page\.goto\s*\(\s*(['"`])([^'"`]+)\1\s*\)/g;

  return code.replace(gotoRegex, (match, quote, url) => {
    try {
      const parsedUrl = new URL(url);

      // If the URL matches our base, convert to relative
      if (baseUrlOrigin && parsedUrl.origin === baseUrlOrigin) {
        const relativePath = parsedUrl.pathname + parsedUrl.search + parsedUrl.hash;
        return `page.goto(buildUrl(baseUrl, '${relativePath}'))`;
      }

      // If it's just a path (starts with /)
      if (url.startsWith('/')) {
        return `page.goto(buildUrl(baseUrl, '${url}'))`;
      }

      // Keep absolute URLs for external sites
      return match;
    } catch {
      // If URL parsing fails, check if it's a relative path
      if (url.startsWith('/')) {
        return `page.goto(buildUrl(baseUrl, '${url}'))`;
      }
      return match;
    }
  });
}

/**
 * Remove import statements from code
 */
function removeImports(code: string): string {
  // Remove various import patterns
  const lines = code.split('\n');
  const filteredLines = lines.filter((line) => {
    const trimmed = line.trim();
    // Skip import statements
    if (trimmed.startsWith('import ')) return false;
    // Skip require statements
    if (trimmed.startsWith('const ') && trimmed.includes('require(')) return false;
    return true;
  });
  return filteredLines.join('\n');
}

/**
 * Clean up the code (remove extra whitespace, fix indentation)
 */
function cleanupCode(code: string): string {
  // Split into lines
  const lines = code.split('\n');

  // Remove leading/trailing empty lines
  while (lines.length > 0 && lines[0].trim() === '') {
    lines.shift();
  }
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }

  // Find minimum indentation (excluding empty lines)
  let minIndent = Infinity;
  for (const line of lines) {
    if (line.trim() === '') continue;
    const match = line.match(/^(\s*)/);
    if (match && match[1].length < minIndent) {
      minIndent = match[1].length;
    }
  }

  // Remove common indentation and add our own (2 spaces for function body)
  if (minIndent !== Infinity && minIndent > 0) {
    return lines
      .map((line) => {
        if (line.trim() === '') return '';
        return '  ' + line.slice(minIndent);
      })
      .join('\n');
  }

  // Just add indentation
  return lines.map((line) => (line.trim() ? '  ' + line : '')).join('\n');
}

/**
 * Wrap the test body in our runner function format
 */
function wrapInRunnerFormat(body: string): string {
  return `export async function test(page, baseUrl, screenshotPath, stepLogger) {
  const buildUrl = (base, path) => new URL(path, base).href;
  const getScreenshotPath = (label) => screenshotPath.replace('.png', \`-\${label}.png\`);

${body}
}
`;
}

/**
 * Generate an empty template when no code is provided
 */
function generateEmptyTemplate(): string {
  return `export async function test(page, baseUrl, screenshotPath, stepLogger) {
  const buildUrl = (base, path) => new URL(path, base).href;
  const getScreenshotPath = (label) => screenshotPath.replace('.png', \`-\${label}.png\`);

  // Navigate to the page
  await page.goto(baseUrl);

  // Add your test steps here
}
`;
}
