import { describe, expect, it } from "vitest";
import {
  buildToolArguments,
  isToolAvailable,
  WebMcpContextError,
} from "@/lib/webmcp/arguments";
import { WEBMCP_TOOLS_BY_NAME } from "@/lib/webmcp/registry";
import type { WebMcpToolDef } from "@/lib/webmcp/types";

function tool(name: string): WebMcpToolDef {
  const found = WEBMCP_TOOLS_BY_NAME.get(name);
  if (!found) throw new Error(`no such registry tool: ${name}`);
  return found;
}

describe("buildToolArguments", () => {
  it("pins the action from the registry, not the agent", () => {
    const args = buildToolArguments(
      tool("lastest_list_failing_tests"),
      {},
      {
        repositoryId: "repo-1",
      },
    );
    expect(args).toEqual({
      repositoryId: "repo-1",
      action: "list",
      filter: "failing",
    });
  });

  it("takes route ids from the page, never from the agent", () => {
    expect(() =>
      buildToolArguments(
        tool("lastest_list_failing_tests"),
        { repositoryId: "someone-elses-repo" },
        { repositoryId: "repo-1" },
      ),
    ).toThrow(WebMcpContextError);
  });

  it("rejects arguments outside the published schema", () => {
    expect(() =>
      buildToolArguments(
        tool("lastest_run_tests"),
        { gitBranch: "main" },
        {
          repositoryId: "repo-1",
        },
      ),
    ).toThrow(/Unknown argument/);
  });

  it("refuses when the page cannot supply a required id", () => {
    expect(() =>
      buildToolArguments(tool("lastest_review_build"), {}, {}),
    ).toThrow(/needs buildId/);
  });

  it("approves the open build only when no diff ids were named", () => {
    const all = buildToolArguments(
      tool("lastest_approve_diffs"),
      {},
      {
        buildId: "build-1",
      },
    );
    expect(all).toEqual({ buildId: "build-1", action: "approve" });

    const some = buildToolArguments(
      tool("lastest_approve_diffs"),
      { diffIds: ["d1", "d2"] },
      { buildId: "build-1" },
    );
    // The MCP tool rejects diffIds + buildId together.
    expect(some).toEqual({ diffIds: ["d1", "d2"], action: "approve" });
  });

  it("passes the agent's own arguments through", () => {
    expect(
      buildToolArguments(
        tool("lastest_run_tests"),
        { testIds: ["t1"] },
        {
          repositoryId: "repo-1",
        },
      ),
    ).toEqual({ testIds: ["t1"], repositoryId: "repo-1" });
  });
});

describe("isToolAvailable", () => {
  it("hides route-scoped tools until the page supplies their ids", () => {
    expect(isToolAvailable(tool("lastest_review_build"), {})).toBe(false);
    expect(
      isToolAvailable(tool("lastest_review_build"), { buildId: "b1" }),
    ).toBe(true);
    expect(isToolAvailable(tool("lastest_list_projects"), {})).toBe(true);
  });
});
