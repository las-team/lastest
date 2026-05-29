import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AXE_PATH = resolve(__dirname, '../node_modules/.pnpm/axe-core@4.11.1/node_modules/axe-core/axe.min.js');
const axeSource = readFileSync(AXE_PATH, 'utf8');

const BASE = process.env.BASE || 'http://localhost:3000';
const email = `axe-onb-${Date.now().toString(36)}@lastest.cloud`;
const password = 'AxeCheck123!';

const browser = await chromium.launch({ headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/register`, { waitUntil: 'networkidle' });
  await page.locator('#name').fill('Axe Onb');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.locator('button[role="checkbox"]#terms').click();
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL(/onboarding/, { timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});

  await page.addScriptTag({ content: axeSource });
  const result = await page.evaluate(async () => {
    return await window.axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
    });
  });
  console.log('=== ' + page.url() + ' ===');
  console.log('violations:', result.violations.length);
  for (const v of result.violations) {
    console.log(`[${v.impact}] ${v.id}: ${v.description}  (${v.nodes.length} nodes)`);
    for (const n of v.nodes) {
      console.log('  target: ' + JSON.stringify(n.target));
      if (n.failureSummary) console.log('  fail: ' + n.failureSummary.replace(/\n+/g, ' | ').slice(0, 300));
      if (n.html) console.log('  html: ' + n.html.slice(0, 240));
    }
  }
} finally {
  await browser.close();
}
