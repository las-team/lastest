/**
 * `email_activity` — `Email_Activity_vod__c` → `email_activity__v` `[UNV]`
 * (spec §6.3.41, §6.1 step 20, §6.2, §3.3, §4.4).
 *
 * Child of `sent_email` (open/click/… events): scoped through the parent's
 * `Sent_Email_vod__r.Email_Sent_Date_vod__c` (2y, plus the parent's
 * open-item term), country of the parent email, `noTriggers = true`, deleted
 * with the parent (`deletePolicy = delete`, §4.4). `Name` is an auto-number
 * (§6.0.4) — carried only with `objects.email_activity.preserveAutoNumberName`.
 *
 * `URL_vod__c`, `User_Agent_vod__c` and `IP_Address_vod__c` are
 * `[UNVERIFIED-SOURCE]`: a describe miss is `info` and the row is dropped
 * silently. The IP address is PII: the row is gated by
 * `objects.email_activity.loadIpAddress` (module default `true`; the
 * `regions.EU` overlay sets it to `false`, §7.2.1/§7.4) and erased ids are
 * skipped by `applyMapping` (`privacy.erasureListPath`).
 */
import { defineObject, type ObjectModuleInput } from "../types";

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

export const EMAIL_ACTIVITY_PARENT_FIELD = "Sent_Email_vod__c";
export const EMAIL_ACTIVITY_IP_FIELD = "IP_Address_vod__c";
export const EMAIL_ACTIVITY_LOAD_IP_FLAG = "loadIpAddress";

/** `Event_Type_vod__c` → `event_type__v` (`[UNV]` values by the rename rule; others derive). */
export const EMAIL_ACTIVITY_EVENT_TYPE: Record<string, string> = {
  Open_vod: "open__v",
  Click_vod: "click__v",
  Delivered_vod: "delivered__v",
  Bounce_vod: "bounce__v",
  Unsubscribe_vod: "unsubscribe__v",
  Marked_Spam_vod: "marked_spam__v",
  Dropped_vod: "dropped__v",
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

export const email_activity = defineObject({
  key: "email_activity",
  source: "Email_Activity_vod__c",
  target: "email_activity__v",
  targetEvidence: "UNV",
  scope: {
    kind: "via-parent",
    parentKey: "sent_email",
    parentField: "Sent_Email_vod__r.Email_Sent_Date_vod__c",
    type: "datetime",
  },
  countryOf: `parent:sent_email:${EMAIL_ACTIVITY_PARENT_FIELD}`,
  dependsOn: ["sent_email"],
  // master-detail child: auto-number Name, no OwnerId
  blockS: { name: "autoNumber", ownerId: false },
  fields: [
    // --- parent (§6.3.41 row 1)
    {
      source: EMAIL_ACTIVITY_PARENT_FIELD,
      target: "sent_email__v",
      transform: "ref(sent_email)",
      required: "Y",
      evidence: "UNV",
      sourceType: "reference",
      notes:
        "master-detail → Sent_Email_vod__c; scope and country via the parent",
    },
    // --- event (row 2)
    {
      source: "Event_Type_vod__c",
      target: "event_type__v",
      transform: "picklist(email_activity.eventType)",
      required: "Y",
      evidence: "UNV",
      sourceType: "picklist",
      notes: "{Open_vod, Click_vod, …}",
    },
    {
      source: "Event_Datetime_vod__c",
      target: "event_datetime__v",
      transform: "datetime",
      required: "Y",
      evidence: "UNV",
      sourceType: "datetime",
      notes: "[DOC sfdc-extract.md §7.15]",
    },
    // --- tracking details (row 3): [UNVERIFIED-SOURCE], dropped silently when absent
    unv("URL_vod__c", "url__v", "text", {
      unverifiedSource: true,
      optionalSource: true,
    }),
    unv("User_Agent_vod__c", "user_agent__v", "text", {
      unverifiedSource: true,
      optionalSource: true,
    }),
    unv(EMAIL_ACTIVITY_IP_FIELD, "ip_address__v", "text", {
      unverifiedSource: true,
      optionalSource: true,
      disabledBy: EMAIL_ACTIVITY_LOAD_IP_FLAG,
      notes:
        "PII — objects.email_activity.loadIpAddress (default true; false in regions.EU); erasure list respected by applyMapping",
    }),
  ],
  picklists: {
    "email_activity.eventType": { ...EMAIL_ACTIVITY_EVENT_TYPE },
  },
  deletePolicy: "delete",
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
  optionDefaults: { [EMAIL_ACTIVITY_LOAD_IP_FLAG]: true },
  notes:
    "Email activities (§6.3.41): child of sent_email, scoped and attributed through the parent; URL/User_Agent/IP_Address sources unverified (describe miss = info); ip_address__v gated by loadIpAddress (false in EU); deleted with the parent (§4.4).",
});
