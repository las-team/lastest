import { describe, expect, it } from "vitest";
import {
  assertMdlStatement,
  buildAlterAddFieldMdl,
  buildLegacyIdFieldMdl,
  mdlString,
} from "./mdl";
import { authRoutes, failureBody, makeTestClient } from "./test-support";

describe("MDL builder (§2.5.6 verified syntax)", () => {
  it("emits ALTER Object … ADD Field with unique(true) for the legacy-id field", () => {
    expect(buildLegacyIdFieldMdl("call2__v", "legacy_crm_id__c")).toBe(
      [
        "ALTER Object call2__v (",
        "  ADD Field legacy_crm_id__c(",
        "    label('Legacy CRM ID'), type('String'), max_length(18), active(true), required(false), list_column(false), unique(true), order(0))",
        ");",
      ].join("\n"),
    );
  });

  it("escapes labels, supports non-string types and extra attributes, rejects bad names", () => {
    const s = buildAlterAddFieldMdl({
      object: "account__v",
      field: "flag__c",
      label: "It's",
      type: "Boolean",
      unique: false,
      extra: { help_content: "x" },
    });
    expect(s).toContain(
      "label('It\\'s'), type('Boolean'), active(true), required(false), list_column(false), unique(false), order(0), help_content('x')",
    );
    expect(s).not.toContain("max_length");
    expect(mdlString("a\\b")).toBe("'a\\\\b'");
    expect(() => mdlString("a\nb")).toThrow(/line breaks/);
    expect(() =>
      buildAlterAddFieldMdl({ object: "Account", field: "x__c", label: "x" }),
    ).toThrow(/Invalid object/);
    expect(() =>
      buildAlterAddFieldMdl({
        object: "account__v",
        field: "x; DROP",
        label: "x",
      }),
    ).toThrow(/Invalid field/);
    expect(() =>
      buildAlterAddFieldMdl({
        object: "account__v",
        field: "x__c",
        label: "x",
        extra: { "bad name": 1 },
      }),
    ).toThrow(/attribute/);
  });

  it("only accepts scripts starting with CREATE|RECREATE|RENAME|ALTER|DROP", () => {
    expect(() => assertMdlStatement("SELECT id FROM x")).toThrow(/must start/);
    expect(() => assertMdlStatement("  alter Object x__v (…)")).not.toThrow();
  });
});

describe("MDL execution", () => {
  it("POSTs the raw script to /api/mdl/execute without a version segment", async () => {
    const t = makeTestClient([
      ...authRoutes(),
      {
        method: "POST",
        path: "/api/mdl/execute",
        body: { responseStatus: "SUCCESS", responseMessage: "done" },
      },
    ]);
    await t.client.authenticate();
    const script = buildLegacyIdFieldMdl("call2__v", "legacy_crm_id__c");
    expect(await t.client.executeMdl(script)).toMatchObject({
      ok: true,
      message: "done",
    });
    const call = t.fetch.calls.at(-1)!;
    expect(call.url).toBe("https://acme-crm.veevavault.com/api/mdl/execute");
    expect(call.bodyText).toBe(script);
    expect(call.headers["content-type"]).toBe("application/json");
    expect(call.headers.authorization).toBe("SESSION-1");
    await expect(t.client.executeMdl("SELECT 1")).rejects.toMatchObject({
      type: "INVALID_DATA",
    });
  });

  it("execute_async returns the job id; results are polled ≥ 10 s apart", async () => {
    const t = makeTestClient([
      ...authRoutes(),
      {
        method: "POST",
        path: "/api/mdl/execute_async",
        body: {
          responseStatus: "SUCCESS",
          job_id: 99,
          url: "/api/mdl/execute_async/99/results",
        },
      },
      {
        method: "GET",
        path: "/api/mdl/execute_async/99/results",
        body: { responseStatus: "SUCCESS", job_status: "RUNNING" },
      },
      {
        method: "GET",
        path: "/api/mdl/execute_async/99/results",
        body: {
          responseStatus: "SUCCESS",
          job_status: "SUCCESS",
          responseMessage: "ok",
        },
      },
    ]);
    await t.client.authenticate();
    const r = await t.client.executeMdl("ALTER Object x__v ()", {
      async: true,
    });
    expect(r).toMatchObject({ ok: true, jobId: "99" });
    const done = await t.client.waitForMdlJob("99", { pollMs: 1000 });
    expect(done).toMatchObject({ status: "success", message: "ok" });
    expect(t.sleeps).toEqual([10_000]);
  });

  it("reports a failed MDL job", async () => {
    const t = makeTestClient([
      ...authRoutes(),
      {
        method: "GET",
        path: "/api/mdl/execute_async/5/results",
        body: failureBody("INVALID_DATA", "syntax"),
      },
    ]);
    await t.client.authenticate();
    expect(await t.client.mdlResults("5")).toMatchObject({
      status: "failure",
      message: "syntax",
    });
  });

  it("mdlResults re-authenticates on INVALID_SESSION_ID instead of reporting the job as failed", async () => {
    const t = makeTestClient([
      ...authRoutes(),
      {
        method: "GET",
        path: "/api/mdl/execute_async/5/results",
        body: failureBody("INVALID_SESSION_ID"),
      },
      {
        method: "GET",
        path: "/api/mdl/execute_async/5/results",
        body: { responseStatus: "SUCCESS", job_status: "RUNNING" },
      },
    ]);
    await t.client.authenticate();
    const authsBefore = t.fetch.calls.filter((c) =>
      c.pathname.endsWith("/auth"),
    ).length;
    expect(await t.client.mdlResults("5")).toMatchObject({
      status: "running",
    });
    expect(
      t.fetch.calls.filter((c) => c.pathname.endsWith("/auth")),
    ).toHaveLength(authsBefore + 1);
  });

  it("readObjectMdl returns the raw script", async () => {
    const t = makeTestClient([
      ...authRoutes(),
      {
        method: "GET",
        path: "/api/mdl/components/Object.account__v",
        body: "RECREATE Object account__v (…);",
        contentType: "text/plain",
      },
    ]);
    await t.client.authenticate();
    expect(await t.client.readObjectMdl("account__v")).toBe(
      "RECREATE Object account__v (…);",
    );
  });
});
