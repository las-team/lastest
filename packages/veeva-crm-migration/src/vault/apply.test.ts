import { describe, expect, it } from "vitest";

import type { PlanStep, VaultPlan } from "../model/types";
import {
  applyVaultPlan,
  extractRecordId,
  isNotFoundError,
  mdlFailureMessage,
  mdlTarget,
  recordFailureMessage,
  renderApplyReport,
  resolvePlaceholders,
  vqlString,
} from "./apply";
import { VaultApiError, createVaultClient } from "./client";
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
    mdl: "CREATE Securityprofile sp_de_sales_rep__c ();",
    dependsOn: ["ps:DE.sales_rep"],
    review: true,
  }),
  mk({ id: "obj:thing__c", kind: "mdl", mdl: "CREATE Object thing__c ();" }),
  mk({
    id: "field:call2__v.foo__c",
    kind: "mdl",
    mdl: "ALTER Object call2__v ( ADD Field foo__c () );",
  }),
  mk({
    id: "ps:DE.sales_rep",
    kind: "mdl",
    mdl: "CREATE Permissionset ps_de_sales_rep__c ();",
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

/** Every precheck answers "absent" (HTTP 404 / does-not-exist / empty VQL). */
const ABSENT: Route[] = [
  {
    method: "GET",
    match: "/metadata/",
    reply: () => failure("INVALID_DATA", "Object [x] does not exist"),
  },
  {
    method: "GET",
    match: "/configuration/",
    reply: () => ({ status: 404, json: { responseStatus: "FAILURE" } }),
  },
  { method: "POST", match: "/query", reply: () => success({ data: [] }) },
];

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

const vql = (body: string | null) => new URLSearchParams(body ?? "").get("q");

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
        "dry-run: would execute MDL CREATE Object thing__c (); (26 chars)",
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
        reply: () => failure("INVALID_DATA", "Field [foo__c] does not exist"),
      },
      {
        method: "GET",
        match: "/configuration/Permissionset.ps_de_sales_rep__c",
        reply: () => ({ status: 404, json: { responseStatus: "FAILURE" } }),
      },
      {
        method: "GET",
        match: "/configuration/Securityprofile.sp_de_sales_rep__c",
        reply: () =>
          failure("MALFORMED_URL", "Component sp_de_sales_rep__c not found"),
      },
      { method: "POST", match: "/query", reply: () => success({ data: [] }) },
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
            data: [{ responseStatus: "SUCCESS", data: { id: "V0A000000001" } }],
          }),
      },
      {
        method: "POST",
        match: "/vobjects/vmobile_object_configuration__v",
        reply: () =>
          success({
            data: [{ responseStatus: "SUCCESS", data: { id: "V0B000000001" } }],
          }),
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
    // record bodies go out as a one-element array (bulk create shape)
    const appCall = ff.callsTo("/vobjects/application_profile__v")[0]!;
    expect(JSON.parse(appCall.body!)).toEqual([{ name__v: "DE sales rep" }]);
    const vmocCall = ff.callsTo(
      "/vobjects/vmobile_object_configuration__v",
    )[0]!;
    expect(JSON.parse(vmocCall.body!)).toEqual([
      { name__v: "x", application_profile__v: "V0A000000001" },
    ]);
    // VQL prechecks, scoped to the application profile once it is known
    expect(ff.callsTo("/query").map((q) => vql(q.body))).toEqual([
      "SELECT id FROM application_profile__v WHERE name__v = 'DE sales rep'",
      "SELECT id FROM vmobile_object_configuration__v WHERE name__v = 'x' AND application_profile__v = 'V0A000000001'",
    ]);
    const mdlCalls = ff.callsTo("/mdl/execute");
    expect(mdlCalls).toHaveLength(3);
    expect(
      mdlCalls.every((m) => m.headers["content-type"] === "text/plain"),
    ).toBe(true);
    expect(mdlCalls[0]!.body).toContain("ADD Field foo__c");
  });

  it("re-run: existing components are skipped and existing records updated with PUT, never created twice", async () => {
    const { ff, c } = await client([
      {
        method: "GET",
        match: "/metadata/",
        reply: () => success({ object: { name: "thing__c" } }),
      },
      {
        method: "GET",
        match: "/configuration/",
        reply: () => success({ data: { name: "present" } }),
      },
      {
        method: "POST",
        match: "/query",
        reply: (req) =>
          success({
            data: [
              {
                id: vql(req.body)?.includes("application_profile__v WHERE")
                  ? "V0A000000001"
                  : "V0B000000001",
              },
            ],
          }),
      },
      {
        method: "PUT",
        match: "/vobjects/",
        reply: () => success({ data: { id: "ignored", url: "x" } }),
      },
    ]);
    const report = await applyVaultPlan(c, PLAN, {
      dryRun: false,
      now: NOW,
      allowReview: true,
    });
    const r = byId(report);
    expect(report.ok).toBe(true);
    expect(ff.callsTo("/mdl/execute")).toHaveLength(0);
    expect(
      ff.calls.filter(
        (x) => x.method === "POST" && !x.url.pathname.endsWith("/query"),
      ),
    ).toHaveLength(0);
    for (const id of [
      "obj:thing__c",
      "field:call2__v.foo__c",
      "ps:DE.sales_rep",
      "sp:DE.sales_rep",
    ])
      expect(r[id]?.status, id).toBe("skipped");
    expect(r["ps:DE.sales_rep"]?.message).toBe(
      "already present: Permissionset.ps_de_sales_rep__c present",
    );
    expect(r["app:DE.sales_rep"]).toMatchObject({
      status: "applied",
      message:
        'PUT /vobjects/application_profile__v/V0A000000001 → SUCCESS (application_profile__v record "DE sales rep" exists (V0A000000001)) (record V0A000000001)',
    });
    const puts = ff.calls.filter((x) => x.method === "PUT");
    expect(puts.map((p) => p.url.pathname)).toEqual([
      "/api/v26.2/vobjects/application_profile__v/V0A000000001",
      "/api/v26.2/vobjects/vmobile_object_configuration__v/V0B000000001",
    ]);
    // single-record update: bare object, placeholder resolved from the precheck id
    expect(JSON.parse(puts[1]!.body!)).toEqual({
      name__v: "x",
      application_profile__v: "V0A000000001",
    });
  });

  it("fails a step (and sends nothing) when its precheck errors for any reason other than not-found", async () => {
    const { ff, c } = await client([
      {
        method: "GET",
        match: "/metadata/vobjects/thing__c",
        reply: () => ({ status: 500, text: "boom" }),
      },
      {
        method: "GET",
        match: "/metadata/vobjects/call2__v/fields/foo__c",
        reply: () => failure("INVALID_DATA", "Field [foo__c] does not exist"),
      },
      {
        method: "GET",
        match: "/configuration/",
        reply: () =>
          failure("INSUFFICIENT_ACCESS", "User does not have permission"),
      },
      {
        method: "POST",
        match: "/mdl/execute",
        reply: () => success({ statement_execution: [] }),
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
      message: expect.stringMatching(
        /^precheck failed: GET \/metadata\/vobjects\/thing__c → HTTP 500/,
      ),
    });
    expect(r["field:call2__v.foo__c"]?.status).toBe("applied");
    // ps is blocked by obj; sp depends on ps → both never reach the vault
    expect(r["ps:DE.sales_rep"]?.status).toBe("skipped");
    const mdl = ff.callsTo("/mdl/execute");
    expect(mdl).toHaveLength(1);
    expect(mdl[0]!.body).toContain("ADD Field foo__c");
    expect(mdl.some((m) => m.body?.includes("CREATE Object"))).toBe(false);

    // a permission error on a component precheck also fails instead of running CREATE
    const { ff: ff2, c: c2 } = await client([
      {
        method: "GET",
        match: "/configuration/",
        reply: () =>
          failure("INSUFFICIENT_ACCESS", "User does not have permission"),
      },
      {
        method: "POST",
        match: "/mdl/execute",
        reply: () => success({ statement_execution: [] }),
      },
    ]);
    const report2 = await applyVaultPlan(
      c2,
      testPlan([{ ...PLAN.steps[3]!, dependsOn: [] }]),
      { dryRun: false, now: NOW },
    );
    expect(byId(report2)["ps:DE.sales_rep"]).toMatchObject({
      status: "failed",
      message: expect.stringContaining(
        "precheck failed: GET /configuration/Permissionset.ps_de_sales_rep__c → FAILURE: INSUFFICIENT_ACCESS",
      ),
    });
    expect(ff2.callsTo("/mdl/execute")).toHaveLength(0);
  });

  it("fails a record step whose per-record status is not SUCCESS even though the envelope is", async () => {
    const { c } = await client([
      ...ABSENT,
      {
        method: "POST",
        match: "/vobjects/application_profile__v",
        reply: () =>
          success({
            data: [{ responseStatus: "SUCCESS", data: { id: "V0A" } }],
          }),
      },
      {
        method: "POST",
        match: "/vobjects/vmobile_object_configuration__v",
        reply: () =>
          success({
            data: [
              {
                responseStatus: "FAILURE",
                errors: [
                  {
                    type: "INVALID_DATA",
                    message: "where_clause__v is invalid",
                  },
                ],
              },
            ],
          }),
      },
    ]);
    const report = await applyVaultPlan(
      c,
      testPlan([PLAN.steps[4]!, PLAN.steps[5]!]),
      { dryRun: false, now: NOW },
    );
    const r = byId(report);
    expect(report.ok).toBe(false);
    expect(r["app:DE.sales_rep"]?.status).toBe("applied");
    expect(r["vmoc:DE.sales_rep.call2__v.ipad"]).toMatchObject({
      status: "failed",
      message:
        "POST /vobjects/vmobile_object_configuration__v → record FAILURE: INVALID_DATA: where_clause__v is invalid",
    });
  });

  it("adds only the picklist values that are missing and skips when all are present", async () => {
    const step = mk({
      id: "picklist-values:call_type__v",
      kind: "api",
      api: {
        method: "POST",
        path: "/objects/picklists/call_type__v",
        body: { value_1: "Lunch and Learn", value_2: "Webinar" },
        contentType: "application/x-www-form-urlencoded",
      },
    });
    const { ff, c } = await client([
      {
        method: "GET",
        match: "/objects/picklists/call_type__v",
        reply: () =>
          success({
            picklistValues: [
              { name: "detail__v", label: "Detail", status: "active" },
              {
                name: "lunch_and_learn__c",
                label: "Lunch and Learn",
                status: "active",
              },
            ],
          }),
      },
      {
        method: "POST",
        match: "/objects/picklists/call_type__v",
        reply: () => success({ picklistValues: [{ name: "webinar__c" }] }),
      },
    ]);
    const report = await applyVaultPlan(c, testPlan([step]), {
      dryRun: false,
      now: NOW,
    });
    expect(byId(report)["picklist-values:call_type__v"]).toMatchObject({
      status: "applied",
      message:
        "POST /objects/picklists/call_type__v → SUCCESS (1 of 2 values already present)",
    });
    const post = ff
      .callsTo("/objects/picklists/call_type__v")
      .find((x) => x.method === "POST")!;
    expect(post.body).toBe("value_1=Webinar");

    const { ff: ff2, c: c2 } = await client([
      {
        method: "GET",
        match: "/objects/picklists/call_type__v",
        reply: () =>
          success({
            picklistValues: [
              { name: "lunch_and_learn__c", label: "Lunch and Learn" },
              { name: "webinar__c", label: "WEBINAR " },
            ],
          }),
      },
    ]);
    const report2 = await applyVaultPlan(c2, testPlan([step]), {
      dryRun: false,
      now: NOW,
    });
    expect(byId(report2)["picklist-values:call_type__v"]).toMatchObject({
      status: "skipped",
      message:
        "already present: picklist call_type__v already has all 2 values",
    });
    expect(ff2.calls.filter((x) => x.method === "POST")).toHaveLength(0);
  });

  it("skips review steps (and their dependants) unless allowReview", async () => {
    const { c } = await client([
      ...ABSENT,
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
      ...ABSENT,
      {
        method: "POST",
        match: "/mdl/execute",
        reply: (req) =>
          req.body?.includes("CREATE Object")
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
      ...ABSENT,
      {
        method: "POST",
        match: "/mdl/execute",
        reply: (req) =>
          req.body?.includes("CREATE Object")
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
      ...ABSENT,
      {
        method: "POST",
        match: "/vobjects/",
        reply: () => success({ data: [{ responseStatus: "SUCCESS" }] }),
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

    const { c: c2 } = await client([
      ...ABSENT,
      {
        method: "POST",
        match: "/vobjects/",
        reply: () => success({ data: [] }),
      },
    ]);
    const report2 = await applyVaultPlan(
      c2,
      testPlan(
        [PLAN.steps[5]!].map((s) => ({
          ...s,
          dependsOn: [],
          api: { ...s.api!, body: { name__v: "x" } },
        })),
      ),
      {
        dryRun: false,
        now: NOW,
      },
    );
    expect(byId(report2)["vmoc:DE.sales_rep.call2__v.ipad"]).toMatchObject({
      status: "failed",
      message: expect.stringContaining("no record in the response"),
    });
  });

  it("uses execute_async when asked", async () => {
    const { ff, c } = await client([
      ...ABSENT,
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
  it("reads the target of an MDL script from its head, ignoring comments and RECREATE", () => {
    expect(mdlTarget("-- c\nCREATE Object foo__c (\n label('x')\n);")).toEqual({
      kind: "component",
      type: "Object",
      name: "foo__c",
    });
    expect(mdlTarget("RECREATE Pagelayout call2__v.call_de__c ();")).toEqual({
      kind: "component",
      type: "Pagelayout",
      name: "call2__v.call_de__c",
    });
    expect(mdlTarget("ALTER Object call2__v (\n  ADD Field foo__c (")).toEqual({
      kind: "field",
      object: "call2__v",
      name: "foo__c",
    });
    expect(
      mdlTarget("ALTER Object call2__v ( ADD Objecttype hospital__c ("),
    ).toEqual({ kind: "objecttype", object: "call2__v", name: "hospital__c" });
    expect(mdlTarget("DROP Object foo__c;")).toBeNull();
  });

  it("only treats a positive not-found answer as absent", () => {
    const err = (status: number, type: string, message: string) =>
      new VaultApiError("x", {
        status,
        errors: [{ type, message }],
        method: "GET",
        path: "/p",
      });
    expect(isNotFoundError(err(404, "UNKNOWN", ""))).toBe(true);
    expect(
      isNotFoundError(err(200, "INVALID_DATA", "Object [x] does not exist")),
    ).toBe(true);
    expect(
      isNotFoundError(err(200, "MALFORMED_URL", "no such component")),
    ).toBe(true);
    expect(isNotFoundError(err(200, "INVALID_DATA", "Value too long"))).toBe(
      false,
    );
    expect(isNotFoundError(err(500, "EXCEPTION", "internal error"))).toBe(
      false,
    );
    expect(isNotFoundError(err(429, "API_LIMIT_EXCEEDED", "burst limit"))).toBe(
      false,
    );
    expect(
      isNotFoundError(
        err(200, "INSUFFICIENT_ACCESS", "does not exist or no access"),
      ),
    ).toBe(false);
    expect(isNotFoundError(new Error("does not exist"))).toBe(false);
  });

  it("escapes VQL string literals", () => {
    expect(vqlString("O'Brien \\ x")).toBe("'O\\'Brien \\\\ x'");
  });

  it("summarises per-record failures", () => {
    expect(
      recordFailureMessage({ data: [{ responseStatus: "SUCCESS" }] }),
    ).toBeNull();
    expect(recordFailureMessage({ data: { id: "1" } })).toBeNull();
    expect(
      recordFailureMessage({
        data: [
          { responseStatus: "SUCCESS" },
          {
            responseStatus: "FAILURE",
            errors: [{ type: "INVALID_DATA", message: "bad" }, "raw"],
          },
        ],
      }),
    ).toBe("FAILURE: INVALID_DATA: bad; raw");
  });

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
