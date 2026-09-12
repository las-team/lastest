import { describe, expect, it } from "vitest";
import { lintMappings } from "./lints";
import { buildMaterialisedMapping, sampleCall2Describe } from "../testkit";
import { unitId, type MaterialisedMapping, type Unit } from "../types";

const legacy = {
  source: "Id",
  target: "legacy_crm_id__v",
  transform: { kind: "legacyId" as const },
  required: "K" as const,
};

function plan(...mappings: MaterialisedMapping[]) {
  const units: Unit[] = mappings.map((m) => ({
    objectKey: m.objectKey,
    country: m.country,
  }));
  const map = new Map(
    mappings.map(
      (m) =>
        [unitId({ objectKey: m.objectKey, country: m.country }), m] as const,
    ),
  );
  return { units, map };
}

describe("lintMappings (§5.3)", () => {
  it("MAP_DUP_TARGET after overlays is blocking", () => {
    const m = buildMaterialisedMapping({
      objectKey: "call2",
      fields: [
        legacy,
        {
          source: "A__c",
          target: "x__v",
          transform: { kind: "text" },
          required: "n",
        },
        {
          source: "B__c",
          target: "x__v",
          transform: { kind: "text" },
          required: "n",
        },
      ],
      countryOf: [{ kind: "account" }],
    });
    const { units, map } = plan(m);
    const r = lintMappings(map, units);
    expect(r.findings).toContainEqual(
      expect.objectContaining({
        code: "MAP_DUP_TARGET",
        severity: "blocking",
        objectKey: "call2",
        country: "US",
        field: "x__v",
      }),
    );
  });

  it("MAP_FK_PARENT_NOT_IN_PLAN omits the field (warning)", () => {
    const m = buildMaterialisedMapping({
      objectKey: "call2",
      fields: [
        legacy,
        {
          source: "Account_vod__c",
          target: "account__v",
          transform: { kind: "ref", objectKey: "account" },
          required: "n",
        },
        {
          source: "Event_vod__c",
          target: "medical_event__v",
          transform: { kind: "ref", objectKey: "medical_event" },
          required: "n",
        },
      ],
      countryOf: [{ kind: "account" }],
      dependsOn: ["account", "medical_event"],
    });
    const { units, map } = plan(m);
    const r = lintMappings(map, units, {
      isEnabled: (key) => key === "account",
    });
    expect(r.findings).toContainEqual(
      expect.objectContaining({
        code: "MAP_FK_PARENT_NOT_IN_PLAN",
        severity: "warning",
        field: "medical_event__v",
      }),
    );
    expect(r.findings.some((f) => f.field === "account__v")).toBe(false);
    expect(r.omitted.get("call2:US")).toEqual(["medical_event__v"]);
  });

  it("parents are in plan when present in the mappings (same country or GLOBAL)", () => {
    const child = buildMaterialisedMapping({
      objectKey: "call2",
      fields: [
        legacy,
        {
          source: "Account_vod__c",
          target: "account__v",
          transform: { kind: "ref", objectKey: "account" },
          required: "n",
        },
        {
          source: "Product_vod__c",
          target: "product__v",
          transform: { kind: "ref", objectKey: "product" },
          required: "n",
        },
      ],
      countryOf: [{ kind: "account" }],
      dependsOn: ["account", "product"],
    });
    const account = buildMaterialisedMapping({
      objectKey: "account",
      fields: [legacy],
      countryOf: [{ kind: "field", path: "Country_vod__c" }],
    });
    const product = buildMaterialisedMapping({
      objectKey: "product",
      country: "GLOBAL",
      fields: [legacy],
    });
    const { units, map } = plan(child, account, product);
    const r = lintMappings(map, units);
    expect(
      r.findings.filter((f) => f.code === "MAP_FK_PARENT_NOT_IN_PLAN"),
    ).toEqual([]);
  });

  it("MAP_CYCLE_UNDECLARED against loadOrder is blocking; declared selfRefs pass", () => {
    const a = buildMaterialisedMapping({
      objectKey: "call2",
      fields: [legacy],
      countryOf: [{ kind: "account" }],
      dependsOn: ["medical_inquiry"],
    });
    const b = buildMaterialisedMapping({
      objectKey: "medical_inquiry",
      fields: [legacy],
      countryOf: [{ kind: "account" }],
      dependsOn: ["call2"],
    });
    const bad = plan(a, b);
    const r1 = lintMappings(bad.map, bad.units);
    const cyc = r1.findings.filter((f) => f.code === "MAP_CYCLE_UNDECLARED");
    expect(cyc.length).toBe(2);
    expect(
      cyc.every((f) => f.severity === "blocking" && f.country === "US"),
    ).toBe(true);

    const b2 = buildMaterialisedMapping({
      objectKey: "medical_inquiry",
      fields: [
        legacy,
        {
          source: "Call2_vod__c",
          target: "call2__v",
          transform: {
            kind: "secondPass",
            inner: { kind: "ref", objectKey: "call2" },
          },
          required: "n",
        },
      ],
      countryOf: [{ kind: "account" }],
      dependsOn: ["call2"],
      selfRefs: [
        { target: "call2__v", source: "Call2_vod__c", objectKey: "call2" },
      ],
    });
    const good = plan(a, b2);
    expect(
      lintMappings(good.map, good.units).findings.filter(
        (f) => f.code === "MAP_CYCLE_UNDECLARED",
      ),
    ).toEqual([]);
  });

  it("MAP_COUNTRY_RULE_MISSING for a per-country unit with a global rule; MAP_SCOPE_FIELD_MISSING for a dated scope without fields", () => {
    const m = buildMaterialisedMapping({
      objectKey: "call2",
      fields: [legacy],
      countryOf: [{ kind: "global" }],
      scope: {
        spec: { kind: "dated", predicates: [] },
        historyMonths: 24,
        cutoffDate: "2024-01-01",
      },
    });
    const { units, map } = plan(m);
    const codes = lintMappings(map, units).findings.map((f) => f.code);
    expect(codes).toContain("MAP_COUNTRY_RULE_MISSING");
    expect(codes).toContain("MAP_SCOPE_FIELD_MISSING");
    const g = buildMaterialisedMapping({
      objectKey: "product",
      country: "GLOBAL",
      fields: [legacy],
      countryOf: [{ kind: "global" }],
    });
    const p2 = plan(g);
    expect(
      lintMappings(p2.map, p2.units).findings.map((f) => f.code),
    ).not.toContain("MAP_COUNTRY_RULE_MISSING");
  });

  it("MAP_PICKLIST_KEY_UNKNOWN is info without a crosswalk; MAP_UNUSED_SOURCE lists describe columns", () => {
    const m = buildMaterialisedMapping({
      objectKey: "call2",
      sourceObject: "Call2_vod__c",
      fields: [
        legacy,
        {
          source: "Call_Type_vod__c",
          target: "call_type__v",
          transform: { kind: "picklist", mapKey: "call2.callType" },
          required: "n",
        },
      ],
      countryOf: [{ kind: "account" }],
    });
    const { units, map } = plan(m);
    const r = lintMappings(map, units, {
      describes: new Map([["Call2_vod__c", sampleCall2Describe()]]),
    });
    expect(r.findings).toContainEqual(
      expect.objectContaining({
        code: "MAP_PICKLIST_KEY_UNKNOWN",
        severity: "info",
        field: "call_type__v",
      }),
    );
    const unused = r.findings.find((f) => f.code === "MAP_UNUSED_SOURCE");
    expect(unused?.severity).toBe("info");
    expect((unused?.detail as { columns: string[] }).columns).toContain(
      "Status_vod__c",
    );
    expect((unused?.detail as { columns: string[] }).columns).not.toContain(
      "Call_Type_vod__c",
    );
    expect((unused?.detail as { columns: string[] }).columns).not.toContain(
      "Is_Parent_Call_vod__c",
    );
  });

  it("reports a unit without a mapping", () => {
    const r = lintMappings(new Map(), [{ objectKey: "call2", country: "US" }]);
    expect(r.findings[0]).toMatchObject({
      code: "MAP_MAPPING_MISSING",
      severity: "blocking",
    });
  });
});
