/**
 * Runtime verification for §3 "Public share links" (core-plugin-refactor-
 * test-plan.md, P1 row — `share/captions.ts`, `video-fallback.ts`,
 * `chapter-rail.tsx` changed on this branch).
 *
 * Hits the live app's own `/r/<slug>` and `/share/<slug>/captions.vtt`
 * routes over plain HTTP with no auth/cookies — exactly how an anonymous
 * viewer reaches a share — for both:
 *   - a test whose result has a persisted `videoPath` (primary asset present)
 *   - a test with no persisted `videoPath` but a matching `.webm` on disk,
 *     exercising `resolveTestVideoUrl()`'s disk-scan fallback
 * plus the captions track being present/absent per build.
 *
 * Prerequisites: `pnpm dev` running on :3000 (or `LASTEST_URL` pointed at a
 * running instance). Run with `pnpm test:integration`.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { v4 as uuid } from "uuid";
import { generateShareSlug, type VideoCaption } from "@lastest/plugin-share";
import { sharePublicShares } from "@lastest/plugin-share/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import {
  builds,
  buildDemoNotes,
  repositories,
  teams,
  testResults,
  testRuns,
  tests,
} from "@/lib/db/schema";
import * as queries from "@/lib/db/queries";

/**
 * `share_public_shares` lives in `plugins/share/src/schema.ts` now, reached
 * at runtime only through the plugin's wired `DataCapability`. This test
 * runs as a separate process against a live dev server (`pnpm
 * test:integration`), not inside the app's plugin runtime, so it inserts
 * fixture rows directly via the same raw `db` handle it already uses for
 * `builds`/`repositories`/`teams` — legitimate for test fixture setup, not a
 * production code path.
 */
async function createPublicShareFixture(data: {
  slug: string;
  buildId: string;
  testId: string;
  repositoryId: string;
  ownerTeamId: string;
  targetDomain: string;
}) {
  await db.insert(sharePublicShares).values({
    id: uuid(),
    slug: data.slug,
    buildId: data.buildId,
    testId: data.testId,
    repositoryId: data.repositoryId,
    ownerTeamId: data.ownerTeamId,
    status: "public",
    kind: "regression",
    targetDomain: data.targetDomain,
    createdAt: new Date(),
  });
}

const APP_ORIGIN = process.env.LASTEST_URL || "http://localhost:3000";
const VIDEO_ROOT = path.join(process.cwd(), "storage", "videos");

let teamId: string;
let repositoryId: string;
let testAId: string; // primary videoPath present
let testBId: string; // videoPath null, disk-fallback webm present
let buildAId: string;
let buildBId: string;
let slugA: string;
let slugB: string;
let webmPath: string;

beforeAll(async () => {
  teamId = uuid();
  await db.insert(teams).values({
    id: teamId,
    name: `share-test-${teamId.slice(0, 8)}`,
    slug: `share-test-${teamId.slice(0, 8)}`,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  repositoryId = uuid();
  await db.insert(repositories).values({
    id: repositoryId,
    teamId,
    provider: "local",
    owner: "share-test",
    name: "repo",
    fullName: "share-test/repo",
    createdAt: new Date(),
  });

  const now = new Date();

  // --- Test A: video present directly on the result row ---
  const testA = await queries.createTest({
    repositoryId,
    name: "share-test-A",
    code: "export async function test(page) {}",
    targetUrl: "https://example.test/a",
  });
  testAId = testA.id;

  const runA = await queries.createTestRun({
    repositoryId,
    status: "completed",
    startedAt: now,
    completedAt: now,
    gitBranch: "main",
    gitCommit: "abc1234",
  });
  await queries.createTestResult({
    testRunId: runA.id,
    testId: testAId,
    status: "passed",
    videoPath: `/videos/${repositoryId}/${runA.id}-${testAId}.webm`,
    durationMs: 4200,
  });
  const buildA = await queries.createBuild({
    testRunId: runA.id,
    triggerType: "manual",
    overallStatus: "safe_to_merge",
    completedAt: now,
    totalTests: 1,
    changesDetected: 0,
  });
  buildAId = buildA.id;

  // --- Test B: no persisted videoPath, but a real .webm on disk matching
  //     resolveTestVideoUrl()'s `-<testId>.webm` suffix scan ---
  const testB = await queries.createTest({
    repositoryId,
    name: "share-test-B",
    code: "export async function test(page) {}",
    targetUrl: "https://example.test/b",
  });
  testBId = testB.id;

  const runB = await queries.createTestRun({
    repositoryId,
    status: "completed",
    startedAt: now,
    completedAt: now,
    gitBranch: "main",
    gitCommit: "abc1234",
  });
  await queries.createTestResult({
    testRunId: runB.id,
    testId: testBId,
    status: "passed",
    videoPath: null,
    durationMs: 3100,
  });
  const buildB = await queries.createBuild({
    testRunId: runB.id,
    triggerType: "manual",
    overallStatus: "safe_to_merge",
    completedAt: now,
    totalTests: 1,
    changesDetected: 0,
  });
  buildBId = buildB.id;

  const videoDir = path.join(VIDEO_ROOT, repositoryId);
  await mkdir(videoDir, { recursive: true });
  webmPath = path.join(videoDir, `fallback-${testBId}.webm`);
  await writeFile(webmPath, Buffer.from("fake-webm-bytes"));

  // --- Shares ---
  slugA = generateShareSlug();
  await createPublicShareFixture({
    slug: slugA,
    buildId: buildAId,
    testId: testAId,
    repositoryId,
    ownerTeamId: teamId,
    targetDomain: "example.test",
  });

  slugB = generateShareSlug();
  await createPublicShareFixture({
    slug: slugB,
    buildId: buildBId,
    testId: testBId,
    repositoryId,
    ownerTeamId: teamId,
    targetDomain: "example.test",
  });

  // Captions only on build A, so A/B diverge on the <track>/vtt route too.
  const captions: VideoCaption[] = [
    { stepIndex: 0, startMs: 0, endMs: 2000, text: "Opens the page." },
  ];
  await queries.upsertBuildDemoNotes(buildAId, {
    uxSummary: "Looks fine.",
    highlights: [],
    frictionPoints: [],
    testingStruggles: [],
    generatedAt: now.toISOString(),
    captions,
  });
}, 30_000);

afterAll(async () => {
  await rm(webmPath, { force: true }).catch(() => {});
  await db.delete(buildDemoNotes).where(eq(buildDemoNotes.buildId, buildAId));
  await db
    .delete(sharePublicShares)
    .where(eq(sharePublicShares.repositoryId, repositoryId));
  await db.delete(testResults).where(eq(testResults.testId, testAId));
  await db.delete(testResults).where(eq(testResults.testId, testBId));
  await db.delete(builds).where(eq(builds.id, buildAId));
  await db.delete(builds).where(eq(builds.id, buildBId));
  const runsA = await db
    .select({ id: testRuns.id })
    .from(testRuns)
    .where(eq(testRuns.repositoryId, repositoryId));
  for (const r of runsA) {
    await db.delete(testRuns).where(eq(testRuns.id, r.id));
  }
  await db.delete(tests).where(eq(tests.id, testAId));
  await db.delete(tests).where(eq(tests.id, testBId));
  await db.delete(repositories).where(eq(repositories.id, repositoryId));
  await db.delete(teams).where(eq(teams.id, teamId));
});

describe("GET /r/<slug> — unauthenticated", () => {
  it("200s and renders the primary asset when test_results.video_path is set", async () => {
    const res = await fetch(`${APP_ORIGIN}/r/${slugA}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(`/share/${slugA}/videos/${repositoryId}/`);
    // Captions track present for build A.
    expect(html).toContain(`/share/${slugA}/captions.vtt`);
  });

  it("200s and falls back to the disk-scanned video when video_path is null", async () => {
    const res = await fetch(`${APP_ORIGIN}/r/${slugB}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    // resolveTestVideoUrl() found the fallback-*.webm we wrote to disk.
    expect(html).toContain(
      `/share/${slugB}/videos/${repositoryId}/fallback-${testBId}.webm`,
    );
    // No demo notes on build B — no captions track at all.
    expect(html).not.toContain(`/share/${slugB}/captions.vtt`);
  });

  it("404s on an unknown slug", async () => {
    const res = await fetch(`${APP_ORIGIN}/r/does-not-exist-${uuid()}`);
    expect(res.status).toBe(404);
  });
});

describe("GET /share/<slug>/captions.vtt", () => {
  it("200s with real VTT cues when the build has captions", async () => {
    const res = await fetch(`${APP_ORIGIN}/share/${slugA}/captions.vtt`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/vtt");
    const body = await res.text();
    expect(body).toContain("WEBVTT");
    expect(body).toContain("Opens the page.");
  });

  it("404s when the build has no captions", async () => {
    const res = await fetch(`${APP_ORIGIN}/share/${slugB}/captions.vtt`);
    expect(res.status).toBe(404);
  });
});
