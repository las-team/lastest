import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mintLoopbackGrant,
  verifyLoopbackGrant,
  LOOPBACK_GRANT_PREFIX,
} from "./loopback-grant";

const KEY_A = "a".repeat(64);
const KEY_B = "b".repeat(64);

describe("mcp loopback grant", () => {
  const original = process.env.ENCRYPTION_KEY;
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = KEY_A;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = original;
  });

  it("round-trips the user and client", () => {
    const grant = mintLoopbackGrant("user-1", "client-1")!;
    expect(grant.startsWith(LOOPBACK_GRANT_PREFIX)).toBe(true);
    expect(verifyLoopbackGrant(grant)).toMatchObject({
      u: "user-1",
      c: "client-1",
    });
  });

  it("rejects a tampered payload", () => {
    const grant = mintLoopbackGrant("user-1", "client-1")!;
    const [payload, sig] = grant.slice(LOOPBACK_GRANT_PREFIX.length).split(".");
    const forged = Buffer.from(
      JSON.stringify({
        u: "someone-else",
        c: "client-1",
        e: Date.now() + 1000,
      }),
    ).toString("base64url");
    expect(payload).not.toBe(forged);
    expect(
      verifyLoopbackGrant(`${LOOPBACK_GRANT_PREFIX}${forged}.${sig}`),
    ).toBeNull();
  });

  it("rejects a grant signed with a different ENCRYPTION_KEY", () => {
    const grant = mintLoopbackGrant("user-1", "client-1")!;
    process.env.ENCRYPTION_KEY = KEY_B;
    expect(verifyLoopbackGrant(grant)).toBeNull();
  });

  it("rejects an expired grant", () => {
    const grant = mintLoopbackGrant("user-1", "client-1", -1)!;
    expect(verifyLoopbackGrant(grant)).toBeNull();
  });

  it("fails closed with no usable ENCRYPTION_KEY", () => {
    const grant = mintLoopbackGrant("user-1", "client-1")!;
    delete process.env.ENCRYPTION_KEY;
    expect(mintLoopbackGrant("user-1", "client-1")).toBeNull();
    expect(verifyLoopbackGrant(grant)).toBeNull();

    process.env.ENCRYPTION_KEY = "not-hex";
    expect(mintLoopbackGrant("user-1", "client-1")).toBeNull();
  });

  it("ignores tokens that are not grants at all", () => {
    expect(verifyLoopbackGrant("some-api-key")).toBeNull();
    expect(verifyLoopbackGrant(`${LOOPBACK_GRANT_PREFIX}nonsense`)).toBeNull();
  });
});
