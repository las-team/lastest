/**
 * `multichannel_activity` — `Multichannel_Activity_vod__c` → `multichannel_activity__v`
 * `[UNV]` (spec §6.3.43, §6.1 step 22, §6.2, §3.3, §3.5, §4.4).
 *
 * CLM / Engage / CoBrowse session headers. Dated on `Start_DateTime_vod__c`
 * (2y, `scope.historyMonths`); country of the account, falling back to the
 * organizer (`Organizer_vod__c`) and the owner (§6.2). `noTriggers = true`;
 * deleted activities are ignored on the target (§4.4, transactional).
 *
 * **Self-reference** `Multichannel_Activity_vod__c → multichannel_activity__v`
 * (parent session) is omitted in pass 1 and patched in pass 2 (`secondPass`
 * + `selfRefs`, §6.1 step 22). `call2.cobrowse_mc_activity__v` references
 * this object from an *earlier* step: that module declares the pass-2 patch
 * with `selfRefs.objectKey = 'multichannel_activity'` so the DAG stays
 * acyclic (`multichannel_activity` depends on `call2`, not the reverse).
 *
 * `Call_vod__c` → `call__v` is a confirmed rename exception (§6.0.2 — the SFDC
 * lookup is named `Call_vod__c` although it references `Call2_vod__c`).
 * `Account_External_ID_Map_vod__c` is loaded as an informational **text**
 * copy of the SFDC id, never as a reference (`Account_External_ID_Map_vod__c`
 * is out of v1, §6.2.1). `Record_Type_Name_vod__c` lands on
 * `record_type_name__v`; when the vault spells it `object_type_name__v` the
 * overlay overrides the target (preflight drops the missing one either way).
 *
 * Object types `CLM_vod → clm__v`, `Cobrowse_vod → cobrowse__v`,
 * `Engage_vod → engage__v` (all `[UNV]`).
 *
 * Device / geo columns (§6.3.43 "optional") are `[UNVERIFIED-SOURCE]` and
 * gated by `objects.multichannel_activity.loadDeviceFields` (default `false`,
 * same flag family as `objects.call2.loadDeviceFields`); a describe miss is
 * `info` and the row is dropped silently.
 */
import { defineObject, type ObjectModuleInput } from "../types";

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

export const MULTICHANNEL_ACTIVITY_ACCOUNT_FIELD = "Account_vod__c";
export const MULTICHANNEL_ACTIVITY_ORGANIZER_FIELD = "Organizer_vod__c";
export const MULTICHANNEL_ACTIVITY_PARENT_FIELD =
  "Multichannel_Activity_vod__c";
export const MULTICHANNEL_ACTIVITY_START_FIELD = "Start_DateTime_vod__c";
export const MULTICHANNEL_ACTIVITY_CALL_FIELD = "Call_vod__c";
export const MULTICHANNEL_ACTIVITY_VEXTERNAL_ID_FIELD = "VExternal_Id_vod__c";
export const MULTICHANNEL_ACTIVITY_LOAD_DEVICE_FLAG = "loadDeviceFields";

/** `RecordType.DeveloperName` → object type api name (§6.3.43, all `[UNV]`). */
export const MULTICHANNEL_ACTIVITY_OBJECT_TYPES: Record<string, string> = {
  CLM_vod: "clm__v",
  Cobrowse_vod: "cobrowse__v",
  Engage_vod: "engage__v",
};

/**
 * Device / geo columns (§6.3.43 "device/geo columns → optional, copy").
 * Every source name is `[UNVERIFIED-SOURCE]` (describe miss = `info`).
 */
export const MULTICHANNEL_ACTIVITY_DEVICE_FIELDS: ReadonlyArray<{
  source: string;
  target: string;
}> = [
  { source: "Device_vod__c", target: "device__v" },
  { source: "Device_Type_vod__c", target: "device_type__v" },
  { source: "Location_Latitude_vod__c", target: "location_latitude__v" },
  { source: "Location_Longitude_vod__c", target: "location_longitude__v" },
];

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

export const multichannel_activity = defineObject({
  key: "multichannel_activity",
  source: "Multichannel_Activity_vod__c",
  target: "multichannel_activity__v",
  targetEvidence: "UNV",
  scope: {
    kind: "dated",
    predicates: [
      { field: MULTICHANNEL_ACTIVITY_START_FIELD, type: "datetime" },
    ],
  },
  countryOf: [
    "account",
    `user:${MULTICHANNEL_ACTIVITY_ORGANIZER_FIELD}`,
    "user:OwnerId",
  ],
  dependsOn: [
    "account",
    "call2",
    "sent_email",
    "product",
    "medical_event",
    "event_attendee",
    "user",
  ],
  selfRefs: [
    {
      target: "multichannel_activity__v",
      source: MULTICHANNEL_ACTIVITY_PARENT_FIELD,
    },
  ],
  objectTypes: { ...MULTICHANNEL_ACTIVITY_OBJECT_TYPES },
  fields: [
    // --- account (§6.3.43 row 1)
    {
      source: MULTICHANNEL_ACTIVITY_ACCOUNT_FIELD,
      target: "account__v",
      transform: "ref(account)",
      required: "y?",
      evidence: "UNV",
      sourceType: "reference",
      notes: "country-of lookup (first in the fallback chain)",
    },
    // --- call (row 2): rename exception Call_vod__c → call__v (§6.0.2)
    ref(MULTICHANNEL_ACTIVITY_CALL_FIELD, "call__v", "call2", {
      notes:
        "lookup named Call_vod__c references Call2_vod__c — confirmed rename exception (§6.0.2)",
    }),
    // --- references (row 3)
    ref("Sent_Email_vod__c", "sent_email__v", "sent_email"),
    ref("Product_vod__c", "product__v", "product"),
    ref("Detail_Group_vod__c", "detail_group__v", "product"),
    ref("Medical_Event_vod__c", "medical_event__v", "medical_event"),
    ref("Event_Attendee_vod__c", "event_attendee__v", "event_attendee"),
    // --- organizer (row 4)
    {
      source: MULTICHANNEL_ACTIVITY_ORGANIZER_FIELD,
      target: "organizer__v",
      transform: "refUser",
      required: "n",
      evidence: "UNV",
      sourceType: "reference",
      notes:
        "business user lookup — objects.multichannel_activity.unmappedUserPolicy (§3.5); country-of fallback",
    },
    // --- self reference (row 5)
    {
      source: MULTICHANNEL_ACTIVITY_PARENT_FIELD,
      target: "multichannel_activity__v",
      transform: "ref(multichannel_activity) secondPass",
      required: "n",
      evidence: "UNV",
      sourceType: "reference",
      notes:
        "parent session — omitted in pass 1, patched in pass 2 (§6.1 step 22)",
    },
    // --- scalars (row 6)
    {
      source: MULTICHANNEL_ACTIVITY_START_FIELD,
      target: "start_datetime__v",
      transform: "datetime",
      required: "Y",
      evidence: "UNV",
      sourceType: "datetime",
      notes: "scope date (§6.2)",
    },
    unv("Total_Duration_vod__c", "total_duration__v", "number", {
      sourceType: "double",
    }),
    unv("Session_Id_vod__c", "session_id__v", "text", {
      sourceType: "string",
    }),
    unv("Territory_vod__c", "territory__v", "text", {
      sourceType: "string",
      notes: "territory name snapshot (text, not a reference)",
    }),
    unv("Saved_For_Later_vod__c", "saved_for_later__v", "bool", {
      sourceType: "boolean",
    }),
    unv("Site_vod__c", "site__v", "text", { sourceType: "string" }),
    unv(
      "Account_External_ID_Map_vod__c",
      "account_external_id_map__v",
      "text",
      {
        sourceType: "reference",
        notes:
          "informational text copy of the SFDC id — never a reference (Account_External_ID_Map_vod__c is out of v1, §6.2.1)",
      },
    ),
    unv("Record_Type_Name_vod__c", "record_type_name__v", "text", {
      sourceType: "string",
      countryConfigurable: true,
      notes:
        "or object_type_name__v — override the target in the overlay when the vault spells it that way",
    }),
    // --- ids (row 7)
    unv(MULTICHANNEL_ACTIVITY_VEXTERNAL_ID_FIELD, "vexternal_id__v", "copy", {
      sourceType: "string",
      notes: "unique; secondary match key (§3.3)",
    }),
    // --- device / geo (row 7, optional): [UNVERIFIED-SOURCE], gated by loadDeviceFields
    ...MULTICHANNEL_ACTIVITY_DEVICE_FIELDS.map(({ source, target }) =>
      unv(source, target, "copy", {
        unverifiedSource: true,
        optionalSource: true,
        enabledBy: MULTICHANNEL_ACTIVITY_LOAD_DEVICE_FLAG,
        notes:
          "device/geo column [UNVERIFIED-SOURCE] — objects.multichannel_activity.loadDeviceFields (default false)",
      }),
    ),
  ],
  picklists: {},
  deletePolicy: "ignore",
  inactivate: [],
  createPolicy: "create",
  load: { noTriggers: true },
  match: [
    { method: "legacy_id" },
    {
      method: "external_id",
      keys: [
        {
          target: "vexternal_id__v",
          source: MULTICHANNEL_ACTIVITY_VEXTERNAL_ID_FIELD,
        },
      ],
      evidence: "UNV",
    },
    {
      method: "mobile_id",
      keys: [{ target: "mobile_id__v", source: "Mobile_ID_vod__c" }],
      evidence: "UNV",
    },
  ],
  optionDefaults: { [MULTICHANNEL_ACTIVITY_LOAD_DEVICE_FLAG]: false },
  notes:
    "Multichannel activities (§6.3.43): 2y on Start_DateTime_vod__c; country of account → Organizer_vod__c → OwnerId; Call_vod__c → call__v (rename exception); parent multichannel_activity__v patched in pass 2 (call2.cobrowse_mc_activity__v is patched after this step); Account_External_ID_Map_vod__c as text; device/geo columns gated by loadDeviceFields; deletes ignored (§4.4).",
});
