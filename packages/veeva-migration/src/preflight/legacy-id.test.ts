import { describe, expect, it } from "vitest";
import {
  formatLength,
  legacyIdMdl,
  legacyIdValueMatches,
  looksLikeLegacyId,
  resolveLegacyIdField,
  type LegacyIdInput,
} from "./legacy-id";
import { toResolvedFields } from "./target";
import { buildVaultMetadata } from "../testkit";
import type { ResolvedField } from "../types";

const config = {
  preferred: ["legacy_crm_id__v", "external_id__v", "legacy_crm_id__c"],
  format: "{id18}",
  externalIdFormat: "SF:{orgId15}:{id18}",
};

function fieldsOf(
  specs: Parameters<typeof buildVaultMetadata>[1],
  opts: Parameters<typeof buildVaultMetadata>[2] = {},
): Record<string, ResolvedField> {
  return toResolvedFields(buildVaultMetadata("call2__v", specs, opts));
}

function input(
  fields: Record<string, ResolvedField>,
  extra: Partial<LegacyIdInput> = {},
): LegacyIdInput {
  return {
    objectKey: "call2",
    targetObject: "call2__v",
    fields,
    externalIdOwnedBy: "migration",
    config,
    allowMdl: false,
    ...extra,
  };
}

describe("resolveLegacyIdField (§3.2)", () => {
  it("step 2: unique legacy_crm_id__v wins with {id18}", () => {
    const r = resolveLegacyIdField(input(fieldsOf([])));
    expect(r.field).toBe("legacy_crm_id__v");
    expect(r.step).toBe(2);
    expect(r.format).toBe("{id18}");
    expect(r.findings.map((f) => f.code)).toEqual(["LEGACY_ID_FIELD_SELECTED"]);
    expect(r.findings[0].severity).toBe("info");
  });

  it("step 1: explicit config field wins when unique + editable", () => {
    const fields = fieldsOf([
      { name: "my_key__c", type: "String", unique: true, max_length: 40 },
    ]);
    const r = resolveLegacyIdField(
      input(fields, {
        explicit: "my_key__c",
        config: { ...config, format: "{id15}" },
      }),
    );
    expect(r.field).toBe("my_key__c");
    expect(r.step).toBe(1);
    expect(r.format).toBe("{id15}");
  });

  it("step 1 rejected → warning and fall through", () => {
    const fields = fieldsOf([
      { name: "my_key__c", type: "String", unique: false },
    ]);
    const r = resolveLegacyIdField(input(fields, { explicit: "my_key__c" }));
    expect(r.field).toBe("legacy_crm_id__v");
    expect(r.findings.map((f) => [f.code, f.severity])).toEqual([
      ["VT_LEGACY_ID_FIELD_MISSING", "warning"],
      ["LEGACY_ID_FIELD_SELECTED", "info"],
    ]);
  });

  it("step 3/4: non-unique legacy_crm_id__v is traceability only; external_id__v used with the SF: prefix", () => {
    const fields = fieldsOf(
      [
        {
          name: "legacy_crm_id__v",
          type: "String",
          unique: false,
          max_length: 18,
        },
        {
          name: "external_id__v",
          type: "String",
          unique: true,
          max_length: 120,
        },
      ],
      { legacyIdField: null },
    );
    const r = resolveLegacyIdField(input(fields));
    expect(r.field).toBe("external_id__v");
    expect(r.step).toBe(4);
    expect(r.format).toBe("SF:{orgId15}:{id18}");
    expect(r.traceabilityField).toBe("legacy_crm_id__v");
    expect(r.rejected[0]).toMatchObject({ field: "legacy_crm_id__v" });
  });

  it("step 4 is skipped when integrations own external_id__v", () => {
    const fields = fieldsOf(
      [
        {
          name: "external_id__v",
          type: "String",
          unique: true,
          max_length: 120,
        },
      ],
      { legacyIdField: null },
    );
    const r = resolveLegacyIdField(
      input(fields, { externalIdOwnedBy: "integration" }),
    );
    expect(r.field).toBeUndefined();
    expect(r.step).toBe(7);
    const blocking = r.findings.find((f) => f.severity === "blocking");
    expect(blocking?.code).toBe("VT_LEGACY_ID_FIELD_MISSING");
    expect(blocking?.objectKey).toBe("call2");
    expect((blocking?.detail as { mdl: string }).mdl).toContain(
      "ADD Field legacy_crm_id__c",
    );
  });

  it("external_id__v too short for the prefixed format is rejected", () => {
    const fields = fieldsOf(
      [
        {
          name: "external_id__v",
          type: "String",
          unique: true,
          max_length: 20,
        },
      ],
      { legacyIdField: null },
    );
    const r = resolveLegacyIdField(input(fields));
    expect(r.field).toBeUndefined();
    expect(
      r.rejected.some(
        (x) =>
          x.field === "external_id__v" && /max_length 20 < 37/.test(x.reason),
      ),
    ).toBe(true);
  });

  it("step 5: customer legacy_crm_id__c when unique", () => {
    const fields = fieldsOf(
      [
        {
          name: "legacy_crm_id__c",
          type: "String",
          unique: true,
          max_length: 18,
        },
      ],
      { legacyIdField: null },
    );
    const r = resolveLegacyIdField(
      input(fields, { externalIdOwnedBy: "integration" }),
    );
    expect(r.field).toBe("legacy_crm_id__c");
    expect(r.step).toBe(5);
  });

  it("step 6: prepares MDL under --allow-mdl instead of blocking", () => {
    const r = resolveLegacyIdField(
      input(fieldsOf([], { legacyIdField: null }), {
        allowMdl: true,
        externalIdOwnedBy: "integration",
      }),
    );
    expect(r.field).toBe("legacy_crm_id__c");
    expect(r.step).toBe(6);
    expect(r.mdl).toBe(legacyIdMdl("call2__v"));
    expect(r.findings.some((f) => f.severity === "blocking")).toBe(false);
  });

  it("users: the field is a match key only", () => {
    const r = resolveLegacyIdField(
      input(fieldsOf([]), { objectKey: "user", matchOnly: true }),
    );
    expect(r.field).toBe("legacy_crm_id__v");
    expect((r.findings[0].detail as { matchOnly: boolean }).matchOnly).toBe(
      true,
    );
  });

  it("uses legacyId.preferred order", () => {
    const fields = fieldsOf(
      [
        {
          name: "legacy_crm_id__c",
          type: "String",
          unique: true,
          max_length: 18,
        },
      ],
      { legacyIdField: "legacy_crm_id__v" },
    );
    const r = resolveLegacyIdField(
      input(fields, {
        config: {
          ...config,
          preferred: ["legacy_crm_id__c", "legacy_crm_id__v"],
        },
      }),
    );
    expect(r.field).toBe("legacy_crm_id__c");
  });
});

describe("format helpers", () => {
  it("formatLength", () => {
    expect(formatLength("{id18}")).toBe(18);
    expect(formatLength("{id15}")).toBe(15);
    expect(formatLength("SF:{orgId15}:{id18}")).toBe(37);
  });
  it("legacyIdValueMatches", () => {
    expect(legacyIdValueMatches("a0K000000000001AAA", "{id18}")).toBe(true);
    expect(legacyIdValueMatches("a0K000000000001", "{id18}")).toBe(false);
    expect(legacyIdValueMatches("a0K000000000001", "{id15}")).toBe(true);
    expect(
      legacyIdValueMatches(
        "SF:00D000000000001:a0K000000000001AAA",
        "SF:{orgId15}:{id18}",
      ),
    ).toBe(true);
    expect(legacyIdValueMatches("NET-001", "SF:{orgId15}:{id18}")).toBe(false);
  });
  it("looksLikeLegacyId", () => {
    expect(looksLikeLegacyId("a0K000000000001AAA")).toBe(true);
    expect(looksLikeLegacyId("SF:00D000000000001:a0K000000000001AAA")).toBe(
      true,
    );
    expect(looksLikeLegacyId("NET-001")).toBe(false);
    expect(looksLikeLegacyId(42)).toBe(false);
  });
});
