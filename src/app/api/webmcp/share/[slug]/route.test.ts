/**
 * The public share tool surface. What matters here is that it stays *public and
 * narrow*: slug-scoped, read-only, no session, and nothing reachable beyond the
 * three declared ops or outside a live share.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const getPublicShareBySlug = vi.fn();
const getBuildRenderContext = vi.fn();
const getOwnerTeamFlags = vi.fn();

vi.mock("@lastest/plugin-share", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@lastest/plugin-share",
  );
  return {
    ...actual,
    getPublicShareBySlug: (slug: string) => getPublicShareBySlug(slug),
  };
});

vi.mock("@/lib/core/share-host", () => ({
  appShareHost: {
    getBuildRenderContext: (target: unknown) => getBuildRenderContext(target),
    getOwnerTeamFlags: (repositoryId: unknown) =>
      getOwnerTeamFlags(repositoryId),
  },
}));

import { POST, __resetShareContextCache } from "./route";

// 22 chars — `isValidShareSlug`'s format.
const SLUG = "Abcd1234efgh5678ijkl90";

function call(name: string, slug = SLUG) {
  return POST(
    new NextRequest(`http://localhost:3000/api/webmcp/share/${slug}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ op: "call", name }),
    }),
    { params: Promise.resolve({ slug }) },
  );
}

const SHARE = {
  buildId: "b1",
  testId: null,
  status: "public",
  targetDomain: "example.com",
};

const RENDERED = {
  build: {
    id: "b1",
    totalTests: 3,
    passedCount: 2,
    failedCount: 1,
    changesDetected: 1,
    overallStatus: "changes_detected",
    completedAt: new Date("2026-08-27T10:00:00Z"),
    createdAt: new Date("2026-08-27T09:58:00Z"),
    a11yScore: 91,
    a11yViolationCount: 4,
    baseUrl: "https://example.com",
    buildSetupTestId: null,
  },
  test: null,
  testRun: null,
  diffs: [
    {
      id: "d1",
      testId: "t1",
      testName: "Home page",
      stepLabel: "hero",
      pixelDifference: 1200,
      percentageDifference: "2.10",
      classification: "content",
      baselineImagePath: "/storage/a.png",
      currentImagePath: "storage/b.png",
      diffImagePath: null,
    },
    // No renderable change (no pixels) — must not be reported as a change.
    {
      id: "d2",
      testId: "t1",
      testName: "Home page",
      stepLabel: "footer",
      pixelDifference: 0,
      baselineImagePath: "/storage/c.png",
      currentImagePath: "/storage/d.png",
    },
  ],
  results: [
    { testId: "t1", status: "failed", durationMs: 4200, screenshots: [] },
    { testId: "t2", status: "passed", durationMs: 900, screenshots: [] },
  ],
  stepComparisons: [
    {
      id: "sc1",
      testId: "t1",
      stepLabel: "hero",
      stepIndex: 2,
      verdict: "red",
      layers: { visual: {}, console: {} },
    },
  ],
};

beforeEach(() => {
  getPublicShareBySlug.mockReset().mockResolvedValue(SHARE);
  getBuildRenderContext.mockReset().mockResolvedValue(RENDERED);
  // Default: the owning team permits public sharing. The regulated case sets
  // it false explicitly.
  getOwnerTeamFlags.mockReset().mockResolvedValue({
    earlyAdopterMode: false,
    regulatedMode: false,
    sharingPermitted: true,
  });
  __resetShareContextCache();
});

describe("POST /api/webmcp/share/[slug]", () => {
  it("404s an invalid slug without touching the database", async () => {
    const res = await call("report_summary", "../../etc/passwd");
    expect(res.status).toBe(404);
    expect(getPublicShareBySlug).not.toHaveBeenCalled();
  });

  it("404s a revoked share", async () => {
    getPublicShareBySlug.mockResolvedValue({ ...SHARE, status: "revoked" });
    expect((await call("report_summary")).status).toBe(404);
  });

  it("rejects anything outside the three declared ops", async () => {
    const res = await call("lastest_decide_diff");
    expect(res.status).toBe(400);
    expect(getPublicShareBySlug).not.toHaveBeenCalled();
  });

  it("summarizes the report", async () => {
    const body = await (await call("report_summary")).json();
    expect(body.ok).toBe(true);
    expect(body.result).toMatchObject({
      reportUrl: `/r/${SLUG}`,
      site: "example.com",
      scope: "whole build",
      tests: { total: 3, passed: 2, failed: 1 },
      visualChanges: 1,
      accessibility: { score: 91, violations: 4 },
    });
  });

  it("lists only renderable visual changes, with slug-scoped media URLs", async () => {
    const body = await (await call("visual_changes")).json();
    expect(body.result.changes).toHaveLength(1);
    expect(body.result.changes[0]).toMatchObject({
      id: "d1",
      test: "Home page",
      step: "hero",
      percentChanged: "2.10",
      before: `/share/${SLUG}/storage/a.png`,
      after: `/share/${SLUG}/storage/b.png`,
    });
  });

  it("404s a share whose owning team no longer permits sharing", async () => {
    // A team that flips regulated mode can no longer mint links, but the ones
    // already out there must not gain a structured extraction endpoint over
    // the same data. Refused before the expensive render context.
    getOwnerTeamFlags.mockResolvedValue({
      earlyAdopterMode: false,
      regulatedMode: true,
      sharingPermitted: false,
    });
    expect((await call("report_summary")).status).toBe(404);
    expect(getBuildRenderContext).not.toHaveBeenCalled();
  });

  it("fetches the render context once across repeated calls on a slug", async () => {
    // A share's contents do not change, and the caller is anonymous and can
    // loop. The revoke check is upstream of this and stays uncached.
    await call("report_summary");
    await call("visual_changes");
    await call("failing_steps");
    expect(getBuildRenderContext).toHaveBeenCalledTimes(1);
    expect(getPublicShareBySlug).toHaveBeenCalledTimes(3);
  });

  it("429s a slug that is hammered, without touching the database", async () => {
    const hot = "Zzzz1234efgh5678ijkl90";
    let last = await call("report_summary", hot);
    for (let i = 0; i < 80 && last.status !== 429; i++) {
      last = await call("report_summary", hot);
    }
    expect(last.status).toBe(429);
    expect(last.headers.get("retry-after")).toBeTruthy();
  });

  it("reports failing tests with their red steps", async () => {
    const body = await (await call("failing_steps")).json();
    expect(body.result.failing).toHaveLength(1);
    expect(body.result.failing[0]).toMatchObject({
      testId: "t1",
      testName: "Home page",
      status: "failed",
      redSteps: [{ step: "hero", index: 2, layers: ["visual", "console"] }],
    });
  });
});
