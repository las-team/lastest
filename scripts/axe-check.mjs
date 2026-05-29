import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AXE_PATH = resolve(__dirname, '../node_modules/.pnpm/axe-core@4.11.1/node_modules/axe-core/axe.min.js');
const axeSource = readFileSync(AXE_PATH, 'utf8');

const TARGETS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['http://localhost:3000/login', 'http://localhost:3000/register', 'http://localhost:3000/'];

const browser = await chromium.launch({ headless: true });
try {
  for (const url of TARGETS) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    if (process.env.DARK) {
      await page.evaluate(() => document.documentElement.classList.add('dark'));
    }
    await page.addScriptTag({ content: axeSource });
    const result = await page.evaluate(async () => {
      return await window.axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      });
    });
    console.log('\n=== ' + url + ' ===');
    console.log('violations:', result.violations.length);
    for (const v of result.violations) {
      console.log('  - [' + v.impact + '] ' + v.id + ': ' + v.description + ' (' + v.nodes.length + ' nodes)');
      for (const n of v.nodes.slice(0, 6)) {
        console.log('      target: ' + JSON.stringify(n.target));
        if (n.failureSummary) console.log('      fail: ' + n.failureSummary.replace(/\n+/g, ' | ').slice(0, 350));
        if (n.html) console.log('      html: ' + n.html.slice(0, 220));
      }
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
