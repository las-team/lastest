import { describe, expect, it } from "vitest";
import { VaultApiError } from "../vault/types";
import { FakeVaultClient, parseVql } from "./fake-vault";
import { buildVaultMetadata, sampleAccountVaultMetadata } from "./fixtures";

const collect = async <T>(it: AsyncIterable<T>) => {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
};

async function client() {
  const c = new FakeVaultClient({ pageSize: 2 })
    .addObject(sampleAccountVaultMetadata(), [
      {
        legacy_crm_id__v: "001000000000001AAA",
        name__v: "Jane Doe",
        external_id__v: "NET-1",
        specialty_1__v: "cardiology__v",
      },
      {
        legacy_crm_id__v: "001000000000002AAA",
        name__v: "General Hospital",
        external_id__v: "NET-2",
      },
      { name__v: "Bridged", external_id__v: "NET-3" },
    ])
    .addPicklist("specialty__v", [
      "cardiology__v",
      { name: "retired__v", status: "inactive" },
    ]);
  await c.authenticate();
  return c;
}

describe("FakeVaultClient", () => {
  it("requires a session and enforces the auth burst", async () => {
    const c = new FakeVaultClient().addObject(sampleAccountVaultMetadata());
    await expect(c.vqlCount("SELECT id FROM account__v")).rejects.toThrow(
      /INVALID_SESSION_ID/,
    );
    const s = await c.authenticate();
    expect(s.vaultIds[0].url).toContain(c.vaultDns);
    expect((await c.me()).id).toBe(12345);
    c.expireSession();
    await expect(c.keepAlive()).rejects.toThrow(VaultApiError);
  });
  it("runs the VQL subset with paging, PAGESIZE 0 and picklists as arrays", async () => {
    const c = await client();
    const pages = await collect(
      c.vql(
        "SELECT id, name__v, specialty_1__v FROM account__v WHERE legacy_crm_id__v != null ORDER BY name__v",
      ),
    );
    expect(pages).toHaveLength(1);
    expect(pages[0].responseDetails.total).toBe(2);
    expect(pages[0].data[0].name__v).toBe("General Hospital");
    expect(pages[0].data[1].specialty_1__v).toEqual(["cardiology__v"]);
    const all = await collect(c.vql("SELECT id FROM account__v"));
    expect(all.map((p) => p.data.length)).toEqual([2, 1]);
    expect(all[0].responseDetails.next_page).toBeDefined();
    const [count] = await collect(
      c.vql(
        "SELECT id FROM account__v WHERE external_id__v IN ('NET-1', 'NET-3') PAGESIZE 0",
      ),
    );
    expect(count.responseDetails.total).toBe(2);
    expect(count.data).toEqual([]);
    expect(
      await c.vqlCount(
        "SELECT id FROM account__v WHERE legacy_crm_id__v = null",
      ),
    ).toBe(1);
    expect(
      await c.vqlCount(
        "SELECT id FROM account__v WHERE name__v LIKE 'Gen%' AND external_id__v = 'NET-2'",
      ),
    ).toBe(1);
    expect(
      parseVql("SELECT id FROM x__v WHERE a__v = 'it\\'s' LIMIT 3").limit,
    ).toBe(3);
    await expect(
      c.vqlCount("SELECT id FROM account__v WHERE a__v ~ 1"),
    ).rejects.toThrow(/INVALID_FILTER/);
  });
  it("upserts by idParam with create/update events and validates the batch", async () => {
    const c = await client();
    const res = await c.upsert(
      "account__v",
      [
        { legacy_crm_id__v: "001000000000001AAA", name__v: "Jane Doe-Smith" },
        {
          legacy_crm_id__v: "001000000000009AAA",
          name__v: "New One",
          "object_type__v.api_name__v": "professional__v",
        },
      ],
      { idParam: "legacy_crm_id__v", migrationMode: true, noTriggers: false },
    );
    expect(res.responseStatus).toBe("SUCCESS");
    expect(res.data.map((d) => d.data?.event)).toEqual(["update", "create"]);
    expect(res.data[1].data?.id_param_value).toBe("001000000000009AAA");
    expect(c.record("account__v", res.data[1].data!.id!)?.object_type__v).toBe(
      "professional__v",
    );
    expect(c.calls.at(-1)?.headers).toMatchObject({
      migrationMode: true,
      noTriggers: false,
    });
    await expect(
      c.upsert(
        "account__v",
        [{ legacy_crm_id__v: "a" }, { legacy_crm_id__v: "a" }],
        { idParam: "legacy_crm_id__v" },
      ),
    ).rejects.toThrow(/Duplicate idParam/);
    await expect(
      c.upsert("account__v", [{ legacy_crm_id__v: "b", nope__v: 1 }], {
        idParam: "legacy_crm_id__v",
      }),
    ).rejects.toThrow(/Unknown column/);
    await expect(
      c.upsert("account__v", [{ name__v: "x" }], { idParam: "name__v" }),
    ).rejects.toThrow(/not a unique field/);
    const missing = await c.upsert(
      "account__v",
      [{ legacy_crm_id__v: "001000000000010AAA" }],
      { idParam: "legacy_crm_id__v" },
    );
    expect(missing.data[0]).toMatchObject({
      responseStatus: "FAILURE",
      errors: [{ type: "PARAMETER_REQUIRED" }],
    });
  });
  it("ignores audit/state fields outside migration mode and honours rowFailures", async () => {
    const c = await client();
    await c.upsert(
      "account__v",
      [
        {
          legacy_crm_id__v: "001000000000001AAA",
          created_date__v: "2020-01-01T00:00:00.000Z",
        },
      ],
      { idParam: "legacy_crm_id__v", migrationMode: false },
    );
    expect(c.records("account__v")[0].created_date__v).toBeUndefined();
    await c.upsert(
      "account__v",
      [
        {
          legacy_crm_id__v: "001000000000001AAA",
          created_date__v: "2020-01-01T00:00:00.000Z",
        },
      ],
      { idParam: "legacy_crm_id__v", migrationMode: true },
    );
    expect(c.records("account__v")[0].created_date__v).toBe(
      "2020-01-01T00:00:00.000Z",
    );
    c.rowFailures.push({
      object: "account__v",
      field: "name__v",
      value: "Bad",
      type: "INVALID_DATA",
      message: "bad",
    });
    const r = await c.upsert(
      "account__v",
      [
        { legacy_crm_id__v: "001000000000001AAA", name__v: "Bad" },
        { legacy_crm_id__v: "001000000000002AAA", name__v: "Good" },
      ],
      { idParam: "legacy_crm_id__v" },
    );
    expect(r.data.map((d) => d.responseStatus)).toEqual(["FAILURE", "SUCCESS"]);
  });
  it("update by id returns WARNING on no change; delete removes; users cannot be deleted", async () => {
    const c = await client();
    const id = c.records("account__v")[0].id;
    const u1 = await c.update("account__v", [{ id, name__v: "Renamed" }]);
    expect(u1.data[0]).toMatchObject({
      responseStatus: "SUCCESS",
      data: { id, event: "update" },
    });
    const u2 = await c.update("account__v", [{ id, name__v: "Renamed" }]);
    expect(u2.data[0].responseStatus).toBe("WARNING");
    const u3 = await c.update("account__v", [{ id: "V0X", name__v: "x" }]);
    expect(u3.data[0].responseStatus).toBe("FAILURE");
    const d = await c.deleteRecords("account__v", [id, "nope"]);
    expect(d.data.map((x) => x.responseStatus)).toEqual(["SUCCESS", "FAILURE"]);
    expect(c.records("account__v")).toHaveLength(2);
    c.addObject(buildVaultMetadata("user__sys", []));
    await expect(c.deleteRecords("user__sys", ["1"])).rejects.toThrow(
      /cannot be deleted/,
    );
    // ≤ 500 ids per DELETE /vobjects/{object} call (§2.5.4)
    const many = Array.from({ length: 501 }, (_, i) => `V${i}`);
    await expect(c.deleteRecords("account__v", many)).rejects.toThrow(
      /Maximum 500 records/,
    );
    expect(
      (await c.deleteRecords("account__v", many.slice(0, 500))).data,
    ).toHaveLength(500);
  });
  it("metadata, picklists (active only), object types, MDL and burst counters", async () => {
    const c = await client();
    expect((await c.listObjects()).map((o) => o.name)).toEqual(["account__v"]);
    expect((await c.objectMetadata("account__v")).allow_types).toBe(true);
    expect((await c.fieldMetadata("account__v", "external_id__v")).unique).toBe(
      true,
    );
    expect((await c.picklistValues("specialty__v")).map((v) => v.name)).toEqual(
      ["cardiology__v"],
    );
    await c.setPicklistValueStatus("specialty__v", "retired__v", "active");
    expect(
      (await c.picklistValues("specialty__v")).map((v) => v.name),
    ).toContain("retired__v");
    expect((await c.objectTypes("account__v")).map((t) => t.name)).toEqual([
      "professional__v",
      "hospital__v",
    ]);
    await expect(c.picklistValues("nope__v")).rejects.toThrow(/does not exist/);
    await c.executeMdl(
      "ALTER Object account__v (\n ADD Field legacy_crm_id__c(label('Legacy'), type('String'), max_length(18), unique(true))\n);",
    );
    expect(
      (await c.objectMetadata("account__v")).fields.some(
        (f) => f.name === "legacy_crm_id__c" && f.unique,
      ),
    ).toBe(true);
    expect(c.burst.burstLimitRemaining).toBeLessThan(2000);
    expect(c.burst.executionId).toMatch(/^exec-/);
    const t = await c.changeType("account__v", [
      { id: c.records("account__v")[0].id, objectType: "hospital__v" },
    ]);
    expect(t.data[0].responseStatus).toBe("SUCCESS");
    expect(c.records("account__v")[0].object_type__v).toBe("hospital__v");
  });
});
