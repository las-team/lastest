import { describe, expect, it } from "vitest";

import type { PlanStep, VaultPlan } from "../model/types";
import {
  applyVaultPlan,
  extractRecordId,
  mdlFailureMessage,
  renderApplyReport,
  resolvePlaceholders,
} from "./apply";
import { createVaultClient } from "./client";
import { fakeFetch, failure, success, type Route } from "./test-helpers";

const NOW = () => new Date("2026-09-07T12:00:00Z");

function mk(
  partial: Partial<PlanStep> & { id: string; kind: PlanStep["kind"] },
): PlanStep {
  return {
    title: partial.id,
    country: "GLOBAL",
    category: "all",
    source: partial.id,
    target: partial.id,
    dependsOn: [],
    ...partial,
  };
}

function testPlan(steps: PlanStep[]): VaultPlan {
  return {
    schemaVersion: 1,
    createdAt: "2026-09-07T00:00:00Z",
    apiVersion: "v26.2",
    steps,
    unmapped: [],
  };
}

const PLAN = testPlan([
  mk({
    id: "sp:DE.sales_rep",
    kind: "mdl",
    mdl: "RECREATE Securityprofile sp_de_sales_rep__c ();",
    dependsOn: ["ps:DE.sales_rep"],
    review: true,
  }),
  mk({ id: "obj:thing__c", kind: "mdl", mdl: "RECREATE Object thing__c ();" }),
  mk({
    id: "field:call2__v.foo__c",
    kind: "mdl",
    mdl: "ALTER Object call2__v ( ADD Field foo__c () );",
  }),
  mk({
    id: "ps:DE.sales_rep",
    kind: "mdl",
    mdl: "RECREATE Permissionset ps_de_sales_rep__c ();",
    dependsOn: ["obj:thing__c", "field:call2__v.foo__c"],
  }),
  mk({
    id: "app:DE.sales_rep",
    kind: "api",
    api: {
      method: "POST",
      path: "/vobjects/application_profile__v",
      body: { name__v: "DE sales rep" },
      contentType: "application/json",
    },
    captures: { recordId: "id" },
  }),
  mk({
    id: "vmoc:DE.sales_rep.call2__v.ipad",
    kind: "api",
    api: {
      method: "POST",
      path: "/vobjects/vmobile_object_configuration__v",
      body: {
        name__v: "x",
        application_profile__v: "{{step:app:DE.sales_rep.recordId}}",
      },
      contentType: "application/json",
    },
    dependsOn: ["app:DE.sales_rep"],
  }),
  mk({
    id: "layout-assign:DE.sales_rep",
    kind: "manual",
    manual: "do it",
    dependsOn: ["ps:DE.sales_rep"],
  }),
]);

async function client(routes: Route[]) {
  const ff = fakeFetch(routes);
  const c = await createVaultClient(
    { kind: "session", vaultDns: "v.veevavault.com", sessionId: "S" },
    { fetch: ff.fetch, sleep: async () => {} },
  );
  return { ff, c };
}

const byId = (r: {
  results: { stepId: string; status: string; message?: string }[];
}) => Object.fromEntries(r.results.map((x) => [x.stepId, x]));

describe("applyVaultPlan", () => {
  it("dry-run sends nothing and describes each automated step; manual steps are manual", async () => {
    const { ff, c } = await client([]);
    const report = await applyVaultPlan(c, PLAN, { dryRun: true, now: NOW });
    expect(ff.calls).toHaveLength(0);
    expect(report.dryRun).toBe(true);
    expect(report.ok).toBe(true);
    expect(report.startedAt).toBe("2026-09-07T12:00:00.000Z");
    const r = byId(report);
    expect(r["obj:thing__c"]).toMatchObject({
      status: "skipped",
      message:
        "dry-run: would execute MDL RECREATE Object thing__c (); (28 chars)",
    });
    expect(r["app:DE.sales_rep"]?.message).toBe(
      'dry-run: would call POST /vobjects/application_profile__v body {"name__v":"DE sales rep"}',
    );
    expect(r["sp:DE.sales_rep"]?.message).toMatch(/\[review\]$/);
    expect(r["layout-assign:DE.sales_rep"]).toMatchObject({
      status: "manual",
      message: "layout-assign:DE.sales_rep",
    });
    // topological order: dependencies first, then the security profile that was listed first in the plan
    expect(report.results.map((x) => x.stepId)).toEqual([
      "obj:thing__c",
      "field:call2__v.foo__c",
      "ps:DE.sales_rep",
      "sp:DE.sales_rep",
      "app:DE.sales_rep",
      "vmoc:DE.sales_rep.call2__v.ipad",
      "layout-assign:DE.sales_rep",
    ]);
  });

  it("applies MDL and API steps, prechecks existence, captures record ids and resolves placeholders", async () => {
    const { ff, c } = await client([
      {
        method: "GET",
        match: "/metadata/vobjects/thing__c",
        reply: () => success({ object: { name: "thing__c" } }),
      },
      {
        method: "GET",
        match: "/metadata/vobjects/call2__v/fields/foo__c",
        reply: () => failure("INVALID_DATA", "no such field"),
      },
      {
        method: "POST",
        match: "/mdl/execute",
        reply: () =>
          success({ statement_execution: [{ response: "SUCCESS" }] }),
      },
      {
        method: "POST",
        match: "/vobjects/application_profile__v",
        reply: () =>
          success({
            data: [{ responseStatus: "SUCCESS", id: "V0A000000001" }],
          }),
      },
      {
        method: "POST",
        match: "/vobjects/vmobile_object_configuration__v",
        reply: () => success({ data: [{ id: "V0B000000001" }] }),
      },
    ]);
    const report = await applyVaultPlan(c, PLAN, {
      dryRun: false,
      now: NOW,
      allowReview: true,
    });
    const r = byId(report);
    expect(report.ok).toBe(true);
    expect(r["obj:thing__c"]).toMatchObject({
      status: "skipped",
      message: "already present: object thing__c present",
    });
    expect(r["field:call2__v.foo__c"]?.status).toBe("applied");
    expect(r["ps:DE.sales_rep"]?.status).toBe("applied");
    expect(r["sp:DE.sales_rep"]?.status).toBe("applied");
    expect(r["app:DE.sales_rep"]).toMatchObject({
      status: "applied",
      message:
        "POST /vobjects/application_profile__v → SUCCESS (record V0A000000001)",
    });
    expect(r["vmoc:DE.sales_rep.call2__v.ipad"]?.status).toBe("applied");
    expect(r["layout-assign:DE.sales_rep"]?.status).toBe("manual");
    const vmocCall = ff.callsTo(
      "/vobjects/vmobile_object_configuration__v",
    )[0]!;
    expect(JSON.parse(vmocCall.body!)).toEqual({
      name__v: "x",
      application_profile__v: "V0A000000001",
    });
    const mdlCalls = ff.callsTo("/mdl/execute");
    expect(mdlCalls).toHaveLength(3);
    expect(
      mdlCalls.every((m) => m.headers["content-type"] === "text/plain"),
    ).toBe(true);
    expect(mdlCalls[0]!.body).toContain("ADD Field foo__c");
  });

  it("skips review steps (and their dependants) unless allowReview", async () => {
    const { c } = await client([
      {
        method: "GET",
        match: "/metadata/",
        reply: () => failure("INVALID_DATA", "absent"),
      },
      {
        method: "POST",
        match: "/mdl/execute",
        reply: () => success({ statement_execution: [] }),
      },
      {
        method: "POST",
        match: "/vobjects/",
        reply: () => success({ data: [{ id: "1" }] }),
      },
    ]);
    const report = await applyVaultPlan(c, PLAN, { dryRun: false, now: NOW });
    const r = byId(report);
    expect(r["sp:DE.sales_rep"]).toMatchObject({
      status: "skipped",
      message: expect.stringMatching(/review required/),
    });
    expect(r["ps:DE.sales_rep"]?.status).toBe("applied");
    expect(report.ok).toBe(true);
  });

  it("stops on the first failure and marks the rest as not run", async () => {
    const { ff, c } = await client([
      {
        method: "GET",
        match: "/metadata/",
        reply: () => failure("INVALID_DATA", "absent"),
      },
      {
        method: "POST",
        match: "/mdl/execute",
        reply: (req) =>
          req.body?.includes("RECREATE Object")
            ? success({
                statement_execution: [
                  {
                    response: "FAILURE",
                    message: "bad",
                    failures: [{ message: "syntax error" }],
                  },
                ],
              })
            : success({ statement_execution: [] }),
      },
    ]);
    const report = await applyVaultPlan(c, PLAN, {
      dryRun: false,
      now: NOW,
      allowReview: true,
    });
    const r = byId(report);
    expect(report.ok).toBe(false);
    expect(r["obj:thing__c"]).toMatchObject({
      status: "failed",
      message: 'FAILURE bad: {"message":"syntax error"}',
    });
    expect(r["field:call2__v.foo__c"]).toMatchObject({
      status: "skipped",
      message: "not run: obj:thing__c failed",
    });
    expect(r["app:DE.sales_rep"]).toMatchObject({
      status: "skipped",
      message: "not run: obj:thing__c failed",
    });
    expect(r["layout-assign:DE.sales_rep"]?.status).toBe("manual");
    expect(ff.callsTo("/mdl/execute")).toHaveLength(1);
    expect(ff.calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("continueOnError keeps going but still skips dependants of the failure", async () => {
    const { c } = await client([
      {
        method: "GET",
        match: "/metadata/",
        reply: () => failure("INVALID_DATA", "absent"),
      },
      {
        method: "POST",
        match: "/mdl/execute",
        reply: (req) =>
          req.body?.includes("RECREATE Object")
            ? failure("MDL_ERROR", "nope")
            : success({}),
      },
      {
        method: "POST",
        match: "/vobjects/",
        reply: () => success({ data: [{ id: "7" }] }),
      },
    ]);
    const report = await applyVaultPlan(c, PLAN, {
      dryRun: false,
      now: NOW,
      allowReview: true,
      continueOnError: true,
    });
    const r = byId(report);
    expect(report.ok).toBe(false);
    expect(r["obj:thing__c"]).toMatchObject({
      status: "failed",
      message: expect.stringContaining("MDL_ERROR: nope"),
    });
    expect(r["field:call2__v.foo__c"]?.status).toBe("applied");
    expect(r["ps:DE.sales_rep"]).toMatchObject({
      status: "skipped",
      message: "not run: obj:thing__c failed",
    });
    expect(r["sp:DE.sales_rep"]).toMatchObject({
      status: "skipped",
      message: "not run: obj:thing__c failed",
    });
    expect(r["app:DE.sales_rep"]?.status).toBe("applied");
    expect(r["vmoc:DE.sales_rep.call2__v.ipad"]?.status).toBe("applied");
  });

  it("fails a capturing step whose response has no record id", async () => {
    const { c } = await client([
      {
        method: "POST",
        match: "/vobjects/",
        reply: () => success({ data: [] }),
      },
    ]);
    const report = await applyVaultPlan(
      c,
      testPlan([PLAN.steps[4]!, PLAN.steps[5]!]),
      { dryRun: false, now: NOW },
    );
    const r = byId(report);
    expect(r["app:DE.sales_rep"]).toMatchObject({
      status: "failed",
      message: expect.stringContaining("no record id"),
    });
    expect(r["vmoc:DE.sales_rep.call2__v.ipad"]?.status).toBe("skipped");
  });

  it("uses execute_async when asked", async () => {
    const { ff, c } = await client([
      {
        method: "GET",
        match: "/metadata/",
        reply: () => failure("INVALID_DATA", "absent"),
      },
      {
        method: "POST",
        match: "/mdl/execute_async",
        reply: () => success({ job_id: 9 }),
      },
      {
        method: "GET",
        match: "/mdl/execute_async/9/results",
        reply: () =>
          success({ job_status: "SUCCESS", statement_execution: [] }),
      },
    ]);
    const report = await applyVaultPlan(c, testPlan([PLAN.steps[1]!]), {
      dryRun: false,
      now: NOW,
      asyncMdl: true,
    });
    expect(byId(report)["obj:thing__c"]?.status).toBe("applied");
    expect(ff.callsTo("/mdl/execute_async")[0]!.method).toBe("POST");
  });
});

describe("helpers", () => {
  it("resolves placeholders recursively", () => {
    const out = resolvePlaceholders(
      {
        a: "{{step:app:X.y.recordId}}",
        b: ["{{step:app:X.y.recordId}}", 1],
        c: { d: "plain" },
      },
      { "app:X.y": { recordId: "R1" } },
    );
    expect(out).toEqual({ a: "R1", b: ["R1", 1], c: { d: "plain" } });
    expect(() => resolvePlaceholders("{{step:nope.recordId}}", {})).toThrow(
      /no record id captured from step nope/,
    );
  });

  it("extracts record ids from the common response shapes", () => {
    expect(extractRecordId({ id: "1" })).toBe("1");
    expect(extractRecordId({ data: [{ id: 2 }] })).toBe("2");
    expect(extractRecordId({ data: { id: "3" } })).toBe("3");
    expect(extractRecordId({ data: [{ data: { id: "4" } }] })).toBe("4");
    expect(extractRecordId({ data: [] })).toBeUndefined();
  });

  it("summarises MDL failures", () => {
    expect(
      mdlFailureMessage({
        responseStatus: "SUCCESS",
        statement_execution: [{ response: "SUCCESS" }],
      }),
    ).toBeNull();
    expect(
      mdlFailureMessage({
        responseStatus: "SUCCESS",
        statement_execution: [{ response: "EXCEPTION", exceptions: ["boom"] }],
      }),
    ).toBe("EXCEPTION: boom");
  });

  it("renders a markdown report", () => {
    const md = renderApplyReport(
      {
        startedAt: "s",
        finishedAt: "f",
        dryRun: false,
        ok: false,
        results: [
          {
            stepId: "obj:thing__c",
            status: "failed",
            message: "bad | thing",
            response: { x: 1 },
          },
          { stepId: "layout-assign:DE.sales_rep", status: "manual" },
        ],
      },
      PLAN,
    );
    expect(md).toContain(
      "| 1 | obj:thing__c | mdl | GLOBAL | failed | bad \\| thing |",
    );
    expect(md).toContain("## Failures");
    expect(md).toContain('"x": 1');
  });
});
