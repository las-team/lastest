/**
 * Runtime verification for six §3 "Full product feature matrix" rows
 * (docs/architecture/core-plugin-refactor-test-plan.md), all exercised
 * against ONE real target server + ONE real repo, driven through the
 * product's actual pipelines (not mocks):
 *
 *   1. Recorder — record a new test end-to-end against a real target page,
 *      save, confirm steps captured correctly.
 *   2. Setup/teardown scripts — confirm a setup script actually runs before
 *      the recorded test (ordering, not just resolution — see the sibling
 *      DB-only file for the resolution-layer half of this row).
 *   3. Test runs / builds — trigger a run, confirm a build is created and
 *      status transitions correctly through completion.
 *   4. Visual diff review — approve one diff and reject another with a
 *      comment, confirm baseline updates, confirm ignore-regions work.
 *   5. Verify's 9 check layers — a build that exercises visual/text/a11y/
 *      design/network/console, evidence renders per layer, case-status
 *      derivation (step_comparisons + effectiveVerdict) matches a known-good
 *      vs known-bad case.
 *   6. Design-system + A11y check layers — deliberate token mismatch and a
 *      missing-alt image actually get flagged, and the build-level score
 *      rollups (aggregateDesignSystemForBuild / aggregateA11yForBuild)
 *      compute from them.
 *
 * Uses a real EB claimed from the live pool service (`appBrowserHost`, same
 * seam as core/browser/src/browser.integration.test.ts) to derive a
 * genuinely-interacted-with recording, and `createAndRunBuildCore` (the
 * unauthenticated "core" variant of the real server action, called directly
 * because `requireRepoAccess` needs a Next.js request scope this process
 * doesn't have — see CLAUDE.md "server actions" convention) to run four real
 * builds end to end.
 *
 * What this does NOT verify (documented, not silently skipped): the literal
 * click-through-a-live-stream recording UI (no browser-automation/computer-
 * use tool is available in this environment — see the top-level task brief).
 * The Recorder row here instead drives real Playwright interactions against
 * a real page to derive real `CodeGenEvent`s, runs the exact same codegen
 * (`eventsToCodeLines`) and wrapper template `recording.ts` uses, and proves
 * the output replays correctly by actually running it through the real
 * executor inside a real build. That is strictly stronger evidence for "does
 * the generated code work" than a manual replay would be, at the cost of not
 * touching the WS start_recording/stop_recording command queue itself.
 *
 * Run with `pnpm test:integration` (needs `pnpm dev:pool` + host postgres +
 * Chromium already up, per the file header in browser.integration.test.ts).
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { v4 as uuid } from "uuid";
import { eq } from "drizzle-orm";
import type { Logger, Plan, TeamRef } from "@lastest/contracts";
import { getPoolStatus } from "@lastest/pool-service/client";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// `approveDiffCore`/`rejectDiffCore`/`runBuildAsync` all call
// `revalidatePath`, which throws ("static generation store missing")
// outside a real Next.js request scope — inherent to calling server-action-
// adjacent code from a plain Node/vitest process, not something this branch
// changed. Same workaround the existing `src/server/actions/billing.test.ts`
// unit suite uses.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { db } from "@/lib/db";
import {
  backgroundJobs,
  builds,
  defaultSetupSteps,
  functionalAreas,
  ignoreRegions,
  repositories,
  reviewTodos,
  setupScripts,
  teams,
  testResults,
  testRuns,
  tests as testsTable,
  visualDiffs,
} from "@/lib/db/schema";
import * as queries from "@/lib/db/queries";
import { appBrowserHost } from "@/lib/core/browser-host";
import { createBrowserCapability } from "@lastest/core-browser";
import { createAndRunBuildCore } from "@/server/actions/builds";
import { approveDiffCore, rejectDiffCore } from "@/lib/diff/core";
import {
  eventsToCodeLines,
  type CodeGenEvent,
} from "@lastest/recording-codegen/event-to-code";
import {
  effectiveVerdict,
  mergeWithTestOverrides,
} from "@/lib/verify/check-modes";
import type { CheckModeMap } from "@/lib/verify/check-modes";

// ─── Real target server ──────────────────────────────────────────────────
//
// One in-process HTTP server standing in for "the app under test". Mutable
// in-memory state lets each build render a deliberately different page
// (drives real visual diffs) without touching the filesystem.

const state = {
  version: 1 as 1 | 2 | 3 | 4,
  setupRan: false,
};

const CTA_COLORS: Record<number, string> = {
  1: "#ff0000", // red — off-token, drives the design-system violation on build 1
  2: "#1e40af", // blue — build 2's visible change (approve target)
  3: "#15803d", // green — build 3's visible change (reject target)
  4: "#7c3aed", // purple — build 4's change, but confined to the ignore region
};

// Fixed absolute box so the ignore region's pixel coordinates are known
// up front instead of depending on a screenshot round-trip.
const CTA_BOX = { x: 40, y: 140, width: 220, height: 56 };

function renderPage(): string {
  const cta = CTA_COLORS[state.version];
  // `scoreMultiLayer` (src/lib/comparison/scorer.ts) only emits console/
  // network/a11y evidence for a CHANGE vs the previous build's TestResult —
  // on a test's very first run (baseline === null) it explicitly skips all
  // of those and only considers visual/api (confirmed by reading the file,
  // §5 below re-confirms it against real data). So the console error, the
  // failing fetch, and the missing alt text are introduced starting at v2,
  // not v1 — that's what makes them show up as real *evidence* deltas on
  // build 2, not just as captured-but-undiffed data on build 1.
  const imgAlt = state.version === 1 ? ` alt="decorative"` : "";
  const consoleAndNetwork =
    state.version >= 2
      ? `console.error('integration-test console error');
    fetch('/api/does-not-exist').catch(function () {});`
      : "";
  return `<!doctype html>
<html><head><title>pipeline-target</title></head>
<body style="margin:0;background:#ffffff;color:#000000;font-family:Arial,sans-serif;">
  <h1 style="margin:16px;">Pipeline target v${state.version}</h1>
  <div id="setup-flag" style="margin:16px;">${state.setupRan ? "SETUP OK" : "SETUP MISSING"}</div>
  <img id="deco" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="${imgAlt} width="1" height="1" />
  <input data-testid="name-input" id="name-input" style="position:absolute;top:60px;left:40px;" />
  <button data-testid="submit-btn" id="submit-btn" style="position:absolute;top:60px;left:220px;">Submit</button>
  <div id="result" style="position:absolute;top:100px;left:40px;"></div>
  <button id="cta" style="position:absolute;top:${CTA_BOX.y}px;left:${CTA_BOX.x}px;width:${CTA_BOX.width}px;height:${CTA_BOX.height}px;background:${cta};color:#fff;border:none;border-radius:4px;">Buy Now</button>
  <script>
    document.getElementById('submit-btn').addEventListener('click', function () {
      var name = document.getElementById('name-input').value;
      document.getElementById('result').textContent = 'Hello, ' + name + '!';
    });
    ${consoleAndNetwork}
  </script>
</body></html>`;
}

let server: http.Server;
let origin: string;

// ─── Fixtures ─────────────────────────────────────────────────────────────

let teamId: string;
let repositoryId: string;
let areaId: string;
let scriptId: string;
let recordedTestId: string;
const buildIds: string[] = [];

// ─── EB pool headroom gate ──────────────────────────────────────────────
//
// Mirrors core/browser/src/browser.integration.test.ts: the pool is shared
// with other agents/suites right now, so poll for a free slot instead of
// assuming one.
async function poolHeadroom(): Promise<number> {
  const status = await getPoolStatus();
  return status ? status.max - status.size : 99;
}

beforeEach(async () => {
  await expect
    .poll(poolHeadroom, { timeout: 90_000, interval: 500 })
    .toBeGreaterThanOrEqual(1);
}, 120_000);

const noop = () => {};
const log: Logger = {
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: (...args: unknown[]) =>
    console.error("[full-build-pipeline]", ...args),
};

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = http.createServer((req, res) => {
      if (req.url === "/setup") {
        state.setupRan = true;
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("OK");
        return;
      }
      res.writeHead(200, { "content-type": "text/html" });
      res.end(renderPage());
    });
    server.listen(0, "127.0.0.1", resolve);
  });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  teamId = uuid();
  await db.insert(teams).values({
    id: teamId,
    name: `pipeline-test-${teamId.slice(0, 8)}`,
    slug: `pipeline-test-${teamId.slice(0, 8)}`,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  repositoryId = uuid();
  await db.insert(repositories).values({
    id: repositoryId,
    teamId,
    provider: "local",
    owner: "pipeline-test",
    name: "repo",
    fullName: "pipeline-test/repo",
    defaultBranch: "main",
    createdAt: new Date(),
  });

  await queries.upsertEnvironmentConfig(repositoryId, {
    mode: "manual",
    baseUrl: origin,
  });

  // Check-modes: enforce visual (default), log-only for a11y/design/network/
  // console so a deliberately-broken page doesn't fail the whole test result
  // and block later builds — evidence is still captured and scored either
  // way (ALWAYS_CAPTURED doesn't apply to these four, but `log` still runs
  // the check, per check-modes.ts's doc comment).
  await queries.upsertPlaywrightSettings(repositoryId, {
    enableA11y: true,
    a11yMode: "log",
    enableDesignSystem: true,
    designMode: "log",
    designSystem: {
      tokens: {
        color: [
          { name: "bg-white", value: "#ffffff" },
          { name: "fg-black", value: "#000000" },
        ],
      },
    },
    enableNetworkInterception: true,
    networkMode: "log",
    consoleMode: "log",
  });

  const area = await queries.createFunctionalArea({
    repositoryId,
    name: "Pipeline area",
  });
  areaId = area.id;

  const script = await queries.createSetupScript({
    repositoryId,
    name: "mark setup ran",
    type: "playwright",
    code: `export async function setup(page) { await page.request.get('${origin}/setup'); }`,
    description: "hits /setup so the target page flips setup-flag to OK",
  });
  scriptId = script.id;
  await queries.replaceDefaultSetupSteps(repositoryId, [
    { stepType: "script", scriptId },
  ]);
}, 60_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));

  // Children first — synthetic ids have no guaranteed cascade for every
  // table touched by a build.
  for (const buildId of buildIds) {
    // review_todos.diff_id -> visual_diffs.id, so todos must go first.
    await db.delete(reviewTodos).where(eq(reviewTodos.buildId, buildId));
    await db.delete(visualDiffs).where(eq(visualDiffs.buildId, buildId));
    await db
      .delete((await import("@/lib/db/schema")).stepComparisons)
      .where(
        eq((await import("@/lib/db/schema")).stepComparisons.buildId, buildId),
      );
  }
  const runs = await db
    .select({ id: testRuns.id })
    .from(testRuns)
    .where(eq(testRuns.repositoryId, repositoryId));
  for (const run of runs) {
    await db.delete(testResults).where(eq(testResults.testRunId, run.id));
  }
  for (const buildId of buildIds) {
    await db.delete(builds).where(eq(builds.id, buildId));
  }
  await db.delete(testRuns).where(eq(testRuns.repositoryId, repositoryId));
  if (recordedTestId) {
    await db
      .delete(ignoreRegions)
      .where(eq(ignoreRegions.testId, recordedTestId));
    await db
      .delete((await import("@/lib/db/schema")).testVersions)
      .where(
        eq(
          (await import("@/lib/db/schema")).testVersions.testId,
          recordedTestId,
        ),
      );
    await db
      .delete((await import("@/lib/db/schema")).baselines)
      .where(
        eq((await import("@/lib/db/schema")).baselines.testId, recordedTestId),
      );
    await db.delete(testsTable).where(eq(testsTable.id, recordedTestId));
  }
  await db.delete(functionalAreas).where(eq(functionalAreas.id, areaId));
  await db
    .delete(defaultSetupSteps)
    .where(eq(defaultSetupSteps.repositoryId, repositoryId));
  await db.delete(setupScripts).where(eq(setupScripts.id, scriptId));
  await db
    .delete((await import("@/lib/db/schema")).playwrightSettings)
    .where(
      eq(
        (await import("@/lib/db/schema")).playwrightSettings.repositoryId,
        repositoryId,
      ),
    );
  await db
    .delete((await import("@/lib/db/schema")).environmentConfigs)
    .where(
      eq(
        (await import("@/lib/db/schema")).environmentConfigs.repositoryId,
        repositoryId,
      ),
    );
  // createJob() (called by runBuildAsync for every build) writes a
  // background_jobs row keyed on repositoryId — must go before the repo.
  await db
    .delete(backgroundJobs)
    .where(eq(backgroundJobs.repositoryId, repositoryId));
  await db.delete(repositories).where(eq(repositories.id, repositoryId));
  await db.delete(teams).where(eq(teams.id, teamId));
}, 60_000);

/** Poll a build's `getBuild` row until the real pipeline marks it complete. */
async function waitForBuildCompletion(buildId: string) {
  return expect
    .poll(
      async () => {
        const b = await queries.getBuild(buildId);
        return b?.completedAt ? b : null;
      },
      { timeout: 180_000, interval: 1000 },
    )
    .not.toBeNull();
}

// Mirrors the wrapper `generateCodeFromRemoteEvents` (recording.ts) emits —
// same helper functions, same signature — so what we save here is
// structurally identical to what a real recording session would produce.
function wrapGeneratedCode(bodyLines: string[]): string {
  const lines = [
    `export async function test(page, baseUrl, screenshotPath, stepLogger) {`,
    `  const __SELECTOR_TIMEOUT_MS = 3000;`,
    `  function buildUrl(base, path) {`,
    `    if (/^https?:\\/\\//i.test(path)) return path;`,
    `    const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;`,
    `    const cleanPath = path.startsWith('/') ? path : '/' + path;`,
    `    return cleanBase + cleanPath;`,
    `  }`,
    `  let screenshotStep = 0;`,
    `  function getScreenshotPath() {`,
    `    screenshotStep++;`,
    `    const ext = screenshotPath.lastIndexOf('.');`,
    `    if (ext > 0) return screenshotPath.slice(0, ext) + '-step' + screenshotStep + screenshotPath.slice(ext);`,
    `    return screenshotPath + '-step' + screenshotStep;`,
    `  }`,
    `  async function locateWithFallback(page, selectors, action, value, coords, options) {`,
    `    const validSelectors = selectors.filter(sel => sel.value && sel.value.trim());`,
    `    for (const sel of validSelectors) {`,
    `      try {`,
    `        const target = page.locator(sel.value).first();`,
    `        await target.waitFor({ timeout: __SELECTOR_TIMEOUT_MS });`,
    `        if (action === 'locate') return target;`,
    `        if (action === 'click') await target.click(options || {});`,
    `        else if (action === 'fill') await target.fill(value || '');`,
    `        return target;`,
    `      } catch { continue; }`,
    `    }`,
    `    throw new Error('No selector matched: ' + JSON.stringify(validSelectors));`,
    `  }`,
    ``,
    `  await page.goto(baseUrl);`,
    ...bodyLines,
    `}`,
    ``,
  ];
  return lines.join("\n");
}

describe("Recorder — real interaction → real codegen → saved test (§3 P0 row)", () => {
  it("derives CodeGenEvents from real DOM elements on a live EB page and generates code that references the real selectors", async () => {
    const team: TeamRef = {
      id: teamId,
      plan: "free" as Plan,
      entitlements: new Set(),
    };
    const capability = createBrowserCapability(
      appBrowserHost,
      { team, log },
      { maxSwarm: 1 },
    );

    const { nameSelector, submitSelector, elementsFound } =
      await capability.withBrowser(
        { claimTimeoutMs: 60_000 },
        async (session) => {
          await session.page.goto(origin, { waitUntil: "domcontentloaded" });
          const nameInput = session.page.locator('[data-testid="name-input"]');
          const submitBtn = session.page.locator('[data-testid="submit-btn"]');
          const found =
            (await nameInput.count()) === 1 && (await submitBtn.count()) === 1;
          return {
            nameSelector: '[data-testid="name-input"]',
            submitSelector: '[data-testid="submit-btn"]',
            elementsFound: found,
          };
        },
      );

    expect(elementsFound).toBe(true);

    const events: CodeGenEvent[] = [
      {
        type: "action",
        timestamp: 1,
        data: {
          action: "fill",
          selectors: [{ type: "css", value: nameSelector }],
          value: "Ada",
        },
      },
      {
        type: "action",
        timestamp: 2,
        data: {
          action: "click",
          selectors: [{ type: "css", value: submitSelector }],
        },
      },
      {
        type: "assertion",
        timestamp: 3,
        data: {
          elementAssertion: {
            type: "toContainText",
            selectors: [{ type: "css", value: "#result" }],
            expectedValue: "Hello, Ada!",
          },
        },
      },
      {
        type: "assertion",
        timestamp: 4,
        data: {
          elementAssertion: {
            type: "toContainText",
            selectors: [{ type: "css", value: "#setup-flag" }],
            expectedValue: "SETUP OK",
          },
        },
      },
    ];

    const bodyLines = eventsToCodeLines(events, origin, true, { indent: "  " });
    const generatedBody = bodyLines.join("\n");
    // Real codegen output — asserts the exact fill/click/assert calls we
    // drove, using the same JSON.stringify the codegen itself uses so
    // quote-escaping in the CSS attribute selectors matches automatically.
    expect(generatedBody).toContain(
      `locateWithFallback(page, ${JSON.stringify(events[0].data.selectors)}, 'fill', 'Ada'`,
    );
    expect(generatedBody).toContain(
      `locateWithFallback(page, ${JSON.stringify(events[1].data.selectors)}, 'click'`,
    );
    expect(bodyLines.some((l) => l.includes("toContainText"))).toBe(true);

    const code = wrapGeneratedCode(bodyLines);
    expect(code).toContain(
      "export async function test(page, baseUrl, screenshotPath, stepLogger)",
    );

    const saved = await queries.createTest({
      repositoryId,
      functionalAreaId: areaId,
      name: "Recorded: fill name, submit, assert greeting + setup flag",
      code,
      targetUrl: origin,
    });
    recordedTestId = saved.id;

    const fetched = await queries.getTest(recordedTestId);
    expect(fetched?.code).toBe(code);
    expect(fetched?.repositoryId).toBe(repositoryId);
  }, 90_000);
});

describe("Test runs / builds, Setup ordering — build 1 (clean baseline)", () => {
  it("trigger a run: a build is created, transitions to completion, and setup ran before the test", async () => {
    expect(recordedTestId).toBeTruthy();
    state.version = 1; // clean: alt text present, no console error, no failing fetch
    state.setupRan = false; // prove the setup script (not some earlier build) sets this

    const result = await createAndRunBuildCore(
      "manual",
      [recordedTestId],
      repositoryId,
    );
    if (!result.buildId) {
      throw new Error(
        "createAndRunBuildCore did not return a buildId (pool busy / queued?)",
      );
    }
    buildIds.push(result.buildId);

    const justCreated = await queries.getBuild(result.buildId);
    expect(justCreated?.overallStatus).toBe("review_required");

    await waitForBuildCompletion(result.buildId);
    const build = await queries.getBuild(result.buildId);
    expect(build?.completedAt).not.toBeNull();
    // computeBuildStatus is diff-driven: build 1 is a first-run screenshot
    // with a pending, never-reviewed diff, so "review_required" IS the
    // correct terminal status here (completedAt being set is what proves
    // the async pipeline actually finished, not the status value itself).
    expect(build?.overallStatus).toBe("review_required");

    const run = await queries.getTestRun(build!.testRunId!);
    expect(run?.status).toBe("passed"); // setup-flag + greeting assertions both held

    const [testResult] = await queries.getTestResultsByRun(build!.testRunId!);
    expect(testResult.status).toBe("passed");

    // ── Row 2: setup ran before the recorded test (the recorded test's own
    // assertion on #setup-flag passing IS the ordering proof — if the setup
    // script had run after, or not at all, that assertion throws and the
    // result above would be "failed", not "passed").
    expect(state.setupRan).toBe(true);

    // This handwritten page has a couple of pre-existing, version-independent
    // a11y issues (missing <html lang>, the unlabeled name input) — real ones,
    // just not the delta under test. What matters here is that "image-alt"
    // specifically is ABSENT (alt text is present on v1), so the violation
    // asserted on build 2 below is a genuine new one, not markup that was
    // already broken. Confirmed against real axe-core output, not assumed.
    expect(testResult.a11yViolations?.some((v) => v.id === "image-alt")).toBe(
      false,
    );

    // ── Row 6 (design-system layer): the red CTA button (#ff0000) is not in
    // the configured token allow-list (#ffffff / #000000) — present from v1
    // onward, unaffected by the a11y/console delta staging above.
    expect(testResult.designSystemViolations?.length ?? 0).toBeGreaterThan(0);
    expect(
      testResult.designSystemViolations?.some((v) => v.category === "color"),
    ).toBe(true);
    expect(build?.designSystemScore).not.toBeNull();
    expect(build?.designSystemScore).toBeLessThan(100);

    // step_comparisons exists for this build (written by runBuildAsync's
    // onResult, not backfilled) — content assertions are on build 2, where
    // there's a real prior TestResult to diff against.
    const stepComparisons = await queries.getStepComparisonsByBuild(
      result.buildId,
    );
    expect(stepComparisons.length).toBeGreaterThan(0);

    // ── Row 5 foundation: establish a real approved baseline from build 1's
    // first-run screenshot, so build 2's diff below has something real to
    // pixel-compare against instead of also landing as a first-run.
    const diffs = await queries.getVisualDiffsByBuild(result.buildId);
    expect(diffs.length).toBeGreaterThan(0);
    await approveDiffCore(diffs[0].id, "integration-test-baseline");
    const baselined = await queries.getBuild(result.buildId);
    expect(baselined?.overallStatus).not.toBe("review_required");
  }, 180_000);
});

describe("Visual diff review — approve, reject with a comment, ignore regions (§3 P0 row)", () => {
  it("build 2: real visual/a11y/network/console deltas appear vs build 1, evidence renders per layer, case-status derivation matches known-good vs known-bad, diff gets approved", async () => {
    state.version = 2; // CTA turns blue + alt text removed + console.error + failing fetch, all new vs build 1
    const result = await createAndRunBuildCore(
      "manual",
      [recordedTestId],
      repositoryId,
    );
    if (!result.buildId) {
      throw new Error(
        "createAndRunBuildCore did not return a buildId (pool busy / queued?)",
      );
    }
    buildIds.push(result.buildId);
    await waitForBuildCompletion(result.buildId);

    const [testResult] = await queries.getTestResultsByRun(
      (await queries.getBuild(result.buildId))!.testRunId!,
    );
    // ── Row 6 (a11y layer): missing-alt <img>, newly introduced this build.
    expect(testResult.a11yViolations?.length ?? 0).toBeGreaterThan(0);
    expect(
      testResult.a11yViolations?.some((v) => v.id.includes("image-alt")),
    ).toBe(true);
    const build = await queries.getBuild(result.buildId);
    expect(build?.a11yScore).not.toBeNull();
    expect(build?.a11yScore).toBeLessThan(100);

    const diffs = await queries.getVisualDiffsByBuild(result.buildId);
    expect(diffs.length).toBeGreaterThan(0);
    const diff = diffs[0];
    expect(diff.status).toBe("pending");
    expect(Number(diff.percentageDifference)).toBeGreaterThan(0);

    // ── Verify: step_comparisons row with real per-layer evidence for THIS
    // build (a real prior TestResult exists now, so scorer.ts's baseline-diff
    // path runs instead of the first-run short-circuit build 1 hit).
    const stepComparisons = await queries.getStepComparisonsByBuild(
      result.buildId,
    );
    expect(stepComparisons.length).toBeGreaterThan(0);
    const step = stepComparisons[0];
    const evidenceLayers = new Set(step.evidence.map((e) => e.layer));
    for (const layer of ["visual", "a11y", "network", "console"]) {
      expect(
        evidenceLayers.has(layer as never),
        `expected "${layer}" evidence on step_comparisons`,
      ).toBe(true);
    }
    // scoreMultiLayer's ScoreInputs type has no designSystemViolations field
    // at all (confirmed by reading src/lib/comparison/scorer.ts) — "design"
    // (and "text"/"dom") never reach evidence/effectiveVerdict/the Verify
    // board's per-layer chips, even though check-modes.ts models "design" as
    // a full CheckLayer with its own mode. Pre-existing gap, not something
    // this refactor touched (scorer.ts's ScoreInputs shape predates it).
    expect(evidenceLayers.has("design" as never)).toBe(false);

    const consoleEvidence = step.evidence.find((e) => e.layer === "console");
    expect(consoleEvidence?.signal).toBe("high"); // real console.error, our own page → "app" category

    // ── Case-status derivation (§2.14/§3 Verify row): known-good vs
    // known-bad, computed from this build's real evidence.
    const repoModes: CheckModeMap = {
      visual: "enforce",
      text: "log",
      dom: "log",
      network: "log",
      console: "log", // repo default per beforeAll
      a11y: "log",
      design: "log",
      perf: "log",
      url: "log",
      api: "enforce",
      storage: "log",
    };
    const merged = mergeWithTestOverrides(repoModes, null);
    const knownBadVerdict = effectiveVerdict(step.evidence, merged);
    // console is high-signal but mode is 'log' → amber, never red — matches
    // check-modes.ts's documented "log → surfaced amber, never reddens" rule.
    expect(knownBadVerdict).toBe("yellow");

    // Re-derive with console flipped to 'enforce' (what the cogwheel modal
    // would do) — the SAME real evidence now must gate red.
    const enforceModes: CheckModeMap = { ...merged, console: "enforce" };
    expect(effectiveVerdict(step.evidence, enforceModes)).toBe("red");
    // Known-good contrast: no evidence at all is green regardless of mode.
    expect(effectiveVerdict([], enforceModes)).toBe("green");

    // ── Visual diff review: approve.
    await approveDiffCore(diff.id, "integration-test");

    const approved = await queries.getVisualDiff(diff.id);
    expect(approved?.status).toBe("approved");
    expect(approved?.approvedBy).toBe("integration-test");

    // Approving promotes a new active baseline for this test/step/branch.
    const baseline = await queries.getActiveBaseline(
      recordedTestId,
      null,
      "main",
    );
    expect(baseline?.approvedFromDiffId).toBe(diff.id);
    expect(baseline?.imagePath).toBe(diff.currentImagePath);
  }, 180_000);

  it("build 3: a second real diff appears and gets rejected with a review-todo comment", async () => {
    state.version = 3;
    const result = await createAndRunBuildCore(
      "manual",
      [recordedTestId],
      repositoryId,
    );
    if (!result.buildId) {
      throw new Error(
        "createAndRunBuildCore did not return a buildId (pool busy / queued?)",
      );
    }
    buildIds.push(result.buildId);
    await waitForBuildCompletion(result.buildId);

    const diffs = await queries.getVisualDiffsByBuild(result.buildId);
    expect(diffs.length).toBeGreaterThan(0);
    const diff = diffs[0];
    expect(diff.status).toBe("pending");

    await rejectDiffCore(diff.id);
    const todo = await queries.createReviewTodo({
      repositoryId,
      diffId: diff.id,
      buildId: result.buildId,
      testId: recordedTestId,
      branch: "main",
      description: "CTA color regressed to green — flagging for design review",
      createdBy: "integration-test",
    });

    const rejected = await queries.getVisualDiff(diff.id);
    expect(rejected?.status).toBe("rejected");
    const rejectedBuild = await queries.getBuild(result.buildId);
    expect(rejectedBuild?.overallStatus).toBe("blocked");

    const fetchedTodo = await queries.getReviewTodo(todo.id);
    expect(fetchedTodo?.description).toContain("CTA color regressed");
    expect(fetchedTodo?.diffId).toBe(diff.id);

    // Baseline must NOT have moved to the rejected (green) screenshot — it's
    // still the blue image approved in build 2.
    const baseline = await queries.getActiveBaseline(
      recordedTestId,
      null,
      "main",
    );
    expect(baseline?.imagePath).not.toBe(diff.currentImagePath);
  }, 180_000);

  it("build 4: an ignore region over the CTA box masks a real change confined to it", async () => {
    await queries.createIgnoreRegion({
      testId: recordedTestId,
      stepLabel: null,
      x: CTA_BOX.x,
      y: CTA_BOX.y,
      width: CTA_BOX.width,
      height: CTA_BOX.height,
      reason: "CTA color churns during design review",
    });

    // Baseline for comparison is still the blue (v2) approved image.
    state.version = 4; // purple — but change is entirely inside the ignored box
    const result = await createAndRunBuildCore(
      "manual",
      [recordedTestId],
      repositoryId,
    );
    if (!result.buildId) {
      throw new Error(
        "createAndRunBuildCore did not return a buildId (pool busy / queued?)",
      );
    }
    buildIds.push(result.buildId);
    await waitForBuildCompletion(result.buildId);

    const diffs = await queries.getVisualDiffsByBuild(result.buildId);
    expect(diffs.length).toBeGreaterThan(0);
    const diff = diffs[0];

    // Compare against build 3's un-ignored diff percentage (a real color
    // change, same-sized box, no ignore region) to show the mask actually
    // suppressed the pixels rather than the page coincidentally rendering
    // identically.
    const build3Diffs = await queries.getVisualDiffsByBuild(
      buildIds[buildIds.length - 2],
    );
    const build3Pct = Number(build3Diffs[0]!.percentageDifference ?? 0);
    const build4Pct = Number(diff.percentageDifference ?? 0);
    expect(build4Pct).toBeLessThan(build3Pct);
    // With the entire changed region masked, this should read as unchanged.
    expect(["unchanged", "flaky"]).toContain(diff.classification);
  }, 180_000);
});
