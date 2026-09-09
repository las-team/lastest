import { describe, expect, it } from "vitest";
import {
  CONSENT_OPTOUT_EVENT_TYPE_MISSING_CODE,
  CONSENT_TYPE_CONFIG,
  MULTICHANNEL_CONSENT_CONFIG_MAP_NAMES,
  MULTICHANNEL_CONSENT_OBJECT_TYPES,
  MULTICHANNEL_CONSENT_OPTOUT_EVENT_TYPE,
  MULTICHANNEL_CONSENT_OPT_TYPE,
  MULTICHANNEL_CONSENT_ORDER_BY,
  VT_CONSENT_CONFIG_UNMATCHED_CODE,
  configExternalIdPath,
  configMapOf,
  configNamePath,
  consentConfigRef,
  consentType,
  multichannel_consent,
  optoutEventType,
} from "./multichannel_consent";
import { validateObjectModule } from "../types";
import { materialise, resolveCountry } from "../../config/resolve";
import { parseConfig } from "../../config/schema";
import { applyMapping } from "../../transform/apply";
import { buildScopePredicate } from "../../extract/scope";
import {
  IDS,
  SAMPLE_USER_ID,
  buildCountryContext,
  buildIdResolver,
  buildTransformContext,
  buildVaultMetadata,
  resolveMetadata,
} from "../../testkit";
import { to15, to18 } from "../../transform/ids";
import type { SourceRow } from "../../types";

const NOW = new Date("2026-09-07T00:00:00Z");
const CONSENT_ID = to18("a0M000000000001");
const CONSENT_TYPE_ID = to18("a0X000000000001");
const CONSENT_LINE_ID = to18("a0Y000000000001");
const CONTENT_TYPE_ID = to18("a0Z000000000001");
const TEMPLATE_ID = to18("a0W000000000001");
const PRODUCT_ID = to18("a0P000000000001");
const DETAIL_GROUP_ID = to18("a0P000000000002");
const SENT_EMAIL_ID = to18("a0S000000000001");

function config(overrides: Record<string, unknown> = {}) {
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
    objects: {
      multichannel_consent: {
        configMaps: {
          consentType: { [CONSENT_TYPE_ID]: "external_id:AE_US" },
          consentLine: { [CONSENT_LINE_ID]: "name:Marketing Email" },
          contentType: { [CONTENT_TYPE_ID]: "V0CT00000000001" },
          consentTemplate: {},
        },
        ...overrides,
      },
    },
    countries: { US: {} },
  });
}

const METADATA = resolveMetadata(
  buildVaultMetadata(
    "multichannel_consent__v",
    [
      {
        name: "account__v",
        type: "Object",
        object: { name: "account__v" },
        required: true,
      },
      {
        name: "consent_type__v",
        type: "Object",
        object: { name: "consent_type__v" },
        required: true,
      },
      {
        name: "consent_line__v",
        type: "Object",
        object: { name: "consent_line__v" },
      },
      {
        name: "content_type__v",
        type: "Object",
        object: { name: "content_type__v" },
      },
      {
        name: "sample_consent_template__v",
        type: "Object",
        object: { name: "consent_template__v" },
      },
      {
        name: "opt_type__v",
        type: "Picklist",
        picklist: "opt_type__v",
        required: true,
      },
      {
        name: "optout_event_type__v",
        type: "Picklist",
        picklist: "optout_event_type__v",
      },
      {
        name: "channel_value__v",
        type: "String",
        max_length: 80,
        required: true,
      },
      { name: "sub_channel_key__v", type: "String", max_length: 255 },
      { name: "capture_datetime__v", type: "DateTime" },
      { name: "consent_confirm_datetime__v", type: "DateTime" },
      { name: "signature_datetime__v", type: "DateTime" },
      { name: "opt_expiration_date__v", type: "Date" },
      { name: "product__v", type: "Object", object: { name: "product__v" } },
      {
        name: "detail_group__v",
        type: "Object",
        object: { name: "product__v" },
      },
      {
        name: "sent_email__v",
        type: "Object",
        object: { name: "sent_email__v" },
      },
      { name: "external_id__v", type: "String", max_length: 120, unique: true },
      { name: "related_transaction_id__v", type: "String", max_length: 255 },
      { name: "signature_id__v", type: "String", max_length: 255 },
      { name: "signature__v", type: "LongText", max_length: 32000 },
      { name: "default_consent_text__v", type: "LongText", max_length: 32000 },
      { name: "disclaimer_text__v", type: "LongText", max_length: 32000 },
      { name: "activity_tracking__v", type: "LongText", max_length: 32000 },
      {
        name: "activity_tracking_mode__v",
        type: "Picklist",
        picklist: "activity_tracking_mode__v",
      },
      {
        name: "sample_consent_template_data__v",
        type: "LongText",
        max_length: 32000,
      },
      { name: "mobile_id__v", type: "String", max_length: 100 },
      { name: "ownerid__v", type: "Object", object: { name: "user__sys" } },
    ],
    { objectTypes: Object.values(MULTICHANNEL_CONSENT_OBJECT_TYPES) },
  ),
  {
    picklists: {
      opt_type__v: Object.values(MULTICHANNEL_CONSENT_OPT_TYPE),
      optout_event_type__v: Object.values(
        MULTICHANNEL_CONSENT_OPTOUT_EVENT_TYPE,
      ),
      activity_tracking_mode__v: ["email__v"],
    },
  },
);

function consentRow(extra: Partial<SourceRow> = {}): SourceRow {
  return {
    Id: CONSENT_ID,
    Name: "MC-000001",
    "RecordType.DeveloperName": "Approved_Email_vod",
    Account_vod__c: IDS.account1,
    Consent_Type_vod__c: CONSENT_TYPE_ID,
    Consent_Line_vod__c: CONSENT_LINE_ID,
    Content_Type_vod__c: CONTENT_TYPE_ID,
    Sample_Consent_Template_vod__c: TEMPLATE_ID,
    "Sample_Consent_Template_vod__r.External_ID_vod__c": "TPL-US-1",
    "Sample_Consent_Template_vod__r.Name": "US sample template",
    Opt_Type_vod__c: "Opt_In_vod",
    Optout_Event_Type_vod__c: "",
    Channel_Value_vod__c: "  dr.smith@example.com ",
    Sub_Channel_Key_vod__c: "AE",
    Capture_Datetime_vod__c: "2025-03-04T10:05:00.000Z",
    Consent_Confirm_Datetime_vod__c: "2025-03-04T10:06:00.000Z",
    Signature_Datetime_vod__c: "2025-03-04T10:05:30.000Z",
    Opt_Expiration_Date_vod__c: "2027-03-04",
    Product_vod__c: PRODUCT_ID,
    Detail_Group_vod__c: DETAIL_GROUP_ID,
    Sent_Email_vod__c: SENT_EMAIL_ID,
    External_ID_vod__c: "EXT-MC-1",
    Related_Transaction_Id_vod__c: "TX-1",
    Signature_ID_vod__c: "SIG-1",
    Signature_vod__c: "data:image/png;base64,AAAA",
    Default_Consent_Text_vod__c: "I agree to receive emails.",
    Disclaimer_Text_vod__c: "You can opt out at any time.",
    Activity_Tracking_vod__c: "tracked",
    Activity_Tracking_Mode_vod__c: "Email_vod",
    Sample_Consent_Template_Data_vod__c: "{}",
    Mobile_ID_vod__c: "mob-mc-1",
    OwnerId: SAMPLE_USER_ID,
    CreatedById: SAMPLE_USER_ID,
    CreatedDate: "2025-03-04T10:31:00.000Z",
    LastModifiedById: SAMPLE_USER_ID,
    LastModifiedDate: "2025-03-04T10:31:00.000Z",
    ...extra,
  };
}

function run(
  row: SourceRow,
  opts: {
    overrides?: Record<string, unknown>;
    knownAccount?: boolean;
  } = {},
) {
  const cfg = config(opts.overrides);
  const mapping = materialise(
    multichannel_consent,
    resolveCountry(cfg, "US"),
    cfg,
    { now: NOW },
  );
  const ids = buildIdResolver(
    {
      account: opts.knownAccount === false ? {} : { [IDS.account1]: "V0A1" },
      product: { [PRODUCT_ID]: "V0P1", [DETAIL_GROUP_ID]: "V0P2" },
      sent_email: { [SENT_EMAIL_ID]: "V0S1" },
    },
    { [SAMPLE_USER_ID]: 101 },
  );
  return {
    mapping,
    result: applyMapping(row, mapping, {
      country: buildCountryContext(),
      metadata: METADATA,
      ids,
      migrationUserId: 1,
      runMode: "init",
      custom: multichannel_consent.custom,
    }),
  };
}

describe("multichannel_consent module", () => {
  it("is structurally valid", () => {
    expect(
      validateObjectModule(multichannel_consent).filter(
        (i) => i.severity === "blocking",
      ),
    ).toEqual([]);
    expect(multichannel_consent.notes).not.toContain("STUB");
  });

  it("encodes the §6.2 / §6.3.42 / §3.3 / §4.4 catalogue facts", () => {
    expect(multichannel_consent.source).toBe("Multichannel_Consent_vod__c");
    expect(multichannel_consent.target).toBe("multichannel_consent__v");
    expect(multichannel_consent.targetEvidence).toBe("DOC");
    // never time-scoped
    expect(multichannel_consent.scope).toEqual({ kind: "full" });
    expect(multichannel_consent.countryOf).toEqual([{ kind: "account" }]);
    expect(multichannel_consent.dependsOn).toEqual([
      "account",
      "product",
      "sent_email",
    ]);
    expect(multichannel_consent.selfRefs).toEqual([]);
    // chronological external sort
    expect(multichannel_consent.orderBy).toEqual(MULTICHANNEL_CONSENT_ORDER_BY);
    expect(multichannel_consent.load).toMatchObject({
      noTriggers: true,
      orderBy: ["Capture_Datetime_vod__c", "Id"],
    });
    expect(multichannel_consent.deletePolicy).toBe("ignore");
    expect(multichannel_consent.inactivate).toEqual([]);
    expect(multichannel_consent.createPolicy).toBe("create");
    expect(multichannel_consent.objectTypes).toEqual({
      Approved_Email_vod: "approved_email__v",
      CLM_vod: "clm__v",
      Engage_vod: "engage__v",
      Sample_Consent_vod: "sample_consent__v",
    });
    expect(multichannel_consent.blockS.objectType).toBe(true);
    expect(multichannel_consent.configObjects).toEqual([
      "consentType",
      "consentLine",
      "contentType",
      "consentTemplate",
    ]);
    expect(MULTICHANNEL_CONSENT_CONFIG_MAP_NAMES).toEqual(
      multichannel_consent.configObjects,
    );
    expect(multichannel_consent.blobs).toEqual({ signature: "optional" });
    expect(multichannel_consent.match.map((m) => m.method)).toEqual([
      "legacy_id",
      "external_id",
      "mobile_id",
      "natural_key",
    ]);
    expect(multichannel_consent.match[3]).toMatchObject({
      sameCountry: true,
      keys: [
        { target: "account__v" },
        { target: "consent_type__v" },
        { target: "channel_value__v" },
        { target: "capture_datetime__v" },
      ],
    });
    expect(
      multichannel_consent.picklists["multichannel_consent.optType"],
    ).toEqual(MULTICHANNEL_CONSENT_OPT_TYPE);
    expect(
      multichannel_consent.picklists["multichannel_consent.optoutEventType"],
    ).toEqual(MULTICHANNEL_CONSENT_OPTOUT_EVENT_TYPE);
    expect(multichannel_consent.optionDefaults).toEqual({ configMaps: {} });
  });

  it("maps every §6.3.42 row with the spec's transform, requirement and evidence", () => {
    const byTarget = new Map(
      multichannel_consent.fields.map((f) => [f.target, f]),
    );
    expect(byTarget.get("legacy_crm_id__v")).toMatchObject({
      required: "K",
      transform: { kind: "legacyId" },
    });
    expect(byTarget.get("name__v")).toMatchObject({
      transform: { kind: "text", max: 128 },
    });
    expect(byTarget.get("object_type__v.api_name__v")).toMatchObject({
      transform: {
        kind: "objectType",
        mapKey: "multichannel_consent.objectType",
      },
    });
    expect(byTarget.get("account__v")).toMatchObject({
      required: "Y",
      evidence: "UNV",
      transform: { kind: "ref", objectKey: "account" },
    });
    // config-object references: one crosswalk each, base row + 2 selector rows
    for (const [target, mapName, required] of [
      ["consent_type__v", "consentType", "Y"],
      ["consent_line__v", "consentLine", "n"],
      ["content_type__v", "contentType", "n"],
      ["sample_consent_template__v", "consentTemplate", "n"],
    ] as const) {
      expect(byTarget.get(target)).toMatchObject({
        required,
        evidence: "DOC",
        countryConfigurable: true,
        transform: { kind: "custom", fnName: mapName },
      });
      expect(byTarget.get(`${target}.external_id`)).toMatchObject({
        unverifiedSource: true,
        optionalSource: true,
        transform: { kind: "custom", fnName: mapName },
      });
      expect(byTarget.get(`${target}.name`)).toMatchObject({
        optionalSource: true,
        transform: { kind: "custom", fnName: mapName },
      });
    }
    expect(byTarget.get("sample_consent_template__v.external_id")?.source).toBe(
      "Sample_Consent_Template_vod__r.External_ID_vod__c",
    );
    expect(byTarget.get("opt_type__v")).toMatchObject({
      required: "Y",
      evidence: "DOC",
      transform: { kind: "picklist", mapKey: "multichannel_consent.optType" },
    });
    expect(byTarget.get("optout_event_type__v")).toMatchObject({
      evidence: "DOC",
      transform: { kind: "custom", fnName: "optoutEventType" },
    });
    expect(byTarget.get("channel_value__v")).toMatchObject({
      required: "Y",
      evidence: "DOC",
      transform: { kind: "text" },
    });
    expect(byTarget.get("sub_channel_key__v")).toMatchObject({
      evidence: "UNV",
      transform: { kind: "text" },
    });
    expect(byTarget.get("capture_datetime__v")).toMatchObject({
      required: "y?",
      evidence: "UNV",
      transform: { kind: "datetime" },
    });
    for (const t of ["consent_confirm_datetime__v", "signature_datetime__v"])
      expect(byTarget.get(t)).toMatchObject({
        transform: { kind: "datetime" },
      });
    expect(byTarget.get("opt_expiration_date__v")).toMatchObject({
      transform: { kind: "date" },
    });
    for (const [t, key] of [
      ["product__v", "product"],
      ["detail_group__v", "product"],
      ["sent_email__v", "sent_email"],
    ] as const)
      expect(byTarget.get(t)).toMatchObject({
        required: "n",
        evidence: "UNV",
        transform: { kind: "ref", objectKey: key },
      });
    // external_id__v: the module row replaces the Block S row (UNV for this object)
    expect(byTarget.get("external_id__v")).toMatchObject({
      source: "External_ID_vod__c",
      evidence: "UNV",
      transform: { kind: "copy" },
    });
    expect(
      multichannel_consent.fields.filter((f) => f.target === "external_id__v"),
    ).toHaveLength(1);
    for (const t of ["related_transaction_id__v", "signature_id__v"])
      expect(byTarget.get(t)).toMatchObject({ transform: { kind: "copy" } });
    expect(byTarget.get("signature__v")).toMatchObject({
      blobName: "signature",
      transform: { kind: "deferredBlob", blobName: "signature" },
    });
    for (const t of ["default_consent_text__v", "disclaimer_text__v"])
      expect(byTarget.get(t)).toMatchObject({
        truncation: "fail",
        transform: { kind: "longtext" },
      });
    expect(byTarget.get("activity_tracking__v")).toMatchObject({
      evidence: "DOC",
      transform: { kind: "longtext" },
    });
    expect(byTarget.get("activity_tracking_mode__v")).toMatchObject({
      evidence: "DOC",
      optionalSource: true,
      transform: {
        kind: "picklist",
        mapKey: "multichannel_consent.activityTrackingMode",
      },
    });
    expect(byTarget.get("sample_consent_template_data__v")).toMatchObject({
      evidence: "UNV",
      transform: { kind: "longtext" },
    });
    // transactional: no status derivation
    expect(byTarget.has("status__v")).toBe(false);
  });

  it("transforms an opt-in row (legacy id, FKs deferred, config crosswalks, picklists, dates, object type, blob)", () => {
    const { result } = run(consentRow());
    expect(result.status).toBe("ok");
    expect(result.objectType).toBe("approved_email__v");
    expect(result.payload).toMatchObject({
      legacy_crm_id__v: CONSENT_ID,
      name__v: "MC-000001",
      "object_type__v.api_name__v": "approved_email__v",
      account__v: { $fk: { object: "account", sfdcId: IDS.account1 } },
      // (1) explicit map: external_id:<v> → lookup form
      "consent_type__v.external_id__v": "AE_US",
      // (1) explicit map: name:<v> → lookup form
      "consent_line__v.name__v": "Marketing Email",
      // (1) explicit map: Vault record id (config crosswalk exception)
      content_type__v: "V0CT00000000001",
      // (2) automatic: relationship External_ID_vod__c
      "sample_consent_template__v.external_id__v": "TPL-US-1",
      opt_type__v: "opt_in__v",
      channel_value__v: "dr.smith@example.com",
      sub_channel_key__v: "AE",
      capture_datetime__v: "2025-03-04T10:05:00.000Z",
      consent_confirm_datetime__v: "2025-03-04T10:06:00.000Z",
      signature_datetime__v: "2025-03-04T10:05:30.000Z",
      opt_expiration_date__v: "2027-03-04",
      product__v: { $fk: { object: "product", sfdcId: PRODUCT_ID } },
      detail_group__v: { $fk: { object: "product", sfdcId: DETAIL_GROUP_ID } },
      sent_email__v: { $fk: { object: "sent_email", sfdcId: SENT_EMAIL_ID } },
      external_id__v: "EXT-MC-1",
      related_transaction_id__v: "TX-1",
      signature_id__v: "SIG-1",
      default_consent_text__v: "I agree to receive emails.",
      disclaimer_text__v: "You can opt out at any time.",
      activity_tracking__v: "tracked",
      activity_tracking_mode__v: "email__v",
      sample_consent_template_data__v: "{}",
      mobile_id__v: "mob-mc-1",
      ownerid__v: { $user: SAMPLE_USER_ID },
      created_by__v: { $user: SAMPLE_USER_ID },
      created_date__v: "2025-03-04T10:31:00.000Z",
      last_device__v: "data_load__v",
    });
    // never a Vault id for a mapped object, never a raw SFDC id in a reference
    expect(result.payload.consent_type__v).toBeUndefined();
    expect(result.payload.consent_line__v).toBeUndefined();
    expect(result.payload.sample_consent_template__v).toBeUndefined();
    // opt-in: no opt-out event type
    expect(result.payload.optout_event_type__v).toBeUndefined();
    // signature deferred to the blob pass
    expect(result.payload.signature__v).toBeUndefined();
    expect(result.blobs.signature__v).toBe("data:image/png;base64,AAAA");
    expect(result.secondPass).toEqual({});
    expect(result.diagnostics.some((d) => d.fatal)).toBe(false);
    expect(result.fkEdges).toContainEqual({
      field: "account__v",
      targetObjectKey: "account",
      targetSfdcId: IDS.account1,
    });
  });

  it("requires optout_event_type__v for opt-outs only", () => {
    const optOut = run(
      consentRow({
        Opt_Type_vod__c: "Opt_Out_vod",
        Optout_Event_Type_vod__c: "Unsubscribed_vod",
      }),
    );
    expect(optOut.result.status).toBe("ok");
    expect(optOut.result.payload.opt_type__v).toBe("opt_out__v");
    expect(optOut.result.payload.optout_event_type__v).toBe("unsubscribed__v");

    const missing = run(
      consentRow({
        Opt_Type_vod__c: "Opt_Out_vod",
        Optout_Event_Type_vod__c: "",
      }),
    );
    expect(missing.result.status).toBe("failed");
    expect(missing.result.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "required_missing",
        field: "optout_event_type__v",
        code: CONSENT_OPTOUT_EVENT_TYPE_MISSING_CODE,
        fatal: true,
      }),
    );

    const pending = run(consentRow({ Opt_Type_vod__c: "Opt_In_Pending_vod" }));
    expect(pending.result.status).toBe("ok");
    expect(pending.result.payload.opt_type__v).toBe("opt_in_pending__v");
    expect(pending.result.payload.optout_event_type__v).toBeUndefined();
  });

  it("falls back to the config row Name and reports unmatched config rows", () => {
    const byName = run(
      consentRow({
        "Sample_Consent_Template_vod__r.External_ID_vod__c": "",
      }),
    );
    expect(byName.result.status).toBe("ok");
    expect(byName.result.payload["sample_consent_template__v.name__v"]).toBe(
      "US sample template",
    );
    expect(
      byName.result.payload["sample_consent_template__v.external_id__v"],
    ).toBeUndefined();

    // optional config reference without any hit: omitted + counted, row still ok
    const unmatched = run(
      consentRow({
        "Sample_Consent_Template_vod__r.External_ID_vod__c": "",
        "Sample_Consent_Template_vod__r.Name": "",
      }),
    );
    expect(unmatched.result.status).toBe("ok");
    expect(unmatched.result.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "unresolved_fk",
        field: "sample_consent_template__v",
        code: VT_CONSENT_CONFIG_UNMATCHED_CODE,
        value: TEMPLATE_ID,
      }),
    );
    expect(unmatched.result.diagnostics.some((d) => d.fatal)).toBe(false);

    // the required consent type without any hit fails the row
    const noType = run(consentRow(), {
      overrides: { configMaps: { consentType: {} } },
    });
    expect(noType.result.status).toBe("failed");
    expect(noType.result.failure).toMatchObject({ field: "consent_type__v" });
    expect(noType.result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: VT_CONSENT_CONFIG_UNMATCHED_CODE,
        field: "consent_type__v",
        fatal: true,
      }),
    );
  });

  it("reports an unknown account as pending_fk", () => {
    const { result } = run(consentRow(), { knownAccount: false });
    expect(result.status).toBe("pending_fk");
    expect(result.unresolvedRequiredFks).toEqual([
      { field: "account__v", objectKey: "account", sfdcId: IDS.account1 },
    ]);
    expect(result.payload.account__v).toEqual({
      $fk: { object: "account", sfdcId: IDS.account1 },
    });
  });

  it("never truncates consent text silently (truncation: fail)", () => {
    const { result } = run(
      consentRow({ Disclaimer_Text_vod__c: "x".repeat(32001) }),
    );
    expect(result.status).toBe("failed");
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "truncated",
        field: "disclaimer_text__v",
        fatal: true,
      }),
    );
  });

  it("scope: never time-scoped (full), external sort keys kept on the mapping", () => {
    const { mapping } = run(consentRow());
    expect(mapping.scope.spec).toEqual({ kind: "full" });
    expect(buildScopePredicate(mapping.scope)).toEqual({ kind: "full" });
    expect(mapping.load.orderBy).toEqual(["Capture_Datetime_vod__c", "Id"]);
  });

  it("consentConfigRef: explicit map forms, 15-char keys, selector rows, bad ids, blanks", () => {
    const ctx = (maps?: Record<string, string>, target = "consent_type__v") =>
      buildTransformContext({
        objectKey: "multichannel_consent",
        field: { source: "Consent_Type_vod__c", target },
        mapping: {
          options: { configMaps: maps ? { consentType: maps } : undefined },
        } as never,
      });
    const row: SourceRow = { Id: CONSENT_ID };
    expect(
      consentType(CONSENT_TYPE_ID, row, ctx({ [CONSENT_TYPE_ID]: "V0X1" })),
    ).toEqual({ value: "V0X1" });
    // 15-char key in the overlay still matches an 18-char source id
    expect(
      consentType(
        CONSENT_TYPE_ID,
        row,
        ctx({ [to15(CONSENT_TYPE_ID)]: "external_id:AE_DE" }),
      ),
    ).toEqual({
      value: "AE_DE",
      targetField: "consent_type__v.external_id__v",
    });
    expect(
      consentType(CONSENT_TYPE_ID, row, ctx({ [CONSENT_TYPE_ID]: "name:AE" })),
    ).toEqual({ value: "AE", targetField: "consent_type__v.name__v" });
    // selector rows emit nothing
    expect(
      consentType(
        "X",
        row,
        ctx({ [CONSENT_TYPE_ID]: "V0X1" }, "consent_type__v.external_id"),
      ),
    ).toBeUndefined();
    expect(consentType("", row, ctx())).toBeUndefined();
    expect(consentType("not-an-id", row, ctx())).toMatchObject({
      omit: true,
      diagnostic: { kind: "invalid_value", code: "INVALID_ID" },
    });
    // relationship fallbacks when no map is configured
    expect(
      consentType(
        CONSENT_TYPE_ID,
        { Id: CONSENT_ID, "Consent_Type_vod__r.External_ID_vod__c": "AE_X" },
        ctx(),
      ),
    ).toEqual({ value: "AE_X", targetField: "consent_type__v.external_id__v" });
    expect(
      consentType(
        CONSENT_TYPE_ID,
        { Id: CONSENT_ID, "Consent_Type_vod__r.Name": "Approved Email" },
        ctx(),
      ),
    ).toEqual({
      value: "Approved Email",
      targetField: "consent_type__v.name__v",
    });
    expect(consentType(CONSENT_TYPE_ID, row, ctx({}))).toMatchObject({
      omit: true,
      diagnostic: { code: VT_CONSENT_CONFIG_UNMATCHED_CODE, fatal: false },
    });
    // factory + helpers
    expect(configExternalIdPath(CONSENT_TYPE_CONFIG.source)).toBe(
      "Consent_Type_vod__r.External_ID_vod__c",
    );
    expect(configNamePath("Consent_Line_vod__c")).toBe(
      "Consent_Line_vod__r.Name",
    );
    expect(
      configMapOf(
        {
          configMaps: {
            consentLine: { [to15(CONSENT_LINE_ID)]: "V0Y1", x: "" },
          },
        },
        "consentLine",
      ),
    ).toEqual({ [CONSENT_LINE_ID]: "V0Y1" });
    expect(configMapOf({ configMaps: false }, "consentLine")).toBeUndefined();
    expect(configMapOf({}, "consentType")).toBeUndefined();
    expect(typeof consentConfigRef(CONSENT_TYPE_CONFIG)).toBe("function");
  });

  it("optoutEventType: crosswalk + conditional requirement (unit)", () => {
    const ctx = buildTransformContext({
      objectKey: "multichannel_consent",
      field: {
        source: "Optout_Event_Type_vod__c",
        target: "optout_event_type__v",
      },
      targetField: {
        name: "optout_event_type__v",
        type: "picklist",
        picklistValues: Object.values(MULTICHANNEL_CONSENT_OPTOUT_EVENT_TYPE),
      },
      mapping: {
        picklists: {
          "multichannel_consent.optoutEventType": {
            ...MULTICHANNEL_CONSENT_OPTOUT_EVENT_TYPE,
          },
        },
      },
    });
    expect(
      optoutEventType(
        "Bounced_vod",
        { Id: CONSENT_ID, Opt_Type_vod__c: "Opt_Out_vod" },
        ctx,
      ),
    ).toMatchObject({ value: "bounced__v" });
    expect(
      optoutEventType(
        "",
        { Id: CONSENT_ID, Opt_Type_vod__c: "Opt_In_vod" },
        ctx,
      ),
    ).toBeUndefined();
    expect(
      optoutEventType(
        "",
        { Id: CONSENT_ID, Opt_Type_vod__c: "Opt_Out_vod" },
        ctx,
      ),
    ).toMatchObject({
      omit: true,
      diagnostic: { code: CONSENT_OPTOUT_EVENT_TYPE_MISSING_CODE, fatal: true },
    });
  });
});
