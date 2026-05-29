import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { execSync } from 'node:child_process';

const URL = process.argv[2] || 'http://localhost:3000/verify/9abdb94a-6279-47f7-b5b8-c0377d90ce9c?mode=focus&step=25943ff3-081d-4c1c-88f4-acabe260c3c4';
const cookieStr = execSync('pnpm -s tsx scripts/dev-session-cookie.ts', { encoding: 'utf8' }).trim().split('\n').pop();
const [name, value] = cookieStr.split('=');
console.log('Using cookie:', name, '=', value.slice(0, 20) + '…');

const browser = await chromium.launch();
const ctx = await browser.newContext();
await ctx.addCookies([{ name, value, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
const page = await ctx.newPage();
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
await page.goto(URL, { waitUntil: 'networkidle', timeout: 45000 });
await page.waitForTimeout(3500);
console.log('FINAL_URL=' + page.url());
console.log('TITLE=' + await page.title());

const results = await new AxeBuilder({ page }).withTags(['wcag2aa', 'wcag22aa']).analyze();
console.log('VIOLATIONS=' + results.violations.length);
for (const v of results.violations) {
  console.log('--- ' + v.id + ' [' + v.impact + '] ' + v.help);
  for (const n of v.nodes.slice(0, 5)) {
    console.log('  target=' + JSON.stringify(n.target));
    console.log('  html=' + n.html.replace(/\s+/g, ' ').slice(0, 260));
    console.log('  fail=' + (n.failureSummary || '').replace(/\s+/g, ' ').slice(0, 280));
  }
}
console.log('CONSOLE_ERRORS=' + consoleErrors.length);
for (const e of consoleErrors.slice(0, 5)) console.log('  ' + e.slice(0, 200));
await browser.close();
