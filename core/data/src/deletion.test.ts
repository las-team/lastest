import { describe, expect, it, vi } from "vitest";

import { runDeletionHooks } from "./deletion";

describe("runDeletionHooks", () => {
  it("runs the team hook for every plugin that has one", async () => {
    const a = vi.fn(async () => {});
    const b = vi.fn(async () => {});
    const report = await runDeletionHooks(
      [
        { id: "explorer", deletion: { onTeamDeleted: a } },
        { id: "rca", deletion: { onTeamDeleted: b } },
      ],
      { kind: "team", id: "t1" },
    );

    expect(a).toHaveBeenCalledWith("t1");
    expect(b).toHaveBeenCalledWith("t1");
    expect(report.ran).toEqual(["explorer", "rca"]);
    expect(report.failed).toEqual([]);
  });

  it("picks the hook matching the target kind", async () => {
    const onTeamDeleted = vi.fn(async () => {});
    const onRepoDeleted = vi.fn(async () => {});
    await runDeletionHooks(
      [{ id: "explorer", deletion: { onTeamDeleted, onRepoDeleted } }],
      { kind: "repo", id: "r1" },
    );
    expect(onRepoDeleted).toHaveBeenCalledWith("r1");
    expect(onTeamDeleted).not.toHaveBeenCalled();
  });

  it("skips a plugin with no hook for this kind without failing", async () => {
    // A plugin may hold team-scoped rows only. That is not an error.
    const report = await runDeletionHooks(
      [{ id: "explorer", deletion: { onTeamDeleted: vi.fn(async () => {}) } }],
      { kind: "repo", id: "r1" },
    );
    expect(report.skipped).toEqual(["explorer"]);
    expect(report.failed).toEqual([]);
  });

  it("keeps deleting after one hook throws", async () => {
    // Partial deletion beats none: one broken plugin must not strand the other
    // nineteen plugins' rows, which is the GDPR problem this replaces a
    // database cascade with.
    const later = vi.fn(async () => {});
    const report = await runDeletionHooks(
      [
        {
          id: "broken",
          deletion: {
            onTeamDeleted: async () => {
              throw new Error("boom");
            },
          },
        },
        { id: "explorer", deletion: { onTeamDeleted: later } },
      ],
      { kind: "team", id: "t1" },
    );

    expect(later).toHaveBeenCalled();
    expect(report.ran).toEqual(["explorer"]);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0].pluginId).toBe("broken");
  });

  it("returns failures rather than throwing, so the caller can retry", async () => {
    await expect(
      runDeletionHooks(
        [
          {
            id: "broken",
            deletion: {
              onTeamDeleted: async () => {
                throw new Error("boom");
              },
            },
          },
        ],
        { kind: "team", id: "t1" },
      ),
    ).resolves.toMatchObject({ ran: [], failed: [{ pluginId: "broken" }] });
  });

  it("runs hooks sequentially", async () => {
    // Parallel deletion across twenty plugins competes with live traffic for
    // the same connection pool — a capacity incident, which is the thing core
    // exists to prevent.
    const order: string[] = [];
    const slow = (id: string) => async () => {
      order.push(`${id}:start`);
      await new Promise((r) => setTimeout(r, 5));
      order.push(`${id}:end`);
    };
    await runDeletionHooks(
      [
        { id: "a", deletion: { onTeamDeleted: slow("a") } },
        { id: "b", deletion: { onTeamDeleted: slow("b") } },
      ],
      { kind: "team", id: "t1" },
    );
    expect(order).toEqual(["a:start", "a:end", "b:start", "b:end"]);
  });
});
