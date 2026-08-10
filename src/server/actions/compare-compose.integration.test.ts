/**
 * Runtime verification for §3 "Compare / Compose" (core-plugin-refactor-
 * test-plan.md, P1 row — untouched by this refactor).
 *
 * `getLatestRunForBranch` (src/server/actions/compare.ts) carries no auth
 * guard of its own (auth lives at the /compare page level) — this exercises
 * it directly, exactly as the live Compare page's data loader does, against
 * two real branches of a real repo with a passing and a failing run. Compose
 * is exercised through the actual query-layer round trip
 * (`upsertComposeConfig`/`getComposeConfig`) that `saveComposeConfig`
 * (gated by `requireRepoAccess`) wraps.
 *
 * Run with `pnpm test:integration`.
 */
import { v4 as uuid } from "uuid";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import {
  builds,
  composeConfigs,
  repositories,
  teams,
  testResults,
  testRuns,
  tests,
} from "@/lib/db/schema";
import * as queries from "@/lib/db/queries";
import { getLatestRunForBranch } from "@/server/actions/compare";

let teamId: string;
let repositoryId: string;
let testPassId: string;
let testFailId: string;
let runMainId: string;
let runFeatureId: string;

beforeAll(async () => {
  teamId = uuid();
  await db.insert(teams).values({
    id: teamId,
    name: `compare-test-${teamId.slice(0, 8)}`,
    slug: `compare-test-${teamId.slice(0, 8)}`,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  repositoryId = uuid();
  await db.insert(repositories).values({
    id: repositoryId,
    teamId,
    provider: "local",
    owner: "compare-test",
    name: "repo",
    fullName: "compare-test/repo",
    createdAt: new Date(),
  });

  const testPass = await queries.createTest({
    repositoryId,
    name: "compare-test-pass",
    code: "export async function test(page) {}",
    targetUrl: "https://example.test/a",
  });
  testPassId = testPass.id;
  const testFail = await queries.createTest({
    repositoryId,
    name: "compare-test-fail",
    code: "export async function test(page) {}",
    targetUrl: "https://example.test/b",
  });
  testFailId = testFail.id;

  const now = new Date();

  // main: both tests pass
  const runMain = await queries.createTestRun({
    repositoryId,
    status: "completed",
    startedAt: now,
    completedAt: now,
    gitBranch: "main",
    gitCommit: "main0001",
  });
  runMainId = runMain.id;
  await queries.createTestResult({
    testRunId: runMainId,
    testId: testPassId,
    status: "passed",
  });
  await queries.createTestResult({
    testRunId: runMainId,
    testId: testFailId,
    status: "passed",
  });

  // feature branch: one regresses
  const runFeature = await queries.createTestRun({
    repositoryId,
    status: "completed",
    startedAt: now,
    completedAt: now,
    gitBranch: "feature-x",
    gitCommit: "feat0001",
  });
  runFeatureId = runFeature.id;
  await queries.createTestResult({
    testRunId: runFeatureId,
    testId: testPassId,
    status: "passed",
  });
  await queries.createTestResult({
    testRunId: runFeatureId,
    testId: testFailId,
    status: "failed",
    errorMessage: "expected foo, got bar",
  });
});

afterAll(async () => {
  await db
    .delete(composeConfigs)
    .where(eq(composeConfigs.repositoryId, repositoryId));
  await db.delete(testResults).where(eq(testResults.testRunId, runMainId));
  await db.delete(testResults).where(eq(testResults.testRunId, runFeatureId));
  await db.delete(builds).where(eq(builds.testRunId, runMainId));
  await db.delete(builds).where(eq(builds.testRunId, runFeatureId));
  await db.delete(testRuns).where(eq(testRuns.id, runMainId));
  await db.delete(testRuns).where(eq(testRuns.id, runFeatureId));
  await db.delete(tests).where(eq(tests.id, testPassId));
  await db.delete(tests).where(eq(tests.id, testFailId));
  await db.delete(repositories).where(eq(repositories.id, repositoryId));
  await db.delete(teams).where(eq(teams.id, teamId));
});

describe("Compare — getLatestRunForBranch (real query, no mocking)", () => {
  it("returns a sane result set for the main branch (all passing)", async () => {
    const info = await getLatestRunForBranch("main", repositoryId);
    expect(info.run?.id).toBe(runMainId);
    expect(info.results).toHaveLength(2);
    expect(info.results.every((r) => r.status === "passed")).toBe(true);
    expect(info.allTests).toHaveLength(2);
  });

  it("returns the regression on the feature branch, distinctly from main", async () => {
    const info = await getLatestRunForBranch("feature-x", repositoryId);
    expect(info.run?.id).toBe(runFeatureId);
    const failing = info.results.find((r) => r.testId === testFailId);
    expect(failing?.status).toBe("failed");
    const passing = info.results.find((r) => r.testId === testPassId);
    expect(passing?.status).toBe("passed");
  });

  it("returns an empty-run shape (not a throw) for a branch with no runs", async () => {
    const info = await getLatestRunForBranch("no-such-branch", repositoryId);
    expect(info.run).toBeNull();
    expect(info.results).toEqual([]);
    // allTests still populated so the compare UI can render "no run yet".
    expect(info.allTests.length).toBeGreaterThan(0);
  });
});

describe("Compose — upsertComposeConfig/getComposeConfig round trip", () => {
  it("persists a selection + version overrides and validates on read-back", async () => {
    const before = await queries.getComposeConfig(repositoryId, "main");
    expect(before).toBeNull();

    await queries.upsertComposeConfig(repositoryId, "main", {
      selectedTestIds: [testPassId],
      excludedTestIds: [testFailId],
      versionOverrides: { [testPassId]: "3" },
    });

    const after = await queries.getComposeConfig(repositoryId, "main");
    expect(after?.selectedTestIds).toEqual([testPassId]);
    expect(after?.excludedTestIds).toEqual([testFailId]);
    expect(after?.versionOverrides).toEqual({ [testPassId]: "3" });

    // Re-save (the "edit again" case) updates in place, one row per branch.
    await queries.upsertComposeConfig(repositoryId, "main", {
      selectedTestIds: [testPassId, testFailId],
      excludedTestIds: [],
      versionOverrides: {},
    });
    const rows = await db
      .select()
      .from(composeConfigs)
      .where(eq(composeConfigs.repositoryId, repositoryId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.selectedTestIds).toEqual([testPassId, testFailId]);
  });
});
