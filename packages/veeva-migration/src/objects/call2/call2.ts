/**
 * `call2` — `Call2_vod__c` → `call2__v` `[DOC object; every field UNV]`
 * (spec §6.3.30, §6.1 step 16, §6.2, §3.3, §3.4, §3.5, §4.4, §8.6).
 *
 * Scope: `Call_Date_vod__c` (date) within the history window **or** planned
 * (`Status_vod__c = 'Planned_vod'`, §1.1 #4). The US overlay may fold calls
 * into the samples retention family (`scope.samplesIncludeCalls`, handled by
 * `config/resolve.ts`). Country of the account, then of the rep
 * (`User_vod__c`), then of the owner (`['account', 'user:User_vod__c',
 * 'user:OwnerId']`). Deleted calls are never touched on the target (`ignore`,
 * §4.4). Loaded in migration mode with `noTriggers = true` — submitted calls
 * keep their state, and their `call2_sample` / `sample_transaction` rows are
 * loaded explicitly (§6.3.34).
 *
 * Group calls: attendee rows are child `call2__v` rows with `parent_call__v`.
 * Parents are loaded before attendees through `load.partitionBy:
 * Parent_Call_vod__c` (`null` first, then `notNull`), so `parent_call__v` is a
 * plain `ref(call2)`; §6.1 step 16 keeps a pass-2 patch as the fallback when
 * the two partitions cannot be ordered.
 *
 * Cycles (§3.1 of CONTRACTS):
 *  - `error_reference_call__v` (self) → `ref(call2) secondPass` + `selfRefs`;
 *  - `cobrowse_mc_activity__v` → `ref(multichannel_activity) secondPass` with
 *    `selfRefs.objectKey = 'multichannel_activity'` — `multichannel_activity`
 *    depends on `call2` (step 22), so `multichannel_activity` is listed in
 *    `dependsOn` and the DAG edge is removed by the selfRef;
 *  - `medical_inquiry__v` is a direct `ref(medical_inquiry)`: the
 *    `medical_inquiry` module already breaks the cycle by deferring its
 *    `call2__v` to pass 2 (§6.1 step 15), so inquiries precede calls.
 *
 * Business status `Status_vod__c` {Planned_vod, Saved_vod, Submitted_vod} →
 * `call2_status__v` (pattern field, preflight may re-point to `status__v` when
 * the platform status carries the submitted-like values) **and** the lifecycle
 * `state__v` when `available_lifecycles` is non-empty (`call2.state`
 * crosswalk, `<status>_state__v` `[UNV]`).
 *
 * Custom transforms (pure, unit-tested):
 *  - `contactRef` — `Contact_vod__c` has no Vault equivalent (§3.4): dropped
 *    and counted (`CONTACT_REF_DROPPED`) unless the id map already carries a
 *    person account for the contact (`objects.account.contactToPersonAccount`),
 *    and only when `Account_vod__c` is empty; emits into `account__v`.
 *  - `addressSnapshot` — `Address_vod__c` is the PDMA **text snapshot** of the
 *    address at signature time; loaded verbatim as text (500) when the target
 *    is a text field, omitted with `CALL2_ADDRESS_TARGET_IS_OBJECT` when the
 *    vault models `address__v` as an object reference (never recomputed from
 *    the current address).
 *  - `outOfScopeRef` — references into objects outside v1
 *    (`Remote_Meeting_vod__c`, `Suggestion_vod__c`,
 *    `Supervising_Physician_vod__c`): omitted and counted
 *    (`OUT_OF_SCOPE_REF_DROPPED`, §6.2.1).
 *
 * Flags (`objects.call2.*`, defaults in `optionDefaults`):
 *  - `loadCallType` (default `false`): `Call_Type_vod__c` is system-maintained
 *    in Veeva CRM and derived by Vault — the row is kept only with the flag;
 *  - `loadDeviceFields` (default `false`): check-in / submit / CLM geo and
 *    device columns;
 *  - `loadUnlockFlag` (Block S): `Unlock_vod__c` is a transient request flag.
 *
 * `State_vod__c` (address snapshot) targets `state_province__v` rather than
 * the spec's literal `state__v`, which is the lifecycle state field on a
 * lifecycled target (§6.0.2 known exception, as on address/em_event) —
 * `[UNV]`, re-pointable per country. Wildcard expansions of the spec
 * (`Ship_*`, `Check_In_*`, `Submit_*`, `CLM_Location_*`, `zvod_*`) carry
 * `unverifiedSource` + `optionalSource`: a describe miss is `info` and the
 * row is dropped.
 */
import { applyTransform } from "../../transform/registry";
import { isContactId, isSfdcId, to18 } from "../../transform/ids";
import type {
  CustomTransformFn,
  MatchRule,
  ObjectKey,
  TransformResult,
} from "../../types";
import {
  defineObject,
  type BlockSOptions,
  type ObjectModuleInput,
} from "../types";

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

export const CALL2_ACCOUNT_FIELD = "Account_vod__c";
export const CALL2_CONTACT_FIELD = "Contact_vod__c";
export const CALL2_REP_FIELD = "User_vod__c";
export const CALL2_PARENT_FIELD = "Parent_Call_vod__c";
export const CALL2_STATUS_FIELD = "Status_vod__c";
export const CALL2_DATE_FIELD = "Call_Date_vod__c";

/** Open-item term of the scope (§6.2): planned calls are always in scope. */
export const CALL2_OPEN_PREDICATE = "Status_vod__c = 'Planned_vod'";

/** RecordType DeveloperName → object type api name (all `[UNV]`; `CallReport_vod` casing resolved by label at preflight). */
export const CALL2_OBJECT_TYPES: Record<string, string> = {
  CallReport_vod: "call_report__v",
  Event_vod: "event__v",
  MSLMeetingBrief_vod: "mslmeetingbrief__v",
  MeetingBrief_vod: "meetingbrief__v",
  Medical_Inquiry_Fulfillment_vod: "medical_inquiry_fulfillment__v",
};

/** `Status_vod__c` → `call2_status__v` (`[UNV]` values by the rename rule). */
export const CALL2_STATUS: Record<string, string> = {
  Planned_vod: "planned__v",
  Saved_vod: "saved__v",
  Submitted_vod: "submitted__v",
};

/** `Status_vod__c` → lifecycle state (`[UNV]`, §6.3.30 `Submitted_vod → submitted_state__v` pattern). */
export const CALL2_STATES: Record<string, string> = {
  Planned_vod: "planned_state__v",
  Saved_vod: "saved_state__v",
  Submitted_vod: "submitted_state__v",
};

/** `Call_Type_vod__c` plain-English values → `[UNV]` names (§6.0.2 plain-English rule; validate at preflight). */
export const CALL2_CALL_TYPES: Record<string, string> = {
  "Detail Only": "detail_only__v",
  "Detail with Sample": "detail_with_sample__v",
  "Group Detail": "group_detail__v",
  "Group Detail with Sample": "group_detail_with_sample__v",
  "Sample Only": "sample_only__v",
  "Call Only": "call_only__v",
};

/** `Call_Channel_vod__c` (newer) → `call_channel__v` (`[UNV]`, country-configurable). */
export const CALL2_CALL_CHANNELS: Record<string, string> = {
  Face_to_face_vod: "face_to_face__v",
  Phone_vod: "phone__v",
  Video_vod: "video__v",
};

/**
 * `Attendee_Type_vod__c` crosswalk shared by the call and its children
 * (§6.3.30/§6.3.31). `Contact_vod` is skipped (no Vault contact, §3.4).
 */
export const CALL2_ATTENDEE_TYPES: Record<string, string | null> = {
  Group_Account_vod: "group_account__v",
  Person_Account_vod: "person_account__v",
  Business_Account_vod: "business_account__v",
  User_vod: "user__v",
  Event_vod: "event__v",
  Contact_vod: null,
};

/** Blob names (`objects.call2.blobs.*`; the US overlay sets `signature: required`). */
export const CALL2_SIGNATURE_BLOB = "signature";
export const CALL2_SIGNATURE_PAGE_IMAGE_BLOB = "signaturePageImage";

/** Diagnostic codes counted in the run report. */
export const CALL2_ADDRESS_TARGET_IS_OBJECT_CODE =
  "CALL2_ADDRESS_TARGET_IS_OBJECT";
export const CONTACT_REF_DROPPED_CODE = "CONTACT_REF_DROPPED";
export const CONTACT_MAPPED_TO_PERSON_ACCOUNT_CODE =
  "CONTACT_MAPPED_TO_PERSON_ACCOUNT";
export const OUT_OF_SCOPE_REF_DROPPED_CODE = "OUT_OF_SCOPE_REF_DROPPED";

type RowInput = NonNullable<ObjectModuleInput["fields"]>[number];

/** Row builder: `n` / `UNV` unless overridden. */
export const unv = (
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

/** Licence / DEA / sample-card snapshot columns loaded verbatim (§6.3.30 "PDMA evidence"; US-configurable). */
export const CALL2_LICENCE_SNAPSHOT_FIELDS: ReadonlyArray<{
  source: string;
  target: string;
  transform: "text" | "longtext" | "date" | "bool";
  unverifiedSource?: boolean;
}> = [
  { source: "License_vod__c", target: "license__v", transform: "text" },
  {
    source: "License_Status_vod__c",
    target: "license_status__v",
    transform: "text",
  },
  {
    source: "License_Expiration_Date_vod__c",
    target: "license_expiration_date__v",
    transform: "date",
  },
  { source: "DEA_vod__c", target: "dea__v", transform: "text" },
  {
    source: "DEA_Expiration_Date_vod__c",
    target: "dea_expiration_date__v",
    transform: "date",
  },
  {
    source: "DEA_Address_Line_1_vod__c",
    target: "dea_address_line_1__v",
    transform: "text",
  },
  {
    source: "DEA_Address_Line_2_vod__c",
    target: "dea_address_line_2__v",
    transform: "text",
  },
  { source: "DEA_City_vod__c", target: "dea_city__v", transform: "text" },
  { source: "DEA_State_vod__c", target: "dea_state__v", transform: "text" },
  { source: "DEA_Zip_vod__c", target: "dea_zip__v", transform: "text" },
  { source: "DEA_Zip_4_vod__c", target: "dea_zip_4__v", transform: "text" },
  { source: "CDS_vod__c", target: "cds__v", transform: "text" },
  {
    source: "CDS_Expiration_Date_vod__c",
    target: "cds_expiration_date__v",
    transform: "date",
  },
  { source: "ASSMCA_vod__c", target: "assmca__v", transform: "text" },
  {
    source: "Disbursed_To_vod__c",
    target: "disbursed_to__v",
    transform: "text",
  },
  { source: "Sample_Card_vod__c", target: "sample_card__v", transform: "bool" },
  {
    source: "Sample_Send_Card_vod__c",
    target: "sample_send_card__v",
    transform: "bool",
  },
  {
    source: "Sample_Card_Reason_vod__c",
    target: "sample_card_reason__v",
    transform: "text",
  },
  { source: "Credentials_vod__c", target: "credentials__v", transform: "text" },
  { source: "Salutation_vod__c", target: "salutation__v", transform: "text" },
  {
    source: "Supervising_Physician_Name_vod__c",
    target: "supervising_physician_name__v",
    transform: "text",
  },
  {
    source: "Supervising_Physician_License_vod__c",
    target: "supervising_physician_license__v",
    transform: "text",
  },
  {
    source: "Supervising_Physician_Credential_vod__c",
    target: "supervising_physician_credential__v",
    transform: "text",
  },
  {
    source: "Disclaimer_vod__c",
    target: "disclaimer__v",
    transform: "longtext",
  },
];

/** `Ship_*_vod__c` ship-to snapshot (§6.3.30 "(14)" wildcard — every name `[UNVERIFIED-SOURCE]`). */
export const CALL2_SHIP_SNAPSHOT_FIELDS: ReadonlyArray<{
  source: string;
  target: string;
  transform: "text";
}> = [
  {
    source: "Ship_Address_Line_1_vod__c",
    target: "ship_address_line_1__v",
    transform: "text",
  },
  {
    source: "Ship_Address_Line_2_vod__c",
    target: "ship_address_line_2__v",
    transform: "text",
  },
  { source: "Ship_City_vod__c", target: "ship_city__v", transform: "text" },
  { source: "Ship_State_vod__c", target: "ship_state__v", transform: "text" },
  { source: "Ship_Zip_vod__c", target: "ship_zip__v", transform: "text" },
  { source: "Ship_Zip_4_vod__c", target: "ship_zip_4__v", transform: "text" },
  {
    source: "Ship_Country_vod__c",
    target: "ship_country__v",
    transform: "text",
  },
  {
    source: "Ship_To_Name_vod__c",
    target: "ship_to_name__v",
    transform: "text",
  },
  {
    source: "Ship_To_Address_Line_1_vod__c",
    target: "ship_to_address_line_1__v",
    transform: "text",
  },
  {
    source: "Ship_To_Address_Line_2_vod__c",
    target: "ship_to_address_line_2__v",
    transform: "text",
  },
  {
    source: "Ship_To_City_vod__c",
    target: "ship_to_city__v",
    transform: "text",
  },
  {
    source: "Ship_To_State_vod__c",
    target: "ship_to_state__v",
    transform: "text",
  },
  { source: "Ship_To_Zip_vod__c", target: "ship_to_zip__v", transform: "text" },
  {
    source: "Ship_To_Zip_4_vod__c",
    target: "ship_to_zip_4__v",
    transform: "text",
  },
];

/** Device / geo columns gated by `objects.call2.loadDeviceFields` (wildcards → `[UNVERIFIED-SOURCE]`). */
export const CALL2_DEVICE_FIELDS: ReadonlyArray<{
  source: string;
  target: string;
  transform: "text" | "number" | "datetime";
}> = [
  {
    source: "Check_In_Latitude_vod__c",
    target: "check_in_latitude__v",
    transform: "number",
  },
  {
    source: "Check_In_Longitude_vod__c",
    target: "check_in_longitude__v",
    transform: "number",
  },
  {
    source: "Check_In_Datetime_vod__c",
    target: "check_in_datetime__v",
    transform: "datetime",
  },
  {
    source: "Check_In_Location_Services_Status_vod__c",
    target: "check_in_location_services_status__v",
    transform: "text",
  },
  {
    source: "Submit_Latitude_vod__c",
    target: "submit_latitude__v",
    transform: "number",
  },
  {
    source: "Submit_Longitude_vod__c",
    target: "submit_longitude__v",
    transform: "number",
  },
  {
    source: "Submit_Datetime_vod__c",
    target: "submit_datetime__v",
    transform: "datetime",
  },
  {
    source: "Submit_Location_Services_Status_vod__c",
    target: "submit_location_services_status__v",
    transform: "text",
  },
  {
    source: "CLM_Location_Latitude_vod__c",
    target: "clm_location_latitude__v",
    transform: "number",
  },
  {
    source: "CLM_Location_Longitude_vod__c",
    target: "clm_location_longitude__v",
    transform: "number",
  },
  { source: "Color_vod__c", target: "color__v", transform: "text" },
];

/** `zvod_*` layout markers of §6.3.30 ("(11)"; never loaded, names `[UNVERIFIED-SOURCE]`). */
export const CALL2_ZVOD_FIELDS: readonly string[] = [
  "zvod_Attendees_vod__c",
  "zvod_Call_Discussions_vod__c",
  "zvod_Call_Objectives_vod__c",
  "zvod_Call_Samples_vod__c",
  "zvod_Detailing_vod__c",
  "zvod_Expenses_vod__c",
  "zvod_Invitee_vod__c",
  "zvod_Key_Messages_vod__c",
  "zvod_Medical_Discussion_vod__c",
  "zvod_Product_Priority_vod__c",
  "zvod_Signature_vod__c",
];

// ---------------------------------------------------------------------------
// helpers (pure)
// ---------------------------------------------------------------------------

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

/**
 * `custom(contactRef)`: `Contact_vod__c` → `account__v` only when the id map
 * already knows the contact as a person account (§3.4
 * `objects.account.contactToPersonAccount`); otherwise the reference is
 * dropped and counted (`CONTACT_REF_DROPPED`, non-fatal). Silent when
 * `Account_vod__c` is set (the account wins).
 */
export const contactRef: CustomTransformFn = (
  value,
  row,
  ctx,
): TransformResult | undefined => {
  if (isEmpty(value)) return undefined;
  if (!isEmpty(row[CALL2_ACCOUNT_FIELD])) return undefined;
  const raw = String(value).trim();
  if (!isSfdcId(raw) || !isContactId(raw))
    return {
      omit: true,
      diagnostic: {
        kind: "invalid_value",
        field: "account__v",
        code: "INVALID_ID",
        value: raw,
      },
    };
  const id = to18(raw);
  if (ctx.ids.resolve("account", id) !== undefined)
    return {
      value: { $fk: { object: "account", sfdcId: id } },
      targetField: "account__v",
      diagnostic: {
        kind: "custom",
        field: "account__v",
        code: CONTACT_MAPPED_TO_PERSON_ACCOUNT_CODE,
        value: id,
      },
    };
  return {
    omit: true,
    diagnostic: {
      kind: "contact_ref_dropped",
      field: "account__v",
      code: CONTACT_REF_DROPPED_CODE,
      value: id,
    },
  };
};

/**
 * `custom(addressSnapshot)`: the PDMA address text snapshot. Text (500) when
 * the target is a text field; when the vault models the target as an object
 * reference the value is omitted and counted (`CALL2_ADDRESS_TARGET_IS_OBJECT`,
 * non-fatal) — it is never recomputed from the current address.
 */
export const addressSnapshot: CustomTransformFn = (
  value,
  row,
  ctx,
): TransformResult | undefined => {
  if (isEmpty(value)) return undefined;
  const type = ctx.targetField?.type;
  if (type === "object" || type === "lookup")
    return {
      omit: true,
      diagnostic: {
        kind: "custom",
        field: ctx.field.target,
        code: CALL2_ADDRESS_TARGET_IS_OBJECT_CODE,
        detail: `${ctx.field.target} is an object reference on the target; the text snapshot cannot be loaded`,
      },
    };
  const spec =
    type === "longtext"
      ? ({ kind: "longtext", max: 500 } as const)
      : ({ kind: "text", max: 500 } as const);
  return applyTransform(spec, value, row, ctx);
};

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
// shared with the call children (§6.3.31 preamble)
// ---------------------------------------------------------------------------

/**
 * Rows common to every `Call2_*` child (§6.3.31 preamble): the master-detail
 * parent, attendee type, entity reference and parent mobile id; the
 * `Is_Parent_Call_vod__c` formula is skipped. `Override_Lock_vod__c` comes
 * from Block S.
 */
export function call2ChildCommonRows(key: ObjectKey): RowInput[] {
  return [
    {
      source: "Call2_vod__c",
      target: "call2__v",
      transform: "ref(call2)",
      required: "Y",
      evidence: "DOC",
      sourceType: "reference",
      notes: "master-detail parent; country-of and scope come through it",
    },
    unv(
      "Attendee_Type_vod__c",
      "attendee_type__v",
      `picklist(${key}.attendeeType)`,
      { sourceType: "picklist" },
    ),
    unv("Entity_Reference_Id_vod__c", "entity_reference_id__v", "text"),
    unv("Call2_Mobile_ID_vod__c", "call2_mobile_id__v", "copy", {
      sourceType: "string",
    }),
    {
      source: "Is_Parent_Call_vod__c",
      target: "is_parent_call__v",
      transform: "skip",
      required: "-",
      notes: "formula",
    },
  ];
}

/** Block S options of the call children: auto-number Name, no OwnerId (master-detail). */
export const CALL2_CHILD_BLOCK_S: BlockSOptions = {
  name: "autoNumber",
  ownerId: false,
  currency: false,
};

/** §3.3 `call2`, `call2_*`: id map → legacy id → `mobile_id__v`. */
export const CALL2_MATCH_RULES: MatchRule[] = [
  { method: "legacy_id" },
  {
    method: "mobile_id",
    keys: [{ target: "mobile_id__v", source: "Mobile_ID_vod__c" }],
    evidence: "UNV",
  },
];

// ---------------------------------------------------------------------------
// module
// ---------------------------------------------------------------------------

const pdma = (extra: Partial<RowInput> = {}): Partial<RowInput> => ({
  countryConfigurable: true,
  notes: "PDMA evidence — verbatim; US overlay may make it required",
  ...extra,
});

export const call2 = defineObject({
  key: "call2",
  source: "Call2_vod__c",
  target: "call2__v",
  targetEvidence: "DOC",
  scope: {
    kind: "dated",
    predicates: [{ field: CALL2_DATE_FIELD, type: "date" }],
    openPredicate: CALL2_OPEN_PREDICATE,
  },
  countryOf: ["account", `user:${CALL2_REP_FIELD}`, "user:OwnerId"],
  // §6.2 list + multichannel_activity for the pass-2 `cobrowse_mc_activity__v`
  // reference (edge removed by the selfRef, CONTRACTS §3.1).
  dependsOn: [
    "account",
    "user",
    "address",
    "child_account",
    "product",
    "em_event",
    "medical_event",
    "medical_inquiry",
    "account_plan",
    "territory",
    "multichannel_activity",
  ],
  selfRefs: [
    {
      target: "error_reference_call__v",
      source: "Error_Reference_Call_vod__c",
    },
    {
      target: "cobrowse_mc_activity__v",
      source: "Cobrowse_MC_Activity_vod__c",
      objectKey: "multichannel_activity",
    },
  ],
  partitionBy: { field: CALL2_PARENT_FIELD, order: ["null", "notNull"] },
  // expense amounts are currency fields → local_currency__sys (Block S)
  blockS: { currency: true },
  objectTypes: { ...CALL2_OBJECT_TYPES },
  states: { ...CALL2_STATES },
  fields: [
    // --- Block S overrides (§6.3.30 rows)
    {
      source: "Name",
      target: "name__v",
      transform: "text(128)",
      required: "Y",
      evidence: "UNV",
      disabledBy: "preserveName",
      notes: "may be system-managed → sent under migration mode",
    },
    {
      source: "OwnerId",
      target: "ownerid__v",
      transform: "refUser",
      required: "y?",
      evidence: "UNV",
      sourceType: "reference",
      notes: "queue owners → rep from User_vod__c, else migration user (§3.4)",
    },
    // --- status: business picklist + lifecycle state (migration mode)
    unv(CALL2_STATUS_FIELD, "call2_status__v", "picklist(call2.status)", {
      required: "Y",
      sourceType: "picklist",
      notes:
        "{Planned_vod, Saved_vod, Submitted_vod} → planned__v/saved__v/submitted__v; preflight re-points to status__v when that picklist carries the submitted-like values",
    }),
    unv(CALL2_STATUS_FIELD, "state__v", "state(call2.state)", {
      required: "Y",
      notes:
        "lifecycle state when available_lifecycles is non-empty (preflight drops the row otherwise); migration mode; names [UNV]",
    }),
    // --- dates
    unv(CALL2_DATE_FIELD, "call_date__v", "date", {
      required: "Y",
      sourceType: "date",
      notes:
        "scope field; never recomputed from the datetime (device-local derivation)",
    }),
    unv("Call_Datetime_vod__c", "call_datetime__v", "datetime", {
      required: "y?",
      sourceType: "datetime",
    }),
    // --- who
    unv(CALL2_ACCOUNT_FIELD, "account__v", "ref(account)", {
      required: "y?",
      sourceType: "reference",
      notes:
        "required unless attendee row of type User/Contact — the target metadata decides (y?)",
    }),
    {
      source: CALL2_CONTACT_FIELD,
      target: "account__v.contact",
      transform: "custom(contactRef)",
      required: "-",
      evidence: "UNV",
      sourceType: "reference",
      notes:
        "dropped with CONTACT_REF_DROPPED unless the id map carries a person account for the contact (objects.account.contactToPersonAccount, §3.4); emits into account__v",
    },
    unv(CALL2_REP_FIELD, "user__v", "refUser", {
      required: "y?",
      sourceType: "reference",
      notes: "the rep; business user lookup → objects.call2.unmappedUserPolicy",
    }),
    // --- group call structure
    unv(CALL2_PARENT_FIELD, "parent_call__v", "ref(call2)", {
      sourceType: "reference",
      notes:
        "parents loaded first (load.partitionBy); §6.1 step 16 pass-2 patch is the fallback when partitions cannot be ordered",
    }),
    unv("Parent_Call_Mobile_ID_vod__c", "parent_call_mobile_id__v", "copy", {
      sourceType: "string",
    }),
    unv("Child_Account_vod__c", "child_account__v", "ref(child_account)", {
      sourceType: "reference",
    }),
    unv("Child_Account_Id_vod__c", "child_account_id__v", "copy", {
      sourceType: "string",
    }),
    // --- location
    unv("Location_Name_vod__c", "location_name__v", "ref(account)", {
      sourceType: "reference",
    }),
    unv("Location_Id_vod__c", "location_id__v", "copy", {
      sourceType: "string",
    }),
    unv("Location_vod__c", "location__v", "text(128)"),
    unv("Ship_To_Location_vod__c", "ship_to_location__v", "ref(account)", {
      sourceType: "reference",
    }),
    unv("Ship_To_Address_vod__c", "ship_to_address__v", "ref(address)", {
      sourceType: "reference",
    }),
    unv("Parent_Address_vod__c", "parent_address__v", "ref(address)", {
      sourceType: "reference",
    }),
    unv("DEA_Address_vod__c", "dea_address__v", "ref(address)", {
      sourceType: "reference",
    }),
    // --- address text snapshot (PDMA, never recomputed)
    unv("Address_vod__c", "address__v", "custom(addressSnapshot)", {
      sourceType: "textarea",
      notes:
        "text snapshot (500) — verify type; if the target is an Object the value is omitted and counted (CALL2_ADDRESS_TARGET_IS_OBJECT)",
    }),
    unv("Address_Line_1_vod__c", "address_line_1__v", "text", {
      notes: "PDMA snapshot — verbatim",
    }),
    unv("Address_Line_2_vod__c", "address_line_2__v", "text", {
      notes: "PDMA snapshot — verbatim",
    }),
    unv("City_vod__c", "city__v", "text", {
      notes: "PDMA snapshot — verbatim",
    }),
    unv("State_vod__c", "state_province__v", "text(10)", {
      notes:
        "PDMA snapshot; spec §6.3.30 writes state__v, which is the lifecycle field on a lifecycled target — state_province__v per the §6.0.2 exception, re-point per country",
    }),
    unv("Zip_vod__c", "zip__v", "text", {
      notes: "PDMA snapshot — verbatim",
    }),
    unv("Zip_4_vod__c", "zip_4__v", "text", {
      notes: "PDMA snapshot — verbatim",
    }),
    // --- territory / type / channel / attendee type
    unv("Territory_vod__c", "territory__v", "territoryRef", {
      sourceType: "string",
      notes: "by name; text when the target is a String (text 100)",
    }),
    unv("Call_Type_vod__c", "call_type__v", "picklist(call2.callType)", {
      sourceType: "picklist",
      enabledBy: "loadCallType",
      notes:
        "system-maintained (Detail Only, Detail with Sample, Group Detail, …); skipped unless objects.call2.loadCallType — Vault derives it otherwise; plain-English values → validate",
    }),
    unv(
      "Call_Channel_vod__c",
      "call_channel__v",
      "picklist(call2.callChannel)",
      {
        sourceType: "picklist",
        countryConfigurable: true,
        optionalSource: true,
        notes: "newer field {Face_to_face_vod, Phone_vod, Video_vod, …}",
      },
    ),
    unv(
      "Attendee_Type_vod__c",
      "attendee_type__v",
      "picklist(call2.attendeeType)",
      {
        sourceType: "picklist",
        notes:
          "{Group_Account_vod, Contact_vod, Person_Account_vod, User_vod, Event_vod, Business_Account_vod}",
      },
    ),
    // --- linked objects
    unv("EM_Event_vod__c", "em_event__v", "ref(em_event)", {
      sourceType: "reference",
    }),
    unv("Medical_Event_vod__c", "medical_event__v", "ref(medical_event)", {
      sourceType: "reference",
    }),
    unv(
      "Medical_Inquiry_vod__c",
      "medical_inquiry__v",
      "ref(medical_inquiry)",
      {
        sourceType: "reference",
        notes:
          "direct: medical_inquiry defers its call2__v to pass 2, so inquiries precede calls (§6.1 steps 15/16)",
      },
    ),
    unv("Account_Plan_vod__c", "account_plan__v", "ref(account_plan)", {
      sourceType: "reference",
    }),
    // --- out of v1 / cyclic
    unv("Remote_Meeting_vod__c", "remote_meeting__v", "custom(outOfScopeRef)", {
      required: "-",
      sourceType: "reference",
      notes:
        "ref → Remote_Meeting_vod__c is out of v1: omitted and counted (OUT_OF_SCOPE_REF_DROPPED, §6.2.1)",
    }),
    unv("Suggestion_vod__c", "suggestion__v", "custom(outOfScopeRef)", {
      required: "-",
      sourceType: "reference",
      notes:
        "ref → Suggestion_vod__c is out of v1: omitted and counted (OUT_OF_SCOPE_REF_DROPPED, §6.2.1)",
    }),
    unv(
      "Cobrowse_MC_Activity_vod__c",
      "cobrowse_mc_activity__v",
      "ref(multichannel_activity) secondPass",
      {
        sourceType: "reference",
        notes:
          "cyclic with multichannel_activity (step 22) — omitted in pass 1, patched after the activities",
      },
    ),
    unv(
      "Supervising_Physician_vod__c",
      "supervising_physician__v",
      "custom(outOfScopeRef)",
      {
        required: "-",
        sourceType: "reference",
        notes:
          "ref → Account_Authorization_vod__c is out of v1: omitted and counted (OUT_OF_SCOPE_REF_DROPPED)",
      },
    ),
    // --- error reference / assignment
    unv(
      "Error_Reference_Call_vod__c",
      "error_reference_call__v",
      "ref(call2) secondPass",
      {
        sourceType: "reference",
        notes: "self reference — patched after step 16 (§6.1)",
      },
    ),
    unv("Assigner_vod__c", "assigner__v", "refUser", {
      sourceType: "reference",
    }),
    unv("Assignment_Datetime_vod__c", "assignment_datetime__v", "datetime", {
      sourceType: "datetime",
    }),
    // --- product priorities
    ...[1, 2, 3, 4, 5].map((n) =>
      unv(
        `Product_Priority_${n}_vod__c`,
        `product_priority_${n}__v`,
        "ref(product)",
        { sourceType: "reference" },
      ),
    ),
    // --- signature (PDMA; US overlay makes the blob required)
    {
      source: "Signature_vod__c",
      target: "signature__v",
      transform: `deferredBlob(${CALL2_SIGNATURE_BLOB})`,
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      blobName: CALL2_SIGNATURE_BLOB,
      notes:
        "base64 PNG — blob pass (§8.6); objects.call2.blobs.signature (US: required)",
    },
    unv("Signature_Date_vod__c", "signature_date__v", "datetime", {
      ...pdma(),
      sourceType: "datetime",
    }),
    {
      source: "Signature_Page_Image_vod__c",
      target: "signature_page_image__v",
      transform: `deferredBlob(${CALL2_SIGNATURE_PAGE_IMAGE_BLOB})`,
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      blobName: CALL2_SIGNATURE_PAGE_IMAGE_BLOB,
      optionalSource: true,
      notes: "blob pass (§8.6); objects.call2.blobs.signaturePageImage",
    },
    unv("Signature_Timestamp_vod__c", "signature_timestamp__v", "number", {
      ...pdma(),
      sourceType: "double",
    }),
    unv(
      "Signature_Location_Latitude_vod__c",
      "signature_location_latitude__v",
      "number",
      { ...pdma(), sourceType: "double" },
    ),
    unv(
      "Signature_Location_Longitude_vod__c",
      "signature_location_longitude__v",
      "number",
      { ...pdma(), sourceType: "double" },
    ),
    unv(
      "Location_Services_Status_vod__c",
      "location_services_status__v",
      "text",
      pdma(),
    ),
    // --- notes / comments
    unv("Next_Call_Notes_vod__c", "next_call_notes__v", "longtext", {
      sourceType: "textarea",
    }),
    unv("Pre_Call_Notes_vod__c", "pre_call_notes__v", "longtext", {
      sourceType: "textarea",
    }),
    unv("Call_Comments_vod__c", "call_comments__v", "longtext", {
      sourceType: "textarea",
      notes: "32000",
    }),
    // --- trigger-maintained text fields, loaded verbatim under NoTriggers
    unv("Detailed_Products_vod__c", "detailed_products__v", "longtext", {
      sourceType: "textarea",
      notes: "`;`-separated product names — verbatim",
    }),
    unv("Presentations_vod__c", "presentations__v", "longtext", {
      sourceType: "textarea",
    }),
    unv("Add_Detail_vod__c", "add_detail__v", "text"),
    unv("Add_Key_Message_vod__c", "add_key_message__v", "text"),
    unv("Allowed_Products_vod__c", "allowed_products__v", "longtext", {
      sourceType: "textarea",
    }),
    unv("Attendee_list_vod__c", "attendee_list__v", "longtext", {
      sourceType: "textarea",
    }),
    unv("Attendees_vod__c", "attendees__v", "text"),
    unv("Total_Attendee_vod__c", "total_attendee__v", "number", {
      sourceType: "double",
    }),
    unv("Duration_vod__c", "duration__v", "number", { sourceType: "double" }),
    unv("Subject_vod__c", "subject__v", "text(128)"),
    // --- flags
    unv("Is_Sampled_Call_vod__c", "is_sampled_call__v", "bool", {
      sourceType: "boolean",
    }),
    {
      source: "CLM_vod__c",
      target: "clm__v",
      transform: "bool",
      required: "n",
      evidence: "DOC",
      sourceType: "boolean",
    },
    unv("Submitted_By_Mobile_vod__c", "submitted_by_mobile__v", "bool", {
      sourceType: "boolean",
    }),
    unv("Request_Receipt_vod__c", "request_receipt__v", "bool", {
      sourceType: "boolean",
    }),
    unv("No_Disbursement_vod__c", "no_disbursement__v", "bool", {
      sourceType: "boolean",
    }),
    unv("Incurred_Expense_vod__c", "incurred_expense__v", "bool", {
      sourceType: "boolean",
    }),
    unv("Receipt_Email_vod__c", "receipt_email__v", "text"),
    // --- licence / sample snapshot (PDMA evidence; US)
    ...CALL2_LICENCE_SNAPSHOT_FIELDS.map((f) =>
      unv(f.source, f.target, f.transform, {
        ...pdma(),
        unverifiedSource: f.unverifiedSource,
      }),
    ),
    ...CALL2_SHIP_SNAPSHOT_FIELDS.map((f) =>
      unv(f.source, f.target, f.transform, {
        ...pdma(),
        unverifiedSource: true,
        optionalSource: true,
        notes: "Ship_* wildcard of §6.3.30 — name [UNVERIFIED-SOURCE]; PDMA",
      }),
    ),
    // --- expense
    unv("Expense_Amount_vod__c", "expense_amount__v", "number", {
      sourceType: "currency",
      notes: "currency field — CurrencyIsoCode → local_currency__sys (Block S)",
    }),
    unv(
      "Expense_Attendee_Type_vod__c",
      "expense_attendee_type__v",
      "picklist(call2.expenseAttendeeType)",
      { sourceType: "picklist", notes: "values by the rename rule" },
    ),
    unv(
      "Expense_Post_Status_vod__c",
      "expense_post_status__v",
      "picklist(call2.expensePostStatus)",
      { sourceType: "picklist", notes: "values by the rename rule" },
    ),
    unv(
      "Expense_System_External_ID_vod__c",
      "expense_system_external_id__v",
      "copy",
      { sourceType: "string" },
    ),
    unv("Concur_Report_Name_vod__c", "concur_report_name__v", "text"),
    unv(
      "Total_Expense_Attendees_Count_vod__c",
      "total_expense_attendees_count__v",
      "number",
      { sourceType: "double" },
    ),
    unv("Entity_Reference_Id_vod__c", "entity_reference_id__v", "copy", {
      sourceType: "string",
    }),
    // --- device / geo (objects.call2.loadDeviceFields, default false)
    ...CALL2_DEVICE_FIELDS.map((f) =>
      unv(f.source, f.target, f.transform, {
        enabledBy: "loadDeviceFields",
        unverifiedSource: true,
        optionalSource: true,
        notes:
          "device/geo wildcard of §6.3.30 — loaded only with objects.call2.loadDeviceFields",
      }),
    ),
    // --- skipped formulas and layout markers
    {
      source: "Is_Parent_Call_vod__c",
      target: "is_parent_call__v",
      transform: "skip",
      required: "-",
      notes: "formula",
    },
    {
      source: "Entity_Display_Name_vod__c",
      target: "entity_display_name__v",
      transform: "skip",
      required: "-",
      notes: "formula",
    },
    {
      source: "Ship_To_Address_Text_vod__c",
      target: "ship_to_address_text__v",
      transform: "skip",
      required: "-",
      notes: "formula",
    },
    {
      source: "Signature_on_Sync_vod__c",
      target: "signature_on_sync__v",
      transform: "skip",
      required: "-",
      notes: "formula",
    },
    ...CALL2_ZVOD_FIELDS.map(
      (source): RowInput => ({
        source,
        target: source
          .replace(/__c$/, "")
          .replace(/_vod$/, "")
          .toLowerCase()
          .concat("__v"),
        transform: "skip",
        required: "-",
        notes: "zvod_* layout marker — never loaded (§6.0.2)",
      }),
    ),
  ],
  picklists: {
    "call2.status": { ...CALL2_STATUS },
    "call2.callType": { ...CALL2_CALL_TYPES },
    "call2.callChannel": { ...CALL2_CALL_CHANNELS },
    "call2.attendeeType": { ...CALL2_ATTENDEE_TYPES },
    "call2.expenseAttendeeType": {},
    "call2.expensePostStatus": {},
  },
  deletePolicy: "ignore",
  inactivate: [],
  createPolicy: "create",
  load: { noTriggers: true },
  match: CALL2_MATCH_RULES,
  blobs: {
    [CALL2_SIGNATURE_BLOB]: "optional",
    [CALL2_SIGNATURE_PAGE_IMAGE_BLOB]: "optional",
  },
  custom: { contactRef, addressSnapshot, outOfScopeRef },
  optionDefaults: { loadCallType: false, loadDeviceFields: false },
  notes:
    "Calls (§6.3.30): 2y on Call_Date_vod__c or planned; country of account → rep → owner; parents before attendee rows (partitionBy Parent_Call_vod__c); submitted calls in migration mode with noTriggers; error_reference_call__v and cobrowse_mc_activity__v patched in pass 2; signature blobs (US required); deletes ignored (§4.4).",
});
