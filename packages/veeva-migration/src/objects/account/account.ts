/**
 * `account` — `Account` → `account__v` (spec §6.3.7, §3.3, §3.4, §3.5, §4.4).
 *
 * Person vs business is an **object type** on `account__v` (no Contact rows):
 * HCP names live on the account. `primary_country__v` is required
 * (`[DOC snippet]`) and its type (reference vs picklist) is `[UNV]`, so the
 * `country(auto)` of the spec is `custom(countryAuto)` here: it picks the
 * `country(...)` mode from the target field's metadata type. Standard SFDC
 * B2B fields are skipped (`ParentId` feeds `primary_parent__v` only behind
 * `objects.account.useParentIdFallback`). Self references
 * (`primary_parent__v`, `business_professional_person__v`) are patched in
 * pass 2 (§6.1 step 4).
 *
 * Fallback target spellings ("whichever exists": `spec_1_cda__v` /
 * `specialty_1__v`, `veeva_network_id__v` / `veeva_network__id__v`,
 * `primary_country__v` / `country__v`) are carried as separate rows with the
 * same source; preflight drops the spelling the vault does not have
 * (`VT_FIELD_MISSING`), never the transform.
 *
 * Custom transforms (pure, unit-tested in `account.test.ts`):
 *  - `accountName`      `name__v`: `nameTemplate(person)` for person accounts
 *                       (template per country, §7.3), `text(128)` of `Name`
 *                       for business accounts
 *  - `accountType`      `picklist(account.type)` gated to business accounts —
 *                       default crosswalk = the object-type api name
 *  - `countryAuto`      `country(ref|picklist|iso2)` chosen by target type
 *  - `formattedName`    `Formatted_Name_vod__c` only when editable and
 *                       `objects.account.loadFormattedName`
 *  - `doNotCall`        `{No_vod, Yes_vod}` → bool or picklist by target type
 *  - `networkVid`       Network VID from `objects.account.vidField` (match key)
 *  - `parentIdFallback` standard `ParentId` → `primary_parent__v` when
 *                       `Primary_Parent_vod__c` is empty (flag-gated, pass 2)
 *  - `phoneText`        text with optional E.164 normalisation (`phone.*`)
 */
import { crosswalkPicklist, applyTransform } from "../../transform/registry";
import { isContactId, isSfdcId, to18 } from "../../transform/ids";
import { renameField } from "../../transform/rename";
import type {
  CountryMode,
  CustomTransformFn,
  FieldMapping,
  SourceRow,
  TransformContext,
  TransformResult,
  TransformSpec,
} from "../../types";
import { defineObject } from "../types";

// ---------------------------------------------------------------------------
// helpers (shared with `address.ts`)
// ---------------------------------------------------------------------------

export function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

export function asString(v: unknown): string {
  if (typeof v === "string") return v;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/** SFDC booleans arrive as `true`/`"true"`/`"1"` (REST vs CSV). */
export function readFlag(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (isEmpty(v)) return undefined;
  const s = asString(v).trim().toLowerCase();
  if (s === "true" || s === "1" || s === "yes") return true;
  if (s === "false" || s === "0" || s === "no") return false;
  return undefined;
}

/** C0 controls except TAB/LF/CR, plus DEL (same policy as the registry `text`). */
const CONTROL_RE = new RegExp(
  "[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]",
  "g",
);

export function cleanText(raw: string): string {
  return raw.normalize("NFC").replace(CONTROL_RE, "").trim();
}

/** Record types whose `IsPersonType = true` in a stock Veeva CRM org (`objects.account.personRecordTypes`). */
export const DEFAULT_PERSON_RECORD_TYPES = [
  "Professional_vod",
  "Business_Professional_vod",
] as const;

/**
 * Person-account detection: `IsPersonAccount` when selected, else the record
 * type against `objects.account.personRecordTypes`, else "has a LastName".
 */
export function isPersonAccount(
  row: SourceRow,
  ctx: TransformContext,
): boolean {
  const flag = readFlag(row.IsPersonAccount);
  if (flag !== undefined) return flag;
  const devName = row["RecordType.DeveloperName"];
  if (!isEmpty(devName)) {
    const configured = ctx.mapping.options.personRecordTypes;
    const personTypes = Array.isArray(configured)
      ? configured.map(String)
      : [...DEFAULT_PERSON_RECORD_TYPES];
    return personTypes.includes(asString(devName).trim());
  }
  return !isEmpty(row.LastName);
}

/** `country(auto)` (§6.3.7/§6.3.8): the mode follows the target field's metadata type. */
export function countryModeFor(ctx: TransformContext): CountryMode {
  const type = ctx.targetField?.type;
  if (type === "picklist") return "picklist";
  if (type === "string" || type === "longtext") return "iso2";
  return "ref";
}

/** International calling codes for the E.164 best effort (`phone.defaultRegion`); extend per programme. */
export const CALLING_CODES: Record<string, string> = {
  US: "1",
  CA: "1",
  GB: "44",
  DE: "49",
  FR: "33",
  IT: "39",
  ES: "34",
  NL: "31",
  BE: "32",
  CH: "41",
  AT: "43",
  SE: "46",
  DK: "45",
  NO: "47",
  FI: "358",
  PL: "48",
  PT: "351",
  IE: "353",
  JP: "81",
  CN: "86",
  KR: "82",
  AU: "61",
  NZ: "64",
  BR: "55",
  MX: "52",
  AR: "54",
  IN: "91",
};

/**
 * E.164 when unambiguous, pass-through otherwise (§7.2.1 `phone.normalise`):
 * `+49 (30) 1234-567` → `+49301234567`; a national number is prefixed with the
 * calling code of `phone.defaultRegion` after dropping one trunk `0`; numbers
 * with extensions or letters are left as typed.
 */
export function normalisePhone(raw: string, defaultRegion?: string): string {
  const text = raw.trim();
  if (!text) return text;
  if (/[a-zA-Z]/.test(text) || /(ext|x)\s*\d+$/i.test(text)) return text;
  const digits = text.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) {
    const body = digits.slice(1).replace(/\+/g, "");
    return body.length >= 7 && body.length <= 15 ? `+${body}` : text;
  }
  if (digits.startsWith("00")) {
    const body = digits.slice(2);
    return body.length >= 7 && body.length <= 15 ? `+${body}` : text;
  }
  const cc = defaultRegion ? CALLING_CODES[defaultRegion.toUpperCase()] : "";
  if (!cc || !digits) return text;
  const national = digits.replace(/^0/, "");
  const full = `${cc}${national}`;
  return full.length >= 7 && full.length <= 15 ? `+${full}` : text;
}

/** `text` with optional E.164 normalisation from the country context (`phone.normalise`). */
export const phoneText: CustomTransformFn = (value, row, ctx) => {
  if (isEmpty(value)) return undefined;
  const text = cleanText(asString(value));
  if (!text) return undefined;
  const normalised = ctx.country.phone.normalise
    ? normalisePhone(text, ctx.country.phone.defaultRegion)
    : text;
  return applyTransform({ kind: "text" }, normalised, row, ctx);
};

/** `country(auto)`: `ref` for Object targets, `picklist` for Picklist targets, ISO-2 text otherwise. */
export const countryAuto: CustomTransformFn = (value, row, ctx) => {
  if (isEmpty(value)) return undefined;
  const spec: TransformSpec = { kind: "country", mode: countryModeFor(ctx) };
  return applyTransform(spec, value, row, ctx);
};

// ---------------------------------------------------------------------------
// account-specific custom transforms
// ---------------------------------------------------------------------------

/** Object-type crosswalk (§6.3.7) — every entry `[UNV]`, label-matched at preflight. */
export const ACCOUNT_OBJECT_TYPES: Record<string, string> = {
  Professional_vod: "professional__v",
  Business_Professional_vod: "business_professional__v",
  Hospital_vod: "hospital__v",
  HospitalDepartment_vod: "hospitaldepartment__v",
  Practice_vod: "practice__v",
  Pharmacy_vod: "pharmacy__v",
  Institution_vod: "institution__v",
  Organization_vod: "organization__v",
  MCO_vod: "mco__v",
  MCOPlan_vod: "mcoplan__v",
  Distributor_vod: "distributor__v",
  Distributor_Branch_vod: "distributor_branch__v",
  Wholesaler_vod: "wholesaler__v",
  Employer_vod: "employer__v",
  ExtendedCare_vod: "extendedcare__v",
  Government_Agency_vod: "government_agency__v",
  Laboratory_vod: "laboratory__v",
  Board_vod: "board__v",
  Publication_vod: "publication__v",
};

/** Default `account.type` crosswalk = the object-type api name (business types only). */
export const ACCOUNT_TYPE_DEFAULTS: Record<string, string> = Object.fromEntries(
  Object.entries(ACCOUNT_OBJECT_TYPES).filter(
    ([devName]) =>
      !(DEFAULT_PERSON_RECORD_TYPES as readonly string[]).includes(devName),
  ),
);

/**
 * `name__v`: person accounts render `nameTemplates.person` (§7.3; falls back
 * to `Name` when every token is empty), business accounts send `Name` as
 * `text(128)`.
 */
export const accountName: CustomTransformFn = (value, row, ctx) => {
  if (isPersonAccount(row, ctx)) {
    const templated = applyTransform(
      { kind: "nameTemplate", templateKey: "person" },
      value,
      row,
      ctx,
    );
    if (!("omit" in templated)) return templated;
  }
  return applyTransform({ kind: "text", max: 128 }, value, row, ctx);
};

/**
 * `type__v` = `picklist(account.type)` on business accounts: the record
 * type DeveloperName (or the standard `Type` picklist when the row source is
 * switched to it) crosswalked through `account.type`; default crosswalk is
 * the object-type api name. Person accounts never send it.
 */
export const accountType: CustomTransformFn = (value, row, ctx) => {
  if (isPersonAccount(row, ctx)) return undefined;
  const raw = isEmpty(value) ? row["RecordType.DeveloperName"] : value;
  if (isEmpty(raw)) return undefined;
  const r = crosswalkPicklist(ctx, "account.type", asString(raw).trim());
  if (r.skip || r.value === undefined)
    return { omit: true, diagnostic: r.diagnostic } satisfies TransformResult;
  return { value: r.value, diagnostic: r.diagnostic } satisfies TransformResult;
};

/** `Formatted_Name_vod__c` (formula) → `formatted_name__v` only when editable and the flag is on. */
export const formattedName: CustomTransformFn = (value, row, ctx) => {
  if (!ctx.mapping.options.loadFormattedName) return undefined;
  if (ctx.targetField && !ctx.targetField.editable) return undefined;
  if (isEmpty(value)) return undefined;
  return applyTransform({ kind: "text" }, value, row, ctx);
};

/** `Do_Not_Call_vod__c {No_vod, Yes_vod}` → boolean or `picklist(account.doNotCall)` by target type. */
export const doNotCall: CustomTransformFn = (value, row, ctx) => {
  if (isEmpty(value)) return undefined;
  const raw = asString(value).trim();
  if (ctx.targetField?.type === "boolean") {
    const s = raw.toLowerCase().replace(/_vod$/, "");
    if (s === "yes" || s === "true" || s === "1") return true;
    if (s === "no" || s === "false" || s === "0") return false;
    return {
      omit: true,
      diagnostic: {
        kind: "invalid_value",
        field: ctx.field.target,
        code: "INVALID_BOOLEAN",
        value: raw,
      },
    } satisfies TransformResult;
  }
  return applyTransform(
    { kind: "picklist", mapKey: "account.doNotCall" },
    raw,
    row,
    ctx,
  );
};

/**
 * Network VID (`objects.account.vidField`, default `VeevaID_vod__c`): the
 * configured column when present on the row, else the row's own source.
 */
export const networkVid: CustomTransformFn = (value, row, ctx) => {
  const column = ctx.mapping.options.vidField;
  const fromConfig =
    typeof column === "string" && column ? row[column] : undefined;
  const raw = isEmpty(fromConfig) ? value : fromConfig;
  if (isEmpty(raw)) return undefined;
  const text = asString(raw).trim();
  return text ? text : undefined;
};

/**
 * Standard `ParentId` → `primary_parent__v` **only** when
 * `Primary_Parent_vod__c` is empty and `objects.account.useParentIdFallback`
 * holds. Emits the same deferred `$fk` a `ref(account)` would (pass 2).
 */
export const parentIdFallback: CustomTransformFn = (value, row, ctx) => {
  if (!ctx.mapping.options.useParentIdFallback) return undefined;
  if (!isEmpty(row.Primary_Parent_vod__c)) return undefined;
  if (isEmpty(value)) return undefined;
  const raw = asString(value).trim();
  if (!isSfdcId(raw) || isContactId(raw)) return undefined;
  const id = to18(raw);
  const result: TransformResult = {
    value: { $fk: { object: "account", sfdcId: id } },
    targetField: "primary_parent__v",
  };
  if (ctx.ids.resolve("account", id) === undefined) {
    result.unresolved = { objectKey: "account", sfdcId: id };
    result.diagnostic = {
      kind: "unresolved_fk",
      field: "primary_parent__v",
      objectKey: "account",
      value: id,
      code: "UNRESOLVED_FK",
    };
  }
  return result;
};

// ---------------------------------------------------------------------------
// mapping rows
// ---------------------------------------------------------------------------

type Row = Omit<FieldMapping, "transform"> & {
  transform: TransformSpec | string;
};

/** `skip` rows (§6.3.7 last two rows + the standard B2B fields): never selected, never loaded. */
export function skipRows(sources: string[], notes: string): Row[] {
  return sources.map((source) => ({
    source,
    target: renameField(source) ?? `${source.toLowerCase()}__v`,
    transform: "skip",
    required: "-",
    notes,
  }));
}

const STANDARD_B2B_SKIPPED = [
  "Industry",
  "Rating",
  "Ownership",
  "Sic",
  "TickerSymbol",
  "AnnualRevenue",
  "NumberOfEmployees",
  "AccountSource",
  "Site",
  "Jigsaw",
];

const PERSON_AND_INTERNAL_SKIPPED = [
  "IsPersonAccount",
  "PersonContactId",
  "PersonIndividualId",
  "PersonLeadSource",
  "PersonAssistantName",
  "PersonAssistantPhone",
  "BillingAddress",
  "ShippingAddress",
  "PersonMailingAddress",
  "PersonOtherAddress",
  "Account_Search_First_Last_vod__c",
  "Account_Search_Last_First_vod__c",
  "Color_vod__c",
  "Signature_Page_Display_Name_vod__c",
  "Spend_Status_vod__c",
  "Territory_Test_vod__c",
  "ATL_Last_Update_Date_Time_vod__c",
];

export const account = defineObject({
  key: "account",
  source: "Account",
  target: "account__v",
  targetEvidence: "OBS",
  scope: { kind: "full" },
  countryOf: "field:Country_vod__r.Alpha_2_Code_vod__c",
  dependsOn: ["country", "user"],
  selfRefs: [
    { target: "primary_parent__v", source: "Primary_Parent_vod__c" },
    {
      target: "business_professional_person__v",
      source: "Business_Professional_Person_vod__c",
    },
  ],
  // Block S: Name is replaced by the person/business row below; Account has
  // OwnerId, audit, External_ID_vod__c and Mobile_ID_vod__c; no currency
  // fields are loaded (AnnualRevenue is skipped), so local_currency__sys stays off.
  blockS: { currency: false },
  fields: [
    // --- identity / type (RecordType.DeveloperName → object_type__v comes from Block S)
    {
      source: "RecordType.DeveloperName",
      target: "type__v",
      transform: "custom(accountType)",
      required: "y?",
      evidence: "OBS",
      countryConfigurable: true,
      optionalSource: true,
      notes:
        "picklist(account.type) on business accounts: default crosswalk = object-type api name; semantics [UNV] (classification picklist vs text — a String target gets the crosswalk value verbatim); switch the source to the standard `Type` picklist via fields.override when the org uses it; preflight reads `required` per object type",
    },
    {
      source: "Name",
      target: "name__v",
      transform: "custom(accountName)",
      required: "Y",
      evidence: "OBS",
      countryConfigurable: true,
      disabledBy: "preserveName",
      notes:
        "business accounts: text(128) of Name; person accounts: nameTemplate(person) — default `{FirstName} {LastName}`, JP `{LastName} {FirstName}`, CN `{LastName}{FirstName}` (§7.3)",
    },
    // --- person name parts (person-account orgs only → optionalSource)
    {
      source: "FirstName",
      target: "first_name_cda__v",
      transform: "text",
      required: "n",
      evidence: "OBS",
      countryConfigurable: true,
      optionalSource: true,
      sourceType: "string",
    },
    {
      source: "LastName",
      target: "last_name_cda__v",
      transform: "text",
      required: "y?",
      evidence: "OBS",
      countryConfigurable: true,
      optionalSource: true,
      sourceType: "string",
      notes: "required on person object types (preflight reads type_fields)",
    },
    {
      source: "MiddleName",
      target: "middle__v",
      transform: "text",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      optionalSource: true,
      notes:
        "orgs without the standard MiddleName carry Middle_vod__c — swap the source via fields.override",
    },
    {
      source: "Suffix",
      target: "suffix__v",
      transform: "text",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      optionalSource: true,
      notes:
        "orgs without the standard Suffix carry Suffix_vod__c — swap the source via fields.override",
    },
    {
      source: "Salutation",
      target: "salutation__v",
      transform: "picklist(account.salutation)",
      required: "n",
      evidence: "OBS",
      countryConfigurable: true,
      optionalSource: true,
      sourceType: "picklist",
    },
    {
      source: "Formatted_Name_vod__c",
      target: "formatted_name__v",
      transform: "custom(formattedName)",
      required: "-",
      evidence: "DOC",
      optionalSource: true,
      notes:
        "formula — skipped (Vault computes) unless metadata shows editable and objects.account.loadFormattedName",
    },
    {
      source: "Furigana_vod__c",
      target: "furigana__v",
      transform: "text",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      notes: "JP kana (y? in JP); never transliterate",
    },
    {
      source: "Preferred_Name_vod__c",
      target: "preferred_name__v",
      transform: "text",
      required: "n",
      evidence: "UNV",
    },
    {
      source: "Alternate_Name_vod__c",
      target: "alternate_name__v",
      transform: "text",
      required: "n",
      evidence: "UNV",
    },
    // --- country (crosswalk §3.4)
    {
      source: "Country_vod__c",
      target: "primary_country__v",
      transform: "custom(countryAuto)",
      required: "Y",
      evidence: "DOC",
      sourceType: "reference",
      notes:
        "country(auto): reference or picklist by target metadata type [UNV]; via the country crosswalk",
    },
    {
      source: "Country_vod__c",
      target: "country__v",
      transform: "custom(countryAuto)",
      required: "n",
      evidence: "UNV",
      sourceType: "reference",
      notes: "written in addition to primary_country__v when the target has it",
    },
    // --- specialties / credentials
    {
      source: "Specialty_1_vod__c",
      target: "spec_1_cda__v",
      transform: "picklist(account.specialty)",
      required: "n",
      evidence: "OBS",
      countryConfigurable: true,
      sourceType: "picklist",
      notes:
        "per-country specialty crosswalk; multi-value on target [OBS array]",
    },
    {
      source: "Specialty_2_vod__c",
      target: "spec_2_cda__v",
      transform: "picklist(account.specialty)",
      required: "n",
      evidence: "OBS",
      countryConfigurable: true,
      sourceType: "picklist",
    },
    {
      source: "Specialty_1_vod__c",
      target: "specialty_1__v",
      transform: "picklist(account.specialty)",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      notes: "fallback spelling of spec_1_cda__v — whichever exists",
    },
    {
      source: "Specialty_2_vod__c",
      target: "specialty_2__v",
      transform: "picklist(account.specialty)",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      notes: "fallback spelling of spec_2_cda__v — whichever exists",
    },
    {
      source: "Group_Specialty_1_vod__c",
      target: "group_specialty_1__v",
      transform: "picklist(account.groupSpecialty)",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
    },
    {
      source: "Group_Specialty_2_vod__c",
      target: "group_specialty_2__v",
      transform: "picklist(account.groupSpecialty)",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
    },
    {
      source: "Credentials_vod__c",
      target: "credentials__v",
      transform: "picklist(account.credentials)",
      required: "n",
      evidence: "OBS",
      countryConfigurable: true,
      sourceType: "picklist",
    },
    {
      source: "Gender_vod__c",
      target: "gender__v",
      transform: "picklist(account.gender)",
      required: "n",
      evidence: "UNV",
      notes: "{F, M}",
    },
    {
      source: "Language_vod__c",
      target: "language__v",
      transform: "picklist(account.language)",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      notes: "{en_US, de, fr, …}",
    },
    {
      source: "Career_Status_vod__c",
      target: "career_status__v",
      transform: "picklist(account.careerStatus)",
      required: "n",
      evidence: "UNV",
    },
    {
      source: "Do_Not_Call_vod__c",
      target: "do_not_call__v",
      transform: "custom(doNotCall)",
      required: "n",
      evidence: "UNV",
      notes:
        "{No_vod, Yes_vod} → picklist(account.doNotCall) or bool by target type",
    },
    // --- US compliance
    {
      source: "PDRP_Opt_Out_vod__c",
      target: "pdrp_opt_out__v",
      transform: "bool",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      sourceType: "boolean",
      notes: "US only",
    },
    {
      source: "PDRP_Opt_Out_Date_vod__c",
      target: "pdrp_opt_out_date__v",
      transform: "date",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      sourceType: "date",
      notes: "US only",
    },
    {
      source: "KOL_vod__c",
      target: "kol__v",
      transform: "bool",
      required: "n",
      evidence: "UNV",
      sourceType: "boolean",
    },
    {
      source: "Investigator_vod__c",
      target: "investigator__v",
      transform: "bool",
      required: "n",
      evidence: "UNV",
      sourceType: "boolean",
    },
    {
      source: "NPI_vod__c",
      target: "npi__v",
      transform: "text",
      required: "n",
      evidence: "OBS",
      countryConfigurable: true,
      notes: "US",
    },
    // --- identifiers
    {
      source: "ID_vod__c",
      target: "id__v",
      transform: "text",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      notes: "country professional ids (DE LANR, FR RPPS, BR CRM…) often here",
    },
    {
      source: "ID2_vod__c",
      target: "id2__v",
      transform: "text",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
    },
    {
      source: "Account_Identifier_vod__c",
      target: "account_identifier__v",
      transform: "text",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
    },
    {
      source: "Payer_Id_vod__c",
      target: "payer_id__v",
      transform: "text",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
    },
    {
      source: "VeevaID_vod__c",
      target: "veeva_network_id__v",
      transform: "custom(networkVid)",
      required: "n",
      evidence: "OBS",
      optionalSource: true,
      notes:
        "match key (§3.3); newer field — objects.account.vidField names a customer VID column instead",
    },
    {
      source: "VeevaID_vod__c",
      target: "veeva_network__id__v",
      transform: "custom(networkVid)",
      required: "n",
      evidence: "UNV",
      optionalSource: true,
      notes:
        "fallback spelling [DOC snippet] of veeva_network_id__v — preflight keeps whichever exists",
    },
    {
      source: "Master_Align_Id_vod__c",
      target: "master_align_id__v",
      transform: "copy",
      required: "n",
      evidence: "UNV",
    },
    // --- self references (pass 2, §6.1 step 4)
    {
      source: "Primary_Parent_vod__c",
      target: "primary_parent__v",
      transform: "ref(account) secondPass",
      required: "n",
      evidence: "DOC",
      sourceType: "reference",
    },
    {
      source: "ParentId",
      target: "primary_parent__v.legacy_crm_id__v",
      transform: "custom(parentIdFallback) secondPass",
      required: "n",
      evidence: "DOC",
      enabledBy: "useParentIdFallback",
      sourceType: "reference",
      notes:
        "standard ParentId → primary_parent__v only when Primary_Parent_vod__c is empty (objects.account.useParentIdFallback); declared in reference-by-legacy-id form so it shares the base field, emitted as the same deferred $fk",
    },
    {
      source: "Business_Professional_Person_vod__c",
      target: "business_professional_person__v",
      transform: "ref(account) secondPass",
      required: "n",
      evidence: "UNV",
      sourceType: "reference",
    },
    // --- contact details (`*_cda__v` family, §6.0.2 override table)
    {
      source: "Phone",
      target: "office_phone_cda__v",
      transform: "custom(phoneText)",
      required: "n",
      evidence: "OBS",
      countryConfigurable: true,
      sourceType: "phone",
      notes: "optional E.164 per country (phone.normalise)",
    },
    {
      source: "Fax",
      target: "fax_cda__v",
      transform: "custom(phoneText)",
      required: "n",
      evidence: "OBS",
      countryConfigurable: true,
      sourceType: "phone",
    },
    {
      source: "PersonEmail",
      target: "email_cda__v",
      transform: "text",
      required: "n",
      evidence: "OBS",
      countryConfigurable: true,
      optionalSource: true,
      sourceType: "email",
    },
    {
      source: "Website",
      target: "website_cda__v",
      transform: "text",
      required: "n",
      evidence: "OBS",
      countryConfigurable: true,
      sourceType: "url",
    },
    {
      source: "PersonMobilePhone",
      target: "mobile_phone_cda__v",
      transform: "custom(phoneText)",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      optionalSource: true,
      sourceType: "phone",
    },
    {
      source: "PersonHomePhone",
      target: "home_phone_cda__v",
      transform: "custom(phoneText)",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      optionalSource: true,
      sourceType: "phone",
    },
    // --- classification
    {
      source: "Account_Class_vod__c",
      target: "account_class__v",
      transform: "picklist(account.accountClass)",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
    },
    {
      source: "Account_Group_vod__c",
      target: "account_group__v",
      transform: "picklist(account.accountGroup)",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
    },
    {
      source: "Hospital_Type_vod__c",
      target: "hospital_type__v",
      transform: "picklist(account.hospitalType)",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      notes: "{GP, HP}; CN uses Hospital_Type",
    },
    {
      source: "Territory_vod__c",
      target: "territory__v",
      transform: "skip",
      required: "-",
      notes:
        "`;`-joined territory names — derived from tsf/user_territory in Vault",
    },
    {
      source: "Segmentations_vod__c",
      target: "segmentations__v",
      transform: "longtext",
      required: "n",
      evidence: "UNV",
    },
    {
      source: "Restricted_Products_vod__c",
      target: "restricted_products__v",
      transform: "longtext",
      required: "n",
      evidence: "UNV",
    },
    {
      source: "Sample_Default_vod__c",
      target: "sample_default__v",
      transform: "longtext",
      required: "n",
      evidence: "UNV",
    },
    {
      source: "Order_Type_vod__c",
      target: "order_type__v",
      transform: "multipicklist(account.orderType)",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      sourceType: "multipicklist",
    },
    {
      source: "Inventory_Monitoring_Type_vod__c",
      target: "inventory_monitoring_type__v",
      transform: "multipicklist(account.inventoryMonitoringType)",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      sourceType: "multipicklist",
    },
    {
      source: "Approved_Email_Opt_Type_vod__c",
      target: "approved_email_opt_type__v",
      transform: "picklist(account.optType)",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      notes: "GDPR markets",
    },
    {
      source: "CLM_Opt_Type_vod__c",
      target: "clm_opt_type__v",
      transform: "picklist(account.optType)",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      notes: "GDPR markets",
    },
    {
      source: "Customer_Master_Status_vod__c",
      target: "customer_master_status__v",
      transform: "picklist(account.customerMasterStatus)",
      required: "n",
      evidence: "UNV",
      notes: "Network may repopulate",
    },
    // --- boolean flags
    {
      source: "Exclude_from_Zip_to_Terr_Processing_vod__c",
      target: "exclude_from_zip_to_terr_processing__v",
      transform: "bool",
      required: "n",
      evidence: "UNV",
      sourceType: "boolean",
    },
    {
      source: "Do_Not_Create_Child_Account_vod__c",
      target: "do_not_create_child_account__v",
      transform: "bool",
      required: "n",
      evidence: "UNV",
      sourceType: "boolean",
    },
    {
      source: "Do_Not_Sync_Sales_Data_vod__c",
      target: "do_not_sync_sales_data__v",
      transform: "bool",
      required: "n",
      evidence: "UNV",
      sourceType: "boolean",
    },
    {
      source: "Enable_Restricted_Products_vod__c",
      target: "enable_restricted_products__v",
      transform: "bool",
      required: "n",
      evidence: "UNV",
      sourceType: "boolean",
    },
    {
      source: "Practice_at_Hospital_vod__c",
      target: "practice_at_hospital__v",
      transform: "bool",
      required: "n",
      evidence: "UNV",
      sourceType: "boolean",
    },
    {
      source: "Practice_Near_Hospital_vod__c",
      target: "practice_near_hospital__v",
      transform: "bool",
      required: "n",
      evidence: "UNV",
      sourceType: "boolean",
    },
    // --- free text / blobs / person extras
    {
      source: "Call_Reminder_vod__c",
      target: "call_reminder__v",
      transform: "longtext",
      required: "n",
      evidence: "UNV",
    },
    {
      source: "Description",
      target: "description__v",
      transform: "longtext",
      required: "n",
      evidence: "UNV",
    },
    {
      source: "Photo_vod__c",
      target: "photo__v",
      transform: "deferredBlob(photo)",
      required: "n",
      evidence: "UNV",
      blobName: "photo",
      notes: "photo__v? / attachment — loaded in the blob pass (§8.6)",
    },
    {
      source: "PersonBirthdate",
      target: "birthdate__v",
      transform: "date",
      required: "n",
      evidence: "UNV",
      optionalSource: true,
      sourceType: "date",
      notes: "dropped when absent",
    },
    {
      source: "PersonTitle",
      target: "title__v",
      transform: "text",
      required: "n",
      evidence: "UNV",
      optionalSource: true,
      notes: "dropped when absent",
    },
    // --- never loaded
    ...skipRows(
      STANDARD_B2B_SKIPPED,
      "standard SFDC B2B field — skipped (§6.3.7); Type feeds type__v when the org uses it",
    ),
    {
      source: "ParentId",
      target: "parentid__v",
      transform: "skip",
      required: "-",
      notes:
        "standard hierarchy — skipped unless objects.account.useParentIdFallback (see primary_parent__v.legacy_crm_id__v)",
    },
    ...skipRows(
      PERSON_AND_INTERNAL_SKIPPED,
      "skipped (§6.3.7): IsPersonAccount drives object-type choice only; compounds, search helpers and internal flags are never loaded",
    ),
  ],
  objectTypes: ACCOUNT_OBJECT_TYPES,
  picklists: {
    "account.type": ACCOUNT_TYPE_DEFAULTS,
    "account.doNotCall": { Yes_vod: "yes__v", No_vod: "no__v" },
    "account.careerStatus": {
      Peak_vod: "peak__v",
      Emerging_vod: "emerging__v",
      Retired_vod: "retired__v",
    },
    "account.optType": {
      Explicit_Opt_In_vod: "explicit_opt_in__v",
      Implicit_Opt_In_vod: "implicit_opt_in__v",
      Never_vod: "never__v",
    },
    "account.customerMasterStatus": {
      Staging_vod: "staging__v",
      Inactive_vod: "inactive__v",
      Valid_vod: "valid__v",
      Under_Review_vod: "under_review__v",
      Rejected_vod: "rejected__v",
    },
    "account.hospitalType": { GP: "gp__v", HP: "hp__v" },
  },
  deletePolicy: "inactivate",
  // §4.4: status__v = inactive__v only (no business flag on account__v)
  inactivate: [],
  createPolicy: "create",
  load: { noTriggers: false },
  match: [
    { method: "legacy_id" },
    {
      method: "network_vid",
      keys: [{ target: "veeva_network_id__v", source: "VeevaID_vod__c" }],
      evidence: "OBS",
      notes:
        "Account.VeevaID_vod__c (or objects.account.vidField) → account__v.veeva_network_id__v [OBS Reltio]",
    },
    {
      method: "network_vid",
      keys: [{ target: "veeva_network__id__v", source: "VeevaID_vod__c" }],
      evidence: "UNV",
      notes:
        "fallback spelling [DOC snippet] — preflight picks whichever exists",
    },
    {
      method: "external_id",
      keys: [{ target: "external_id__v", source: "External_ID_vod__c" }],
      evidence: "OBS",
      notes: "Network bridge convention",
    },
    {
      method: "mobile_id",
      keys: [{ target: "mobile_id__v", source: "Mobile_ID_vod__c" }],
      evidence: "UNV",
    },
  ],
  blobs: { photo: "optional" },
  custom: {
    accountName,
    accountType,
    countryAuto,
    formattedName,
    doNotCall,
    networkVid,
    parentIdFallback,
    phoneText,
  },
  optionDefaults: {
    vidField: "VeevaID_vod__c",
    contactToPersonAccount: false,
    useParentIdFallback: false,
    loadFormattedName: false,
    depthOrder: false,
    personRecordTypes: [...DEFAULT_PERSON_RECORD_TYPES],
  },
  notes:
    "Master data (§6.2): full scope, country from Country_vod__r.Alpha_2_Code_vod__c, inactivated on delete (status__v = inactive__v), merged SFDC losers (MasterRecordId) map to the survivor with merged_into (§3.4).",
});
