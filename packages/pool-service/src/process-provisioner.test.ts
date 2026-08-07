import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  launchEBProcess,
  terminateEBProcess,
  listEBProcessNames,
  getEBProcessInfo,
  resolveEBEntry,
} from "./process-provisioner";

const TEST_KEY = "c".repeat(64);

// Stub EB entry: prints a marker plus the env the provisioner is supposed to
// inject (and must NOT inject), then idles until SIGTERM.
const STUB = `
console.log("stub-eb-started instance=" + process.env.INSTANCE_ID +
  " stream=" + process.env.STREAM_PORT +
  " cdp=" + process.env.CDP_PORT +
  " host=" + process.env.STREAM_HOST +
  " token=" + (process.env.EB_BOOTSTRAP_TOKEN ? "yes" : "no") +
  " dburl=" + (process.env.DATABASE_URL ? "LEAKED" : "absent") +
  " enckey=" + (process.env.ENCRYPTION_KEY ? "LEAKED" : "absent"));
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
    EB_PROCESS_ENTRY: process.env.EB_PROCESS_ENTRY,
    EB_PROCESS_PORT_BASE: process.env.EB_PROCESS_PORT_BASE,
    DATABASE_URL: process.env.DATABASE_URL,
  };
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "eb-proc-test-"));
  const entry = path.join(tmpDir, "stub-eb.js");
  fs.writeFileSync(entry, STUB);
  process.env.ENCRYPTION_KEY = TEST_KEY;
  process.env.EB_PROCESS_ENTRY = entry;
  // High base to dodge anything the dev machine has open.
  process.env.EB_PROCESS_PORT_BASE = "42300";
  process.env.DATABASE_URL = "postgresql://secret@example/db";
});

afterEach(async () => {
  for (const name of listEBProcessNames()) await terminateEBProcess(name);
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("resolveEBEntry", () => {
  it("prefers EB_PROCESS_ENTRY when set", () => {
    const entry = resolveEBEntry();
    expect(entry.args[0]).toBe(process.env.EB_PROCESS_ENTRY);
    expect(entry.command).toBe(process.execPath);
  });

  it("falls back to the dev checkout sources via tsx", () => {
    delete process.env.EB_PROCESS_ENTRY;
    const entry = resolveEBEntry();
    expect(entry.command).toMatch(/tsx$/);
    expect(entry.args[0]).toMatch(/embedded-browser[/\\]src[/\\]index\.ts$/);
  });

  it("throws on a missing explicit entry", () => {
    process.env.EB_PROCESS_ENTRY = path.join(tmpDir, "nope.js");
    expect(() => resolveEBEntry()).toThrow(/does not exist/);
  });
});

describe("EB process lifecycle", () => {
  it("spawns, reports Running with injected env, and terminates cleanly", async () => {
    const id = "eb-test01-abc123";
    await launchEBProcess(id);
    expect(listEBProcessNames().has(id)).toBe(true);

    await waitFor(() =>
      (getEBProcessInfo(id)?.logs ?? "").includes("stub-eb-started"),
    );
    const info = getEBProcessInfo(id)!;
    expect(info.phase).toBe("Running");
    expect(info.logs).toContain(`instance=${id}`);
    expect(info.logs).toContain("host=127.0.0.1");
    expect(info.logs).toContain("token=yes");
    // stream=P, cdp=P+2 from the same block
    const m = info.logs.match(/stream=(\d+) cdp=(\d+)/)!;
    expect(parseInt(m[2]!, 10)).toBe(parseInt(m[1]!, 10) + 2);
    // The pool service's secrets must not reach the child.
    expect(info.logs).toContain("dburl=absent");
    expect(info.logs).toContain("enckey=absent");
    expect(info.logs).not.toContain("LEAKED");

    await terminateEBProcess(id);
    await waitFor(() => getEBProcessInfo(id)?.phase !== "Running");
    expect(getEBProcessInfo(id)!.phase).toBe("Succeeded");
    expect(listEBProcessNames().has(id)).toBe(false);
  });

  it("gives concurrent instances distinct port blocks", async () => {
    const ids = ["eb-test02-aaa111", "eb-test03-bbb222"];
    await Promise.all(ids.map((id) => launchEBProcess(id)));
    await Promise.all(
      ids.map((id) =>
        waitFor(() =>
          (getEBProcessInfo(id)?.logs ?? "").includes("stub-eb-started"),
        ),
      ),
    );
    const streams = ids.map(
      (id) => getEBProcessInfo(id)!.logs.match(/stream=(\d+)/)![1],
    );
    expect(new Set(streams).size).toBe(2);
  });

  it("fails closed without a usable ENCRYPTION_KEY", async () => {
    process.env.ENCRYPTION_KEY = "not-hex";
    await expect(launchEBProcess("eb-test04-ccc333")).rejects.toThrow(
      /ENCRYPTION_KEY/,
    );
  });
});
