/**
 * Records a demo of the spec-28 interactive playback UI driving a real test
 * recording (test result 535dcb54… — 20 persisted step timings, 17.3s webm).
 *
 * Scene 1: test-detail Recordings card (annotated scrubber, click-to-seek,
 *          active-step highlight, 8x rate presets).
 * Scene 2: Verify focus mode Run pane with the same player embedded.
 */
import { chromium } from "playwright";

const OUT = "/Users/ewyct/dev/lastest/.playback-demo";
const TEST_ID = "f081ce67-db30-4901-8f5b-46008c509878";
const BUILD_ID = "f3a8dc04-a87d-44c4-bb50-d3234e37db0a";

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: `${OUT}/raw2`, size: { width: 1440, height: 900 } },
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
const log = (m) => console.log(`[demo] ${m}`);

const state = async (label) => {
  const s = await page.evaluate(() => {
    const v = document.querySelector("video");
    return v
      ? {
          t: +v.currentTime.toFixed(2),
          dur: +(v.duration || 0).toFixed(2),
          paused: v.paused,
          rate: v.playbackRate,
        }
      : null;
  });
  log(`${label}: ${JSON.stringify(s)}`);
  return s;
};

// ── sign in ───────────────────────────────────────────────────────────────
await page.goto("http://localhost:3000/login");
await page.locator('input[type="email"]').fill("demo@lastest.local");
await page.locator('input[type="password"]').fill("DemoPassw0rd!");
await page.locator('button[type="submit"]').click();
await page.waitForTimeout(4000);

const picker = page.locator('button:has-text("Select reposit")');
if (await picker.count()) {
  await picker.first().click();
  await page.waitForTimeout(1000);
  await page
    .getByText(/lastest-local/i)
    .first()
    .click();
  await page.waitForTimeout(2500);
}

// ── scene 1 ───────────────────────────────────────────────────────────────
await page.goto(`http://localhost:3000/tests/${TEST_ID}`, {
  waitUntil: "domcontentloaded",
});
await page.waitForTimeout(3500);
await page
  .getByRole("tab", { name: /^Recordings$/i })
  .click()
  .catch(async () => {
    await page.locator('button:has-text("Recordings")').first().click();
  });
await page.waitForTimeout(2500);

const video = page.locator("video").first();
await video.scrollIntoViewIfNeeded();
await page.mouse.wheel(0, 120);
await page.waitForTimeout(1500);

const box = await video.boundingBox();
const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
const wake = async () => {
  await page.mouse.move(centre.x, centre.y + 40);
  await page.mouse.move(centre.x, centre.y);
};
await wake();
await page.waitForTimeout(1500);

const segs = page.locator('[aria-label="Test steps"] button');
const segCount = await segs.count();
log(`segment ticks: ${segCount}`);
for (let i = 0; i < Math.min(segCount, 20); i++) {
  log(`  tick ${i}: ${await segs.nth(i).getAttribute("aria-label")}`);
}

// Hover ticks so the per-step tooltips/hover states show on camera.
// (wake first: the control overlay auto-hides and the <video> then eats
// pointer events; several steps are also zero-length so they overlap.)
for (const i of [2, 4, 8]) {
  if (i >= segCount) continue;
  await wake();
  await segs.nth(i).hover({ force: true });
  await page.waitForTimeout(1100);
}

// Play with the control-bar button (not a click on the surface).
await page.getByRole("button", { name: "Play" }).first().click();
await page.waitForTimeout(1200);
await state("after play");
for (let i = 0; i < 8; i++) {
  await page.waitForTimeout(1000);
  await wake();
}
await state("after ~8s of playback");

// Click a step tick mid-playback → seek to that step.
if (segCount > 13) {
  await wake();
  await segs.nth(13).click({ force: true });
  log(`seek via tick 13 → ${await segs.nth(13).getAttribute("aria-label")}`);
  await page.waitForTimeout(800);
  await state("after tick seek");
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(1000);
    await wake();
  }
}

// Seek back to an earlier step to show the active highlight moving.
if (segCount > 5) {
  await wake();
  await segs.nth(5).click({ force: true });
  await page.waitForTimeout(800);
  await state("after seeking back to step 6");
  for (let i = 0; i < 3; i++) {
    await page.waitForTimeout(1000);
    await wake();
  }
}

// Speed presets now reach 8x.
const rate = page.locator('button[aria-label^="Playback speed"]').first();
if (await rate.count()) {
  await rate.click();
  await page.waitForTimeout(1500);
  const eight = page.getByRole("button", { name: "8x", exact: true });
  if (await eight.count()) {
    await eight.first().click();
    log("selected 8x");
  }
  await page.waitForTimeout(1000);
  await wake();
  await page.waitForTimeout(2500);
  await state("at 8x");
}

// ── scene 2: Verify focus mode Run pane ──────────────────────────────────
await page.goto(`http://localhost:3000/verify/${BUILD_ID}`, {
  waitUntil: "domcontentloaded",
});
await page.waitForTimeout(5000);
await page.screenshot({ path: `${OUT}/04-verify-board.png` });

const focusToggle = page.getByRole("button", { name: /^Focus$/ });
if (await focusToggle.count()) {
  await focusToggle
    .first()
    .click()
    .catch(() => {});
  await page.waitForTimeout(3000);
}
await page.screenshot({ path: `${OUT}/05-verify-focus.png` });

const runTab = page.locator('button[aria-label^="Run —"]').first();
if (await runTab.count()) {
  await runTab.click().catch(() => {});
  log("opened the Run evidence tab");
  await page.waitForTimeout(3000);
}
await page.screenshot({
  path: `${OUT}/06-verify-run-pane.png`,
  fullPage: true,
});

const v2 = page.locator("video").first();
if (await v2.count()) {
  await v2.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);
  const b2 = await v2.boundingBox();
  if (b2) {
    const c2 = { x: b2.x + b2.width / 2, y: b2.y + b2.height / 2 };
    await page.mouse.move(c2.x, c2.y);
    await page.waitForTimeout(800);
    const play2 = page.getByRole("button", { name: "Play" }).first();
    if (await play2.count()) await play2.click().catch(() => {});
    await state("verify run pane");
    for (let i = 0; i < 7; i++) {
      await page.waitForTimeout(1000);
      await page.mouse.move(c2.x, c2.y + 30);
      await page.mouse.move(c2.x, c2.y);
    }
    await state("verify run pane end");
  }
} else {
  log("no video element in the Verify Run pane");
}

await page.waitForTimeout(1500);
await ctx.close();
await browser.close();
log("done");
