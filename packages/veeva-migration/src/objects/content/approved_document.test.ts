import { describe, expect, it } from "vitest";
import {
  APPROVED_DOCUMENT_BOOLEAN_FIELDS,
  APPROVED_DOCUMENT_HTML_BLOB,
  APPROVED_DOCUMENT_HTML_FIELDS,
  APPROVED_DOCUMENT_ID_FIELDS,
  APPROVED_DOCUMENT_OBJECT_TYPES,
  APPROVED_DOCUMENT_STATUS_DEFAULTS,
  APPROVED_DOCUMENT_TEXT_FIELDS,
  CONTENT_TYPE_EXTERNAL_ID_PATH,
  CONTENT_TYPE_NAME_PATH,
  PUBLISH_METHOD_VALUES,
  approved_document,
  contentType,
  publishMethod,
  renameApprovedDocumentField,
} from "./approved_document";
import { validateObjectModule } from "../types";
import { materialise, resolveCountry } from "../../config/resolve";
import { parseConfig } from "../../config/schema";
import { applyMapping } from "../../transform/apply";
import { renameObjectType } from "../../transform/rename";
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
const DOC_ID = to18("a0R000000000001");
const PRODUCT_ID = to18("a0P000000000001");
const DETAIL_GROUP_ID = to18("a0P000000000002");
const KM_ID = to18("a0M000000000001");
const CONTENT_TYPE_ID = to18("a1C000000000001");
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
    objects: {
      approved_document: {
        configMaps: {
          contentType: { [CONTENT_TYPE_ID]: "external_id:CT-EMAIL" },
        },
        ...overrides,
      },
    },
    countries: { US: {} },
  });
}

const OBJECT_TYPE_NAMES = Object.values(APPROVED_DOCUMENT_OBJECT_TYPES);

function metadata() {
  return resolveMetadata(
    buildVaultMetadata(
      "approved_document__v",
      [
        { name: "document_id__v", type: "String", max_length: 100 },
        { name: "vault_document_id__v", type: "String", max_length: 100 },
        { name: "vault_instance_id__v", type: "String", max_length: 100 },
        { name: "document_last_mod_datetime__v", type: "DateTime" },
        {
          name: "approved_document_status__v",
          type: "Picklist",
          picklist: "approved_document_status__v",
        },
        {
          name: "publish_method__v",
          type: "Picklist",
          picklist: "publish_method__v",
        },
        { name: "product__v", type: "Object", object: { name: "product__v" } },
        {
          name: "detail_group__v",
          type: "Object",
          object: { name: "product__v" },
        },
        {
          name: "key_message__v",
          type: "Object",
          object: { name: "key_message__v" },
        },
        {
          name: "content_type__v",
          type: "Object",
          object: { name: "content_type__v" },
        },
        { name: "language__v", type: "Picklist", picklist: "language__v" },
        { name: "territory__v", type: "String", max_length: 255 },
        { name: "email_subject__v", type: "String", max_length: 255 },
        { name: "email_from_address__v", type: "String", max_length: 255 },
        { name: "email_from_name__v", type: "String", max_length: 255 },
        { name: "email_replyto_address__v", type: "String", max_length: 255 },
        { name: "email_replyto_name__v", type: "String", max_length: 255 },
        { name: "email_domain__v", type: "String", max_length: 255 },
        { name: "bcc__v", type: "String", max_length: 255 },
        { name: "email_allows_documents__v", type: "Boolean" },
        { name: "allow_any_product_fragment__v", type: "Boolean" },
        { name: "allowed_document_ids__v", type: "LongText" },
        { name: "pi_document_id__v", type: "String", max_length: 100 },
        { name: "isi_document_id__v", type: "String", max_length: 100 },
        { name: "piece_document_id__v", type: "String", max_length: 100 },
        { name: "other_document_id__v", type: "String", max_length: 100 },
        { name: "engage_document_id__v", type: "String", max_length: 100 },
        {
          name: "events_management_subtype__v",
          type: "Picklist",
          picklist: "events_management_subtype__v",
        },
        { name: "document_host_url__v", type: "String", max_length: 1500 },
        { name: "document_description__v", type: "LongText" },
        { name: "email_html_1__v", type: "LongText" },
        { name: "email_html_2__v", type: "LongText" },
        { name: "email_fragment_html__v", type: "LongText" },
        { name: "email_template_fragment_html__v", type: "LongText" },
        {
          name: "email_template_fragment_document_id__v",
          type: "LongText",
        },
        { name: "ownerid__v", type: "Object", object: { name: "user__sys" } },
      ],
      { objectTypes: OBJECT_TYPE_NAMES },
    ),
    {
      picklists: {
        approved_document_status__v: Object.values(
          APPROVED_DOCUMENT_STATUS_DEFAULTS,
        ),
        publish_method__v: Object.values(PUBLISH_METHOD_VALUES),
        language__v: ["en_us__v"],
        events_management_subtype__v: [
          "save_the_date__v",
          "reminder__v",
          "invitation__v",
          "follow_up__v",
        ],
        status__v: ["active__v", "inactive__v"],
      },
    },
  );
}

function sampleRow(extra: Partial<SourceRow> = {}): SourceRow {
  return {
    Id: "a0R000000000001",
    Name: " Cholecap Launch Email ",
    "RecordType.DeveloperName": "Email_Template_vod",
    Document_ID_vod__c: "DOC-0001",
    Vault_Document_ID_vod__c: "9001",
    Vault_Instance_ID_vod__c: "promomats",
    Document_Last_Mod_DateTime_vod__c: "2024-05-01T12:00:00.000Z",
    Status_vod__c: "Approved_vod",
    Product_vod__c: PRODUCT_ID,
    Detail_Group_vod__c: DETAIL_GROUP_ID,
    Key_Message_vod__c: KM_ID,
    Content_Type_vod__c: CONTENT_TYPE_ID,
    Survey_vod__c: SURVEY_ID,
    Language_vod__c: "en_US",
    Territory_vod__c: "North East",
    Email_Subject_vod__c: "Cholecap news",
    Email_From_Address_vod__c: "rep@example.com",
    Email_From_Name_vod__c: "Rep",
    Email_ReplyTo_Address_vod__c: "reply@example.com",
    Email_ReplyTo_Name_vod__c: "Reply",
    Email_Domain_vod__c: "example.com",
    Bcc_vod__c: "audit@example.com",
    Email_Allows_Documents_vod__c: "true",
    Allow_Any_Product_Fragment_vod__c: "false",
    Allowed_Document_IDs_vod__c: "1,2,3",
    PI_Document_ID_vod__c: "PI-1",
    ISI_Document_ID_vod__c: "ISI-1",
    Piece_Document_ID_vod__c: "PIECE-1",
    Other_Document_ID_vod__c: "OTHER-1",
    Engage_Document_Id_vod__c: "ENG-1",
    Events_Management_Subtype_vod__c: "Invitation_vod",
    Document_Host_URL_vod__c: "https://host.example.com/doc/1",
    Document_Description_vod__c: "Launch email template",
    Email_HTML_1_vod__c: "<html>part 1</html>",
    Email_HTML_2_vod__c: "<html>part 2</html>",
    Email_Fragment_HTML_vod__c: "<p>fragment</p>",
    Email_Template_Fragment_HTML_vod__c: "<p>tpl fragment</p>",
    Email_Template_Fragment_Document_ID_vod__c: "TPLFRAG-1",
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
  opts: { overrides?: Record<string, unknown>; knownProducts?: boolean } = {},
) {
  const config = makeConfig(opts.overrides);
  const mapping = materialise(
    approved_document,
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
      key_message: { [KM_ID]: "V0M1" },
    },
    { [SAMPLE_USER_ID]: 101 },
  );
  return {
    mapping,
    result: applyMapping(row, mapping, {
      country: buildCountryContext(),
      metadata: metadata(),
      ids,
      migrationUserId: 1,
      runMode: "init",
      custom: approved_document.custom,
    }),
  };
}

describe("approved_document module", () => {
  it("is structurally valid", () => {
    expect(
      validateObjectModule(approved_document).filter(
        (i) => i.severity === "blocking",
      ),
    ).toEqual([]);
  });

  it("encodes the §6.2 / §4.4 / §6.3.17 catalogue facts", () => {
    expect(approved_document.source).toBe("Approved_Document_vod__c");
    expect(approved_document.target).toBe("approved_document__v");
    expect(approved_document.targetEvidence).toBe("DOC");
    expect(approved_document.scope).toEqual({ kind: "full" });
    expect(approved_document.countryOf).toEqual([{ kind: "global" }]);
    expect(approved_document.dependsOn).toEqual(["product", "key_message"]);
    expect(approved_document.selfRefs).toEqual([]);
    expect(approved_document.deletePolicy).toBe("inactivate");
    expect(approved_document.inactivate).toEqual([
      { field: "approved_document_status__v", value: "withdrawn__v" },
    ]);
    expect(approved_document.createPolicy).toBe("match-only");
    expect(approved_document.load.noTriggers).toBe(false);
    expect(approved_document.states).toEqual({});
    expect(approved_document.blobs).toEqual({
      [APPROVED_DOCUMENT_HTML_BLOB]: "optional",
    });
    expect(approved_document.configObjects).toEqual(["contentType"]);
    expect(approved_document.optionDefaults).toEqual({
      htmlOverflow: "truncate",
    });
    // no status derivation on approved documents (no Active_vod__c)
    expect(approved_document.blockS.statusFromFlag).toBeUndefined();
    expect(approved_document.blockS.objectType).toBe(true);
    expect(approved_document.notes).not.toContain("STUB");
  });

  it("ships the object-type crosswalk (all UNV, mechanical rename) and picklist defaults", () => {
    expect(approved_document.objectTypes).toEqual({
      Email_Template_vod: "email_template__v",
      Email_Fragment_vod: "email_fragment__v",
      Email_Receipt_vod: "email_receipt__v",
      Engage_vod: "engage__v",
      Events_Management_vod: "events_management__v",
      Medical_Inquiry_Template_vod: "medical_inquiry_template__v",
      Remote_Meeting_vod: "remote_meeting__v",
      CoBrowse_Invite_Template_vod: "cobrowse_invite_template__v",
      Case_Template_vod: "case_template__v",
    });
    for (const [dev, api] of Object.entries(APPROVED_DOCUMENT_OBJECT_TYPES))
      expect(renameObjectType(dev), dev).toBe(api);
    expect(approved_document.picklists["approved_document.status"]).toEqual({
      Staged_vod: "staged__v",
      Expired_vod: "expired__v",
      Withdrawn_vod: "withdrawn__v",
      Approved_vod: "approved__v",
    });
    expect(
      approved_document.picklists["approved_document.eventsManagementSubtype"],
    ).toEqual({
      Save_The_Date_vod: "save_the_date__v",
      Reminder_vod: "reminder__v",
      Invitation_vod: "invitation__v",
      Follow_Up_vod: "follow_up__v",
    });
    expect(approved_document.picklists["approved_document.language"]).toEqual(
      {},
    );
  });

  it("maps every §6.3.17 row with the spec's transform, requirement and evidence", () => {
    const byTarget = new Map(
      approved_document.fields.map((f) => [f.target, f]),
    );
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
    expect(byTarget.get("object_type__v.api_name__v")).toMatchObject({
      source: "RecordType.DeveloperName",
      required: "Y",
      transform: {
        kind: "objectType",
        mapKey: "approved_document.objectType",
      },
    });
    for (const [t, src, kind] of [
      ["document_id__v", "Document_ID_vod__c", "copy"],
      ["vault_document_id__v", "Vault_Document_ID_vod__c", "copy"],
      ["vault_instance_id__v", "Vault_Instance_ID_vod__c", "copy"],
      [
        "document_last_mod_datetime__v",
        "Document_Last_Mod_DateTime_vod__c",
        "datetime",
      ],
    ] as const)
      expect(byTarget.get(t), t).toMatchObject({
        source: src,
        required: "n",
        evidence: "UNV",
        transform: { kind },
      });
    expect(byTarget.get("approved_document_status__v")).toMatchObject({
      source: "Status_vod__c",
      evidence: "UNV",
      transform: { kind: "picklist", mapKey: "approved_document.status" },
    });
    expect(byTarget.get("publish_method__v")).toMatchObject({
      source: "",
      required: "n",
      evidence: "UNV",
      enabledBy: "publishMethod",
      transform: { kind: "custom", fnName: "publishMethod" },
    });
    expect(byTarget.get("product__v")).toMatchObject({
      source: "Product_vod__c",
      required: "n",
      evidence: "UNV",
      transform: { kind: "ref", objectKey: "product" },
    });
    expect(byTarget.get("detail_group__v")).toMatchObject({
      source: "Detail_Group_vod__c",
      transform: { kind: "ref", objectKey: "product" },
    });
    expect(byTarget.get("key_message__v")).toMatchObject({
      source: "Key_Message_vod__c",
      transform: { kind: "ref", objectKey: "key_message" },
    });
    expect(byTarget.get("content_type__v")).toMatchObject({
      source: "Content_Type_vod__c",
      evidence: "UNV",
      transform: { kind: "custom", fnName: "contentType" },
    });
    expect(byTarget.get("survey__v")).toMatchObject({
      source: "Survey_vod__c",
      transform: { kind: "custom", fnName: "outOfScopeRef" },
    });
    expect(byTarget.get("language__v")).toMatchObject({
      countryConfigurable: true,
      transform: { kind: "picklist", mapKey: "approved_document.language" },
    });
    expect(byTarget.get("territory__v")).toMatchObject({
      source: "Territory_vod__c",
      countryConfigurable: true,
      transform: { kind: "text" },
    });
    expect(APPROVED_DOCUMENT_TEXT_FIELDS).toHaveLength(9);
    for (const src of APPROVED_DOCUMENT_TEXT_FIELDS)
      expect(byTarget.get(renameApprovedDocumentField(src)), src).toMatchObject(
        {
          source: src,
          required: "n",
          evidence: "UNV",
          transform: { kind: "text" },
        },
      );
    for (const src of APPROVED_DOCUMENT_BOOLEAN_FIELDS)
      expect(byTarget.get(renameApprovedDocumentField(src)), src).toMatchObject(
        { source: src, transform: { kind: "bool" } },
      );
    expect(byTarget.get("allowed_document_ids__v")).toMatchObject({
      transform: { kind: "longtext" },
    });
    for (const src of APPROVED_DOCUMENT_ID_FIELDS)
      expect(byTarget.get(renameApprovedDocumentField(src)), src).toMatchObject(
        { source: src, unverifiedSource: true, transform: { kind: "text" } },
      );
    expect(byTarget.get("events_management_subtype__v")).toMatchObject({
      transform: {
        kind: "picklist",
        mapKey: "approved_document.eventsManagementSubtype",
      },
    });
    expect(byTarget.get("document_description__v")).toMatchObject({
      transform: { kind: "longtext" },
    });
    expect(APPROVED_DOCUMENT_HTML_FIELDS).toHaveLength(5);
    for (const src of APPROVED_DOCUMENT_HTML_FIELDS)
      expect(byTarget.get(renameApprovedDocumentField(src)), src).toMatchObject(
        {
          source: src,
          evidence: "UNV",
          blobName: APPROVED_DOCUMENT_HTML_BLOB,
          transform: {
            kind: "deferredBlob",
            blobName: APPROVED_DOCUMENT_HTML_BLOB,
          },
        },
      );
    expect(byTarget.get("external_id__v")).toBeDefined();
    expect(byTarget.get("ownerid__v")).toBeDefined();
  });

  it("carries the §3.3 precedence: vault document id → document id → legacy id", () => {
    expect(approved_document.match.map((m) => m.method)).toEqual([
      "external_id",
      "external_id",
      "legacy_id",
    ]);
    expect(approved_document.match.map((m) => m.keys?.[0])).toEqual([
      { target: "vault_document_id__v", source: "Vault_Document_ID_vod__c" },
      { target: "document_id__v", source: "Document_ID_vod__c" },
      undefined,
    ]);
    const { mapping } = run(sampleRow());
    expect(mapping.options.createPolicy).toBe("match-only");
    expect(mapping.options.externalIdOwnedBy).toBe("integration");
    expect(mapping.options.htmlOverflow).toBe("truncate");
    expect(mapping.options.inactivateBy).toEqual([
      { field: "approved_document_status__v", value: "withdrawn__v" },
    ]);
    expect(mapping.options.blobs).toEqual({
      [APPROVED_DOCUMENT_HTML_BLOB]: "optional",
    });
  });

  it("transforms a realistic Approved_Document_vod__c row", () => {
    const { mapping, result: r } = run(sampleRow());
    // publish_method__v is omitted by default: the row is gated by the flag
    expect(
      mapping.fields.find((f) => f.target === "publish_method__v"),
    ).toBeUndefined();
    expect(r.status).toBe("ok");
    expect(r.failure).toBeUndefined();
    expect(r.objectType).toBe("email_template__v");
    expect(r.payload).toMatchObject({
      legacy_crm_id__v: DOC_ID,
      name__v: "Cholecap Launch Email",
      "object_type__v.api_name__v": "email_template__v",
      document_id__v: "DOC-0001",
      vault_document_id__v: "9001",
      vault_instance_id__v: "promomats",
      document_last_mod_datetime__v: "2024-05-01T12:00:00.000Z",
      approved_document_status__v: "approved__v",
      product__v: { $fk: { object: "product", sfdcId: PRODUCT_ID } },
      detail_group__v: { $fk: { object: "product", sfdcId: DETAIL_GROUP_ID } },
      key_message__v: { $fk: { object: "key_message", sfdcId: KM_ID } },
      "content_type__v.external_id__v": "CT-EMAIL",
      language__v: "en_us__v",
      territory__v: "North East",
      email_subject__v: "Cholecap news",
      email_from_address__v: "rep@example.com",
      email_from_name__v: "Rep",
      email_replyto_address__v: "reply@example.com",
      email_replyto_name__v: "Reply",
      email_domain__v: "example.com",
      bcc__v: "audit@example.com",
      email_allows_documents__v: true,
      allow_any_product_fragment__v: false,
      allowed_document_ids__v: "1,2,3",
      pi_document_id__v: "PI-1",
      isi_document_id__v: "ISI-1",
      piece_document_id__v: "PIECE-1",
      other_document_id__v: "OTHER-1",
      engage_document_id__v: "ENG-1",
      events_management_subtype__v: "invitation__v",
      document_host_url__v: "https://host.example.com/doc/1",
      document_description__v: "Launch email template",
      ownerid__v: { $user: SAMPLE_USER_ID },
      created_date__v: "2021-02-03T04:05:06.000Z",
      created_by__v: { $user: SAMPLE_USER_ID },
      modified_date__v: "2025-01-01T00:00:00.000Z",
      modified_by__v: { $user: SAMPLE_USER_ID },
    });
    expect(JSON.stringify(r.payload)).not.toContain("V0P1");
    expect(r.payload.publish_method__v).toBeUndefined();
    expect(r.payload.status__v).toBeUndefined();
    expect(r.payload.content_type__v).toBeUndefined();
    // HTML bodies go to the blob pass, never the pass-1 payload
    for (const src of APPROVED_DOCUMENT_HTML_FIELDS)
      expect(r.payload[renameApprovedDocumentField(src)], src).toBeUndefined();
    expect(r.blobs).toEqual({
      email_html_1__v: "<html>part 1</html>",
      email_html_2__v: "<html>part 2</html>",
      email_fragment_html__v: "<p>fragment</p>",
      email_template_fragment_html__v: "<p>tpl fragment</p>",
      email_template_fragment_document_id__v: "TPLFRAG-1",
    });
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
    expect(r.secondPass).toEqual({});
    expect(r.unresolvedRequiredFks).toEqual([]);
  });

  it("sends publish_method__v only when configured and creating", () => {
    const creating = run(sampleRow(), {
      overrides: {
        createPolicy: "create",
        publishMethod: PUBLISH_METHOD_VALUES.manual,
      },
    });
    expect(
      creating.mapping.fields.find((f) => f.target === "publish_method__v"),
    ).toBeDefined();
    expect(creating.result.payload.publish_method__v).toBe("manual__v");
    // match-only unit: the integration claims the row later → omitted
    const matching = run(sampleRow(), {
      overrides: { publishMethod: PUBLISH_METHOD_VALUES.manual },
    });
    expect(matching.result.payload.publish_method__v).toBeUndefined();
    // a name outside the target picklist is reported, not sent
    const bogus = run(sampleRow(), {
      overrides: { createPolicy: "create", publishMethod: "bogus__v" },
    });
    expect(bogus.result.status).toBe("ok");
    expect(bogus.result.payload.publish_method__v).toBeUndefined();
    expect(bogus.result.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "unmapped_picklist",
        field: "publish_method__v",
        code: "VT_PICKLIST_VALUE_MISSING",
        value: "bogus__v",
      }),
    );
  });

  it("resolves content_type__v through the shared §6.3.42 crosswalk and counts misses", () => {
    const byName = run(sampleRow(), {
      overrides: {
        configMaps: { contentType: { [CONTENT_TYPE_ID]: "name:Email" } },
      },
    });
    expect(byName.result.payload["content_type__v.name__v"]).toBe("Email");
    const byVaultId = run(sampleRow(), {
      overrides: {
        configMaps: { contentType: { [CONTENT_TYPE_ID]: "V0CT00000000001" } },
      },
    });
    expect(byVaultId.result.payload.content_type__v).toBe("V0CT00000000001");
    const unmatched = run(sampleRow(), {
      overrides: { configMaps: { contentType: {} } },
    });
    expect(unmatched.result.status).toBe("ok");
    expect(unmatched.result.payload.content_type__v).toBeUndefined();
    expect(unmatched.result.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "unresolved_fk",
        field: "content_type__v",
        code: "VT_CONSENT_CONFIG_UNMATCHED",
        value: CONTENT_TYPE_ID,
      }),
    );
  });

  it("reports an unresolved FK made required by the overlay as pending_fk, omits it when optional", () => {
    const required = run(sampleRow(), {
      knownProducts: false,
      overrides: { required: { product__v: true } },
    });
    expect(required.result.status).toBe("pending_fk");
    expect(required.result.unresolvedRequiredFks).toContainEqual(
      expect.objectContaining({
        field: "product__v",
        objectKey: "product",
        sfdcId: PRODUCT_ID,
      }),
    );
    expect(required.result.payload.product__v).toEqual({
      $fk: { object: "product", sfdcId: PRODUCT_ID },
    });
    const optional = run(sampleRow(), { knownProducts: false });
    expect(optional.result.status).toBe("ok");
    expect(optional.result.payload.product__v).toBeUndefined();
    expect(optional.result.payload.detail_group__v).toBeUndefined();
    expect(optional.result.unresolvedOptionalFks.map((u) => u.field)).toEqual([
      "product__v",
      "detail_group__v",
    ]);
  });

  it("fails a row whose record type has no object type in the target", () => {
    const { result: r } = run(
      sampleRow({ "RecordType.DeveloperName": "Mystery_vod" }),
    );
    expect(r.status).toBe("failed");
    expect(r.failure?.code).toBe("VT_OBJECT_TYPE_MISSING");
  });

  it("is unscoped (full): the scope builder yields no predicate", () => {
    const { mapping } = run(sampleRow());
    expect(mapping.scope.spec).toEqual({ kind: "full" });
    expect(buildScopePredicate(mapping.scope)).toEqual({ kind: "full" });
  });
});

describe("approved_document helpers", () => {
  it("renameApprovedDocumentField applies the §6.0.2 field rule", () => {
    expect(renameApprovedDocumentField("Email_ReplyTo_Address_vod__c")).toBe(
      "email_replyto_address__v",
    );
    expect(renameApprovedDocumentField("Email_HTML_1_vod__c")).toBe(
      "email_html_1__v",
    );
  });

  it("publishMethod reads the flag, honours createPolicy and validates the value name", () => {
    const row: SourceRow = { Id: "a0R000000000001" };
    const base = {
      objectKey: "approved_document" as const,
      field: { source: "", target: "publish_method__v" },
      targetField: {
        type: "picklist" as const,
        rawType: "Picklist",
        picklistValues: ["vault_auto_published__v", "manual__v"],
      },
    };
    const unset = buildTransformContext({
      ...base,
      mapping: { options: { createPolicy: "create" } as never },
    });
    expect(publishMethod(undefined, row, unset)).toBeUndefined();
    const create = buildTransformContext({
      ...base,
      mapping: {
        options: { createPolicy: "create", publishMethod: " manual__v " },
      } as never,
    });
    expect(publishMethod(undefined, row, create)).toBe("manual__v");
    const matchOnly = buildTransformContext({
      ...base,
      mapping: {
        options: { createPolicy: "match-only", publishMethod: "manual__v" },
      } as never,
    });
    expect(publishMethod(undefined, row, matchOnly)).toBeUndefined();
    const bogus = buildTransformContext({
      ...base,
      mapping: {
        options: { createPolicy: "create", publishMethod: "nope__v" },
      } as never,
    });
    expect(publishMethod(undefined, row, bogus)).toMatchObject({
      omit: true,
      diagnostic: { code: "VT_PICKLIST_VALUE_MISSING", value: "nope__v" },
    });
  });

  it("contentType: explicit map forms, relationship fallbacks, bad ids, blanks", () => {
    const ctx = (maps?: Record<string, string>) =>
      buildTransformContext({
        objectKey: "approved_document",
        field: { source: "Content_Type_vod__c", target: "content_type__v" },
        mapping: {
          options: { configMaps: maps ? { contentType: maps } : undefined },
        } as never,
      });
    const row: SourceRow = { Id: "a0R000000000001" };
    expect(
      contentType(
        CONTENT_TYPE_ID,
        row,
        ctx({ [CONTENT_TYPE_ID]: "external_id:CT-1" }),
      ),
    ).toEqual({ value: "CT-1", targetField: "content_type__v.external_id__v" });
    // 15-char keys are accepted too
    expect(
      contentType(
        "a1C000000000001",
        row,
        ctx({ a1C000000000001: "name:Email" }),
      ),
    ).toEqual({ value: "Email", targetField: "content_type__v.name__v" });
    expect(
      contentType(CONTENT_TYPE_ID, row, ctx({ [CONTENT_TYPE_ID]: "V0CT1" })),
    ).toEqual({ value: "V0CT1" });
    // automatic fallbacks (2) and (3) of §6.3.42
    expect(
      contentType(
        CONTENT_TYPE_ID,
        { ...row, [CONTENT_TYPE_EXTERNAL_ID_PATH]: "CT-EXT" },
        ctx(),
      ),
    ).toEqual({
      value: "CT-EXT",
      targetField: "content_type__v.external_id__v",
    });
    expect(
      contentType(
        CONTENT_TYPE_ID,
        { ...row, [CONTENT_TYPE_NAME_PATH]: "Email" },
        ctx(),
      ),
    ).toEqual({ value: "Email", targetField: "content_type__v.name__v" });
    expect(contentType(CONTENT_TYPE_ID, row, ctx())).toMatchObject({
      omit: true,
      diagnostic: {
        kind: "unresolved_fk",
        code: "VT_CONSENT_CONFIG_UNMATCHED",
      },
    });
    expect(contentType("not-an-id", row, ctx())).toMatchObject({
      omit: true,
      diagnostic: { kind: "invalid_value", code: "INVALID_ID" },
    });
    expect(contentType("", row, ctx())).toBeUndefined();
  });
});
