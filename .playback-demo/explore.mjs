import { chromium } from "playwright";

const OUT =
  "/private/tmp/claude-501/-Users-ewyct-dev-lastest/f600801e-7f3a-4f05-9afd-55bfdbb67399/scratchpad";
const TEST_ID = "f081ce67-db30-4901-8f5b-46008c509878";

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1500, height: 950 },
});
await ctx.addCookies([
  {
    name: "lastest_cookie_notice",
    value: "true",
    domain: "localhost",
    path: "/",
  },
]);
const page = await ctx.newPage();

await page.goto("http://localhost:3000/login");
await page.locator('input[type="email"]').fill("demo@lastest.local");
await page.locator('input[type="password"]').fill("DemoPassw0rd!");
await page.locator('button[type="submit"]').click();
await page.waitForTimeout(4000);
console.log("after login:", page.url());
await page.screenshot({ path: `${OUT}/01-after-login.png` });

const consent = page.getByRole("button", { name: /^Got it$/i });
if (await consent.count())
  await consent
    .first()
    .click()
    .catch(() => {});
await page.waitForTimeout(500);

if (page.url().includes("/onboarding")) {
  await page.getByRole("button", { name: /Skip setup/i }).click();
  await page.waitForTimeout(4000);
  console.log("after skip:", page.url());
}

await page.waitForTimeout(2000);
// Pick the seeded repo in the sidebar so /tests/<id> resolves.
const picker = page.locator('button:has-text("Select reposit")');
if (await picker.count()) {
  await picker.first().click();
  await page.waitForTimeout(1200);
  await page
    .getByText(/lastest-local/i)
    .first()
    .click();
  await page.waitForTimeout(3000);
}
console.log("before nav:", page.url());
await page.goto(`http://localhost:3000/tests/${TEST_ID}`, {
  waitUntil: "domcontentloaded",
});
await page.waitForLoadState("networkidle").catch(() => {});
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/02-test-detail.png`, fullPage: true });

// Open the Recordings tab — the primary spec-28 surface.
await page
  .getByRole("tab", { name: /^Recordings$/i })
  .click()
  .catch(async () => {
    await page.locator('button:has-text("Recordings")').first().click();
  });
await page.waitForTimeout(3000);
await page.screenshot({ path: `${OUT}/03-recordings.png`, fullPage: false });

const segs = page.locator('[aria-label="Test steps"] button');
console.log("segment ticks:", await segs.count());
console.log("videos:", await page.locator("video").count());
const texts = await page.locator("h2, h3, [role=tab], button").allInnerTexts();
console.log(
  "labels:",
  JSON.stringify(
    [...new Set(texts.map((t) => t.trim()).filter(Boolean))].slice(0, 60),
  ),
);

await browser.close();
