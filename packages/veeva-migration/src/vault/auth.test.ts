import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseVersionsResponse,
  previousApiVersion,
  sessionFromAuthResponse,
  sortApiVersions,
} from "./auth";
import { authBody, meBody } from "./fetch-mock";
import {
  API,
  DNS,
  authRoutes,
  failureBody,
  makeTestClient,
} from "./test-support";

describe("password auth (§2.5.1)", () => {
  it("posts a form with username/password/vaultDNS, verifies the vault and validates users/me", async () => {
    const t = makeTestClient(authRoutes());
    const session = await t.client.authenticate();
    const auth = t.fetch.calls[0];
    expect(auth.method).toBe("POST");
    expect(auth.pathname).toBe(`${API}/auth`);
    expect(auth.headers["content-type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    expect(auth.form?.get("username")).toBe("migration@acme.com");
    expect(auth.form?.get("password")).toBe("pw");
    expect(auth.form?.get("vaultDNS")).toBe(DNS);
    expect(session).toMatchObject({
      sessionId: "SESSION-1",
      userId: 12345,
      vaultId: 1001,
      vaultDns: DNS,
      apiVersion: "v26.2",
    });
    expect(session.vaultIds).toHaveLength(2);
    // users/me right after auth, with the new session
    const me = t.fetch.calls[1];
    expect(me.pathname).toBe(`${API}/objects/users/me`);
    expect(me.headers.authorization).toBe("SESSION-1");
    expect(t.client.auth.user?.id).toBe(12345);
    expect(t.client.session).toBe(session);
  });

  it("caches the session and shares one in-flight auth between concurrent callers", async () => {
    const t = makeTestClient(authRoutes());
    const [a, b] = await Promise.all([
      t.client.authenticate(),
      t.client.authenticate(),
    ]);
    await t.client.authenticate();
    expect(a).toBe(b);
    expect(
      t.fetch.calls.filter((c) => c.pathname.endsWith("/auth")),
    ).toHaveLength(1);
  });

  it("rejects a session for a vault whose DNS differs from the configured one", async () => {
    const t = makeTestClient([
      {
        method: "POST",
        path: `${API}/auth`,
        body: authBody(DNS, { vaultId: 1002 }),
      },
    ]);
    await expect(t.client.authenticate()).rejects.toMatchObject({
      type: "VAULT_DNS_MISMATCH",
      errorClass: "fatal",
    });
    expect(t.client.session).toBeUndefined();
  });

  it("rejects when the user has no membership in the configured vault", async () => {
    const t = makeTestClient([
      {
        method: "POST",
        path: `${API}/auth`,
        body: authBody("other.veevavault.com"),
      },
    ]);
    await expect(t.client.authenticate()).rejects.toMatchObject({
      type: "VAULT_DNS_MISMATCH",
    });
  });

  it("surfaces auth FAILURE envelopes (wrong password) without retrying", async () => {
    const t = makeTestClient([
      {
        method: "POST",
        path: `${API}/auth`,
        body: failureBody("INVALID_SESSION_ID", "bad creds"),
      },
    ]);
    await expect(t.client.authenticate()).rejects.toMatchObject({
      type: "INVALID_SESSION_ID",
    });
    expect(t.fetch.calls).toHaveLength(1);
  });
});

describe("auth burst guard (20/min)", () => {
  it("waits for the window instead of exceeding the limit", async () => {
    const t = makeTestClient(authRoutes(), {
      authRateLimit: { max: 3, windowMs: 60_000 },
    });
    await t.client.auth.reauthenticate();
    await t.client.auth.reauthenticate();
    await t.client.auth.reauthenticate();
    expect(t.sleeps).toEqual([]);
    expect(t.client.auth.authCallsInWindow).toBe(3);
    await t.client.auth.reauthenticate();
    expect(t.sleeps).toEqual([60_001]);
    expect(
      t.fetch.calls.filter((c) => c.pathname.endsWith("/auth")),
    ).toHaveLength(4);
  });

  it("forgets calls outside the window", async () => {
    const t = makeTestClient(authRoutes(), {
      authRateLimit: { max: 2, windowMs: 60_000 },
    });
    await t.client.auth.reauthenticate();
    await t.client.auth.reauthenticate();
    t.clock.advance(61_000);
    await t.client.auth.reauthenticate();
    expect(t.sleeps).toEqual([]);
  });
});

describe("apiVersion fallback (§2.5.1)", () => {
  it("retries once on the previous release, lists GET /api and records versionFallback", async () => {
    const t = makeTestClient([
      {
        method: "POST",
        path: `${API}/auth`,
        body: failureBody("MALFORMED_URL", "Invalid API version"),
      },
      { method: "POST", path: "/api/v26.1/auth", body: authBody() },
      {
        method: "GET",
        path: "/api",
        body: {
          responseStatus: "SUCCESS",
          values: { "v26.1": "x", "v25.3": "y", "v25.2": "z" },
        },
      },
      { method: "GET", path: "/api/v26.1/objects/users/me", body: meBody() },
      {
        method: "GET",
        path: "/api/v26.1/limits",
        body: { responseStatus: "SUCCESS", a: 1 },
      },
    ]);
    const session = await t.client.authenticate();
    expect(session.apiVersion).toBe("v26.1");
    expect(t.client.apiVersion).toBe("v26.1");
    expect(t.client.versionFallback).toEqual({
      configured: "v26.2",
      effective: "v26.1",
      available: ["v25.2", "v25.3", "v26.1"],
    });
    // GET /api carried the session (it needs Authorization)
    const versions = t.fetch.calls.find((c) => c.pathname === "/api")!;
    expect(versions.headers.authorization).toBe("SESSION-1");
    await expect(t.client.limits!()).resolves.toEqual({ a: 1 });
  });

  it("restores the configured version and rethrows when the fallback also fails", async () => {
    const t = makeTestClient([
      { method: "POST", path: `${API}/auth`, status: 404, body: "" },
      { method: "POST", path: "/api/v26.1/auth", status: 404, body: "" },
    ]);
    await expect(t.client.authenticate()).rejects.toMatchObject({
      type: "MALFORMED_URL",
    });
    expect(t.client.apiVersion).toBe("v26.2");
    expect(t.client.versionFallback).toBeUndefined();
  });

  it("does not fall back for non-version errors", async () => {
    const t = makeTestClient([
      {
        method: "POST",
        path: `${API}/auth`,
        body: failureBody("INACTIVE_USER"),
      },
    ]);
    await expect(t.client.authenticate()).rejects.toMatchObject({
      type: "INACTIVE_USER",
    });
    expect(t.fetch.calls).toHaveLength(1);
  });

  it("computes previous releases and sorts versions", () => {
    expect(previousApiVersion("v26.2")).toBe("v26.1");
    expect(previousApiVersion("v26.1")).toBe("v25.3");
    expect(sortApiVersions(["v26.1", "v25.3", "v26.2"])).toEqual([
      "v25.3",
      "v26.1",
      "v26.2",
    ]);
    expect(parseVersionsResponse({ values: ["v26.2", "v26.1"] })).toEqual([
      "v26.1",
      "v26.2",
    ]);
  });
});

describe("other credential kinds", () => {
  it("oauth: posts to login.veevavault.com/auth/oauth/session/{profile} with the IdP bearer token", async () => {
    const t = makeTestClient(
      [
        {
          method: "POST",
          path: /login\.veevavault\.com\/auth\/oauth\/session\/prof-1$/,
          body: authBody(),
        },
        { method: "GET", path: `${API}/objects/users/me`, body: meBody() },
      ],
      {
        auth: {
          kind: "oauth",
          profileId: "prof-1",
          idpToken: "IDP-TOKEN",
          clientId: "cid",
        },
      },
    );
    const s = await t.client.authenticate();
    const call = t.fetch.calls[0];
    expect(call.headers.authorization).toBe("Bearer IDP-TOKEN");
    expect(call.form?.get("vaultDNS")).toBe(DNS);
    expect(call.form?.get("client_id")).toBe("cid");
    expect(s.sessionId).toBe("SESSION-1");
    expect(t.fetch.calls[1].headers.authorization).toBe("SESSION-1");
  });

  it("accessToken: no auth call; Authorization: Bearer on every request; users/me validates", async () => {
    const t = makeTestClient(
      [
        { method: "GET", path: `${API}/objects/users/me`, body: meBody(777) },
        {
          method: "GET",
          path: `${API}/limits`,
          body: { responseStatus: "SUCCESS" },
        },
      ],
      { auth: { kind: "accessToken", token: "TOK" }, vaultId: 1001 },
    );
    const s = await t.client.authenticate();
    expect(s).toMatchObject({ userId: 777, vaultId: 1001, sessionId: "" });
    await t.client.limits!();
    expect(
      t.fetch.calls.every((c) => c.headers.authorization === "Bearer TOK"),
    ).toBe(true);
    expect(t.fetch.calls.some((c) => c.pathname.endsWith("/auth"))).toBe(false);
  });
});

describe("keep-alive & end session", () => {
  afterEach(() => vi.useRealTimers());

  it("keepAlive posts /keep-alive and endSession DELETEs /session and forgets it", async () => {
    const t = makeTestClient([
      ...authRoutes(),
      {
        method: "POST",
        path: `${API}/keep-alive`,
        body: { responseStatus: "SUCCESS" },
      },
      {
        method: "DELETE",
        path: `${API}/session`,
        body: { responseStatus: "SUCCESS" },
      },
    ]);
    await t.client.authenticate();
    await t.client.keepAlive();
    expect(t.fetch.calls.at(-1)?.pathname).toBe(`${API}/keep-alive`);
    await t.client.endSession();
    expect(t.fetch.calls.at(-1)?.method).toBe("DELETE");
    expect(t.client.session).toBeUndefined();
    await t.client.endSession(); // idempotent, no extra call
    expect(t.fetch.calls.filter((c) => c.method === "DELETE")).toHaveLength(1);
  });

  it("runs the keep-alive timer every 10 minutes until stopped", async () => {
    vi.useFakeTimers();
    const t = makeTestClient([
      ...authRoutes(),
      {
        method: "POST",
        path: `${API}/keep-alive`,
        body: { responseStatus: "SUCCESS" },
        persist: true,
      },
    ]);
    await t.client.authenticate();
    t.client.startKeepAlive();
    t.client.startKeepAlive(); // idempotent
    expect(t.client.auth.keepAliveRunning).toBe(true);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(
      t.fetch.calls.filter((c) => c.pathname.endsWith("/keep-alive")),
    ).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(
      t.fetch.calls.filter((c) => c.pathname.endsWith("/keep-alive")),
    ).toHaveLength(2);
    t.client.stopKeepAlive();
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(
      t.fetch.calls.filter((c) => c.pathname.endsWith("/keep-alive")),
    ).toHaveLength(2);
    expect(t.client.auth.keepAliveRunning).toBe(false);
  });
});

describe("sessionFromAuthResponse", () => {
  it("fills vaultId from the matching membership when the envelope lacks it", () => {
    const s = sessionFromAuthResponse(
      {
        sessionId: "s",
        userId: 1,
        vaultIds: [{ id: 5, name: "n", url: `https://${DNS}/api` }],
      },
      DNS,
      "v26.2",
    );
    expect(s.vaultId).toBe(5);
  });
  it("requires a sessionId", () => {
    expect(() =>
      sessionFromAuthResponse({ responseStatus: "SUCCESS" }, DNS, "v26.2"),
    ).toThrow(/sessionId/);
  });
});
