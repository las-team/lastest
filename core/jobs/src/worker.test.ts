import { describe, expect, it, vi } from "vitest";

import { processDueJobs } from "./worker";
import type { ClaimedJob, WorkerHost } from "./worker";

const job: ClaimedJob = {
  id: "j1",
  type: "explorer.run",
  payload: { sessionId: "s1" },
  teamId: "t1",
  repositoryId: "r1",
  attempts: 0,
  maxAttempts: 3,
};

function hostWith(overrides: Partial<WorkerHost> = {}): WorkerHost {
  return {
    claimDue: vi.fn(async () => [job]),
    complete: vi.fn(async () => {}),
    failAttempt: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("processDueJobs", () => {
  it("dispatches each claimed job and marks it complete on success", async () => {
    const host = hostWith();
    const dispatch = vi.fn(async () => {});

    const count = await processDueJobs({ host, dispatch });

    expect(count).toBe(1);
    expect(dispatch).toHaveBeenCalledWith(
      "explorer.run",
      { sessionId: "s1" },
      expect.objectContaining({ id: "j1", attempt: 1, maxAttempts: 3 }),
      { teamId: "t1", repositoryId: "r1" },
    );
    expect(host.complete).toHaveBeenCalledWith("j1");
    expect(host.failAttempt).not.toHaveBeenCalled();
  });

  it("records a failed attempt without throwing out of the tick", async () => {
    const host = hostWith();
    const dispatch = vi.fn(async () => {
      throw new Error("boom");
    });
    const onError = vi.fn();

    const count = await processDueJobs({ host, dispatch, onError });

    expect(count).toBe(1);
    expect(host.failAttempt).toHaveBeenCalledWith("j1", "boom");
    expect(host.complete).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(job, expect.any(Error));
  });

  it("aborts the handler's signal after the per-job timeout", async () => {
    const host = hostWith();
    let observedSignal: AbortSignal | undefined;
    const dispatch = vi.fn(async (_t, _p, run) => {
      observedSignal = run.signal;
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    await processDueJobs({ host, dispatch, perJobTimeoutMs: 5 });

    expect(observedSignal?.aborted).toBe(true);
  });

  it("processes nothing when nothing is due", async () => {
    const host = hostWith({ claimDue: vi.fn(async () => []) });
    const dispatch = vi.fn();

    expect(await processDueJobs({ host, dispatch })).toBe(0);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
