import pino from "pino";
import { describe, expect, it } from "vitest";
import { VaultRequestError } from "./errors";
import { vaultHeaders } from "./fetch-mock";
import { parseBurstHeaders } from "./http";
import { API, authRoutes, failureBody, makeTestClient } from "./test-support";
import { VaultApiError } from "./types";

function collectLogger() {
  const lines: string[] = [];
  const logger = pino(
    { level: "debug" },
    { write: (s: string) => lines.push(s) },
  );
  return { logger: logger.child({ scope: "Vault" }), lines };
}

describe("VaultHttp headers & url", () => {
  it("stamps Authorization (raw session id), ClientID, ReferenceId and Accept", async () => {
    const t = makeTestClient([
      ...authRoutes(),
      {
        method: "GET",
        path: `${API}/limits`,
        body: { responseStatus: "SUCCESS", records_per_object: {} },
      },
    ]);
    await t.client.authenticate();
    t.client.setReferenceId("run-1:account:7");
    await t.client.limits!();
    const call = t.fetch.calls.at(-1)!;
    expect(call.headers.authorization).toBe("SESSION-1");
    expect(call.headers["x-vaultapi-clientid"]).toBe(
      "acme-crm-veeva-migration-client-test",
    );
    expect(call.headers["x-vaultapi-referenceid"]).toBe("run-1:account:7");
    expect(call.headers.accept).toBe("application/json");
    // the auth call itself carries no Authorization but does carry the client id
    expect(t.fetch.calls[0].headers.authorization).toBeUndefined();
    expect(t.fetch.calls[0].headers["x-vaultapi-clientid"]).toBe(
      "acme-crm-veeva-migration-client-test",
    );
  });

  it("resolves relative, absolute and full urls with query strings", () => {
    const { client } = makeTestClient();
    expect(client.http.resolveUrl({ path: "/query" })).toBe(
      `https://acme-crm.veevavault.com${API}/query`,
    );
    expect(
      client.http.resolveUrl({ path: "/api/mdl/execute", absolute: true }),
    ).toBe("https://acme-crm.veevavault.com/api/mdl/execute");
    expect(
      client.http.resolveUrl({ path: "https://login.veevavault.com/x" }),
    ).toBe("https://login.veevavault.com/x");
    expect(
      client.http.resolveUrl({
        path: "/vobjects/a__v",
        query: { idParam: "legacy_crm_id__v", x: undefined },
      }),
    ).toBe(
      `https://acme-crm.veevavault.com${API}/vobjects/a__v?idParam=legacy_crm_id__v`,
    );
    expect(
      client.http.resolveUrl({
        path: "/api/v26.2/query/abc?pagesize=1000",
        absolute: true,
        query: { a: 1 },
      }),
    ).toBe(
      "https://acme-crm.veevavault.com/api/v26.2/query/abc?pagesize=1000&a=1",
    );
  });

  it("refuses to send an authenticated call before authenticate()", async () => {
    const t = makeTestClient([]);
    await expect(t.client.limits!()).rejects.toMatchObject({
      type: "INVALID_SESSION_ID",
    });
    expect(t.fetch.calls).toHaveLength(0);
  });
});

describe("responseStatus branching (HTTP 200 with FAILURE)", () => {
  it("throws a classified VaultRequestError (instanceof VaultApiError) and does not retry structural errors", async () => {
    const t = makeTestClient([
      ...authRoutes(),
      {
        method: "GET",
        path: `${API}/limits`,
        body: failureBody("INVALID_DATA", "Unknown column"),
      },
    ]);
    await t.client.authenticate();
    let err: unknown;
    try {
      await t.client.limits!();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(VaultApiError);
    expect(err).toBeInstanceOf(VaultRequestError);
    const e = err as VaultRequestError;
    expect(e.type).toBe("INVALID_DATA");
    expect(e.status).toBe("FAILURE");
    expect(e.errorClass).toBe("structural");
    expect(e.httpStatus).toBe(200);
    expect(e.executionId).toBe("exec-1");
    expect(e.errors).toEqual([
      { type: "INVALID_DATA", message: "Unknown column" },
    ]);
    expect(t.sleeps).toEqual([]);
    expect(
      t.fetch.calls.filter((c) => c.pathname.endsWith("/limits")),
    ).toHaveLength(1);
  });

  it("treats permission errors as fatal for the call (no retry) with startsWith matching", async () => {
    const t = makeTestClient([
      ...authRoutes(),
      {
        method: "GET",
        path: `${API}/limits`,
        body: failureBody("INSUFFICIENT_ACCESS_ON_OBJECT"),
      },
    ]);
    await t.client.authenticate();
    await expect(t.client.limits!()).rejects.toMatchObject({
      errorClass: "permission",
    });
    expect(t.sleeps).toEqual([]);
  });

  it("returns WARNING envelopes as success", async () => {
    const t = makeTestClient([
      ...authRoutes(),
      {
        method: "GET",
        path: `${API}/limits`,
        body: {
          responseStatus: "WARNING",
          warnings: [{ type: "X", message: "y" }],
          a: 1,
        },
      },
    ]);
    await t.client.authenticate();
    await expect(t.client.limits!()).resolves.toEqual({ a: 1 });
  });

  it("allowFailure returns the envelope instead of throwing", async () => {
    const t = makeTestClient([
      ...authRoutes(),
      { method: "GET", path: `${API}/x`, body: failureBody("MALFORMED_URL") },
    ]);
    await t.client.authenticate();
    const res = await t.client.http.request({
      method: "GET",
      path: "/x",
      allowFailure: true,
    });
    expect(res.responseStatus).toBe("FAILURE");
  });
});

describe("session replay", () => {
  it("re-authenticates once on INVALID_SESSION_ID and replays the request once", async () => {
    const t = makeTestClient([
      ...authRoutes(),
      {
        method: "GET",
        path: `${API}/limits`,
        body: failureBody("INVALID_SESSION_ID"),
      },
      {
        method: "GET",
        path: `${API}/limits`,
        body: { responseStatus: "SUCCESS", ok: true },
      },
    ]);
    await t.client.authenticate();
    const authCallsBefore = t.fetch.calls.filter((c) =>
      c.pathname.endsWith("/auth"),
    ).length;
    await expect(t.client.limits!()).resolves.toEqual({ ok: true });
    expect(
      t.fetch.calls.filter((c) => c.pathname.endsWith("/auth")),
    ).toHaveLength(authCallsBefore + 1);
    expect(
      t.fetch.calls.filter((c) => c.pathname.endsWith("/limits")),
    ).toHaveLength(2);
    expect(t.sleeps).toEqual([]); // session errors are not backed off
  });

  it("gives up after one replay (no re-auth loop)", async () => {
    const t = makeTestClient([
      ...authRoutes(),
      {
        method: "GET",
        path: `${API}/limits`,
        body: failureBody("INVALID_SESSION_ID"),
        persist: true,
      },
    ]);
    await t.client.authenticate();
    await expect(t.client.limits!()).rejects.toMatchObject({
      type: "INVALID_SESSION_ID",
      errorClass: "session",
    });
    expect(
      t.fetch.calls.filter((c) => c.pathname.endsWith("/limits")),
    ).toHaveLength(2);
  });

  it("maps HTTP 401 without an envelope to a session error", async () => {
    const t = makeTestClient([
      ...authRoutes(),
      {
        method: "GET",
        path: `${API}/limits`,
        status: 401,
        body: "Unauthorized",
      },
      {
        method: "GET",
        path: `${API}/limits`,
        body: { responseStatus: "SUCCESS", ok: true },
      },
    ]);
    await t.client.authenticate();
    await expect(t.client.limits!()).resolves.toEqual({ ok: true });
  });
});

describe("retry with jitter", () => {
  it("retries EXCEPTION / API_LIMIT_EXCEEDED / 503 / socket errors with full-jitter backoff", async () => {
    const t = makeTestClient([
      ...authRoutes(),
      {
        method: "GET",
        path: `${API}/limits`,
        body: {
          responseStatus: "EXCEPTION",
          errors: [{ type: "UNEXPECTED_ERROR", message: "boom" }],
        },
      },
      {
        method: "GET",
        path: `${API}/limits`,
        body: failureBody("API_LIMIT_EXCEEDED"),
      },
      { method: "GET", path: `${API}/limits`, status: 503, body: "" },
      {
        method: "GET",
        path: `${API}/limits`,
        throws: new TypeError("fetch failed"),
      },
      {
        method: "GET",
        path: `${API}/limits`,
        body: { responseStatus: "SUCCESS", ok: true },
      },
    ]);
    await t.client.authenticate();
    await expect(t.client.limits!()).resolves.toEqual({ ok: true });
    // random() = 0.5 → 0.5 × min(cap, 2000 × 2^(attempt-1))
    expect(t.sleeps).toEqual([1000, 2000, 4000, 8000]);
  });

  it("honours Retry-After (seconds) when larger than the computed delay", async () => {
    const t = makeTestClient([
      ...authRoutes(),
      {
        method: "GET",
        path: `${API}/limits`,
        status: 429,
        headers: { ...vaultHeaders(), "Retry-After": "7" },
        body: "",
      },
      {
        method: "GET",
        path: `${API}/limits`,
        body: { responseStatus: "SUCCESS", ok: true },
      },
    ]);
    await t.client.authenticate();
    await t.client.limits!();
    expect(t.sleeps).toEqual([7000]);
  });

  it("stops after maxAttempts and rethrows the last error", async () => {
    const t = makeTestClient(
      [
        ...authRoutes(),
        {
          method: "GET",
          path: `${API}/limits`,
          body: failureBody("SERVICE_UNAVAILABLE"),
          persist: true,
        },
      ],
      { retry: { maxAttempts: 3 } },
    );
    await t.client.authenticate();
    await expect(t.client.limits!()).rejects.toMatchObject({
      type: "SERVICE_UNAVAILABLE",
      errorClass: "retryable",
    });
    expect(
      t.fetch.calls.filter((c) => c.pathname.endsWith("/limits")),
    ).toHaveLength(3);
    expect(t.sleeps).toEqual([1000, 2000]);
  });

  it("caps the backoff ceiling at 300 s", async () => {
    const t = makeTestClient(
      [
        ...authRoutes(),
        {
          method: "GET",
          path: `${API}/limits`,
          body: failureBody("RACE_CONDITION"),
          persist: true,
        },
      ],
      { retry: { maxAttempts: 10 } },
    );
    await t.client.authenticate();
    await expect(t.client.limits!()).rejects.toMatchObject({
      type: "RACE_CONDITION",
    });
    expect(t.sleeps.at(-1)).toBe(150_000); // 0.5 × 300 000
  });
});

describe("burst headers (§2.5.2, §8.3)", () => {
  it("parses the X-VaultAPI-* counters", () => {
    const h = new Headers(
      vaultHeaders({
        "X-VaultAPI-BurstLimitRemaining": "42",
        "X-VaultAPI-ResponseDelay": "500",
      }),
    );
    expect(parseBurstHeaders(h, Date.UTC(2026, 0, 1))).toEqual({
      burstLimit: 2000,
      burstLimitRemaining: 42,
      responseDelayMs: 500,
      executionId: "exec-1",
      observedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("exposes the last response's counters on client.burst", async () => {
    const t = makeTestClient([
      ...authRoutes(),
      {
        method: "GET",
        path: `${API}/limits`,
        headers: vaultHeaders({ "X-VaultAPI-BurstLimitRemaining": "1500" }),
        body: { responseStatus: "SUCCESS" },
      },
    ]);
    await t.client.authenticate();
    await t.client.limits!();
    expect(t.client.burst.burstLimitRemaining).toBe(1500);
    expect(t.client.burst.burstLimit).toBe(2000);
  });

  it("pauses until the 5-minute window rolls when BurstLimitRemaining < burstFloor", async () => {
    const t = makeTestClient(
      [
        ...authRoutes(),
        {
          method: "GET",
          path: `${API}/limits`,
          headers: vaultHeaders({ "X-VaultAPI-BurstLimitRemaining": "150" }),
          body: { responseStatus: "SUCCESS" },
        },
        {
          method: "GET",
          path: `${API}/limits`,
          headers: vaultHeaders({ "X-VaultAPI-BurstLimitRemaining": "1990" }),
          body: { responseStatus: "SUCCESS" },
        },
        {
          method: "GET",
          path: `${API}/limits`,
          headers: vaultHeaders({ "X-VaultAPI-BurstLimitRemaining": "1989" }),
          body: { responseStatus: "SUCCESS" },
        },
      ],
      { burstFloor: 200 },
    );
    await t.client.authenticate();
    t.clock.set(Date.UTC(2026, 8, 7, 12, 1, 30)); // 90 s into the window
    await t.client.limits!(); // response says 150 remaining
    expect(t.sleeps).toEqual([]);
    await t.client.limits!(); // must pause first: 300 000 − 90 000 + 1 000
    expect(t.sleeps).toEqual([211_000]);
    expect(t.client.http.burstPauses).toBe(1);
    await t.client.limits!(); // refreshed counter, no pause
    expect(t.sleeps).toEqual([211_000]);
  });

  it("does not pause at or above the floor", async () => {
    const t = makeTestClient(
      [
        ...authRoutes(),
        {
          method: "GET",
          path: `${API}/limits`,
          headers: vaultHeaders({ "X-VaultAPI-BurstLimitRemaining": "200" }),
          body: { responseStatus: "SUCCESS" },
          persist: true,
        },
      ],
      { burstFloor: 200 },
    );
    await t.client.authenticate();
    await t.client.limits!();
    await t.client.limits!();
    expect(t.sleeps).toEqual([]);
  });

  it("logs X-VaultAPI-ResponseDelay > 0 as a warning", async () => {
    const { logger, lines } = collectLogger();
    const t = makeTestClient(
      [
        ...authRoutes(),
        {
          method: "GET",
          path: `${API}/limits`,
          headers: vaultHeaders({ "X-VaultAPI-ResponseDelay": "500" }),
          body: { responseStatus: "SUCCESS" },
        },
      ],
      { logger },
    );
    await t.client.authenticate();
    await t.client.limits!();
    const warn = lines
      .map((l) => JSON.parse(l))
      .find((r) => r.code === "VT_RESPONSE_DELAY");
    expect(warn).toMatchObject({ level: 40, response_delay_ms: 500 });
  });

  it("pauses for the announced downtime + 1 min, then re-authenticates before the next call", async () => {
    let downtime: { minutes: number; pauseMs: number } | undefined;
    const t = makeTestClient(
      [
        ...authRoutes(),
        {
          method: "GET",
          path: `${API}/limits`,
          headers: vaultHeaders({
            "X-VaultAPI-DowntimeExpectedDurationMinutes": "3",
          }),
          body: { responseStatus: "SUCCESS" },
        },
        {
          method: "GET",
          path: `${API}/limits`,
          body: { responseStatus: "SUCCESS" },
        },
      ],
      { hooks: { onDowntime: (i) => void (downtime = i) } },
    );
    await t.client.authenticate();
    const authsBefore = t.fetch.calls.filter((c) =>
      c.pathname.endsWith("/auth"),
    ).length;
    await t.client.limits!(); // in-flight call completes
    expect(downtime).toEqual({ minutes: 3, pauseMs: 240_000 });
    expect(t.sleeps).toEqual([]);
    await t.client.limits!();
    expect(t.sleeps).toEqual([240_000]);
    expect(
      t.fetch.calls.filter((c) => c.pathname.endsWith("/auth")),
    ).toHaveLength(authsBefore + 1);
    expect(t.client.http.downtimePauses).toBe(1);
  });
});
