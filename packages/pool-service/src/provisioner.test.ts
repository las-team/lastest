import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The only DB seam left in the paths under test: poolMax() reads the global
// playwright_settings row through this module. Constant values keep the 5s
// _limitsCache harmless across tests.
vi.mock("@lastest/db/settings", () => ({
  getGlobalPoolLimits: vi.fn(async () => ({
    ebPoolMax: 30,
    ebIdleTTLSeconds: 60,
  })),
}));

import {
  AtCapacityError,
  isLiveEBJob,
  livePoolCount,
  prewarmForBuild,
  provisionOneEB,
  type K8sJobLike,
} from "./provisioner";
import { listEBProcessNames, terminateEBProcess } from "./process-provisioner";

const TEST_KEY = "c".repeat(64);

// Minimal stub EB entry: idles until SIGTERM (same shape as
// process-provisioner.test.ts — these tests exercise the capacity machinery
// through the process backend, so the child just needs to stay alive).
const STUB = `
process.on("SIGTERM", () => process.exit(0));
setInterval(() => {}, 1000);
`;

let tmpDir: string;
let saved: Record<string, string | undefined>;

async function waitFor(cond: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

beforeEach(() => {
  saved = {
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
    EB_PROVISIONER: process.env.EB_PROVISIONER,
    EB_PROCESS_ENTRY: process.env.EB_PROCESS_ENTRY,
    EB_PROCESS_PORT_BASE: process.env.EB_PROCESS_PORT_BASE,
    EB_PROCESS_POOL_MAX: process.env.EB_PROCESS_POOL_MAX,
    EB_RESERVED_INTERACTIVE_SLOTS: process.env.EB_RESERVED_INTERACTIVE_SLOTS,
    EB_LAUNCH_INTERVAL_MS: process.env.EB_LAUNCH_INTERVAL_MS,
  };
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "eb-prov-test-"));
  const entry = path.join(tmpDir, "stub-eb.js");
  fs.writeFileSync(entry, STUB);
  process.env.ENCRYPTION_KEY = TEST_KEY;
  process.env.EB_PROVISIONER = "process";
  process.env.EB_PROCESS_ENTRY = entry;
  // Distinct from process-provisioner.test.ts's 42300 so parallel suites
  // don't fight over port blocks.
  process.env.EB_PROCESS_PORT_BASE = "42400";
  process.env.EB_LAUNCH_INTERVAL_MS = "0"; // skip the CNI-spacing throttle
  delete process.env.EB_RESERVED_INTERACTIVE_SLOTS;
});

afterEach(async () => {
  for (const name of listEBProcessNames()) await terminateEBProcess(name);
  // Wait for exits so port blocks + the live count are clean for the next test.
  await waitFor(() => listEBProcessNames().size === 0);
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("isLiveEBJob", () => {
  it("counts a just-created Job (no status yet) as live", () => {
    expect(isLiveEBJob({})).toBe(true);
    expect(isLiveEBJob({ status: {} })).toBe(true);
    expect(isLiveEBJob({ status: { succeeded: 0, failed: 0 } })).toBe(true);
  });

  it("counts an actively-running Job as live", () => {
    // `active` isn't in the K8sJobLike slice — liveness only looks at the
    // terminal markers, so a running Job passes by not matching any of them.
    expect(isLiveEBJob({ status: { active: 1 } } as K8sJobLike)).toBe(true);
  });

  it("excludes terminal Jobs (they linger under ttlSecondsAfterFinished)", () => {
    expect(isLiveEBJob({ status: { succeeded: 1 } })).toBe(false);
    expect(isLiveEBJob({ status: { failed: 1 } })).toBe(false);
    expect(
      isLiveEBJob({ status: { completionTime: "2026-01-01T00:00:00Z" } }),
    ).toBe(false);
  });

  it("excludes Jobs marked for deletion", () => {
    expect(
      isLiveEBJob({
        metadata: { name: "eb-x", deletionTimestamp: "2026-01-01T00:00:00Z" },
      }),
    ).toBe(false);
  });
});

describe("prewarmForBuild in process mode", () => {
  it("is a no-op — a 1-test build must spawn exactly one EB via its claim", async () => {
    expect(await prewarmForBuild(3)).toBe(0);
    expect(listEBProcessNames().size).toBe(0);
  });
});

describe("provisionOneEB capacity enforcement", () => {
  it("serializes concurrent provisions and never overshoots the cap", async () => {
    process.env.EB_PROCESS_POOL_MAX = "2";
    const results = await Promise.allSettled([
      provisionOneEB("interactive"),
      provisionOneEB("interactive"),
      provisionOneEB("interactive"),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );
    expect(fulfilled).toHaveLength(2);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(AtCapacityError);
    expect(listEBProcessNames().size).toBe(2);
    expect(await livePoolCount()).toBe(2);
  });

  it("fills the last pool slot (no self-blocking off-by-one)", async () => {
    process.env.EB_PROCESS_POOL_MAX = "2";
    await provisionOneEB("interactive");
    // The old in-flight counter counted the caller's own reservation against
    // itself, so the last slot 409'd. The ledger read excludes the unit being
    // created — 1 live + cap 2 must succeed.
    await expect(provisionOneEB("interactive")).resolves.toMatchObject({
      instanceId: expect.stringMatching(/^eb-/),
    });
    expect(listEBProcessNames().size).toBe(2);
  });

  it("holds back the interactive reservation from builds only", async () => {
    process.env.EB_PROCESS_POOL_MAX = "2";
    process.env.EB_RESERVED_INTERACTIVE_SLOTS = "2";
    // Build-effective cap is 2 - 2 = 0: builds can't provision at all...
    await expect(provisionOneEB("build")).rejects.toBeInstanceOf(
      AtCapacityError,
    );
    expect(listEBProcessNames().size).toBe(0);
    // ...while interactive callers still get the full cap.
    await expect(provisionOneEB("interactive")).resolves.toBeTruthy();
    expect(listEBProcessNames().size).toBe(1);
  });
});
