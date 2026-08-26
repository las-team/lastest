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
  // Wait for hydration before touching the form. `domcontentloaded` fires
  // long before React has attached the submit handler, and on a loaded dev
  // server (four of these suites sharing one machine) the gap is seconds —
  // a click landing in that window fills the form, submits nothing, and the
  // test then waits out its whole timeout on a page that never navigates.
  // Reproduced directly: same script, same selectors, fails without this
  // line and passes with it.
  await s.page.waitForLoadState("networkidle").catch(() => {});
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
  // Same hydration guard as `registerViaUi` — the wizard's cards are client
  // components and a pre-hydration click is a silent no-op.
  await page.waitForLoadState("networkidle").catch(() => {});

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

/**
 * Navigate and wait for the page to be interactive.
 *
 * Every client component in this app attaches its handlers at hydration, so
 * `domcontentloaded` alone is not enough to click anything — see the comment
 * in `registerViaUi`. Anything driving the UI should come through here.
 */
export async function gotoSettled(page: Page, path: string): Promise<void> {
  await page.goto(`${BASE_URL}${path}`, { waitUntil: "domcontentloaded" });
  // Short budget on purpose: the signed-in shell holds an activity-feed SSE
  // stream open, so `networkidle` never actually fires inside the app and the
  // default 30s timeout would be paid on *every* navigation. All this needs
  // to cover is the client chunks, which is a sub-second wait on a warm dev
  // server.
  await page
    .waitForLoadState("networkidle", { timeout: 8_000 })
    .catch(() => {});
}

/**
 * Free slots in the EB pool, read from the service's own live-backend ledger.
 *
 * Same helper `core/browser/src/browser.integration.test.ts` uses, for the
 * same reason: process mode is 1-job-1-EB and a claim issued while the pool
 * is at its cap sits in a 5-minute retry loop instead of failing fast. Gating
 * on headroom keeps this suite measuring the product rather than queueing
 * latency — and it matters more here, because several §4 steps each want a
 * browser and other suites may be sharing the same four slots.
 */
export async function poolHeadroom(): Promise<number> {
  const { getPoolStatus } = await import("@lastest/pool-service/client");
  const status = await getPoolStatus();
  // Service unreachable — let the claim itself produce the real error rather
  // than stalling here on a number we cannot read.
  return status ? status.max - status.size : 99;
}

export async function waitForPoolHeadroom(
  min = 1,
  timeoutMs = 180_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if ((await poolHeadroom()) >= min) return;
    if (Date.now() > deadline) {
      throw new Error(
        `EB pool never had ${min} free slot(s) in ${timeoutMs}ms`,
      );
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
}

/**
 * Click a point expressed in *remote page* coordinates on the EB stream
 * canvas.
 *
 * `BrowserViewer` forwards mouse events to the EB after scaling by
 * `canvas.width / rect.width` (browser-viewer-client.tsx), so a click at CSS
 * offset `p * rect.width / canvas.width` lands on remote page pixel `p`. This
 * is the whole reason §4 step 3 is automatable at all: the streamed browser
 * really is interactive, not a video.
 */
export async function clickStreamAt(
  page: Page,
  pageX: number,
  pageY: number,
): Promise<void> {
  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("stream canvas has no layout box");
  const dims = await canvas.evaluate((c) => ({
    w: (c as HTMLCanvasElement).width,
    h: (c as HTMLCanvasElement).height,
  }));
  if (!dims.w || !dims.h) throw new Error("stream canvas has no frame yet");
  await canvas.click({
    position: {
      x: (pageX * box.width) / dims.w,
      y: (pageY * box.height) / dims.h,
    },
  });
}

/**
 * Newest build for a repo, newer than `since`.
 *
 * The "Run All" control navigates straight to the new build, so the URL is
 * normally enough — but when every EB is busy the same click *queues* the
 * build and stays put (`createAndRunBuild` returns `{queued:true}`). That is
 * a legitimate product path, not a failure, so the caller needs a way to find
 * the build it just created without a URL to read it from.
 */
export async function latestBuildIdForRepo(
  repositoryId: string,
  since: Date,
): Promise<string | null> {
  const { builds, testRuns } = await import("@/lib/db/schema");
  const { and, desc, gte } = await import("drizzle-orm");
  const rows = await db
    .select({ id: builds.id })
    .from(builds)
    .innerJoin(testRuns, eq(builds.testRunId, testRuns.id))
    .where(
      and(
        eq(testRuns.repositoryId, repositoryId),
        gte(builds.createdAt, since),
      ),
    )
    .orderBy(desc(builds.createdAt))
    .limit(1);
  return rows[0]?.id ?? null;
}

/** Poll a build row until the executor marks it complete. */
export async function waitForBuildComplete(
  buildId: string,
  timeoutMs = 420_000,
): Promise<{ overallStatus: string; totalTests: number | null }> {
  const { builds } = await import("@/lib/db/schema");
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const [row] = await db
      .select({
        overallStatus: builds.overallStatus,
        totalTests: builds.totalTests,
        completedAt: builds.completedAt,
      })
      .from(builds)
      .where(eq(builds.id, buildId));
    if (row?.completedAt) {
      return { overallStatus: row.overallStatus, totalTests: row.totalTests };
    }
    if (Date.now() > deadline) {
      throw new Error(
        `build ${buildId} never completed in ${timeoutMs}ms (status ${row?.overallStatus})`,
      );
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
}

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

  // `queries.deleteTeam` is a bare `delete from teams`, and
  // `users_team_id_teams_id_fk` is NO ACTION — so it *throws* for any team
  // that still has a member. The product never hits this because
  // `deleteAccount` removes the user first; a test fixture has to do the
  // same. This used to be `deleteTeam().catch(() => {})`, which turned that
  // throw into a silent no-op and leaked every e2e team into the dev DB.
  const { users } = await import("@/lib/db/schema");
  await db.delete(users).where(eq(users.teamId, teamId));

  // Repos are NOT cascaded — `repositories.team_id` has no foreign key at
  // all (see `packages/db/src/schema/repos.ts`, whose comment claims one was
  // "added after teams table definition"; it never was). Without this the
  // team's repositories survive it with a dangling team_id.
  //
  // Go through `queries.deleteRepository`, which is the product's own cascade,
  // rather than a bare `delete from repositories`: a repo that has ever been
  // built has `background_jobs` (and reviewTodos, baselines, visualDiffs …)
  // pointing at it under NO ACTION foreign keys, so the bare delete dies on
  // `background_jobs_repository_id_repositories_id_fk` and takes the whole
  // suite's teardown with it.
  const { repositories } = await import("@/lib/db/schema");
  const repoRows = await db
    .select({ id: repositories.id })
    .from(repositories)
    .where(eq(repositories.teamId, teamId));
  for (const repo of repoRows) {
    await queries.deleteRepository(repo.id);
  }

  // Deliberately unguarded: a fixture that cannot clean up should say so
  // loudly rather than quietly accumulate rows across re-runs.
  await queries.deleteTeam(teamId);
}
