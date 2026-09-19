/**
 * `em_event_speaker` — `EM_Event_Speaker_vod__c` → `em_event_speaker__v`
 * `[OBS]` (spec §6.3.24, §6.1 step 12, §6.2, §3.3, §3.5, §4.4).
 *
 * Transfer-of-value family child of `em_event`: scoped through the parent's
 * `Start_Time_vod__c` (`via-parent`, widened by `scope.tovRetentionMonths`),
 * attributed to the parent's country (`parent:em_event`), `noTriggers = true`,
 * deleted rows ignored on the target (§4.4).
 *
 * `speaker__v ← ref(em_speaker)` is the required reference; `account__v`
 * is a formula in the source (the speaker's account) and is written by
 * `custom(fromSpeakerAccount)` only when Vault metadata says the field is
 * editable — from the formula value when its column was selected, else from
 * the selected `Speaker_vod__r.Account_vod__c` column. Preflight drops
 * calculated sources, so the primary row is keyed on `Speaker_vod__c` and
 * both columns are *selector* rows (`account__v.formula`,
 * `account__v.speaker`) read from the row. Business status →
 * `em_event_speaker_status__v` (`[OBS]`, default value `invited__v`).
 * `Contract_vod__c` is out of v1 (`contract__v`, `CONTRACT_REF_DROPPED`,
 * §6.2.1). Speaker name formulas are skipped (Vault derives them).
 */
import { applyTransform } from "../../transform/registry";
import { isSfdcId, to18 } from "../../transform/ids";
import type { CustomTransformFn, TransformResult } from "../../types";
import { defineObject, type ObjectModuleInput } from "../types";

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

/** RecordType DeveloperName → object type (`[UNV]`). */
export const EM_EVENT_SPEAKER_OBJECT_TYPES: Record<string, string> = {
  Event_Speaker_vod: "event_speaker__v",
};

/** `Status_vod__c` → `em_event_speaker_status__v` (`[OBS]` invited__v; rest by pattern). */
export const EM_EVENT_SPEAKER_STATUS: Record<string, string> = {
  Invited_vod: "invited__v",
  Accepted_vod: "accepted__v",
  Rejected_vod: "rejected__v",
  Attended_vod: "attended__v",
  Signed_vod: "signed__v",
  Cancelled_vod: "cancelled__v",
};

/** Default status when the source is empty (`[OBS]`). */
export const EM_EVENT_SPEAKER_DEFAULT_STATUS = "invited__v";
/** Source formula (`[OBS]`, calculated — dropped by preflight; read from the row when selected). */
export const SPEAKER_ACCOUNT_FORMULA_SOURCE = "Account_vod__c";
/** Selector column for the account fallback. */
export const SPEAKER_ACCOUNT_SOURCE = "Speaker_vod__r.Account_vod__c";
/** Blob name (`objects.em_event_speaker.blobs.signature`). */
export const EM_EVENT_SPEAKER_SIGNATURE_BLOB = "signature";
export const CONTRACT_REF_DROPPED_CODE = "CONTRACT_REF_DROPPED";
export const SPEAKER_ACCOUNT_NOT_EDITABLE_CODE = "SPEAKER_ACCOUNT_NOT_EDITABLE";

/** Source formulas never loaded (§6.3.24 "Skip formulas"). */
export const EM_EVENT_SPEAKER_SKIPPED_FORMULAS: readonly string[] = [
  "Speaker_Name_vod__c",
  "First_Name_vod__c",
  "Last_Name_vod__c",
  "Middle_Name_vod__c",
  "Credentials_vod__c",
  "Title_vod__c",
  "Suffix_vod__c",
  "Nickname_vod__c",
];

// ---------------------------------------------------------------------------
// helpers (pure)
// ---------------------------------------------------------------------------

export function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

/**
 * `custom(fromSpeakerAccount)`: `account__v` = the speaker's account
 * (formula `Account_vod__c` read from the row — the primary row is keyed on
 * `Speaker_vod__c` because preflight drops calculated sources — else
 * `Speaker_vod__r.Account_vod__c`) as `ref(account)` — only when the target
 * field is editable per metadata (omitted with
 * `SPEAKER_ACCOUNT_NOT_EDITABLE` otherwise; Vault derives it from
 * `speaker__v`). Selector rows emit nothing.
 */
export const fromSpeakerAccount: CustomTransformFn = (
  value,
  row,
  ctx,
): TransformResult | undefined => {
  if (ctx.field.target !== "account__v") return undefined;
  const formula = !isEmpty(row[SPEAKER_ACCOUNT_FORMULA_SOURCE])
    ? row[SPEAKER_ACCOUNT_FORMULA_SOURCE]
    : ctx.field.source === SPEAKER_ACCOUNT_FORMULA_SOURCE
      ? value
      : undefined;
  const raw = isEmpty(formula) ? row[SPEAKER_ACCOUNT_SOURCE] : formula;
  if (isEmpty(raw)) return undefined;
  const target = ctx.metadata.fields.account__v ?? ctx.targetField;
  if (target && target.editable === false)
    return {
      omit: true,
      diagnostic: {
        kind: "custom",
        field: "account__v",
        code: SPEAKER_ACCOUNT_NOT_EDITABLE_CODE,
        value: isSfdcId(raw) ? to18(String(raw)) : String(raw),
      },
    };
  return applyTransform(
    { kind: "ref", objectKey: "account" },
    raw,
    row,
    target ? { ...ctx, targetField: target } : ctx,
  );
};

/** `custom(speakerStatus)`: `picklist(em_event_speaker.status)` with the `[OBS]` default `invited__v` when empty. */
export const speakerStatus: CustomTransformFn = (
  value,
  row,
  ctx,
): TransformResult | undefined => {
  if (isEmpty(value)) return { value: EM_EVENT_SPEAKER_DEFAULT_STATUS };
  return applyTransform(
    { kind: "picklist", mapKey: "em_event_speaker.status" },
    value,
    row,
    ctx,
  );
};

/** `custom(contractRefDropped)`: `contract__v` omitted and counted (`Contract_vod__c` out of v1, §6.2.1). */
export const contractRefDropped: CustomTransformFn = (
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
      code: CONTRACT_REF_DROPPED_CODE,
      value: isSfdcId(raw) ? to18(raw) : raw,
      detail: "Contract_vod__c is out of v1 (§6.2.1)",
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
  transform: RowInput["transform"],
  extra: Partial<RowInput> = {},
): RowInput => ({
  source,
  target,
  transform,
  required: "n",
  evidence: "UNV",
  ...extra,
});

export const em_event_speaker = defineObject({
  key: "em_event_speaker",
  source: "EM_Event_Speaker_vod__c",
  target: "em_event_speaker__v",
  targetEvidence: "OBS",
  scope: {
    kind: "via-parent",
    parentKey: "em_event",
    parentField: "Event_vod__r.Start_Time_vod__c",
    type: "datetime",
    retentionFamily: "tov",
  },
  countryOf: "parent:em_event:Event_vod__c",
  dependsOn: ["em_event", "em_speaker", "account"],
  objectTypes: { ...EM_EVENT_SPEAKER_OBJECT_TYPES },
  fields: [
    {
      source: "Event_vod__c",
      target: "event__v",
      transform: "ref(em_event)",
      required: "Y",
      evidence: "OBS",
      sourceType: "reference",
    },
    {
      source: "Speaker_vod__c",
      target: "speaker__v",
      transform: "ref(em_speaker)",
      required: "Y",
      evidence: "OBS",
      sourceType: "reference",
    },
    {
      source: "Speaker_vod__c",
      target: "account__v",
      transform: "custom(fromSpeakerAccount)",
      required: "n",
      evidence: "OBS",
      notes:
        "= em_speaker.account__v, written only if metadata says editable; from the Account_vod__c formula (selector row account__v.formula) when selected, else Speaker_vod__r.Account_vod__c; keyed on Speaker_vod__c because preflight drops calculated sources",
    },
    {
      source: SPEAKER_ACCOUNT_FORMULA_SOURCE,
      target: "account__v.formula",
      transform: "custom(fromSpeakerAccount)",
      required: "n",
      evidence: "OBS",
      optionalSource: true,
      notes:
        "selector row: formula in source (dropped by preflight when calculated — SF_FIELD_CALCULATED); read by the account__v row",
    },
    {
      source: SPEAKER_ACCOUNT_SOURCE,
      target: "account__v.speaker",
      transform: "custom(fromSpeakerAccount)",
      required: "n",
      evidence: "OBS",
      optionalSource: true,
      notes: "selector row: the speaker's account when the formula is empty",
    },
    {
      source: "Status_vod__c",
      target: "em_event_speaker_status__v",
      transform: "custom(speakerStatus)",
      required: "Y",
      evidence: "OBS",
      notes:
        "picklist(em_event_speaker.status), default invited__v [OBS]; attended__v/signed__v count toward utilisation",
    },
    {
      source: "Meal_Opt_In_vod__c",
      target: "meal_opt_in__v",
      transform: "bool",
      required: "n",
      evidence: "OBS",
    },
    {
      source: "Meal_Preference_vod__c",
      target: "meal_preference__v",
      transform: "picklist(em_event_speaker.mealPreference)",
      required: "n",
      evidence: "UNV",
    },
    {
      source: "Meal_Consumed_vod__c",
      target: "meal_consumed__v",
      transform: "bool",
      required: "n",
      evidence: "OBS",
    },
    {
      source: "RSVP_Status_vod__c",
      target: "rsvp_status__v",
      transform: "picklist(em_event_speaker.rsvpStatus)",
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
      source: "Walk_In_Status_vod__c",
      target: "walk_in_status__v",
      transform: "picklist(em_event_speaker.walkInStatus)",
      required: "n",
      evidence: "OBS",
    },
    {
      source: "Contract_vod__c",
      target: "contract__v",
      transform: "custom(contractRefDropped)",
      required: "n",
      evidence: "UNV",
      sourceType: "reference",
      notes: "omitted in v1 — omit+count CONTRACT_REF_DROPPED (§6.2.1)",
    },
    unv("Session_Title_vod__c", "session_title__v", "text"),
    unv("Position_vod__c", "position__v", "text"),
    unv("Workplace_vod__c", "workplace__v", "text"),
    unv("Start_Time_vod__c", "start_time__v", "datetime", {
      sourceType: "datetime",
    }),
    unv("End_Time_vod__c", "end_time__v", "datetime", {
      sourceType: "datetime",
    }),
    unv("Vessel_Number_vod__c", "vessel_number__v", "text"),
    {
      source: "Signature_vod__c",
      target: "signature__v",
      transform: `deferredBlob(${EM_EVENT_SPEAKER_SIGNATURE_BLOB})`,
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      blobName: EM_EVENT_SPEAKER_SIGNATURE_BLOB,
      notes: "blob pass (§8.6); objects.em_event_speaker.blobs.signature",
    },
    unv("Signature_Datetime_vod__c", "signature_datetime__v", "datetime", {
      sourceType: "datetime",
    }),
    {
      source: "External_ID_vod__c",
      target: "external_id__v",
      transform: "copy",
      required: "n",
      evidence: "OBS",
      notes: "match key (§3.3)",
    },
    unv("Stub_Mobile_Id_vod__c", "stub_mobile_id__v", "copy", {
      unverifiedSource: true,
      notes:
        "Stub_* family — further columns via objects.em_event_speaker.fields.add",
    }),
    unv("Stub_SFDC_Id_vod__c", "stub_sfdc_id__v", "copy", {
      unverifiedSource: true,
    }),
    // --- skipped formulas (Vault derives them from the speaker)
    ...EM_EVENT_SPEAKER_SKIPPED_FORMULAS.map(
      (source): RowInput => ({
        source,
        target: `${source.replace(/_vod__c$/, "").toLowerCase()}__v`,
        transform: "skip",
        required: "-",
        notes: "formula in source — never loaded",
      }),
    ),
  ],
  picklists: {
    "em_event_speaker.status": { ...EM_EVENT_SPEAKER_STATUS },
    "em_event_speaker.mealPreference": {},
    "em_event_speaker.rsvpStatus": {},
    "em_event_speaker.walkInStatus": {
      Needs_Reconciliation_vod: "needs_reconciliation__v",
      Reconciled_To_Existing_Account_vod: "reconciled_to_existing_account__v",
      Reconciled_To_Existing_User_vod: "reconciled_to_existing_user__v",
      Reconciled_To_New_Account_vod: "reconciled_to_new_account__v",
      Dismissed_vod: "dismissed__v",
    },
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
        { target: "speaker__v", source: "Speaker_vod__c" },
      ],
      notes: "(event__v, speaker__v) pair (§3.3), warning-level",
    },
  ],
  blobs: { [EM_EVENT_SPEAKER_SIGNATURE_BLOB]: "optional" },
  custom: { fromSpeakerAccount, speakerStatus, contractRefDropped },
  notes:
    "ToV family child of em_event (§6.3.24): via-parent scope, parent's country, noTriggers, deleted rows ignored (§4.4). account__v from the speaker (editable targets only); contract__v dropped (CONTRACT_REF_DROPPED); name formulas skipped.",
});
