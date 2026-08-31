/**
 * §4 step 15 — the Triage agent surface, in a real browser.
 *
 * `feat(triage): Triage agent as the single classifier, with the Run Results
 * screen` (a2597eca) added two whole routes — `/triage-agent` and
 * `/triage-agent/[buildId]` — plus a verdict model that deliberately lives
 * outside the case rows it decides. None of it had browser coverage, and two
 * of its central claims can only be proved by a rendered page plus the
 * database underneath it:
 *
 *  - the Run Results screen derives entirely from `deriveTriageScreen`, so a
 *    build with no triage run, a build with clusters, and an all-passing build
 *    must each render a *different* and correct screen;
 *  - a reviewer's verdict is keyed on `(buildId, testId, stepLabel)` in
 *    `triage_case_verdicts` precisely so that re-running triage — which
 *    replaces every `triage_cases` row — cannot lose it. That is a claim about
 *    two writes separated by a full re-clustering pass, which no unit test
 *    over `libs/triage-model` can make.
 *
 * Provider-agnostic by construction. `runTriageAnalysis` never throws: with a
 * provider configured the AI writes the run narrative and the group headlines;
 * without one it returns `{status:"skipped"}` and `runTriage` falls back to
 * `clusterDeterministically` (`src/lib/triage/run.ts`). Both paths owe the
 * same structural result, so every assertion here is on rows, ids and counts
 * — never on generated prose, which would make the suite pass or fail on a
 * model's mood. The gate is real rather than bypassed: `canRunTriage` wants
 * `ai_settings.triage_agent_enabled` plus the team's `builtInAiEnabled`, the
 * fixture turns both on, and the UI's own "Triage this run" button starts it.
 *
 * No EB and no build execution: the build under test is seeded straight into
 * the database. This suite is about classification and review, not about
 * running tests — `golden-path.integration.test.ts` owns that — and seeding
 * keeps it deterministic and quick enough to sit in front of a UI assertion.
 *
 * Prerequisites: `pnpm dev` (app on :3000), host postgres. No pool service
 * needed. Run with `pnpm test:integration`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Page } from "playwright";

import { db } from "@/lib/db";
import {
  repositories,
  teams,
  triageCaseVerdicts,
  triageCases,
  users,
} from "@/lib/db/schema";
import * as queries from "@/lib/db/queries";

import {
  destroyTeam,
  gotoSettled,
  launchSession,
  registerViaUi,
  teamIdForEmail,
  type Session,
} from "./harness";

let s: Session;
let teamId: string | undefined;
let userId: string;
let repoId: string;

/** The build the whole suite reviews: three failures + one pass. */
let failBuildId: string;
/** A second build in which everything passed — the "nothing to review" screen. */
let greenBuildId: string;
/** testId of the case the verdict is recorded against. */
let decidedTestId: string;

const TEST_NAMES = ["checkout smoke", "checkout tax", "profile avatar"];

/**
 * Two of the three failures share an error signature verbatim — the first
 * pass of `clusterDeterministically` ("Grouped by an identical error
 * signature") and the most obvious thing for an AI clusterer to group too, so
 * at least one real cluster is owed on either path.
 */
const SHARED_ERROR =
  "TimeoutError: locator.click: Timeout 30000ms exceeded waiting for getByRole('button', { name: 'Pay' })";
const LONE_ERROR = "Error: expect(received).toBe(expected) — avatar src null";

// ── helpers ──────────────────────────────────────────────────────────────

async function bodyText(page: Page): Promise<string> {
  return page.evaluate(() => document.body.innerText);
}

/**
 * Poll a predicate to a value. Local rather than in `harness.ts` on purpose:
 * three other suites share that file and none of them need this shape.
 */
async function until<T>(
  what: string,
  probe: () => Promise<T | null>,
  timeoutMs = 60_000,
  everyMs = 500,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== null && value !== false) return value as T;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

/** Seed one completed build. Returns its id. */
async function seedBuild(opts: {
  branch: string;
  commit: string;
  failures: Array<{ testId: string; error: string }>;
  passes: string[];
}): Promise<string> {
  const now = new Date();
  const run = await queries.createTestRun({
    repositoryId: repoId,
    status: "completed",
    startedAt: now,
    completedAt: now,
    gitBranch: opts.branch,
    gitCommit: opts.commit,
  });
  for (const f of opts.failures) {
    await queries.createTestResult({
      testRunId: run.id,
      testId: f.testId,
      status: "failed",
      errorMessage: f.error,
      browser: "chromium",
      durationMs: 30_120,
    });
  }
  for (const testId of opts.passes) {
    await queries.createTestResult({
      testRunId: run.id,
      testId,
      status: "passed",
      browser: "chromium",
      durationMs: 1_800,
    });
  }
  const build = await queries.createBuild({
    testRunId: run.id,
    triggerType: "manual",
    overallStatus: opts.failures.length ? "blocked" : "safe_to_merge",
    completedAt: now,
    totalTests: opts.failures.length + opts.passes.length,
    failedCount: opts.failures.length,
    passedCount: opts.passes.length,
    changesDetected: 0,
  });
  return build.id;
}

/**
 * Same deep teardown as `settings-ui.integration.test.ts`: `deleteTeam` is a
 * bare `delete from teams` and `users.team_id` is NO ACTION, and repositories
 * carry no FK to teams at all.
 */
async function destroyTeamDeep(id: string | undefined): Promise<void> {
  if (!id) return;
  for (const repo of await db
    .select({ id: repositories.id })
    .from(repositories)
    .where(eq(repositories.teamId, id))) {
    await queries.deleteRepository(repo.id).catch(() => {});
  }
  for (const member of await queries.getTeamMembers(id)) {
    await queries.deleteUser(member.id).catch(async () => {
      await db
        .update(users)
        .set({ teamId: null })
        .where(eq(users.id, member.id));
    });
  }
  await destroyTeam(id);
}

beforeAll(async () => {
  s = await launchSession();
  await registerViaUi(s, "Triage UI");
  teamId = await teamIdForEmail(s.email);

  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, s.email));
  userId = user.id;

  // The onboarding wizard is `golden-path`'s subject, not this suite's, and
  // its sandbox branch wants a live target app. Mark it done and hand the user
  // a repository directly — `(app)/layout.tsx` redirects to /onboarding until
  // `onboardingCompletedAt` is set.
  const repo = await queries.createRepository({
    teamId: teamId!,
    provider: "local",
    owner: "triage-e2e",
    name: `repo-${Date.now().toString(36)}`,
    fullName: `triage-e2e/repo-${Date.now().toString(36)}`,
  });
  repoId = repo.id;
  await db
    .update(users)
    .set({ onboardingCompletedAt: new Date(), selectedRepositoryId: repoId })
    .where(eq(users.id, userId));

  // Two independent gates, both switched on the way a team would switch them
  // on rather than bypassed:
  //
  //  - the plan. Triage is Pro-gated exactly like /agents and /qa-agent, and
  //    `hasQaAgentAccess` only waves a team through when billing is *disabled*.
  //    With `STRIPE_SECRET_KEY` in `.env.local` (as on this machine) a freshly
  //    registered team is on `free`, so every surface here renders the upgrade
  //    screen instead — which is the product working, not a bug to route
  //    around. `settings-ui` flips the same column for the same reason.
  //  - in-product AI, which `canRunTriage` requires. No provider key is set,
  //    so the run still lands on the deterministic clusterer.
  await db
    .update(teams)
    .set({ plan: "pro", builtInAiEnabled: true, banAiMode: false })
    .where(eq(teams.id, teamId!));
  await queries.upsertAISettings(repoId, { triageAgentEnabled: true });

  const testIds: string[] = [];
  for (const name of TEST_NAMES) {
    const t = await queries.createTest({
      repositoryId: repoId,
      name,
      code: "export async function test(page) {}",
      targetUrl: "https://example.test/",
    });
    testIds.push(t.id);
  }
  const passingTest = await queries.createTest({
    repositoryId: repoId,
    name: "settings page loads",
    code: "export async function test(page) {}",
    targetUrl: "https://example.test/settings",
  });
  decidedTestId = testIds[0];

  // Order matters: the green build is seeded FIRST so the build with failures
  // is the repo's newest. `/triage-agent`'s "Triage latest build" reads
  // `getBuildsByRepo(repoId, 50)[0]`, and with these the other way round that
  // button re-triages the all-passing build — which completes as "skipped",
  // touches none of the cases under review, and makes the re-triage assertion
  // below wait out its whole budget for a change that was never going to come.
  greenBuildId = await seedBuild({
    branch: "main",
    commit: "def5678",
    failures: [],
    passes: [passingTest.id, ...testIds],
  });

  failBuildId = await seedBuild({
    branch: "main",
    commit: "abc1234",
    failures: [
      { testId: testIds[0], error: SHARED_ERROR },
      { testId: testIds[1], error: SHARED_ERROR },
      { testId: testIds[2], error: LONE_ERROR },
    ],
    passes: [passingTest.id],
  });
}, 300_000);

afterAll(async () => {
  await s?.close();
  await destroyTeamDeep(teamId);
});

describe("§4 step 15 — Triage agent: console → run results → verdicts", () => {
  it("the Agents roster carries a Triage row that drills into /triage-agent", async () => {
    const { page } = s;
    await gotoSettled(page, "/agents");

    // `FLEET_AGENT_KINDS` includes "triage", and `/agents/page.tsx` synthesises
    // an idle row for every kind with no live session — so the row must be
    // there on a repo that has never triaged anything.
    // A team that failed the plan gate gets the upgrade screen and no roster
    // at all — assert that first, so a gate regression reads as "gated"
    // rather than as "the Triage row is missing".
    expect(
      await page
        .getByRole("heading", { name: /Unlock the QA Agent with/i })
        .count(),
    ).toBe(0);

    const row = page.locator('a[href="/triage-agent"]').first();
    await row.waitFor({ state: "visible", timeout: 60_000 });
    expect(await row.innerText()).toMatch(/Triage agent/);

    await row.click();
    await page.waitForURL(/\/triage-agent$/, { timeout: 60_000 });
  });

  it("the agent home offers automatic triage and reports nothing triaged yet", async () => {
    const { page } = s;
    await gotoSettled(page, "/triage-agent");

    await page
      .getByRole("heading", { name: "Triage agent", level: 1 })
      .waitFor({ state: "visible", timeout: 60_000 });

    // The one switch on the page, and the only element with this label.
    const auto = page.locator(
      '[role="switch"][aria-label="Run triage automatically"]',
    );
    await auto.waitFor({ state: "visible", timeout: 30_000 });
    // Both halves of the gate are on, so the switch must be settable rather
    // than locked — this is the UI half of `canRunTriage` agreeing with the
    // server half the fixture configured.
    expect(await auto.isDisabled()).toBe(false);

    const text = await bodyText(page);
    expect(text).toContain("Automatic triage");
    expect(text).toContain("Recent triage runs");
    expect(text).toMatch(/Nothing triaged yet/);
    // The seeded build is this repo's latest, so the manual escape hatch is
    // live rather than showing "No build to triage yet."
    expect(text).not.toMatch(/No build to triage yet/);
    await page
      .getByRole("button", { name: /^Triage latest build$/ })
      .waitFor({ state: "visible", timeout: 30_000 });
  });

  it("an untriaged build renders the Run Results screen with its health strip", async () => {
    const { page } = s;
    await gotoSettled(page, `/triage-agent/${failBuildId}`);

    // `deriveTriageScreen` builds cases only from a triage run, so with none
    // the hero states exactly that — while the header, health strip and
    // passing section still populate from the build itself.
    await page
      .getByText("This build has not been triaged.")
      .first()
      .waitFor({ state: "visible", timeout: 60_000 });

    // The ratio bar's accessible name is the health strip's own arithmetic:
    // 1 passed, 3 failed, 0 needing review.
    const ratio = page.locator('[role="img"][aria-label*="passed"]').first();
    await ratio.waitFor({ state: "visible", timeout: 30_000 });
    expect(await ratio.getAttribute("aria-label")).toBe(
      "1 passed, 3 failed, 0 needing review",
    );

    const text = await bodyText(page);
    expect(text).toMatch(/Passing tests/);
    // Breadcrumb back to the console.
    expect(
      await page
        .locator('nav[aria-label="Breadcrumb"] a[href="/agents"]')
        .count(),
    ).toBeGreaterThan(0);
  });

  it("'Triage this run' clusters the build with no AI provider configured", async () => {
    const { page } = s;
    const start = page.getByRole("button", { name: /^Triage this run$/ });
    await start.waitFor({ state: "visible", timeout: 30_000 });
    await start.click();

    // The action is awaited then `router.refresh()`ed; poll the database
    // rather than the optimistic UI.
    const run = await until(
      "the triage run to be written",
      async () => {
        const row = await queries.getTriageRunByBuild(failBuildId);
        return row && row.status !== "pending" && row.status !== "running"
          ? row
          : null;
      },
      180_000,
      1_000,
    );
    expect(run.status).toBe("completed");
    expect(run.caseCount).toBe(3);

    // Every case is clustered — the two identical error signatures at minimum.
    // Asserted on the rows rather than on the headline text: with a provider
    // configured the AI writes the group headlines, without one the
    // deterministic pre-pass writes generic ones ("N cases failing with the
    // same error"), and this suite must pass either way. What both paths owe
    // is the same: three cases, and at least two of them sharing a group.
    const cases = await db
      .select()
      .from(triageCases)
      .where(eq(triageCases.triageRunId, run.id));
    expect(cases).toHaveLength(3);
    const grouped = cases.filter((c) => c.triageGroupId !== null);
    expect(grouped.length).toBeGreaterThanOrEqual(2);

    // And the screen must show it: a cluster section, and never the
    // "nothing to review" empty state.
    await until(
      "the clustered Run Results screen",
      async () => {
        if (/Nothing in this run needs review\./.test(await bodyText(page))) {
          return null;
        }
        return (await page.locator('section[id^="group-"]').count()) > 0
          ? true
          : null;
      },
      120_000,
      1_000,
    );
    expect(
      await page.locator('section[id^="group-"], section#grp-passing').count(),
    ).toBeGreaterThan(0);
    // A clustering pass with a provider configured is an AI round trip; the
    // file-wide 120s default is a fixture budget, not a run budget.
  }, 300_000);

  it("recording a verdict on a case persists it to triage_case_verdicts", async () => {
    const { page } = s;

    const [target] = await db
      .select()
      .from(triageCases)
      .where(
        and(
          eq(triageCases.buildId, failBuildId),
          eq(triageCases.testId, decidedTestId),
        ),
      );
    expect(target).toBeTruthy();

    // Case rows live *inside* their cluster's card, which renders collapsed —
    // so `#case-<id>` is not in the DOM until the group owning it is opened.
    // Expand collapsed groups one at a time until this case appears rather
    // than assuming an order the clusterer is free to change.
    const caseRow = page.locator(`#case-${target.id}`);
    for (let i = 0; i < 6 && (await caseRow.count()) === 0; i++) {
      const collapsed = page
        .locator('section[id^="group-"] button[aria-expanded="false"]')
        .first();
      if (!(await collapsed.count())) break;
      await collapsed.click();
      await page.waitForTimeout(500);
    }
    await caseRow.waitFor({ state: "attached", timeout: 30_000 });

    // Open the case, then press its own "Confirm bug". The id prefix is what
    // separates a case verdict from a group's bulk verdict (`verdicts.ts`).
    await caseRow.scrollIntoViewIfNeeded();
    const toggle = caseRow.locator("button[aria-expanded]").first();
    if ((await toggle.getAttribute("aria-expanded")) !== "true") {
      await toggle.click();
    }
    const bug = page.locator(`#case-${target.id}-bug`);
    await bug.waitFor({ state: "visible", timeout: 30_000 });
    await bug.click();

    // The UI updates optimistically and immediately advances to the next
    // undecided case, so the badge proves nothing — the row does.
    const [verdict] = await until(
      "the verdict row to persist",
      async () => {
        const rows = await db
          .select()
          .from(triageCaseVerdicts)
          .where(
            and(
              eq(triageCaseVerdicts.buildId, failBuildId),
              eq(triageCaseVerdicts.testId, decidedTestId),
            ),
          );
        return rows.length ? rows : null;
      },
      60_000,
      500,
    );
    expect(verdict.verdict).toBe("bug");
    // Never NULL — the unique index that makes the upsert work depends on it.
    expect(verdict.stepLabel).toBe("");
    expect(verdict.decidedBy).toBe(userId);
  });

  it("re-triaging replaces the cases but the verdict survives", async () => {
    const { page } = s;
    const before = await db
      .select({ id: triageCases.id })
      .from(triageCases)
      .where(eq(triageCases.buildId, failBuildId));

    // Force a fresh run through the product's own path.
    await gotoSettled(page, "/triage-agent");
    const again = page.getByRole("button", { name: /^Triage latest build$/ });
    await again.waitFor({ state: "visible", timeout: 30_000 });
    await again.click();

    const rerun = await until(
      "the cases to be replaced",
      async () => {
        const rows = await db
          .select({ id: triageCases.id })
          .from(triageCases)
          .where(eq(triageCases.buildId, failBuildId));
        const ids = new Set(rows.map((r) => r.id));
        const replaced = before.every((b) => !ids.has(b.id));
        return rows.length === 3 && replaced ? rows : null;
      },
      180_000,
      1_000,
    );
    expect(rerun).toHaveLength(3);

    // The whole reason verdicts are keyed on (build, test, step) rather than
    // stored on the case row.
    const kept = await db
      .select()
      .from(triageCaseVerdicts)
      .where(
        and(
          eq(triageCaseVerdicts.buildId, failBuildId),
          eq(triageCaseVerdicts.testId, decidedTestId),
        ),
      );
    expect(kept).toHaveLength(1);
    expect(kept[0].verdict).toBe("bug");

    // And the reviewer's progress is reflected back on the run screen.
    await gotoSettled(page, `/triage-agent/${failBuildId}`);
    await until(
      "the resolved counter to include the surviving verdict",
      async () => /\b1 of 3 resolved\b/.test(await bodyText(page)) || null,
      60_000,
      1_000,
    );
    // Two full triage passes plus two navigations.
  }, 420_000);

  it("the agent home lists the run, and it links back to the build", async () => {
    const { page } = s;
    await gotoSettled(page, "/triage-agent");

    const link = page.locator(`a[href="/triage-agent/${failBuildId}"]`).first();
    await link.waitFor({ state: "visible", timeout: 60_000 });
    // `RunRow`'s meta line — groups, cases, and the reviewer's progress.
    expect(await link.innerText()).toMatch(
      /\d+ groups? · 3 cases · 1\/3 resolved/,
    );
    expect(await bodyText(page)).not.toMatch(/Nothing triaged yet/);
  });

  it("an all-passing build is triaged as nothing to review", async () => {
    const { page } = s;
    await gotoSettled(page, `/triage-agent/${greenBuildId}`);

    const start = page.getByRole("button", { name: /^Triage this run$/ });
    await start.waitFor({ state: "visible", timeout: 30_000 });
    await start.click();

    // `runTriage` short-circuits a build with no failed or review-required
    // case, and says so in `skippedReason` rather than writing empty clusters.
    const run = await until(
      "the green build's triage run",
      async () => {
        const row = await queries.getTriageRunByBuild(greenBuildId);
        return row && row.status !== "pending" && row.status !== "running"
          ? row
          : null;
      },
      120_000,
      1_000,
    );
    expect(run.caseCount).toBe(0);

    await until(
      "the empty-review screen",
      async () => {
        const text = await bodyText(page);
        return /Nothing in this run needs review\.|No failed or review-required cases in this build\./.test(
          text,
        )
          ? true
          : null;
      },
      60_000,
      1_000,
    );

    // Its four passing tests still render, and the ratio bar agrees.
    const ratio = page.locator('[role="img"][aria-label*="passed"]').first();
    expect(await ratio.getAttribute("aria-label")).toBe(
      "4 passed, 0 failed, 0 needing review",
    );
  });

  it("leaves no unexplained client-side errors across the triage surfaces", async () => {
    expect(s.consoleErrors).toEqual([]);
  });
});
