import { afterEach, describe, expect, it, vi } from "vitest";
import { to18 } from "../transform/ids";
import { createSfdcAuthenticator } from "./auth";
import { SfdcApiError } from "./errors";
import { ApiBudget } from "./limits";
import { SfdcRest, SfdcTransport, feedTimestamp, flattenRecord } from "./rest";
import {
  API,
  INSTANCE_URL,
  LOGIN_URL,
  collect,
  instantSleep,
  jsonReply,
  mockFetch,
  testKeyPair,
  tokenRoute,
  type Route,
} from "./test-helpers";

const { privateKey } = testKeyPair();
const NOW = Date.parse("2026-09-08T10:00:00Z");
const ACC1 = to18("001000000000001");
const ACC2 = to18("001000000000002");

afterEach(() => vi.unstubAllGlobals());

function build(
  routes: Route[],
  opts: {
    budget?: ApiBudget;
    restOpts?: ConstructorParameters<typeof SfdcRest>[1];
    now?: () => number;
  } = {},
) {
  const fm = mockFetch([tokenRoute(), ...routes]);
  vi.stubGlobal("fetch", fm.fetch);
  const auth = createSfdcAuthenticator({
    loginUrl: LOGIN_URL,
    auth: { kind: "jwt", clientId: "c", username: "u", privateKey },
    now: opts.now ?? (() => NOW),
  });
  const transport = new SfdcTransport({
    auth,
    apiVersion: "67.0",
    budget: opts.budget,
    retry: { sleep: instantSleep, random: () => 0.5 },
    now: opts.now ?? (() => NOW),
  });
  const rest = new SfdcRest(transport, {
    now: opts.now ?? (() => NOW),
    ...opts.restOpts,
  });
  return { fm, auth, transport, rest };
}

describe("flattenRecord", () => {
  it("drops attributes and flattens relationships into dotted keys", () => {
    expect(
      flattenRecord({
        attributes: { type: "Call2_vod__c" },
        Id: "a",
        Account_vod__r: {
          attributes: {},
          Name: "Acme",
          Country_vod__r: { attributes: {}, Alpha_2_Code_vod__c: "US" },
        },
        Owner: null,
        Children__r: {
          totalSize: 1,
          done: true,
          records: [{ attributes: {}, Id: "c1" }],
        },
      }),
    ).toEqual({
      Id: "a",
      "Account_vod__r.Name": "Acme",
      "Account_vod__r.Country_vod__r.Alpha_2_Code_vod__c": "US",
      Owner: null,
      Children__r: { totalSize: 1, done: true, records: [{ Id: "c1" }] },
    });
  });
});

describe("SfdcTransport", () => {
  it("adds the bearer token, resolves versioned paths, parses Sforce-Limit-Info and the Date header", async () => {
    const budget = new ApiBudget({ reservePct: 20 });
    const { fm, transport, rest } = build(
      [
        {
          match: "/limits",
          reply: () =>
            jsonReply(
              { DailyApiRequests: { Max: 100000, Remaining: 90000 } },
              200,
              {
                "Sforce-Limit-Info": "api-usage=10000/100000",
                Date: "Tue, 08 Sep 2026 10:00:05 GMT",
              },
            ),
        },
      ],
      { budget },
    );
    const limits = await rest.limits();
    expect(limits.DailyApiRequests.Remaining).toBe(90000);
    const call = fm.callsTo("/limits")[0];
    expect(call.url).toBe(`${API}/limits`);
    expect(call.headers.authorization).toBe("Bearer token1");
    expect(budget.snapshot()).toMatchObject({
      max: 100000,
      used: 10000,
      reserve: 20000,
    });
    expect(transport.serverDate).toBe("2026-09-08T10:00:05.000Z");
    expect(await rest.serverNow()).toBe("2026-09-08T10:00:05.000Z");
  });

  it("blocks with a budget-class error once the daily reserve is breached", async () => {
    const budget = new ApiBudget({ reservePct: 20 });
    budget.fromLimitInfo("api-usage=81000/100000");
    const { fm, rest } = build(
      [{ match: "/limits", reply: () => jsonReply({}) }],
      { budget },
    );
    await expect(rest.limits()).rejects.toMatchObject({
      errorClass: "budget",
      errorCode: "API_BUDGET_EXHAUSTED",
    });
    expect(fm.callsTo("/limits")).toHaveLength(0);
  });

  it("re-authenticates once and replays on 401 INVALID_SESSION_ID", async () => {
    const { fm, auth, rest, transport } = build([
      {
        match: "/limits",
        reply: (req) =>
          req.headers.authorization === "Bearer token1"
            ? jsonReply(
                [
                  {
                    errorCode: "INVALID_SESSION_ID",
                    message: "Session expired or invalid",
                  },
                ],
                401,
              )
            : jsonReply({ DailyApiRequests: { Max: 1000, Remaining: 1000 } }),
      },
    ]);
    await rest.limits();
    expect(auth.exchanges).toBe(2);
    expect(transport.stats.reauths).toBe(1);
    expect(fm.callsTo("/limits").map((c) => c.headers.authorization)).toEqual([
      "Bearer token1",
      "Bearer token2",
    ]);
  });

  it("gives up when the replayed request is rejected again", async () => {
    const { rest, auth } = build([
      {
        match: "/limits",
        reply: () =>
          jsonReply([{ errorCode: "INVALID_SESSION_ID", message: "x" }], 401),
      },
    ]);
    await expect(rest.limits()).rejects.toMatchObject({
      errorClass: "session",
    });
    expect(auth.exchanges).toBe(2);
  });

  it("retries 503/429 with backoff and honours Retry-After, but never retries structural errors", async () => {
    let n = 0;
    const { fm, rest, transport } = build([
      {
        match: "/limits",
        reply: () => {
          n++;
          if (n === 1)
            return jsonReply(
              [{ errorCode: "SERVER_UNAVAILABLE", message: "x" }],
              503,
            );
          if (n === 2)
            return jsonReply(
              [
                {
                  errorCode: "REQUEST_LIMIT_EXCEEDED",
                  message: "ConcurrentRequests",
                },
              ],
              429,
              { "Retry-After": "1" },
            );
          return jsonReply({
            DailyApiRequests: { Max: 1000, Remaining: 1000 },
          });
        },
      },
      {
        match: "/query",
        reply: () =>
          jsonReply(
            [{ errorCode: "INVALID_FIELD", message: "No such column 'Nope'" }],
            400,
          ),
      },
    ]);
    await rest.limits();
    expect(fm.callsTo("/limits")).toHaveLength(3);
    expect(transport.stats.retries).toBe(2);

    const err = (await collect(rest.query("SELECT Nope FROM Account")).catch(
      (e: unknown) => e,
    )) as SfdcApiError;
    expect(err).toBeInstanceOf(SfdcApiError);
    expect(err.errorClass).toBe("structural");
    expect(err.errorCode).toBe("INVALID_FIELD");
    expect(err.status).toBe(400);
    expect(fm.callsTo("/query")).toHaveLength(1);
  });

  it("wraps socket errors as retryable and retries them", async () => {
    let n = 0;
    const fm = mockFetch([
      tokenRoute(),
      {
        match: "/limits",
        reply: () => {
          if (++n === 1)
            throw Object.assign(new TypeError("fetch failed"), {
              cause: { code: "ECONNRESET" },
            });
          return jsonReply({
            DailyApiRequests: { Max: 1000, Remaining: 1000 },
          });
        },
      },
    ]);
    const auth = createSfdcAuthenticator({
      loginUrl: LOGIN_URL,
      auth: { kind: "jwt", clientId: "c", username: "u", privateKey },
      fetch: fm.fetch,
    });
    const transport = new SfdcTransport({
      auth,
      apiVersion: "67.0",
      fetch: fm.fetch,
      retry: { sleep: instantSleep },
    });
    const rest = new SfdcRest(transport);
    await rest.limits();
    expect(n).toBe(2);
  });
});

describe("SfdcRest queries", () => {
  it("follows nextRecordsUrl, flattens records and upgrades ids to 18 chars", async () => {
    const { fm, rest } = build([
      {
        match: /\/query\?q=/,
        reply: () =>
          jsonReply({
            totalSize: 3,
            done: false,
            nextRecordsUrl: "/services/data/v67.0/query/01g-2000",
            records: [
              {
                attributes: { type: "Account" },
                Id: "001000000000001",
                Name: "A",
                Country_vod__r: { attributes: {}, Alpha_2_Code_vod__c: "US" },
              },
              {
                attributes: { type: "Account" },
                Id: ACC2,
                Name: "B",
                Country_vod__r: null,
              },
            ],
          }),
      },
      {
        match: "/query/01g-2000",
        reply: () =>
          jsonReply({
            totalSize: 3,
            done: true,
            records: [
              { attributes: {}, Id: to18("001000000000003"), Name: "C" },
            ],
          }),
      },
    ]);
    const rows = await collect(
      rest.query(
        "SELECT Id, Name, Country_vod__r.Alpha_2_Code_vod__c FROM Account",
        { batchSize: 2000 },
      ),
    );
    expect(rows.map((r) => r.Id)).toEqual([
      ACC1,
      ACC2,
      to18("001000000000003"),
    ]);
    expect(rows[0]["Country_vod__r.Alpha_2_Code_vod__c"]).toBe("US");
    expect(rows[1].Country_vod__r).toBeNull();
    const first = fm.callsTo("/query?q=")[0];
    expect(first.url).toBe(
      `${API}/query?q=SELECT+Id%2C+Name%2C+Country_vod__r.Alpha_2_Code_vod__c+FROM+Account`,
    );
    expect(first.headers["sforce-query-options"]).toBe("batchSize=2000");
    expect(fm.callsTo("/query/01g-2000")[0].url).toBe(
      `${INSTANCE_URL}/services/data/v67.0/query/01g-2000`,
    );
  });

  it("uses /queryAll with all: true and clamps batchSize into 200..2000", async () => {
    const { fm, rest } = build([
      {
        match: "/queryAll",
        reply: () => jsonReply({ totalSize: 0, done: true, records: [] }),
      },
    ]);
    await collect(
      rest.query("SELECT Id FROM Account", { all: true, batchSize: 50 }),
    );
    const c = fm.callsTo("/queryAll")[0];
    expect(c.url).toContain("/queryAll?q=");
    expect(c.headers["sforce-query-options"]).toBe("batchSize=200");
  });

  it("count() and explain()", async () => {
    const { fm, rest } = build([
      {
        match: "/query/?explain=",
        reply: () =>
          jsonReply({
            plans: [
              {
                cost: 0.3,
                leadingOperationType: "Index",
                sobjectCardinality: 5000,
              },
            ],
          }),
      },
      {
        match: "/query?q=SELECT+COUNT",
        reply: () => jsonReply({ totalSize: 42, done: true, records: [] }),
      },
    ]);
    expect(await rest.count("Account", "Country_vod__c = 'US'")).toBe(42);
    expect(new URL(fm.callsTo("COUNT")[0].url).searchParams.get("q")).toBe(
      "SELECT COUNT() FROM Account WHERE Country_vod__c = 'US'",
    );
    const plans = await rest.explain("SELECT Id FROM Account");
    expect(plans[0].leadingOperationType).toBe("Index");
  });

  it("queryIds chunks Id IN (…) to 400 with queryAll semantics", async () => {
    const seen: string[] = [];
    const { rest } = build([
      {
        match: "/queryAll?q=",
        reply: (req) => {
          const q = req.parsed.searchParams.get("q") ?? "";
          seen.push(q);
          const ids = [...q.matchAll(/'([A-Za-z0-9]{18})'/g)].map((m) => m[1]);
          return jsonReply({
            totalSize: ids.length,
            done: true,
            records: ids.map((id) => ({
              attributes: {},
              Id: id,
              IsDeleted: false,
            })),
          });
        },
      },
    ]);
    const ids = Array.from({ length: 850 }, (_, i) =>
      to18(`001${String(i).padStart(12, "0")}`),
    );
    const rows = await collect(
      rest.queryIds("Account", [...ids, ids[3]], ["Name", "IsDeleted"]),
    );
    expect(rows).toHaveLength(850);
    expect(seen).toHaveLength(3);
    expect(
      seen[0].startsWith(
        "SELECT Id, Name, IsDeleted FROM Account WHERE Id IN (",
      ),
    ).toBe(true);
    expect(seen[0].split(",").length - 2).toBe(400);
    expect(seen[2].split(",").length - 2).toBe(50);
  });

  it("queryIds with closureStrategy composite uses /composite/sobjects and skips null entries", async () => {
    const { fm, rest } = build(
      [
        {
          match: "/composite/sobjects/Account",
          reply: (req) => {
            const ids = (req.parsed.searchParams.get("ids") ?? "").split(",");
            return jsonReply(
              ids.map((id, i) =>
                i === 1 ? null : { attributes: {}, Id: id, Name: `n${i}` },
              ),
            );
          },
        },
      ],
      { restOpts: { closureStrategy: "composite", compositeChunkSize: 2 } },
    );
    const ids = [ACC1, ACC2, to18("001000000000003")];
    const rows = await collect(rest.queryIds("Account", ids, ["Id", "Name"]));
    expect(rows.map((r) => r.Id)).toEqual([ACC1, to18("001000000000003")]);
    const calls = fm.callsTo("/composite/sobjects/Account");
    expect(calls).toHaveLength(2);
    expect(new URL(calls[0].url).searchParams.get("fields")).toBe("Id,Name");
  });
});

describe("SfdcRest describe cache", () => {
  it("caches describes and revalidates with If-Modified-Since after the TTL (304 keeps the cache)", async () => {
    let t = NOW;
    const { fm, rest } = build(
      [
        {
          match: "/sobjects/Account/describe",
          reply: (req) =>
            req.headers["if-modified-since"]
              ? new Response(null, { status: 304 })
              : jsonReply(
                  {
                    name: "Account",
                    queryable: true,
                    replicateable: true,
                    fields: [],
                    childRelationships: [],
                    recordTypeInfos: [],
                  },
                  200,
                  {
                    "Last-Modified": "Mon, 07 Sep 2026 00:00:00 GMT",
                  },
                ),
        },
        {
          match: /\/sobjects$/,
          reply: () =>
            jsonReply({
              sobjects: [
                {
                  name: "Account",
                  keyPrefix: "001",
                  queryable: true,
                  custom: false,
                  replicateable: true,
                },
              ],
            }),
        },
      ],
      { now: () => t, restOpts: { describeTtlMs: 1000 } },
    );
    const d1 = await rest.describe("Account");
    const d2 = await rest.describe("Account");
    expect(d2).toBe(d1);
    expect(fm.callsTo("/describe")).toHaveLength(1);
    t += 2000;
    const d3 = await rest.describe("Account");
    expect(d3).toBe(d1);
    const calls = fm.callsTo("/describe");
    expect(calls).toHaveLength(2);
    expect(calls[1].headers["if-modified-since"]).toBe(
      "Mon, 07 Sep 2026 00:00:00 GMT",
    );
    // global describe is cached the same way
    expect((await rest.describeGlobal())[0]).toMatchObject({
      name: "Account",
      keyPrefix: "001",
      replicateable: true,
    });
    await rest.describeGlobal();
    expect(fm.callsTo(/\/sobjects$/)).toHaveLength(1);
    await expect(rest.describe("bad name")).rejects.toThrow(TypeError);
  });

  it("describeGlobal() 304 revalidation refreshes the TTL so the next window is served from cache", async () => {
    let t = NOW;
    const { fm, rest } = build(
      [
        {
          match: /\/sobjects$/,
          reply: (req) =>
            req.headers["if-modified-since"]
              ? new Response(null, { status: 304 })
              : jsonReply(
                  {
                    sobjects: [
                      {
                        name: "Account",
                        keyPrefix: "001",
                        queryable: true,
                        custom: false,
                        replicateable: true,
                      },
                    ],
                  },
                  200,
                  { "Last-Modified": "Mon, 07 Sep 2026 00:00:00 GMT" },
                ),
        },
      ],
      { now: () => t, restOpts: { describeTtlMs: 1000 } },
    );
    const g1 = await rest.describeGlobal();
    expect(g1[0]).toMatchObject({ name: "Account", keyPrefix: "001" });
    expect(fm.callsTo(/\/sobjects$/)).toHaveLength(1);
    // past the TTL: one conditional GET, answered 304
    t += 2000;
    expect((await rest.describeGlobal())[0].name).toBe("Account");
    const calls = fm.callsTo(/\/sobjects$/);
    expect(calls).toHaveLength(2);
    expect(calls[1].headers["if-modified-since"]).toBe(
      "Mon, 07 Sep 2026 00:00:00 GMT",
    );
    // within the refreshed TTL: served from cache, no request
    t += 500;
    await rest.describeGlobal();
    await rest.describeGlobal();
    expect(fm.callsTo(/\/sobjects$/)).toHaveLength(2);
    // past it again: exactly one more conditional GET
    t += 1000;
    await rest.describeGlobal();
    expect(fm.callsTo(/\/sobjects$/)).toHaveLength(3);
  });

  it("recordTypes() is fetched once", async () => {
    const { fm, rest } = build([
      {
        match: "FROM+RecordType",
        reply: () =>
          jsonReply({
            totalSize: 1,
            done: true,
            records: [
              {
                attributes: {},
                Id: to18("012000000000001"),
                SobjectType: "Account",
                DeveloperName: "Professional_vod",
                Name: "Professional",
                IsActive: true,
                IsPersonType: true,
              },
            ],
          }),
      },
    ]);
    const a = await rest.recordTypes();
    const b = await rest.recordTypes();
    expect(a).toEqual(b);
    expect(a[0]).toMatchObject({
      DeveloperName: "Professional_vod",
      IsActive: true,
      IsPersonType: true,
    });
    expect(fm.callsTo("RecordType")).toHaveLength(1);
  });
});

describe("SfdcRest delete/update feeds", () => {
  const describeRoute = (replicateable: boolean): Route => ({
    match: "/describe",
    reply: () =>
      jsonReply({
        name: "Account",
        queryable: true,
        replicateable,
        fields: [],
        childRelationships: [],
        recordTypeInfos: [],
      }),
  });

  it("calls /deleted/ and /updated/ with +00:00 timestamps and 18-char ids", async () => {
    const { fm, rest } = build([
      describeRoute(true),
      {
        match: "/deleted/",
        reply: () =>
          jsonReply({
            deletedRecords: [
              {
                id: "001000000000001",
                deletedDate: "2026-09-07T00:00:00.000+0000",
              },
            ],
            earliestDateAvailable: "2026-08-10T00:00:00.000+0000",
            latestDateCovered: "2026-09-08T09:55:00.000+0000",
          }),
      },
      {
        match: "/updated/",
        reply: () =>
          jsonReply({
            ids: ["001000000000002"],
            latestDateCovered: "2026-09-08T09:55:00.000+0000",
          }),
      },
    ]);
    const del = await rest.getDeleted(
      "Account",
      "2026-09-01T00:00:00.000Z",
      "2026-09-08T09:55:00Z",
    );
    expect(del.deletedRecords).toEqual([
      { id: ACC1, deletedDate: "2026-09-07T00:00:00.000+0000" },
    ]);
    const url = new URL(fm.callsTo("/deleted/")[0].url);
    expect(url.pathname).toBe("/services/data/v67.0/sobjects/Account/deleted/");
    expect(url.searchParams.get("start")).toBe("2026-09-01T00:00:00+00:00");
    expect(url.searchParams.get("end")).toBe("2026-09-08T09:55:00+00:00");
    const upd = await rest.getUpdated(
      "Account",
      "2026-09-01T00:00:00Z",
      "2026-09-08T09:55:00Z",
    );
    expect(upd.ids).toEqual([ACC2]);
    expect(feedTimestamp("2026-01-02T03:04:05.678Z")).toBe(
      "2026-01-02T03:04:05+00:00",
    );
  });

  it("rejects windows older than 30 days, inverted windows and non-replicateable objects without calling the feed", async () => {
    const { fm, rest } = build([
      describeRoute(false),
      { match: "/deleted/", reply: () => jsonReply({}) },
    ]);
    await expect(
      rest.getDeleted(
        "Account",
        "2026-08-01T00:00:00Z",
        "2026-09-08T00:00:00Z",
      ),
    ).rejects.toMatchObject({
      errorCode: "REPLICATION_WINDOW_EXCEEDED",
      errorClass: "structural",
    });
    await expect(
      rest.getDeleted(
        "Account",
        "2026-09-08T00:00:00Z",
        "2026-09-07T00:00:00Z",
      ),
    ).rejects.toMatchObject({ errorCode: "INVALID_REPLICATION_DATE" });
    await expect(
      rest.getDeleted("Account", "nope", "2026-09-07T00:00:00Z"),
    ).rejects.toMatchObject({ errorCode: "INVALID_REPLICATION_DATE" });
    await expect(
      rest.getUpdated(
        "Account",
        "2026-09-01T00:00:00Z",
        "2026-09-08T00:00:00Z",
      ),
    ).rejects.toMatchObject({
      errorCode: "NOT_REPLICATEABLE",
      errorClass: "structural",
    });
    expect(fm.callsTo("/deleted/")).toHaveLength(0);
    expect(fm.callsTo("/updated/")).toHaveLength(0);
  });
});

describe("SfdcRest misc", () => {
  it("availableVersions() reads the unversioned listing without spending budget", async () => {
    const budget = new ApiBudget();
    budget.fromLimitInfo("api-usage=0/100");
    const { fm, rest } = build(
      [
        {
          match: /\/services\/data\/$/,
          reply: () => jsonReply([{ version: "66.0" }, { version: "67.0" }]),
        },
      ],
      { budget },
    );
    expect(await rest.availableVersions()).toEqual(["66.0", "67.0"]);
    expect(fm.callsTo("/services/data/")[0].url).toBe(
      `${INSTANCE_URL}/services/data/`,
    );
    expect(budget.snapshot().localConsumed).toBe(0);
  });

  it("serverNow() falls back to a cheap call when no Date header has been seen", async () => {
    const { fm, rest } = build([
      {
        match: /\/services\/data\/$/,
        reply: () =>
          jsonReply([{ version: "67.0" }], 200, {
            Date: "Tue, 08 Sep 2026 11:00:00 GMT",
          }),
      },
    ]);
    expect(await rest.serverNow()).toBe("2026-09-08T11:00:00.000Z");
    expect(fm.callsTo("/services/data/")).toHaveLength(1);
    expect(await rest.serverNow()).toBe("2026-09-08T11:00:00.000Z");
    expect(fm.callsTo("/services/data/")).toHaveLength(1);
  });
});
