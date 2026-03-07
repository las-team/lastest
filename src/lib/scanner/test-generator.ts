import { RouteInfo } from './types';

export function generateSmokeTest(route: RouteInfo, baseUrl: string): string {
  const testName = `Smoke test: ${route.path}`;
  const cleanBaseUrl = baseUrl.replace(/\/+$/, '');
  const url = route.routerType === 'hash'
    ? `${cleanBaseUrl}/#${route.path}`
    : `${cleanBaseUrl}${route.path}`;

  return `import { test, expect } from '@playwright/test';

test('${testName}', async ({ page }) => {
  // Navigate to route
  await page.goto('${url}');

  // Wait for page to be ready
  await page.waitForLoadState('networkidle');

  // Take screenshot
  await page.screenshot({ fullPage: true });
});
`;
}

export function generateSmokeTestCode(route: RouteInfo): string {
  const routePath = route.routerType === 'hash'
    ? `/#${route.path}`
    : route.path;

  // Return just the test body code (for storing in DB)
  // Uses the runtime `baseUrl` parameter from the test function signature
  return `await page.goto(\`\${baseUrl}${routePath}\`);
await page.waitForLoadState('load');
await page.screenshot({ fullPage: true });`;
}
