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
import type { Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  BASE_URL,
  clickStreamAt,
  destroyTeam,
  gotoSettled,
  launchSession,
  onboardWithSandbox,
  registerViaUi,
  startTargetApp,
  teamIdForEmail,
  latestBuildIdForRepo,
  waitForBuildComplete,
  waitForPoolHeadroom,
  type Session,
  type TargetApp,
} from "./harness";

const PROJECT = "Golden Path Project";
/** Recorded through the live EB in step 3, asserted on from step 4 onwards. */
const RECORDED_TEST = "golden-path-recorded";
const RECORDED_AREA = "Golden Path Area";

/**
 * Click the sidebar's "Run All" and resolve the build it created.
 *
 * `handleRunAll` (sidebar-quick-actions.tsx) calls `createAndRunBuild` and
 * then either routes to the new build or — when every EB is busy — toasts
 * "build queued" and stays put. Both are real product behaviour, so the id
 * comes from the URL when there is one and from the newest build row when
 * there isn't.
 */
async function runAllAndResolveBuild(page: Page): Promise<string> {
  const since = new Date(Date.now() - 10_000);
  const runAll = page
    .getByRole("button", { name: /^Run All$/ })
    .filter({ visible: true })
    .first();
  await runAll.waitFor({ state: "visible", timeout: 60_000 });
  await runAll.click();

  try {
    await page.waitForURL(/\/(verify|builds)\/[^/?#]+/, { timeout: 60_000 });
    const m = page.url().match(/\/(?:verify|builds)\/([^/?#]+)/);
    if (m) return m[1]!;
  } catch {
    // Queued path — no navigation happens.
  }
  const id = await new Promise<string | null>((resolve) => {
    const deadline = Date.now() + 120_000;
    const tick = async () => {
      const found = await latestBuildIdForRepo(repositoryId!, since);
      if (found) return resolve(found);
      if (Date.now() > deadline) return resolve(null);
      setTimeout(tick, 2_000);
    };
    void tick();
  });
  if (!id) throw new Error("Run All produced no build");
  return id;
}

let s: Session;
let target: TargetApp;
let teamId: string | undefined;
let repositoryId: string | undefined;
/** Set by step 3, read by step 4. */
let recordedTestId: string | undefined;
/** Set by step 5 (baseline build) and step 6 (the build that has the diffs). */
let baselineBuildId: string | undefined;
let diffBuildId: string | undefined;

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
    repositoryId = repos[0]!.id;
  }, 180_000);

  it("renders the app shell without client-side errors (libs/ui smoke, §2.10)", async () => {
    await gotoSettled(s.page, "/tests");
    // The repo selector, nav, and base-URL chip all render through the
    // re-exported libs/ui primitives — if the re-export wiring were broken
    // at runtime this page would not paint at all.
    await expect
      .poll(() => s.page.locator("body").textContent(), { timeout: 30_000 })
      .toContain(PROJECT);
    expect(s.consoleErrors).toEqual([]);
  }, 90_000);

  /**
   * Step 3 — record a test against the repo from step 2.
   *
   * Everything here is the real UI, including the interactions *inside* the
   * streamed browser. That is worth spelling out because it looks like the
   * one thing a headless driver could not do: the EB stream is not a video.
   * `BrowserViewer` paints CDP frames onto a `<canvas>` and forwards mouse
   * and keyboard events back over the stream socket, scaling pointer
   * coordinates by `canvas.width / rect.width`. So Playwright clicking the
   * canvas at the right CSS offset is, from the recorder's point of view,
   * indistinguishable from a human clicking the remote page — the recorder
   * observes the resulting DOM events and appends real steps.
   *
   * The one deliberate deviation from the most-default path: the primary CTA
   * is "Analyze and Start Recording", and this drives the "Start Recording
   * with these settings" button under Advanced Settings instead. Both call
   * the same `handleStartRecording`; the primary one first runs an AI-backed
   * selector analysis pass over the target, which needs an AI provider this
   * environment has none of. Recording itself is identical.
   */
  it("step 3: records a test by really interacting with the live EB stream", async () => {
    const page = s.page;
    await waitForPoolHeadroom(1);

    await gotoSettled(page, "/record");

    const urlInput = page.locator('input[placeholder="https://example.com"]');
    await urlInput.waitFor({ state: "visible", timeout: 30_000 });
    await urlInput.fill(target.origin);
    await page
      .locator('input[placeholder="login-success"]')
      .fill(RECORDED_TEST);
    // Type a brand-new area name rather than picking an existing one, so
    // step 4 can assert the tree grew a node the recorder itself created.
    await page
      .locator('input[placeholder="New area name"]')
      .fill(RECORDED_AREA);

    await page.getByRole("button", { name: /advanced settings/i }).click();
    await page
      .getByRole("button", { name: /start recording with these settings/i })
      .click();

    // The EB has to be provisioned, boot Chromium, auto-register, and stream
    // its first frame before the canvas exists at all.
    const canvas = page.locator("canvas").first();
    await canvas.waitFor({ state: "visible", timeout: 120_000 });
    await expect
      .poll(
        async () =>
          canvas.evaluate((c) => (c as HTMLCanvasElement).width).catch(() => 0),
        { timeout: 60_000, interval: 500 },
      )
      .toBeGreaterThan(0);

    // Interact with the *remote* page through the canvas. Coordinates are the
    // target app's own absolute layout (see `startTargetApp`): the name input
    // sits at (100,60)
    // and the submit button at (280,60).
    await clickStreamAt(page, 150, 72);
    await page.keyboard.type("Ada", { delay: 60 });
    await clickStreamAt(page, 305, 72);

    // Two explicit captures — step 6 needs more than one screenshot to
    // approve one diff and reject another.
    const shoot = page.locator('button[title="Screenshot"]');
    await shoot.click();
    await page.waitForTimeout(1_500);
    await shoot.click();
    await page.waitForTimeout(1_500);

    // The recorder streamed real steps back: the timeline is no longer empty.
    const recordedSteps = await page.locator("body").innerText();
    expect(recordedSteps).not.toContain("Waiting for interactions...");

    await page.getByRole("button", { name: /^Stop$/ }).click();

    // Stop → the "Save Recording" review step, which auto-persists the test
    // and kicks off a headed 2x replay. "Open Test" only renders once the
    // save has actually returned an id.
    const openTest = page.getByRole("button", { name: /^Open Test$/ });
    await openTest.waitFor({ state: "visible", timeout: 180_000 });

    const { db } = await import("@/lib/db");
    const { tests } = await import("@/lib/db/schema");
    const { and, eq } = await import("drizzle-orm");
    const [row] = await db
      .select({
        id: tests.id,
        areaId: tests.functionalAreaId,
        code: tests.code,
      })
      .from(tests)
      .where(
        and(
          eq(tests.repositoryId, repositoryId!),
          eq(tests.name, RECORDED_TEST),
        ),
      );
    expect(row?.id).toBeTruthy();
    // The generated code is derived from what we did in the stream, not a
    // template: it must contain the click/fill we performed.
    expect(row!.code).toMatch(/page\./);
    recordedTestId = row!.id;

    await openTest.click();
    await page.waitForURL(/\/tests/, { timeout: 60_000 });
  }, 600_000);

  /**
   * Step 4 — the recorded test shows up in the Tests tree, under the area the
   * recorder created for it.
   *
   * Asserted against the rendered tree, not the row in `tests`: areas start
   * collapsed (`expandedIds` seeds empty in `area-tree.tsx`), so the test node
   * only exists in the DOM *after* expanding its parent — which makes the
   * nesting itself the thing being checked, rather than two labels that happen
   * to both be on the page.
   */
  it("step 4: the recorded test appears in the tree under its functional area", async () => {
    const page = s.page;
    await gotoSettled(page, "/tests");

    const area = page.locator(
      `[role="treeitem"][aria-label="${RECORDED_AREA}"]`,
    );
    await area.waitFor({ state: "visible", timeout: 60_000 });

    // Collapsed to start with: the test is not in the DOM yet.
    const testNode = page.locator(
      `[role="treeitem"][aria-label="${RECORDED_TEST}"]`,
    );
    expect(await testNode.count()).toBe(0);

    await area.locator("button").first().click();
    await testNode.waitFor({ state: "visible", timeout: 30_000 });
    expect(await area.getAttribute("aria-expanded")).toBe("true");

    // Indentation is `depth * 16 + 8`, so a child of the area is strictly
    // further right than the area itself — i.e. really nested under it.
    const areaBox = await area.boundingBox();
    const testBox = await testNode.boundingBox();
    expect(testBox!.x).toBeGreaterThan(areaBox!.x);

    // …and the DB agrees about which area it landed in.
    const { db } = await import("@/lib/db");
    const { functionalAreas, tests } = await import("@/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    const [row] = await db
      .select({ areaName: functionalAreas.name })
      .from(tests)
      .innerJoin(
        functionalAreas,
        eq(tests.functionalAreaId, functionalAreas.id),
      )
      .where(eq(tests.id, recordedTestId!));
    expect(row?.areaName).toBe(RECORDED_AREA);
  }, 180_000);
});
