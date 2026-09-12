/**
 * `event_attendee` — `Event_Attendee_vod__c` → `event_attendee__v`
 * `[OBS object]` (spec §6.3.27, §6.1 step 13, §6.2, §3.3, §3.5, §4.4).
 *
 * Master-detail child of `medical_event` (no `OwnerId`): scoped through the
 * parent's `Start_Date_vod__c` (`via-parent`, 2y), attributed to the parent's
 * country (`parent:medical_event`), loaded after the medical event with
 * `noTriggers = true`; deleted attendees are ignored on the target (§4.4).
 *
 * `Account_vod__c` / `User_vod__c` / `Contact_vod__c` are the three attendee
 * identities: account and user map to `account__v` / `user__v`; the contact
 * reference is **dropped** with a `CONTACT_REF_DROPPED` count (§3.4) by
 * `custom(contactRefDropped)` — unless the account module has aliased the
 * contact id to its person account in the id map (`Account.PersonContactId`
 * bridge, `objects.account.contactToPersonAccount`), in which case the
 * attendee lands on that account when `Account_vod__c` is empty. The row is
 * declared under the dotted selector target `account__v.contact` so the
 * column is selected and preflight validates it against `account__v`.
 *
 * `Status_vod__c` mixes plain-English and `_vod` values, so the crosswalk to
 * `event_attendee_status__v` is explicit (`EVENT_ATTENDEE_STATUS`); the
 * spec's alternative target `status__v` (platform status repurposed) is an
 * overlay decision. `Signature_vod__c` is a blob (`signature`, optional by
 * default; the US overlay makes it required).
 *
 * Name / contact / address / cobrowse columns are listed in the spec by
 * family only: their source names are carried as `[UNVERIFIED-SOURCE]` +
 * `optionalSource` rows (describe miss = `info`, row dropped).
 */
import { isContactId, to18 } from "../../transform/ids";
import type { CustomTransformFn, TransformResult } from "../../types";
import { defineObject, type ObjectModuleInput } from "../types";

/** Master-detail parent (scope + country). */
export const EVENT_ATTENDEE_PARENT_FIELD = "Medical_Event_vod__c";
export const EVENT_ATTENDEE_PARENT_SCOPE_PATH =
  "Medical_Event_vod__r.Start_Date_vod__c";
export const EVENT_ATTENDEE_ACCOUNT_FIELD = "Account_vod__c";
export const EVENT_ATTENDEE_USER_FIELD = "User_vod__c";
export const EVENT_ATTENDEE_CONTACT_FIELD = "Contact_vod__c";

/** Diagnostic code counted when a contact attendee is dropped (§3.4). */
export const CONTACT_REF_DROPPED_CODE = "CONTACT_REF_DROPPED";
/** Diagnostic code counted when a contact resolved to its person account. */
export const CONTACT_TO_PERSON_ACCOUNT_CODE = "CONTACT_TO_PERSON_ACCOUNT";

/** `Status_vod__c` → `event_attendee_status__v` (mixed naming, explicit crosswalk; `[UNV]` values). */
export const EVENT_ATTENDEE_STATUS: Record<string, string> = {
  Proposed: "proposed__v",
  Invited: "invited__v",
  Accepted: "accepted__v",
  Rejected: "rejected__v",
  Attended: "attended__v",
  "Did Not Attend": "did_not_attend__v",
  "HQ Rejected": "hq_rejected__v",
  Confirmed: "confirmed__v",
  Signed_vod: "signed__v",
  Cleared_Signature_vod: "cleared_signature__v",
};

/** `Position_vod__c` → `position__v` (`[UNV]` values). */
export const EVENT_ATTENDEE_POSITION: Record<string, string> = {
  Award_Winner_vod: "award_winner__v",
  Chair_Person_vod: "chair_person__v",
  Organizer_vod: "organizer__v",
  Participant_vod: "participant__v",
  Speaker_vod: "speaker__v",
};

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

/**
 * `custom(contactRefDropped)`: `Contact_vod__c` has no Vault equivalent
 * (§3.4). When the id map knows the contact id under `account` (person
 * account bridge) and the row has no `Account_vod__c`, the attendee is
 * re-pointed to that account (`account__v`, counted
 * `CONTACT_TO_PERSON_ACCOUNT`); otherwise the reference is omitted and
 * counted `CONTACT_REF_DROPPED` (non-fatal).
 */
export const contactRefDropped: CustomTransformFn = (
  value,
  row,
  ctx,
): TransformResult | undefined => {
  if (isEmpty(value)) return undefined;
  const raw = String(value).trim();
  if (!isContactId(raw))
    return {
      omit: true,
      diagnostic: {
        kind: "invalid_value",
        field: EVENT_ATTENDEE_CONTACT_FIELD,
        code: "NOT_A_CONTACT_ID",
        value: raw,
      },
    };
  const id = to18(raw);
  if (
    isEmpty(row[EVENT_ATTENDEE_ACCOUNT_FIELD]) &&
    ctx.ids.resolve("account", id) !== undefined
  )
    return {
      value: { $fk: { object: "account", sfdcId: id } },
      targetField: "account__v",
      diagnostic: {
        kind: "custom",
        field: "account__v",
        code: CONTACT_TO_PERSON_ACCOUNT_CODE,
        value: id,
        detail: "contact attendee re-pointed to its person account (§3.4)",
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

/** Rows whose source name is inferred from the spec's family description (§6.3.27). */
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

export const event_attendee = defineObject({
  key: "event_attendee",
  source: "Event_Attendee_vod__c",
  target: "event_attendee__v",
  targetEvidence: "OBS",
  scope: {
    kind: "via-parent",
    parentKey: "medical_event",
    parentField: EVENT_ATTENDEE_PARENT_SCOPE_PATH,
    type: "date",
  },
  countryOf: `parent:medical_event:${EVENT_ATTENDEE_PARENT_FIELD}`,
  dependsOn: [
    "medical_event",
    "account",
    "user",
    "em_attendee",
    "em_event_speaker",
  ],
  // master-detail child: no OwnerId; expense amounts → currency in multi-currency orgs
  blockS: { ownerId: false, currency: true },
  fields: [
    // --- §6.3.27 rows
    unv(EVENT_ATTENDEE_PARENT_FIELD, "medical_event__v", "ref(medical_event)", {
      required: "Y",
      sourceType: "reference",
      notes: "master-detail; scope + country parent",
    }),
    unv(EVENT_ATTENDEE_ACCOUNT_FIELD, "account__v", "ref(account)", {
      required: "y?",
      sourceType: "reference",
    }),
    unv(EVENT_ATTENDEE_USER_FIELD, "user__v", "refUser", {
      required: "y?",
      sourceType: "reference",
      notes:
        "business user field — objects.event_attendee.unmappedUserPolicy (§3.5)",
    }),
    unv(
      EVENT_ATTENDEE_CONTACT_FIELD,
      "account__v.contact",
      "custom(contactRefDropped)",
      {
        sourceType: "reference",
        optionalSource: true,
        notes:
          "dropped with CONTACT_REF_DROPPED (§3.4) unless the contact id is aliased to a person account in the id map; dotted target = account__v for preflight",
      },
    ),
    unv("EM_Attendee_vod__c", "em_attendee__v", "ref(em_attendee)", {
      sourceType: "reference",
      optionalSource: true,
    }),
    unv(
      "EM_Event_Speaker_vod__c",
      "em_event_speaker__v",
      "ref(em_event_speaker)",
      { sourceType: "reference", optionalSource: true },
    ),
    unv(
      "Status_vod__c",
      "event_attendee_status__v",
      "picklist(event_attendee.status)",
      {
        sourceType: "picklist",
        countryConfigurable: true,
        notes:
          "mixed naming — explicit crosswalk EVENT_ATTENDEE_STATUS; alternative target status__v when the platform status is repurposed (overlay)",
      },
    ),
    unv("Position_vod__c", "position__v", "picklist(event_attendee.position)", {
      sourceType: "picklist",
      countryConfigurable: true,
    }),
    unv(
      "Walk_In_Status_vod__c",
      "walk_in_status__v",
      "picklist(event_attendee.walkInStatus)",
      { sourceType: "picklist", optionalSource: true },
    ),
    unv("Start_Date_vod__c", "start_date__v", "date", {
      sourceType: "date",
      optionalSource: true,
    }),
    unv("Talk_Title_vod__c", "talk_title__v", "text", { optionalSource: true }),
    // --- name / contact / address fields (family named in §6.3.27; source names inferred)
    inferred("First_Name_vod__c", "first_name__v", "text"),
    inferred("Last_Name_vod__c", "last_name__v", "text"),
    inferred("Organization_vod__c", "organization__v", "text"),
    inferred("Email_vod__c", "email__v", "text"),
    inferred("Phone_vod__c", "phone__v", "text"),
    inferred("Address_Line_1_vod__c", "address_line_1__v", "text"),
    inferred("Address_Line_2_vod__c", "address_line_2__v", "text"),
    inferred("City_vod__c", "city__v", "text"),
    inferred("State_vod__c", "state_province__v", "text", {
      notes:
        "walk-in address state; target follows the §6.0.2 exception (state__v is the lifecycle field elsewhere)",
    }),
    inferred("Zip_vod__c", "zip__v", "text", {
      notes: "zip__v per the em_attendee exception (§6.0.2)",
    }),
    inferred("Country_vod__c", "country__v", "text", {
      notes: "walk-in country text; not the country crosswalk",
    }),
    // --- expense fields
    unv("Expense_Amount_vod__c", "expense_amount__v", "number", {
      sourceType: "currency",
      optionalSource: true,
    }),
    unv(
      "Expense_Post_Status_vod__c",
      "expense_post_status__v",
      "picklist(event_attendee.expensePostStatus)",
      { sourceType: "picklist", optionalSource: true },
    ),
    unv(
      "Expense_System_External_ID_vod__c",
      "expense_system_external_id__v",
      "text",
      { optionalSource: true },
    ),
    // --- cobrowse fields (family named in §6.3.27; source names inferred)
    inferred(
      "Cobrowse_Attendee_URL_vod__c",
      "cobrowse_attendee_url__v",
      "text",
    ),
    inferred("Cobrowse_Meeting_ID_vod__c", "cobrowse_meeting_id__v", "text"),
    // --- signature
    {
      source: "Signature_vod__c",
      target: "signature__v",
      transform: "deferredBlob(signature)",
      required: "n",
      evidence: "UNV",
      blobName: "signature",
      optionalSource: true,
      notes: "blob pass (§8.6); policy objects.event_attendee.blobs.signature",
    },
    unv("Signature_Datetime_vod__c", "signature_datetime__v", "datetime", {
      sourceType: "datetime",
      optionalSource: true,
    }),
  ],
  picklists: {
    "event_attendee.status": { ...EVENT_ATTENDEE_STATUS },
    "event_attendee.position": { ...EVENT_ATTENDEE_POSITION },
    "event_attendee.walkInStatus": {},
    "event_attendee.expensePostStatus": {},
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
  blobs: { signature: "optional" },
  custom: { contactRefDropped },
  notes:
    "Attendees of legacy medical events (§6.3.27): master-detail child scoped/attributed through medical_event; contact attendees dropped with CONTACT_REF_DROPPED (§3.4); explicit status crosswalk; signature blob; deletes ignored (§4.4).",
});
