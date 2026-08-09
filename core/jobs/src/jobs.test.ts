import { describe, expect, it, vi } from "vitest";

import { createJobsCapability } from "./jobs";
import type { JobsHost, JobStatus } from "./host";

const scope = { pluginId: "explorer", teamId: "t1", repositoryId: "r1" };

function hostWith(overrides: Partial<JobsHost> = {}): JobsHost {
  return {
    enqueue: vi.fn(async () => ({ id: "j1", runAfter: new Date(0) })),
    cancel: vi.fn(async () => {}),
    status: vi.fn(async (): Promise<JobStatus> => "pending"),
    ...overrides,
  };
}

describe("createJobsCapability", () => {
  it("enqueues with the capability's captured scope, not caller-supplied values", async () => {
    const host = hostWith();
    const jobs = createJobsCapability(host, scope);

    const ref = await jobs.enqueue(
      "qa-agent.crawl",
      { url: "/x" },
      {
        delayMs: 5000,
        dedupeKey: "crawl-r1",
        maxAttempts: 5,
      },
    );

    expect(host.enqueue).toHaveBeenCalledWith({
      callerPluginId: "explorer",
      type: "qa-agent.crawl",
      payload: { url: "/x" },
      teamId: "t1",
      repositoryId: "r1",
      delayMs: 5000,
      dedupeKey: "crawl-r1",
      maxAttempts: 5,
    });
    expect(ref).toEqual({
      id: "j1",
      type: "qa-agent.crawl",
      runAfter: new Date(0),
    });
  });

  it("delegates cancel and status", async () => {
    const host = hostWith({
      status: vi.fn(async (): Promise<JobStatus> => "done"),
    });
    const jobs = createJobsCapability(host, scope);

    await jobs.cancel("j1");
    expect(host.cancel).toHaveBeenCalledWith("j1");
    expect(await jobs.status("j1")).toBe("done");
  });
});
