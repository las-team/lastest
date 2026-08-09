import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The regression guard for `core-scope.md` §6's unpaid cost.
 *
 * Removing FKs from plugin tables to core tables removed `ON DELETE CASCADE`
 * with them, and the replacement — registered deletion hooks — was written,
 * unit-tested inside `core/data`, and then never called by anything. That is
 * the failure this file exists to catch: not "do the hooks work" (`core/data`
 * covers that) but "does the app's delete path still reach them at all".
 *
 * It asserts the *wiring*, deliberately: mock the database, delete a team and a
 * repository, and require that the cascade was invoked with the right target.
 * A future refactor that drops the call site fails here rather than silently
 * orphaning encrypted credentials belonging to a deleted user.
 */

const cascadePluginDeletion = vi.fn(async () => {});

vi.mock("@/lib/db/plugin-deletion", () => ({ cascadePluginDeletion }));

/**
 * A stand-in for the drizzle handle.
 *
 * Every method returns the same object so any builder chain resolves, and it is
 * awaitable as an empty result set — which is what makes `deleteRepository`'s
 * ~30-statement transaction traverse to the end without a database: every
 * `select` yields `[]`, so each `if (ids.length)` branch is skipped and no
 * `inArray` is ever handed a fake value.
 */
function chainStub(): Record<string, unknown> {
  const stub: Record<string, unknown> = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve: (v: unknown[]) => unknown) => resolve([]);
        }
        if (prop === "transaction") {
          return (fn: (tx: unknown) => Promise<unknown>) => fn(stub);
        }
        return () => stub;
      },
    },
  );
  return stub;
}

vi.mock("../index", () => ({ db: chainStub(), sql: {} }));

describe("core deletion drives plugin deletion hooks", () => {
  beforeEach(() => {
    cascadePluginDeletion.mockClear();
  });

  it("deleteTeam cascades to plugins", async () => {
    const { deleteTeam } = await import("./auth");
    await deleteTeam("team-1");

    expect(cascadePluginDeletion).toHaveBeenCalledWith({
      kind: "team",
      id: "team-1",
    });
  });

  it("deleteRepository cascades to plugins", async () => {
    const { deleteRepository } = await import("./repositories");
    await deleteRepository("repo-1");

    expect(cascadePluginDeletion).toHaveBeenCalledWith({
      kind: "repo",
      id: "repo-1",
    });
  });
});
