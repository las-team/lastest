/**
 * Shared harness for the §4 golden-path browser suite
 * (`docs/architecture/core-plugin-refactor-test-plan.md`).
 *
 * §2.18 closed §1–§3 but recorded one honest gap: "No browser-automation tool
 * was available in this environment, so nothing requiring an actual
 * rendered/interactive UI was exercised end to end." That is precisely what
 * §4 exists to cover, and it is now closable — Playwright + Chromium are
 * host dependencies of this repo already (`playwright` in the root
 * package.json), so these suites drive the *real* Next.js app over HTTP at
 * `LASTEST_E2E_BASE_URL` (default `http://localhost:3000`) in a real browser.
 *
 * What that buys over §3, which already covered the data/pipeline layer
 * hard: the things only a renderer can prove — that `libs/ui`'s re-exported
 * primitives actually resolve at runtime (§2.10), that tabbed surfaces
 * switch content (§2.10), that the 500ms-debounced settings autosave really
 * persists across a reload (§2.2), that the EB live-stream viewer paints
 * (§2.1), and that a public share link renders with no session at all.
 *
 * Prerequisites (same as every other integration suite here, plus the app):
 *   docker compose up -d          # host postgres
 *   pnpm dev:pool                 # EB pool service
 *   pnpm dev                      # the app itself, on :3000
 *
 * Run with `pnpm test:integration`.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import * as queries from "@/lib/db/queries";

export const BASE_URL =
  process.env.LASTEST_E2E_BASE_URL ?? "http://localhost:3000";

/** Headed runs are occasionally worth it when a selector stops matching. */
const HEADLESS = process.env.LASTEST_E2E_HEADED !== "1";

// ── Target app under test ────────────────────────────────────────────────
//
// A tiny in-process site standing in for "the customer's app". Kept
// deliberately close to the one in
// `src/lib/execution/full-build-pipeline.integration.test.ts` so a failure
// here vs. there is attributable to the UI layer rather than to a different
// page: same off-token CTA colour, same versioned mutation, same
// interaction. Bound to loopback because in process-provisioner mode the EB
// is a child process on this same host.

export interface TargetApp {
  origin: string;
  /** Flip the rendered page so a subsequent build produces a real diff. */
  setVersion(v: 1 | 2 | 3): void;
  close(): Promise<void>;
}

const CTA_COLORS: Record<number, string> = {
  1: "#ff0000", // off-token red — drives a design-system violation
  2: "#1e40af", // blue — a real visible change vs. v1
  3: "#15803d", // green — a second change, for the reject path
};

export async function startTargetApp(): Promise<TargetApp> {
  let version: 1 | 2 | 3 = 1;

  const render = () => `<!doctype html>
<html lang="en"><head><title>golden-path target</title></head>
<body style="margin:0;background:#ffffff;color:#000000;font-family:Arial,sans-serif;">
  <h1 style="margin:16px;">Golden path target v${version}</h1>
  <label for="name-input" style="position:absolute;top:60px;left:40px;">Name</label>
  <input id="name-input" data-testid="name-input" style="position:absolute;top:60px;left:100px;" />
  <button id="submit-btn" data-testid="submit-btn" style="position:absolute;top:60px;left:280px;">Submit</button>
  <div id="result" style="position:absolute;top:100px;left:40px;"></div>
  <button id="cta" style="position:absolute;top:140px;left:40px;width:220px;height:56px;background:${CTA_COLORS[version]};color:#fff;border:none;border-radius:4px;">Buy Now</button>
  <script>
    document.getElementById('submit-btn').addEventListener('click', function () {
      document.getElementById('result').textContent =
        'Hello, ' + document.getElementById('name-input').value + '!';
    });
  </script>
</body></html>`;

  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(render());
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    origin,
    setVersion: (v) => {
      version = v;
    },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

// ── Browser ──────────────────────────────────────────────────────────────

export interface Session {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  email: string;
  password: string;
  /** Console errors seen on this page, minus known-benign noise. */
  consoleErrors: string[];
  close(): Promise<void>;
}

/**
 * Next's dev-mode hydration diagnostics are not a product defect and would
 * otherwise turn every assertion about "no console errors" into noise. Kept
 * as an explicit, reviewable list rather than dropping the check entirely.
 */
const BENIGN_CONSOLE = [
  /hydrat/i,
  /Download the React DevTools/i,
  /Fast Refresh/i,
  /\[Fast Refresh\]/i,
  /source-?map/i,
];

export async function launchSession(): Promise<Session> {
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text();
    if (BENIGN_CONSOLE.some((re) => re.test(text))) return;
    consoleErrors.push(text);
  });

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return {
    browser,
    context,
    page,
    email: `e2e-${stamp}@example.test`,
    password: "GoldenPath!2026",
    consoleErrors,
    close: async () => {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    },
  };
}

// ── Auth / onboarding, driven through the real UI ────────────────────────

/**
 * Register through the actual form. Better-auth is configured without email
 * verification (`src/lib/auth/auth.ts`), so this auto-signs-in and lands on
 * `/onboarding` — which is itself §4 step 1's assertion.
 */
export async function registerViaUi(
  s: Session,
  name = "Golden Path",
): Promise<void> {
  await s.page.goto(`${BASE_URL}/register`, { waitUntil: "domcontentloaded" });
  await s.page.fill("input#name", name);
  await s.page.fill("input#email", s.email);
  await s.page.fill("input#password", s.password);
  // Radix Checkbox renders as button[role=checkbox], not <input>.
  await s.page.locator('[role="checkbox"]').first().click();
  await s.page.getByRole("button", { name: /create account/i }).click();
  await s.page.waitForURL(/\/onboarding/, { timeout: 60_000 });
}

/**
 * Walk the wizard: path → "Use a sandbox" (Blank template) → target URL.
 *
 * The Blank template is the one branch that takes a caller-supplied URL, so
 * it is the only way to land onboarding on a *deterministic local* target
 * rather than a third-party demo site. `createLocalRepo` also seeds a
 * generic smoke test against that URL, which is what §4 step 4 then looks
 * for in the Tests tree.
 */
export async function onboardWithSandbox(
  s: Session,
  targetUrl: string,
  projectName: string,
): Promise<void> {
  const page = s.page;

  // Step 1 — pick the "Manual" path (no AI/MCP dependency in CI).
  await page
    .locator("h2", { hasText: /^Manual$/ })
    .first()
    .click();
  await page.getByRole("button", { name: /^Continue$/ }).click();

  // Step 2 — sandbox, Blank template.
  await page.getByRole("button", { name: /use a sandbox/i }).click();
  await page.fill("input#sandbox-name", projectName);
  await page
    .locator("button", { hasText: /^Blank/ })
    .first()
    .click();
  await page.getByRole("button", { name: /create sandbox/i }).click();
  // Creating the sandbox selects the new repo but stays on step 2 — the
  // wizard does not auto-advance, so step 3 needs an explicit Continue.
  const repoChip = page.locator("button", { hasText: new RegExp(projectName) });
  await repoChip.first().waitFor({ state: "visible", timeout: 60_000 });
  await page.getByRole("button", { name: /^Continue$/ }).click();

  // Step 3 — "Where does your app live?", the URL prompt the Blank template
  // defers to. Its primary button is "Save & continue" and stays disabled
  // until a repo is selected, which the sandbox step above is what provides.
  const urlInput = page.locator("input#base-url");
  await urlInput.waitFor({ state: "visible", timeout: 60_000 });
  await urlInput.fill(targetUrl);
  const save = page.getByRole("button", { name: /save & continue/i });
  await save.waitFor({ state: "visible", timeout: 30_000 });
  await save.click();

  // Remaining steps are informational; finish out to the app.
  await finishOnboarding(page);
}

/** Click through whatever remains of the wizard until we land in the app. */
export async function finishOnboarding(page: Page): Promise<void> {
  for (let i = 0; i < 6; i++) {
    if (!/\/onboarding/.test(page.url())) return;
    const done = page.getByRole("button", {
      name: /take me to the dashboard|go to dashboard|finish|done/i,
    });
    if (await done.count()) {
      await done.first().click();
      await page.waitForURL((u) => !/\/onboarding/.test(u.toString()), {
        timeout: 60_000,
      });
      return;
    }
    const next = page.getByRole("button", { name: /^(Continue|Next)$/ });
    if (await next.count()) {
      await next.first().click();
      await page.waitForTimeout(1_000);
      continue;
    }
    break;
  }
}

// ── DB helpers (assertions + teardown) ───────────────────────────────────

export async function teamIdForEmail(email: string): Promise<string> {
  const [row] = await db
    .select({ teamId: users.teamId })
    .from(users)
    .where(eq(users.email, email));
  if (!row?.teamId) throw new Error(`no team for ${email}`);
  return row.teamId;
}

/**
 * Best-effort teardown. `deleteTeam` is the same path §2.8/§3 verified
 * cascades plugin-owned rows, so tearing down by team is both the cleanup
 * and a small re-assertion of that cascade.
 */
export async function destroyTeam(teamId: string | undefined): Promise<void> {
  if (!teamId) return;
  await queries.deleteTeam(teamId).catch(() => {});
}
