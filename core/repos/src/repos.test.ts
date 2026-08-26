import { describe, expect, it, vi } from "vitest";
import type { TeamRef } from "@lastest/contracts";

import { createReposCapability } from "./repos";
import type { ReposHost } from "./host";

const team: TeamRef = {
  id: "t1",
  name: "T1",
  slug: "t1",
  plan: "pro",
  entitlements: new Set(),
};

function hostWith(overrides: Partial<ReposHost> = {}): ReposHost {
  return {
    lookup: vi.fn(async () => ({
      branchBaseUrls: {},
      defaultBranch: null,
      teamId: null,
    })),
    environmentBaseUrl: vi.fn(async () => null),
    ...overrides,
  };
}

describe("createReposCapability", () => {
  it("resolves null for a repo in another team", async () => {
    const host = hostWith({
      lookup: vi.fn(async () => ({
        branchBaseUrls: { main: "https://other.example" },
        defaultBranch: "main",
        teamId: "someone-else",
      })),
    });
    const repos = createReposCapability(host, team);

    expect(await repos.baseUrl("r1")).toBeNull();
  });

  it("resolves null identically for a repo that does not exist", async () => {
    const host = hostWith();
    const repos = createReposCapability(host, team);

    expect(await repos.baseUrl("ghost")).toBeNull();
  });

  it("prefers the requested branch's URL", async () => {
    const host = hostWith({
      lookup: vi.fn(async () => ({
        branchBaseUrls: {
          main: "https://main.example",
          "feat/x": "https://feat.example",
        },
        defaultBranch: "main",
        teamId: "t1",
      })),
    });
    const repos = createReposCapability(host, team);

    expect(await repos.baseUrl("r1", "feat/x")).toBe("https://feat.example");
  });

  it("falls back to the default branch when none is requested", async () => {
    const host = hostWith({
      lookup: vi.fn(async () => ({
        branchBaseUrls: { main: "https://main.example" },
        defaultBranch: "main",
        teamId: "t1",
      })),
    });
    const repos = createReposCapability(host, team);

    expect(await repos.baseUrl("r1")).toBe("https://main.example");
  });

  it("falls back to `main`, then any configured branch, then environment settings", async () => {
    const anyBranch = hostWith({
      lookup: vi.fn(async () => ({
        branchBaseUrls: { staging: "https://staging.example" },
        defaultBranch: "develop",
        teamId: "t1",
      })),
    });
    expect(await createReposCapability(anyBranch, team).baseUrl("r1")).toBe(
      "https://staging.example",
    );

    const environmentOnly = hostWith({
      lookup: vi.fn(async () => ({
        branchBaseUrls: {},
        defaultBranch: null,
        teamId: "t1",
      })),
      environmentBaseUrl: vi.fn(async () => "https://env.example"),
    });
    expect(
      await createReposCapability(environmentOnly, team).baseUrl("r1"),
    ).toBe("https://env.example");
  });

  it("resolves null when nothing is configured anywhere", async () => {
    const host = hostWith({
      lookup: vi.fn(async () => ({
        branchBaseUrls: {},
        defaultBranch: null,
        teamId: "t1",
      })),
    });
    expect(await createReposCapability(host, team).baseUrl("r1")).toBeNull();
  });
});
