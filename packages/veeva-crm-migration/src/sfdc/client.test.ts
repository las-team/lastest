import { generateKeyPairSync, verify as cryptoVerify } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  buildJwtAssertion,
  createSfdcClient,
  normalizeApiVersion,
  parseLimitInfo,
  SfdcApiError,
  type SfdcAuth,
} from "./client";
import { fakeFetch, queryResult, sfdcError, type Route } from "./fake-fetch";

const INSTANCE = "https://acme.my.salesforce.com";
const LOGIN = "https://acme.my.salesforce.com";

const versionsRoute: Route = {
  match: /\/services\/data\/$/,
  reply: () => ({
    json: [
      { label: "Summer '25", url: "/services/data/v64.0", version: "64.0" },
      { label: "Winter '27", url: "/services/data/v68.0", version: "68.0" },
      { label: "Spring '26", url: "/services/data/v66.0", version: "66.0" },
    ],
  }),
};

const tokenRoute = (
  onToken?: (body: URLSearchParams, idx: number) => void,
): Route => ({
  method: "POST",
  match: "/services/oauth2/token",
  reply: (req, idx) => {
    onToken?.(new URLSearchParams(req.body ?? ""), idx);
    return {
      json: {
        access_token: `tok-${idx}`,
        instance_url: INSTANCE,
        id: "https://login.salesforce.com/id/00D000000000001EAA/005000000000001AAA",
        token_type: "Bearer",
      },
    };
  },
});

const tokenAuth: SfdcAuth = {
  kind: "token",
  instanceUrl: INSTANCE,
  accessToken: "pre-issued",
};

const noSleep = async () => {};

describe("createSfdcClient — auth flows", () => {
  it("uses a pre-issued token as-is and discovers the highest API version", async () => {
    const ff = fakeFetch([versionsRoute]);
    const client = await createSfdcClient(tokenAuth, { fetch: ff.fetch });
    expect(client.apiVersion).toBe("v68.0");
    expect(client.instanceUrl).toBe(INSTANCE);
    expect(client.requestCount).toBe(1);
    expect(ff.calls[0]!.headers.authorization).toBe("Bearer pre-issued");
    expect(ff.callsTo("/oauth2/token")).toHaveLength(0);
  });

  it("falls back to v64.0 with a warning when discovery fails", async () => {
    const logs: string[] = [];
    const ff = fakeFetch([
      {
        match: /\/services\/data\/$/,
        reply: () => ({ status: 500, text: "boom" }),
      },
    ]);
    const client = await createSfdcClient(tokenAuth, {
      fetch: ff.fetch,
      log: (m) => logs.push(m),
      sleep: noSleep,
    });
    expect(client.apiVersion).toBe("v64.0");
    expect(
      logs.some((l) => /warning: API version discovery failed/.test(l)),
    ).toBe(true);
  });

  it("skips discovery when apiVersion is given (any spelling)", async () => {
    const ff = fakeFetch([versionsRoute]);
    const client = await createSfdcClient(tokenAuth, {
      fetch: ff.fetch,
      apiVersion: "63.0",
    });
    expect(client.apiVersion).toBe("v63.0");
    expect(ff.calls).toHaveLength(0);
    expect(normalizeApiVersion("v64")).toBe("v64.0");
    expect(() => normalizeApiVersion("latest")).toThrow();
  });

  it("client_credentials: posts the form to {loginUrl}/services/oauth2/token and uses instance_url + org id", async () => {
    let seen: URLSearchParams | undefined;
    const ff = fakeFetch([tokenRoute((b) => (seen = b)), versionsRoute]);
    const client = await createSfdcClient(
      {
        kind: "client_credentials",
        loginUrl: "https://acme.my.salesforce.com/",
        clientId: "cid",
        clientSecret: "sec",
      },
      { fetch: ff.fetch },
    );
    const tokenCall = ff.callsTo("/oauth2/token")[0]!;
    expect(tokenCall.url.href).toBe(`${LOGIN}/services/oauth2/token`);
    expect(tokenCall.headers["content-type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    expect(seen!.get("grant_type")).toBe("client_credentials");
    expect(seen!.get("client_id")).toBe("cid");
    expect(seen!.get("client_secret")).toBe("sec");
    expect(client.instanceUrl).toBe(INSTANCE);
    expect(client.orgId).toBe("00D000000000001EAA");
    expect(client.requestCount).toBe(1); // token exchange is not an org API call
    expect(ff.callsTo("/services/data/")[0]!.headers.authorization).toBe(
      "Bearer tok-0",
    );
  });

  it("jwt: signs an RS256 assertion with iss/sub/aud/exp that verifies against the public key", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
    const now = new Date("2026-09-07T10:00:00Z");
    const auth: SfdcAuth = {
      kind: "jwt",
      loginUrl: "https://login.salesforce.com",
      clientId: "consumer-key",
      username: "integration@acme.com",
      privateKey: pem,
    };
    const assertion = buildJwtAssertion(auth, now);
    const [h, c, s] = assertion.split(".");
    expect(JSON.parse(Buffer.from(h!, "base64url").toString())).toEqual({
      alg: "RS256",
      typ: "JWT",
    });
    expect(JSON.parse(Buffer.from(c!, "base64url").toString())).toEqual({
      iss: "consumer-key",
      sub: "integration@acme.com",
      aud: "https://login.salesforce.com",
      exp: Math.floor(now.getTime() / 1000) + 180,
    });
    expect(
      cryptoVerify(
        "RSA-SHA256",
        Buffer.from(`${h}.${c}`),
        publicKey,
        Buffer.from(s!, "base64url"),
      ),
    ).toBe(true);

    let seen: URLSearchParams | undefined;
    const ff = fakeFetch([tokenRoute((b) => (seen = b)), versionsRoute]);
    await createSfdcClient(auth, { fetch: ff.fetch, now: () => now });
    expect(seen!.get("grant_type")).toBe(
      "urn:ietf:params:oauth:grant-type:jwt-bearer",
    );
    expect(seen!.get("assertion")).toBe(assertion);
  });

  it("surfaces OAuth errors as SfdcApiError", async () => {
    const ff = fakeFetch([
      {
        method: "POST",
        match: "/oauth2/token",
        reply: () => ({
          status: 400,
          json: {
            error: "invalid_grant",
            error_description: "user hasn't approved this consumer",
          },
        }),
      },
    ]);
    await expect(
      createSfdcClient(
        {
          kind: "client_credentials",
          loginUrl: LOGIN,
          clientId: "a",
          clientSecret: "b",
        },
        { fetch: ff.fetch },
      ),
    ).rejects.toMatchObject({
      name: "SfdcApiError",
      status: 400,
      errorCode: "invalid_grant",
    });
  });
});

describe("createSfdcClient — requests", () => {
  it("query() follows nextRecordsUrl until done and sends the batch-size header", async () => {
    const ff = fakeFetch([
      {
        match: /\/query\?q=/,
        reply: () =>
          queryResult(
            [{ Id: "1" }, { Id: "2" }],
            "/services/data/v68.0/query/01g-2000",
          ),
      },
      {
        match: "/query/01g-2000",
        reply: () => queryResult([{ Id: "3" }]),
      },
    ]);
    const client = await createSfdcClient(tokenAuth, {
      fetch: ff.fetch,
      apiVersion: "v68.0",
    });
    const rows = await client.query<{ Id: string }>("SELECT Id FROM Profile");
    expect(rows.map((r) => r.Id)).toEqual(["1", "2", "3"]);
    expect(ff.calls).toHaveLength(2);
    expect(ff.calls[0]!.url.href).toBe(
      `${INSTANCE}/services/data/v68.0/query?q=SELECT%20Id%20FROM%20Profile`,
    );
    expect(ff.calls[0]!.headers["sforce-query-options"]).toBe("batchSize=2000");
    expect(ff.calls[1]!.url.href).toBe(
      `${INSTANCE}/services/data/v68.0/query/01g-2000`,
    );
  });

  it("toolingQuery() / toolingGet() hit the tooling root; get() accepts absolute and /services/ paths", async () => {
    const ff = fakeFetch([
      { match: "/tooling/query", reply: () => queryResult([{ Id: "L1" }]) },
      {
        match: "/tooling/sobjects/Layout/L1",
        reply: () => ({ json: { Id: "L1" } }),
      },
      {
        match: "/services/data/v68.0/limits",
        reply: () => ({ json: { ok: 1 } }),
      },
      {
        match: "https://other.example/x",
        reply: () => ({ json: { other: 1 } }),
      },
    ]);
    const client = await createSfdcClient(tokenAuth, {
      fetch: ff.fetch,
      apiVersion: "68.0",
    });
    await client.toolingQuery("SELECT Id FROM Layout");
    await client.toolingGet("/sobjects/Layout/L1");
    await client.get("/limits");
    await client.get("/services/data/v68.0/limits");
    await client.get("https://other.example/x");
    expect(ff.calls.map((c) => c.url.href)).toEqual([
      `${INSTANCE}/services/data/v68.0/tooling/query?q=SELECT%20Id%20FROM%20Layout`,
      `${INSTANCE}/services/data/v68.0/tooling/sobjects/Layout/L1`,
      `${INSTANCE}/services/data/v68.0/limits`,
      `${INSTANCE}/services/data/v68.0/limits`,
      "https://other.example/x",
    ]);
  });

  it("re-authenticates once on 401 and retries with the new token", async () => {
    let tokens = 0;
    const ff = fakeFetch([
      tokenRoute(() => tokens++),
      {
        match: "/limits",
        reply: (req) =>
          req.headers.authorization === "Bearer tok-0"
            ? sfdcError(401, "INVALID_SESSION_ID", "Session expired or invalid")
            : { json: { fresh: true } },
      },
    ]);
    const client = await createSfdcClient(
      {
        kind: "client_credentials",
        loginUrl: LOGIN,
        clientId: "a",
        clientSecret: "b",
      },
      { fetch: ff.fetch, apiVersion: "v68.0" },
    );
    expect(await client.get("/limits")).toEqual({ fresh: true });
    expect(tokens).toBe(2);
    expect(ff.callsTo("/limits").map((c) => c.headers.authorization)).toEqual([
      "Bearer tok-0",
      "Bearer tok-1",
    ]);
  });

  it("does not loop on a second 401 and cannot re-auth a pre-issued token", async () => {
    const ff = fakeFetch([
      tokenRoute(),
      {
        match: "/limits",
        reply: () => sfdcError(401, "INVALID_SESSION_ID", "nope"),
      },
    ]);
    const cc = await createSfdcClient(
      {
        kind: "client_credentials",
        loginUrl: LOGIN,
        clientId: "a",
        clientSecret: "b",
      },
      { fetch: ff.fetch, apiVersion: "v68.0" },
    );
    await expect(cc.get("/limits")).rejects.toMatchObject({
      status: 401,
      errorCode: "INVALID_SESSION_ID",
    });
    expect(ff.callsTo("/oauth2/token")).toHaveLength(2);

    const ff2 = fakeFetch([
      {
        match: "/limits",
        reply: () => sfdcError(401, "INVALID_SESSION_ID", "nope"),
      },
    ]);
    const tok = await createSfdcClient(tokenAuth, {
      fetch: ff2.fetch,
      apiVersion: "v68.0",
    });
    await expect(tok.get("/limits")).rejects.toBeInstanceOf(SfdcApiError);
    expect(ff2.calls).toHaveLength(1);
  });

  it("backs off on 429 / 503 with the injected sleep and gives up after the schedule", async () => {
    const slept: number[] = [];
    const ff = fakeFetch([
      {
        match: "/limits",
        reply: (_req, idx) =>
          idx === 0
            ? {
                status: 429,
                json: [
                  { errorCode: "REQUEST_LIMIT_EXCEEDED", message: "slow down" },
                ],
              }
            : idx === 1
              ? {
                  status: 503,
                  text: "unavailable",
                  headers: { "retry-after": "2" },
                }
              : { json: { ok: true } },
      },
      { match: "/sobjects", reply: () => ({ status: 503, text: "down" }) },
    ]);
    const client = await createSfdcClient(tokenAuth, {
      fetch: ff.fetch,
      apiVersion: "v68.0",
      sleep: async (ms) => {
        slept.push(ms);
      },
      retryDelaysMs: [10, 20, 30],
    });
    expect(await client.get("/limits")).toEqual({ ok: true });
    expect(slept).toEqual([10, 2000]); // retry-after wins when present
    await expect(client.get("/sobjects")).rejects.toMatchObject({
      status: 503,
    });
    expect(ff.callsTo("/sobjects")).toHaveLength(4); // 1 + 3 retries
  });

  it("retries network errors, then fails with NETWORK_ERROR", async () => {
    let n = 0;
    const flaky = async (url: string, init?: RequestInit) => {
      n++;
      if (n <= 2) throw new Error("ECONNRESET");
      return fakeFetch([
        { match: "/limits", reply: () => ({ json: { n } }) },
      ]).fetch(url, init);
    };
    const client = await createSfdcClient(tokenAuth, {
      fetch: flaky,
      apiVersion: "v68.0",
      sleep: noSleep,
    });
    expect(await client.get("/limits")).toEqual({ n: 3 });
    const dead = await createSfdcClient(tokenAuth, {
      fetch: async () => {
        throw new Error("EAI_AGAIN");
      },
      apiVersion: "v68.0",
      sleep: noSleep,
      retryDelaysMs: [1],
    });
    await expect(dead.get("/limits")).rejects.toMatchObject({
      errorCode: "NETWORK_ERROR",
      status: 0,
    });
  });

  it("throws a typed SfdcApiError with status, errorCode, message and path", async () => {
    const ff = fakeFetch([
      {
        match: "/query",
        reply: () =>
          sfdcError(
            400,
            "INVALID_FIELD",
            "No such column 'Foo' on entity 'User'",
          ),
      },
    ]);
    const client = await createSfdcClient(tokenAuth, {
      fetch: ff.fetch,
      apiVersion: "v68.0",
    });
    const err = await client
      .query("SELECT Foo FROM User")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SfdcApiError);
    const e = err as SfdcApiError;
    expect(e.status).toBe(400);
    expect(e.errorCode).toBe("INVALID_FIELD");
    expect(e.message).toContain("No such column 'Foo'");
    expect(e.path).toContain("/query?q=");
  });

  it("enforces the request budget and records Sforce-Limit-Info", async () => {
    const ff = fakeFetch([
      {
        match: "/limits",
        reply: () => ({
          json: {},
          headers: { "Sforce-Limit-Info": "api-usage=1234/100000" },
        }),
      },
    ]);
    const client = await createSfdcClient(tokenAuth, {
      fetch: ff.fetch,
      apiVersion: "v68.0",
      maxRequests: 2,
    });
    await client.get("/limits");
    await client.get("/limits");
    expect(client.apiUsage).toEqual({ used: 1234, max: 100000 });
    await expect(client.get("/limits")).rejects.toMatchObject({
      errorCode: "REQUEST_BUDGET_EXCEEDED",
    });
    expect(ff.calls).toHaveLength(2);
    client.maxRequests = 3;
    await client.get("/limits");
    expect(client.requestCount).toBe(3);
  });

  it("parseLimitInfo handles missing / malformed headers", () => {
    expect(parseLimitInfo(null)).toBeUndefined();
    expect(parseLimitInfo("nonsense")).toBeUndefined();
    expect(parseLimitInfo("api-usage=5/10")).toEqual({ used: 5, max: 10 });
  });
});
