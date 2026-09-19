import { describe, expect, it } from "vitest";
import { parseCountryOf } from "../country-of";
import {
  buildDescribe,
  buildMaterialisedMapping,
  sampleCall2Describe,
} from "../testkit";
import { parseTransform } from "../transform/spec";
import type { FieldMapping } from "../types";
import { buildColumnList, mappingFkColumns, rowSources } from "./columns";
import { makeTarget } from "./test-helpers";

function row(
  source: string,
  target: string,
  transform: string,
  required: FieldMapping["required"] = "n",
): FieldMapping {
  return { source, target, transform: parseTransform(transform), required };
}

const mapping = buildMaterialisedMapping({
  objectKey: "call2",
  sourceObject: "Call2_vod__c",
  targetObject: "call2__v",
  countryOf: parseCountryOf(["account", "user:User_vod__c", "user:OwnerId"]),
  scope: {
    spec: {
      kind: "dated",
      predicates: [{ field: "Call_Date_vod__c", type: "date" }],
      openPredicate: "Status_vod__c = 'Planned_vod'",
    },
    cutoffDate: "2024-09-09",
    historyMonths: 24,
  },
  load: {
    noTriggers: true,
    partitionBy: { field: "Parent_Call_vod__c", order: ["null", "notNull"] },
  },
  match: [
    { method: "legacy_id" },
    {
      method: "mobile_id",
      keys: [{ target: "mobile_id__v", source: "Mobile_ID_vod__c" }],
    },
  ],
  selfRefs: [{ target: "parent_call__v", source: "Parent_Call_vod__c" }],
  fields: [
    row("Id", "legacy_crm_id__v", "legacyId", "K"),
    row("Account_vod__c", "account__v", "ref(account)", "Y"),
    row("User_vod__c", "user__v", "refUser"),
    row("OwnerId", "ownerid__v", "refUser"),
    row("Status_vod__c", "status_vod__v", "picklist(call2.status)"),
    row("Nonexistent_vod__c", "nonexistent__v", "text"),
    row("Is_Parent_Call_vod__c", "is_parent_call__v", "skip"),
    row("Parent_Call_vod__c", "parent_call__v", "ref(call2) secondPass"),
    row("Signature_vod__c", "signature__v", "deferredBlob(signature)"),
    row("Unknown_rel__r.Name", "x__v", "text"),
    row(
      "",
      "external_id__v",
      "compositeExternalId('{u}__{t}', u=user:User_vod__c, t=field:Territory_vod__c)",
    ),
  ],
});

describe("buildColumnList", () => {
  it("mapped ∩ describe ∪ system ∪ relationship paths, in a stable order", () => {
    const { columns, fkColumns, dropped } = buildColumnList(
      mapping,
      makeTarget("call2", sampleCall2Describe()),
      {
        countryPaths: [
          "Account_vod__r.Country_vod__r.Alpha_2_Code_vod__c",
          "User_vod__r.Country_vod__c",
          "Owner.Country_vod__c",
        ],
      },
    );
    expect(columns.slice(0, 7)).toEqual([
      "Id",
      "IsDeleted",
      "SystemModstamp",
      "CreatedDate",
      "CreatedById",
      "LastModifiedDate",
      "LastModifiedById",
    ]);
    expect(columns).toContain("OwnerId");
    expect(columns).toContain("RecordTypeId");
    expect(columns).toContain("RecordType.DeveloperName");
    expect(columns).toContain("Account_vod__c");
    expect(columns).toContain("Status_vod__c");
    expect(columns).toContain("Parent_Call_vod__c"); // secondPass unwrapped + partition + selfRef
    expect(columns).toContain("Signature_vod__c"); // deferredBlob source still extracted
    expect(columns).toContain("Territory_vod__c"); // composite part
    expect(columns).toContain("Mobile_ID_vod__c"); // match key
    expect(columns).toContain("Call_Date_vod__c"); // scope date
    expect(columns).toContain(
      "Account_vod__r.Country_vod__r.Alpha_2_Code_vod__c",
    );
    expect(columns).toContain("Owner.Country_vod__c");
    expect(columns).not.toContain("Nonexistent_vod__c");
    expect(columns).not.toContain("Is_Parent_Call_vod__c"); // skip transform
    expect(columns).not.toContain("Unknown_rel__r.Name"); // unknown relationship
    expect(columns).not.toContain("");
    expect(new Set(columns).size).toBe(columns.length);
    expect(dropped).toEqual(
      expect.arrayContaining(["Nonexistent_vod__c", "Unknown_rel__r.Name"]),
    );

    expect(fkColumns).toEqual(
      expect.arrayContaining([
        {
          column: "Account_vod__c",
          targetObjectKey: "account",
          polymorphic: false,
        },
        { column: "User_vod__c", targetObjectKey: "user", polymorphic: false },
        { column: "OwnerId", targetObjectKey: "user", polymorphic: true },
        {
          column: "Parent_Call_vod__c",
          targetObjectKey: "call2",
          polymorphic: false,
        },
        { column: "CreatedById", targetObjectKey: "user", polymorphic: false },
        {
          column: "LastModifiedById",
          targetObjectKey: "user",
          polymorphic: false,
        },
      ]),
    );
    expect(fkColumns.filter((f) => f.column === "OwnerId")).toHaveLength(1);
  });

  it("honours the preflight column list for plain columns", () => {
    const { columns } = buildColumnList(
      mapping,
      makeTarget("call2", sampleCall2Describe(), {
        columns: ["Account_vod__c"],
      }),
    );
    expect(columns).toContain("Account_vod__c");
    // Status_vod__c is in the describe, so it stays even when preflight listed only Account
    expect(columns).toContain("Status_vod__c");
  });

  it("only Id is forced: IsDeleted / SystemModstamp follow the describe", () => {
    const describe = buildDescribe(
      "Territory2",
      [{ name: "Name", type: "string" }],
      { systemFields: false },
    );
    describe.fields.push({
      ...describe.fields[0],
      name: "SystemModstamp",
      type: "datetime",
    });
    const m = buildMaterialisedMapping({
      objectKey: "territory",
      sourceObject: "Territory2",
      targetObject: "territory__v",
      countryOf: parseCountryOf("global"),
      fields: [
        row("Id", "legacy_crm_id__v", "legacyId", "K"),
        row("Name", "name__v", "text", "Y"),
      ],
    });
    const { columns } = buildColumnList(m, makeTarget("territory", describe));
    expect(columns).toContain("Id");
    expect(columns).toContain("SystemModstamp");
    expect(columns).not.toContain("IsDeleted");
    expect(columns).not.toContain("CreatedDate");
  });

  it("trusts every mapped column when no describe is available", () => {
    const { columns, dropped } = buildColumnList(mapping, undefined);
    expect(columns).toContain("Nonexistent_vod__c");
    expect(columns).toContain("Unknown_rel__r.Name");
    expect(dropped).toEqual([]);
    expect(columns.slice(0, 3)).toEqual(["Id", "IsDeleted", "SystemModstamp"]);
  });

  it("rowSources / mappingFkColumns unwrap secondPass and composite parts", () => {
    expect(
      rowSources(row("Parent_Call_vod__c", "p", "ref(call2) secondPass")),
    ).toEqual(["Parent_Call_vod__c"]);
    expect(
      rowSources(row("X", "x", "statusFromFlag(Inactive_vod__c, true)")),
    ).toEqual(["X", "Inactive_vod__c"]);
    expect(rowSources(row("X", "x", "skip"))).toEqual([]);
    expect(mappingFkColumns(mapping)).toEqual(
      expect.arrayContaining([
        { column: "Parent_Call_vod__c", targetObjectKey: "call2" },
        { column: "User_vod__c", targetObjectKey: "user" },
      ]),
    );
  });
});
