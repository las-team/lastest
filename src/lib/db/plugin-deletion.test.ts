import { beforeEach, describe, expect, it, vi } from "vitest";

const runPluginDeletion = vi.fn();
const error = vi.fn();

vi.mock("@/lib/core/runtime", () => ({ runPluginDeletion }));
vi.mock("@/lib/logger", () => ({ getLogger: () => ({ error }) }));

import { cascadePluginDeletion } from "@/lib/db/plugin-deletion";

describe("cascadePluginDeletion", () => {
  beforeEach(() => {
    runPluginDeletion.mockReset();
    error.mockReset();
  });

  it("hands the target to the composition root", async () => {
    runPluginDeletion.mockResolvedValue({
      target: { kind: "team", id: "t1" },
      ran: ["explorer"],
      skipped: [],
      failed: [],
    });

    await cascadePluginDeletion({ kind: "team", id: "t1" });

    expect(runPluginDeletion).toHaveBeenCalledWith({ kind: "team", id: "t1" });
  });

  /**
   * The load-bearing property. Callers invoke this *after* core's own delete has
   * committed, so a throw here would surface as "account deletion failed" for an
   * account that is already gone — and would hand a broken plugin a veto over
   * the whole operation.
   */
  it("never throws when the composition root fails, and says so loudly", async () => {
    runPluginDeletion.mockRejectedValue(new Error("registry did not resolve"));

    await expect(
      cascadePluginDeletion({ kind: "repo", id: "r1" }),
    ).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]?.[0]).toMatchObject({
      kind: "repo",
      targetId: "r1",
    });
  });
});
