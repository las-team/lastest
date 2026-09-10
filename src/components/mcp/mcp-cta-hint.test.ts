import { describe, expect, it } from "vitest";
import { buildMcpPrompt } from "@/components/mcp/mcp-cta-hint";

const TRIAGE_TAIL =
  "group its failed and changed cases by root cause, tell me which are real regressions, flaky runs, environment issues or test problems, and suggest a verdict per group.";

describe("buildMcpPrompt", () => {
  it("triage with buildId names the exact build", () => {
    expect(
      buildMcpPrompt("triage", { buildId: "b-123", repositoryId: "r-1" }),
    ).toBe(`Using the Lastest MCP server, triage build b-123: ${TRIAGE_TAIL}`);
  });

  it("triage without buildId targets the latest build, scoped to the repo", () => {
    expect(buildMcpPrompt("triage", { repositoryId: "r-1" })).toBe(
      `Using the Lastest MCP server, triage the latest build in repo r-1: ${TRIAGE_TAIL}`,
    );
  });

  it("triage with neither buildId nor repositoryId has no repo suffix", () => {
    expect(buildMcpPrompt("triage", {})).toBe(
      `Using the Lastest MCP server, triage the latest build: ${TRIAGE_TAIL}`,
    );
  });

  it("unknown key falls back to the generate prompt", () => {
    expect(
      buildMcpPrompt("nope", {
        targetUrl: "https://x.test",
        repositoryId: "r-1",
      }),
    ).toBe(
      "Using the Lastest MCP server, create a Playwright test in repo r-1 for https://x.test that covers the main flow, then run it and show me the result.",
    );
  });

  it("diff with buildId reviews that build's visual diffs", () => {
    expect(buildMcpPrompt("diff", { buildId: "b-9" })).toBe(
      "Using the Lastest MCP server, review build b-9's visual diffs, tell me which are real regressions vs. noise, and approve the safe ones.",
    );
  });
});
