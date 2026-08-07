import { execFileSync } from "node:child_process";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  signStreamGrant,
  verifyStreamGrant,
  getStreamGrantKey,
} from "@/lib/eb/stream-grant";
import { deriveStreamAuthToken } from "@lastest/pool-service/common";

const ENV_KEYS = [
  "ENCRYPTION_KEY",
  "SYSTEM_EB_TOKEN",
  "STREAM_AUTH_TOKEN",
  "EB_STREAM_GRANT_TTL_SECONDS",
] as const;

/** 32 bytes hex — same shape @/lib/crypto requires. */
const TEST_ENCRYPTION_KEY = "a".repeat(64);

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
});

describe("stream grant round-trip", () => {
  it("recovers the server-selected target", () => {
    const grant = signStreamGrant("10.42.0.7", 9223, "sess-1", "eb-1-abc");
    expect(grant).toBeTruthy();
    expect(verifyStreamGrant(grant)).toMatchObject({
      h: "10.42.0.7",
      p: 9223,
      s: "sess-1",
      i: "eb-1-abc",
    });
  });

  it("produces a URL-safe token (survives a query string untouched)", () => {
    const grant = signStreamGrant("10.42.0.7", 9223, "sess-1")!;
    expect(grant).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(new URLSearchParams(`g=${grant}`).get("g")).toBe(grant);
  });
});

describe("target integrity — the SSRF cases", () => {
  it("rejects a payload edited to point at another host", () => {
    const grant = signStreamGrant("10.42.0.7", 9223, "sess-1")!;
    const [encoded, sig] = grant.split(".");
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString());

    payload.h = "169.254.169.254";
    payload.p = 80;
    const forged =
      Buffer.from(JSON.stringify(payload)).toString("base64url") + "." + sig;

    expect(verifyStreamGrant(forged)).toBeNull();
  });

  it("rejects a grant signed with a different key", () => {
    process.env.ENCRYPTION_KEY = "b".repeat(64);
    const forged = signStreamGrant("169.254.169.254", 80, "")!;
    process.env.ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;

    expect(verifyStreamGrant(forged)).toBeNull();
  });

  it("rejects unsigned, malformed and empty input", () => {
    for (const bad of [
      null,
      undefined,
      "",
      "10.42.0.7:9223",
      "notbase64.notasig",
      ".",
      "abc.",
      ".abc",
    ]) {
      expect(verifyStreamGrant(bad as string | null)).toBeNull();
    }
  });

  it("rejects an out-of-range port even when correctly signed", () => {
    // Guards net.connect() against a malformed payload from a format change.
    const grant = signStreamGrant("10.42.0.7", 70000, "")!;
    expect(verifyStreamGrant(grant)).toBeNull();
  });
});

describe("expiry", () => {
  it("rejects an expired grant", () => {
    process.env.EB_STREAM_GRANT_TTL_SECONDS = "1";
    const grant = signStreamGrant("10.42.0.7", 9223, "sess-1")!;
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 5_000);
    expect(verifyStreamGrant(grant)).toBeNull();
  });
});

describe("front-proxy.js stays byte-compatible", () => {
  // The front proxy is a dependency-free script with no TS loader, so it
  // carries its own copy of the verifier. Drift between the two would silently
  // break streaming (or worse, accept something this module rejects), so
  // cross-check the real file. Run in a child process so its module scope
  // (env-derived key) is isolated from this one.
  function inProxy(
    grant: string | null,
    query: string,
    env: Record<string, string> = { ENCRYPTION_KEY: TEST_ENCRYPTION_KEY },
  ): unknown {
    const script = `
      const p = require(${JSON.stringify(
        new URL("../../../scripts/front-proxy.js", import.meta.url).pathname,
      )});
      const grant = ${JSON.stringify(grant)};
      process.stdout.write(JSON.stringify({
        verified: p.verifyStreamGrant(grant),
        parsed: p.parseTarget("/api/embedded/stream/ws?" + ${JSON.stringify(query)}),
      }));
    `;
    const childEnv = { ...process.env };
    for (const k of ENV_KEYS) delete childEnv[k];
    return JSON.parse(
      execFileSync(process.execPath, ["-e", script], {
        encoding: "utf8",
        env: { ...childEnv, ...env },
      }),
    );
  }

  type Parsed = {
    host: string;
    port: number;
    path: string;
    streamToken: string;
    reject?: { code: number };
  };

  it("accepts a grant this module signed and routes to its target", () => {
    const grant = signStreamGrant("10.42.0.7", 9223, "sess-1", "eb-1-abc")!;
    const out = inProxy(
      grant,
      `g=${encodeURIComponent(grant)}&token=abc&bin=1`,
    ) as { verified: { h: string; p: number }; parsed: Parsed };

    expect(out.verified).toMatchObject({ h: "10.42.0.7", p: 9223 });
    expect(out.parsed.reject).toBeUndefined();
    expect(out.parsed.host).toBe("10.42.0.7");
    expect(out.parsed.port).toBe(9223);
    // Grant and token are both stripped from the forwarded request line; the
    // credential rides upstream as x-stream-token. Other params pass through.
    expect(out.parsed.path).toBe("/?bin=1");
  });

  it("derives the pod's stream token from the grant, ignoring any ?token=", () => {
    // The whole point of the scheme: what the client sent is irrelevant, the
    // proxy reconstructs the credential the pool service injected.
    const grant = signStreamGrant("10.42.0.7", 9223, "sess-1", "eb-1-abc")!;
    const out = inProxy(
      grant,
      `g=${encodeURIComponent(grant)}&token=attacker-supplied`,
    ) as { parsed: Parsed };

    expect(out.parsed.streamToken).toBe(deriveStreamAuthToken("eb-1-abc"));
    expect(out.parsed.streamToken).not.toBe("attacker-supplied");
  });

  it("binds the derived token to the instance — one pod's token opens no other", () => {
    expect(deriveStreamAuthToken("eb-1-abc")).not.toBe(
      deriveStreamAuthToken("eb-2-def"),
    );
  });

  it("falls back to the proxy's own STREAM_AUTH_TOKEN for static fleets", () => {
    // A static-fleet EB has no provisioner-assigned instanceId, so the grant
    // carries none and the shared env secret is the only credential available.
    const grant = signStreamGrant("10.42.0.7", 9223, "sess-1")!;
    const out = inProxy(grant, `g=${encodeURIComponent(grant)}`, {
      ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
      STREAM_AUTH_TOKEN: "fleet-wide-secret",
    }) as { parsed: Parsed };

    expect(out.parsed.streamToken).toBe("fleet-wide-secret");
  });

  it("rejects a grant when the proxy has a different key", () => {
    const grant = signStreamGrant("10.42.0.7", 9223, "sess-1")!;
    const out = inProxy(grant, `g=${encodeURIComponent(grant)}`, {
      ENCRYPTION_KEY: "b".repeat(64),
    }) as { verified: unknown; parsed: { reject?: { code: number } } };

    expect(out.verified).toBeNull();
    expect(out.parsed.reject?.code).toBe(403);
  });

  it("refuses the old ?target= form outright", () => {
    const out = inProxy(null, "target=169.254.169.254%3A80") as {
      parsed: { reject?: { code: number }; host?: string };
    };
    expect(out.parsed.reject?.code).toBe(403);
    expect(out.parsed.host).toBeUndefined();
  });
});

describe("key resolution", () => {
  it("derives from ENCRYPTION_KEY with no extra configuration", () => {
    const grant = signStreamGrant("10.42.0.7", 9223, "sess-1");
    expect(grant).toBeTruthy();
    expect(verifyStreamGrant(grant)).toMatchObject({ h: "10.42.0.7" });
  });

  it("never uses ENCRYPTION_KEY raw", () => {
    // Domain separation: the grant key must be a derivation, so an HMAC made
    // with the raw key is not a valid grant signature.
    const key = getStreamGrantKey()!;
    expect(key.equals(Buffer.from(TEST_ENCRYPTION_KEY, "hex"))).toBe(false);
  });

  it("ignores SYSTEM_EB_TOKEN — it is distributed to EB pods", () => {
    // Regression guard. Keying on a credential the provisioner inlines into
    // every Job spec would let anyone who can read a pod's env mint grants.
    delete process.env.ENCRYPTION_KEY;
    process.env.SYSTEM_EB_TOKEN = "eb-facing-token";
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(getStreamGrantKey()).toBeNull();
    expect(signStreamGrant("10.42.0.7", 9223)).toBeNull();
  });

  it("fails closed on a malformed or absent ENCRYPTION_KEY", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    for (const bad of [undefined, "", "not-hex", "abc123"]) {
      if (bad === undefined) delete process.env.ENCRYPTION_KEY;
      else process.env.ENCRYPTION_KEY = bad;
      expect(getStreamGrantKey()).toBeNull();
      expect(signStreamGrant("10.42.0.7", 9223)).toBeNull();
    }
  });
});
