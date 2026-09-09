/**
 * `em_attendee` — `EM_Attendee_vod__c` → `em_attendee__v` `[OBS]`
 * (spec §6.3.23, §6.1 step 12, §6.2, §3.3, §3.5, §4.4).
 *
 * Transfer-of-value family child of `em_event`: scoped through the parent's
 * `Start_Time_vod__c` (`via-parent`, widened by `scope.tovRetentionMonths`),
 * attributed to the parent's country (`parent:em_event`), loaded with
 * `noTriggers = true`; deleted rows are ignored on the target (§4.4).
 *
 * Exactly one of `Account_vod__c` / `User_vod__c` / `Contact_vod__c` is set:
 * `account__v ← ref(account)`, `user__v ← refUser`, and the contact is
 * dropped with `CONTACT_REF_DROPPED` (`custom(contactAttendee)`) unless the
 * id map already carries a person-account entry for the contact id
 * (`objects.account.contactToPersonAccount`, §3.4). `attendee_type__v` is
 * set explicitly by `custom(attendeeType)` from the source formula value
 * (crosswalk `em_attendee.attendeeType`), else derived from whichever
 * reference is set.
 *
 * Object type `Attendee_vod → attendee__v` (UNV). Business status →
 * `em_attendee_status__v` (pattern field `[UNV]`; values `[OBS invited__v]`).
 * Signature image is a blob (`deferredBlob(signature)`, policy
 * `objects.em_attendee.blobs.signature`, `optional` by default; the US
 * overlay may set `required`).
 */
import { crosswalkPicklist } from "../../transform/registry";
import { isContactId, isSfdcId, to18 } from "../../transform/ids";
import type {
  CustomTransformFn,
  SourceRow,
  TransformResult,
} from "../../types";
import { defineObject, type ObjectModuleInput } from "../types";

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

/** RecordType DeveloperName → object type (`[UNV]`). */
export const EM_ATTENDEE_OBJECT_TYPES: Record<string, string> = {
  Attendee_vod: "attendee__v",
};

/** `Status_vod__c` → `em_attendee_status__v` (`[OBS invited__v]`, rest by pattern). */
export const EM_ATTENDEE_STATUS: Record<string, string> = {
  Nominated_vod: "nominated__v",
  Approved_vod: "approved__v",
  Invited_vod: "invited__v",
  Accepted_vod: "accepted__v",
  Rejected_vod: "rejected__v",
  Attended_vod: "attended__v",
  Signed_vod: "signed__v",
  Cleared_Signature_vod: "cleared_signature__v",
  Cancelled_vod: "cancelled__v",
};

/** `Walk_In_Status_vod__c` → `walk_in_status__v` (`[OBS]` source values). */
export const EM_ATTENDEE_WALK_IN_STATUS: Record<string, string> = {
  Needs_Reconciliation_vod: "needs_reconciliation__v",
  Reconciled_To_Existing_Account_vod: "reconciled_to_existing_account__v",
  Reconciled_To_Existing_User_vod: "reconciled_to_existing_user__v",
  Reconciled_To_New_Account_vod: "reconciled_to_new_account__v",
  Dismissed_vod: "dismissed__v",
};

/** Source formula value → `attendee_type__v` (`[UNV]` target values). */
export const EM_ATTENDEE_TYPE: Record<string, string> = {
  Person_Account_vod: "person_account__v",
  Business_Account_vod: "business_account__v",
  Group_Account_vod: "business_account__v",
  User_vod: "user__v",
  Contact_vod: "contact__v",
};

export const ATTENDEE_TYPE_MAP_KEY = "em_attendee.attendeeType";
/** Blob name (`objects.em_attendee.blobs.signature`). */
export const EM_ATTENDEE_SIGNATURE_BLOB = "signature";
/** Opt-in selector column (`objects.em_attendee.personAccountTypeLookup`). */
export const ACCOUNT_IS_PERSON_SOURCE = "Account_vod__r.IsPersonAccount";
export const CONTACT_REF_DROPPED_CODE = "CONTACT_REF_DROPPED";
export const CONTACT_MAPPED_TO_PERSON_ACCOUNT_CODE =
  "CONTACT_MAPPED_TO_PERSON_ACCOUNT";

// ---------------------------------------------------------------------------
// helpers (pure)
// ---------------------------------------------------------------------------

export function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

function truthy(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    return t === "true" || t === "1" || t === "yes";
  }
  return v === 1;
}

/**
 * Attendee type derived from the references (`User_vod__c` → `User_vod`,
 * `Contact_vod__c` → `Contact_vod`, `Account_vod__c` → person/business by
 * `Account_vod__r.IsPersonAccount` when selected, else `Business_Account_vod`).
 * Returns the *source-form* value so the same crosswalk applies.
 */
export function deriveAttendeeSourceType(row: SourceRow): string | undefined {
  if (!isEmpty(row.User_vod__c)) return "User_vod";
  if (!isEmpty(row.Account_vod__c)) {
    const flag = row[ACCOUNT_IS_PERSON_SOURCE];
    if (isEmpty(flag)) return "Business_Account_vod";
    return truthy(flag) ? "Person_Account_vod" : "Business_Account_vod";
  }
  if (!isEmpty(row.Contact_vod__c)) return "Contact_vod";
  return undefined;
}

/**
 * `custom(attendeeType)`: `attendee_type__v` from the formula value
 * (`Attendee_Type_vod__c`) or, when empty, from the references; crosswalked
 * through `em_attendee.attendeeType` (country overlay → module defaults →
 * derivation → target validation → onUnmapped policy). Selector rows emit
 * nothing.
 */
export const attendeeType: CustomTransformFn = (
  value,
  row,
  ctx,
): TransformResult | undefined => {
  if (ctx.field.target !== "attendee_type__v") return undefined;
  const source = isEmpty(value)
    ? deriveAttendeeSourceType(row)
    : String(value).trim();
  if (!source) return undefined;
  const r = crosswalkPicklist(ctx, ATTENDEE_TYPE_MAP_KEY, source);
  if (r.skip || r.value === undefined)
    return { omit: true, diagnostic: r.diagnostic };
  return { value: r.value, diagnostic: r.diagnostic };
};

/**
 * `custom(contactAttendee)`: `Contact_vod__c` → `account__v` only when the
 * id map already knows the contact as a person account (§3.4
 * `contactToPersonAccount`); otherwise the reference is dropped and counted
 * (`CONTACT_REF_DROPPED`). Silent when an account/user reference is set.
 */
export const contactAttendee: CustomTransformFn = (
  value,
  row,
  ctx,
): TransformResult | undefined => {
  if (isEmpty(value)) return undefined;
  if (!isEmpty(row.Account_vod__c) || !isEmpty(row.User_vod__c))
    return undefined;
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

// ---------------------------------------------------------------------------
// module
// ---------------------------------------------------------------------------

type RowInput = NonNullable<ObjectModuleInput["fields"]>[number];

const text = (
  source: string,
  target: string,
  extra: Partial<RowInput> = {},
): RowInput => ({
  source,
  target,
  transform: "text",
  required: "n",
  evidence: "OBS",
  ...extra,
});

export const em_attendee = defineObject({
  key: "em_attendee",
  source: "EM_Attendee_vod__c",
  target: "em_attendee__v",
  targetEvidence: "OBS",
  scope: {
    kind: "via-parent",
    parentKey: "em_event",
    parentField: "Event_vod__r.Start_Time_vod__c",
    type: "datetime",
    retentionFamily: "tov",
  },
  countryOf: "parent:em_event:Event_vod__c",
  // §6.2 lists em_event, account, user; product/em_catalog added for the
  // "newer" ref(product)/ref(em_catalog) rows of §6.3.23 (both load earlier).
  dependsOn: ["em_event", "account", "user", "product", "em_catalog"],
  objectTypes: { ...EM_ATTENDEE_OBJECT_TYPES },
  fields: [
    // --- parent + exactly one of account / user / contact
    {
      source: "Event_vod__c",
      target: "event__v",
      transform: "ref(em_event)",
      required: "Y",
      evidence: "OBS",
      sourceType: "reference",
    },
    {
      source: "Account_vod__c",
      target: "account__v",
      transform: "ref(account)",
      required: "y?",
      evidence: "OBS",
      sourceType: "reference",
      notes: "exactly one of Account_vod__c / User_vod__c / Contact_vod__c",
    },
    {
      source: "User_vod__c",
      target: "user__v",
      transform: "refUser",
      required: "y?",
      evidence: "OBS",
      sourceType: "reference",
      notes:
        "business user lookup → objects.em_attendee.unmappedUserPolicy (§3.5)",
    },
    {
      source: "Contact_vod__c",
      target: "account__v.contact",
      transform: "custom(contactAttendee)",
      required: "n",
      evidence: "OBS",
      sourceType: "reference",
      notes:
        "dropped with CONTACT_REF_DROPPED unless the id map carries a person account for the contact (objects.account.contactToPersonAccount, §3.4); emits into account__v",
    },
    {
      source: "Attendee_Type_vod__c",
      target: "attendee_type__v",
      transform: "custom(attendeeType)",
      required: "y?",
      evidence: "OBS",
      notes:
        "formula in source; set explicitly: person_account__v / business_account__v / user__v / contact__v [UNV values]",
    },
    {
      source: ACCOUNT_IS_PERSON_SOURCE,
      target: "attendee_type__v.account",
      transform: "custom(attendeeType)",
      required: "n",
      evidence: "OBS",
      optionalSource: true,
      enabledBy: "personAccountTypeLookup",
      notes:
        "selector row (opt-in objects.em_attendee.personAccountTypeLookup — person accounts must be enabled in the org): person vs business when the formula is empty",
    },
    // --- names / contact details
    text("Attendee_Name_vod__c", "attendee_name__v"),
    text("First_Name_vod__c", "first_name__v"),
    text("Last_Name_vod__c", "last_name__v"),
    text("Title_vod__c", "title__v"),
    text("Email_vod__c", "email__v"),
    text("Phone_vod__c", "phone__v"),
    text("Address_Line_1_vod__c", "address_line_1__v"),
    text("Address_Line_2_vod__c", "address_line_2__v"),
    text("City_vod__c", "city__v"),
    text("Zip_vod__c", "zip__v", {
      notes:
        "Zip_vod__c → zip__v [OBS]; Postal_Code_vod__c → postal_code__v — never both from one source",
    }),
    // --- [UNV] targets, country-configurable
    text("Furigana_vod__c", "furigana__v", {
      evidence: "UNV",
      countryConfigurable: true,
    }),
    text("Credentials_vod__c", "credentials__v", {
      evidence: "UNV",
      countryConfigurable: true,
    }),
    text("Organization_vod__c", "organization__v", {
      evidence: "UNV",
      countryConfigurable: true,
    }),
    {
      source: "Meal_Preference_vod__c",
      target: "meal_preference__v",
      transform: "picklist(em_attendee.mealPreference)",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
    },
    {
      source: "Prescriber_vod__c",
      target: "prescriber__v",
      transform: "bool",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
    },
    text("State_vod__c", "state_province__v", {
      evidence: "UNV",
      countryConfigurable: true,
    }),
    {
      source: "Country_vod__c",
      target: "country__v",
      transform: "country(ref)",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      notes:
        "ref→Country_vod__c or ISO text; resolved through the country crosswalk",
    },
    // --- statuses
    {
      source: "Status_vod__c",
      target: "em_attendee_status__v",
      transform: "picklist(em_attendee.status)",
      required: "Y",
      evidence: "UNV",
      notes:
        "field by the §6.0.2 status pattern [UNV]; values [OBS invited__v]. Fallback: an overlay may retarget to status__v if that is the business status on this object",
    },
    {
      source: "Walk_In_Status_vod__c",
      target: "walk_in_status__v",
      transform: "picklist(em_attendee.walkInStatus)",
      required: "n",
      evidence: "OBS",
    },
    {
      source: "Online_Registration_Status_vod__c",
      target: "online_registration_status__v",
      transform: "picklist(em_attendee.onlineRegistrationStatus)",
      required: "n",
      evidence: "UNV",
    },
    {
      source: "RSVP_Status_vod__c",
      target: "rsvp_status__v",
      transform: "picklist(em_attendee.rsvpStatus)",
      required: "n",
      evidence: "OBS",
    },
    {
      source: "Did_Attend_vod__c",
      target: "did_attend__v",
      transform: "bool",
      required: "n",
      evidence: "OBS",
    },
    {
      source: "Meal_Opt_In_vod__c",
      target: "meal_opt_in__v",
      transform: "bool",
      required: "n",
      evidence: "OBS",
    },
    {
      source: "Meal_Consumed_vod__c",
      target: "meal_consumed__v",
      transform: "bool",
      required: "n",
      evidence: "OBS",
    },
    // --- times
    {
      source: "Start_Time_vod__c",
      target: "start_time__v",
      transform: "datetime",
      required: "n",
      evidence: "UNV",
      sourceType: "datetime",
    },
    {
      source: "End_Time_vod__c",
      target: "end_time__v",
      transform: "datetime",
      required: "n",
      evidence: "UNV",
      sourceType: "datetime",
    },
    // --- signature (blob pass §8.6)
    {
      source: "Signature_vod__c",
      target: "signature__v",
      transform: `deferredBlob(${EM_ATTENDEE_SIGNATURE_BLOB})`,
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      blobName: EM_ATTENDEE_SIGNATURE_BLOB,
      notes:
        "base64 PNG; objects.em_attendee.blobs.signature (US overlay: required)",
    },
    {
      source: "Signature_Datetime_vod__c",
      target: "signature_datetime__v",
      transform: "datetime",
      required: "n",
      evidence: "UNV",
      sourceType: "datetime",
    },
    text("Signee_vod__c", "signee__v", { evidence: "UNV" }),
    // --- external ids
    {
      source: "External_ID_vod__c",
      target: "external_id__v",
      transform: "copy",
      required: "n",
      evidence: "OBS",
      notes: "match key (§3.3)",
    },
    {
      source: "Stub_Mobile_Id_vod__c",
      target: "stub_mobile_id__v",
      transform: "copy",
      required: "n",
      evidence: "UNV",
      unverifiedSource: true,
      notes:
        "Stub_* family — further columns via objects.em_attendee.fields.add",
    },
    {
      source: "Stub_SFDC_Id_vod__c",
      target: "stub_sfdc_id__v",
      transform: "copy",
      required: "n",
      evidence: "UNV",
      unverifiedSource: true,
    },
    {
      source: "Vessel_Number_vod__c",
      target: "vessel_number__v",
      transform: "copy",
      required: "n",
      evidence: "UNV",
    },
    {
      source: "Walk_In_Reference_ID_vod__c",
      target: "walk_in_reference_id__v",
      transform: "copy",
      required: "n",
      evidence: "UNV",
    },
    {
      source: "Entity_Reference_Id_vod__c",
      target: "entity_reference_id__v",
      transform: "copy",
      required: "n",
      evidence: "UNV",
    },
    {
      source: "Registration_Disclaimer_vod__c",
      target: "registration_disclaimer__v",
      transform: "longtext",
      required: "n",
      evidence: "DOC",
      unverifiedSource: true,
      notes: "newer source",
    },
    // --- newer sources ([UNVERIFIED-SOURCE]; targets OBS) — loaded only when both exist
    {
      source: "HCP_vod__c",
      target: "hcp__v",
      transform: "bool",
      required: "n",
      evidence: "OBS",
      unverifiedSource: true,
    },
    {
      source: "Employed_vod__c",
      target: "employed__v",
      transform: "bool",
      required: "n",
      evidence: "OBS",
      unverifiedSource: true,
    },
    {
      source: "Profile_Type_vod__c",
      target: "profile_type__v",
      transform: "picklist(em_attendee.profileType)",
      required: "n",
      evidence: "OBS",
      unverifiedSource: true,
    },
    text("Postal_Code_vod__c", "postal_code__v", {
      unverifiedSource: true,
      notes: "distinct from zip__v (Zip_vod__c)",
    }),
    text("Address_vod__c", "address__v", { unverifiedSource: true }),
    {
      source: "Role_vod__c",
      target: "role__v",
      transform: "picklist(em_attendee.role)",
      required: "n",
      evidence: "OBS",
      unverifiedSource: true,
      notes: "some of these belong to speaker rows in the source docs",
    },
    {
      source: "Product_vod__c",
      target: "product__v",
      transform: "ref(product)",
      required: "n",
      evidence: "OBS",
      unverifiedSource: true,
      sourceType: "reference",
    },
    {
      source: "Topic_vod__c",
      target: "topic__v",
      transform: "ref(em_catalog)",
      required: "n",
      evidence: "OBS",
      unverifiedSource: true,
      sourceType: "reference",
    },
  ],
  picklists: {
    "em_attendee.status": { ...EM_ATTENDEE_STATUS },
    "em_attendee.walkInStatus": { ...EM_ATTENDEE_WALK_IN_STATUS },
    [ATTENDEE_TYPE_MAP_KEY]: { ...EM_ATTENDEE_TYPE },
    "em_attendee.mealPreference": {},
    "em_attendee.onlineRegistrationStatus": {},
    "em_attendee.rsvpStatus": {},
    "em_attendee.profileType": {},
    "em_attendee.role": {},
  },
  deletePolicy: "ignore",
  inactivate: [],
  createPolicy: "create",
  load: { noTriggers: true },
  match: [
    { method: "legacy_id" },
    {
      method: "external_id",
      keys: [{ target: "external_id__v", source: "External_ID_vod__c" }],
      evidence: "OBS",
    },
    {
      method: "mobile_id",
      keys: [{ target: "mobile_id__v", source: "Mobile_ID_vod__c" }],
    },
    {
      method: "natural_key",
      keys: [
        { target: "event__v", source: "Event_vod__c" },
        { target: "account__v", source: "Account_vod__c" },
        { target: "user__v", source: "User_vod__c" },
      ],
      notes: "(event__v, account__v | user__v) pair (§3.3), warning-level",
    },
  ],
  blobs: { [EM_ATTENDEE_SIGNATURE_BLOB]: "optional" },
  custom: { attendeeType, contactAttendee },
  optionDefaults: { personAccountTypeLookup: false },
  notes:
    "ToV family child of em_event (§6.3.23): via-parent scope on Event_vod__r.Start_Time_vod__c, parent's country, noTriggers, deleted rows ignored (§4.4). Exactly one of account__v/user__v; contacts dropped (CONTACT_REF_DROPPED) unless mapped to person accounts. Signature loaded in the blob pass.",
});
