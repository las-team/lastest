import { afterEach, describe, expect, it, vi } from "vitest";
import { to18 } from "../transform/ids";
import { SfdcBulk } from "./bulk2";
import { createSfdcClient } from "./client";
import { SfdcApiError } from "./errors";
import type { SfdcClient } from "./types";
import {
  API,
  INSTANCE_URL,
  LOGIN_URL,
  ORG_ID,
  USER_ID,
  collect,
  jsonReply,
  mockFetch,
  testKeyPair,
  textReply,
  tokenRoute,
} from "./test-helpers";

const { privateKey } = testKeyPair();
const JOB = "750000000000009AAA";
const ID1 = to18("001000000000001");

afterEach(() => vi.unstubAllGlobals());

describe("createSfdcClient", () => {
  it("authenticates eagerly and exposes orgId/instanceUrl/apiVersion and every SfdcClient method", async () => {
    const fm = mockFetch([
      tokenRoute(),
      {
        match: /\/services\/data\/$/,
        reply: () => jsonReply([{ version: "67.0" }]),
      },
      {
        match: "/limits",
        reply: () =>
          jsonReply({ DailyApiRequests: { Max: 100, Remaining: 90 } }, 200, {
            "Sforce-Limit-Info": "api-usage=10/100",
          }),
      },
      {
        match: "/queryAll?q=",
        reply: () =>
          jsonReply({
            totalSize: 1,
            done: true,
            records: [{ attributes: {}, Id: ID1, Name: "A" }],
          }),
      },
      {
        match: "/query?q=SELECT+COUNT",
        reply: () => jsonReply({ totalSize: 7, done: true, records: [] }),
      },
      {
        match: "/query/?explain=",
        reply: () =>
          jsonReply({
            plans: [
              {
                cost: 1,
                leadingOperationType: "TableScan",
                sobjectCardinality: 1,
              },
            ],
          }),
      },
      {
        match: "/sobjects/Account/describe",
        reply: () =>
          jsonReply({
            name: "Account",
            queryable: true,
            replicateable: true,
            fields: [],
            childRelationships: [],
            recordTypeInfos: [],
          }),
      },
      {
        match: /\/sobjects$/,
        reply: () =>
          jsonReply({
            sobjects: [
              {
                name: "Account",
                queryable: true,
                custom: false,
                replicateable: true,
              },
            ],
          }),
      },
      {
        match: "FROM+RecordType",
        reply: () => jsonReply({ totalSize: 0, done: true, records: [] }),
      },
      {
        match: "/deleted/",
        reply: () =>
          jsonReply({
            deletedRecords: [],
            earliestDateAvailable: "x",
            latestDateCovered: "y",
          }),
      },
      {
        match: "/updated/",
        reply: () => jsonReply({ ids: [], latestDateCovered: "y" }),
      },
      {
        method: "POST",
        match: "/jobs/query",
        reply: () =>
          jsonReply({
            id: JOB,
            operation: "queryAll",
            object: "Account",
            state: "JobComplete",
          }),
      },
      {
        method: "GET",
        match: `/jobs/query/${JOB}/results`,
        reply: () =>
          textReply(`Id,Name\n${ID1},A\n`, 200, {
            "Sforce-Locator": "null",
            "Sforce-NumberOfRecords": "1",
          }),
      },
      {
        method: "GET",
        match: `/jobs/query/${JOB}`,
        reply: () =>
          jsonReply({
            id: JOB,
            operation: "queryAll",
            object: "Account",
            state: "JobComplete",
          }),
      },
      {
        method: "PATCH",
        match: `/jobs/query/${JOB}`,
        reply: () => jsonReply({ id: JOB, state: "Aborted" }),
      },
      {
        method: "DELETE",
        match: `/jobs/query/${JOB}`,
        reply: () => new Response(null, { status: 204 }),
      },
    ]);
    vi.stubGlobal("fetch", fm.fetch);

    const client = await createSfdcClient(
      {
        source: {
          loginUrl: LOGIN_URL,
          apiVersion: "67.0",
          auth: { kind: "jwt", clientId: "c", username: "u", privateKey },
        },
        performance: {
          sfdcBulkConcurrency: 2,
          sfdcRestConcurrency: 1,
          sfdcApiFloorPct: 10,
        },
        extract: { closureStrategy: "soqlIn" },
      },
      { sleep: async () => {}, now: () => Date.parse("2026-09-08T10:00:00Z") },
    );
    const asContract: SfdcClient = client;
    expect(asContract.orgId).toBe(ORG_ID);
    expect(client.userId).toBe(USER_ID);
    expect(client.instanceUrl).toBe(INSTANCE_URL);
    expect(client.apiVersion).toBe("67.0");
    expect(fm.callsTo("/oauth2/token")).toHaveLength(1);

    expect(await client.availableVersions()).toEqual(["67.0"]);
    expect((await client.limits()).DailyApiRequests.Max).toBe(100);
    expect(client.budget.snapshot()).toMatchObject({
      max: 100,
      used: 10,
      reserve: 10,
    });
    expect((await client.describeGlobal())[0].name).toBe("Account");
    expect((await client.describe("Account")).replicateable).toBe(true);
    expect(await client.recordTypes()).toEqual([]);
    expect(
      await collect(
        client.query("SELECT Id, Name FROM Account", { all: true }),
      ),
    ).toEqual([{ Id: ID1, Name: "A" }]);
    expect(await collect(client.queryIds("Account", [ID1], ["Name"]))).toEqual([
      { Id: ID1, Name: "A" },
    ]);
    expect(await client.count("Account")).toBe(7);
    expect(
      (await client.explain("SELECT Id FROM Account"))[0].leadingOperationType,
    ).toBe("TableScan");
    expect(
      (
        await client.getDeleted(
          "Account",
          "2026-09-01T00:00:00Z",
          "2026-09-08T00:00:00Z",
        )
      ).latestDateCovered,
    ).toBe("y");
    expect(
      (
        await client.getUpdated(
          "Account",
          "2026-09-01T00:00:00Z",
          "2026-09-08T00:00:00Z",
        )
      ).ids,
    ).toEqual([]);
    expect(await client.serverNow()).toBe("2026-09-08T10:00:00.000Z");

    const bulk = client.bulkQuery("SELECT Id, Name FROM Account", {
      all: true,
    });
    const pages = await collect(bulk);
    expect(pages).toHaveLength(1);
    expect(pages[0].records).toEqual([{ Id: ID1, Name: "A" }]);
    expect((await bulk.job).state).toBe("JobComplete");
    await client.abortBulkJob(JOB);
    expect(
      fm.calls.some(
        (c) => c.method === "DELETE" && c.url === `${API}/jobs/query/${JOB}`,
      ),
    ).toBe(true);
    expect(client.bulk).toBeInstanceOf(SfdcBulk);
    await client.close();
  });

  it("rejects with an auth-class error when the token exchange fails or the flow is forbidden", async () => {
    const fm = mockFetch([
      {
        method: "POST",
        match: "/oauth2/token",
        reply: () =>
          jsonReply(
            {
              error: "invalid_client_id",
              error_description: "client identifier invalid",
            },
            400,
          ),
      },
    ]);
    vi.stubGlobal("fetch", fm.fetch);
    await expect(
      createSfdcClient({
        source: {
          loginUrl: LOGIN_URL,
          auth: { kind: "jwt", clientId: "c", username: "u", privateKey },
        },
      }),
    ).rejects.toMatchObject({
      errorClass: "auth",
      errorCode: "invalid_client_id",
    });
    await expect(
      createSfdcClient({
        source: {
          loginUrl: LOGIN_URL,
          auth: { kind: "password", username: "u", password: "p" },
        },
      }),
    ).rejects.toBeInstanceOf(SfdcApiError);
    expect(fm.callsTo("/oauth2/token")).toHaveLength(1);
  });

  it("defaults apiVersion to 67.0 and can use an injected fetch instead of the global", async () => {
    const fm = mockFetch([
      tokenRoute(),
      {
        match: "/limits",
        reply: () =>
          jsonReply({ DailyApiRequests: { Max: 1000, Remaining: 1000 } }),
      },
    ]);
    const client = await createSfdcClient(
      {
        source: {
          loginUrl: LOGIN_URL,
          auth: { kind: "jwt", clientId: "c", username: "u", privateKey },
        },
      },
      { fetch: fm.fetch },
    );
    expect(client.apiVersion).toBe("67.0");
    await client.limits();
    expect(fm.callsTo("/limits")[0].url).toBe(
      `${INSTANCE_URL}/services/data/v67.0/limits`,
    );
  });
});
