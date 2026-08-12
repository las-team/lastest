import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
const page = await ctx.newPage();
await page.goto("http://localhost:3000/register", {
  waitUntil: "domcontentloaded",
});
await page.waitForTimeout(3000);

const cb = page.locator('[role="checkbox"]').first();
const box = await cb.boundingBox();
console.log("cb box:", JSON.stringify(box));
const topEl = await page.evaluate((b) => {
  const el = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
  return el ? el.outerHTML.slice(0, 200) : "none";
}, box);
console.log("elementFromPoint:", topEl);

console.log("checkbox count:", await page.locator('[role="checkbox"]').count());
console.log("cb html:", (await cb.evaluate((e) => e.outerHTML)).slice(0, 300));

// Try a plain click and see what happens
await cb.click();
await page.waitForTimeout(1000);
console.log("after plain click:", await cb.getAttribute("aria-checked"));
await page.waitForTimeout(3000);
console.log("after settle:", await cb.getAttribute("aria-checked"));
// Try keyboard
await cb.focus();
await page.keyboard.press("Space");
await page.waitForTimeout(1000);
console.log("after space:", await cb.getAttribute("aria-checked"));
await browser.close();
