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
 * The Radix `<Switch>` that belongs to a labelled settings row.
 *
 * Settings rows are all shaped the same way — label text on the left, control
 * on the right, inside one `justify-between` flex row — so walking up to that
 * row and back down to the switch is stabler than any class chain.
 */
function switchForLabel(page: Page, label: string) {
  return page
    .locator(
      `xpath=//*[normalize-space(text())=${JSON.stringify(label)}]/ancestor::div[contains(@class,"justify-between")][1]//button[@role="switch"]`,
    )
    .first();
}

async function ensureSwitchOn(page: Page, label: string): Promise<void> {
  const sw = switchForLabel(page, label);
  await sw.waitFor({ state: "visible", timeout: 60_000 });
  if ((await sw.getAttribute("data-state")) !== "checked") await sw.click();
  await expect
    .poll(() => sw.getAttribute("data-state"), { timeout: 15_000 })
    .toBe("checked");
}

/** Progress breadcrumbs — these steps are long, and a bare timeout tells you
 *  nothing about which of a dozen awaits actually stalled. */
const T0 = Date.now();
function mark(what: string): void {
  console.log(`[gp +${((Date.now() - T0) / 1000).toFixed(1)}s] ${what}`);
}

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

/**
 * Authored through /record's "Import code" tab when the recorder cannot start
 * a session. Shaped exactly like the recorder's own output (the signature in
 * CLAUDE.md's gotchas) and deliberately takes two screenshots, so step 6 has
 * more than one diff to act on.
 */
const IMPORTED_TEST_CODE = `export async function test(page, baseUrl, screenshotPath, stepLogger) {
  let n = 0;
  function shot() {
    n++;
    const i = screenshotPath.lastIndexOf('.');
    return i > 0
      ? screenshotPath.slice(0, i) + '-step' + n + screenshotPath.slice(i)
      : screenshotPath + '-step' + n;
  }
  stepLogger.log('Open the page');
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load').catch(() => {});
  stepLogger.log('Capture the landing state');
  await page.screenshot({ path: shot(), fullPage: true });
  stepLogger.log('Fill the name and submit');
  await page.fill('#name-input', 'Ada');
  await page.click('#submit-btn');
  await page.waitForTimeout(200);
  stepLogger.log('Capture the result state');
  await page.screenshot({ path: shot(), fullPage: true });
}
`;

let s: Session;
let target: TargetApp;
/** Non-null when the recorder refused to start — see the step 3 cases. */
let recorderFailure: string | null = null;
let teamId: string | undefined;
let repositoryId: string | undefined;
/** Set by step 3, read by step 4. */
let recordedTestId: string | undefined;
/** Set by step 5 (baseline build) and step 6 (the build that has the diffs). */
let baselineBuildId: string | undefined;
let diffBuildId: string | undefined;

beforeAll(async () => {
  // Step 7b dispatches a build by calling `createAndRunBuildCore` *in this
  // process*, which runs the whole executor here rather than in the dev
  // server — and plugin wiring is a module-global installed by the
  // composition root, which only `src/instrumentation.ts` normally runs. With
  // it missing, the run dies on "The data-sources plugin is not wired" (and
  // the awards recompute after it), which looks exactly like a product
  // failure. Same prologue as `quickstart.integration.test.ts`; memoized, so
  // this is the only place that has to pay for it.
  const { getPluginRuntime } = await import("@/lib/core/runtime");
  await getPluginRuntime();

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
  it("step 3: drive the recorder, then author the test through the real UI", async () => {
    const page = s.page;
    await waitForPoolHeadroom(1);
    mark("record: pool ok");

    await gotoSettled(page, "/record");
    mark("record: page loaded");

    const urlInput = page.locator('input[placeholder="https://example.com"]');
    await urlInput.waitFor({ state: "visible", timeout: 30_000 });
    await urlInput.fill(target.origin);
    await page
      .locator('input[placeholder="login-success"]')
      .fill(RECORDED_TEST);
    await page
      .locator('input[placeholder="New area name"]')
      .fill(RECORDED_AREA);

    await page.getByRole("button", { name: /advanced settings/i }).click();
    await page
      .getByRole("button", { name: /start recording with these settings/i })
      .click();
    mark("record: start clicked");

    // Either the stream canvas paints, or the recorder surfaces its error.
    const canvas = page.locator("canvas").first();
    const errorBox = page.getByText(/Recording failed:/i).first();
    let recorderError: string | null = null;
    for (let i = 0; i < 60; i++) {
      if (await canvas.isVisible().catch(() => false)) break;
      if (await errorBox.isVisible().catch(() => false)) {
        recorderError = (await errorBox.textContent()) ?? "unknown";
        break;
      }
      await page.waitForTimeout(2_000);
    }
    recorderFailure = recorderError;
    mark(`record: outcome ${recorderError ? "ERROR" : "canvas"}`);

    if (!recorderError) {
      // ── Happy path: everything below really happens inside the streamed
      //    remote browser (see the block comment above).
      await expect
        .poll(
          async () =>
            canvas
              .evaluate((c) => (c as HTMLCanvasElement).width)
              .catch(() => 0),
          { timeout: 60_000, interval: 500 },
        )
        .toBeGreaterThan(0);
      await clickStreamAt(page, 150, 72);
      await page.keyboard.type("Ada", { delay: 60 });
      await clickStreamAt(page, 305, 72);
      const shoot = page.locator('button[title="Screenshot"]');
      await shoot.click();
      await page.waitForTimeout(1_500);
      await shoot.click();
      await page.waitForTimeout(1_500);
      const timeline = await page.locator("body").innerText();
      expect(timeline).not.toContain("Waiting for interactions...");
      await page.getByRole("button", { name: /^Stop$/ }).click();
      const openTest = page.getByRole("button", { name: /^Open Test$/ });
      await openTest.waitFor({ state: "visible", timeout: 180_000 });
      await openTest.click();
      await page.waitForURL(/\/tests/, { timeout: 60_000 });
    } else {
      // ── Substitution, declared loudly. The recorder cannot start a session
      //    in this environment (see `recorderFailure`, asserted on in the
      //    dedicated case below), so the test is authored through the other
      //    real authoring UI the product ships: /record's "Import code" tab,
      //    plus the Tests tree's own "Create Area" dialog. No API calls —
      //    every field and button below is the rendered UI.
      await gotoSettled(page, "/tests");
      await page
        .locator("div", { hasText: /^Areas$/ })
        .last()
        .locator("button")
        .last()
        .click();
      const areaName = page.locator(
        'input[placeholder="e.g., Authentication, Dashboard"]',
      );
      await areaName.waitFor({ state: "visible", timeout: 30_000 });
      await areaName.fill(RECORDED_AREA);
      await page.getByRole("button", { name: /^Create$/ }).click();
      await page
        .locator(`[role="treeitem"][aria-label="${RECORDED_AREA}"]`)
        .waitFor({ state: "visible", timeout: 60_000 });
      mark("record: area created via UI");

      await gotoSettled(page, "/record");
      await page
        .getByRole("tab")
        .filter({ hasText: /Import code/ })
        .first()
        .click();
      const codeBox = page.locator("#paste-code");
      await codeBox.waitFor({ state: "visible", timeout: 30_000 });
      await codeBox.fill(IMPORTED_TEST_CODE);
      await page.locator("#paste-name").fill(RECORDED_TEST);
      await page.locator("#import-url").fill(target.origin);
      // Radix Select: open, then pick the area created a moment ago.
      await page.getByText("Select area (optional)").click();
      await page.getByRole("option", { name: RECORDED_AREA }).click();
      await page.getByRole("button", { name: /^Import test$/ }).click();
      mark("record: imported via UI");
    }

    const { db } = await import("@/lib/db");
    const { tests } = await import("@/lib/db/schema");
    const { and, eq } = await import("drizzle-orm");
    await expect
      .poll(
        async () => {
          const rows = await db
            .select({ id: tests.id })
            .from(tests)
            .where(
              and(
                eq(tests.repositoryId, repositoryId!),
                eq(tests.name, RECORDED_TEST),
              ),
            );
          return rows.length;
        },
        { timeout: 60_000, interval: 2_000 },
      )
      .toBe(1);

    const [row] = await db
      .select({ id: tests.id, code: tests.code })
      .from(tests)
      .where(
        and(
          eq(tests.repositoryId, repositoryId!),
          eq(tests.name, RECORDED_TEST),
        ),
      );
    expect(row!.code).toMatch(/page\./);
    recordedTestId = row!.id;
  }, 900_000);

  /**
   * The recorder's own verdict, kept as its own case so the suite reports a
   * product failure as a failure instead of hiding it inside step 3's
   * fallback. Currently red: `page.evaluate(browserRecordingScript)` in
   * `packages/embedded-browser/src/embedded-recorder.ts` throws
   * `ReferenceError: __name is not defined` — esbuild's `keepNames` (tsx, the
   * process-provisioner's loader) rewrites the function before Playwright
   * serialises it, and the injected `__name` helper does not exist in the
   * page. Reproduced by hand against a live EB as well as here.
   */
  it("step 3 (recorder): starting a recording session against a live EB", () => {
    expect(recorderFailure).toBeNull();
  });

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

    // The test node only exists in the DOM while its parent area is
    // expanded, so expanding is what makes it appear.
    const testNode = page.locator(
      `[role="treeitem"][aria-label="${RECORDED_TEST}"]`,
    );
    if ((await area.getAttribute("aria-expanded")) !== "true") {
      expect(await testNode.count()).toBe(0);
      await area.locator("button").first().click();
    }
    await testNode.waitFor({ state: "visible", timeout: 30_000 });
    expect(await area.getAttribute("aria-expanded")).toBe("true");

    // Indentation is `depth * 16 + 8`, so a child of the area is strictly
    // further right than the area itself — i.e. really nested under it.
    // (Rows span the full sidebar width, so the nesting shows up in
    // padding-left, not in the row's own x.)
    const pad = (loc: typeof area) =>
      loc.evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft));
    expect(await pad(testNode)).toBeGreaterThan(await pad(area));

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

  /**
   * Step 5 — trigger a run from the real control and watch a build appear and
   * finish. This is also the build that establishes the baselines step 6
   * diffs against, so it deliberately runs against target v1.
   */
  it("step 5: Run All creates a build that runs to completion", async () => {
    const page = s.page;
    // Two tests in this repo, one EB each in process mode.
    await waitForPoolHeadroom(1);
    await gotoSettled(page, "/tests");

    baselineBuildId = await runAllAndResolveBuild(page);
    expect(baselineBuildId).toBeTruthy();

    const done = await waitForBuildComplete(baselineBuildId);
    expect(done.totalTests ?? 0).toBeGreaterThanOrEqual(1);

    // Both the seeded smoke test and the test recorded in step 3 executed.
    const { db } = await import("@/lib/db");
    const { builds, testResults } = await import("@/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    const [build] = await db
      .select({ testRunId: builds.testRunId })
      .from(builds)
      .where(eq(builds.id, baselineBuildId));
    const results = await db
      .select({ testId: testResults.testId, status: testResults.status })
      .from(testResults)
      .where(eq(testResults.testRunId, build!.testRunId!));
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.map((r) => r.testId)).toContain(recordedTestId);
  }, 900_000);

  /**
   * Step 6a — establish baselines by approving the first build.
   *
   * A first run has nothing to compare against, so `builds.ts` writes each
   * screenshot as a `pending` diff with no baseline (`autoApproveDefaultBranch`
   * is off by default). `approveDiffCore` is what promotes a screenshot to a
   * baseline — so this is both the setup step 6 needs and a first real
   * exercise of the review UI's bulk path.
   */
  it("step 6a: approving the first build in the review UI creates baselines", async () => {
    const page = s.page;
    await gotoSettled(page, `/builds/${baselineBuildId}`);

    const selectAll = page.locator('[aria-label="Select all"]');
    await selectAll.waitFor({ state: "visible", timeout: 60_000 });
    await selectAll.click();

    const bulkApprove = page
      .getByRole("button", { name: /^Expected Change$/ })
      .first();
    await bulkApprove.waitFor({ state: "visible", timeout: 15_000 });
    await bulkApprove.click();

    const { db } = await import("@/lib/db");
    const { baselines, tests, visualDiffs } = await import("@/lib/db/schema");
    const { eq, inArray } = await import("drizzle-orm");
    await expect
      .poll(
        async () => {
          const rows = await db
            .select({ status: visualDiffs.status })
            .from(visualDiffs)
            .where(eq(visualDiffs.buildId, baselineBuildId!));
          return rows.filter((r) => r.status === "pending").length;
        },
        { timeout: 90_000, interval: 2_000 },
      )
      .toBe(0);

    const testIds = (
      await db
        .select({ id: tests.id })
        .from(tests)
        .where(eq(tests.repositoryId, repositoryId!))
    ).map((t) => t.id);
    const active = await db
      .select({ id: baselines.id })
      .from(baselines)
      .where(inArray(baselines.testId, testIds));
    expect(active.length).toBeGreaterThan(0);
  }, 300_000);

  /**
   * Step 6b — a second build against a *changed* page, then the review
   * decisions §4 asks for: approve one screenshot, reject another with a
   * comment.
   *
   * The change is real: `target.setVersion(2)` repaints the CTA from
   * `#ff0000` to `#1e40af`, so every screenshot of that page differs by a
   * genuine block of pixels rather than by anti-aliasing noise.
   *
   * Two settings are switched on here rather than in step 7 because they have
   * to be true *while the build runs* for step 7 to have anything to look at:
   * video recording (the executor only records when it's on) and Early
   * Adopter (the spec-28 annotated player is gated on it). Both are flipped
   * through their real Settings controls, not written to the DB.
   */
  it("step 6b: a changed page yields real diffs — approve one, reject one with a comment", async () => {
    const page = s.page;

    // `/settings` is tabbed (General / Integrations / Testing / AI /
    // Account) and `SettingsTabs` renders only the active tab's content, so
    // each switch has to be reached through its own tab. `?tab=` is the
    // supported deep link (`readInitialTab` in settings-tabs.tsx), which
    // makes this a deep-link test as well as a toggle one.
    await gotoSettled(page, "/settings?tab=general");
    await ensureSwitchOn(page, "Early Adopter Mode");
    await gotoSettled(page, "/settings?tab=testing");
    await ensureSwitchOn(page, "Video Recording");
    mark("6b: settings toggled");

    const { db } = await import("@/lib/db");
    const { playwrightSettings, teams, visualDiffs, reviewTodos } =
      await import("@/lib/db/schema");
    const { and, eq, gt } = await import("drizzle-orm");

    // Autosave is debounced (500ms) — assert it actually landed rather than
    // trusting the optimistic switch state.
    await expect
      .poll(
        async () => {
          const [row] = await db
            .select({ v: playwrightSettings.enableVideoRecording })
            .from(playwrightSettings)
            .where(eq(playwrightSettings.repositoryId, repositoryId!));
          return row?.v ?? false;
        },
        { timeout: 60_000, interval: 1_000 },
      )
      .toBe(true);
    await expect
      .poll(
        async () => {
          const [row] = await db
            .select({ v: teams.earlyAdopterMode })
            .from(teams)
            .where(eq(teams.id, teamId!));
          return row?.v ?? false;
        },
        { timeout: 60_000, interval: 1_000 },
      )
      .toBe(true);

    // Repaint the target, then run the same suite again.
    target.setVersion(2);
    await waitForPoolHeadroom(1);
    await gotoSettled(page, "/tests");
    diffBuildId = await runAllAndResolveBuild(page);
    mark(`6b: build ${diffBuildId} started`);
    await waitForBuildComplete(diffBuildId);
    mark("6b: build complete");

    // Real pixel diffs, not "no baseline" placeholders.
    const changed = await db
      .select({ id: visualDiffs.id, px: visualDiffs.pixelDifference })
      .from(visualDiffs)
      .where(
        and(
          eq(visualDiffs.buildId, diffBuildId),
          gt(visualDiffs.pixelDifference, 0),
        ),
      );
    expect(changed.length).toBeGreaterThanOrEqual(2);

    // ── Approve one, through the rendered diff viewer ────────────────────
    const approveId = changed[0]!.id;
    await gotoSettled(page, `/builds/${diffBuildId}/diff/${approveId}`);
    const approve = page
      .getByRole("button", { name: /^Expected Change$/ })
      .first();
    await approve.waitFor({ state: "visible", timeout: 60_000 });
    await approve.click();
    await expect
      .poll(
        async () => {
          const [row] = await db
            .select({ status: visualDiffs.status })
            .from(visualDiffs)
            .where(eq(visualDiffs.id, approveId));
          return row?.status;
        },
        { timeout: 60_000, interval: 1_000 },
      )
      .toBe("approved");
    mark("6b: approved");

    // ── Reject another *with a comment* ──────────────────────────────────
    const rejectId = changed[1]!.id;
    const comment = "Golden path: CTA colour regression, needs a fix";
    await gotoSettled(page, `/builds/${diffBuildId}/diff/${rejectId}`);
    const todoBtn = page.getByRole("button", { name: /^Add to Todo$/ });
    await todoBtn.waitFor({ state: "visible", timeout: 60_000 });
    await todoBtn.click();
    const todoInput = page.locator(
      'input[placeholder="Describe what needs fixing..."]',
    );
    await todoInput.waitFor({ state: "visible", timeout: 15_000 });
    await todoInput.fill(comment);
    await page.getByRole("button", { name: /^Add$/ }).click();

    await expect
      .poll(
        async () => {
          const [row] = await db
            .select({ status: visualDiffs.status })
            .from(visualDiffs)
            .where(eq(visualDiffs.id, rejectId));
          return row?.status;
        },
        { timeout: 60_000, interval: 1_000 },
      )
      .toBe("todo");
    const todos = await db
      .select({ description: reviewTodos.description })
      .from(reviewTodos)
      .where(eq(reviewTodos.diffId, rejectId));
    expect(todos.map((t) => t.description)).toContain(comment);
    mark("6b: rejected with comment");
  }, 1_200_000);

  /**
   * Step 7 — Verify's focus view: every check-layer tab, then the playback
   * scrubber.
   *
   * This closes the two items §2.18 explicitly left open. §2.10 asked for
   * proof that tabbed surfaces still *switch content* after the `libs/ui`
   * extraction — so the assertion is not "13 tabs exist" but "the pane's
   * rendered text is different for different tabs, and the tab you clicked is
   * the one that became active". §2.17 asked for the step-annotated scrubber
   * (spec 28): that it renders segment ticks derived from persisted
   * `stepTimings`, and that clicking a tick both seeks the video and moves
   * the case rail to that step — the sync that the flag-on path exists for.
   *
   * `?mode=focus` is a deep link, which is itself the other half of §2.10's
   * tabs item ("deep-linking to a specific tab still resolves").
   */
  it("step 7: Verify's check-layer tabs switch content and playback stays in sync", async () => {
    const page = s.page;
    await gotoSettled(page, `/verify/${diffBuildId}?mode=focus`);

    // Heavy data is deferred to the client's first /verify-status fetch.
    const tabStrip = page.locator('button[aria-label*="—"]');
    await expect
      .poll(() => tabStrip.count(), { timeout: 120_000, interval: 1_000 })
      .toBeGreaterThan(5);
    mark("7: focus view loaded");

    // The pane is the last flex child of the compare column; keying off the
    // tab strip's parent keeps this independent of pane-specific markup.
    const paneText = async () => {
      const body = await page.locator("body").innerText();
      return body.replace(/\s+/g, " ");
    };

    const LAYERS = [
      "Run",
      "Visual",
      "Text",
      "DOM",
      "Network",
      "Console",
      "A11y",
      "Design",
      "Perf",
      "URL",
      "State",
      "Variables",
      "API",
    ];
    const seen = new Map<string, string>();
    for (const name of LAYERS) {
      const tab = page.locator(`button[aria-label^="${name} — "]`).first();
      if ((await tab.count()) === 0) continue;
      await tab.click();
      await page.waitForTimeout(400);
      // The clicked tab is the active one (active tabs render bold).
      const weight = await tab.evaluate(
        (el) => getComputedStyle(el).fontWeight,
      );
      expect(Number(weight)).toBeGreaterThanOrEqual(600);
      seen.set(name, await paneText());
    }
    // Every layer was reachable…
    expect(seen.size).toBe(LAYERS.length);
    // …and the panes are genuinely different renders, not one pane with a
    // moving highlight. (Distinct texts across 13 tabs; a broken Tabs wiring
    // would collapse this to 1.)
    expect(new Set(seen.values()).size).toBeGreaterThan(3);
    // Spot-check two panes carry their own layer-specific copy.
    expect(seen.get("Console")).toMatch(/Console/i);
    expect(seen.get("Network")).toMatch(/Network/i);
    mark(
      `7: walked ${seen.size} layers, ${new Set(seen.values()).size} distinct panes`,
    );

    // The Settings toggle flipped in step 6b produced a video for this build,
    // and step timings are persisted alongside it — both halves of spec 28.
    const { db } = await import("@/lib/db");
    const { testResults, builds } = await import("@/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    const [b] = await db
      .select({ testRunId: builds.testRunId })
      .from(builds)
      .where(eq(builds.id, diffBuildId!));
    const results = await db
      .select({
        videoPath: testResults.videoPath,
        stepTimings: testResults.stepTimings,
      })
      .from(testResults)
      .where(eq(testResults.testRunId, b!.testRunId!));
    expect(results.some((r) => r.stepTimings)).toBe(true);
    const withVideo = results.filter((r) => r.videoPath);
    // §4.1's finding 2 ("Video Recording is a dead toggle") is fixed:
    // `resolveVideoRecording` (executor.ts) now ORs the repo-level
    // `playwright_settings.enableVideoRecording` with the per-run
    // `forceVideoRecording`, so the switch flipped in step 6b is what put a
    // video on this build.
    expect(withVideo.length).toBeGreaterThan(0);
    mark("7: tabs verified; Settings toggle produced a video");
  }, 600_000);

  /**
   * Step 7b — the spec-28 playback scrubber, on a build that actually has a
   * video.
   *
   * Step 7 covers the repo-level Settings toggle; this covers the other input
   * to `resolveVideoRecording` — the per-run `forceVideoRecording` flag that
   * demo/share builds pass — by driving `createAndRunBuildCore(...,
   * forceVideoRecording = true)` directly, and then exercises the scrubber on
   * the build it produces.
   */
  it("step 7b: the playback scrubber seeks the video and moves the case rail", async () => {
    const page = s.page;
    // Process-mode EBs are torn down *asynchronously* and a released EB is
    // destroyed rather than recycled, so a build dispatched straight after
    // the previous one can find the ledger still at its cap and then burn
    // the whole 120s claim timeout. Same hazard `browser.integration.test.ts`
    // documents; gate on two free slots plus a short settle so this case
    // measures the scrubber rather than teardown latency.
    await waitForPoolHeadroom(2);
    await new Promise((r) => setTimeout(r, 5_000));

    const { createAndRunBuildCore } = await import("@/server/actions/builds");
    const forced = await createAndRunBuildCore(
      "manual",
      [recordedTestId!],
      repositoryId!,
      undefined,
      undefined,
      undefined,
      true, // forceVideoRecording
    );
    const forcedBuildId = forced.buildId!;
    expect(forcedBuildId).toBeTruthy();
    await waitForBuildComplete(forcedBuildId);
    mark(`7b: forced-video build ${forcedBuildId} complete`);

    const { db } = await import("@/lib/db");
    const { testResults, builds } = await import("@/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    const [fb] = await db
      .select({ testRunId: builds.testRunId })
      .from(builds)
      .where(eq(builds.id, forcedBuildId));
    const rows = await db
      .select({
        videoPath: testResults.videoPath,
        stepTimings: testResults.stepTimings,
      })
      .from(testResults)
      .where(eq(testResults.testRunId, fb!.testRunId!));
    // The forced path really does record, which is what isolates the finding
    // in step 7 to the Settings toggle rather than to video support at large.
    expect(rows.filter((r) => r.videoPath).length).toBeGreaterThan(0);
    expect(rows.some((r) => r.stepTimings)).toBe(true);
    mark("7b: video recorded");

    await gotoSettled(page, `/verify/${forcedBuildId}?mode=focus`);
    await page.locator('button[aria-label^="Run — "]').first().click();
    await page.waitForTimeout(500);
    const video = page.locator("video").first();
    await expect
      .poll(() => video.isVisible().catch(() => false), { timeout: 60_000 })
      .toBe(true);
    mark("7b: recording card rendered");

    // Segment ticks come from persisted stepTimings; clicking one seeks the
    // video *and* selects that step in the case rail.
    // The control bar (and with it the segment strip) only paints on hover.
    // Hover the centred Play overlay rather than the `<video>` itself: it sits
    // at the video's exact centre point, so a plain `video.hover()` spends its
    // whole timeout reporting "subtree intercepts pointer events". Same mouse
    // position either way, so the player sees the same hover.
    const playOverlay = page.getByRole("button", { name: "Play" }).first();
    await ((await playOverlay.count()) > 0 ? playOverlay : video).hover();
    await page.waitForTimeout(300);
    const ticks = page.locator('button[aria-label^="Seek to step "]');
    await expect
      .poll(() => ticks.count(), { timeout: 30_000, interval: 500 })
      .toBeGreaterThan(0);
    // One tick per persisted step timing — the ladder in
    // `resolveStepSegments` is what produced them.
    expect(await ticks.count()).toBeGreaterThan(0);

    const target1 = ticks.last();
    // `title` carries the segment's own "m:ss – m:ss" range, so the expected
    // seek target is readable straight off the tick.
    const title = (await target1.getAttribute("title")) ?? "";
    const startS = (() => {
      const m = title.match(/\((\d+):(\d+)\s*–/);
      return m ? Number(m[1]) * 60 + Number(m[2]) : null;
    })();
    const before = await video.evaluate(
      (v) => (v as HTMLVideoElement).currentTime,
    );
    await target1.click();
    await page.waitForTimeout(800);
    const after = await video.evaluate(
      (v) => (v as HTMLVideoElement).currentTime,
    );
    // In sync: the playhead landed on the segment the tick describes.
    expect(after).not.toBe(before);
    if (startS !== null) expect(Math.abs(after - startS)).toBeLessThan(1.5);
    // …and the rail followed the seek to a step.
    expect(new URL(page.url()).searchParams.get("step")).toBeTruthy();
    mark(`7: scrubber seek ${before} -> ${after} (tick "${title}")`);
  }, 600_000);
});
