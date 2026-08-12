import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
const page = await ctx.newPage();
page.on("console", (m) => console.log("[c]", m.text().slice(0, 250)));

await page.goto("http://localhost:3000/register", {
  waitUntil: "domcontentloaded",
});
await page.fill("input#name", "N");
await page.fill("input#email", `dbg-${Date.now()}@example.test`);
await page.fill("input#password", "GoldenPath!2026");
const terms = page.locator("#terms");
for (let i = 0; i < 20; i++) {
  if ((await terms.getAttribute("aria-checked")) === "true") break;
  await terms.click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(400);
}

const v = await page.evaluate(() => {
  const form = document.querySelector("form");
  const invalid = [...form.querySelectorAll(":invalid")].map((el) => ({
    tag: el.tagName,
    type: el.type,
    id: el.id,
    name: el.name,
    required: el.required,
    checked: el.checked,
    value: (el.value || "").slice(0, 20),
    msg: el.validationMessage,
    styles: getComputedStyle(el).position + "/" + getComputedStyle(el).opacity,
  }));
  return { valid: form.checkValidity(), invalid };
});
console.log(JSON.stringify(v, null, 1));
await browser.close();
