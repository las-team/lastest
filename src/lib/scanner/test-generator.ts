import { RouteInfo } from './types';

export function generateSmokeTest(route: RouteInfo, baseUrl: string): string {
  const testName = `Smoke test: ${route.path}`;
  const url = route.routerType === 'hash'
    ? `${baseUrl}/#${route.path}`
    : `${baseUrl}${route.path}`;

  return `import { test, expect } from '@playwright/test';

test('${testName}', async ({ page }) => {
  const consoleErrors: string[] = [];
  const networkFailures: { url: string; status: number }[] = [];

  // Capture console errors
  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  // Capture network failures
  page.on('response', response => {
    if (response.status() >= 400) {
      networkFailures.push({
        url: response.url(),
        status: response.status(),
      });
    }
  });

  // Navigate to route
  await page.goto('${url}');

  // Wait for page to be ready
  await page.waitForLoadState('networkidle');

  // Take screenshot
  await page.screenshot({ fullPage: true });

  // Assert no console errors
  expect(consoleErrors, 'Console errors detected').toHaveLength(0);

  // Assert no network failures
  expect(networkFailures, 'Network failures detected').toHaveLength(0);
});
`;
}

export function generateSmokeTestCode(route: RouteInfo): string {
  const routePath = route.routerType === 'hash'
    ? `/#${route.path}`
    : route.path;

  // Return just the test body code (for storing in DB)
  // Uses the runtime `baseUrl` parameter from the test function signature
  return `const consoleErrors = [];
const networkFailures = [];

page.on('console', msg => {
  if (msg.type() === 'error') {
    consoleErrors.push(msg.text());
  }
});

page.on('response', response => {
  if (response.status() >= 400) {
    networkFailures.push({
      url: response.url(),
      status: response.status(),
    });
  }
});

await page.goto(\`\${baseUrl}${routePath}\`);
await page.waitForLoadState('load');
await page.screenshot({ fullPage: true });

expect(consoleErrors, 'Console errors detected').toHaveLength(0);
expect(networkFailures, 'Network failures detected').toHaveLength(0);`;
}
