import { describe, expect, it } from "vitest";

import {
  VaultApiError,
  createVaultClient,
  isMdlJobPending,
  normalizeVaultApiVersion,
  normalizeVaultDns,
} from "./client";
import { fakeFetch, failure, success } from "./test-helpers";

const DNS = "myvault.veevavault.com";

describe("createVaultClient", () => {
  it("authenticates with username/password as a form POST to /auth", async () => {
    const ff = fakeFetch([
      {
        method: "POST",
        match: "/auth",
        reply: () => success({ sessionId: "SESSION-1", userId: 1 }),
      },
      { match: "/metadata/vobjects", reply: () => success({ objects: [] }) },
    ]);
    const client = await createVaultClient(
      {
        kind: "password",
        vaultDns: DNS,
        username: "u@example.com",
        password: "p'w",
      },
      { fetch: ff.fetch },
    );
    expect(client.apiVersion).toBe("v26.2");
    expect(client.vaultDns).toBe(DNS);
    const auth = ff.calls[0]!;
    expect(auth.url.href).toBe(`https://${DNS}/api/v26.2/auth`);
    expect(auth.headers["content-type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    expect(auth.headers.authorization).toBeUndefined();
    const form = new URLSearchParams(auth.body ?? "");
    expect(form.get("username")).toBe("u@example.com");
    expect(form.get("password")).toBe("p'w");
    expect(form.get("vaultDNS")).toBe(DNS);

    await client.listObjects();
    const next = ff.calls[1]!;
    expect(next.headers.authorization).toBe("SESSION-1");
    expect(next.headers.accept).toBe("application/json");
    expect(next.headers["x-vaultapi-clientid"]).toBe(
      "lastest-veeva-crm-migration",
    );
    expect(client.requestCount).toBe(2);
  });

  it("uses a pre-issued session id without calling /auth and honours apiVersion", async () => {
    const ff = fakeFetch([
      {
        match: "/metadata/vobjects/call2__v",
        reply: () => success({ object: { name: "call2__v", fields: [] } }),
      },
    ]);
    const client = await createVaultClient(
      { kind: "session", vaultDns: `https://${DNS}/`, sessionId: "S" },
      { fetch: ff.fetch, apiVersion: "25.3" },
    );
    const meta = await client.getObjectMetadata("call2__v");
    expect(meta.name).toBe("call2__v");
    expect(ff.calls).toHaveLength(1);
    expect(ff.calls[0]!.url.href).toBe(
      `https://${DNS}/api/v25.3/metadata/vobjects/call2__v`,
    );
    expect(ff.calls[0]!.headers.authorization).toBe("S");
  });

  it("throws VaultApiError carrying the error list on a FAILURE envelope", async () => {
    const ff = fakeFetch([
      {
        match: "/auth",
        reply: () => failure("INVALID_CREDENTIALS", "bad password"),
      },
    ]);
    await expect(
      createVaultClient(
        { kind: "password", vaultDns: DNS, username: "u", password: "p" },
        { fetch: ff.fetch },
      ),
    ).rejects.toMatchObject({
      name: "VaultApiError",
      errors: [{ type: "INVALID_CREDENTIALS", message: "bad password" }],
    });
  });

  it("throws VaultApiError on a non-2xx response without an envelope", async () => {
    const ff = fakeFetch([
      { match: "/query", reply: () => ({ status: 500, text: "boom" }) },
    ]);
    const client = await createVaultClient(
      { kind: "session", vaultDns: DNS, sessionId: "S" },
      { fetch: ff.fetch },
    );
    const err = await client.query("SELECT id FROM account__v").catch((e) => e);
    expect(err).toBeInstanceOf(VaultApiError);
    expect((err as VaultApiError).status).toBe(500);
  });

  it("encodes JSON and form bodies according to contentType", async () => {
    const ff = fakeFetch([
      { match: "/vobjects/", reply: () => success() },
      { match: "/objects/picklists/", reply: () => success() },
    ]);
    const client = await createVaultClient(
      { kind: "session", vaultDns: DNS, sessionId: "S" },
      { fetch: ff.fetch },
    );
    await client.request({
      method: "POST",
      path: "/vobjects/application_profile__v",
      body: { name__v: "DE Sales" },
    });
    await client.request({
      method: "POST",
      path: "/objects/picklists/call_type__v",
      body: { value_1: "Lunch & Learn" },
      contentType: "application/x-www-form-urlencoded",
    });
    expect(ff.calls[0]!.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(ff.calls[0]!.body!)).toEqual({ name__v: "DE Sales" });
    expect(ff.calls[1]!.headers["content-type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    expect(ff.calls[1]!.body).toBe("value_1=Lunch+%26+Learn");
  });

  it("executes MDL as a raw text/plain POST to /mdl/execute", async () => {
    const ff = fakeFetch([
      {
        match: "/mdl/execute",
        reply: () =>
          success({
            statement_execution: [
              {
                statement: "RECREATE Picklist x__c (...)",
                response: "SUCCESS",
              },
            ],
          }),
      },
    ]);
    const client = await createVaultClient(
      { kind: "session", vaultDns: DNS, sessionId: "S" },
      { fetch: ff.fetch },
    );
    const script = "RECREATE Picklist x__c (\n  label('X')\n);";
    const result = await client.executeMdl(script);
    const call = ff.calls[0]!;
    expect(call.method).toBe("POST");
    expect(call.url.href).toBe(`https://${DNS}/api/v26.2/mdl/execute`);
    expect(call.headers["content-type"]).toBe("text/plain");
    expect(call.body).toBe(script);
    expect(result.mode).toBe("sync");
    expect(result.statement_execution).toHaveLength(1);
  });

  it("polls an async MDL job with the injected sleep until it finishes", async () => {
    const sleeps: number[] = [];
    const ff = fakeFetch([
      {
        method: "POST",
        match: "/mdl/execute_async",
        reply: () =>
          success({
            job_id: 4711,
            url: `https://${DNS}/api/v26.2/mdl/execute_async/4711/results`,
          }),
      },
      {
        method: "GET",
        match: "/mdl/execute_async/4711/results",
        reply: (_req, i) =>
          i < 2
            ? success({ job_id: 4711, job_status: "RUNNING" })
            : success({
                job_status: "SUCCESS",
                statement_execution: [{ response: "SUCCESS" }],
              }),
      },
    ]);
    const client = await createVaultClient(
      { kind: "session", vaultDns: DNS, sessionId: "S" },
      {
        fetch: ff.fetch,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
        pollIntervalMs: 5,
      },
    );
    const result = await client.executeMdl("ALTER Object x__c ( ... );", {
      async: true,
    });
    expect(result.mode).toBe("async");
    expect(result.statement_execution).toEqual([{ response: "SUCCESS" }]);
    expect(ff.callsTo("/results")).toHaveLength(3);
    expect(sleeps).toEqual([5, 5, 5]);
  });

  it("gives up polling after maxPolls", async () => {
    const ff = fakeFetch([
      {
        method: "POST",
        match: "/mdl/execute_async",
        reply: () => success({ job_id: "j1" }),
      },
      {
        method: "GET",
        match: "/results",
        reply: () => success({ job_id: "j1", job_status: "QUEUED" }),
      },
    ]);
    const client = await createVaultClient(
      { kind: "session", vaultDns: DNS, sessionId: "S" },
      { fetch: ff.fetch, sleep: async () => {}, maxPolls: 3 },
    );
    await expect(client.executeMdl("x", { async: true })).rejects.toThrow(
      /did not finish after 3 polls/,
    );
  });

  it("pauses when the burst-limit header is low and retries once on 429", async () => {
    const sleeps: number[] = [];
    const ff = fakeFetch([
      {
        match: "/metadata/vobjects",
        reply: (_req, i) =>
          i === 0
            ? {
                ...success({ objects: [] }),
                headers: { "X-VaultAPI-BurstLimitRemaining": "3" },
              }
            : i === 1
              ? {
                  status: 429,
                  json: {
                    responseStatus: "FAILURE",
                    errors: [
                      { type: "API_LIMIT_EXCEEDED", message: "slow down" },
                    ],
                  },
                }
              : success({ objects: [{ name: "account__v" }] }),
      },
    ]);
    const client = await createVaultClient(
      { kind: "session", vaultDns: DNS, sessionId: "S" },
      {
        fetch: ff.fetch,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
        burstPauseMs: 1234,
        burstLimitFloor: 20,
      },
    );
    await client.listObjects();
    expect(client.burstLimitRemaining).toBe(3);
    expect(sleeps).toEqual([]);
    const objects = await client.listObjects();
    // paused before the second call (low burst), then paused again on the 429 and retried
    expect(sleeps).toEqual([1234, 1234]);
    expect(objects).toEqual([{ name: "account__v" }]);
    expect(ff.calls).toHaveLength(3);
  });

  it("follows VQL pagination via responseDetails.next_page", async () => {
    const ff = fakeFetch([
      {
        method: "POST",
        match: "/query",
        reply: () =>
          success({
            data: [{ id: "1" }],
            responseDetails: { next_page: `/api/v26.2/query/abc?page=2` },
          }),
      },
      {
        method: "GET",
        match: "/query/abc",
        reply: () => success({ data: [{ id: "2" }] }),
      },
    ]);
    const client = await createVaultClient(
      { kind: "session", vaultDns: DNS, sessionId: "S" },
      { fetch: ff.fetch },
    );
    const rows = await client.query<{ id: string }>(
      "SELECT id FROM account__v",
    );
    expect(rows.map((r) => r.id)).toEqual(["1", "2"]);
    const first = ff.calls[0]!;
    expect(first.headers["content-type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    expect(new URLSearchParams(first.body!).get("q")).toBe(
      "SELECT id FROM account__v",
    );
    expect(ff.calls[1]!.url.href).toBe(
      `https://${DNS}/api/v26.2/query/abc?page=2`,
    );
  });

  it("reads page layouts from the verified endpoint", async () => {
    const ff = fakeFetch([
      {
        match: "/metadata/vobjects/call2__v/page_layouts",
        reply: () => success({ data: [{ name: "call_detail__c" }] }),
      },
    ]);
    const client = await createVaultClient(
      { kind: "session", vaultDns: DNS, sessionId: "S" },
      { fetch: ff.fetch },
    );
    expect(await client.getPageLayouts("call2__v")).toEqual([
      { name: "call_detail__c" },
    ]);
  });
});

describe("helpers", () => {
  it("normalises api versions and DNS", () => {
    expect(normalizeVaultApiVersion(undefined)).toBe("v26.2");
    expect(normalizeVaultApiVersion("26.1")).toBe("v26.1");
    expect(normalizeVaultApiVersion("V25.3")).toBe("v25.3");
    expect(normalizeVaultDns("https://x.veevavault.com/")).toBe(
      "x.veevavault.com",
    );
  });

  it("detects pending MDL jobs", () => {
    expect(isMdlJobPending({ job_id: 1 })).toBe(true);
    expect(isMdlJobPending({ job_id: 1, job_status: "RUNNING" })).toBe(true);
    expect(isMdlJobPending({ job_status: "SUCCESS" })).toBe(false);
    expect(isMdlJobPending({ statement_execution: [] })).toBe(false);
    expect(isMdlJobPending(null)).toBe(false);
  });
});
