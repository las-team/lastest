import { describe, expect, it } from "vitest";
import { applyMapping, canonicalSkipReason, readSource } from "./apply";
import { parseTransform } from "./spec";
import type { FieldMapping, SourceRow } from "../types";
import {
  buildCountryContext,
  buildIdResolver,
  buildMaterialisedMapping,
  resolveMetadata,
  sampleAccountVaultMetadata,
  SAMPLE_USER_ID,
  SAMPLE_USER_ID_2,
} from "../testkit/fixtures";

const F = (
  source: string,
  target: string,
  transform: string,
  required: FieldMapping["required"] = "n",
  extra: Partial<FieldMapping> = {},
): FieldMapping => ({
  source,
  target,
  transform: parseTransform(transform),
  required,
  ...extra,
});

const mapping = buildMaterialisedMapping({
  objectKey: "account",
  fields: [
    F("Id", "legacy_crm_id__v", "legacyId", "K"),
    F("Name", "name__v", "text(128)", "Y"),
    F("CreatedById", "created_by__v", "refUser"),
    F("OwnerId", "ownerid__v", "refUser"),
    F("Primary_Parent_vod__c", "primary_parent__v", "ref(account) secondPass"),
    F("Country_vod__c", "primary_country__v", "country(ref)", "Y"),
    F("Specialty_1_vod__c", "specialty_1__v", "picklist(account.specialty)"),
    F(
      "RecordType.DeveloperName",
      "object_type__v.api_name__v",
      "objectType(account.objectType)",
      "Y",
    ),
    F("External_ID_vod__c", "external_id__v", "copy"),
    F("Photo_vod__c", "photo__v", "deferredBlob(photo)"),
    F("Website", "website__v", "text", "n", { clearOnNull: true }),
    F("Fax", "fax__v", "text", "n"),
  ],
  objectTypes: { Professional_vod: "professional__v" },
  mappingHash: "mh1",
});

const metadata = resolveMetadata(sampleAccountVaultMetadata(), {
  picklists: { specialty__v: ["cardiology__v"] },
});
const ids = buildIdResolver(
  { account: { "001000000000002AAA": "V0A2" } },
  { [SAMPLE_USER_ID]: 111 },
);
const ctx = {
  country: buildCountryContext({
    picklists: { "account.specialty": { CD: "cardiology__v" } },
  }),
  metadata,
  ids,
  migrationUserId: 999,
  runMode: "init" as const,
};

const base: SourceRow = {
  Id: "001000000000001AAA",
  Name: "Jane Doe",
  CreatedById: SAMPLE_USER_ID,
  OwnerId: SAMPLE_USER_ID,
  Primary_Parent_vod__c: "001000000000002AAA",
  Country_vod__c: "US",
  Specialty_1_vod__c: "CD",
  "RecordType.DeveloperName": "Professional_vod",
  External_ID_vod__c: "NET-1",
  Photo_vod__c: "base64data",
  Website: null,
};

describe("applyMapping (§2.3)", () => {
  it("assembles payload, pass 2, blobs, edges and hash", () => {
    const r = applyMapping(base, mapping, ctx);
    expect(r.status).toBe("ok");
    expect(r.payload).toEqual({
      legacy_crm_id__v: "001000000000001AAA",
      name__v: "Jane Doe",
      created_by__v: { $user: SAMPLE_USER_ID },
      ownerid__v: { $user: SAMPLE_USER_ID },
      primary_country__v: "V0C000000000101",
      specialty_1__v: "cardiology__v",
      "object_type__v.api_name__v": "professional__v",
      external_id__v: "NET-1",
      website__v: null,
    });
    expect(r.secondPass).toEqual({
      primary_parent__v: {
        $fk: { object: "account", sfdcId: "001000000000002AAA" },
      },
    });
    expect(r.blobs).toEqual({ photo__v: "base64data" });
    expect(r.objectType).toBe("professional__v");
    expect(r.fkEdges).toEqual(
      expect.arrayContaining([
        {
          field: "created_by__v",
          targetObjectKey: "user",
          targetSfdcId: SAMPLE_USER_ID,
        },
        {
          field: "primary_parent__v",
          targetObjectKey: "account",
          targetSfdcId: "001000000000002AAA",
        },
      ]),
    );
    expect(r.sourceHash).toMatch(/^[0-9a-f]{64}$/);
    // no id-map Vault ids in the payload (country ids come from the crosswalk, not the id map)
    expect(JSON.stringify(r.payload)).not.toContain("V0A2");
  });
  it("hash is stable across key order and changes with mapping hash", () => {
    const a = applyMapping(base, mapping, ctx).sourceHash;
    const shuffled: SourceRow = Object.fromEntries(
      Object.entries(base).reverse(),
    ) as SourceRow;
    expect(applyMapping(shuffled, mapping, ctx).sourceHash).toBe(a);
    expect(
      applyMapping(base, { ...mapping, mappingHash: "mh2" }, ctx).sourceHash,
    ).not.toBe(a);
  });
  it("routes unresolved required FKs to pending_fk and omits unresolved optional lookups", () => {
    const m = buildMaterialisedMapping({
      objectKey: "call2",
      fields: [
        F("Id", "legacy_crm_id__v", "legacyId", "K"),
        F("Account_vod__c", "account__v", "ref(account)", "Y"),
        F("Address_vod__c", "address__v", "ref(address)"),
      ],
      mappingHash: "x",
    });
    const r = applyMapping(
      {
        Id: "a0K000000000001",
        Account_vod__c: "001000000000009AAA",
        Address_vod__c: "a0A000000000001",
      },
      m,
      ctx,
    );
    expect(r.status).toBe("pending_fk");
    expect(r.unresolvedRequiredFks).toEqual([
      {
        field: "account__v",
        objectKey: "account",
        sfdcId: "001000000000009AAA",
      },
    ]);
    expect(r.payload.account__v).toEqual({
      $fk: { object: "account", sfdcId: "001000000000009AAA" },
    });
    expect(r.payload.address__v).toBeUndefined();
    expect(r.unresolvedOptionalFks[0]).toMatchObject({
      field: "address__v",
      objectKey: "address",
    });
    expect(r.fkEdges).toHaveLength(2);
  });
  it("fails on missing required values and fatal diagnostics", () => {
    const r = applyMapping({ ...base, Name: "" }, mapping, ctx);
    expect(r.status).toBe("failed");
    expect(r.failure).toMatchObject({
      code: "REQUIRED_MISSING",
      field: "name__v",
    });
    const r2 = applyMapping(
      { ...base, Specialty_1_vod__c: "Neurology" },
      mapping,
      ctx,
    );
    expect(r2.status).toBe("failed");
    expect(r2.failure?.code).toBe("UNMAPPED_PICKLIST");
  });
  it("honours required overrides from the materialised mapping", () => {
    const relaxed = { ...mapping, required: { name__v: false } };
    expect(applyMapping({ ...base, Name: "" }, relaxed, ctx).status).toBe("ok");
    const strict = { ...mapping, required: { fax__v: true } };
    expect(applyMapping(base, strict, ctx).failure?.field).toBe("fax__v");
  });
  it("skips erased ids and invalid ids", () => {
    const erased = {
      ...ctx,
      country: buildCountryContext({ erased: ["001000000000001AAA"] }),
    };
    const r = applyMapping(base, mapping, erased);
    expect(r.status).toBe("skipped");
    expect(r.skipReason).toBe("erased");
    expect(applyMapping({ Id: "nope" }, mapping, ctx)).toMatchObject({
      status: "failed",
      failure: { code: "INVALID_ID" },
    });
  });
  it("skipRow user policy yields skipped(rule) with the code kept in diagnostics (§8.8)", () => {
    const m = {
      ...mapping,
      options: { ...mapping.options, unmappedUserPolicy: "skipRow" as const },
    };
    const r = applyMapping({ ...base, OwnerId: SAMPLE_USER_ID_2 }, m, ctx);
    expect(r.status).toBe("skipped");
    expect(r.skipReason).toBe("rule");
    expect(r.diagnostics).toContainEqual(
      expect.objectContaining({ kind: "skipped", code: "UNMAPPED_USER_SKIP" }),
    );
    // a configured null object type (country picklist map) is a rule skip too
    const nullType = {
      ...ctx,
      country: buildCountryContext({
        picklists: {
          "account.specialty": { CD: "cardiology__v" },
          "account.objectType": { Professional_vod: null },
        },
      }),
    };
    const t = applyMapping(base, { ...mapping, objectTypes: {} }, nullType);
    expect(t.status).toBe("skipped");
    expect(t.skipReason).toBe("rule");
    expect(canonicalSkipReason("OBJECT_TYPE_SKIPPED")).toBe("rule");
    expect(canonicalSkipReason("CONTACT_REF_DROPPED")).toBe("contact_ref");
    expect(canonicalSkipReason("COUNTRY_UNRESOLVED")).toBe(
      "country_unresolved",
    );
    expect(canonicalSkipReason("OUT_OF_SCOPE_REF_DROPPED")).toBe(
      "out_of_scope_ref",
    );
    expect(canonicalSkipReason(undefined)).toBe("rule");
  });
  it("target-required references go to pending_fk even on an `n` row; empty `n` values defer to Vault defaults", () => {
    const requiredMeta = {
      ...metadata,
      fields: {
        ...metadata.fields,
        primary_parent__v: {
          ...metadata.fields.primary_parent__v,
          required: true,
        },
        first_name__v: { ...metadata.fields.first_name__v, required: true },
      },
    };
    const m = buildMaterialisedMapping({
      objectKey: "account",
      fields: [
        F("Id", "legacy_crm_id__v", "legacyId", "K"),
        F("Primary_Parent_vod__c", "primary_parent__v", "ref(account)", "n"),
        F("FirstName", "first_name__v", "text", "n"),
      ],
      mappingHash: "mh3",
    });
    const rctx = { ...ctx, metadata: requiredMeta };
    // unresolved parent on a Vault-required reference → pending_fk (§3.5), deferred ref kept
    const r = applyMapping(
      { Id: base.Id, Primary_Parent_vod__c: "001000000000009AAA" },
      m,
      rctx,
    );
    expect(r.status).toBe("pending_fk");
    expect(r.payload.primary_parent__v).toEqual({
      $fk: { object: "account", sfdcId: "001000000000009AAA" },
    });
    // empty source on a Vault-required text field with an `n` row → omitted, Vault defaults it
    expect(applyMapping({ Id: base.Id }, m, rctx).status).toBe("ok");
    // an explicit required: false override still wins for the reference
    expect(
      applyMapping(
        { Id: base.Id, Primary_Parent_vod__c: "001000000000009AAA" },
        { ...m, required: { primary_parent__v: false } },
        rctx,
      ).status,
    ).toBe("ok");
  });
  it("readSource supports flattened and nested relationship paths", () => {
    expect(readSource({ Id: "x", "A.B": 1 }, "A.B")).toBe(1);
    expect(readSource({ Id: "x", A: { B: 2 } }, "A.B")).toBe(2);
    expect(readSource({ Id: "x" }, "A.B")).toBeUndefined();
    expect(readSource({ Id: "x" }, "")).toBeUndefined();
  });
});
