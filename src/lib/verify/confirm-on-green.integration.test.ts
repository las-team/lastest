/**
 * Runtime verification for `closeIssuesOnGreen`'s auto-close scope guard
 * (`src/lib/verify/confirm-on-green.ts`) against real postgres.
 *
 * §2.14 of `docs/architecture/core-plugin-refactor-test-plan.md` confirmed
 * "the `'auto'`/`'open'` scope guard matches the actual query filter exactly"
 * by reading `getOpenIssueStepsForTests`'s `inArray(..., ["auto", "open"])`
 * filter — this file is the dedicated, committed, re-runnable test the plan
 * flagged as still missing (it was "confirmed by reading code, not a
 * dedicated test file").
 *
 * The GitHub HTTP calls (`fetch`) are stubbed — this is a boundary test of
 * the scope guard and the DB state machine, not a live-GitHub test (this
 * environment has no configured GitHub App/token to hit the real API
 * against).
 *
 * Run with `pnpm test:integration`. Requires ENCRYPTION_KEY (the same
 * requirement `settings-autosave.integration.test.ts` already has, since
 * github_accounts.access_token is an encrypted field).
 */
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as queries from "@/lib/db/queries";
import { db } from "@/lib/db";
import { stepComparisons } from "@/lib/db/schema";
import { closeIssuesOnGreen } from "./confirm-on-green";

let fetchMock: ReturnType<typeof vi.fn>;
let fetchCalls: string[] = [];

beforeEach(() => {
  fetchCalls = [];
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    fetchCalls.push(`${init?.method ?? "GET"} ${url}`);
    return new Response("{}", { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("closeIssuesOnGreen — auto-close scope guard", () => {
  it("closes a Lastest-filed ('auto') issue but never touches a ('linked') one, on the same green build", async () => {
    const team = await queries.createTeam({ name: "confirm-green-team" });
    const repo = await queries.createRepository({
      teamId: team.id,
      provider: "github",
      owner: "acme",
      name: "widgets",
      fullName: "acme/widgets",
      defaultBranch: "main",
      githubRepoId: 123456,
    });
    await queries.createGithubAccount({
      teamId: team.id,
      githubUserId: "1",
      githubUsername: "bot",
      accessToken: "fake-token-not-real",
    });

    const testAuto = await queries.createTest(
      {
        repositoryId: repo.id,
        name: "auto-issue-test",
        code: "export async function test(){}",
      },
      "main",
    );
    const testLinked = await queries.createTest(
      {
        repositoryId: repo.id,
        name: "linked-issue-test",
        code: "export async function test(){}",
      },
      "main",
    );

    const testRun = await queries.createTestRun({
      repositoryId: repo.id,
      gitBranch: "main",
      gitCommit: "abc1234",
      startedAt: new Date(),
      status: "passed",
    });

    // Build A: the ORIGINAL (failing) build the issues were filed against.
    // `getOpenIssueStepsForTests` explicitly excludes rows from the build
    // being finalized (`s.buildId !== buildId` in confirm-on-green.ts) — the
    // issue-bearing step and the now-green step must be different builds,
    // exactly like a real file→fix→rerun cycle.
    const buildOld = await queries.createBuild({
      testRunId: testRun.id,
      triggerType: "manual",
      overallStatus: "review_required",
      totalTests: 2,
      changesDetected: 2,
      flakyCount: 0,
      failedCount: 2,
      passedCount: 0,
    });
    const autoStep = await queries.createStepComparison({
      buildId: buildOld.id,
      testId: testAuto.id,
      stepLabel: "Step 1",
      verdict: "red",
      evidence: [],
      layers: {},
      githubIssueNumber: 101,
      githubIssueState: "auto",
      githubIssueKind: "bugfix",
    });
    const linkedStep = await queries.createStepComparison({
      buildId: buildOld.id,
      testId: testLinked.id,
      stepLabel: "Step 1",
      verdict: "red",
      evidence: [],
      layers: {},
      githubIssueNumber: 202,
      githubIssueState: "linked",
      githubIssueKind: "bugfix",
    });

    // Build B: the rerun that came back green — this is what's passed to
    // closeIssuesOnGreen. Every step of both tests is green here.
    const buildNew = await queries.createBuild({
      testRunId: testRun.id,
      triggerType: "manual",
      overallStatus: "safe_to_merge",
      totalTests: 2,
      changesDetected: 0,
      flakyCount: 0,
      failedCount: 0,
      passedCount: 2,
    });
    await queries.createStepComparison({
      buildId: buildNew.id,
      testId: testAuto.id,
      stepLabel: "Step 1",
      verdict: "green",
      evidence: [],
      layers: {},
    });
    await queries.createStepComparison({
      buildId: buildNew.id,
      testId: testLinked.id,
      stepLabel: "Step 1",
      verdict: "green",
      evidence: [],
      layers: {},
    });

    try {
      const result = await closeIssuesOnGreen(buildNew.id);
      expect(result.closed).toBe(1);

      // The scope guard: 'auto' got closed...
      const [autoAfter] = await db
        .select()
        .from(stepComparisons)
        .where(eq(stepComparisons.id, autoStep.id));
      expect(autoAfter.githubIssueState).toBe("closed");

      // ...'linked' was never a candidate and must be untouched.
      const [linkedAfter] = await db
        .select()
        .from(stepComparisons)
        .where(eq(stepComparisons.id, linkedStep.id));
      expect(linkedAfter.githubIssueState).toBe("linked");

      // The GitHub calls made were only for issue #101 (the 'auto' one) —
      // #202 ('linked') must never appear in the outbound call log.
      expect(fetchCalls.some((c) => c.includes("/issues/101"))).toBe(true);
      expect(fetchCalls.some((c) => c.includes("/issues/202"))).toBe(false);
      expect(
        fetchCalls.some(
          (c) => c.startsWith("PATCH") && c.includes("/issues/101"),
        ),
      ).toBe(true);
      expect(
        fetchCalls.some(
          (c) => c.startsWith("POST") && c.includes("/issues/101/comments"),
        ),
      ).toBe(true);
    } finally {
      await db
        .delete(stepComparisons)
        .where(and(eq(stepComparisons.testId, testAuto.id)));
      await db
        .delete(stepComparisons)
        .where(eq(stepComparisons.testId, testLinked.id));
      await queries.deleteRepository(repo.id);
      await queries.deleteTeam(team.id);
    }
  });

  it("is a no-op (0 closed, no fetch calls) when no step in the build carries an open Lastest-filed issue", async () => {
    const team = await queries.createTeam({ name: "confirm-green-noop-team" });
    const repo = await queries.createRepository({
      teamId: team.id,
      provider: "github",
      owner: "acme",
      name: "gadgets",
      fullName: "acme/gadgets",
      defaultBranch: "main",
      githubRepoId: 654321,
    });
    await queries.createGithubAccount({
      teamId: team.id,
      githubUserId: "2",
      githubUsername: "bot2",
      accessToken: "fake-token-not-real",
    });
    const test = await queries.createTest(
      {
        repositoryId: repo.id,
        name: "no-issue-test",
        code: "export async function test(){}",
      },
      "main",
    );
    const testRun = await queries.createTestRun({
      repositoryId: repo.id,
      gitBranch: "main",
      gitCommit: "def5678",
      startedAt: new Date(),
      status: "passed",
    });
    const build = await queries.createBuild({
      testRunId: testRun.id,
      triggerType: "manual",
      overallStatus: "safe_to_merge",
      totalTests: 1,
      changesDetected: 0,
      flakyCount: 0,
      failedCount: 0,
      passedCount: 1,
    });
    await queries.createStepComparison({
      buildId: build.id,
      testId: test.id,
      stepLabel: "Step 1",
      verdict: "green",
      evidence: [],
      layers: {},
      // No githubIssueNumber/State at all — never filed.
    });

    try {
      const result = await closeIssuesOnGreen(build.id);
      expect(result.closed).toBe(0);
      expect(fetchCalls.length).toBe(0);
    } finally {
      await db
        .delete(stepComparisons)
        .where(eq(stepComparisons.buildId, build.id));
      await queries.deleteRepository(repo.id);
      await queries.deleteTeam(team.id);
    }
  });

  it("is a no-op when the build is not safe_to_merge, even with an 'auto' issue present", async () => {
    const team = await queries.createTeam({
      name: "confirm-green-notgreen-team",
    });
    const repo = await queries.createRepository({
      teamId: team.id,
      provider: "github",
      owner: "acme",
      name: "sprockets",
      fullName: "acme/sprockets",
      defaultBranch: "main",
      githubRepoId: 999888,
    });
    const test = await queries.createTest(
      {
        repositoryId: repo.id,
        name: "review-required-test",
        code: "export async function test(){}",
      },
      "main",
    );
    const testRun = await queries.createTestRun({
      repositoryId: repo.id,
      gitBranch: "main",
      gitCommit: "aaa1111",
      startedAt: new Date(),
      status: "passed",
    });
    const build = await queries.createBuild({
      testRunId: testRun.id,
      triggerType: "manual",
      overallStatus: "review_required",
      totalTests: 1,
      changesDetected: 1,
      flakyCount: 0,
      failedCount: 0,
      passedCount: 0,
    });
    await queries.createStepComparison({
      buildId: build.id,
      testId: test.id,
      stepLabel: "Step 1",
      verdict: "green",
      evidence: [],
      layers: {},
      githubIssueNumber: 303,
      githubIssueState: "auto",
      githubIssueKind: "bugfix",
    });

    try {
      const result = await closeIssuesOnGreen(build.id);
      expect(result.closed).toBe(0);
      expect(fetchCalls.length).toBe(0);
    } finally {
      await db
        .delete(stepComparisons)
        .where(eq(stepComparisons.buildId, build.id));
      await queries.deleteRepository(repo.id);
      await queries.deleteTeam(team.id);
    }
  });
});
