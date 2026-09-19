import { describe, expect, it } from "vitest";
import {
  OUT_OF_SCOPE_REF_DROPPED_CODE,
  SENT_EMAIL_ACCOUNT_FIELD,
  SENT_EMAIL_CONTENT_BLOB,
  SENT_EMAIL_OBJECT_TYPES,
  SENT_EMAIL_OPEN_PREDICATE,
  SENT_EMAIL_PARENT_FIELD,
  SENT_EMAIL_RECEIPT_ENTITY_TYPE,
  SENT_EMAIL_SENT_DATE_FIELD,
  SENT_EMAIL_STATUS,
  SENT_EMAIL_USER_FIELD,
  outOfScopeRef,
  sent_email,
} from "./sent_email";
import { validateObjectModule } from "../types";
import { loadOrder } from "../registry";
import { materialise, resolveCountry } from "../../config/resolve";
import { parseConfig } from "../../config/schema";
import { applyMapping } from "../../transform/apply";
import { buildScopePredicate } from "../../extract/scope";
import {
  IDS,
  SAMPLE_USER_ID,
  SAMPLE_USER_ID_2,
  buildCountryContext,
  buildIdResolver,
  buildTransformContext,
  buildVaultMetadata,
  resolveMetadata,
} from "../../testkit";
import { to18 } from "../../transform/ids";
import type { SourceRow } from "../../types";

const NOW = new Date("2026-09-07T00:00:00Z");
const EMAIL_ID = to18("a0S000000000001");
const PARENT_EMAIL_ID = to18("a0S000000000002");
const TEMPLATE_ID = to18("a0B000000000001");
const PRODUCT_ID = to18("a0P000000000001");
const DETAIL_GROUP_ID = to18("a0P000000000002");
const KEY_MESSAGE_ID = to18("a0M000000000001");
const EVENT_ID = to18("a0E000000000001");
const ATTENDEE_ID = to18("a0F000000000001");
const SPEAKER_ID = to18("a0G000000000001");
const TEAM_MEMBER_ID = to18("a0H000000000001");
const EVENT_ATTENDEE_ID = to18("a0I000000000001");
const MEDICAL_EVENT_ID = to18("a0J000000000001");
const INQUIRY_ID = to18("a0Q000000000001");
const CASE_ID = to18("500000000000001");
const SUGGESTION_ID = to18("a0U000000000001");
const CONTENT_TYPE_ID = to18("a0V000000000001");

const OBJECT_REFS: Array<[string, string]> = [
  ["call2__v", "call2__v"],
  ["product__v", "product__v"],
  ["detail_group__v", "product__v"],
  ["key_message__v", "key_message__v"],
  ["parent_email__v", "sent_email__v"],
  ["event__v", "em_event__v"],
  ["em_attendee__v", "em_attendee__v"],
  ["em_event_speaker__v", "em_event_speaker__v"],
  ["em_event_team_member__v", "em_event_team_member__v"],
  ["event_attendee__v", "event_attendee__v"],
  ["medical_event__v", "medical_event__v"],
  ["medical_inquiry__v", "medical_inquiry__v"],
];

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
    objects: { sent_email: overrides },
    countries: { US: {} },
  });
}

function metadata() {
  return resolveMetadata(
    buildVaultMetadata(
      "sent_email__v",
      [
        {
          name: "account__v",
          type: "Object",
          object: { name: "account__v" },
          required: true,
        },
        { name: "user__v", type: "Object", object: { name: "user__sys" } },
        {
          name: "approved_email_template__v",
          type: "Object",
          object: { name: "approved_document__v" },
        },
        ...OBJECT_REFS.map(([name, object]) => ({
          name,
          type: "Object",
          object: { name: object },
        })),
        { name: "email_sent_date__v", type: "DateTime" },
        { name: "scheduled_send_datetime__v", type: "DateTime" },
        { name: "capture_datetime__v", type: "DateTime" },
        { name: "mc_capture_datetime__v", type: "DateTime" },
        { name: "last_activity_date__v", type: "DateTime" },
        {
          name: "sent_email_status__v",
          type: "Picklist",
          picklist: "sent_email_status__v",
          required: true,
        },
        { name: "account_email__v", type: "String", max_length: 80 },
        { name: "sender_email__v", type: "String", max_length: 80 },
        { name: "bcc__v", type: "String", max_length: 255 },
        { name: "email_fragments__v", type: "LongText" },
        { name: "email_config_values__v", type: "LongText" },
        { name: "user_input_text__v", type: "LongText" },
        { name: "failure_msg__v", type: "LongText" },
        { name: "territory__v", type: "String", max_length: 80 },
        { name: "valid_consent_exists__v", type: "Boolean" },
        {
          name: "receipt_entity_type__v",
          type: "Picklist",
          picklist: "receipt_entity_type__v",
        },
        { name: "receipt_record_id__v", type: "String", max_length: 18 },
        { name: "related_transaction_id__v", type: "String", max_length: 100 },
        {
          name: "activity_tracking_mode__v",
          type: "Picklist",
          picklist: "activity_tracking_mode__v",
        },
        { name: "email_content__v", type: "LongText", max_length: 32000 },
        { name: "email_content2__v", type: "LongText", max_length: 32000 },
        { name: "ownerid__v", type: "Object", object: { name: "user__sys" } },
        { name: "mobile_id__v", type: "String", max_length: 100 },
      ],
      { objectTypes: Object.values(SENT_EMAIL_OBJECT_TYPES) },
    ),
    {
      picklists: {
        sent_email_status__v: Object.values(SENT_EMAIL_STATUS),
        receipt_entity_type__v: Object.values(SENT_EMAIL_RECEIPT_ENTITY_TYPE),
        activity_tracking_mode__v: ["tracked__v", "not_tracked__v"],
        status__v: ["active__v", "inactive__v"],
      },
    },
  );
}

function sampleRow(extra: Partial<SourceRow> = {}): SourceRow {
  return {
    Id: EMAIL_ID,
    IsDeleted: false,
    Name: "Cholecap launch mail",
    "RecordType.DeveloperName": "Call_vod",
    [SENT_EMAIL_ACCOUNT_FIELD]: IDS.account1,
    [SENT_EMAIL_USER_FIELD]: SAMPLE_USER_ID_2,
    Approved_Email_Template_vod__c: TEMPLATE_ID,
    Call2_vod__c: IDS.call1,
    Product_vod__c: PRODUCT_ID,
    Detail_Group_vod__c: DETAIL_GROUP_ID,
    Key_Message_vod__c: KEY_MESSAGE_ID,
    Content_Type_vod__c: CONTENT_TYPE_ID,
    [SENT_EMAIL_PARENT_FIELD]: PARENT_EMAIL_ID,
    Event_vod__c: EVENT_ID,
    EM_Attendee_vod__c: ATTENDEE_ID,
    EM_Event_Speaker_vod__c: SPEAKER_ID,
    EM_Event_Team_Member_vod__c: TEAM_MEMBER_ID,
    Event_Attendee_vod__c: EVENT_ATTENDEE_ID,
    Medical_Event_vod__c: MEDICAL_EVENT_ID,
    Medical_Inquiry_vod__c: INQUIRY_ID,
    Case_vod__c: CASE_ID,
    Suggestion_vod__c: SUGGESTION_ID,
    [SENT_EMAIL_SENT_DATE_FIELD]: "2025-03-04T10:30:00.000Z",
    Scheduled_Send_Datetime_vod__c: "2025-03-04T10:00:00.000Z",
    Capture_Datetime_vod__c: "2025-03-04T09:58:00.000Z",
    MC_Capture_Datetime_vod__c: "2025-03-04T09:59:00.000Z",
    Last_Activity_Date_vod__c: "2025-03-05T08:00:00.000Z",
    Status_vod__c: "Delivered_vod",
    Account_Email_vod__c: "dr.doe@example.org",
    Sender_Email_vod__c: "rep@example.com",
    Bcc_vod__c: "crm@example.com",
    Email_Fragments_vod__c: "frag-1;frag-2",
    Email_Config_Values_vod__c: '{"k":"v"}',
    User_Input_Text_vod__c: "Hello Dr Doe",
    Failure_Msg_vod__c: "",
    Territory_vod__c: "Boston North",
    Valid_Consent_Exists_vod__c: "true",
    Receipt_Entity_Type_vod__c: "Call_vod",
    Receipt_Record_Id_vod__c: IDS.call1,
    Related_Transaction_ID_vod__c: "TX-0001",
    Activity_Tracking_Mode_vod__c: "Tracked_vod",
    Email_Content_vod__c: "<html><body>Hello</body></html>",
    Email_Content2_vod__c: "<!-- overflow -->",
    Open_Count_vod__c: "3",
    Click_Count_vod__c: "1",
    Last_Open_Date_vod__c: "2025-03-05T08:00:00.000Z",
    Last_Click_Date_vod__c: "2025-03-05T08:01:00.000Z",
    Opened_vod__c: "true",
    Clicked_vod__c: "true",
    Approved_Document_Views_vod__c: "1",
    Product_Display_vod__c: "Cholecap",
    Events_Management_Subtype_vod__c: "",
    Mobile_ID_vod__c: "7d2c5f4e-email-0001",
    OwnerId: SAMPLE_USER_ID,
    CreatedById: SAMPLE_USER_ID,
    LastModifiedById: SAMPLE_USER_ID,
    CreatedDate: "2025-03-04T09:58:00.000Z",
    LastModifiedDate: "2025-03-05T08:01:00.000Z",
    SystemModstamp: "2025-03-05T08:01:00.000Z",
    ...extra,
  };
}

function run(
  row: SourceRow,
  opts: {
    overrides?: Record<string, unknown>;
    accounts?: Record<string, string>;
    emails?: Record<string, string>;
  } = {},
) {
  const config = makeConfig(opts.overrides);
  const mapping = materialise(
    sent_email,
    resolveCountry(config, "US"),
    config,
    { now: NOW },
  );
  const ids = buildIdResolver(
    {
      account: opts.accounts ?? { [IDS.account1]: "V0A1" },
      approved_document: { [TEMPLATE_ID]: "V0B1" },
      call2: { [IDS.call1]: "V0K1" },
      product: { [PRODUCT_ID]: "V0P1", [DETAIL_GROUP_ID]: "V0P2" },
      key_message: { [KEY_MESSAGE_ID]: "V0M1" },
      sent_email: opts.emails ?? { [PARENT_EMAIL_ID]: "V0S2" },
      em_event: { [EVENT_ID]: "V0E1" },
      em_attendee: { [ATTENDEE_ID]: "V0F1" },
      em_event_speaker: { [SPEAKER_ID]: "V0G1" },
      em_event_team_member: { [TEAM_MEMBER_ID]: "V0H1" },
      event_attendee: { [EVENT_ATTENDEE_ID]: "V0I1" },
      medical_event: { [MEDICAL_EVENT_ID]: "V0J1" },
      medical_inquiry: { [INQUIRY_ID]: "V0Q1" },
    },
    { [SAMPLE_USER_ID]: 101, [SAMPLE_USER_ID_2]: 102 },
  );
  return {
    mapping,
    result: applyMapping(row, mapping, {
      country: buildCountryContext(),
      metadata: metadata(),
      ids,
      migrationUserId: 1,
      runMode: "init",
      custom: sent_email.custom,
    }),
  };
}

describe("sent_email module", () => {
  it("is structurally valid", () => {
    expect(
      validateObjectModule(sent_email).filter((i) => i.severity === "blocking"),
    ).toEqual([]);
  });

  it("encodes the §6.2 / §6.3.40 / §3.3 / §4.4 catalogue facts and the self-reference", () => {
    expect(sent_email.source).toBe("Sent_Email_vod__c");
    expect(sent_email.target).toBe("sent_email__v");
    expect(sent_email.targetEvidence).toBe("DOC");
    expect(sent_email.scope).toEqual({
      kind: "dated",
      predicates: [{ field: "Email_Sent_Date_vod__c", type: "datetime" }],
      openPredicate: SENT_EMAIL_OPEN_PREDICATE,
    });
    expect(SENT_EMAIL_OPEN_PREDICATE).toContain(
      "Status_vod__c IN ('Scheduled_vod', 'Saved_vod', 'Pending_vod')",
    );
    expect(SENT_EMAIL_OPEN_PREDICATE).toContain(
      "Email_Sent_Date_vod__c = null AND CreatedDate >= {cutoffDateTime}",
    );
    expect(sent_email.countryOf).toEqual([
      { kind: "account" },
      { kind: "user", field: "User_vod__c" },
      { kind: "user", field: "OwnerId" },
    ]);
    expect(sent_email.dependsOn).toEqual([
      "account",
      "user",
      "approved_document",
      "call2",
      "product",
      "key_message",
      "em_event",
      "em_attendee",
      "em_event_speaker",
      "em_event_team_member",
      "event_attendee",
      "medical_event",
      "medical_inquiry",
    ]);
    expect(sent_email.selfRefs).toEqual([
      { target: "parent_email__v", source: "Parent_Email_vod__c" },
    ]);
    expect(Object.keys(sent_email.objectTypes)).toHaveLength(12);
    expect(sent_email.objectTypes).toMatchObject({
      Account_vod: "account__v",
      CLM_vod: "clm__v",
      Call_vod: "call__v",
      Case_vod: "case__v",
      CoBrowse_Invite_vod: "cobrowse_invite__v",
      Double_Opt_In_vod: "double_opt_in__v",
      Email_Receipt_vod: "email_receipt__v",
      Events_Management_vod: "events_management__v",
      Medical_Event_vod: "medical_event__v",
      Medical_Inquiry_vod: "medical_inquiry__v",
      Remote_Meeting_vod: "remote_meeting__v",
      Suggestion_vod: "suggestion__v",
    });
    expect(sent_email.states).toEqual({});
    expect(sent_email.deletePolicy).toBe("ignore");
    expect(sent_email.inactivate).toEqual([]);
    expect(sent_email.createPolicy).toBe("create");
    expect(sent_email.load.noTriggers).toBe(true);
    expect(sent_email.match.map((m) => m.method)).toEqual([
      "legacy_id",
      "mobile_id",
    ]);
    expect(sent_email.blobs).toEqual({ [SENT_EMAIL_CONTENT_BLOB]: "optional" });
    expect(sent_email.optionDefaults).toEqual({ contentOverflow: "truncate" });
    expect(sent_email.blockS.statusFromFlag).toBeUndefined();
    expect(sent_email.notes).not.toContain("STUB");
    // the self-reference is patched in pass 2 (§6.1 step 20)
    const steps = loadOrder([
      { key: "account", dependsOn: [], selfRefs: [] },
      { key: "user", dependsOn: [], selfRefs: [] },
      { key: "call2", dependsOn: ["account", "user"], selfRefs: [] },
      sent_email,
    ]);
    const level = (k: string) =>
      steps.findIndex((s) => s.keys.includes(k as never));
    expect(level("sent_email")).toBeGreaterThan(level("call2"));
    expect(steps[level("sent_email")].pass2).toContainEqual({
      objectKey: "sent_email",
      target: "parent_email__v",
      source: "Parent_Email_vod__c",
      refKey: "sent_email",
    });
  });

  it("carries every §6.3.40 row with its transform, evidence and skips", () => {
    const byTarget = new Map(sent_email.fields.map((f) => [f.target, f]));
    for (const target of [
      "legacy_crm_id__v",
      "name__v",
      "account__v",
      "user__v",
      "approved_email_template__v",
      ...OBJECT_REFS.map(([name]) => name),
      "content_type__v",
      "case__v",
      "suggestion__v",
      "email_sent_date__v",
      "scheduled_send_datetime__v",
      "capture_datetime__v",
      "mc_capture_datetime__v",
      "last_activity_date__v",
      "sent_email_status__v",
      "account_email__v",
      "sender_email__v",
      "bcc__v",
      "email_fragments__v",
      "email_config_values__v",
      "user_input_text__v",
      "failure_msg__v",
      "territory__v",
      "valid_consent_exists__v",
      "receipt_entity_type__v",
      "receipt_record_id__v",
      "related_transaction_id__v",
      "activity_tracking_mode__v",
      "email_content__v",
      "email_content2__v",
      "ownerid__v",
      "object_type__v.api_name__v",
      "mobile_id__v",
      "open_count__v",
      "click_count__v",
      "last_open_date__v",
      "last_click_date__v",
      "opened__v",
      "clicked__v",
      "approved_document_views__v",
      "product_display__v",
      "events_management_subtype__v",
    ])
      expect(byTarget.has(target), target).toBe(true);
    expect(byTarget.get("account__v")).toMatchObject({
      transform: { kind: "ref", objectKey: "account" },
      required: "Y",
      evidence: "UNV",
    });
    expect(byTarget.get("user__v")).toMatchObject({
      transform: { kind: "refUser" },
      required: "y?",
    });
    expect(byTarget.get("approved_email_template__v")).toMatchObject({
      transform: { kind: "ref", objectKey: "approved_document" },
      required: "y?",
    });
    expect(byTarget.get("detail_group__v")?.transform).toEqual({
      kind: "ref",
      objectKey: "product",
    });
    expect(byTarget.get("parent_email__v")).toMatchObject({
      transform: {
        kind: "secondPass",
        inner: { kind: "ref", objectKey: "sent_email" },
      },
      required: "n",
    });
    expect(byTarget.get("event__v")?.transform).toEqual({
      kind: "ref",
      objectKey: "em_event",
    });
    for (const target of ["content_type__v", "case__v", "suggestion__v"])
      expect(byTarget.get(target), target).toMatchObject({
        transform: { kind: "custom", fnName: "outOfScopeRef" },
        required: "-",
      });
    expect(byTarget.get("email_sent_date__v")).toMatchObject({
      transform: { kind: "datetime" },
      required: "y?",
    });
    expect(byTarget.get("sent_email_status__v")).toMatchObject({
      transform: { kind: "picklist", mapKey: "sent_email.status" },
      required: "Y",
    });
    expect(byTarget.get("email_config_values__v")).toMatchObject({
      transform: { kind: "longtext" },
      evidence: "DOC",
    });
    expect(byTarget.get("user_input_text__v")?.evidence).toBe("DOC");
    expect(byTarget.get("activity_tracking_mode__v")).toMatchObject({
      transform: {
        kind: "picklist",
        mapKey: "sent_email.activityTrackingMode",
      },
      evidence: "DOC",
    });
    expect(byTarget.get("valid_consent_exists__v")?.transform).toEqual({
      kind: "bool",
    });
    expect(byTarget.get("receipt_entity_type__v")?.transform).toEqual({
      kind: "picklist",
      mapKey: "sent_email.receiptEntityType",
    });
    expect(byTarget.get("receipt_record_id__v")?.transform).toEqual({
      kind: "text",
    });
    for (const target of ["email_content__v", "email_content2__v"])
      expect(byTarget.get(target), target).toMatchObject({
        transform: { kind: "deferredBlob", blobName: SENT_EMAIL_CONTENT_BLOB },
        blobName: SENT_EMAIL_CONTENT_BLOB,
      });
    expect(byTarget.get("object_type__v.api_name__v")).toMatchObject({
      transform: { kind: "objectType", mapKey: "sent_email.objectType" },
    });
    for (const target of [
      "open_count__v",
      "click_count__v",
      "last_open_date__v",
      "last_click_date__v",
      "opened__v",
      "clicked__v",
      "approved_document_views__v",
      "product_display__v",
      "events_management_subtype__v",
    ])
      expect(byTarget.get(target), target).toMatchObject({
        transform: { kind: "skip" },
        required: "-",
      });
    expect(sent_email.picklists["sent_email.status"]).toEqual(
      SENT_EMAIL_STATUS,
    );
    expect(Object.keys(SENT_EMAIL_STATUS)).toHaveLength(12);
    expect(sent_email.picklists["sent_email.receiptEntityType"]).toEqual({
      Call_vod: "call__v",
      Medical_Inquiry_vod: "medical_inquiry__v",
      Order_vod: "order__v",
    });
    for (const f of sent_email.fields)
      if (f.transform.kind !== "skip")
        expect(f.evidence, `${f.target} has an evidence tag`).toBeDefined();
  });

  it("transforms a realistic row: FKs deferred, parent email in pass 2, object type, status, dates, bodies as blobs, out-of-v1 refs counted", () => {
    const { result } = run(sampleRow());
    expect(result.failure).toBeUndefined();
    expect(result.status).toBe("ok");
    expect(result.payload).toMatchObject({
      legacy_crm_id__v: EMAIL_ID,
      name__v: "Cholecap launch mail",
      "object_type__v.api_name__v": "call__v",
      account__v: { $fk: { object: "account", sfdcId: IDS.account1 } },
      user__v: { $user: SAMPLE_USER_ID_2 },
      approved_email_template__v: {
        $fk: { object: "approved_document", sfdcId: TEMPLATE_ID },
      },
      call2__v: { $fk: { object: "call2", sfdcId: IDS.call1 } },
      product__v: { $fk: { object: "product", sfdcId: PRODUCT_ID } },
      detail_group__v: { $fk: { object: "product", sfdcId: DETAIL_GROUP_ID } },
      key_message__v: {
        $fk: { object: "key_message", sfdcId: KEY_MESSAGE_ID },
      },
      event__v: { $fk: { object: "em_event", sfdcId: EVENT_ID } },
      em_attendee__v: { $fk: { object: "em_attendee", sfdcId: ATTENDEE_ID } },
      em_event_speaker__v: {
        $fk: { object: "em_event_speaker", sfdcId: SPEAKER_ID },
      },
      em_event_team_member__v: {
        $fk: { object: "em_event_team_member", sfdcId: TEAM_MEMBER_ID },
      },
      event_attendee__v: {
        $fk: { object: "event_attendee", sfdcId: EVENT_ATTENDEE_ID },
      },
      medical_event__v: {
        $fk: { object: "medical_event", sfdcId: MEDICAL_EVENT_ID },
      },
      medical_inquiry__v: {
        $fk: { object: "medical_inquiry", sfdcId: INQUIRY_ID },
      },
      email_sent_date__v: "2025-03-04T10:30:00.000Z",
      scheduled_send_datetime__v: "2025-03-04T10:00:00.000Z",
      capture_datetime__v: "2025-03-04T09:58:00.000Z",
      mc_capture_datetime__v: "2025-03-04T09:59:00.000Z",
      last_activity_date__v: "2025-03-05T08:00:00.000Z",
      sent_email_status__v: "delivered__v",
      account_email__v: "dr.doe@example.org",
      sender_email__v: "rep@example.com",
      bcc__v: "crm@example.com",
      email_fragments__v: "frag-1;frag-2",
      email_config_values__v: '{"k":"v"}',
      user_input_text__v: "Hello Dr Doe",
      territory__v: "Boston North",
      valid_consent_exists__v: true,
      receipt_entity_type__v: "call__v",
      receipt_record_id__v: IDS.call1,
      related_transaction_id__v: "TX-0001",
      activity_tracking_mode__v: "tracked__v",
      mobile_id__v: "7d2c5f4e-email-0001",
      ownerid__v: { $user: SAMPLE_USER_ID },
      created_date__v: "2025-03-04T09:58:00.000Z",
      created_by__v: { $user: SAMPLE_USER_ID },
      modified_by__v: { $user: SAMPLE_USER_ID },
    });
    expect(result.objectType).toBe("call__v");
    // pass 1 never carries the self reference
    expect(result.payload.parent_email__v).toBeUndefined();
    expect(result.secondPass).toEqual({
      parent_email__v: {
        $fk: { object: "sent_email", sfdcId: PARENT_EMAIL_ID },
      },
    });
    // bodies wait for the blob pass
    expect(result.blobs).toEqual({
      email_content__v: "<html><body>Hello</body></html>",
      email_content2__v: "<!-- overflow -->",
    });
    expect(result.payload.email_content__v).toBeUndefined();
    // out-of-v1 lookups omitted and counted
    for (const target of ["case__v", "suggestion__v", "content_type__v"])
      expect(result.payload[target], target).toBeUndefined();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "out_of_scope_ref_dropped",
        field: "case__v",
        code: OUT_OF_SCOPE_REF_DROPPED_CODE,
        value: CASE_ID,
      }),
    );
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ field: "suggestion__v", value: SUGGESTION_ID }),
    );
    // empty text, skips and platform status never land in the payload
    for (const target of [
      "failure_msg__v",
      "open_count__v",
      "click_count__v",
      "opened__v",
      "clicked__v",
      "product_display__v",
      "status__v",
    ])
      expect(result.payload[target], target).toBeUndefined();
    expect(result.unresolvedRequiredFks).toEqual([]);
    expect(result.fkEdges).toContainEqual({
      field: "parent_email__v",
      targetObjectKey: "sent_email",
      targetSfdcId: PARENT_EMAIL_ID,
    });
  });

  it("reports an unresolved required account as pending_fk and keeps an unresolved parent email as an optional pass-2 edge", () => {
    const { result } = run(
      sampleRow({ [SENT_EMAIL_ACCOUNT_FIELD]: IDS.account4 }),
    );
    expect(result.status).toBe("pending_fk");
    expect(result.payload.account__v).toEqual({
      $fk: { object: "account", sfdcId: IDS.account4 },
    });
    expect(result.unresolvedRequiredFks).toEqual([
      { field: "account__v", objectKey: "account", sfdcId: IDS.account4 },
    ]);
    const { result: noParent } = run(sampleRow(), { emails: {} });
    expect(noParent.status).toBe("ok");
    expect(noParent.unresolvedOptionalFks).toContainEqual({
      field: "parent_email__v",
      objectKey: "sent_email",
      sfdcId: PARENT_EMAIL_ID,
      secondPass: true,
    });
    // an unmapped status is fatal under the default onUnmapped = error policy
    const { result: unknownStatus } = run(
      sampleRow({ Status_vod__c: "Archived" }),
    );
    expect(unknownStatus.status).toBe("failed");
  });

  it("is dated on Email_Sent_Date_vod__c with the open-item term rendered against the cutoff", () => {
    const { mapping } = run(sampleRow());
    expect(mapping.scope.historyMonths).toBe(24);
    expect(mapping.scope.cutoffDate).toBe("2024-09-07");
    const build = buildScopePredicate(mapping.scope, { now: NOW });
    expect(build.kind).toBe("dated");
    expect(build.dateTerm).toBe(
      "Email_Sent_Date_vod__c >= 2024-09-07T00:00:00Z",
    );
    expect(build.openTerm).toBe(
      "Status_vod__c IN ('Scheduled_vod', 'Saved_vod', 'Pending_vod') OR (Email_Sent_Date_vod__c = null AND CreatedDate >= 2024-09-07T00:00:00Z)",
    );
    expect(build.predicate).toBe(
      `(Email_Sent_Date_vod__c >= 2024-09-07T00:00:00Z) OR (${build.openTerm})`,
    );
    expect(mapping.countryOf).toEqual(sent_email.countryOf);
    expect(mapping.objectTypes).toEqual(SENT_EMAIL_OBJECT_TYPES);
    expect(mapping.selfRefs).toEqual(sent_email.selfRefs);
    expect(mapping.options.blobs).toEqual({
      [SENT_EMAIL_CONTENT_BLOB]: "optional",
    });
    expect(mapping.options.contentOverflow).toBe("truncate");
    // the overlay flips the overflow policy and the blob policy
    const { mapping: overlaid } = run(sampleRow(), {
      overrides: {
        contentOverflow: "attachment",
        blobs: { [SENT_EMAIL_CONTENT_BLOB]: "attachment" },
      },
    });
    expect(overlaid.options.contentOverflow).toBe("attachment");
    expect(overlaid.options.blobs[SENT_EMAIL_CONTENT_BLOB]).toBe("attachment");
  });
});

describe("sent_email custom transforms", () => {
  it("outOfScopeRef omits the value and counts it", () => {
    const ctx = buildTransformContext({
      objectKey: "sent_email",
      field: { source: "Case_vod__c", target: "case__v" },
    });
    expect(outOfScopeRef(CASE_ID, { Id: EMAIL_ID }, ctx)).toEqual({
      omit: true,
      diagnostic: {
        kind: "out_of_scope_ref_dropped",
        field: "case__v",
        code: OUT_OF_SCOPE_REF_DROPPED_CODE,
        value: CASE_ID,
        detail: "Case_vod__c references an object outside v1 (§6.2.1)",
      },
    });
    expect(outOfScopeRef("", { Id: EMAIL_ID }, ctx)).toBeUndefined();
    expect(outOfScopeRef(undefined, { Id: EMAIL_ID }, ctx)).toBeUndefined();
  });
});
