/**
 * Seed script for Lastest self-testing visual regression tests
 *
 * Copies the 7 tests from las-team/lastest into a target repository.
 * Generated from production database dump (2026-03-16).
 *
 * Run: pnpm tsx scripts/seed-lastest-tests.ts
 */

import { db } from '../src/lib/db';
import { tests, testVersions, repositories, functionalAreas } from '../src/lib/db/schema';
import { eq } from 'drizzle-orm';
import { randomUUID as uuid } from 'crypto';

const SOURCE_REPO_NAME = 'las-team/lastest';

// Will be set dynamically
let REPO_ID: string;

// Functional area definitions (hierarchy: Viktor's > Logins)
const FUNCTIONAL_AREA_DEFINITIONS = [
  { name: "Viktor's", parent: null },
  { name: "Logins", parent: "Viktor's" },
];

// Test definitions with complete code
const TEST_DEFINITIONS: Array<{
  name: string;
  code: string;
  targetUrl: string;
  functionalArea?: string;
  setupOverrides?: string;
  requiredCapabilities?: string;
}> = [
  {
    name: "SETUP: Login",
    targetUrl: "http://localhost:3000",
    functionalArea: "Logins",
    setupOverrides: '{"skippedDefaultStepIds":["89d5548a-3ff1-4e68-b704-193caebca383","0f281033-f62f-41d1-b6fa-057265c28883"],"extraSteps":[]}',
    code: `export async function test(page: Page, baseUrl: string, screenshotPath: string, stepLogger: any) {
  // Navigate to the login page
  stepLogger.log('Navigating to login page');
  await page.goto(\`\${baseUrl}/login\`);

  // Wait for the page to be fully loaded
  await page.waitForLoadState('domcontentloaded');

  // Fill in the email field
  stepLogger.log('Entering email address');
  await page.locator('#email').fill('testuser1771664821751@example.com');

  // Fill in the password field
  stepLogger.log('Entering password');
  await page.locator('#password').fill('SecurePass123');

  // Take a screenshot before submission
  stepLogger.log('Taking screenshot of filled login form');
  await page.screenshot({ path: screenshotPath, fullPage: true });

  // Click the submit button
  stepLogger.log('Submitting login form');
  await page.locator('button[type="submit"]').click();

  // Wait for navigation after login
  await page.waitForLoadState('domcontentloaded');

  // Optional: Take a screenshot of the page after login
  stepLogger.log('Login completed successfully');
}`,
  },
  {
    name: "Dashboard",
    targetUrl: "http://localhost:3000",
    requiredCapabilities: '{"fileUpload":false,"clipboard":false,"networkInterception":false,"downloads":false}',
    code: `import { Page } from 'playwright';

export async function test(page: Page, baseUrl: string, screenshotPath: string, stepLogger: any) {
  // Helper to build URLs safely (handles trailing/leading slashes)
  function buildUrl(base, path) {
    const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
    const cleanPath = path.startsWith('/') ? path : '/' + path;
    return cleanBase + cleanPath;
  }

  // Helper to generate unique screenshot paths
  let screenshotStep = 0;
  function getScreenshotPath() {
    screenshotStep++;
    const ext = screenshotPath.lastIndexOf('.');
    if (ext > 0) {
      return screenshotPath.slice(0, ext) + '-step' + screenshotStep + screenshotPath.slice(ext);
    }
    return screenshotPath + '-step' + screenshotStep;
  }

  // Multi-selector fallback helper with coordinate fallback for clicks
  async function locateWithFallback(page, selectors, action, value, coords, options) {
    const validSelectors = selectors.filter(sel => sel.value && sel.value.trim() && !sel.value.includes('undefined'));
    for (const sel of validSelectors) {
      try {
        let locator;
        if (sel.type === 'ocr-text') {
          const text = sel.value.replace(/^ocr-text="/, '').replace(/"$/, '');
          locator = page.getByText(text, { exact: false });
        } else if (sel.type === 'role-name') {
          // Parse role=button[name="Label"] format and use getByRole
          const match = sel.value.match(/^role=(\\w+)\\[name="(.+)"\\]$/);
          if (match) {
            locator = page.getByRole(match[1], { name: match[2] });
          } else {
            locator = page.locator(sel.value);
          }
        } else {
          locator = page.locator(sel.value);
        }
        // Use .first() to handle multiple matches (e.g., header + footer nav links)
        const target = locator.first();
        await target.waitFor({ timeout: 3000 });
        if (action === 'locate') return target; // Return locator for assertions
        if (action === 'click') await target.click(options || {});
        else if (action === 'fill') await target.fill(value || '');
        else if (action === 'selectOption') await target.selectOption(value || '');
        return target;
      } catch { continue; }
    }
    // Coordinate fallback for clicks when all selectors fail
    if (action === 'click' && coords) {
      console.log('Falling back to coordinate click at', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y, options || {});
      return;
    }
    // Coordinate fallback for fill - click to focus then type
    if (action === 'fill' && coords) {
      console.log('Falling back to coordinate fill at', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      await page.keyboard.press('Control+a');
      await page.keyboard.type(value || '');
      return;
    }
    throw new Error('No selector matched: ' + JSON.stringify(validSelectors));
  }
  await locateWithFallback(page, [{"type":"role-name","value":"role=link[name=\\"Dashboard\\"]"},{"type":"text","value":"text=\\"Dashboard\\""},{"type":"css-path","value":"ul.space-y-1 > li > a.flex.items-center"}], 'click', null, {"x":109,"y":185});
  await page.goto(buildUrl(baseUrl, '/'));
}
`,
  },
  {
    name: "Google login",
    targetUrl: "http://localhost:3000",
    functionalArea: "Logins",
    setupOverrides: '{"skippedDefaultStepIds":["0f281033-f62f-41d1-b6fa-057265c28883"],"extraSteps":[]}',
    code: `export async function test(page, baseUrl, screenshotPath, stepLogger) {
  stepLogger.log('Navigate to home page');
  await page.goto(\`\${baseUrl}/\`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('domcontentloaded');
  await expect(page).toHaveURL(/\\//);
  await expect(page.locator('body')).toBeVisible();

  stepLogger.log('Click Continue with Google button');
  const googleButton = page.getByRole('button', { name: /continue with google/i });
  await expect(googleButton).toBeVisible();
  await googleButton.click();

  stepLogger.log('Wait for Google OAuth redirect');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);

  stepLogger.log('Check if redirected to Google accounts');
  const currentUrl = page.url();
  if (currentUrl.includes('accounts.google.com')) {
    stepLogger.log('Successfully redirected to Google OAuth - test completed');
  } else {
    stepLogger.log('Still on application page - OAuth flow may require manual authentication');
  }

  stepLogger.log('Take screenshot');
  await page.screenshot({ path: screenshotPath, fullPage: true });
}`,
  },
  {
    name: "Github login",
    targetUrl: "http://localhost:3000",
    functionalArea: "Logins",
    code: `export async function test(page, baseUrl, screenshotPath, stepLogger) {
  function buildUrl(base, path) {
    const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
    const cleanPath = path.startsWith('/') ? path : '/' + path;
    return cleanBase + cleanPath;
  }

  let screenshotStep = 0;
  function getScreenshotPath() {
    screenshotStep++;
    const ext = screenshotPath.lastIndexOf('.');
    if (ext > 0) {
      return screenshotPath.slice(0, ext) + '-step' + screenshotStep + screenshotPath.slice(ext);
    }
    return screenshotPath + '-step' + screenshotStep;
  }

  async function locateWithFallback(page, selectors, action, value, coords) {
    const validSelectors = selectors.filter(sel => sel.value && sel.value.trim() && !sel.value.includes('undefined'));
    for (const sel of validSelectors) {
      try {
        let locator;
        if (sel.type === 'ocr-text') {
          const text = sel.value.replace(/^ocr-text="/, '').replace(/"$/, '');
          locator = page.getByText(text, { exact: false });
        } else if (sel.type === 'role-name') {
          const match = sel.value.match(/^role=(\\w+)\\[name="(.+)"\\]$/);
          if (match) {
            locator = page.getByRole(match[1], { name: match[2] });
          } else {
            locator = page.locator(sel.value);
          }
        } else {
          locator = page.locator(sel.value);
        }
        const target = locator.first();
        await target.waitFor({ timeout: 3000 });
        if (action === 'locate') return target;
        if (action === 'click') await target.click();
        else if (action === 'fill') await target.fill(value || '');
        else if (action === 'selectOption') await target.selectOption(value || '');
        return target;
      } catch { continue; }
    }
    if (action === 'click' && coords) {
      console.log('Falling back to coordinate click at', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      return;
    }
    if (action === 'fill' && coords) {
      console.log('Falling back to coordinate fill at', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      await page.keyboard.press('Control+a');
      await page.keyboard.type(value || '');
      return;
    }
    throw new Error('No selector matched: ' + JSON.stringify(validSelectors));
  }

  stepLogger.log('Navigate to home page');
  await page.goto(buildUrl(baseUrl, '/'), { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(500);

  stepLogger.log('Click Continue with GitHub button');
  await locateWithFallback(page, [{"type":"role-name","value":"role=button[name=\\"Continue with GitHub\\"]"},{"type":"text","value":"text=\\"Continue with GitHub\\""},{"type":"css-path","value":"div.w-full.max-w-sm > div.space-y-2 > button.inline-flex.items-center"}], 'click', null, {"x":640,"y":484});

  stepLogger.log('Wait for GitHub login page');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(500);

  stepLogger.log('Fill login field');
  await locateWithFallback(page, [{"type":"id","value":"#login_field"},{"type":"name","value":"[name=\\"login\\"]"},{"type":"css-path","value":"form > div > input.form-control.js-login-field"}], 'fill', 'ew', null);

  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');

  stepLogger.log('Take screenshot');
  await page.screenshot({ path: screenshotPath, fullPage: true });
}`,
  },
  {
    name: "Recording Meta",
    targetUrl: "http://localhost:3000",
    functionalArea: "Viktor's",
    code: `import { Page } from 'playwright';

export async function test(page: Page, baseUrl: string, screenshotPath: string, stepLogger: any) {
  // Helper to build URLs safely (handles trailing/leading slashes)
  function buildUrl(base, path) {
    const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
    const cleanPath = path.startsWith('/') ? path : '/' + path;
    return cleanBase + cleanPath;
  }

  // Helper to generate unique screenshot paths
  let screenshotStep = 0;
  function getScreenshotPath() {
    screenshotStep++;
    const ext = screenshotPath.lastIndexOf('.');
    if (ext > 0) {
      return screenshotPath.slice(0, ext) + '-step' + screenshotStep + screenshotPath.slice(ext);
    }
    return screenshotPath + '-step' + screenshotStep;
  }

  // Multi-selector fallback helper with coordinate fallback for clicks
  async function locateWithFallback(page, selectors, action, value, coords) {
    const validSelectors = selectors.filter(sel => sel.value && sel.value.trim() && !sel.value.includes('undefined'));
    for (const sel of validSelectors) {
      try {
        let locator;
        if (sel.type === 'ocr-text') {
          const text = sel.value.replace(/^ocr-text="/, '').replace(/"$/, '');
          locator = page.getByText(text, { exact: false });
        } else if (sel.type === 'role-name') {
          const match = sel.value.match(/^role=(\\w+)\\[name="(.+)"\\]$/);
          if (match) {
            locator = page.getByRole(match[1], { name: match[2] });
          } else {
            locator = page.locator(sel.value);
          }
        } else {
          locator = page.locator(sel.value);
        }
        const target = locator.first();
        await target.waitFor({ timeout: 3000 });
        if (action === 'locate') return target;
        if (action === 'click') await target.click();
        else if (action === 'fill') await target.fill(value || '');
        else if (action === 'selectOption') await target.selectOption(value || '');
        return target;
      } catch { continue; }
    }
    if (action === 'click' && coords) {
      console.log('Falling back to coordinate click at', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      return;
    }
    if (action === 'fill' && coords) {
      console.log('Falling back to coordinate fill at', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      await page.keyboard.press('Control+a');
      await page.keyboard.type(value || '');
      return;
    }
    throw new Error('No selector matched: ' + JSON.stringify(validSelectors));
  }

  await page.goto(buildUrl(baseUrl, '/'));
  await locateWithFallback(page, [{"type":"role-name","value":"role=link[name=\\"Tests\\"]"},{"type":"text","value":"text=\\"Tests\\""},{"type":"css-path","value":"ul.space-y-1 > li > a.flex.items-center"}], 'click', null, {"x":128,"y":308});
  await page.goto(buildUrl(baseUrl, '/tests'));
  await locateWithFallback(page, [{"type":"role-name","value":"role=link[name=\\"Record Test\\"]"},{"type":"text","value":"text=\\"Record Test\\""},{"type":"css-path","value":"div.flex.items-center > div.flex.gap-2 > a.inline-flex.items-center"}], 'click', null, {"x":1191,"y":52});
  await page.goto(buildUrl(baseUrl, '/record'));
  await locateWithFallback(page, [{"type":"placeholder","value":"[placeholder=\\"login-success\\"]"},{"type":"css-path","value":"div.px-6.space-y-6 > div.space-y-2 > input.border-input.h-9"}], 'click', null, {"x":520,"y":353});
  await locateWithFallback(page, [{"type":"placeholder","value":"[placeholder=\\"login-success\\"]"},{"type":"css-path","value":"div.px-6.space-y-6 > div.space-y-2 > input.border-input.h-9"}], 'fill', 't', null);
  await locateWithFallback(page, [{"type":"placeholder","value":"[placeholder=\\"login-success\\"]"},{"type":"css-path","value":"div.px-6.space-y-6 > div.space-y-2 > input.border-input.h-9"}], 'fill', 'te', null);
  await locateWithFallback(page, [{"type":"placeholder","value":"[placeholder=\\"login-success\\"]"},{"type":"css-path","value":"div.px-6.space-y-6 > div.space-y-2 > input.border-input.h-9"}], 'fill', 'tes', null);
  await locateWithFallback(page, [{"type":"placeholder","value":"[placeholder=\\"login-success\\"]"},{"type":"css-path","value":"div.px-6.space-y-6 > div.space-y-2 > input.border-input.h-9"}], 'fill', 'test', null);
  await locateWithFallback(page, [{"type":"role-name","value":"role=combobox[name=\\"Local\\"]"},{"type":"text","value":"text=\\"Local\\""},{"type":"css-path","value":"div.px-6.space-y-6 > div.space-y-2 > button.border-input.flex"}], 'click', null, {"x":360,"y":629});
  await locateWithFallback(page, [{"type":"role-name","value":"role=option[name=\\"System EB-eb-2\\"]"},{"type":"css-path","value":"div.p-1 > div > div.relative.flex"}], 'click', null, {"x":397,"y":689});
  await locateWithFallback(page, [{"type":"role-name","value":"role=button[name=\\"Start Recording\\"]"},{"type":"text","value":"text=\\"Start Recording\\""},{"type":"css-path","value":"div.bg-card.text-card-foreground > div.px-6.space-y-6 > button.inline-flex.items-center"}], 'click', null, {"x":520,"y":445});
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await locateWithFallback(page, [{"type":"role-name","value":"role=button[name=\\"Stop\\"]"},{"type":"text","value":"text=\\"Stop\\""},{"type":"css-path","value":"div.flex-1.flex > div.fixed.bottom-6 > button.inline-flex.items-center"}], 'click', null, {"x":846,"y":673});
}
`,
  },
  {
    name: "Areas",
    targetUrl: "http://localhost:3000",
    functionalArea: "Viktor's",
    code: `import { Page } from 'playwright';

export async function test(page: Page, baseUrl: string, screenshotPath: string, stepLogger: any) {
  // Helper to build URLs safely (handles trailing/leading slashes)
  function buildUrl(base, path) {
    const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
    const cleanPath = path.startsWith('/') ? path : '/' + path;
    return cleanBase + cleanPath;
  }

  // Helper to generate unique screenshot paths
  let screenshotStep = 0;
  function getScreenshotPath() {
    screenshotStep++;
    const ext = screenshotPath.lastIndexOf('.');
    if (ext > 0) {
      return screenshotPath.slice(0, ext) + '-step' + screenshotStep + screenshotPath.slice(ext);
    }
    return screenshotPath + '-step' + screenshotStep;
  }

  // Multi-selector fallback helper with coordinate fallback for clicks
  async function locateWithFallback(page, selectors, action, value, coords) {
    const validSelectors = selectors.filter(sel => sel.value && sel.value.trim() && !sel.value.includes('undefined'));
    for (const sel of validSelectors) {
      try {
        let locator;
        if (sel.type === 'ocr-text') {
          const text = sel.value.replace(/^ocr-text="/, '').replace(/"$/, '');
          locator = page.getByText(text, { exact: false });
        } else if (sel.type === 'role-name') {
          const match = sel.value.match(/^role=(\\w+)\\[name="(.+)"\\]$/);
          if (match) {
            locator = page.getByRole(match[1], { name: match[2] });
          } else {
            locator = page.locator(sel.value);
          }
        } else {
          locator = page.locator(sel.value);
        }
        const target = locator.first();
        await target.waitFor({ timeout: 3000 });
        if (action === 'locate') return target;
        if (action === 'click') await target.click();
        else if (action === 'fill') await target.fill(value || '');
        else if (action === 'selectOption') await target.selectOption(value || '');
        return target;
      } catch { continue; }
    }
    if (action === 'click' && coords) {
      console.log('Falling back to coordinate click at', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      return;
    }
    if (action === 'fill' && coords) {
      console.log('Falling back to coordinate fill at', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      await page.keyboard.press('Control+a');
      await page.keyboard.type(value || '');
      return;
    }
    throw new Error('No selector matched: ' + JSON.stringify(validSelectors));
  }

  await page.goto(buildUrl(baseUrl, '/'));
  await locateWithFallback(page, [{"type":"role-name","value":"role=link[name=\\"Areas\\"]"},{"type":"text","value":"text=\\"Areas\\""},{"type":"css-path","value":"ul.space-y-1 > li > a.flex.items-center"}], 'click', null, {"x":128,"y":268});
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.goto(buildUrl(baseUrl, '/areas'));
  await locateWithFallback(page, [{"type":"css-path","value":"div.bg-muted/30.h-full > div.h-full.flex > div.p-3.border-b"}], 'click', null, {"x":358,"y":25});
  await locateWithFallback(page, [{"type":"css-path","value":"div.h-full.flex > div.p-3.border-b > button.inline-flex.items-center"}], 'click', null, {"x":437,"y":24});
  await page.keyboard.type(new Date().toISOString());
  await locateWithFallback(page, [{"type":"role-name","value":"role=button[name=\\"Create\\"]"},{"type":"text","value":"text=\\"Create\\""},{"type":"css-path","value":"div.bg-background.fixed > div.flex.flex-col-reverse > button.inline-flex.items-center"}], 'click', null, {"x":833,"y":507});
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.goto(buildUrl(baseUrl, '/areas'));
  await locateWithFallback(page, [{"type":"css-path","value":"div > div.group.flex > span.flex-1.truncate"}], 'click', null, {"x":499,"y":425});
  await locateWithFallback(page, [{"type":"role-name","value":"role=button[name=\\"Edit\\"]"},{"type":"text","value":"text=\\"Edit\\""},{"type":"css-path","value":"div.\\\\@container/card-header.auto-rows-min > div.flex.gap-1 > button.inline-flex.items-center"}], 'click', null, {"x":1151,"y":639});
  await locateWithFallback(page, [{"type":"id","value":"#description"},{"type":"css-path","value":"div.px-6.space-y-4 > div.space-y-2 > textarea.border-input.w-full"}], 'click', null, {"x":870,"y":474});
  await locateWithFallback(page, [{"type":"id","value":"#description"},{"type":"role-name","value":"role=textbox[name=\\"12\\"]"},{"type":"css-path","value":"div.px-6.space-y-4 > div.space-y-2 > textarea.border-input.w-full"}], 'fill', '123', null);
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await locateWithFallback(page, [{"type":"role-name","value":"role=button[name=\\"Save\\"]"},{"type":"text","value":"text=\\"Save\\""},{"type":"css-path","value":"div.\\\\@container/card-header.auto-rows-min > div.flex.gap-2 > button.inline-flex.items-center"}], 'click', null, {"x":1187,"y":279});
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.goto(buildUrl(baseUrl, '/areas'));
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
}
`,
  },
  {
    name: "Env Setup",
    targetUrl: "http://localhost:3000",
    functionalArea: "Viktor's",
    code: `import { Page } from 'playwright';

export async function test(page: Page, baseUrl: string, screenshotPath: string, stepLogger: any) {
  // Helper to build URLs safely (handles trailing/leading slashes)
  function buildUrl(base, path) {
    const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
    const cleanPath = path.startsWith('/') ? path : '/' + path;
    return cleanBase + cleanPath;
  }

  // Helper to generate unique screenshot paths
  let screenshotStep = 0;
  function getScreenshotPath() {
    screenshotStep++;
    const ext = screenshotPath.lastIndexOf('.');
    if (ext > 0) {
      return screenshotPath.slice(0, ext) + '-step' + screenshotStep + screenshotPath.slice(ext);
    }
    return screenshotPath + '-step' + screenshotStep;
  }

  // Multi-selector fallback helper with coordinate fallback for clicks
  async function locateWithFallback(page, selectors, action, value, coords) {
    const validSelectors = selectors.filter(sel => sel.value && sel.value.trim() && !sel.value.includes('undefined'));
    for (const sel of validSelectors) {
      try {
        let locator;
        if (sel.type === 'ocr-text') {
          const text = sel.value.replace(/^ocr-text="/, '').replace(/"$/, '');
          locator = page.getByText(text, { exact: false });
        } else if (sel.type === 'role-name') {
          const match = sel.value.match(/^role=(\\w+)\\[name="(.+)"\\]$/);
          if (match) {
            locator = page.getByRole(match[1], { name: match[2] });
          } else {
            locator = page.locator(sel.value);
          }
        } else {
          locator = page.locator(sel.value);
        }
        const target = locator.first();
        await target.waitFor({ timeout: 3000 });
        if (action === 'locate') return target;
        if (action === 'click') await target.click();
        else if (action === 'fill') await target.fill(value || '');
        else if (action === 'selectOption') await target.selectOption(value || '');
        return target;
      } catch { continue; }
    }
    if (action === 'click' && coords) {
      console.log('Falling back to coordinate click at', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      return;
    }
    if (action === 'fill' && coords) {
      console.log('Falling back to coordinate fill at', coords.x, coords.y);
      await page.mouse.click(coords.x, coords.y);
      await page.keyboard.press('Control+a');
      await page.keyboard.type(value || '');
      return;
    }
    throw new Error('No selector matched: ' + JSON.stringify(validSelectors));
  }

  await page.goto(buildUrl(baseUrl, '/'));
  await locateWithFallback(page, [{"type":"role-name","value":"role=link[name=\\"Env Setup\\"]"},{"type":"text","value":"text=\\"Env Setup\\""},{"type":"css-path","value":"ul.space-y-1 > li > a.flex.items-center"}], 'click', null, {"x":128,"y":348});
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.goto(buildUrl(baseUrl, '/env'));
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
  await locateWithFallback(page, [{"type":"role-name","value":"role=button[name=\\"New Config\\"]"},{"type":"text","value":"text=\\"New Config\\""},{"type":"css-path","value":"div.bg-card.text-card-foreground > div.\\\\@container/card-header.auto-rows-min > button.inline-flex.items-center"}], 'click', null, {"x":1124,"y":449});
  await locateWithFallback(page, [{"type":"id","value":"#authType"},{"type":"role-name","value":"role=combobox[name=\\"None\\"]"},{"type":"text","value":"text=\\"None\\""},{"type":"css-path","value":"div.space-y-4 > div.space-y-2 > button.border-input.flex"}], 'click', null, {"x":452,"y":453});
  await locateWithFallback(page, [{"type":"role-name","value":"role=option[name=\\"Basic Auth\\"]"},{"type":"css-path","value":"div.bg-popover.text-popover-foreground > div.p-1 > div.relative.flex"}], 'click', null, {"x":490,"y":517});
  await locateWithFallback(page, [{"type":"role-name","value":"role=button[name=\\"Cancel\\"]"},{"type":"text","value":"text=\\"Cancel\\""},{"type":"css-path","value":"div.bg-background.fixed > div.flex.flex-col-reverse > button.inline-flex.items-center"}], 'click', null, {"x":746,"y":543});
}
`,
  },
];

async function seed() {
  // Find the source repository
  const [repo] = await db
    .select()
    .from(repositories)
    .where(eq(repositories.fullName, SOURCE_REPO_NAME));

  if (!repo) {
    console.error(`Repository "${SOURCE_REPO_NAME}" not found. Please create it first.`);
    process.exit(1);
  }

  REPO_ID = repo.id;
  console.log(`Found repository: ${SOURCE_REPO_NAME} (${REPO_ID})`);

  // Create functional areas (with hierarchy)
  const faMap = new Map<string, string>();
  for (const faDef of FUNCTIONAL_AREA_DEFINITIONS) {
    const faId = uuid();
    await db.insert(functionalAreas).values({
      id: faId,
      repositoryId: REPO_ID,
      name: faDef.name,
      parentId: faDef.parent ? faMap.get(faDef.parent) ?? null : null,
    });
    faMap.set(faDef.name, faId);
    console.log(`Created functional area: ${faDef.name}${faDef.parent ? ` (child of ${faDef.parent})` : ''}`);
  }

  console.log('Seeding lastest self-tests...\n');

  const now = new Date();

  for (const def of TEST_DEFINITIONS) {
    const testId = uuid();

    await db.insert(tests).values({
      id: testId,
      repositoryId: REPO_ID,
      functionalAreaId: def.functionalArea ? faMap.get(def.functionalArea) ?? null : null,
      name: def.name,
      code: def.code,
      targetUrl: def.targetUrl,
      createdAt: now,
      updatedAt: now,
      setupOverrides: def.setupOverrides ?? null,
      requiredCapabilities: def.requiredCapabilities ?? null,
    });

    // Create initial version
    await db.insert(testVersions).values({
      id: uuid(),
      testId,
      version: 1,
      code: def.code,
      name: def.name,
      targetUrl: def.targetUrl,
      changeReason: 'initial',
      createdAt: now,
    });

    console.log(`Created test: ${def.name}`);
  }

  console.log(`\nSeed complete! Created ${TEST_DEFINITIONS.length} tests.`);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
