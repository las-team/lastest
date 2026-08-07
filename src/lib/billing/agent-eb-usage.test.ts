import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const recordTeamAgentMinutes = vi.fn();
const getTeamRunUsage = vi.fn();

vi.mock("@/lib/db/queries", () => ({
  recordTeamAgentMinutes: (...args: unknown[]) =>
    recordTeamAgentMinutes(...args),
  getTeamRunUsage: (...args: unknown[]) => getTeamRunUsage(...args),
}));

import {
  beginAgentEbUsage,
  endAgentEbUsage,
  assertAgentRunMinutesAvailable,
} from "@/lib/billing/agent-eb-usage";

describe("agent EB usage metering", () => {
  beforeEach(() => {
    recordTeamAgentMinutes.mockReset().mockResolvedValue(undefined);
    getTeamRunUsage.mockReset();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.ENFORCE_RUN_LIMITS;
  });

  it("bills the claim→release window to the claiming team", async () => {
    beginAgentEbUsage("runner-1", "team-a");
    vi.advanceTimersByTime(90_000);
    await endAgentEbUsage("runner-1");

    expect(recordTeamAgentMinutes).toHaveBeenCalledTimes(1);
    const [teamId, durationMs] = recordTeamAgentMinutes.mock.calls[0];
    expect(teamId).toBe("team-a");
    expect(durationMs).toBe(90_000);
  });

  it("ignores runners that were never attributed", async () => {
    // The test executor claims EBs without a billing team and meters its own
    // run minutes — releasing those must not double-charge anyone.
    await endAgentEbUsage("unattributed-runner");
    expect(recordTeamAgentMinutes).not.toHaveBeenCalled();
  });

  it("bills a window only once even if release is retried", async () => {
    beginAgentEbUsage("runner-2", "team-b");
    vi.advanceTimersByTime(30_000);
    await endAgentEbUsage("runner-2");
    // Boot-time orphan reconciliation can release the same runner again.
    await endAgentEbUsage("runner-2");
    expect(recordTeamAgentMinutes).toHaveBeenCalledTimes(1);
  });

  it("keeps concurrent swarm claims attributed independently", async () => {
    beginAgentEbUsage("swarm-1", "team-c");
    vi.advanceTimersByTime(10_000);
    beginAgentEbUsage("swarm-2", "team-c");
    vi.advanceTimersByTime(20_000);

    await endAgentEbUsage("swarm-1"); // held 30s
    await endAgentEbUsage("swarm-2"); // held 20s

    expect(recordTeamAgentMinutes.mock.calls.map((c) => c[1])).toEqual([
      30_000, 20_000,
    ]);
  });

  it("never lets a billing failure break EB release", async () => {
    recordTeamAgentMinutes.mockRejectedValue(new Error("db down"));
    beginAgentEbUsage("runner-3", "team-d");
    vi.advanceTimersByTime(1000);
    await expect(endAgentEbUsage("runner-3")).resolves.toBeUndefined();
  });
});

describe("assertAgentRunMinutesAvailable", () => {
  beforeEach(() => {
    getTeamRunUsage.mockReset();
  });
  afterEach(() => {
    delete process.env.ENFORCE_RUN_LIMITS;
  });

  it("is a no-op unless enforcement is switched on", async () => {
    getTeamRunUsage.mockResolvedValue({
      monthlyRunQuota: 10,
      runMinutesThisMonth: 999,
    });
    await expect(
      assertAgentRunMinutesAvailable("team-a"),
    ).resolves.toBeUndefined();
    expect(getTeamRunUsage).not.toHaveBeenCalled();
  });

  it("throws once the quota is exhausted", async () => {
    process.env.ENFORCE_RUN_LIMITS = "true";
    getTeamRunUsage.mockResolvedValue({
      monthlyRunQuota: 100,
      runMinutesThisMonth: 100,
    });
    await expect(assertAgentRunMinutesAvailable("team-a")).rejects.toThrow(
      /quota exceeded/i,
    );
  });

  it("allows a team still under quota", async () => {
    process.env.ENFORCE_RUN_LIMITS = "true";
    getTeamRunUsage.mockResolvedValue({
      monthlyRunQuota: 100,
      runMinutesThisMonth: 99,
    });
    await expect(
      assertAgentRunMinutesAvailable("team-a"),
    ).resolves.toBeUndefined();
  });

  it("treats a zero quota as unlimited", async () => {
    process.env.ENFORCE_RUN_LIMITS = "true";
    getTeamRunUsage.mockResolvedValue({
      monthlyRunQuota: 0,
      runMinutesThisMonth: 5000,
    });
    await expect(
      assertAgentRunMinutesAvailable("team-a"),
    ).resolves.toBeUndefined();
  });
});
