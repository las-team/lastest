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

describe("auth flow never re-enters itself (§2.5.1 / §8.1: re-auth once, else fatal)", () => {
  it("accessToken: an invalid token fails users/me with INVALID_SESSION_ID after exactly one call (no hang)", async () => {
    const t = makeTestClient(
      [
        {
          method: "GET",
          path: `${API}/objects/users/me`,
          body: failureBody("INVALID_SESSION_ID", "expired token"),
          persist: true,
        },
      ],
      { auth: { kind: "accessToken", token: "EXPIRED" }, vaultId: 1001 },
    );
    await expect(t.client.authenticate()).rejects.toMatchObject({
      type: "INVALID_SESSION_ID",
    });
    expect(t.fetch.calls).toHaveLength(1);
    expect(t.client.session).toBeUndefined();
    expect(t.client.auth.user).toBeUndefined();
  });

  it("password: users/me rejecting the fresh session fails auth after one auth attempt (no replay, no hang)", async () => {
    const t = makeTestClient([
      { method: "POST", path: `${API}/auth`, body: authBody(), persist: true },
      {
        method: "GET",
        path: `${API}/objects/users/me`,
        body: failureBody("INVALID_SESSION_ID"),
        persist: true,
      },
    ]);
    await expect(t.client.authenticate()).rejects.toMatchObject({
      type: "INVALID_SESSION_ID",
    });
    expect(
      t.fetch.calls.filter((c) => c.pathname.endsWith("/auth")),
    ).toHaveLength(1);
    expect(t.fetch.calls).toHaveLength(2);
    expect(t.client.session).toBeUndefined();
  });

  it("a re-entrant reauthenticate() from inside the auth flow throws instead of awaiting itself", async () => {
    const t = makeTestClient([
      { method: "POST", path: `${API}/auth`, body: authBody(), persist: true },
    ]);
    let inner: Promise<unknown> | undefined;
    t.fetch.add({
      method: "GET",
      path: `${API}/objects/users/me`,
      persist: true,
      handler: () => {
        inner = t.client.auth.reauthenticate();
        inner.catch(() => undefined);
        return { body: meBody() };
      },
    });
    await expect(t.client.authenticate()).resolves.toMatchObject({
      sessionId: "SESSION-1",
    });
    await expect(inner).rejects.toMatchObject({
      type: "INVALID_SESSION_ID",
      errorClass: "fatal",
    });
    expect(
      t.fetch.calls.filter((c) => c.pathname.endsWith("/auth")),
    ).toHaveLength(1);
  });
});

describe("session is committed only after users/me validates it", () => {
  it("a non-session users/me failure leaves no cached session; the next authenticate() re-runs the full flow", async () => {
    const t = makeTestClient([
      { method: "POST", path: `${API}/auth`, body: authBody(), persist: true },
      {
        method: "GET",
        path: `${API}/objects/users/me`,
        body: failureBody("INSUFFICIENT_ACCESS"),
      },
      { method: "GET", path: `${API}/objects/users/me`, body: meBody() },
    ]);
    await expect(t.client.authenticate()).rejects.toMatchObject({
      type: "INSUFFICIENT_ACCESS",
    });
    expect(t.client.session).toBeUndefined();
    expect(t.client.auth.user).toBeUndefined();
    const s = await t.client.authenticate();
    expect(s.sessionId).toBe("SESSION-1");
    expect(t.client.auth.user?.id).toBe(12345);
    expect(
      t.fetch.calls.filter((c) => c.pathname.endsWith("/auth")),
    ).toHaveLength(2);
  });

  it("a failed version probe after the fallback auth does not pre-commit the session", async () => {
    const t = makeTestClient([
      {
        method: "POST",
        path: `${API}/auth`,
        body: failureBody("MALFORMED_URL", "Invalid API version"),
      },
      { method: "POST", path: "/api/v26.1/auth", body: authBody() },
      { method: "GET", path: "/api", body: failureBody("INSUFFICIENT_ACCESS") },
      {
        method: "GET",
        path: "/api/v26.1/objects/users/me",
        body: failureBody("INACTIVE_USER"),
      },
    ]);
    await expect(t.client.authenticate()).rejects.toMatchObject({
      type: "INACTIVE_USER",
    });
    expect(t.client.session).toBeUndefined();
    // GET /api and users/me carried the not-yet-committed session explicitly
    expect(
      t.fetch.calls
        .filter((c) => c.pathname === "/api" || c.pathname.endsWith("/me"))
        .every((c) => c.headers.authorization === "SESSION-1"),
    ).toBe(true);
  });
});

describe("auth burst guard (20/min)", () => {
  it("retries a retryable auth failure inside the guard, waiting a full window on API_LIMIT_EXCEEDED", async () => {
    const t = makeTestClient([
      {
        method: "POST",
        path: `${API}/auth`,
        body: failureBody("API_LIMIT_EXCEEDED", "auth burst"),
      },
      {
        method: "POST",
        path: `${API}/auth`,
        body: failureBody("API_LIMIT_EXCEEDED", "auth burst"),
      },
      ...authRoutes(),
    ]);
    await expect(t.client.authenticate()).resolves.toMatchObject({
      sessionId: "SESSION-1",
    });
    expect(
      t.fetch.calls.filter((c) => c.pathname.endsWith("/auth")),
    ).toHaveLength(3);
    // the two waits are full guard windows, not jitter
    expect(t.sleeps).toEqual([60_000, 60_000]);
  });

  it("records every retry attempt in the guard, so retries cannot exceed the limit", async () => {
    const t = makeTestClient(
      [
        { method: "POST", path: `${API}/auth`, status: 503, body: "" },
        { method: "POST", path: `${API}/auth`, status: 503, body: "" },
        ...authRoutes(),
      ],
      { authRateLimit: { max: 2, windowMs: 60_000 } },
    );
    await expect(t.client.authenticate()).resolves.toMatchObject({
      sessionId: "SESSION-1",
    });
    expect(
      t.fetch.calls.filter((c) => c.pathname.endsWith("/auth")),
    ).toHaveLength(3);
    // jitter 1 s, jitter 2 s, then the guard holds the third attempt until the
    // first one (t0) leaves the 60 s window: 60 000 − 3 000 + 1
    expect(t.sleeps).toEqual([1000, 2000, 57_001]);
  });

  it("backs off with jitter on other retryable auth errors and gives up after maxAttempts", async () => {
    const t = makeTestClient(
      [
        {
          method: "POST",
          path: `${API}/auth`,
          status: 503,
          body: "",
          persist: true,
        },
      ],
      { retry: { maxAttempts: 3 } },
    );
    await expect(t.client.authenticate()).rejects.toMatchObject({
      type: "SERVICE_UNAVAILABLE",
      errorClass: "retryable",
    });
    expect(t.fetch.calls).toHaveLength(3);
    expect(t.sleeps).toEqual([1000, 2000]);
    expect(t.client.auth.authCallsInWindow).toBe(3);
  });

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
