import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mintBootstrapToken,
  verifyBootstrapToken,
  getBootstrapTokenKey,
  jobNameForRunnerName,
} from "./common";

const TEST_KEY = "a".repeat(64);

let savedKey: string | undefined;
beforeEach(() => {
  savedKey = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = TEST_KEY;
});
afterEach(() => {
  if (savedKey === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = savedKey;
});

describe("bootstrap tokens", () => {
  it("round-trips: a minted token verifies to its instanceId", () => {
    const token = mintBootstrapToken("eb-abc123-x1y2z3", 60_000)!;
    expect(token).toBeTruthy();
    const payload = verifyBootstrapToken(token);
    expect(payload).not.toBeNull();
    expect(payload!.i).toBe("eb-abc123-x1y2z3");
    expect(payload!.e).toBeGreaterThan(Date.now());
  });

  it("rejects a tampered payload (signature mismatch)", () => {
    const token = mintBootstrapToken("eb-abc123-x1y2z3", 60_000)!;
    const [encoded, sig] = token.split(".");
    const forged = JSON.parse(
      Buffer.from(encoded!, "base64url").toString("utf8"),
    );
    forged.i = "eb-attacker-000000";
    const forgedEncoded = Buffer.from(JSON.stringify(forged)).toString(
      "base64url",
    );
    expect(verifyBootstrapToken(`${forgedEncoded}.${sig}`)).toBeNull();
  });

  it("rejects an expired token", () => {
    const token = mintBootstrapToken("eb-abc123-x1y2z3", -1_000)!;
    expect(verifyBootstrapToken(token)).toBeNull();
  });

  it("rejects tokens signed with a different key", () => {
    const token = mintBootstrapToken("eb-abc123-x1y2z3", 60_000)!;
    process.env.ENCRYPTION_KEY = "b".repeat(64);
    expect(verifyBootstrapToken(token)).toBeNull();
  });

  it("fails closed without a usable ENCRYPTION_KEY", () => {
    process.env.ENCRYPTION_KEY = "not-hex";
    expect(getBootstrapTokenKey()).toBeNull();
    expect(mintBootstrapToken("eb-abc123-x1y2z3", 60_000)).toBeNull();
    process.env.ENCRYPTION_KEY = TEST_KEY;
    const token = mintBootstrapToken("eb-abc123-x1y2z3", 60_000)!;
    process.env.ENCRYPTION_KEY = "not-hex";
    expect(verifyBootstrapToken(token)).toBeNull();
  });

  it("rejects garbage shapes", () => {
    expect(verifyBootstrapToken(null)).toBeNull();
    expect(verifyBootstrapToken("")).toBeNull();
    expect(verifyBootstrapToken("no-dot")).toBeNull();
    expect(verifyBootstrapToken(".")).toBeNull();
    expect(verifyBootstrapToken("a.b")).toBeNull();
  });
});

describe("jobNameForRunnerName", () => {
  it("extracts provisioner-created job names only", () => {
    expect(jobNameForRunnerName("System EB-eb-abc123-x1y2z3")).toBe(
      "eb-abc123-x1y2z3",
    );
    expect(jobNameForRunnerName("System EB-eb1")).toBeNull();
    expect(jobNameForRunnerName("My Runner")).toBeNull();
  });
});
