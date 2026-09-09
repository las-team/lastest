import { describe, expect, it } from "vitest";
import {
  KEY_MESSAGE_STATUS_DEFAULTS,
  VAULT_IDENTITY_FIELDS,
  key_message,
  outOfScopeRef,
} from "./key_message";
import { validateObjectModule } from "../types";
import { materialise, resolveCountry } from "../../config/resolve";
import { parseConfig } from "../../config/schema";
import { applyMapping } from "../../transform/apply";
import { buildScopePredicate } from "../../extract/scope";
import {
  SAMPLE_USER_ID,
  buildCountryContext,
  buildIdResolver,
  buildTransformContext,
  buildVaultMetadata,
  resolveMetadata,
} from "../../testkit";
import { to18 } from "../../transform/ids";
import type { SourceRow } from "../../types";

const NOW = new Date("2026-09-07T00:00:00Z");
const KM_ID = to18("a0M000000000001");
const SHARED_ID = to18("a0M000000000002");
const PRODUCT_ID = to18("a0P000000000001");
const DETAIL_GROUP_ID = to18("a0P000000000002");
const STRATEGY_ID = to18("a0S000000000001");

function makeConfig(overrides: Record<string, unknown> = {}) {
  return parseConfig({
    version: 1,
    source: {
      loginUrl: "https://x.my.salesforce.com",
      auth: { kind: "jwt", clientId: "c", username: "u", privateKeyPath: "k" },
    },
    target: {
      vaultDns: "x.veevavault.com",
      auth: { kind: "password", username: "u", password: "p" },
      migrationUserId: 1,
    },
    objects: { key_message: overrides },
    countries: { US: {} },
  });
}

function metadata(opts: { productRequired?: boolean } = {}) {
  return resolveMetadata(
    buildVaultMetadata("key_message__v", [
      {
        name: "product__v",
        type: "Object",
        object: { name: "product__v" },
        required: opts.productRequired ?? false,
      },
      {
        name: "detail_group__v",
        type: "Object",
        object: { name: "product__v" },
      },
      {
        name: "shared_resource__v",
        type: "Object",
        object: { name: "key_message__v" },
      },
      { name: "media_file_name__v", type: "String", max_length: 255 },
      { name: "vexternal_id__v", type: "String", max_length: 100 },
      { name: "vault_doc_id__v", type: "String", max_length: 100 },
      { name: "vault_guid__v", type: "String", max_length: 100 },
      { name: "vault_external_id__v", type: "String", max_length: 255 },
      { name: "vault_dns__v", type: "String", max_length: 255 },
      { name: "vault_last_modified_date_time__v", type: "DateTime" },
      { name: "clm_id__v", type: "String", max_length: 255 },
      { name: "slide_version__v", type: "String", max_length: 255 },
      { name: "category__v", type: "Picklist", picklist: "category__v" },
      { name: "language__v", type: "Picklist", picklist: "language__v" },
      { name: "segment__v", type: "String", max_length: 255 },
      { name: "vehicle__v", type: "Picklist", picklist: "vehicle__v" },
      { name: "description__v", type: "LongText" },
      { name: "custom_reaction__v", type: "String", max_length: 255 },
      { name: "display_order__v", type: "Number", scale: 0 },
      { name: "media_file_crc__v", type: "String", max_length: 255 },
      { name: "media_file_size__v", type: "Number", scale: 0 },
      { name: "cdn_path__v", type: "String", max_length: 1500 },
      { name: "ios_viewer__v", type: "Boolean" },
      {
        name: "key_message_status__v",
        type: "Picklist",
        picklist: "key_message_status__v",
      },
      { name: "active__v", type: "Boolean" },
      { name: "is_shared_resource__v", type: "Boolean" },
      {
        name: "disable_actions__v",
        type: "Picklist",
        picklist: "disable_actions__v",
        multi_value: true,
      },
      { name: "ownerid__v", type: "Object", object: { name: "user__sys" } },
    ]),
    {
      picklists: {
        key_message_status__v: Object.values(KEY_MESSAGE_STATUS_DEFAULTS),
        category__v: ["clinical__v", "promotional__v"],
        language__v: ["en_us__v", "de__v"],
        vehicle__v: ["clm__v", "approved_email__v"],
        disable_actions__v: ["share__v", "email__v"],
        status__v: ["active__v", "inactive__v"],
      },
    },
  );
}

function sampleRow(extra: Partial<SourceRow> = {}): SourceRow {
  return {
    Id: "a0M000000000001",
    Name: "  Cholecap Efficacy Slide ",
    Product_vod__c: PRODUCT_ID,
    Detail_Group_vod__c: DETAIL_GROUP_ID,
    Product_Strategy_vod__c: STRATEGY_ID,
    Shared_Resource_vod__c: SHARED_ID,
    Media_File_Name_vod__c: "cholecap_efficacy.zip",
    VExternal_Id_vod__c: "VEXT-KM-1",
    Vault_Doc_Id_vod__c: "1234",
    Vault_GUID_vod__c: "guid-1",
    Vault_External_Id_vod__c: "vault-km-1",
    Vault_DNS_vod__c: "promomats.veevavault.com",
    Vault_Last_Modified_Date_Time_vod__c: "2024-01-15T10:00:00.000Z",
    CLM_ID_vod__c: "clm-1",
    Slide_Version_vod__c: "3",
    Category_vod__c: "Clinical",
    Language_vod__c: "en_US",
    Segment_vod__c: "Cardio",
    Vehicle_vod__c: "CLM_vod",
    Description_vod__c: "Efficacy overview",
    Custom_Reaction_vod__c: "Like",
    Display_Order_vod__c: "12",
    Media_File_CRC_vod__c: "abc123",
    Media_File_Size_vod__c: "1048576",
    CDN_Path_vod__c: "https://cdn.example.com/km/1",
    iOS_Viewer_vod__c: "true",
    Status_vod__c: "Approved_vod",
    Active_vod__c: "true",
    Is_Shared_Resource_vod__c: "false",
    Disable_Actions_vod__c: "Share_vod;Email_vod",
    OwnerId: SAMPLE_USER_ID,
    CreatedDate: "2021-02-03T04:05:06.000Z",
    CreatedById: SAMPLE_USER_ID,
    LastModifiedDate: "2025-01-01T00:00:00.000Z",
    LastModifiedById: SAMPLE_USER_ID,
    ...extra,
  };
}

function run(
  row: SourceRow,
  opts: {
    overrides?: Record<string, unknown>;
    knownProducts?: boolean;
    productRequired?: boolean;
  } = {},
) {
  const config = makeConfig(opts.overrides);
  const mapping = materialise(
    key_message,
    resolveCountry(config, "US"),
    config,
    { now: NOW },
  );
  const ids = buildIdResolver(
    {
      product:
        opts.knownProducts === false
          ? {}
          : { [PRODUCT_ID]: "V0P1", [DETAIL_GROUP_ID]: "V0P2" },
    },
    { [SAMPLE_USER_ID]: 101 },
  );
  return {
    mapping,
    result: applyMapping(row, mapping, {
      country: buildCountryContext(),
      metadata: metadata({ productRequired: opts.productRequired }),
      ids,
      migrationUserId: 1,
      runMode: "init",
      custom: key_message.custom,
    }),
  };
}

describe("key_message module", () => {
  it("is structurally valid", () => {
    expect(
      validateObjectModule(key_message).filter(
        (i) => i.severity === "blocking",
      ),
    ).toEqual([]);
  });

  it("encodes the §6.2 / §6.1 / §4.4 catalogue facts", () => {
    expect(key_message.source).toBe("Key_Message_vod__c");
    expect(key_message.target).toBe("key_message__v");
    expect(key_message.targetEvidence).toBe("DOC");
    expect(key_message.scope).toEqual({ kind: "full" });
    expect(key_message.countryOf).toEqual([{ kind: "global" }]);
    expect(key_message.dependsOn).toEqual(["product"]);
    expect(key_message.deletePolicy).toBe("inactivate");
    expect(key_message.inactivate).toEqual([
      { field: "active__v", value: false },
    ]);
    expect(key_message.createPolicy).toBe("match-only");
    expect(key_message.load.noTriggers).toBe(false);
    expect(key_message.selfRefs).toEqual([
      { target: "shared_resource__v", source: "Shared_Resource_vod__c" },
    ]);
    expect(key_message.objectTypes).toEqual({});
    expect(key_message.states).toEqual({});
    expect(key_message.blockS.statusFromFlag).toEqual({
      sourceFlag: "Active_vod__c",
      inactiveWhen: { equals: false },
    });
    expect(key_message.notes).not.toContain("STUB");
  });

  it("maps every §6.3.14 row with the spec's transform, requirement and evidence", () => {
    const byTarget = new Map(key_message.fields.map((f) => [f.target, f]));
    expect(byTarget.get("legacy_crm_id__v")).toMatchObject({
      source: "Id",
      required: "K",
      transform: { kind: "legacyId" },
    });
    expect(byTarget.get("name__v")).toMatchObject({
      source: "Name",
      required: "Y",
      evidence: "UNV",
      transform: { kind: "text", max: 128 },
    });
    expect(byTarget.get("product__v")).toMatchObject({
      source: "Product_vod__c",
      required: "y?",
      evidence: "DOC",
      transform: { kind: "ref", objectKey: "product" },
    });
    expect(byTarget.get("detail_group__v")).toMatchObject({
      source: "Detail_Group_vod__c",
      required: "y?",
      evidence: "DOC",
      transform: { kind: "ref", objectKey: "product" },
    });
    expect(byTarget.get("product_strategy__v")).toMatchObject({
      source: "Product_Strategy_vod__c",
      required: "n",
      evidence: "UNV",
      transform: { kind: "custom", fnName: "outOfScopeRef" },
    });
    expect(byTarget.get("shared_resource__v")).toMatchObject({
      source: "Shared_Resource_vod__c",
      required: "n",
      evidence: "UNV",
      transform: {
        kind: "secondPass",
        inner: { kind: "ref", objectKey: "key_message" },
      },
    });
    expect(byTarget.get("media_file_name__v")).toMatchObject({
      source: "Media_File_Name_vod__c",
      evidence: "UNV",
      transform: { kind: "copy" },
    });
    // Vault identity columns (match keys)
    expect(VAULT_IDENTITY_FIELDS.map((f) => f.target)).toEqual([
      "vexternal_id__v",
      "vault_doc_id__v",
      "vault_guid__v",
      "vault_external_id__v",
      "vault_dns__v",
      "vault_last_modified_date_time__v",
    ]);
    for (const f of VAULT_IDENTITY_FIELDS)
      expect(byTarget.get(f.target), f.target).toMatchObject({
        source: f.source,
        required: "n",
        evidence: "UNV",
        transform: {
          kind:
            f.target === "vault_last_modified_date_time__v"
              ? "datetime"
              : "copy",
        },
      });
    // "as types" row, language/category country-configurable
    for (const [t, kind] of [
      ["clm_id__v", "text"],
      ["slide_version__v", "text"],
      ["segment__v", "text"],
      ["description__v", "longtext"],
      ["custom_reaction__v", "text"],
      ["display_order__v", "number"],
      ["media_file_crc__v", "text"],
      ["media_file_size__v", "number"],
      ["cdn_path__v", "text"],
      ["ios_viewer__v", "bool"],
    ] as const)
      expect(byTarget.get(t), t).toMatchObject({
        required: "n",
        evidence: "UNV",
        transform: { kind },
      });
    expect(byTarget.get("category__v")).toMatchObject({
      countryConfigurable: true,
      transform: { kind: "picklist", mapKey: "key_message.category" },
    });
    expect(byTarget.get("language__v")).toMatchObject({
      countryConfigurable: true,
      transform: { kind: "picklist", mapKey: "key_message.language" },
    });
    expect(byTarget.get("vehicle__v")).toMatchObject({
      transform: { kind: "picklist", mapKey: "key_message.vehicle" },
    });
    expect(byTarget.get("key_message_status__v")).toMatchObject({
      source: "Status_vod__c",
      evidence: "UNV",
      transform: { kind: "picklist", mapKey: "key_message.status" },
    });
    expect(byTarget.get("active__v")).toMatchObject({
      source: "Active_vod__c",
      transform: { kind: "bool" },
    });
    expect(byTarget.get("is_shared_resource__v")).toMatchObject({
      source: "Is_Shared_Resource_vod__c",
      transform: { kind: "bool" },
    });
    expect(byTarget.get("disable_actions__v")).toMatchObject({
      source: "Disable_Actions_vod__c",
      transform: {
        kind: "multipicklist",
        mapKey: "key_message.disableActions",
      },
    });
    // Block S: status__v derived from Active_vod__c, external_id__v kept
    expect(byTarget.get("status__v")).toMatchObject({
      source: "Active_vod__c",
      disabledBy: "statusFromFlag",
      transform: { kind: "statusFromFlag", sourceFlag: "Active_vod__c" },
    });
    expect(byTarget.get("external_id__v")).toMatchObject({
      source: "External_ID_vod__c",
      transform: { kind: "copy" },
    });
    expect(byTarget.get("ownerid__v")).toBeDefined();
    // UNV targets survive as rows (preflight prunes; the module never omits)
    expect(
      key_message.fields.filter((f) => f.evidence === "UNV").length,
    ).toBeGreaterThan(25);
  });

  it("carries the §3.3 precedence: vexternal id → vault doc id → vault external id → media file name → legacy id", () => {
    expect(key_message.match.map((m) => m.method)).toEqual([
      "external_id",
      "external_id",
      "external_id",
      "external_id",
      "legacy_id",
    ]);
    expect(key_message.match.map((m) => m.keys?.[0]?.target)).toEqual([
      "vexternal_id__v",
      "vault_doc_id__v",
      "vault_external_id__v",
      "media_file_name__v",
      undefined,
    ]);
    expect(key_message.match[2]).toMatchObject({
      evidence: "DOC",
      keys: [
        { target: "vault_external_id__v", source: "Vault_External_Id_vod__c" },
      ],
    });
    const { mapping } = run(sampleRow());
    expect(mapping.options.createPolicy).toBe("match-only");
    expect(mapping.options.externalIdOwnedBy).toBe("integration");
    expect(mapping.options.inactivateBy).toEqual([
      { field: "active__v", value: false },
    ]);
    // the customer can opt into creating non-Vault-managed content
    expect(
      run(sampleRow(), { overrides: { createPolicy: "create" } }).mapping
        .options.createPolicy,
    ).toBe("create");
  });

  it("ships the status crosswalk defaults and layers the country overlay on top", () => {
    expect(key_message.picklists["key_message.status"]).toEqual({
      Approved_vod: "approved__v",
      Staged_vod: "staged__v",
      Expired_vod: "expired__v",
    });
    const config = parseConfig({
      version: 1,
      source: {
        loginUrl: "https://x.my.salesforce.com",
        auth: {
          kind: "jwt",
          clientId: "c",
          username: "u",
          privateKeyPath: "k",
        },
      },
      target: {
        vaultDns: "x.veevavault.com",
        auth: { kind: "password", username: "u", password: "p" },
        migrationUserId: 1,
      },
      countries: {
        US: {
          picklists: {
            "key_message.language": { en_US: "english__v" },
            "key_message.status": { Expired_vod: null },
          },
        },
      },
    });
    const mapping = materialise(
      key_message,
      resolveCountry(config, "US"),
      config,
      { now: NOW },
    );
    expect(mapping.picklists["key_message.language"].en_US).toBe("english__v");
    expect(mapping.picklists["key_message.status"]).toEqual({
      Approved_vod: "approved__v",
      Staged_vod: "staged__v",
      Expired_vod: null,
    });
  });

  it("transforms a realistic Key_Message_vod__c row", () => {
    const { result: r } = run(sampleRow());
    expect(r.status).toBe("ok");
    expect(r.failure).toBeUndefined();
    expect(r.payload).toMatchObject({
      legacy_crm_id__v: KM_ID,
      name__v: "Cholecap Efficacy Slide",
      product__v: { $fk: { object: "product", sfdcId: PRODUCT_ID } },
      detail_group__v: { $fk: { object: "product", sfdcId: DETAIL_GROUP_ID } },
      media_file_name__v: "cholecap_efficacy.zip",
      vexternal_id__v: "VEXT-KM-1",
      vault_doc_id__v: "1234",
      vault_guid__v: "guid-1",
      vault_external_id__v: "vault-km-1",
      vault_dns__v: "promomats.veevavault.com",
      vault_last_modified_date_time__v: "2024-01-15T10:00:00.000Z",
      clm_id__v: "clm-1",
      slide_version__v: "3",
      category__v: "clinical__v",
      language__v: "en_us__v",
      segment__v: "Cardio",
      vehicle__v: "clm__v",
      description__v: "Efficacy overview",
      custom_reaction__v: "Like",
      display_order__v: 12,
      media_file_crc__v: "abc123",
      media_file_size__v: 1048576,
      cdn_path__v: "https://cdn.example.com/km/1",
      ios_viewer__v: true,
      key_message_status__v: "approved__v",
      active__v: true,
      is_shared_resource__v: false,
      disable_actions__v: "share__v,email__v",
      ownerid__v: { $user: SAMPLE_USER_ID },
      created_date__v: "2021-02-03T04:05:06.000Z",
      created_by__v: { $user: SAMPLE_USER_ID },
      modified_date__v: "2025-01-01T00:00:00.000Z",
      modified_by__v: { $user: SAMPLE_USER_ID },
    });
    // payload never carries a Vault id
    expect(JSON.stringify(r.payload)).not.toContain("V0P1");
    // active → status__v omitted (Vault defaults active__v)
    expect(r.payload.status__v).toBeUndefined();
    // self reference held back for pass 2
    expect(r.payload.shared_resource__v).toBeUndefined();
    expect(r.secondPass).toEqual({
      shared_resource__v: { $fk: { object: "key_message", sfdcId: SHARED_ID } },
    });
    expect(r.unresolvedOptionalFks).toContainEqual(
      expect.objectContaining({
        field: "shared_resource__v",
        objectKey: "key_message",
        sfdcId: SHARED_ID,
        secondPass: true,
      }),
    );
    // out-of-v1 reference dropped and counted
    expect(r.payload.product_strategy__v).toBeUndefined();
    expect(r.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "out_of_scope_ref_dropped",
        field: "product_strategy__v",
        code: "OUT_OF_SCOPE_REF_DROPPED",
        value: STRATEGY_ID,
      }),
    );
    expect(r.fkEdges).toContainEqual({
      field: "product__v",
      targetObjectKey: "product",
      targetSfdcId: PRODUCT_ID,
    });
    expect(r.unresolvedRequiredFks).toEqual([]);
  });

  it("reports an unresolved required product as pending_fk and omits an unresolved optional one", () => {
    const required = run(sampleRow(), {
      knownProducts: false,
      productRequired: true,
    });
    expect(required.result.status).toBe("pending_fk");
    expect(required.result.unresolvedRequiredFks).toContainEqual(
      expect.objectContaining({
        field: "product__v",
        objectKey: "product",
        sfdcId: PRODUCT_ID,
      }),
    );
    // the deferred ref stays in the payload for the retry (§3.5)
    expect(required.result.payload.product__v).toEqual({
      $fk: { object: "product", sfdcId: PRODUCT_ID },
    });
    const optional = run(sampleRow(), { knownProducts: false });
    expect(optional.result.status).toBe("ok");
    expect(optional.result.payload.product__v).toBeUndefined();
    expect(optional.result.unresolvedOptionalFks).toContainEqual(
      expect.objectContaining({ field: "product__v", sfdcId: PRODUCT_ID }),
    );
  });

  it("inactivates: Active_vod__c = false → status__v = inactive__v and active__v = false", () => {
    const { result: r } = run(sampleRow({ Active_vod__c: "false" }));
    expect(r.status).toBe("ok");
    expect(r.payload.status__v).toBe("inactive__v");
    expect(r.payload.active__v).toBe(false);
    const off = run(sampleRow({ Active_vod__c: "false" }), {
      overrides: { statusFromFlag: false },
    });
    expect(off.result.payload.status__v).toBeUndefined();
    expect(off.result.payload.active__v).toBe(false);
  });

  it("fails the row on an unmapped status under the default error policy", () => {
    const { result: r } = run(sampleRow({ Status_vod__c: "Mystery_vod" }));
    expect(r.status).toBe("failed");
    expect(r.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "unmapped_picklist",
        field: "key_message_status__v",
        fatal: true,
      }),
    );
  });

  it("is unscoped (full): the scope builder yields no predicate", () => {
    const { mapping } = run(sampleRow());
    expect(mapping.scope.spec).toEqual({ kind: "full" });
    expect(buildScopePredicate(mapping.scope)).toEqual({ kind: "full" });
  });
});

describe("key_message helpers", () => {
  it("outOfScopeRef drops populated references with a count and omits blanks", () => {
    const ctx = buildTransformContext({
      objectKey: "key_message",
      field: {
        source: "Product_Strategy_vod__c",
        target: "product_strategy__v",
      },
    });
    const row: SourceRow = { Id: "a0M000000000001" };
    expect(outOfScopeRef("a0S000000000001", row, ctx)).toMatchObject({
      omit: true,
      diagnostic: {
        kind: "out_of_scope_ref_dropped",
        field: "product_strategy__v",
        code: "OUT_OF_SCOPE_REF_DROPPED",
        value: STRATEGY_ID,
      },
    });
    expect(outOfScopeRef("", row, ctx)).toBeUndefined();
    expect(outOfScopeRef(null, row, ctx)).toBeUndefined();
  });
});
