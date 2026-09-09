/**
 * `sent_email` — `Sent_Email_vod__c` → `sent_email__v` `[DOC]` (spec §6.3.40,
 * §6.1 step 20, §6.2, §3.3, §3.5, §4.4, §8.6).
 *
 * Dated on `Email_Sent_Date_vod__c` (2y) **or open**: status in
 * {Scheduled_vod, Saved_vod, Pending_vod}, or never sent
 * (`Email_Sent_Date_vod__c = null`) and created after the cutoff — the open
 * term carries the `{cutoffDateTime}` token rendered by the scope builder.
 * Country of the account, falling back to the rep (`User_vod__c`) and the
 * owner; `noTriggers = true`; deleted emails are ignored on the target (§4.4).
 *
 * **Self-reference** `Parent_Email_vod__c → parent_email__v` is patched in
 * pass 2 (`secondPass` + `selfRefs`, §6.1 step 20).
 *
 * Twelve object types (`Account_vod → account__v`, …, all `[UNV]`); business
 * status `Status_vod__c` → `sent_email_status__v` (`scheduled__v`, …). The
 * object is not listed as lifecycled in §6.2/§6.3.40, so no `state__v` row.
 *
 * Email bodies (`Email_Content_vod__c`, `Email_Content2_vod__c`, 131 072
 * chars each) go through the blob pass (§8.6) under the shared policy key
 * `emailContent` (`objects.sent_email.blobs.emailContent`); an oversized
 * value follows `objects.sent_email.contentOverflow` (`truncate` default).
 *
 * `Case_vod__c` and `Suggestion_vod__c` reference objects outside v1 and are
 * omitted + counted (`OUT_OF_SCOPE_REF_DROPPED`, §6.2.1); `Content_Type_vod__c`
 * is configuration (matched, never loaded, §6.1) and omitted in v1 the same
 * way.
 */
import { isSfdcId, to18 } from "../../transform/ids";
import type { CustomTransformFn, TransformResult } from "../../types";
import { defineObject, type ObjectModuleInput } from "../types";

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

export const SENT_EMAIL_ACCOUNT_FIELD = "Account_vod__c";
export const SENT_EMAIL_USER_FIELD = "User_vod__c";
export const SENT_EMAIL_PARENT_FIELD = "Parent_Email_vod__c";
export const SENT_EMAIL_SENT_DATE_FIELD = "Email_Sent_Date_vod__c";

/**
 * Open-item term (§6.2): scheduled/saved/pending emails, plus emails never
 * sent but created inside the window (`{cutoffDateTime}` is substituted by
 * the scope builder, `extract/scope.ts`).
 */
export const SENT_EMAIL_OPEN_PREDICATE =
  "Status_vod__c IN ('Scheduled_vod', 'Saved_vod', 'Pending_vod') OR (Email_Sent_Date_vod__c = null AND CreatedDate >= {cutoffDateTime})";

/** `RecordType.DeveloperName` → object type (12 types, `[UNV]`). */
export const SENT_EMAIL_OBJECT_TYPES: Record<string, string> = {
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
};

/** `Status_vod__c` → `sent_email_status__v` (`[UNV]` values by the rename rule). */
export const SENT_EMAIL_STATUS: Record<string, string> = {
  Scheduled_vod: "scheduled__v",
  Group_vod: "group__v",
  Saved_vod: "saved__v",
  Pending_vod: "pending__v",
  Sent_vod: "sent__v",
  Delivered_vod: "delivered__v",
  Bounced_vod: "bounced__v",
  Unsubscribed_vod: "unsubscribed__v",
  Failed_vod: "failed__v",
  Marked_Spam_vod: "marked_spam__v",
  Dropped_vod: "dropped__v",
  Approved_vod: "approved__v",
};

/** `Receipt_Entity_Type_vod__c` → `receipt_entity_type__v` (`[UNV]`). */
export const SENT_EMAIL_RECEIPT_ENTITY_TYPE: Record<string, string> = {
  Call_vod: "call__v",
  Medical_Inquiry_vod: "medical_inquiry__v",
  Order_vod: "order__v",
};

/** Blob policy key shared by both body columns (`objects.sent_email.blobs.emailContent`). */
export const SENT_EMAIL_CONTENT_BLOB = "emailContent";

export const OUT_OF_SCOPE_REF_DROPPED_CODE = "OUT_OF_SCOPE_REF_DROPPED";

// ---------------------------------------------------------------------------
// custom transforms (pure)
// ---------------------------------------------------------------------------

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

/**
 * `custom(outOfScopeRef)`: reference into an object outside v1 (§6.2.1
 * "omit+count"): the field is left unset and every populated value is counted
 * through a non-fatal `out_of_scope_ref_dropped` diagnostic.
 */
export const outOfScopeRef: CustomTransformFn = (
  value,
  _row,
  ctx,
): TransformResult | undefined => {
  if (isEmpty(value)) return undefined;
  const raw = String(value).trim();
  return {
    omit: true,
    diagnostic: {
      kind: "out_of_scope_ref_dropped",
      field: ctx.field.target,
      code: OUT_OF_SCOPE_REF_DROPPED_CODE,
      value: isSfdcId(raw) ? to18(raw) : raw,
      detail: `${ctx.field.source} references an object outside v1 (§6.2.1)`,
    },
  };
};

// ---------------------------------------------------------------------------
// module
// ---------------------------------------------------------------------------

type RowInput = NonNullable<ObjectModuleInput["fields"]>[number];

const unv = (
  source: string,
  target: string,
  transform: string,
  extra: Partial<RowInput> = {},
): RowInput => ({
  source,
  target,
  transform,
  required: "n",
  evidence: "UNV",
  ...extra,
});

const ref = (
  source: string,
  target: string,
  objectKey: string,
  extra: Partial<RowInput> = {},
): RowInput =>
  unv(source, target, `ref(${objectKey})`, {
    sourceType: "reference",
    ...extra,
  });

export const sent_email = defineObject({
  key: "sent_email",
  source: "Sent_Email_vod__c",
  target: "sent_email__v",
  targetEvidence: "DOC",
  scope: {
    kind: "dated",
    predicates: [{ field: SENT_EMAIL_SENT_DATE_FIELD, type: "datetime" }],
    openPredicate: SENT_EMAIL_OPEN_PREDICATE,
  },
  countryOf: ["account", `user:${SENT_EMAIL_USER_FIELD}`, "user:OwnerId"],
  dependsOn: [
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
  ],
  selfRefs: [{ target: "parent_email__v", source: SENT_EMAIL_PARENT_FIELD }],
  objectTypes: { ...SENT_EMAIL_OBJECT_TYPES },
  fields: [
    // --- account / user / template (§6.3.40 rows 1–3)
    {
      source: SENT_EMAIL_ACCOUNT_FIELD,
      target: "account__v",
      transform: "ref(account)",
      required: "Y",
      evidence: "UNV",
      sourceType: "reference",
      notes: "country-of lookup (first in the fallback chain)",
    },
    {
      source: SENT_EMAIL_USER_FIELD,
      target: "user__v",
      transform: "refUser",
      required: "y?",
      evidence: "UNV",
      sourceType: "reference",
      notes:
        "sending rep; business user lookup — objects.sent_email.unmappedUserPolicy (§3.5); country-of fallback",
    },
    ref(
      "Approved_Email_Template_vod__c",
      "approved_email_template__v",
      "approved_document",
      { required: "y?" },
    ),
    // --- call / content references (row 4)
    ref("Call2_vod__c", "call2__v", "call2"),
    ref("Product_vod__c", "product__v", "product"),
    ref("Detail_Group_vod__c", "detail_group__v", "product"),
    ref("Key_Message_vod__c", "key_message__v", "key_message"),
    unv("Content_Type_vod__c", "content_type__v", "custom(outOfScopeRef)", {
      required: "-",
      sourceType: "reference",
      optionalSource: true,
      notes:
        "content_type__v is configuration (matched, never loaded, §6.1) — omitted in v1 and counted",
    }),
    // --- self reference (row 5)
    {
      source: SENT_EMAIL_PARENT_FIELD,
      target: "parent_email__v",
      transform: "ref(sent_email) secondPass",
      required: "n",
      evidence: "UNV",
      sourceType: "reference",
      notes:
        "self-reference — omitted in pass 1, patched in pass 2 (§6.1 step 20)",
    },
    // --- event / medical references (row 6)
    ref("Event_vod__c", "event__v", "em_event"),
    ref("EM_Attendee_vod__c", "em_attendee__v", "em_attendee"),
    ref("EM_Event_Speaker_vod__c", "em_event_speaker__v", "em_event_speaker"),
    ref(
      "EM_Event_Team_Member_vod__c",
      "em_event_team_member__v",
      "em_event_team_member",
    ),
    ref("Event_Attendee_vod__c", "event_attendee__v", "event_attendee"),
    ref("Medical_Event_vod__c", "medical_event__v", "medical_event"),
    ref("Medical_Inquiry_vod__c", "medical_inquiry__v", "medical_inquiry"),
    // --- out of v1 (row 7): omitted + counted
    unv("Case_vod__c", "case__v", "custom(outOfScopeRef)", {
      required: "-",
      sourceType: "reference",
      optionalSource: true,
      notes:
        "ref → Case is out of v1: omitted and counted (OUT_OF_SCOPE_REF_DROPPED, §6.2.1)",
    }),
    unv("Suggestion_vod__c", "suggestion__v", "custom(outOfScopeRef)", {
      required: "-",
      sourceType: "reference",
      optionalSource: true,
      notes:
        "ref → Suggestion_vod__c is out of v1: omitted and counted (OUT_OF_SCOPE_REF_DROPPED, §6.2.1)",
    }),
    // --- dates (row 8)
    {
      source: SENT_EMAIL_SENT_DATE_FIELD,
      target: "email_sent_date__v",
      transform: "datetime",
      required: "y?",
      evidence: "UNV",
      sourceType: "datetime",
      notes: "scope date (§6.2); null for scheduled/saved/pending emails",
    },
    unv(
      "Scheduled_Send_Datetime_vod__c",
      "scheduled_send_datetime__v",
      "datetime",
      { sourceType: "datetime" },
    ),
    unv("Capture_Datetime_vod__c", "capture_datetime__v", "datetime", {
      sourceType: "datetime",
    }),
    unv("MC_Capture_Datetime_vod__c", "mc_capture_datetime__v", "datetime", {
      sourceType: "datetime",
    }),
    unv("Last_Activity_Date_vod__c", "last_activity_date__v", "datetime", {
      notes:
        "datetime in Veeva CRM despite the name; overlay may switch to date",
    }),
    // --- status (row 9)
    {
      source: "Status_vod__c",
      target: "sent_email_status__v",
      transform: "picklist(sent_email.status)",
      required: "Y",
      evidence: "UNV",
      sourceType: "picklist",
      notes:
        "{Scheduled_vod, Group_vod, Saved_vod, Pending_vod, Sent_vod, Delivered_vod, Bounced_vod, Unsubscribed_vod, Failed_vod, Marked_Spam_vod, Dropped_vod, Approved_vod}; preflight may pick status__v when the object has no sent_email_status__v",
    },
    // --- text / flags (row 10)
    unv("Account_Email_vod__c", "account_email__v", "text", {
      sourceType: "email",
    }),
    unv("Sender_Email_vod__c", "sender_email__v", "text", {
      sourceType: "email",
    }),
    unv("Bcc_vod__c", "bcc__v", "text"),
    unv("Email_Fragments_vod__c", "email_fragments__v", "longtext", {
      sourceType: "textarea",
    }),
    {
      source: "Email_Config_Values_vod__c",
      target: "email_config_values__v",
      transform: "longtext",
      required: "n",
      evidence: "DOC",
      sourceType: "textarea",
    },
    {
      source: "User_Input_Text_vod__c",
      target: "user_input_text__v",
      transform: "longtext",
      required: "n",
      evidence: "DOC",
      sourceType: "textarea",
    },
    unv("Failure_Msg_vod__c", "failure_msg__v", "longtext"),
    unv("Territory_vod__c", "territory__v", "text", {
      sourceType: "string",
      notes: "territory name snapshot (text, not a reference)",
    }),
    unv("Valid_Consent_Exists_vod__c", "valid_consent_exists__v", "bool", {
      sourceType: "boolean",
    }),
    unv(
      "Receipt_Entity_Type_vod__c",
      "receipt_entity_type__v",
      "picklist(sent_email.receiptEntityType)",
      {
        sourceType: "picklist",
        notes: "{Call_vod, Medical_Inquiry_vod, Order_vod}",
      },
    ),
    unv("Receipt_Record_Id_vod__c", "receipt_record_id__v", "text", {
      notes: "stays a legacy SFDC id (text) — never re-pointed",
    }),
    unv("Related_Transaction_ID_vod__c", "related_transaction_id__v", "text"),
    {
      source: "Activity_Tracking_Mode_vod__c",
      target: "activity_tracking_mode__v",
      transform: "picklist(sent_email.activityTrackingMode)",
      required: "n",
      evidence: "DOC",
      sourceType: "picklist",
      notes: "values by the rename rule (overlay-able)",
    },
    // --- email bodies (row 11): blob pass, contentOverflow policy
    {
      source: "Email_Content_vod__c",
      target: "email_content__v",
      transform: `deferredBlob(${SENT_EMAIL_CONTENT_BLOB})`,
      required: "n",
      evidence: "UNV",
      blobName: SENT_EMAIL_CONTENT_BLOB,
      sourceType: "textarea",
      notes:
        "131072 chars → LongText ≤ 32k: objects.sent_email.contentOverflow = truncate | fail | attachment (§8.6)",
    },
    {
      source: "Email_Content2_vod__c",
      target: "email_content2__v",
      transform: `deferredBlob(${SENT_EMAIL_CONTENT_BLOB})`,
      required: "n",
      evidence: "UNV",
      blobName: SENT_EMAIL_CONTENT_BLOB,
      sourceType: "textarea",
      optionalSource: true,
      notes: "overflow continuation of Email_Content_vod__c; same policy",
    },
    // --- skipped roll-ups / formulas (row 12)
    ...[
      [
        "Open_Count_vod__c",
        "open_count__v",
        "roll-up — Vault recomputes (§2.5.6)",
      ],
      [
        "Click_Count_vod__c",
        "click_count__v",
        "roll-up — Vault recomputes (§2.5.6)",
      ],
      ["Last_Open_Date_vod__c", "last_open_date__v", "roll-up"],
      ["Last_Click_Date_vod__c", "last_click_date__v", "roll-up"],
      ["Opened_vod__c", "opened__v", "formula"],
      ["Clicked_vod__c", "clicked__v", "formula"],
      [
        "Approved_Document_Views_vod__c",
        "approved_document_views__v",
        "roll-up",
      ],
      ["Product_Display_vod__c", "product_display__v", "formula"],
      [
        "Events_Management_Subtype_vod__c",
        "events_management_subtype__v",
        "formula",
      ],
    ].map(
      ([source, target, notes]): RowInput => ({
        source,
        target,
        transform: "skip",
        required: "-",
        notes,
      }),
    ),
  ],
  picklists: {
    "sent_email.status": { ...SENT_EMAIL_STATUS },
    "sent_email.receiptEntityType": { ...SENT_EMAIL_RECEIPT_ENTITY_TYPE },
    // derivation rule + overlays
    "sent_email.activityTrackingMode": {},
  },
  deletePolicy: "ignore",
  inactivate: [],
  createPolicy: "create",
  load: { noTriggers: true },
  match: [
    { method: "legacy_id" },
    {
      method: "mobile_id",
      keys: [{ target: "mobile_id__v", source: "Mobile_ID_vod__c" }],
      evidence: "UNV",
    },
  ],
  blobs: { [SENT_EMAIL_CONTENT_BLOB]: "optional" },
  custom: { outOfScopeRef },
  optionDefaults: { contentOverflow: "truncate" },
  notes:
    "Sent emails (§6.3.40): 2y on Email_Sent_Date_vod__c or open (scheduled/saved/pending, or never sent and created in the window); country of account → User_vod__c → OwnerId; 12 object types; parent_email__v patched in pass 2; bodies via the blob pass (contentOverflow); deletes ignored (§4.4).",
});
