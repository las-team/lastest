/**
 * §3 P2 spot-checks (core-plugin-refactor-test-plan.md) — "call the
 * underlying query/action function directly and confirm it doesn't error and
 * returns sane data," per the task's P2 depth bar. Not full feature coverage;
 * one shared fixture, several unrelated rows exercised against it:
 *   - RCA: `classifyBuildDiffs` (src/lib/rca/run.ts)
 *   - CSV data sources: create/get/delete round trip
 *   - API test: `parseAssertions` (assertion evaluation, on real syntax)
 *   - Analytics/Impact: `getIssueTimeline`/`getMergedPRs`/`getImpactSummary`
 *   - Gamification/Leaderboard/Awards: `getActiveSeason`, `listSeasons`,
 *     `getSeasonLeaderboard`, `getRepoAward`
 *
 * Run with `pnpm test:integration`.
 */
import { v4 as uuid } from "uuid";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import {
  builds,
  repositories,
  teams,
  testResults,
  testRuns,
  tests,
} from "@/lib/db/schema";
import * as queries from "@/lib/db/queries";
import { classifyBuildDiffs } from "@/lib/rca/run";
import { parseAssertions } from "@/lib/playwright/assertion-parser";

let teamId: string;
let repositoryId: string;
let testId: string;
let runId: string;
let buildId: string;
let csvSourceId: string | null = null;

beforeAll(async () => {
  teamId = uuid();
  await db.insert(teams).values({
    id: teamId,
    name: `p2-test-${teamId.slice(0, 8)}`,
    slug: `p2-test-${teamId.slice(0, 8)}`,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  repositoryId = uuid();
  await db.insert(repositories).values({
    id: repositoryId,
    teamId,
    provider: "local",
    owner: "p2-test",
    name: "repo",
    fullName: "p2-test/repo",
    createdAt: new Date(),
  });

  const test = await queries.createTest({
    repositoryId,
    name: "p2-test",
    code: "export async function test(page) {}",
    targetUrl: "https://example.test/",
  });
  testId = test.id;

  const now = new Date();
  const run = await queries.createTestRun({
    repositoryId,
    status: "completed",
    startedAt: now,
    completedAt: now,
    gitBranch: "main",
    gitCommit: "abc1234",
  });
  runId = run.id;
  await queries.createTestResult({
    testRunId: runId,
    testId,
    status: "passed",
  });

  const build = await queries.createBuild({
    testRunId: runId,
    triggerType: "manual",
    overallStatus: "safe_to_merge",
    completedAt: now,
    totalTests: 1,
    changesDetected: 0,
  });
  buildId = build.id;
});

afterAll(async () => {
  if (csvSourceId) await queries.deleteCsvDataSource(csvSourceId);
  await db.delete(testResults).where(eq(testResults.testRunId, runId));
  await db.delete(builds).where(eq(builds.id, buildId));
  await db.delete(testRuns).where(eq(testRuns.id, runId));
  await db.delete(tests).where(eq(tests.id, testId));
  await db.delete(repositories).where(eq(repositories.id, repositoryId));
  await db.delete(teams).where(eq(teams.id, teamId));
});

describe("P2 spot-check — RCA", () => {
  it("classifyBuildDiffs runs against a real (diff-free) build without erroring", async () => {
    const count = await classifyBuildDiffs(buildId);
    expect(typeof count).toBe("number");
    expect(count).toBe(0); // no visual diffs on this fixture — sane, not a crash
  });
});

describe("P2 spot-check — CSV data sources", () => {
  it("creates, reads, and deletes a CSV data source", async () => {
    const created = await queries.createCsvDataSource({
      repositoryId,
      teamId,
      alias: `p2csv${uuid().slice(0, 6)}`,
      filename: "p2-csv-source.csv",
      cachedHeaders: ["name", "email"],
      cachedData: [
        ["Ada", "ada@example.test"],
        ["Grace", "grace@example.test"],
      ],
      rowCount: 2,
    });
    csvSourceId = created.id;

    const fetched = await queries.getCsvDataSource(created.id);
    expect(fetched?.cachedData).toHaveLength(2);
    expect(fetched?.cachedHeaders).toEqual(["name", "email"]);

    const list = await queries.getCsvDataSources(repositoryId);
    expect(list.some((s) => s.id === created.id)).toBe(true);
  });
});

describe("P2 spot-check — API test assertion parsing", () => {
  it("parses real Playwright assertion calls out of test code", () => {
    const code = `
      export async function test(page) {
        await expect(page.locator('h1')).toBeVisible();
        await expect(page).toHaveTitle('Home');
      }
    `;
    const assertions = parseAssertions(code);
    expect(Array.isArray(assertions)).toBe(true);
    expect(assertions.length).toBeGreaterThan(0);
  });
});

describe("P2 spot-check — Analytics/Impact", () => {
  it("timeline/merged-PR/impact-summary queries return plausible (empty-but-typed) data for a fresh repo", async () => {
    const [timeline, mergedPRs, authors, summary] = await Promise.all([
      queries.getIssueTimeline(repositoryId),
      queries.getMergedPRs(repositoryId),
      queries.getPRAuthors(repositoryId),
      queries.getImpactSummary(repositoryId),
    ]);
    expect(Array.isArray(timeline)).toBe(true);
    expect(Array.isArray(mergedPRs)).toBe(true);
    expect(Array.isArray(authors)).toBe(true);
    expect(summary).toBeTruthy();
  });
});

describe("P2 spot-check — Gamification / Leaderboard / Awards", () => {
  it("season + leaderboard + award queries return sane shapes with no data", async () => {
    const active = await queries.getActiveSeason(teamId);
    expect(active).toBeNull(); // no season created for this fresh team

    const seasons = await queries.listSeasons(teamId);
    expect(Array.isArray(seasons)).toBe(true);

    // Real season, so getSeasonLeaderboard has something to compute over.
    const season = await queries.createSeason({
      teamId,
      name: "P2 spot-check season",
      status: "active",
      startsAt: new Date(),
      endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    const leaderboard = await queries.getSeasonLeaderboard(season.id, teamId);
    expect(Array.isArray(leaderboard)).toBe(true);
    await queries.endSeasonById(season.id);

    const award = await queries.getRepoAward(repositoryId);
    expect(award).toBeFalsy(); // no award computed for this fresh repo — not a crash
  });
});
