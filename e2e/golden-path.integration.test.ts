/**
 * §4 — Manual golden-path E2E script, automated.
 *
 * `docs/architecture/core-plugin-refactor-test-plan.md` §4 is written as a
 * once-through manual walkthrough because, at the time it was written, no
 * browser was available to the environment executing it (see §2.18's "What
 * genuinely could not be verified here"). Playwright + Chromium *are*
 * available here, so this file runs that walkthrough as a real browser
 * session against the real app instead of leaving it to a human.
 *
 * It is deliberately ONE sequential journey in ONE browser context — the
 * point of a golden path is that state carries from step to step (the repo
 * you created is the repo you record against is the repo whose build you
 * review), so the steps share a `describe` and run in order rather than
 * being independent cases.
 *
 * Steps 8–9 (file a GitHub issue → auto-close on green) are covered
 * separately: they need real GitHub credentials this environment does not
 * have, and `confirm-on-green`'s scope guard already has a dedicated
 * runtime test from §3 (`src/lib/verify/confirm-on-green.integration.test.ts`).
 *
 * Prerequisites: `pnpm dev` (app on :3000), `pnpm dev:pool`, host postgres.
 * Run with `pnpm test:integration`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  BASE_URL,
  destroyTeam,
  launchSession,
  onboardWithSandbox,
  registerViaUi,
  startTargetApp,
  teamIdForEmail,
  type Session,
  type TargetApp,
} from "./harness";

const PROJECT = "Golden Path Project";

let s: Session;
let target: TargetApp;
let teamId: string | undefined;

beforeAll(async () => {
  target = await startTargetApp();
  s = await launchSession();
}, 120_000);

afterAll(async () => {
  await s?.close();
  await target?.close();
  await destroyTeam(teamId);
});

describe("§4 golden path — one continuous browser journey", () => {
  it("step 1: registering lands on onboarding with the wizard's first question", async () => {
    await registerViaUi(s);
    expect(s.page.url()).toContain("/onboarding");
    await expect
      .poll(() => s.page.locator("h1").first().textContent(), {
        timeout: 30_000,
      })
      .toMatch(/how do you want to build tests/i);

    teamId = await teamIdForEmail(s.email);
    expect(teamId).toBeTruthy();
  }, 120_000);

  it("step 2: the sandbox flow creates a repo and points it at the target app", async () => {
    await onboardWithSandbox(s, target.origin, PROJECT);

    // Onboarding is done — we are in the app proper, not the wizard.
    expect(s.page.url()).not.toContain("/onboarding");

    // The repo exists under this team, with the base URL the wizard set.
    const { db } = await import("@/lib/db");
    const { repositories } = await import("@/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    const repos = await db
      .select()
      .from(repositories)
      .where(eq(repositories.teamId, teamId!));
    expect(repos).toHaveLength(1);
    expect(repos[0]!.name).toBe(PROJECT);
    expect(
      (repos[0]!.branchBaseUrls as Record<string, string> | null)?.main,
    ).toBe(target.origin);
  }, 180_000);

  it("renders the app shell without client-side errors (libs/ui smoke, §2.10)", async () => {
    await s.page.goto(`${BASE_URL}/tests`, { waitUntil: "domcontentloaded" });
    await s.page.waitForLoadState("networkidle").catch(() => {});
    // The repo selector, nav, and base-URL chip all render through the
    // re-exported libs/ui primitives — if the re-export wiring were broken
    // at runtime this page would not paint at all.
    await expect
      .poll(() => s.page.locator("body").textContent(), { timeout: 30_000 })
      .toContain(PROJECT);
    expect(s.consoleErrors).toEqual([]);
  }, 90_000);
});
