import type { Page } from 'playwright';
import type { SetupScript, SetupContext, SetupResult } from './types';

/**
 * Run a Playwright setup script.
 * Similar to test runner but:
 * - Does NOT capture screenshots
 * - Returns variables that can be passed to tests
 * - Browser state is preserved for subsequent tests
 */
export async function runPlaywrightSetup(
  page: Page,
  script: SetupScript,
  context: SetupContext
): Promise<SetupResult> {
  const startTime = Date.now();

  try {
    if (script.type !== 'playwright') {
      return {
        success: false,
        error: `Expected playwright script but got ${script.type}`,
        duration: Date.now() - startTime,
      };
    }

    const code = script.code;
    if (!code) {
      return {
        success: false,
        error: 'No setup code',
        duration: Date.now() - startTime,
      };
    }

    // Execute the setup code
    const extractedVariables = await executeSetupCode(page, code, context);

    return {
      success: true,
      variables: extractedVariables,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Run a test as setup (reuse existing test code but skip screenshots)
 */
export async function runTestAsSetup(
  page: Page,
  testCode: string,
  context: SetupContext
): Promise<SetupResult> {
  const startTime = Date.now();

  try {
    if (!testCode) {
      return {
        success: false,
        error: 'No test code',
        duration: Date.now() - startTime,
      };
    }

    // Execute the test code but intercept screenshot calls
    const extractedVariables = await executeSetupCode(page, testCode, context, true);

    return {
      success: true,
      variables: extractedVariables,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Execute setup code and extract variables
 */
async function executeSetupCode(
  page: Page,
  code: string,
  context: SetupContext,
  isTestAsSetup = false
): Promise<Record<string, unknown>> {
  // Strip TypeScript type annotations
  let processedCode = stripTypeAnnotations(code);

  // Check for setup function format
  const setupMatch = processedCode.match(
    /export\s+async\s+function\s+setup\s*\(\s*page[^)]*\)\s*\{([\s\S]*)\}\s*$/
  );

  // Also support test function format (when using test as setup)
  const testMatch = processedCode.match(
    /export\s+async\s+function\s+test\s*\(\s*page[^)]*\)\s*\{([\s\S]*)\}\s*$/
  );

  const funcMatch = setupMatch || testMatch;

  if (funcMatch) {
    const body = funcMatch[1];

    // Create page proxy that skips screenshots when running as setup
    const pageProxy = isTestAsSetup ? createNoScreenshotProxy(page) : page;

    // Build and execute the function
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const setupFn = new AsyncFunction(
      'page',
      'baseUrl',
      'context',
      `
      ${body}
      `
    );

    const result = await setupFn(pageProxy, context.baseUrl, context);

    // If the setup returns an object, treat it as extracted variables
    if (result && typeof result === 'object') {
      return result;
    }

    return {};
  }

  // Try to execute as raw commands (legacy format)
  const lines = processedCode.split('\n').filter(line =>
    line.trim().startsWith('await page.')
  );

  const pageProxy = isTestAsSetup ? createNoScreenshotProxy(page) : page;

  for (const line of lines) {
    await executeLine(pageProxy, line.trim(), context.baseUrl);
  }

  return {};
}

/**
 * Create a proxy that intercepts and skips screenshot calls
 */
function createNoScreenshotProxy(page: Page): Page {
  return new Proxy(page, {
    get: (target, prop) => {
      if (prop === 'screenshot') {
        // Return a no-op function for screenshots
        return async () => Buffer.alloc(0);
      }
      const value = (target as any)[prop];
      if (typeof value === 'function') {
        return value.bind(target);
      }
      return value;
    }
  });
}

/**
 * Strip TypeScript type annotations from code
 */
function stripTypeAnnotations(code: string): string {
  let result = code;
  // Remove variable type annotations
  result = result.replace(
    /\b(const|let|var)\s+(\w+)\s*:\s*[^=\n;]+(\s*=)/g,
    '$1 $2$3'
  );
  // Remove type annotations on destructured assignments
  result = result.replace(
    /\b(const|let|var)\s+(\{[^}]+\}|\[[^\]]+\])\s*:\s*[^=\n;]+(\s*=)/g,
    '$1 $2$3'
  );
  // Remove `as Type` assertions
  result = result.replace(/\)\s+as\s+\w[\w<>\[\],\s|]*/g, ')');
  result = result.replace(/(\w)\s+as\s+\w[\w<>\[\],\s|]*/g, '$1');
  return result;
}

/**
 * Execute a single line of Playwright code
 */
async function executeLine(page: Page, line: string, baseUrl: string): Promise<void> {
  if (line.startsWith('await page.goto(')) {
    const urlMatch = line.match(/goto\(['"]([^'"]+)['"]\)/);
    if (urlMatch) {
      let url = urlMatch[1];
      // Handle relative URLs
      if (url.startsWith('/')) {
        url = `${baseUrl}${url}`;
      }
      await page.goto(url, { timeout: 30000 });
    }
  } else if (line.startsWith('await page.locator(')) {
    const locatorMatch = line.match(/locator\(['"]([^'"]+)['"]\)/);
    const actionMatch = line.match(/\.(click|fill|selectOption)\(['"]?([^'")]*)?['"]?\)/);

    if (locatorMatch && actionMatch) {
      const selector = locatorMatch[1];
      const action = actionMatch[1];
      const value = actionMatch[2];

      const locator = page.locator(selector);

      switch (action) {
        case 'click':
          await locator.click();
          break;
        case 'fill':
          await locator.fill(value || '');
          break;
        case 'selectOption':
          await locator.selectOption(value || '');
          break;
      }
    }
  } else if (line.startsWith('await page.fill(')) {
    const match = line.match(/fill\(['"]([^'"]+)['"],\s*['"]([^'"]*)['"]\)/);
    if (match) {
      await page.fill(match[1], match[2]);
    }
  } else if (line.startsWith('await page.click(')) {
    const match = line.match(/click\(['"]([^'"]+)['"]\)/);
    if (match) {
      await page.click(match[1]);
    }
  } else if (line.startsWith('await page.waitForSelector(')) {
    const match = line.match(/waitForSelector\(['"]([^'"]+)['"]\)/);
    if (match) {
      await page.waitForSelector(match[1]);
    }
  } else if (line.startsWith('await page.waitForTimeout(')) {
    const match = line.match(/waitForTimeout\((\d+)\)/);
    if (match) {
      await page.waitForTimeout(parseInt(match[1], 10));
    }
  }
  // Skip screenshot commands when running as setup
  // (they're already filtered by the proxy, but ignore them here too)
}
