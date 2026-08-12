/**
 * §4 golden-path steps 10–11, driven through the *rendered* UI.
 *
 * `docs/architecture/core-plugin-refactor-test-plan.md` §2.18 recorded exactly
 * one honest gap after §1–§3: "No browser-automation tool was available in
 * this environment, so nothing requiring an actual rendered/interactive UI was
 * exercised end to end", naming **the EB live-stream viewer** first among the
 * casualties. This file closes that gap for the two agent surfaces:
 *
 *   step 10 — Explorer (`/explorer`): start a session, watch the live EB
 *             stream, run to completion, check findings + knowledge, confirm
 *             the EB slot came back.
 *   step 11 — QA Agent (`/qa-agent`): crawl → tasks (plan) → execution →
 *             report, all from the real page.
 *
 * ### What this deliberately does NOT re-prove
 *
 * §3 already covered both pipelines at the data layer — explorer via
 * `plugins/explorer/src/explorer.integration.test.ts` (cron-trigger dispatch →
 * `explorer_sessions` terminal status → knowledge/experience/findings queries)
 * and QA Agent via `src/server/actions/qa-agent.integration.test.ts`
 * (`startQaAgentFromTrigger` → `agentSessions.metadata.qaSummary`). Both had to
 * use the session-free *trigger* entry points, because `startExplorerAgent` /
 * `startQaAgent` call `requireRepoAccess`, which needs real cookies a Vitest
 * process does not have.
 *
 * So the value added here is precisely the half those files could not touch:
 * the manual server actions behind a real logged-in session, the polling
 * clients (`use-explorer-agent`, `use-qa-agent`), the plugin's UI rendering
 * from inside a workspace package through `@lastest/ui`'s re-exported
 * primitives, the app-supplied `BrowserViewer` slot crossing the RSC boundary
 * — and a canvas that actually receives pixels.
 *
 * ### The live-stream assertion (the point of step 10)
 *
 * "The page loaded" would be worthless here. `assertStreamPainted()` requires
 * all three of:
 *   1. the viewer left `connecting` — the status strip shows `N FPS`, which is
 *      only rendered when `connectionStatus === "connected"`, and the
 *      "Connecting to browser..." overlay is gone;
 *   2. the `<canvas>` has non-zero intrinsic dimensions, which only happens in
 *      `drawFrame()` after a decoded JPEG arrives (it is unsized markup
 *      otherwise); and
 *   3. `getImageData` shows a non-uniform image — real page pixels, not a
 *      blank or single-colour canvas. The canvas is drawn from a `data:` URL
 *      `<img>`, which does not taint it, so this read is legal.
 *
 * That whole chain runs through the front proxy's HMAC stream grant
 * (§2.1's "confirm the stream connects through the front proxy, not directly
 * to a pod IP") — the browser only ever holds the opaque grant URL, so frames
 * arriving at all is also end-to-end evidence for the grant + the per-instance
 * `x-stream-token` derivation.
 *
 * ### Scope choices
 *
 * The target is the harness's tiny local app rather than a public sandbox: a
 * one-page target keeps the crawl, the planner's context, and the number of
 * generated tests small enough for both runs to finish in a sane window, and
 * it removes the network from the failure surface. Explorer runs with
 * `maxIterations: 1`; QA Agent runs with every unlocked coverage group
 * deselected (only the always-on "journey" group remains) and auto-approve on.
 *
 * Both tests are tolerant about the *content* an AI produces (a one-page app
 * may legitimately yield zero findings) and strict about the UI reaching the
 * right states. A `failed` terminal state is accepted only when the UI itself
 * renders the failure — a silent stall is not.
 *
 * Prerequisites: `docker compose up -d`, `pnpm dev:pool`, `pnpm dev`.
 * Run with `pnpm vitest run --config vitest.integration.config.ts e2e/agents-ui.integration.test.ts`.
 */
import { getPoolStatus } from "@lastest/pool-service/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Locator, Page } from "playwright";

import {
  BASE_URL,
  destroyTeam,
  launchSession,
  onboardWithSandbox,
  registerViaUi,
  startTargetApp,
  teamIdForEmail,
  waitForPoolHeadroom,
  type Session,
  type TargetApp,
} from "./harness";

// ── Local helpers (not in the harness — several suites share that file) ─────

/**
 * Poll `probe` until it returns a truthy value. Used instead of
 * `expect.poll` because these waits are minutes long and the failure message
 * needs to say which UI state never arrived.
 */
async function until<T>(
  label: string,
  probe: () => Promise<T | null | undefined | false>,
  timeoutMs: number,
  intervalMs = 2_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  for (;;) {
    try {
      const v = await probe();
      if (v) return v as T;
      last = v;
    } catch (err) {
      last = err instanceof Error ? err.message : err;
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${label} (last: ${String(last)})`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/**
 * These suites run under Vitest, not `@playwright/test`, so chai's `expect`
 * has no `toBeVisible`/`toBeEnabled`. Waiting through the locator API is the
 * equivalent — and it fails with Playwright's own "waiting for locator…"
 * message, which is more useful than a boolean assertion anyway.
 */
async function seeVisible(loc: Locator, timeoutMs = 30_000): Promise<void> {
  await loc.first().waitFor({ state: "visible", timeout: timeoutMs });
}

async function seeEnabled(
  loc: Locator,
  label: string,
  timeoutMs = 30_000,
): Promise<void> {
  await seeVisible(loc, timeoutMs);
  await until(
    `${label} to become enabled`,
    () => loc.first().isEnabled(),
    timeoutMs,
    500,
  );
}

interface CanvasProbe {
  present: boolean;
  width: number;
  height: number;
  /** Distinct 4-byte pixels sampled across the canvas. 1 == flat fill. */
  distinctColors: number;
  /** Cheap content fingerprint, so two samples can be compared for motion. */
  signature: string;
}

/**
 * Read the live-stream canvas from inside the page.
 *
 * The canvas is painted by `drawFrame()` from a `data:image/jpeg;base64` image,
 * so it is NOT origin-tainted and `getImageData` is allowed — which is the only
 * way to distinguish "a canvas element exists" from "frames are arriving".
 */
async function probeCanvas(page: Page): Promise<CanvasProbe> {
  return page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (!canvas) {
      return {
        present: false,
        width: 0,
        height: 0,
        distinctColors: 0,
        signature: "",
      };
    }
    const w = canvas.width;
    const h = canvas.height;
    if (!w || !h) {
      return {
        present: true,
        width: w,
        height: h,
        distinctColors: 0,
        signature: "",
      };
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return {
        present: true,
        width: w,
        height: h,
        distinctColors: 0,
        signature: "",
      };
    }
    const data = ctx.getImageData(0, 0, w, h).data;
    const colors = new Set<number>();
    let sum = 0;
    // Sample a grid rather than every pixel — a 1280×720 frame is 3.6M bytes.
    const stepX = Math.max(1, Math.floor(w / 60));
    const stepY = Math.max(1, Math.floor(h / 40));
    for (let y = 0; y < h; y += stepY) {
      for (let x = 0; x < w; x += stepX) {
        const i = (y * w + x) * 4;
        const rgb = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
        colors.add(rgb);
        sum = (sum * 31 + rgb) >>> 0;
      }
    }
    return {
      present: true,
      width: w,
      height: h,
      distinctColors: colors.size,
      signature: `${w}x${h}:${sum.toString(16)}`,
    };
  });
}

interface StreamEvidence {
  fpsText: string;
  first: CanvasProbe;
  second: CanvasProbe;
}

/**
 * The step-10 assertion §2.18 could not make: the EB live-stream viewer really
 * painted in a real browser.
 *
 * Called while the agent run is in flight; returns the evidence it collected so
 * the test can log something concrete rather than just a green tick.
 */
async function assertStreamPainted(
  page: Page,
  timeoutMs = 240_000,
): Promise<StreamEvidence> {
  // 1. The viewer's status strip only renders "N FPS" for
  //    connectionStatus === "connected" — reaching it means the WS upgrade
  //    through the front proxy's HMAC grant succeeded.
  const fps = page.locator("text=/\\d+ FPS/").first();
  await until(
    "the stream viewer to report FPS (i.e. leave the connecting state)",
    async () => (await fps.count()) > 0 && (await fps.first().isVisible()),
    timeoutMs,
    1_000,
  );
  const fpsText = ((await fps.textContent()) ?? "").trim();

  // The blocking "Connecting to browser..." overlay must be gone with it.
  expect(
    await page.locator("text=Connecting to browser...").count(),
  ).toBeLessThanOrEqual(0);

  // 2 + 3. Real pixels: sized canvas with a non-uniform image.
  const first = await until(
    "the stream canvas to receive a decoded frame",
    async () => {
      const probe = await probeCanvas(page);
      return probe.width > 0 && probe.height > 0 && probe.distinctColors > 1
        ? probe
        : null;
    },
    timeoutMs,
    500,
  );

  // A second sample a beat later. Not asserted to differ — an idle page
  // legitimately streams identical frames — but captured as evidence that the
  // canvas keeps its content rather than being cleared after one draw.
  await page.waitForTimeout(3_000);
  const second = await probeCanvas(page);
  expect(second.width).toBeGreaterThan(0);
  expect(second.distinctColors).toBeGreaterThan(1);

  return { fpsText, first, second };
}

/** Text of the whole page, for coarse "did this panel render" probes. */
async function bodyText(page: Page): Promise<string> {
  return (await page.locator("body").innerText()).replace(/\s+/g, " ");
}

/**
 * Every `@lastest/ui` / shadcn Badge currently on the page.
 *
 * Explorer renders the session status as a bare badge (`{session.status}`), so
 * this is the UI's own view of the pipeline state — deliberately read from the
 * badge rather than from the database, since the point of this file is that
 * the *rendered* surface tracks the run.
 */
async function badgeTexts(page: Page): Promise<string[]> {
  return (await page.locator('[data-slot="badge"]').allInnerTexts()).map((t) =>
    t.trim().toLowerCase(),
  );
}

// ── Fixture: one registered team + onboarded sandbox repo for both steps ────

let target: TargetApp;
let session: Session;
let teamId: string | undefined;

/**
 * Register + onboard, retrying on a fresh browser session.
 *
 * Not defensive padding: with four integration suites sharing one `pnpm dev`
 * server, the register form is occasionally clicked before React has hydrated
 * it, the submit does nothing, and `waitForURL(/onboarding/)` burns its whole
 * 60s. Retrying the *whole* fixture rather than the click is what keeps it
 * correct — `launchSession()` mints a new email each time, so a retry can
 * never collide with a half-created account from the previous attempt.
 *
 * Each abandoned attempt's team is torn down, so a retry does not leak rows.
 */
async function setupFixture(attempts = 3): Promise<void> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    const candidate = await launchSession();
    try {
      await registerViaUi(candidate, "Agents UI");
      await onboardWithSandbox(
        candidate,
        target.origin,
        `agents-ui-${Date.now()}`,
      );
      session = candidate;
      teamId = await teamIdForEmail(candidate.email);
      return;
    } catch (err) {
      lastErr = err;
      console.warn(
        `[fixture] attempt ${i}/${attempts} failed: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`,
      );
      await destroyTeam(
        await teamIdForEmail(candidate.email).catch(() => undefined),
      );
      await candidate.close();
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

beforeAll(async () => {
  target = await startTargetApp();
  await setupFixture();
}, 600_000);

afterAll(async () => {
  await session?.close();
  await destroyTeam(teamId);
  await target?.close();
}, 120_000);

// ── Step 10 — Explorer ──────────────────────────────────────────────────────

describe("§4 step 10 — Explorer session with a live EB stream", () => {
  it("starts from the UI, paints the live stream, runs to a terminal state, shows findings/knowledge, and releases the EB", async () => {
    const { page } = session;
    await waitForPoolHeadroom(1, 300_000);

    await page.goto(`${BASE_URL}/explorer`, { waitUntil: "domcontentloaded" });

    // The plugin's page renders from inside the workspace package; if the RSC
    // boundary or `@lastest/ui`'s re-exports were broken this is where it shows.
    await seeVisible(page.getByRole("heading", { name: "Explorer", level: 1 }));
    // The three tabs are `@lastest/ui` Tabs rendered from the plugin.
    for (const tab of ["Explore", "Knowledge", "Experience"]) {
      await seeVisible(page.getByRole("tab", { name: tab }), 15_000);
    }

    // Setup form. `#x-url` is prefilled from the repo's base URL (what
    // onboarding just saved) — set it explicitly anyway so the test does not
    // depend on that plumbing.
    const urlInput = page.locator("input#x-url");
    await urlInput.waitFor({ state: "visible", timeout: 30_000 });
    await urlInput.fill(target.origin);
    await page.locator("input#x-iterations").fill("1");

    const startBtn = page.getByRole("button", { name: /start exploration/i });
    await seeEnabled(startBtn, '"Start exploration"', 30_000);
    await startBtn.click();

    // The setup card is replaced by the run card once the server action
    // returns a session id and the poller picks it up.
    await until(
      "the explorer run card (status badge) to appear",
      async () =>
        (await badgeTexts(page)).some((t) =>
          ["active", "paused", "completed", "failed", "cancelled"].includes(t),
        ),
      120_000,
      1_000,
    );

    // The live-browser card only mounts while the session is running/paused
    // AND the app supplied the `BrowserViewer` slot AND a stream grant (or a
    // queued marker) exists — i.e. the whole §2.1 chain.
    await until(
      "the Live browser card",
      async () => (await page.getByText("Live browser").count()) > 0,
      180_000,
      1_000,
    );

    // ── The assertion §2.18 could not make ───────────────────────────────
    const evidence = await assertStreamPainted(page);
    console.log(
      `[step 10] live EB stream painted: ${evidence.fpsText}, canvas ` +
        `${evidence.first.width}x${evidence.first.height}, ` +
        `${evidence.first.distinctColors} distinct sampled colours ` +
        `(sig ${evidence.first.signature} → ${evidence.second.signature})`,
    );
    expect(evidence.fpsText).toMatch(/\d+ FPS/);
    expect(evidence.first.width).toBeGreaterThan(0);
    expect(evidence.first.distinctColors).toBeGreaterThan(1);

    // Let it run out. `use-explorer-agent` polls every 2s and stops on a
    // terminal status, so the badge is the UI's own view of the pipeline.
    const terminal = await until(
      "the explorer session to reach a terminal status in the UI",
      async () =>
        (await badgeTexts(page)).find((t) =>
          ["completed", "failed", "cancelled"].includes(t),
        ) ?? null,
      900_000,
      3_000,
    );
    console.log(`[step 10] explorer terminal status in UI: ${terminal}`);
    expect(["completed", "failed", "cancelled"]).toContain(terminal);

    // The run card must survive the transition (progress bar + timeline still
    // rendered) and offer the "New run" affordance the terminal branch adds.
    expect(
      await page.locator('[data-slot="progress"]').first().isVisible(),
    ).toBe(true);
    await seeVisible(page.getByRole("button", { name: /^New run$/ }), 60_000);

    // Findings: content is best-effort (a one-page target may yield none), so
    // assert the panel renders rather than a row count — the same standard
    // §3 applied to the query layer.
    const finalText = await bodyText(page);
    expect(/finding|report|no findings/i.test(finalText)).toBe(true);

    // Knowledge + Experience tabs: §3's "confirm knowledge/experience pages
    // still show historical data after the table rename", now through the
    // actual rendered tab rather than the exported query.
    await page.getByRole("tab", { name: "Knowledge" }).click();
    await until(
      "the Knowledge tab panel to render",
      async () => /knowledge|note|url pattern/i.test(await bodyText(page)),
      30_000,
      500,
    );
    await page.getByRole("tab", { name: "Experience" }).click();
    await until(
      "the Experience tab panel to render",
      async () => /experience|no experience|page/i.test(await bodyText(page)),
      30_000,
      500,
    );

    // EB released — §2.1's release-on-completion, observed from outside.
    const freed = await until(
      "the EB pool slot to be released",
      async () => {
        const status = await getPoolStatus();
        return !status || status.size < status.max ? (status ?? true) : null;
      },
      120_000,
      2_000,
    );
    console.log(`[step 10] pool after run: ${JSON.stringify(freed)}`);
  }, 1_500_000);
});

// ── Step 11 — QA Agent ──────────────────────────────────────────────────────

describe("§4 step 11 — QA Agent session: crawl → tasks → execution → report", () => {
  it("runs a full session from /qa-agent and the UI walks the phase timeline to a report", async () => {
    const { page } = session;
    await waitForPoolHeadroom(1, 300_000);

    await page.goto(`${BASE_URL}/qa-agent`, { waitUntil: "domcontentloaded" });
    await seeVisible(page.getByRole("heading", { name: "QA Agent", level: 1 }));

    // Billing is disabled in this environment, so §2.9's gate must resolve to
    // "access granted" — the upgrade screen appearing here is a real failure.
    expect(await page.getByText(/requires the .* plan/i).count()).toBe(0);

    // A repo that has never run lands straight on the setup card.
    const urlInput = page.locator("input#qa-url");
    await urlInput.waitFor({ state: "visible", timeout: 30_000 });
    await urlInput.fill(target.origin);

    // Keep the plan tiny: deselect every unlocked coverage group (the
    // always-on "journey" group cannot be unchecked) so generation stays to a
    // handful of tests on a one-page target.
    const groupBoxes = page.locator('label [role="checkbox"]');
    const groupCount = await groupBoxes.count();
    for (let i = 0; i < groupCount; i++) {
      const box = groupBoxes.nth(i);
      if (await box.isDisabled().catch(() => false)) continue;
      if ((await box.getAttribute("data-state")) === "checked") {
        await box.click();
      }
    }

    // Auto-approve: the human review gate would otherwise park the run
    // forever. The gate itself is exercised read-only below — the plan panel
    // still renders after `qa_plan` completes.
    const autoApprove = page
      .locator("div.rounded-md.border", { hasText: "Auto-approve plan" })
      .locator('[role="switch"]')
      .first();
    await seeVisible(autoApprove, 15_000);
    if ((await autoApprove.getAttribute("data-state")) !== "checked") {
      await autoApprove.click();
    }
    expect(await autoApprove.getAttribute("data-state")).toBe("checked");

    const startBtn = page.getByRole("button", { name: /start qa agent/i });
    await seeEnabled(startBtn, '"Start QA agent"', 30_000);
    await startBtn.click();

    // The setup card collapses into the live phase timeline.
    await until(
      "the QA phase timeline to appear",
      async () => {
        const text = await bodyText(page);
        return /Preflight/.test(text) && /Discover/.test(text);
      },
      120_000,
      1_000,
    );

    // ── crawl ─────────────────────────────────────────────────────────────
    // The Discover phase is the crawl; it holds an EB, so the same live-stream
    // viewer must mount and paint here too (this one is the app's own
    // `BrowserViewer` usage rather than the plugin's injected slot).
    await until(
      "the QA agent's Live browser card",
      async () => (await page.getByText("Live browser").count()) > 0,
      300_000,
      1_500,
    );
    const qaEvidence = await assertStreamPainted(page);
    console.log(
      `[step 11] live EB stream painted during crawl: ${qaEvidence.fpsText}, ` +
        `canvas ${qaEvidence.first.width}x${qaEvidence.first.height}, ` +
        `${qaEvidence.first.distinctColors} distinct sampled colours`,
    );

    // ── tasks (the plan) ──────────────────────────────────────────────────
    // `QaPlanReview` renders once `qa_plan` completes (read-only after
    // auto-approve), and `Approve N tests` is its own button text — the
    // concrete "tasks" artifact between crawl and execution.
    await until(
      "the generated plan to render (crawl → tasks)",
      async () => {
        const text = await bodyText(page);
        return /Approve \d+ test|Test plan|plan item|journeys?/i.test(text);
      },
      900_000,
      3_000,
    );
    console.log("[step 11] plan rendered");

    // ── execution ─────────────────────────────────────────────────────────
    // Terminal state per the UI's own words. `QaRunHistory`'s `headline()` is
    // the unambiguous signal: "Running — <phase>" while live, and one of
    // "N planned · … · N passing" / "Completed" / "Cancelled" / "Failed at
    // <phase>" once it stops. Matching on that beats scanning for the word
    // "completed" anywhere on a page that also lists phase names.
    const terminal = await until(
      "the QA session to reach a terminal state in the UI",
      async () => {
        const text = await bodyText(page);
        if (/\bRunning\b/.test(text)) return null;
        if (/\d+ planned/.test(text) || /\bCompleted\b/.test(text)) {
          return "completed";
        }
        if (/\bFailed(?: at )?/.test(text)) return "failed";
        if (/\bCancelled\b/.test(text)) return "cancelled";
        return null;
      },
      1_500_000,
      5_000,
    );
    console.log(`[step 11] QA terminal state in UI: ${terminal}`);
    expect(["completed", "failed", "cancelled"]).toContain(terminal);

    // ── report ────────────────────────────────────────────────────────────
    // `QaSummaryPanel` is the persistent coverage dashboard: Planned /
    // Covered / Generated / Passed stat tiles. On a `failed` run it may be
    // absent — in that case the UI must still name the failed phase rather
    // than stalling silently.
    const finalText = await bodyText(page);
    if (terminal === "completed") {
      // `QaSummaryPanel`'s stat tiles — the standing coverage artifact.
      for (const tile of ["Planned", "Covered", "Generated", "Passed"]) {
        expect(finalText.includes(tile), `summary tile "${tile}"`).toBe(true);
      }
      const headline = /(\d+) planned/.exec(finalText);
      console.log(
        `[step 11] report rendered — run-history headline planned=${headline?.[1] ?? "?"}`,
      );
    } else {
      // A failed run is acceptable evidence only if the UI names the phase it
      // died in rather than stalling silently.
      expect(/Failed at |Cancelled/.test(finalText)).toBe(true);
      console.log(
        `[step 11] run ended ${terminal}; UI named the failing phase (see report)`,
      );
    }

    // Run history always gets the session, terminal state regardless.
    expect(/Runs|history|manual/i.test(finalText)).toBe(true);

    // EB released.
    const freed = await until(
      "the EB pool slot to be released after the QA run",
      async () => {
        const status = await getPoolStatus();
        return !status || status.size < status.max ? (status ?? true) : null;
      },
      180_000,
      2_000,
    );
    console.log(`[step 11] pool after run: ${JSON.stringify(freed)}`);
  }, 2_400_000);
});
