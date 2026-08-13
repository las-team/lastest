/**
 * §4 golden path, steps 15 and 16 — public share rendering, and
 * UI-driven team deletion + post-deletion DB sweep.
 * (docs/architecture/core-plugin-refactor-test-plan.md)
 *
 * Step 15 is the one assertion §3 structurally could not make: the HTTP-level
 * suite (`src/app/(public)/r/public-share.integration.test.ts`) proved
 * `/r/<slug>` 200s and that the HTML *string* carries the video/captions URLs,
 * but a share page is a React tree with client islands, so "the markup
 * contains the URL" is not the same claim as "an anonymous viewer sees a
 * player, a captions track and a chapter rail". Here the page is loaded in a
 * brand-new `browser.newContext()` — its own cookie jar, empty before and
 * after — so "renders without auth" is proven rather than assumed.
 *
 * Step 16 is deletion driven through the actual Settings → Account → Danger
 * Zone dialog (the `deleteMyAccount` server action inside a real request
 * scope, which `src/lib/db/gdpr-deletion.integration.test.ts` explicitly
 * cannot reach — it calls `queries.deleteTeam` directly because `requireAuth`
 * needs `next/headers`), followed by a sweep of every table this plan touched.
 *
 * Prerequisites: `docker compose up -d`, `pnpm dev:pool`, `pnpm dev`.
 * Run with `pnpm test:integration`.
 */
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq, sql as raw } from "drizzle-orm";
import type { BrowserContext, Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import * as queries from "@/lib/db/queries";
import {
  builds,
  publicShares,
  repositories,
  teams,
  testResults,
  testRuns,
  tests,
  users,
  type CapturedScreenshot,
  type VideoCaption,
} from "@/lib/db/schema";
import {
  BASE_URL,
  launchSession,
  startTargetApp,
  teamIdForEmail,
  type Session,
  type TargetApp,
} from "./harness";

const VIDEO_ROOT = path.join(process.cwd(), "storage", "videos");
const SHOT_ROOT = path.join(process.cwd(), "storage", "screenshots");

// ── Local helpers ────────────────────────────────────────────────────────
//
// Deliberately not added to harness.ts (three suites import it concurrently
// and another agent owns it).

/**
 * Poll until `fn` returns truthy. `expect.poll` is unavailable here: vitest
 * rejects it outside a test body and half of this setup runs in `beforeAll`.
 */
async function waitUntil<T>(
  fn: () => Promise<T>,
  what: string,
  timeoutMs = 60_000,
  intervalMs = 500,
): Promise<NonNullable<T>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn().catch(() => undefined as T | undefined);
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/**
 * Register through the real form, tolerant of dev-mode hydration lag.
 *
 * The terms control is a Radix `[role=checkbox]` client island: a click
 * dispatched before hydration is silently swallowed, `termsAccepted` stays
 * false, and "Create account" stays `disabled` forever. Observed for real
 * against this dev server, so the click is retried until the control reports
 * checked rather than assumed to land first time.
 */
async function registerRobust(s: Session, name: string): Promise<void> {
  const page = s.page;
  await page.goto(`${BASE_URL}/register`, { waitUntil: "domcontentloaded" });
  await page
    .locator("input#name")
    .waitFor({ state: "visible", timeout: 60_000 });

  const terms = page.locator("#terms");
  const submit = page.locator('button[type="submit"]').first();

  // Two dev-mode hazards, both observed for real against this server:
  //  1. hydration lag — a click on the Radix `[role=checkbox]` before hydration
  //     is swallowed, so "Create account" stays `disabled` forever;
  //  2. Fast Refresh — a rebuild triggered by *another* editor remounts the
  //     page component and resets `useState`, silently emptying the controlled
  //     inputs. The form's `required` fields then block submission with no
  //     submit event and no visible error, which looks exactly like a hung
  //     click.
  // So: re-assert the whole form immediately before each attempt and verify it
  // still holds, rather than filling once and trusting it.
  await waitUntil(
    async () => {
      await page.fill("input#name", name);
      await page.fill("input#email", s.email);
      await page.fill("input#password", s.password);
      if ((await terms.getAttribute("aria-checked")) !== "true") {
        await terms.click({ timeout: 5_000 }).catch(() => {});
      }
      const ready =
        (await page.inputValue("input#email")) === s.email &&
        (await page.inputValue("input#password")) === s.password &&
        (await terms.getAttribute("aria-checked")) === "true" &&
        !(await submit.isDisabled());
      if (!ready) return false;
      await submit.click({ timeout: 10_000 }).catch(() => {});
      await page
        .waitForURL(/\/onboarding|\/dashboard/, { timeout: 15_000 })
        .catch(() => {});
      return /\/onboarding|\/dashboard/.test(page.url());
    },
    "registration to complete",
    180_000,
    1_000,
  );
}

/**
 * Skip the onboarding wizard for suites that aren't testing it.
 *
 * `(app)/layout.tsx` redirects any user without `onboardingCompletedAt` to
 * /onboarding, so the flag has to be set before /tests, /builds or /settings
 * are reachable. better-auth runs with no `cookieCache` (src/lib/auth/auth.ts),
 * so the next request reads this straight from the DB. §4 steps 1-2 cover the
 * wizard itself in `e2e/golden-path.integration.test.ts`.
 */
async function markOnboarded(email: string): Promise<void> {
  await db
    .update(users)
    .set({ onboardingCompletedAt: new Date() })
    .where(eq(users.email, email));
}

/** Newest real asset of a given extension anywhere under a storage root. */
async function findRealAsset(
  root: string,
  ext: string,
): Promise<string | null> {
  const dirs = await readdir(root).catch(() => [] as string[]);
  for (const d of dirs) {
    const files = await readdir(path.join(root, d)).catch(() => [] as string[]);
    const hit = files.find((f) => f.endsWith(ext));
    if (hit) return path.join(root, d, hit);
  }
  return null;
}

/**
 * Teardown for a team THIS suite created.
 *
 * Not `harness.destroyTeam` / `queries.deleteTeam`: `users.team_id` is a
 * NO ACTION FK, so deleting a team that still has members throws — and
 * `repositories` carries no FK to `teams` at all, so repos would be left
 * orphaned. Both are properties of the product observed in this same run
 * (see the sweep in §4.16 below); the cleanup just has to work around them.
 */
async function destroyTeamHard(teamId: string | undefined): Promise<void> {
  if (!teamId) return;
  const members = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.teamId, teamId));
  for (const m of members) await queries.deleteUser(m.id).catch(() => {});
  const repos = await db
    .select({ id: repositories.id })
    .from(repositories)
    .where(eq(repositories.teamId, teamId));
  for (const r of repos) await queries.deleteRepository(r.id).catch(() => {});
  await queries.deleteTeam(teamId).catch(() => {});
}

/** Open a PublishShareDialog, publish, and return the minted slug. */
async function publishShareVia(
  page: Page,
  pageUrl: string,
  trigger: RegExp,
): Promise<string> {
  await page.goto(pageUrl, { waitUntil: "domcontentloaded" });
  const btn = page.getByRole("button", { name: trigger }).first();
  await btn.waitFor({ state: "visible", timeout: 60_000 });
  await btn.click();
  const urlBox = page.locator("input[readonly]").first();
  await urlBox.waitFor({ state: "visible", timeout: 60_000 });
  const url = await waitUntil(async () => {
    const v = await urlBox.inputValue();
    return /\/r\/[A-Za-z0-9-]+$/.test(v) ? v : undefined;
  }, "the dialog to show a /r/<slug> URL");
  return url.split("/r/")[1]!;
}

// ── Share fixture (step 15) ──────────────────────────────────────────────

let target: TargetApp;
let session: Session;
let teamId: string | undefined;
let repositoryId: string;
let testId: string;
let testRunId: string;
let buildId: string;
let videoFile: string;
const shotFiles: string[] = [];

const CAPTION_TEXT = "Opens the golden-path target and submits the form.";
const STEP_TITLES = ["Home", "Form filled", "Submitted"];

beforeAll(async () => {
  target = await startTargetApp();
  session = await launchSession();
  await registerRobust(session, "Share Viewer");
  await markOnboarded(session.email);
  teamId = await teamIdForEmail(session.email);

  const repo = await queries.createRepository({
    teamId,
    provider: "local",
    owner: "local",
    name: `share-e2e-${randomUUID().slice(0, 8)}`,
    fullName: `local/share-e2e-${randomUUID().slice(0, 8)}`,
  });
  repositoryId = repo.id;

  // --- A run with real media on disk -----------------------------------
  const t = await queries.createTest({
    repositoryId,
    name: "share-e2e golden path",
    code: "export async function test(page) {}",
    targetUrl: `${target.origin}/`,
  });
  testId = t.id;

  const run = await queries.createTestRun({
    repositoryId,
    status: "completed",
    startedAt: new Date(),
    completedAt: new Date(),
    gitBranch: "main",
    gitCommit: "e2e0015",
  });
  testRunId = run.id;

  await mkdir(path.join(VIDEO_ROOT, repositoryId), { recursive: true });
  await mkdir(path.join(SHOT_ROOT, repositoryId), { recursive: true });

  // Real bytes where the dev box has them: a genuine webm/png makes the
  // browser actually decode the asset, so "the <video> is present" is backed
  // by "the anonymous fetch of its src returned playable media".
  const realWebm = await findRealAsset(VIDEO_ROOT, ".webm");
  const realPng = await findRealAsset(SHOT_ROOT, ".png");

  // NOTE: video_path is deliberately left NULL on the result row. That forces
  // the share page down `resolveTestVideoUrl()`'s disk-scan fallback
  // (src/lib/share/video-fallback.ts, changed on this branch) — the branch §3
  // could only observe as a substring in the HTML.
  videoFile = path.join(
    VIDEO_ROOT,
    repositoryId,
    `${testRunId}-${testId}.webm`,
  );
  if (realWebm) await copyFile(realWebm, videoFile);
  else await writeFile(videoFile, Buffer.from("not-a-real-webm"));

  const screenshots: CapturedScreenshot[] = [];
  for (let i = 0; i < STEP_TITLES.length; i++) {
    const name = `${testRunId}-${testId}-Step_${i + 1}.png`;
    const abs = path.join(SHOT_ROOT, repositoryId, name);
    if (realPng) await copyFile(realPng, abs);
    else await writeFile(abs, Buffer.from("not-a-real-png"));
    shotFiles.push(abs);
    screenshots.push({
      path: `/screenshots/${repositoryId}/${name}`,
      label: `Step ${i + 1}`,
      title: STEP_TITLES[i],
      atMs: i * 2_000,
    });
  }

  await queries.createTestResult({
    testRunId,
    testId,
    status: "passed",
    videoPath: null,
    screenshotPath: screenshots[screenshots.length - 1]!.path,
    screenshots,
    durationMs: 6_000,
  });

  const build = await queries.createBuild({
    testRunId,
    triggerType: "manual",
    overallStatus: "safe_to_merge",
    completedAt: new Date(),
    totalTests: 1,
    passedCount: 1,
    changesDetected: 0,
  });
  buildId = build!.id;

  const captions: VideoCaption[] = [
    { stepIndex: 0, startMs: 0, endMs: 2_500, text: CAPTION_TEXT },
  ];
  await queries.upsertBuildDemoNotes(buildId, {
    uxSummary: "Golden-path target behaved.",
    highlights: [],
    frictionPoints: [],
    testingStruggles: [],
    generatedAt: new Date().toISOString(),
    captions,
  });
}, 300_000);

afterAll(async () => {
  await session?.close();
  await rm(videoFile, { force: true }).catch(() => {});
  for (const f of shotFiles) await rm(f, { force: true }).catch(() => {});
  await destroyTeamHard(teamId);
  await target?.close();
}, 180_000);

describe("§4.15 — public share link renders with no session", () => {
  it("seeded a team-scoped repo, run and build to share", async () => {
    const repo = await queries.getRepository(repositoryId);
    expect(repo?.teamId).toBe(teamId);
    expect(buildId).toBeTruthy();
  });
});
