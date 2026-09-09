import { describe, expect, it } from "vitest";
import {
  buildDescribe,
  buildVaultMetadata,
  IDS,
  resolveMetadata,
  sampleAccountRows,
  sampleCall2Describe,
  sampleCall2Rows,
  sampleCall2VaultMetadata,
} from "./fixtures";
import { to18 } from "../transform/ids";

describe("fixtures", () => {
  it("buildDescribe adds system fields and record types", () => {
    const d = buildDescribe(
      "Foo_vod__c",
      [{ name: "Bar_vod__c", type: "string", length: 10 }],
      {
        recordTypes: [{ developerName: "A_vod" }],
        systemFields: { name: "autoNumber" },
      },
    );
    const names = d.fields.map((f) => f.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "Id",
        "IsDeleted",
        "SystemModstamp",
        "Name",
        "OwnerId",
        "Bar_vod__c",
      ]),
    );
    expect(d.fields.find((f) => f.name === "Name")?.autoNumber).toBe(true);
    expect(d.recordTypeInfos[0].developerName).toBe("A_vod");
    expect(d.replicateable).toBe(true);
    expect(buildDescribe("X", [], { systemFields: false }).fields).toEqual([]);
  });
  it("buildVaultMetadata adds platform fields, legacy id, object types and lifecycle", () => {
    const m = sampleCall2VaultMetadata();
    const names = m.fields.map((f) => f.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "id",
        "name__v",
        "status__v",
        "created_by__v",
        "legacy_crm_id__v",
        "object_type__v",
        "state__v",
        "call_date__v",
      ]),
    );
    expect(m.allow_types).toBe(true);
    expect(
      buildVaultMetadata("x__v", [], { legacyIdField: null }).fields.map(
        (f) => f.name,
      ),
    ).not.toContain("legacy_crm_id__v");
    const r = resolveMetadata(m, {
      picklists: { call2_status__v: ["submitted__v"] },
      lifecycle: { name: "call2_lifecycle__v", states: ["submitted_state__v"] },
    });
    expect(r.legacyIdField).toBe("legacy_crm_id__v");
    expect(r.fields.call2_status__v).toMatchObject({
      type: "picklist",
      picklistValues: ["submitted__v"],
    });
    expect(r.fields.call_date__v.required).toBe(true);
    expect(r.fields.territory__v.maxLength).toBe(100);
    expect(r.objectTypes.call_report__v).toBeDefined();
    expect(r.lifecycle?.states).toEqual(["submitted_state__v"]);
  });
  it("sample rows use checksum-correct ids matching their describes", () => {
    for (const r of [...sampleAccountRows(), ...sampleCall2Rows()])
      expect(to18(r.Id)).toBe(r.Id);
    expect(IDS.call1.slice(0, 15)).toBe("a0K000000000001");
    const cols = new Set(sampleCall2Describe().fields.map((f) => f.name));
    for (const r of sampleCall2Rows())
      for (const k of Object.keys(r))
        if (!k.includes(".")) expect(cols.has(k), k).toBe(true);
  });
});
