import { describe, expect, it } from "vitest";
import {
  assertBatch,
  csvCell,
  mapBulkResponse,
  toCsv,
  writeHeaders,
} from "./records";
import { API, authRoutes, failureBody, makeTestClient } from "./test-support";
import type { VaultRow } from "./types";

const ok = (id: string, event = "create") => ({
  responseStatus: "SUCCESS",
  data: { id, url: `${API}/vobjects/account__v/${id}`, event },
});

describe("write headers (§2.5.4)", () => {
  it("sends MigrationMode, NoTriggers (only with MigrationMode) and UnchangedFieldBehavior", () => {
    expect(writeHeaders({ migrationMode: true, noTriggers: true })).toEqual({
      "X-VaultAPI-UnchangedFieldBehavior": "AlwaysIgnore",
      "X-VaultAPI-MigrationMode": "true",
      "X-VaultAPI-NoTriggers": "true",
    });
    expect(
      writeHeaders({
        migrationMode: false,
        noTriggers: true,
        unchangedFieldBehavior: "NeverIgnore",
      }),
    ).toEqual({
      "X-VaultAPI-UnchangedFieldBehavior": "NeverIgnore",
    });
    expect(
      writeHeaders(
        {},
        {
          migrationMode: false,
          unchangedFieldBehavior: "IgnoreSetOnCreateOnly",
        },
      ),
    ).toEqual({
      "X-VaultAPI-UnchangedFieldBehavior": "IgnoreSetOnCreateOnly",
    });
  });

  it("guards the batch client-side: > 500 rows, missing and duplicate idParam values", () => {
    const rows = (n: number): VaultRow[] =>
      Array.from({ length: n }, (_, i) => ({ legacy_crm_id__v: `id${i}` }));
    expect(() => assertBatch(rows(501), "legacy_crm_id__v")).toThrow(/max 500/);
    expect(() => assertBatch(rows(500), "legacy_crm_id__v")).not.toThrow();
    expect(() =>
      assertBatch(
        [{ legacy_crm_id__v: "a" }, { legacy_crm_id__v: "a" }],
        "legacy_crm_id__v",
      ),
    ).toThrow(/Duplicate idParam value \[a\]/);
    expect(() => assertBatch([{ name__v: "x" }], "legacy_crm_id__v")).toThrow(
      /missing the idParam/,
    );
  });

  it("maps row results in input order and rejects misaligned responses", () => {
    const body = {
      responseStatus: "SUCCESS",
      data: [
        ok("V1"),
        {
          responseStatus: "FAILURE",
          errors: [{ type: "INVALID_DATA", message: "bad" }],
        },
      ],
    };
    const r = mapBulkResponse(body, 2, { burstLimitRemaining: 10 });
    expect(r.data[0]).toEqual({
      responseStatus: "SUCCESS",
      data: { id: "V1", url: `${API}/vobjects/account__v/V1`, event: "create" },
    });
    expect(r.data[1]).toEqual({
      responseStatus: "FAILURE",
      errors: [{ type: "INVALID_DATA", message: "bad" }],
    });
    expect(r.burst).toEqual({ burstLimitRemaining: 10 });
    expect(() => mapBulkResponse(body, 3, {})).toThrow(/cannot align/);
  });

  it("builds RFC 4180 CSV", () => {
    expect(csvCell('a "quoted", value')).toBe('"a ""quoted"", value"');
    expect(csvCell(null)).toBe("");
    expect(
      toCsv([
        { id: "1", "object_type__v.api_name__v": "x__v" },
        { id: "2", extra__v: "y\nz" },
      ]),
    ).toBe('id,object_type__v.api_name__v,extra__v\n1,x__v,\n2,,"y\nz"\n');
  });
});

describe("upsert / update / delete", () => {
  it("POSTs ≤ 500 JSON rows with ?idParam and the write headers; results in input order", async () => {
    const t = makeTestClient(
      [
        ...authRoutes(),
        {
          method: "POST",
          path: `${API}/vobjects/account__v`,
          body: {
            responseStatus: "SUCCESS",
            data: [
              ok("V1"),
              {
                responseStatus: "FAILURE",
                errors: [
                  { type: "INVALID_DATA", message: "Field [x] too long" },
                ],
              },
              ok("V3", "update"),
            ],
          },
        },
      ],
      { migrationMode: true, referenceId: "run-1" },
    );
    await t.client.authenticate();
    const rows: VaultRow[] = [
      { legacy_crm_id__v: "001A", name__v: "A" },
      { legacy_crm_id__v: "001B", name__v: "B" },
      { legacy_crm_id__v: "001C", name__v: "C" },
    ];
    const res = await t.client.upsert("account__v", rows, {
      idParam: "legacy_crm_id__v",
      noTriggers: true,
      referenceId: "run-1:account:3",
    });
    expect(res.responseStatus).toBe("SUCCESS");
    expect(res.data.map((r) => r.responseStatus)).toEqual([
      "SUCCESS",
      "FAILURE",
      "SUCCESS",
    ]);
    expect(res.data[0].data?.id).toBe("V1");
    expect(res.data[1].errors?.[0].type).toBe("INVALID_DATA");
    expect(res.data[2].data?.event).toBe("update");
    expect(res.burst.burstLimitRemaining).toBe(1999);
    const call = t.fetch.calls.at(-1)!;
    expect(call.method).toBe("POST");
    expect(call.search.get("idParam")).toBe("legacy_crm_id__v");
    expect(call.headers["content-type"]).toBe("application/json");
    expect(call.headers["x-vaultapi-migrationmode"]).toBe("true");
    expect(call.headers["x-vaultapi-notriggers"]).toBe("true");
    expect(call.headers["x-vaultapi-unchangedfieldbehavior"]).toBe(
      "AlwaysIgnore",
    );
    expect(call.headers["x-vaultapi-referenceid"]).toBe("run-1:account:3");
    expect(call.json).toEqual(rows);
  });

  it("uses the client defaults for migrationMode / unchangedFieldBehavior when the call passes none", async () => {
    const t = makeTestClient(
      [
        ...authRoutes(),
        {
          method: "POST",
          path: `${API}/vobjects/account__v`,
          body: { responseStatus: "SUCCESS", data: [ok("V1")] },
        },
      ],
      { migrationMode: false, unchangedFieldBehavior: "NeverIgnore" },
    );
    await t.client.authenticate();
    await t.client.upsert("account__v", [{ legacy_crm_id__v: "a" }], {
      idParam: "legacy_crm_id__v",
      noTriggers: true,
    });
    const call = t.fetch.calls.at(-1)!;
    expect(call.headers["x-vaultapi-migrationmode"]).toBeUndefined();
    expect(call.headers["x-vaultapi-notriggers"]).toBeUndefined();
    expect(call.headers["x-vaultapi-unchangedfieldbehavior"]).toBe(
      "NeverIgnore",
    );
  });

  it("refuses duplicate idParam values and > 500 rows before spending a call", async () => {
    const t = makeTestClient(authRoutes());
    await t.client.authenticate();
    const before = t.fetch.calls.length;
    await expect(
      t.client.upsert(
        "account__v",
        [{ legacy_crm_id__v: "a" }, { legacy_crm_id__v: "a" }],
        { idParam: "legacy_crm_id__v" },
      ),
    ).rejects.toMatchObject({ type: "INVALID_DATA", errorClass: "structural" });
    await expect(
      t.client.upsert(
        "account__v",
        Array.from({ length: 501 }, (_, i) => ({ legacy_crm_id__v: `id${i}` })),
        { idParam: "legacy_crm_id__v" },
      ),
    ).rejects.toMatchObject({ type: "INVALID_DATA" });
    await expect(
      t.client.upsert("account__v", [{ legacy_crm_id__v: "a" }], {}),
    ).rejects.toMatchObject({ type: "PARAMETER_REQUIRED" });
    expect(t.fetch.calls.length).toBe(before);
    expect(
      (await t.client.upsert("account__v", [], { idParam: "legacy_crm_id__v" }))
        .data,
    ).toEqual([]);
  });

  it("an outer FAILURE (structural: unknown column) throws and is not retried", async () => {
    const t = makeTestClient([
      ...authRoutes(),
      {
        method: "POST",
        path: `${API}/vobjects/account__v`,
        body: failureBody("INVALID_DATA", "Unknown field [foo__v]"),
      },
    ]);
    await t.client.authenticate();
    await expect(
      t.client.upsert("account__v", [{ legacy_crm_id__v: "a", foo__v: 1 }], {
        idParam: "legacy_crm_id__v",
      }),
    ).rejects.toMatchObject({
      type: "INVALID_DATA",
      status: "FAILURE",
      errorClass: "structural",
    });
    expect(t.sleeps).toEqual([]);
  });

  it("update PUTs by id (WARNING = unchanged is a success) and supports ?idParam", async () => {
    const t = makeTestClient([
      ...authRoutes(),
      {
        method: "PUT",
        path: `${API}/vobjects/account__v`,
        body: {
          responseStatus: "WARNING",
          data: [
            {
              responseStatus: "WARNING",
              data: { id: "V1" },
              warnings: [{ type: "NO_CHANGE", message: "unchanged" }],
            },
          ],
        },
      },
      {
        method: "PUT",
        path: `${API}/vobjects/account__v`,
        body: { responseStatus: "SUCCESS", data: [ok("V2", "update")] },
      },
    ]);
    await t.client.authenticate();
    const r = await t.client.update("account__v", [
      { id: "V1", parent_account__v: "V9" },
    ]);
    expect(r.responseStatus).toBe("WARNING");
    expect(r.data[0].warnings?.[0].type).toBe("NO_CHANGE");
    expect(t.fetch.calls.at(-1)?.search.has("idParam")).toBe(false);
    await t.client.update(
      "account__v",
      [{ legacy_crm_id__v: "x", inactive__v: true }],
      { idParam: "legacy_crm_id__v" },
    );
    expect(t.fetch.calls.at(-1)?.search.get("idParam")).toBe(
      "legacy_crm_id__v",
    );
    await expect(
      t.client.update("account__v", [{ id: "V1" }, { id: "V1" }]),
    ).rejects.toMatchObject({ type: "INVALID_DATA" });
  });

  it("deleteRecords sends a DELETE with an id list (≤ 500, unique)", async () => {
    const t = makeTestClient([
      ...authRoutes(),
      {
        method: "DELETE",
        path: `${API}/vobjects/account__v`,
        body: {
          responseStatus: "SUCCESS",
          data: [
            { responseStatus: "SUCCESS", data: { id: "V1" } },
            {
              responseStatus: "FAILURE",
              errors: [{ type: "INVALID_DATA", message: "gone" }],
            },
          ],
        },
      },
    ]);
    await t.client.authenticate();
    const r = await t.client.deleteRecords("account__v", ["V1", "V2"], {
      referenceId: "run:account:del",
    });
    expect(r.data.map((x) => x.responseStatus)).toEqual(["SUCCESS", "FAILURE"]);
    const call = t.fetch.calls.at(-1)!;
    expect(call.json).toEqual([{ id: "V1" }, { id: "V2" }]);
    expect(call.headers["x-vaultapi-migrationmode"]).toBe("true");
    await expect(
      t.client.deleteRecords("account__v", ["V1", "V1"]),
    ).rejects.toMatchObject({ type: "INVALID_DATA" });
  });
});

describe("actions, attachments, deletions feed", () => {
  it("changeType posts CSV with id and object_type__v.api_name__v", async () => {
    const t = makeTestClient([
      ...authRoutes(),
      {
        method: "POST",
        path: `${API}/vobjects/call2__v/actions/changetype`,
        body: {
          responseStatus: "SUCCESS",
          data: [{ responseStatus: "SUCCESS", data: { id: "V1" } }],
        },
      },
    ]);
    await t.client.authenticate();
    const r = await t.client.changeType!("call2__v", [
      { id: "V1", objectType: "group_call__v", extra__v: "x" },
    ]);
    expect(r.data[0].data?.id).toBe("V1");
    const call = t.fetch.calls.at(-1)!;
    expect(call.headers["content-type"]).toBe("text/csv");
    expect(call.bodyText).toBe(
      "id,object_type__v.api_name__v,extra__v\nV1,group_call__v,x\n",
    );
  });

  it("addAttachment posts multipart with a `file` part", async () => {
    const t = makeTestClient([
      ...authRoutes(),
      {
        method: "POST",
        path: `${API}/vobjects/em_event__v/V1/attachments`,
        body: { responseStatus: "SUCCESS", data: { id: 1 } },
      },
    ]);
    await t.client.authenticate();
    await t.client.addAttachment!("em_event__v", "V1", {
      name: "sig.png",
      content: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
    });
    const call = t.fetch.calls.at(-1)!;
    expect(call.formData).toBeDefined();
    const file = call.formData!.get("file") as File;
    expect(file.name).toBe("sig.png");
    expect(file.size).toBe(3);
    expect(call.headers["content-type"]).toBeUndefined(); // boundary set by fetch
  });

  it("cascadeDelete returns the job id", async () => {
    const t = makeTestClient([
      ...authRoutes(),
      {
        method: "POST",
        path: `${API}/vobjects/account__v/V1/actions/cascadedelete`,
        body: {
          responseStatus: "SUCCESS",
          job_id: 42,
          url: "/api/v26.2/services/jobs/42",
        },
      },
    ]);
    await t.client.authenticate();
    expect(await t.client.cascadeDelete("account__v", "V1")).toEqual({
      jobId: "42",
      url: "/api/v26.2/services/jobs/42",
    });
  });

  it("deletedRecords paginates the deletions feed by offset", async () => {
    const t = makeTestClient([
      ...authRoutes(),
      {
        method: "GET",
        path: `${API}/objects/deletions/vobjects/account__v`,
        persist: true,
        handler: (req) => {
          const offset = Number(req.search.get("offset"));
          const all = [
            { id: "V1", date_deleted: "2026-09-01T00:00:00.000Z" },
            { id: "V2", date_deleted: "2026-09-02T00:00:00.000Z" },
            { id: "V3" },
          ];
          const data = all.slice(offset, offset + 2);
          return {
            body: {
              responseStatus: "SUCCESS",
              responseDetails: { total: 3, limit: 2, offset },
              data,
            },
          };
        },
      },
    ]);
    await t.client.authenticate();
    const ids: string[] = [];
    for await (const d of t.client.deletedRecords("account__v", {
      startDate: "2026-08-10T00:00:00Z",
      limit: 2,
    }))
      ids.push(d.id);
    expect(ids).toEqual(["V1", "V2", "V3"]);
    const first = t.fetch.calls.find((c) =>
      c.pathname.includes("/deletions/"),
    )!;
    expect(first.search.get("start_date")).toBe("2026-08-10T00:00:00Z");
    expect(first.search.get("limit")).toBe("2");
    expect(
      t.fetch.calls.filter((c) => c.pathname.includes("/deletions/")),
    ).toHaveLength(2);
  });

  it("probeObjectAction: available via metadata urls, cached, and objectAction POSTs", async () => {
    const t = makeTestClient([
      ...authRoutes(),
      {
        method: "GET",
        path: `${API}/metadata/vobjects/sample_lot__v`,
        body: {
          responseStatus: "SUCCESS",
          object: {
            name: "sample_lot__v",
            status: ["active__v"],
            fields: [],
            urls: {
              recalculate_rollups: `${API}/vobjects/sample_lot__v/actions/recalculaterollups`,
            },
          },
        },
      },
      {
        method: "POST",
        path: `${API}/vobjects/sample_lot__v/actions/recalculaterollups`,
        body: { responseStatus: "SUCCESS", job_id: 7 },
      },
    ]);
    await t.client.authenticate();
    expect(
      await t.client.probeObjectAction("sample_lot__v", "recalculaterollups"),
    ).toBe("available");
    expect(
      await t.client.probeObjectAction("sample_lot__v", "recalculaterollups"),
    ).toBe("available");
    expect(
      t.fetch.calls.filter((c) =>
        c.pathname.endsWith("/metadata/vobjects/sample_lot__v"),
      ),
    ).toHaveLength(1);
    expect(
      await t.client.objectAction!("sample_lot__v", "recalculaterollups"),
    ).toEqual({ ok: true, jobId: "7" });
  });

  it("probeObjectAction: absent when urls lack it and OPTIONS/GET reject the path; objectAction reports ok:false", async () => {
    const t = makeTestClient([
      ...authRoutes(),
      {
        method: "GET",
        path: `${API}/metadata/vobjects/order__v`,
        body: {
          responseStatus: "SUCCESS",
          object: {
            name: "order__v",
            status: [],
            fields: [],
            urls: { list: "/x" },
          },
        },
      },
      {
        method: "OPTIONS",
        path: `${API}/vobjects/order__v/actions/recalculaterollups`,
        status: 405,
        body: "",
      },
      {
        method: "GET",
        path: `${API}/vobjects/order__v/actions/recalculaterollups`,
        body: failureBody("MALFORMED_URL"),
      },
    ]);
    await t.client.authenticate();
    expect(
      await t.client.probeObjectAction("order__v", "recalculaterollups"),
    ).toBe("absent");
    const r = await t.client.objectAction!("order__v", "recalculaterollups");
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/not available/);
    expect(
      t.fetch.calls.filter(
        (c) => c.method === "POST" && c.pathname.includes("/actions/"),
      ),
    ).toHaveLength(0);
  });

  it("probeObjectAction: a permission error on the path means the action exists", async () => {
    const t = makeTestClient([
      ...authRoutes(),
      {
        method: "GET",
        path: `${API}/metadata/vobjects/order__v`,
        body: {
          responseStatus: "SUCCESS",
          object: { name: "order__v", status: [], fields: [] },
        },
      },
      {
        method: "OPTIONS",
        path: `${API}/vobjects/order__v/actions/updatecorporatecurrency`,
        body: { responseStatus: "SUCCESS" },
      },
    ]);
    await t.client.authenticate();
    expect(
      await t.client.probeObjectAction("order__v", "updatecorporatecurrency"),
    ).toBe("available");
  });

  it("mergeRecords caps sets at 10", async () => {
    const t = makeTestClient([
      ...authRoutes(),
      {
        method: "POST",
        path: `${API}/vobjects/account__v/actions/merge`,
        body: { responseStatus: "SUCCESS", job_id: "m1" },
      },
    ]);
    await t.client.authenticate();
    expect(
      await t.client.mergeRecords("account__v", [
        { main_record_id: "V1", duplicate_record_id: "V2" },
      ]),
    ).toEqual({ ok: true, jobId: "m1" });
    expect(t.fetch.calls.at(-1)?.json).toEqual([
      { main_record_id: "V1", duplicate_record_id: "V2" },
    ]);
    await expect(
      t.client.mergeRecords(
        "account__v",
        Array.from({ length: 11 }, (_, i) => ({
          main_record_id: "V",
          duplicate_record_id: `D${i}`,
        })),
      ),
    ).rejects.toMatchObject({ type: "INVALID_DATA" });
  });
});
