import { describe, expect, it } from "vitest";
import {
  assertValidObjectModule,
  blockS,
  defineObject,
  validateObjectModule,
} from "./types";

describe("blockS (§6.0.4)", () => {
  it("emits the standard rows in a stable order", () => {
    const rows = blockS("account", {
      objectType: true,
      currency: true,
      statusFromFlag: {
        sourceFlag: "Inactive_vod__c",
        inactiveWhen: { equals: true },
      },
    });
    const targets = rows.map((r) => r.target);
    expect(targets).toEqual([
      "legacy_crm_id__v",
      "name__v",
      "status__v",
      "created_date__v",
      "created_by__v",
      "modified_date__v",
      "modified_by__v",
      "ownerid__v",
      "object_type__v.api_name__v",
      "local_currency__sys",
      "mobile_id__v",
      "last_device__v",
      "mobile_created_datetime__v",
      "mobile_last_modified_datetime__v",
      "lock__v",
      "override_lock__v",
      "unlock__v",
      "external_id__v",
    ]);
    expect(rows[0]).toMatchObject({
      source: "Id",
      required: "K",
      transform: { kind: "legacyId" },
    });
    expect(rows.find((r) => r.target === "unlock__v")).toMatchObject({
      enabledBy: "loadUnlockFlag",
      optionalSource: true,
    });
    expect(rows.find((r) => r.target === "status__v")).toMatchObject({
      disabledBy: "statusFromFlag",
    });
  });
  it("supports opt-outs and name variants", () => {
    const targets = (o: Parameters<typeof blockS>[1]) =>
      blockS("call2_detail", o).map((r) => r.target);
    expect(targets({ name: "autoNumber" }).includes("name__v")).toBe(true);
    expect(
      blockS("x" as never, { name: "autoNumber" }).find(
        (r) => r.target === "name__v",
      ),
    ).toMatchObject({ enabledBy: "preserveAutoNumberName", required: "n" });
    expect(
      targets({
        name: "none",
        ownerId: false,
        audit: false,
        mobileId: false,
        lastDevice: false,
        mobileDatetimes: false,
        locks: false,
        unlock: false,
        externalId: false,
      }),
    ).toEqual(["legacy_crm_id__v"]);
    expect(
      blockS("account", { name: { nameTemplate: "person" } }).find(
        (r) => r.target === "name__v",
      )?.transform,
    ).toEqual({ kind: "nameTemplate", templateKey: "person" });
    expect(
      blockS("user", { legacyIdField: "legacy_crm_id__c" })[0].target,
    ).toBe("legacy_crm_id__c");
  });
});

describe("defineObject", () => {
  it("fills defaults, prepends Block S and lets module rows replace Block S rows", () => {
    const m = defineObject({
      key: "call2_detail",
      source: "Call2_Detail_vod__c",
      target: "call2_detail__v",
      countryOf: "parent:call2:Call2_vod__c",
      dependsOn: ["call2", "product"],
      scope: {
        kind: "via-parent",
        parentKey: "call2",
        parentField: "Call2_vod__r.Call_Date_vod__c",
        type: "date",
      },
      blockS: { name: "autoNumber", ownerId: false },
      fields: [
        {
          source: "Call2_vod__c",
          target: "call2__v",
          transform: "ref(call2)",
          required: "Y",
        },
        {
          source: "Product_vod__c",
          target: "product__v",
          transform: "ref(product)",
          required: "Y",
        },
        {
          source: "External_ID_vod__c",
          target: "external_id__v",
          transform: "copy",
          required: "n",
          notes: "override of Block S row",
        },
      ],
      deletePolicy: "delete",
    });
    expect(m.countryOf).toEqual([
      { kind: "parent", key: "call2", field: "Call2_vod__c" },
    ]);
    expect(m.fields[0].target).toBe("legacy_crm_id__v");
    expect(m.fields.filter((f) => f.target === "external_id__v")).toHaveLength(
      1,
    );
    expect(m.fields.find((f) => f.target === "external_id__v")?.notes).toBe(
      "override of Block S row",
    );
    expect(m.fields.map((f) => f.target)).not.toContain("ownerid__v");
    expect(m.fields.find((f) => f.target === "call2__v")?.transform).toEqual({
      kind: "ref",
      objectKey: "call2",
    });
    expect(m.load).toEqual({ noTriggers: true });
    expect(m.match).toEqual([{ method: "legacy_id" }]);
    expect(m.createPolicy).toBe("create");
    expect(m.blockS.objectType).toBe(false);
    expect(
      validateObjectModule(m).filter((i) => i.severity === "blocking"),
    ).toEqual([]);
  });
  it("turns on the objectType row when objectTypes are declared", () => {
    const m = defineObject({
      key: "call2",
      source: "Call2_vod__c",
      target: "call2__v",
      objectTypes: { CallReport_vod: "call_report__v" },
    });
    expect(m.fields.map((f) => f.target)).toContain(
      "object_type__v.api_name__v",
    );
  });
});

describe("validateObjectModule (§5.3 lints)", () => {
  const base = {
    key: "call2_detail" as const,
    source: "Call2_Detail_vod__c",
    target: "call2_detail__v",
    dependsOn: ["call2" as const, "product" as const],
    countryOf: "parent:call2",
  };
  it("reports duplicate targets, unknown deps, bad refs, missing custom fns and undeclared self-cycles", () => {
    const m = defineObject({
      ...base,
      dependsOn: ["call2", "product", "nope" as never, "call2_detail"],
      fields: [
        { source: "A", target: "dup__v", transform: "text", required: "n" },
        { source: "B", target: "dup__v", transform: "text", required: "n" },
        {
          source: "C",
          target: "x__v",
          transform: "custom(missing)",
          required: "n",
        },
        {
          source: "D",
          target: "self__v",
          transform: "ref(call2_detail)",
          required: "n",
        },
        {
          source: "E",
          target: "y__v",
          transform: "ref(product)",
          required: "n",
        },
      ],
      selfRefs: [{ target: "ghost__v", source: "G" }],
    });
    const codes = validateObjectModule(m).map((i) => i.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        "MAP_DUP_TARGET",
        "MAP_DEPENDS_UNKNOWN",
        "MAP_DEPENDS_SELF",
        "MAP_CUSTOM_FN_MISSING",
        "MAP_CYCLE_UNDECLARED",
        "MAP_SELFREF_UNMAPPED",
      ]),
    );
    expect(codes).not.toContain("MAP_FK_PARENT_NOT_DECLARED");
    expect(() => assertValidObjectModule(m)).toThrow(/MAP_DUP_TARGET/);
  });
  it("requires exactly one K legacyId, a valid scope, and dependency-backed parent rules", () => {
    const noLegacy = defineObject({
      ...base,
      fields: [
        {
          source: "Id",
          target: "legacy_crm_id__v",
          transform: "copy",
          required: "n",
        },
      ],
    });
    expect(validateObjectModule(noLegacy).map((i) => i.code)).toContain(
      "MAP_LEGACY_ID_MISSING",
    );
    const badScope = defineObject({
      ...base,
      scope: { kind: "dated", predicates: [] },
    });
    expect(validateObjectModule(badScope).map((i) => i.code)).toContain(
      "MAP_SCOPE_FIELD_MISSING",
    );
    const viaUnknown = defineObject({
      ...base,
      dependsOn: ["product"],
      scope: {
        kind: "via-parent",
        parentKey: "call2",
        parentField: "Call2_vod__r.Call_Date_vod__c",
      },
    });
    const codes = validateObjectModule(viaUnknown).map((i) => i.code);
    expect(codes).toContain("MAP_SCOPE_PARENT_NOT_DEPENDENCY");
    expect(codes).toContain("MAP_COUNTRY_RULE_INVALID");
  });
  it("accepts a selfRef to itself and to a declared dependency, and warns on undeclared FK parents", () => {
    const ok = defineObject({
      key: "medical_inquiry",
      source: "Medical_Inquiry_vod__c",
      target: "medical_inquiry__v",
      countryOf: "account",
      dependsOn: ["account", "call2"],
      fields: [
        {
          source: "Call2_vod__c",
          target: "call2__v",
          transform: "ref(call2) secondPass",
          required: "n",
        },
        {
          source: "Parent__c",
          target: "parent__v",
          transform: "ref(medical_inquiry) secondPass",
          required: "n",
        },
        {
          source: "Product_vod__c",
          target: "product__v",
          transform: "ref(product)",
          required: "n",
        },
      ],
      selfRefs: [
        { target: "call2__v", source: "Call2_vod__c", objectKey: "call2" },
        { target: "parent__v", source: "Parent__c" },
      ],
    });
    const issues = validateObjectModule(ok);
    expect(issues.filter((i) => i.severity === "blocking")).toEqual([]);
    expect(issues.map((i) => i.code)).toContain("MAP_FK_PARENT_NOT_DECLARED");
  });
});
