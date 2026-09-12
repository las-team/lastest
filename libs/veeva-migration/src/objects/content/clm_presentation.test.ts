import { describe, expect, it } from "vitest";
import {
  CLM_PRESENTATION_BOOLEAN_FIELDS,
  CLM_PRESENTATION_COPY_FIELDS,
  clm_presentation,
  renameContentField,
} from "./clm_presentation";
import { VAULT_IDENTITY_FIELDS } from "./key_message";
import { validateObjectModule } from "../types";
import { materialise, resolveCountry } from "../../config/resolve";
import { parseConfig } from "../../config/schema";
import { applyMapping } from "../../transform/apply";
import { buildScopePredicate } from "../../extract/scope";
import {
  SAMPLE_USER_ID,
  buildCountryContext,
  buildIdResolver,
  buildVaultMetadata,
  resolveMetadata,
} from "../../testkit";
import { to18 } from "../../transform/ids";
import type { SourceRow } from "../../types";

const NOW = new Date("2026-09-07T00:00:00Z");
const PRES_ID = to18("a0N000000000001");
const ORIGINAL_ID = to18("a0N000000000002");
const PRODUCT_ID = to18("a0P000000000001");
const SURVEY_ID = to18("a0T000000000001");

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
    objects: { clm_presentation: overrides },
    countries: { US: {} },
  });
}

function metadata(opts: { productRequired?: boolean } = {}) {
  return resolveMetadata(
    buildVaultMetadata("clm_presentation__v", [
      {
        name: "product__v",
        type: "Object",
        object: { name: "product__v" },
        required: opts.productRequired ?? false,
      },
      { name: "presentation_id__v", type: "String", max_length: 100 },
      { name: "vexternal_id__v", type: "String", max_length: 100 },
      { name: "vault_doc_id__v", type: "String", max_length: 100 },
      { name: "vault_guid__v", type: "String", max_length: 100 },
      { name: "vault_external_id__v", type: "String", max_length: 255 },
      { name: "vault_dns__v", type: "String", max_length: 255 },
      { name: "vault_last_modified_date_time__v", type: "DateTime" },
      { name: "directory__v", type: "String", max_length: 255 },
      { name: "version__v", type: "String", max_length: 255 },
      { name: "type__v", type: "Picklist", picklist: "type__v" },
      {
        name: "control_visibility__v",
        type: "Picklist",
        picklist: "control_visibility__v",
      },
      {
        name: "event_content__v",
        type: "Picklist",
        picklist: "event_content__v",
      },
      {
        name: "clm_presentation_status__v",
        type: "Picklist",
        picklist: "clm_presentation_status__v",
      },
      { name: "start_date__v", type: "Date" },
      { name: "end_date__v", type: "Date" },
      { name: "approved__v", type: "Boolean" },
      { name: "hidden__v", type: "Boolean" },
      { name: "training__v", type: "Boolean" },
      { name: "default_presentation__v", type: "Boolean" },
      { name: "enable_survey_overlay__v", type: "Boolean" },
      { name: "keywords__v", type: "LongText" },
      { name: "description__v", type: "LongText" },
      { name: "original_record_id__v", type: "String", max_length: 18 },
      { name: "parentid__v", type: "String", max_length: 18 },
      { name: "copied_from__v", type: "String", max_length: 18 },
      { name: "copy_date__v", type: "DateTime" },
      { name: "active__v", type: "Boolean" },
      { name: "ownerid__v", type: "Object", object: { name: "user__sys" } },
    ]),
    {
      picklists: {
        type__v: ["hq__v", "custom__v"],
        control_visibility__v: ["product__v", "detail_group__v"],
        event_content__v: ["events_only__v", "events_clm__v"],
        clm_presentation_status__v: ["approved__v", "staged__v", "expired__v"],
        status__v: ["active__v", "inactive__v"],
      },
    },
  );
}

function sampleRow(extra: Partial<SourceRow> = {}): SourceRow {
  return {
    Id: "a0N000000000001",
    Name: " Cholecap Launch Deck ",
    Product_vod__c: PRODUCT_ID,
    Presentation_Id_vod__c: "PRES-0001",
    VExternal_Id_vod__c: "VEXT-P-1",
    Vault_Doc_Id_vod__c: "5678",
    Vault_GUID_vod__c: "guid-p-1",
    Vault_External_Id_vod__c: "vault-p-1",
    Vault_DNS_vod__c: "promomats.veevavault.com",
    Vault_Last_Modified_Date_Time_vod__c: "2024-03-01T08:00:00.000Z",
    Directory_vod__c: "cholecap/launch",
    Survey_vod__c: SURVEY_ID,
    Version_vod__c: "2.1",
    Type_vod__c: "HQ_vod",
    Control_Visibility_vod__c: "Detail_Group_vod",
    Event_Content_vod__c: "Events_CLM_vod",
    Status_vod__c: "Staged_vod",
    Start_Date_vod__c: "2024-01-15",
    End_Date_vod__c: "2025-12-31",
    Approved_vod__c: "true",
    Hidden_vod__c: "false",
    Training_vod__c: false,
    Default_Presentation_vod__c: "true",
    Enable_Survey_Overlay_vod__c: "false",
    Keywords_vod__c: "cardio;launch",
    Description_vod__c: "Launch deck",
    Original_Record_ID_vod__c: ORIGINAL_ID,
    ParentId_vod__c: ORIGINAL_ID,
    Copied_From_vod__c: ORIGINAL_ID,
    Copy_Date_vod__c: "2024-02-01T09:30:00.000Z",
    Active_vod__c: "true",
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
    knownProduct?: boolean;
    productRequired?: boolean;
  } = {},
) {
  const config = makeConfig(opts.overrides);
  const mapping = materialise(
    clm_presentation,
    resolveCountry(config, "US"),
    config,
    { now: NOW },
  );
  const ids = buildIdResolver(
    { product: opts.knownProduct === false ? {} : { [PRODUCT_ID]: "V0P1" } },
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
      custom: clm_presentation.custom,
    }),
  };
}

describe("clm_presentation module", () => {
  it("is structurally valid", () => {
    expect(
      validateObjectModule(clm_presentation).filter(
        (i) => i.severity === "blocking",
      ),
    ).toEqual([]);
  });

  it("encodes the §6.2 / §4.4 catalogue facts", () => {
    expect(clm_presentation.source).toBe("Clm_Presentation_vod__c");
    expect(clm_presentation.target).toBe("clm_presentation__v");
    expect(clm_presentation.targetEvidence).toBe("DOC");
    expect(clm_presentation.scope).toEqual({ kind: "full" });
    expect(clm_presentation.countryOf).toEqual([{ kind: "global" }]);
    expect(clm_presentation.dependsOn).toEqual(["product"]);
    expect(clm_presentation.selfRefs).toEqual([]);
    expect(clm_presentation.deletePolicy).toBe("inactivate");
    expect(clm_presentation.inactivate).toEqual([
      { field: "active__v", value: false },
    ]);
    expect(clm_presentation.createPolicy).toBe("match-only");
    expect(clm_presentation.load.noTriggers).toBe(false);
    expect(clm_presentation.objectTypes).toEqual({});
    expect(clm_presentation.states).toEqual({});
    expect(clm_presentation.blockS.statusFromFlag).toEqual({
      sourceFlag: "Active_vod__c",
      inactiveWhen: { equals: false },
    });
    expect(clm_presentation.notes).not.toContain("STUB");
  });

  it("maps every §6.3.15 row with the spec's transform, requirement and evidence", () => {
    const byTarget = new Map(clm_presentation.fields.map((f) => [f.target, f]));
    expect(byTarget.get("legacy_crm_id__v")).toMatchObject({
      source: "Id",
      required: "K",
      transform: { kind: "legacyId" },
    });
    expect(byTarget.get("name__v")).toMatchObject({
      source: "Name",
      required: "Y",
      evidence: "UNV",
      transform: { kind: "text" },
    });
    expect(byTarget.get("product__v")).toMatchObject({
      source: "Product_vod__c",
      required: "y?",
      evidence: "DOC",
      transform: { kind: "ref", objectKey: "product" },
    });
    expect(byTarget.get("presentation_id__v")).toMatchObject({
      source: "Presentation_Id_vod__c",
      evidence: "UNV",
      transform: { kind: "copy" },
    });
    for (const f of VAULT_IDENTITY_FIELDS)
      expect(byTarget.get(f.target), f.target).toMatchObject({
        source: f.source,
        evidence: "UNV",
      });
    expect(byTarget.get("directory__v")).toMatchObject({
      source: "Directory_vod__c",
      transform: { kind: "text" },
    });
    expect(byTarget.get("survey__v")).toMatchObject({
      source: "Survey_vod__c",
      evidence: "UNV",
      transform: { kind: "custom", fnName: "outOfScopeRef" },
    });
    expect(byTarget.get("version__v")).toMatchObject({
      transform: { kind: "text" },
    });
    for (const [t, key] of [
      ["type__v", "clm_presentation.type"],
      ["control_visibility__v", "clm_presentation.controlVisibility"],
      ["event_content__v", "clm_presentation.eventContent"],
      ["clm_presentation_status__v", "clm_presentation.status"],
    ] as const)
      expect(byTarget.get(t), t).toMatchObject({
        evidence: "UNV",
        transform: { kind: "picklist", mapKey: key },
      });
    expect(byTarget.get("clm_presentation_status__v")?.source).toBe(
      "Status_vod__c",
    );
    for (const t of ["start_date__v", "end_date__v"])
      expect(byTarget.get(t), t).toMatchObject({ transform: { kind: "date" } });
    expect(CLM_PRESENTATION_BOOLEAN_FIELDS).toHaveLength(5);
    for (const src of CLM_PRESENTATION_BOOLEAN_FIELDS)
      expect(byTarget.get(renameContentField(src)), src).toMatchObject({
        source: src,
        required: "n",
        evidence: "UNV",
        transform: { kind: "bool" },
      });
    for (const t of ["keywords__v", "description__v"])
      expect(byTarget.get(t), t).toMatchObject({
        transform: { kind: "longtext" },
      });
    for (const src of CLM_PRESENTATION_COPY_FIELDS)
      expect(byTarget.get(renameContentField(src)), src).toMatchObject({
        source: src,
        evidence: "UNV",
        transform: { kind: "copy" },
      });
    expect(byTarget.get("copy_date__v")).toMatchObject({
      source: "Copy_Date_vod__c",
      transform: { kind: "datetime" },
    });
    // §4.4 inactivation flag row (optional/unverified source)
    expect(byTarget.get("active__v")).toMatchObject({
      source: "Active_vod__c",
      optionalSource: true,
      unverifiedSource: true,
      transform: { kind: "bool" },
    });
    expect(byTarget.get("status__v")).toMatchObject({
      source: "Active_vod__c",
      disabledBy: "statusFromFlag",
      transform: { kind: "statusFromFlag" },
    });
    // Block S external_id__v replaced by the integration-ownership guard
    expect(byTarget.get("external_id__v")).toMatchObject({
      source: "External_ID_vod__c",
      optionalSource: true,
      transform: { kind: "custom", fnName: "externalIdIfMigrationOwned" },
    });
    expect(
      clm_presentation.fields.filter((f) => f.target === "external_id__v"),
    ).toHaveLength(1);
    expect(byTarget.get("ownerid__v")).toBeDefined();
  });

  it("carries the §3.3 precedence and the picklist defaults", () => {
    expect(clm_presentation.match.map((m) => m.method)).toEqual([
      "external_id",
      "external_id",
      "external_id",
      "legacy_id",
    ]);
    expect(clm_presentation.match.map((m) => m.keys?.[0]?.target)).toEqual([
      "vexternal_id__v",
      "vault_doc_id__v",
      "presentation_id__v",
      undefined,
    ]);
    expect(clm_presentation.picklists).toEqual({
      "clm_presentation.type": { HQ_vod: "hq__v", Custom_vod: "custom__v" },
      "clm_presentation.controlVisibility": {
        Product_vod: "product__v",
        Detail_Group_vod: "detail_group__v",
      },
      "clm_presentation.eventContent": {
        Events_Only_vod: "events_only__v",
        Events_CLM_vod: "events_clm__v",
      },
      "clm_presentation.status": {
        Approved_vod: "approved__v",
        Staged_vod: "staged__v",
        Expired_vod: "expired__v",
      },
    });
    const { mapping } = run(sampleRow());
    expect(mapping.options.createPolicy).toBe("match-only");
    expect(mapping.options.externalIdOwnedBy).toBe("integration");
  });

  it("transforms a realistic Clm_Presentation_vod__c row", () => {
    const { result: r } = run(sampleRow());
    expect(r.status).toBe("ok");
    expect(r.failure).toBeUndefined();
    expect(r.payload).toMatchObject({
      legacy_crm_id__v: PRES_ID,
      name__v: "Cholecap Launch Deck",
      product__v: { $fk: { object: "product", sfdcId: PRODUCT_ID } },
      presentation_id__v: "PRES-0001",
      vexternal_id__v: "VEXT-P-1",
      vault_doc_id__v: "5678",
      vault_guid__v: "guid-p-1",
      vault_external_id__v: "vault-p-1",
      vault_dns__v: "promomats.veevavault.com",
      vault_last_modified_date_time__v: "2024-03-01T08:00:00.000Z",
      directory__v: "cholecap/launch",
      version__v: "2.1",
      type__v: "hq__v",
      control_visibility__v: "detail_group__v",
      event_content__v: "events_clm__v",
      clm_presentation_status__v: "staged__v",
      start_date__v: "2024-01-15",
      end_date__v: "2025-12-31",
      approved__v: true,
      hidden__v: false,
      training__v: false,
      default_presentation__v: true,
      enable_survey_overlay__v: false,
      keywords__v: "cardio;launch",
      description__v: "Launch deck",
      original_record_id__v: ORIGINAL_ID,
      parentid__v: ORIGINAL_ID,
      copied_from__v: ORIGINAL_ID,
      copy_date__v: "2024-02-01T09:30:00.000Z",
      active__v: true,
      ownerid__v: { $user: SAMPLE_USER_ID },
      created_date__v: "2021-02-03T04:05:06.000Z",
      created_by__v: { $user: SAMPLE_USER_ID },
      modified_date__v: "2025-01-01T00:00:00.000Z",
      modified_by__v: { $user: SAMPLE_USER_ID },
    });
    expect(JSON.stringify(r.payload)).not.toContain("V0P1");
    expect(r.payload.status__v).toBeUndefined();
    expect(r.secondPass).toEqual({});
    // survey reference dropped and counted
    expect(r.payload.survey__v).toBeUndefined();
    expect(r.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "out_of_scope_ref_dropped",
        field: "survey__v",
        code: "OUT_OF_SCOPE_REF_DROPPED",
        value: SURVEY_ID,
      }),
    );
    expect(r.unresolvedRequiredFks).toEqual([]);
  });

  it("never overwrites the integration-owned external_id__v unless externalIdOwnedBy = migration", () => {
    const owned = run(sampleRow({ External_ID_vod__c: "EXT-P-1" }));
    expect(owned.mapping.options.externalIdOwnedBy).toBe("integration");
    expect(owned.result.status).toBe("ok");
    expect(owned.result.payload.external_id__v).toBeUndefined();
    const migration = run(sampleRow({ External_ID_vod__c: "EXT-P-1" }), {
      overrides: { externalIdOwnedBy: "migration" },
    });
    expect(migration.result.payload.external_id__v).toBe("EXT-P-1");
  });

  it("reports an unresolved required product as pending_fk", () => {
    const { result: r } = run(sampleRow(), {
      knownProduct: false,
      productRequired: true,
    });
    expect(r.status).toBe("pending_fk");
    expect(r.unresolvedRequiredFks).toEqual([
      { field: "product__v", objectKey: "product", sfdcId: PRODUCT_ID },
    ]);
    const optional = run(sampleRow(), { knownProduct: false });
    expect(optional.result.status).toBe("ok");
    expect(optional.result.payload.product__v).toBeUndefined();
  });

  it("inactivates: Active_vod__c = false → status__v = inactive__v and active__v = false", () => {
    const { result: r } = run(sampleRow({ Active_vod__c: "false" }));
    expect(r.payload.status__v).toBe("inactive__v");
    expect(r.payload.active__v).toBe(false);
  });

  it("skips a status crosswalked to null and rejects an out-of-range date", () => {
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
          picklists: { "clm_presentation.status": { Staged_vod: null } },
        },
      },
    });
    const mapping = materialise(
      clm_presentation,
      resolveCountry(config, "US"),
      config,
      { now: NOW },
    );
    const r = applyMapping(
      sampleRow({ End_Date_vod__c: "1600-01-01" }),
      mapping,
      {
        country: buildCountryContext(),
        metadata: metadata(),
        ids: buildIdResolver(
          { product: { [PRODUCT_ID]: "V0P1" } },
          { [SAMPLE_USER_ID]: 101 },
        ),
        migrationUserId: 1,
        runMode: "init",
        custom: clm_presentation.custom,
      },
    );
    expect(r.status).toBe("ok");
    expect(r.payload.clm_presentation_status__v).toBeUndefined();
    expect(r.payload.end_date__v).toBeUndefined();
    expect(r.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "out_of_range",
        field: "end_date__v",
        code: "SF_DATETIME_RANGE",
      }),
    );
  });

  it("is unscoped (full): the scope builder yields no predicate", () => {
    const { mapping } = run(sampleRow());
    expect(mapping.scope.spec).toEqual({ kind: "full" });
    expect(buildScopePredicate(mapping.scope)).toEqual({ kind: "full" });
  });
});

describe("clm_presentation helpers", () => {
  it("renameContentField applies the §6.0.2 field rule", () => {
    expect(renameContentField("Default_Presentation_vod__c")).toBe(
      "default_presentation__v",
    );
    expect(renameContentField("ParentId_vod__c")).toBe("parentid__v");
  });
});
