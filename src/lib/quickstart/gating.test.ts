import { describe, it, expect } from "vitest";
import type { Repository } from "@/lib/db/schema";
import { pickRepoBaseUrl } from "./gating";

function repo(partial: Partial<Repository>): Repository {
  return partial as unknown as Repository;
}

describe("pickRepoBaseUrl", () => {
  it("prefers the real default branch over the legacy 'default' key", () => {
    // The reported bug: an excalidraw repo whose `default` key was a stale
    // sandbox-seed URL (playwright.dev) while the actual `master` branch points
    // at the product. The scout must reconnoiter excalidraw.com, not playwright.dev.
    const url = pickRepoBaseUrl(
      repo({
        defaultBranch: "master",
        comparisonBaselineBranch: null,
        branchBaseUrls: {
          master: "https://excalidraw.com",
          default: "https://playwright.dev",
        },
      }),
    );
    expect(url).toBe("https://excalidraw.com");
  });

  it("falls back to the comparison baseline branch when there is no default branch URL", () => {
    const url = pickRepoBaseUrl(
      repo({
        defaultBranch: "missing-branch",
        comparisonBaselineBranch: "staging",
        branchBaseUrls: {
          staging: "https://staging.example.com",
          default: "https://playwright.dev",
        },
      }),
    );
    expect(url).toBe("https://staging.example.com");
  });

  it("uses any named branch before the 'default' key", () => {
    const url = pickRepoBaseUrl(
      repo({
        defaultBranch: null,
        comparisonBaselineBranch: null,
        branchBaseUrls: {
          feature: "https://feature.example.com",
          default: "https://playwright.dev",
        },
      }),
    );
    expect(url).toBe("https://feature.example.com");
  });

  it("still returns the 'default' key when it is the only entry", () => {
    const url = pickRepoBaseUrl(
      repo({
        defaultBranch: null,
        comparisonBaselineBranch: null,
        branchBaseUrls: { default: "https://playwright.dev" },
      }),
    );
    expect(url).toBe("https://playwright.dev");
  });

  it("skips a local default-branch URL and uses the next non-local candidate", () => {
    const url = pickRepoBaseUrl(
      repo({
        defaultBranch: "main",
        comparisonBaselineBranch: null,
        branchBaseUrls: {
          main: "http://localhost:3000",
          prod: "https://app.example.com",
          default: "https://playwright.dev",
        },
      }),
    );
    expect(url).toBe("https://app.example.com");
  });

  it("returns undefined when every candidate is local", () => {
    const url = pickRepoBaseUrl(
      repo({
        defaultBranch: "main",
        comparisonBaselineBranch: null,
        branchBaseUrls: {
          main: "http://localhost:3000",
          default: "http://127.0.0.1:8080",
        },
      }),
    );
    expect(url).toBeUndefined();
  });

  it("returns undefined when there are no branch base URLs", () => {
    const url = pickRepoBaseUrl(
      repo({ defaultBranch: "main", branchBaseUrls: null }),
    );
    expect(url).toBeUndefined();
  });
});
