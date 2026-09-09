/**
 * `medical_event` — `Medical_Event_vod__c` → `medical_event__v` `[DOC]`
 * (spec §6.3.26, §6.1 step 13, §6.2, §3.3, §3.5, §4.4).
 *
 * Legacy events; since 18R1 they are shadows of EM events. Dated on
 * `Start_Date_vod__c` (2y window) **plus** FK closure from calls and
 * discussions (§1.1 #5 — closure is driven by the extractor from the
 * referencing units' FK sets, nothing to declare here). Country of the
 * linked account, falling back to the owner (`['account', 'user:OwnerId']`,
 * §6.0.5). Loaded after `em_event` so the `em_event__v` back-link resolves.
 * `noTriggers = true`; deleted events are ignored on the target (§4.4).
 *
 * Object types (`[UNV]` names) follow the rename rule from the eight
 * `RecordType.DeveloperName`s of §6.3.26.
 *
 * Block S: `status__v = inactive__v` is derived from `Active_vod__c = false`
 * (§6.0.4 / §4.4 "Active_vod__c" family) in addition to the business flag
 * `active__v`; `inactivate` (when the delete policy is overridden) writes
 * `active__v = false` next to the implied `status__v`. Expense amounts make
 * this a currency object (`local_currency__sys` in multi-currency orgs).
 *
 * Source names the spec lists only by family ("attendee field-config blobs",
 * "cobrowse fields") are carried as `[UNVERIFIED-SOURCE]` + `optionalSource`
 * rows so preflight drops them silently (`info`) when the org lacks them.
 */
import { defineObject, type ObjectModuleInput } from "../types";

/** RecordType DeveloperName → object type api name (`[UNV]`, §6.3.26). */
export const MEDICAL_EVENT_OBJECT_TYPES: Record<string, string> = {
  Award_vod: "award__v",
  Congress_vod: "congress__v",
  Investigator_Meeting_vod: "investigator_meeting__v",
  Medical_Event_vod: "medical_event__v",
  Round_Table_vod: "round_table__v",
  Satellite_Symposium_vod: "satellite_symposium__v",
  Speaker_Program_vod: "speaker_program__v",
  Workshop_vod: "workshop__v",
};

/** Lookups (also the first `countryOf` rule). */
export const MEDICAL_EVENT_ACCOUNT_FIELD = "Account_vod__c";
export const MEDICAL_EVENT_ADDRESS_FIELD = "Address_vod__c";
export const MEDICAL_EVENT_EM_EVENT_FIELD = "EM_Event_vod__c";
/** Scope date (§6.2). */
export const MEDICAL_EVENT_SCOPE_FIELD = "Start_Date_vod__c";

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

/** Rows whose source name is inferred from the spec's family description (§6.3.26). */
const inferred = (
  source: string,
  target: string,
  transform: string,
  extra: Partial<RowInput> = {},
): RowInput =>
  unv(source, target, transform, {
    unverifiedSource: true,
    optionalSource: true,
    ...extra,
  });

export const medical_event = defineObject({
  key: "medical_event",
  source: "Medical_Event_vod__c",
  target: "medical_event__v",
  targetEvidence: "DOC",
  scope: {
    kind: "dated",
    predicates: [{ field: MEDICAL_EVENT_SCOPE_FIELD, type: "date" }],
  },
  countryOf: ["account", "user:OwnerId"],
  dependsOn: ["account", "address", "em_event"],
  objectTypes: { ...MEDICAL_EVENT_OBJECT_TYPES },
  blockS: {
    currency: true,
    statusFromFlag: {
      sourceFlag: "Active_vod__c",
      inactiveWhen: { equals: false },
    },
  },
  fields: [
    // --- §6.3.26 rows (same-target rows replace Block S defaults)
    {
      source: "Name",
      target: "name__v",
      transform: "text(128)",
      required: "Y",
      evidence: "UNV",
      disabledBy: "preserveName",
    },
    unv(MEDICAL_EVENT_ACCOUNT_FIELD, "account__v", "ref(account)", {
      sourceType: "reference",
      notes: "first countryOf rule",
    }),
    unv(MEDICAL_EVENT_ADDRESS_FIELD, "address__v", "ref(address)", {
      sourceType: "reference",
    }),
    unv(MEDICAL_EVENT_EM_EVENT_FIELD, "em_event__v", "ref(em_event)", {
      sourceType: "reference",
      notes: "back-link to the EM event shadowed since 18R1",
    }),
    // --- dates / times
    unv(MEDICAL_EVENT_SCOPE_FIELD, "start_date__v", "date", {
      required: "Y",
      sourceType: "date",
      notes: "scope date (§6.2)",
    }),
    unv("End_Date_vod__c", "end_date__v", "date", { sourceType: "date" }),
    unv("Start_Time_vod__c", "start_time__v", "datetime", {
      sourceType: "datetime",
    }),
    unv("End_Time_vod__c", "end_time__v", "datetime", {
      sourceType: "datetime",
    }),
    // --- descriptive
    unv("Active_vod__c", "active__v", "bool", {
      sourceType: "boolean",
      notes:
        "business flag; also drives Block S status__v = inactive__v when false (§6.0.4)",
    }),
    unv("Alternate_Name_vod__c", "alternate_name__v", "text"),
    unv("Event_Display_Name_vod__c", "event_display_name__v", "text"),
    unv("Description_vod__c", "description__v", "longtext", {
      sourceType: "textarea",
    }),
    unv("Sponsor_vod__c", "sponsor__v", "text"),
    unv("Country_Name_vod__c", "country_name__v", "text", {
      sourceType: "string",
      notes: "free text, not the country crosswalk",
    }),
    unv("Web_Source_vod__c", "web_source__v", "text"),
    // --- expense fields
    unv("Expense_Amount_vod__c", "expense_amount__v", "number", {
      sourceType: "currency",
      optionalSource: true,
    }),
    unv(
      "Expense_Post_Status_vod__c",
      "expense_post_status__v",
      "picklist(medical_event.expensePostStatus)",
      { sourceType: "picklist", optionalSource: true },
    ),
    unv(
      "Expense_System_External_ID_vod__c",
      "expense_system_external_id__v",
      "text",
      { optionalSource: true },
    ),
    unv("Concur_Report_Name_vod__c", "concur_report_name__v", "text", {
      optionalSource: true,
    }),
    unv("Submit_Expense_vod__c", "submit_expense__v", "bool", {
      sourceType: "boolean",
      optionalSource: true,
    }),
    // --- attendee field-config blobs (family named in §6.3.26; source name inferred)
    inferred(
      "Attendee_Field_Config_vod__c",
      "attendee_field_config__v",
      "longtext",
      { notes: "attendee field-config blob [UNVERIFIED-SOURCE]" },
    ),
    // --- cobrowse fields (family named in §6.3.26; source names inferred)
    inferred("Cobrowse_Meeting_ID_vod__c", "cobrowse_meeting_id__v", "text"),
    inferred("Cobrowse_Host_URL_vod__c", "cobrowse_host_url__v", "text"),
    inferred(
      "Cobrowse_Attendee_URL_vod__c",
      "cobrowse_attendee_url__v",
      "text",
    ),
    // --- owner (y? per §6.3.26; Block S default is n)
    {
      source: "OwnerId",
      target: "ownerid__v",
      transform: "refUser",
      required: "y?",
      evidence: "UNV",
      notes:
        "queue owners → §3.4; dropped by preflight when the target has no ownerid__v",
    },
    // --- skipped (formulas / section marker)
    {
      source: "Status_vod__c",
      target: "medical_event_status__v",
      transform: "skip",
      required: "-",
      notes: "formula — never loaded (§6.3.26)",
    },
    {
      source: "Topic_vod__c",
      target: "topic__v",
      transform: "skip",
      required: "-",
      notes: "formula — never loaded (§6.3.26)",
    },
    {
      source: "zvod_Cobrowse_vod__c",
      target: "zvod_cobrowse__v",
      transform: "skip",
      required: "-",
      notes: "zvod_* section marker — never loaded (§6.0.2)",
    },
  ],
  // No documented value list for the expense post status: derivation rule (§6.0.2); overlays add entries.
  picklists: { "medical_event.expensePostStatus": {} },
  deletePolicy: "ignore",
  inactivate: [{ field: "active__v", value: false }],
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
  notes:
    "Legacy medical events (§6.3.26): 2y on Start_Date_vod__c plus closure from calls/discussions; country of the account (fallback owner); after em_event for the back-link; status__v derived from Active_vod__c; deletes ignored (§4.4), inactivate set = active__v=false.",
});
