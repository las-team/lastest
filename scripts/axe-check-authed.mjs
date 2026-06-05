import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AXE_PATH = resolve(
  __dirname,
  "../node_modules/.pnpm/axe-core@4.11.1/node_modules/axe-core/axe.min.js",
);
const axeSource = readFileSync(AXE_PATH, "utf8");

const BASE = process.env.BASE || "http://localhost:3000";
const email = `axe-${Date.now().toString(36)}@lastest.cloud`;
const password = "AxeCheck123!";

function markOnboardingComplete(targetEmail) {
  // shell quoting `"user"` is awkward inside `docker exec ... -c "..."`, so
  // pipe the SQL on stdin instead.
  const sql = `UPDATE users SET onboarding_completed_at = NOW() WHERE email = '${targetEmail}';`;
  execSync(`docker exec -i lastest-dev-db psql -U lastest -d lastest`, {
    input: sql,
    stdio: ["pipe", "inherit", "inherit"],
  });
}

const browser = await chromium.launch({ headless: true });
try {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });
  const page = await ctx.newPage();

  // Register a fresh user
  await page.goto(`${BASE}/register`, { waitUntil: "networkidle" });
  await page.locator("#name").fill("Axe Check");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.locator('button[role="checkbox"]#terms').click();
  await page.getByRole("button", { name: "Create account" }).click();
  // wait for navigation away from /register
  await page.waitForURL((u) => !u.toString().includes("/register"), {
    timeout: 30000,
  });
  await page.waitForLoadState("networkidle");

  // Fast-forward past onboarding so we can audit the real dashboard chrome.
  markOnboardingComplete(email);

  const TARGETS = process.env.PAGES ? process.env.PAGES.split(",") : ["/"];
  for (const path of TARGETS) {
    await page.goto(`${BASE}${path}`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page
      .waitForLoadState("networkidle", { timeout: 60000 })
      .catch(() => {});
    await page.addScriptTag({ content: axeSource });
    const result2 = await page.evaluate(async () => {
      return await window.axe.run(document, {
        runOnly: {
          type: "tag",
          values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
        },
      });
    });
    console.log("\n=== " + page.url() + " ===");
    console.log("violations:", result2.violations.length);
    for (const v of result2.violations) {
      console.log(
        `\n[${v.impact}] ${v.id}: ${v.description}  (${v.nodes.length} nodes)`,
      );
      for (const n of v.nodes) {
        console.log("  target: " + JSON.stringify(n.target));
        if (n.failureSummary)
          console.log(
            "  fail: " + n.failureSummary.replace(/\n+/g, " | ").slice(0, 320),
          );
        if (n.html) console.log("  html: " + n.html.slice(0, 260));
      }
    }
  }
  // skip the original single-page block below
  process.exit(0);
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });

  await page.addScriptTag({ content: axeSource });
  const result = await page.evaluate(async () => {
    return await window.axe.run(document, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
      },
    });
  });
  console.log("Authed page URL:", page.url());
  console.log("violations:", result.violations.length);
  for (const v of result.violations) {
    console.log(
      `\n[${v.impact}] ${v.id}: ${v.description}  (${v.nodes.length} nodes)`,
    );
    for (const n of v.nodes) {
      console.log("  target: " + JSON.stringify(n.target));
      if (n.failureSummary)
        console.log(
          "  fail: " + n.failureSummary.replace(/\n+/g, " | ").slice(0, 320),
        );
      if (n.html) console.log("  html: " + n.html.slice(0, 260));
    }
  }
} finally {
  await browser.close();
}
