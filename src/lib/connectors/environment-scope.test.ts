import { describe, expect, it, vi, beforeEach } from "vitest";

const getEnvironment = vi.fn();
vi.mock("@/lib/db/queries", () => ({
  getEnvironment: (id: string) => getEnvironment(id),
}));

import { assertEnvironmentInRepo } from "./environment-scope";

/**
 * The #97 IDOR shape, guarded: the caller authorized `repositoryId`, and
 * `environmentId` is a different raw id that must be re-derived from its own
 * row before anything is written or probed with it.
 */
describe("assertEnvironmentInRepo", () => {
  beforeEach(() => getEnvironment.mockReset());

  it("permits repo-wide (null) without a lookup", async () => {
    await expect(assertEnvironmentInRepo(null, "repo-1")).resolves.toBeNull();
    expect(getEnvironment).not.toHaveBeenCalled();
  });

  it("permits an environment that belongs to the authorized repo", async () => {
    getEnvironment.mockResolvedValue({ id: "env-1", repositoryId: "repo-1" });
    await expect(assertEnvironmentInRepo("env-1", "repo-1")).resolves.toBe(
      "env-1",
    );
  });

  it("refuses another repo's environment", async () => {
    // The cross-tenant case: without this the id is written straight through,
    // binding a credential to an environment the caller does not own.
    getEnvironment.mockResolvedValue({ id: "env-9", repositoryId: "repo-2" });
    await expect(assertEnvironmentInRepo("env-9", "repo-1")).rejects.toThrow(
      /Forbidden/,
    );
  });

  it("refuses an id that resolves to nothing, with the same message", async () => {
    // Same error either way, so the response cannot be used as an oracle for
    // whether a given environment id exists.
    getEnvironment.mockResolvedValue(undefined);
    await expect(assertEnvironmentInRepo("env-nope", "repo-1")).rejects.toThrow(
      /Forbidden: Environment not found/,
    );
  });
});
