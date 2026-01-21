import { chromium, Browser, Page } from 'playwright';

export interface SelectorValidationResult {
  selector: string;
  valid: boolean;
  error?: string;
  matchCount?: number;
}

export interface MCPValidationResult {
  valid: boolean;
  results: SelectorValidationResult[];
  pageError?: string;
}

// Extract selectors from Playwright test code
export function extractSelectors(code: string): string[] {
  const selectors: string[] = [];

  // Match various Playwright selector patterns
  const patterns = [
    // page.locator('selector')
    /page\.locator\(['"`]([^'"`]+)['"`]\)/g,
    // page.getByRole('role', { name: 'name' })
    /page\.getByRole\(['"`]([^'"`]+)['"`](?:,\s*\{[^}]*name:\s*['"`]([^'"`]+)['"`][^}]*\})?\)/g,
    // page.getByTestId('id')
    /page\.getByTestId\(['"`]([^'"`]+)['"`]\)/g,
    // page.getByText('text')
    /page\.getByText\(['"`]([^'"`]+)['"`]\)/g,
    // page.getByLabel('label')
    /page\.getByLabel\(['"`]([^'"`]+)['"`]\)/g,
    // page.getByPlaceholder('placeholder')
    /page\.getByPlaceholder\(['"`]([^'"`]+)['"`]\)/g,
    // page.$('selector') or page.$$('selector')
    /page\.\$\$?\(['"`]([^'"`]+)['"`]\)/g,
    // waitForSelector
    /waitForSelector\(['"`]([^'"`]+)['"`]\)/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(code)) !== null) {
      if (match[1]) {
        selectors.push(match[1]);
      }
      // For getByRole with name
      if (match[2]) {
        selectors.push(`role=${match[1]}[name="${match[2]}"]`);
      }
    }
  }

  // Remove duplicates
  return [...new Set(selectors)];
}

// Convert Playwright selector methods to queryable selectors
function convertToQueryableSelector(selector: string): string {
  // Handle data-testid
  if (selector.startsWith('[data-testid')) {
    return selector;
  }

  // Handle getByTestId style (just the ID)
  if (!selector.includes('[') && !selector.includes('.') && !selector.includes('#')) {
    return `[data-testid="${selector}"]`;
  }

  return selector;
}

export async function validateSelectorsOnPage(
  pageUrl: string,
  selectors: string[]
): Promise<MCPValidationResult> {
  let browser: Browser | null = null;
  let page: Page | null = null;

  try {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();

    await page.goto(pageUrl, { waitUntil: 'networkidle', timeout: 30000 });

    const results: SelectorValidationResult[] = [];

    for (const selector of selectors) {
      try {
        // Skip URL-like patterns (from goto)
        if (selector.startsWith('http') || selector.startsWith('/')) {
          continue;
        }

        const queryableSelector = convertToQueryableSelector(selector);

        // Try to find elements matching the selector
        const elements = await page.$$(queryableSelector);

        results.push({
          selector,
          valid: elements.length > 0,
          matchCount: elements.length,
        });
      } catch (error) {
        results.push({
          selector,
          valid: false,
          error: error instanceof Error ? error.message : 'Invalid selector',
        });
      }
    }

    const valid = results.every((r) => r.valid);

    return { valid, results };
  } catch (error) {
    return {
      valid: false,
      results: [],
      pageError: error instanceof Error ? error.message : 'Failed to load page',
    };
  } finally {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

export function formatValidationFeedback(result: MCPValidationResult): string {
  if (result.pageError) {
    return `Failed to load page: ${result.pageError}`;
  }

  if (result.valid) {
    return 'All selectors are valid.';
  }

  const invalidSelectors = result.results
    .filter((r) => !r.valid)
    .map((r) => `- "${r.selector}": ${r.error || 'No matching elements found'}`)
    .join('\n');

  return `The following selectors are invalid:\n${invalidSelectors}\n\nPlease update the test code to use valid selectors.`;
}
