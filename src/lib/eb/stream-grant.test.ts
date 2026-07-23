import { execFileSync } from "node:child_process";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  signStreamGrant,
  verifyStreamGrant,
  getStreamGrantKey,
} from "@/lib/eb/stream-grant";

const ENV_KEYS = [
  "ENCRYPTION_KEY",
  "SYSTEM_EB_TOKEN",
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
    const grant = signStreamGrant("10.42.0.7", 9223, "sess-1");
    expect(grant).toBeTruthy();
    expect(verifyStreamGrant(grant)).toMatchObject({
      h: "10.42.0.7",
      p: 9223,
      s: "sess-1",
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

  it("accepts a grant this module signed and routes to its target", () => {
    const grant = signStreamGrant("10.42.0.7", 9223, "sess-1")!;
    const out = inProxy(grant, `g=${encodeURIComponent(grant)}&token=abc`) as {
      verified: { h: string; p: number };
      parsed: { host: string; port: number; path: string; reject?: unknown };
    };

    expect(out.verified).toMatchObject({ h: "10.42.0.7", p: 9223 });
    expect(out.parsed.reject).toBeUndefined();
    expect(out.parsed.host).toBe("10.42.0.7");
    expect(out.parsed.port).toBe(9223);
    // The grant is stripped; the EB's own stream token is forwarded upstream.
    expect(out.parsed.path).toBe("/?token=abc");
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
