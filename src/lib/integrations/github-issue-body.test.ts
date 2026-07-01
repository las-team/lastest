import { describe, it, expect } from "vitest";
import { buildVisualDiffBody, buildVerifyCaseBody } from "./github-issue-body";
import type { RcaVerdict, StepComparison, VisualDiff } from "@/lib/db/schema";

const BASE_URL = "https://lastest.example";

function rca(over: Partial<RcaVerdict> = {}): RcaVerdict {
  return {
    headline: "code",
    signals: [
      {
        category: "code:structural",
        confidence: 0.9,
        reason: "DOM nodes were added in a code-flagged area",
      },
    ],
    changedFiles: ["src/components/banner.tsx"],
    regionCauses: [
      {
        region: { x: 0, y: 0, width: 100, height: 40 },
        selector: '[data-testid="promo-banner"]',
        changeType: ["removed"],
        cssDeltas: [{ property: "display", baseline: "flex", current: "none" }],
      },
    ],
    version: 1,
    computedAt: "2026-06-16T00:00:00.000Z",
    ...over,
  };
}

function diff(over: Partial<VisualDiff> = {}): VisualDiff {
  return {
    id: "diff-1",
    buildId: "build-1",
    testId: "test-1",
    testResultId: null,
    stepLabel: "Checkout",
    browser: "chromium",
    baselineImagePath: null,
    currentImagePath: null,
    diffImagePath: null,
    pixelDifference: 1234,
    percentageDifference: "2.5",
    classification: "changed",
    status: "pending",
    metadata: { changedRegions: [], rca: rca() },
    aiAnalysis: null,
    aiRecommendation: null,
    issueUrl: null,
    issueProvider: null,
    ...over,
  } as VisualDiff;
}

function step(over: Partial<StepComparison> = {}): StepComparison {
  return {
    id: "step-1",
    buildId: "build-1",
    testId: "test-1",
    testResultId: null,
    visualDiffId: "diff-1",
    stepIndex: 0,
    stepLabel: "Checkout",
    verdict: "red",
    evidence: [{ layer: "visual", signal: "high", summary: "2.5% pixel diff" }],
    layers: {},
    githubIssueUrl: null,
    githubIssueNumber: null,
    githubIssueState: null,
    githubIssueKind: null,
    confirmedBy: null,
    confirmedAt: null,
    reviewerNote: null,
    createdAt: new Date(),
    ...over,
  } as StepComparison;
}

describe("suspected-cause (RCA) section", () => {
  it("renders headline, signals, changed files, and failing selector in the visual diff body", () => {
    const { body } = buildVisualDiffBody({
      diff: diff(),
      test: { id: "test-1", name: "Checkout flow", targetUrl: null },
      functionalAreaName: null,
      build: { id: "build-1" },
      testRun: { gitBranch: "main", gitCommit: "abc1234" },
      testResult: null,
      stepComparison: null,
      repoFullName: "acme/shop",
      reporterEmail: "qa@acme.dev",
      baseUrl: BASE_URL,
    });
    expect(body).toContain("### Suspected cause");
    expect(body).toContain("🔴 code change");
    expect(body).toContain("`code:structural` (90%)");
    expect(body).toContain("src/components/banner.tsx");
    expect(body).toContain('[data-testid="promo-banner"]');
    expect(body).toContain("`display: flex → none`");
  });

  it("renders the RCA section in the verify case body even when the visual layer is filtered out", () => {
    const { body } = buildVerifyCaseBody({
      step: step(),
      diff: diff(),
      test: { id: "test-1", name: "Checkout flow", targetUrl: null },
      functionalAreaName: null,
      build: { id: "build-1" },
      testRun: { gitBranch: "main", gitCommit: "abc1234" },
      testResult: null,
      repoFullName: "acme/shop",
      reporterEmail: null,
      baseUrl: BASE_URL,
      includedLayers: ["network"],
      reviewerNote: null,
    });
    expect(body).not.toContain("### Visual diff");
    expect(body).toContain("### Suspected cause");
    expect(body).toContain('[data-testid="promo-banner"]');
  });

  it("omits the section when no RCA verdict was computed", () => {
    const { body } = buildVisualDiffBody({
      diff: diff({ metadata: { changedRegions: [] } }),
      test: { id: "test-1", name: "Checkout flow", targetUrl: null },
      functionalAreaName: null,
      build: { id: "build-1" },
      testRun: null,
      testResult: null,
      stepComparison: null,
      repoFullName: "acme/shop",
      reporterEmail: "qa@acme.dev",
      baseUrl: BASE_URL,
    });
    expect(body).not.toContain("### Suspected cause");
  });
});
