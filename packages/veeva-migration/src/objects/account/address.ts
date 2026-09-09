/**
 * `address` — `Address_vod__c` → `address__v` (spec §6.3.8, §3.3, §4.4).
 *
 * Master-detail child of `account__v`. The primary address stamps onto the
 * account through a standard trigger, so the module keeps `noTriggers =
 * false`. No `OwnerId`. `Inactive_vod__c` feeds both `inactive__v` (bool)
 * and the Block S `status__v = inactive__v` derivation; inactivating on
 * delete writes the same pair (§4.4). `controlling_address__v` is a self
 * reference patched in pass 2 (§6.1 step 5).
 *
 * Address line 1 lives in `Name` (255 in SFDC, 128 in Vault): the overflow
 * policy `objects.address.line1Overflow` (`truncate` | `spillToLine2` |
 * `fail`) is implemented by the paired `addressLine1` / `addressLine2`
 * custom transforms, which split at the same word boundary.
 *
 * Fallback target spellings ("whichever exists") are separate rows with the
 * same source; preflight keeps the one the vault has (`VT_FIELD_MISSING`
 * drops the other).
 *
 * Custom transforms (pure, unit-tested in `address.test.ts`):
 *  - `addressLine1`  Name → `name__v` with the line-1 overflow policy
 *  - `addressLine2`  Address_line_2_vod__c (+ spilled remainder of line 1)
 *  - `postalCode`    text + `postalCode.pattern` check (`warn` | `fail`)
 *  - `countryAuto`, `phoneText` — shared with `account.ts`
 */
import { applyTransform } from "../../transform/registry";
import type {
  CustomTransformFn,
  SourceRow,
  TransformContext,
  TransformResult,
} from "../../types";
import { defineObject } from "../types";
import {
  asString,
  cleanText,
  countryAuto,
  isEmpty,
  phoneText,
} from "./account";

// ---------------------------------------------------------------------------
// line-1 overflow (objects.address.line1Overflow)
// ---------------------------------------------------------------------------

export type Line1Overflow = "truncate" | "spillToLine2" | "fail";

/** Vault `name__v` length on `address__v` (§6.3.8) when metadata is unavailable. */
export const DEFAULT_LINE1_MAX = 128;

export function line1Policy(ctx: TransformContext): Line1Overflow {
  const raw = ctx.mapping.options.line1Overflow;
  return raw === "spillToLine2" || raw === "fail" ? raw : "truncate";
}

/**
 * Split a cleaned line 1 at the last whitespace at or before `max` (falls
 * back to a hard cut when the text has no usable boundary). Pure; both
 * custom transforms call it so the halves always agree.
 */
export function splitLine1(
  text: string,
  max: number,
): { line1: string; spill: string } {
  if (text.length <= max) return { line1: text, spill: "" };
  const head = text.slice(0, max + 1);
  const boundary = head.search(/\s\S*$/);
  const cut = boundary > 0 ? boundary : max;
  return {
    line1: text.slice(0, cut).trimEnd(),
    spill: text.slice(cut).trim(),
  };
}

function line1Max(ctx: TransformContext): number {
  return ctx.targetField?.maxLength ?? DEFAULT_LINE1_MAX;
}

/** `Name` (= street line 1) → `name__v` (128) under the line-1 overflow policy. */
export const addressLine1: CustomTransformFn = (value, _row, ctx) => {
  if (isEmpty(value)) return undefined;
  const text = cleanText(asString(value));
  if (!text) return undefined;
  const max = line1Max(ctx);
  if (text.length <= max) return text;
  const policy = ctx.field.truncation === "fail" ? "fail" : line1Policy(ctx);
  const detail = `${text.length} > ${max}`;
  if (policy === "fail")
    return {
      omit: true,
      diagnostic: {
        kind: "truncated",
        field: ctx.field.target,
        code: "TRUNCATION_FAIL",
        detail,
        fatal: true,
      },
    } satisfies TransformResult;
  if (policy === "spillToLine2") {
    const { line1 } = splitLine1(text, max);
    return {
      value: line1,
      diagnostic: {
        kind: "truncated",
        field: ctx.field.target,
        code: "LINE1_SPILLED",
        detail,
      },
    } satisfies TransformResult;
  }
  return {
    value: text.slice(0, max),
    diagnostic: {
      kind: "truncated",
      field: ctx.field.target,
      code: "TRUNCATED",
      detail,
    },
  } satisfies TransformResult;
};

/** The remainder of line 1 that `spillToLine2` moves to line 2 (empty unless the policy holds and line 1 overflows). */
export function spilledLine1(row: SourceRow, ctx: TransformContext): string {
  if (line1Policy(ctx) !== "spillToLine2") return "";
  if (isEmpty(row.Name)) return "";
  const text = cleanText(asString(row.Name));
  const max = ctx.metadata.fields.name__v?.maxLength ?? DEFAULT_LINE1_MAX;
  return splitLine1(text, max).spill;
}

/** `Address_line_2_vod__c` → line 2, prefixed with the spilled remainder of line 1 when the policy is `spillToLine2`. */
export const addressLine2: CustomTransformFn = (value, row, ctx) => {
  const own = isEmpty(value) ? "" : cleanText(asString(value));
  const spill = spilledLine1(row, ctx);
  const combined = [spill, own].filter(Boolean).join(" ");
  if (!combined) return undefined;
  return applyTransform({ kind: "text" }, combined, row, ctx);
};

// ---------------------------------------------------------------------------
// postal code (postalCode.pattern / postalCode.onMismatch — validation only)
// ---------------------------------------------------------------------------

/** `text` plus the per-country format check (§7.2.1 `postalCode`): `warn` keeps the value, `fail` fails the row. */
export const postalCode: CustomTransformFn = (value, row, ctx) => {
  if (isEmpty(value)) return undefined;
  const text = cleanText(asString(value));
  if (!text) return undefined;
  const result = applyTransform({ kind: "text" }, text, row, ctx);
  if ("omit" in result) return result;
  const pattern = ctx.country.postalCode.pattern;
  if (!pattern) return result;
  let ok = true;
  try {
    ok = new RegExp(pattern).test(text);
  } catch {
    ok = true; // a malformed pattern is a config finding, never a row failure
  }
  if (ok) return result;
  const fatal = ctx.country.postalCode.onMismatch === "fail";
  const diagnostic = {
    kind: "invalid_value" as const,
    field: ctx.field.target,
    code: "POSTAL_CODE_FORMAT",
    value: text.slice(0, 32),
    fatal,
  };
  return fatal
    ? ({ omit: true, diagnostic } satisfies TransformResult)
    : ({ value: result.value, diagnostic } satisfies TransformResult);
};

// ---------------------------------------------------------------------------
// module
// ---------------------------------------------------------------------------

export const address = defineObject({
  key: "address",
  source: "Address_vod__c",
  target: "address__v",
  targetEvidence: "OBS",
  scope: { kind: "full" },
  countryOf: "account",
  dependsOn: ["account"],
  selfRefs: [
    { target: "controlling_address__v", source: "Controlling_Address_vod__c" },
  ],
  // Block S: no OwnerId (master-detail); Name is street line 1 (module row);
  // status__v derives from Inactive_vod__c (§6.0.4 / §4.4); no currency.
  blockS: {
    ownerId: false,
    currency: false,
    statusFromFlag: {
      sourceFlag: "Inactive_vod__c",
      inactiveWhen: { equals: true },
    },
  },
  fields: [
    {
      source: "Account_vod__c",
      target: "account__v",
      transform: "ref(account)",
      required: "Y",
      evidence: "OBS",
      sourceType: "reference",
      notes: "master-detail parent",
    },
    {
      source: "Name",
      target: "name__v",
      transform: "custom(addressLine1)",
      required: "Y",
      evidence: "OBS",
      countryConfigurable: true,
      notes:
        "street line 1 (255 → 128): objects.address.line1Overflow = truncate (+log) | spillToLine2 | fail",
    },
    {
      source: "Address_line_2_vod__c",
      target: "street_address_2_cda__v",
      transform: "custom(addressLine2)",
      required: "n",
      evidence: "OBS",
      notes: "receives the spilled remainder of line 1 under spillToLine2",
    },
    {
      source: "Address_line_2_vod__c",
      target: "address_line_2__v",
      transform: "custom(addressLine2)",
      required: "n",
      evidence: "UNV",
      notes: "fallback spelling of street_address_2_cda__v — whichever exists",
    },
    {
      source: "City_vod__c",
      target: "city_cda__v",
      transform: "text",
      required: "n",
      evidence: "OBS",
    },
    {
      source: "City_vod__c",
      target: "city__v",
      transform: "text",
      required: "n",
      evidence: "UNV",
      notes: "fallback spelling of city_cda__v — whichever exists",
    },
    {
      source: "State_vod__c",
      target: "state_province__v",
      transform: "picklist(address.state)",
      required: "n",
      evidence: "OBS",
      countryConfigurable: true,
      sourceType: "picklist",
      notes:
        "US/CA/AU/BR/MX/JP prefectures/FR départements crosswalk per country; EU often empty — never default",
    },
    {
      source: "Zip_vod__c",
      target: "postal_code_cda__v",
      transform: "custom(postalCode)",
      required: "n",
      evidence: "OBS",
      countryConfigurable: true,
      notes:
        "format check per country (postalCode.pattern); keep ZIP+4 separate",
    },
    {
      source: "Zip_vod__c",
      target: "postal_code__v",
      transform: "custom(postalCode)",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      notes: "fallback spelling of postal_code_cda__v — whichever exists",
    },
    {
      source: "Zip_vod__c",
      target: "zip__v",
      transform: "custom(postalCode)",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      notes:
        "second fallback spelling of postal_code_cda__v — whichever exists",
    },
    {
      source: "Zip_4_vod__c",
      target: "zip_4__v",
      transform: "text",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      notes: "US ZIP+4",
    },
    {
      source: "Country_vod__c",
      target: "country__v",
      transform: "custom(countryAuto)",
      required: "y?",
      evidence: "OBS",
      sourceType: "picklist",
      notes:
        "ISO-2 picklist → country(auto): picklist name or reference by target metadata type",
    },
    {
      source: "External_ID_vod__c",
      target: "external_id__v",
      transform: "copy",
      required: "n",
      evidence: "OBS",
      notes:
        "EXTID unique 120 — Network-owned in bridged orgs (externalIdOwnedBy = integration, §3.2 step 4)",
    },
    {
      source: "Primary_vod__c",
      target: "primary__v",
      transform: "bool",
      required: "n",
      evidence: "UNV",
      sourceType: "boolean",
      notes: "exactly one per account — validated by reconciliation",
    },
    // --- boolean flags (`inactive__v` [DOC] is also the inactivate-delete target)
    {
      source: "Business_vod__c",
      target: "business__v",
      transform: "bool",
      required: "n",
      evidence: "UNV",
      sourceType: "boolean",
    },
    {
      source: "Home_vod__c",
      target: "home__v",
      transform: "bool",
      required: "n",
      evidence: "UNV",
      sourceType: "boolean",
    },
    {
      source: "Mailing_vod__c",
      target: "mailing__v",
      transform: "bool",
      required: "n",
      evidence: "UNV",
      sourceType: "boolean",
    },
    {
      source: "Shipping_vod__c",
      target: "shipping__v",
      transform: "bool",
      required: "n",
      evidence: "UNV",
      sourceType: "boolean",
    },
    {
      source: "Billing_vod__c",
      target: "billing__v",
      transform: "bool",
      required: "n",
      evidence: "UNV",
      sourceType: "boolean",
    },
    {
      source: "Inactive_vod__c",
      target: "inactive__v",
      transform: "bool",
      required: "n",
      evidence: "DOC",
      sourceType: "boolean",
      notes:
        "also drives status__v = inactive__v (Block S) and the inactivate set (§4.4)",
    },
    {
      source: "Include_in_Territory_Assignment_vod__c",
      target: "include_in_territory_assignment__v",
      transform: "bool",
      required: "n",
      evidence: "UNV",
      sourceType: "boolean",
    },
    {
      source: "Appt_Required_vod__c",
      target: "appt_required__v",
      transform: "bool",
      required: "n",
      evidence: "UNV",
      sourceType: "boolean",
    },
    {
      source: "Controlled_Address_vod__c",
      target: "controlled_address__v",
      transform: "bool",
      required: "n",
      evidence: "UNV",
      sourceType: "boolean",
    },
    {
      source: "No_Address_Copy_vod__c",
      target: "no_address_copy__v",
      transform: "bool",
      required: "n",
      evidence: "UNV",
      sourceType: "boolean",
    },
    {
      source: "DEA_Address_vod__c",
      target: "dea_address__v",
      transform: "bool",
      required: "n",
      evidence: "UNV",
      sourceType: "boolean",
    },
    // --- phones (`phone__v` … or `*_cda__v` if that is what exists)
    {
      source: "Phone_vod__c",
      target: "phone__v",
      transform: "custom(phoneText)",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
    },
    {
      source: "Phone_2_vod__c",
      target: "phone_2__v",
      transform: "custom(phoneText)",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
    },
    {
      source: "Fax_vod__c",
      target: "fax__v",
      transform: "custom(phoneText)",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
    },
    {
      source: "Fax_2_vod__c",
      target: "fax_2__v",
      transform: "custom(phoneText)",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
    },
    {
      source: "Phone_vod__c",
      target: "phone_cda__v",
      transform: "custom(phoneText)",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      notes: "fallback spelling of phone__v — whichever exists",
    },
    {
      source: "Phone_2_vod__c",
      target: "phone_2_cda__v",
      transform: "custom(phoneText)",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      notes: "fallback spelling of phone_2__v — whichever exists",
    },
    {
      source: "Fax_vod__c",
      target: "fax_cda__v",
      transform: "custom(phoneText)",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      notes: "fallback spelling of fax__v — whichever exists",
    },
    {
      source: "Fax_2_vod__c",
      target: "fax_2_cda__v",
      transform: "custom(phoneText)",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      notes: "fallback spelling of fax_2__v — whichever exists",
    },
    {
      source: "Brick_vod__c",
      target: "brick__v",
      transform: "text",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      notes: "EU (IQVIA brick)",
    },
    {
      source: "Latitude_vod__c",
      target: "latitude__v",
      transform: "number",
      required: "n",
      evidence: "UNV",
      sourceType: "double",
    },
    {
      source: "Longitude_vod__c",
      target: "longitude__v",
      transform: "number",
      required: "n",
      evidence: "UNV",
      sourceType: "double",
    },
    // --- US licences (SLN / DEA / CDS / PR ASSMCA)
    {
      source: "License_vod__c",
      target: "license__v",
      transform: "text",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      notes: "US SLN; BR CRM number may map here",
    },
    {
      source: "License_Status_vod__c",
      target: "license_status__v",
      transform: "picklist(address.licenseStatus)",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      sourceType: "picklist",
    },
    {
      source: "License_Expiration_Date_vod__c",
      target: "license_expiration_date__v",
      transform: "date",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      sourceType: "date",
    },
    {
      source: "DEA_vod__c",
      target: "dea__v",
      transform: "text",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      notes: "US",
    },
    {
      source: "DEA_Status_vod__c",
      target: "dea_status__v",
      transform: "picklist(address.deaStatus)",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      sourceType: "picklist",
    },
    {
      source: "DEA_Expiration_Date_vod__c",
      target: "dea_expiration_date__v",
      transform: "date",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      sourceType: "date",
    },
    {
      source: "DEA_Schedule_vod__c",
      target: "dea_schedule__v",
      transform: "multipicklist(address.deaSchedule)",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      notes:
        "multi-select in Veeva CRM (2, 2N, 3, 3N, 4, 5) — preflight confirms the describe type",
    },
    {
      source: "DEA_License_Address_vod__c",
      target: "dea_license_address__v",
      transform: "text",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
    },
    {
      source: "CDS_vod__c",
      target: "cds__v",
      transform: "text",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      notes: "US",
    },
    {
      source: "CDS_Status_vod__c",
      target: "cds_status__v",
      transform: "picklist(address.cdsStatus)",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      sourceType: "picklist",
    },
    {
      source: "CDS_Expiration_Date_vod__c",
      target: "cds_expiration_date__v",
      transform: "date",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      sourceType: "date",
    },
    {
      source: "ASSMCA_vod__c",
      target: "assmca__v",
      transform: "text",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      notes: "PR",
    },
    // --- Network bridge fields (bridge may repopulate)
    {
      source: "Network_License_Entity_ID_vod__c",
      target: "network_license_entity_id__v",
      transform: "text",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
    },
    {
      source: "Network_DEA_Entity_ID_vod__c",
      target: "network_dea_entity_id__v",
      transform: "text",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
    },
    {
      source: "Network_CDS_Entity_ID_vod__c",
      target: "network_cds_entity_id__v",
      transform: "text",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
    },
    {
      source: "Network_ASSMCA_Entity_ID_vod__c",
      target: "network_assmca_entity_id__v",
      transform: "text",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
    },
    {
      source: "Network_Sample_Eligibility_vod__c",
      target: "network_sample_eligibility__v",
      transform: "picklist(address.networkSampleEligibility)",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      sourceType: "picklist",
    },
    {
      source: "Sample_Send_Status_vod__c",
      target: "sample_send_status__v",
      transform: "picklist(address.sampleSendStatus)",
      required: "n",
      evidence: "UNV",
      sourceType: "picklist",
    },
    {
      source: "Source_vod__c",
      target: "source__v",
      transform: "picklist(address.source)",
      required: "n",
      evidence: "UNV",
      sourceType: "picklist",
      notes: "{Manual, HMS}",
    },
    {
      source: "Customer_Master_Status_vod__c",
      target: "customer_master_status__v",
      transform: "picklist(address.customerMasterStatus)",
      required: "n",
      evidence: "UNV",
      sourceType: "picklist",
    },
    // --- self reference (pass 2, §6.1 step 5)
    {
      source: "Controlling_Address_vod__c",
      target: "controlling_address__v",
      transform: "ref(address) secondPass",
      required: "n",
      evidence: "UNV",
      sourceType: "reference",
    },
    // --- notes / ids
    {
      source: "Best_Times_vod__c",
      target: "best_times__v",
      transform: "longtext",
      required: "n",
      evidence: "UNV",
    },
    {
      source: "Office_Notes_vod__c",
      target: "office_notes__v",
      transform: "longtext",
      required: "n",
      evidence: "UNV",
    },
    {
      source: "Staff_notes_vod__c",
      target: "staff_notes__v",
      transform: "longtext",
      required: "n",
      evidence: "UNV",
    },
    {
      source: "Comment_vod__c",
      target: "comment__v",
      transform: "text",
      required: "n",
      evidence: "UNV",
    },
    {
      source: "Entity_Reference_Id_vod__c",
      target: "entity_reference_id__v",
      transform: "text",
      required: "n",
      evidence: "UNV",
    },
    {
      source: "Master_Align_Id_vod__c",
      target: "master_align_id__v",
      transform: "text",
      required: "n",
      evidence: "UNV",
    },
    // --- never loaded (formulas)
    {
      source: "Map_vod__c",
      target: "map__v",
      transform: "skip",
      required: "-",
      notes: "formula",
    },
    {
      source: "Sample_Status_vod__c",
      target: "sample_status__v",
      transform: "skip",
      required: "-",
      notes: "formula",
    },
    {
      source: "License_Valid_To_Sample_vod__c",
      target: "license_valid_to_sample__v",
      transform: "skip",
      required: "-",
      notes: "formula",
    },
  ],
  picklists: {
    "address.licenseStatus": {
      New_vod: "new__v",
      Valid_vod: "valid__v",
      Invalid_vod: "invalid__v",
      Expired_vod: "expired__v",
      Sampled_vod: "sampled__v",
    },
    "address.deaStatus": { Valid_vod: "valid__v", Invalid_vod: "invalid__v" },
    "address.networkSampleEligibility": {
      Eligible_vod: "eligible__v",
      Ineligible_vod: "ineligible__v",
    },
    "address.sampleSendStatus": {
      Pending_vod: "pending__v",
      Valid_vod: "valid__v",
      Invalid_vod: "invalid__v",
    },
    "address.source": { Manual: "manual__v", HMS: "hms__v" },
    "address.customerMasterStatus": {
      Staging_vod: "staging__v",
      Inactive_vod: "inactive__v",
      Valid_vod: "valid__v",
      Under_Review_vod: "under_review__v",
      Rejected_vod: "rejected__v",
    },
  },
  deletePolicy: "inactivate",
  // §4.4: status__v = inactive__v (implied) AND inactive__v = true [DOC]
  inactivate: [{ field: "inactive__v", value: true }],
  createPolicy: "create",
  load: { noTriggers: false },
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
      evidence: "UNV",
    },
    {
      method: "natural_key",
      keys: [
        {
          target: "account__v",
          source: "Account_vod__c",
          transform: { kind: "ref", objectKey: "account" },
        },
        { target: "name__v", source: "Name", caseInsensitive: true },
        { target: "city_cda__v", source: "City_vod__c", caseInsensitive: true },
        { target: "postal_code_cda__v", source: "Zip_vod__c" },
        { target: "country__v", source: "Country_vod__c" },
      ],
      sameCountry: true,
      evidence: "OBS",
      notes:
        "(account__v, upper(name__v), upper(city), postal_code, country) — reported as a warning with counts for review (§3.3)",
    },
  ],
  custom: { addressLine1, addressLine2, postalCode, countryAuto, phoneText },
  optionDefaults: { line1Overflow: "truncate" },
  notes:
    "Master-detail child of account (§6.2): full scope, country via the parent account, inactivated on delete (status__v = inactive__v + inactive__v = true), triggers left on so the primary address stamps onto the account.",
});
