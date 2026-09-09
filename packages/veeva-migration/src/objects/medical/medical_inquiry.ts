/**
 * `medical_inquiry` — `Medical_Inquiry_vod__c` → `medical_inquiry__v` `[DOC]`
 * (spec §6.3.29, §6.1 step 15, §6.2, §3.3, §3.5, §4.4).
 *
 * Dated on `CreatedDate` (2y) **or open** (`Status_vod__c <> 'Closed'` and
 * `Fulfillment_Status_vod__c <> 'Completed_vod'`); country of the account;
 * `noTriggers = true`; deleted inquiries are ignored on the target (§4.4).
 *
 * **Cycle with `call2`** (`Call2_vod__c` ↔ `Call2_vod__c.Medical_Inquiry_vod__c`):
 * inquiries are loaded with `call2__v` omitted (`ref(call2) secondPass`) and
 * patched after the calls (`selfRefs` with `objectKey: 'call2'` removes the
 * `call2 → medical_inquiry` DAG edge, §6.1 step 15/16).
 *
 * Custom transforms (pure, unit-tested):
 *  - `inquiryState` — `state__v` from `Status_vod__c` **only when the target
 *    is lifecycled** (§6.3.29 "+ state__v if lifecycled"); the default
 *    `<status>_state__v` names are `[UNV]` and validated by preflight.
 *  - `inquiryText` — `Rich_Text_Inquiry__c` (`[UNVERIFIED-SOURCE]`) feeds
 *    `inquiry_text__v` when the documented `Inquiry_Text__c` is empty/absent
 *    (declared under the dotted selector `inquiry_text__v.rich` so the column
 *    is selected and preflight validates the base field).
 *  - `normaliseCountry` — `Country_vod__c` holds mixed codes/names; the value
 *    is normalised to ISO-2 first (alpha-2, alpha-3/aliases table, English
 *    display names) and then rendered per the target field type: object →
 *    country reference through the crosswalk, picklist → country picklist
 *    value, text → the ISO-2 code (an unrecognised name is sent verbatim
 *    on a text target with `MI_COUNTRY_UNNORMALISED`, omitted otherwise).
 *
 * `State_vod__c` (US state picklist) targets `state_province__v` rather than
 * the spec's literal `state__v`, which is the lifecycle state field on a
 * lifecycled target (§6.0.2 known exception, same as address/em_event) —
 * `[UNV]`, re-pointable per country.
 *
 * `Status_vod__c` values `{New_vod, Saved_vod, Submitted_vod, Closed}` map
 * to `medical_inquiry_status__v` (`new__v`, `saved__v`, `submitted__v`,
 * `closed__v` — the spec's `closed__c?` is a customer-value guess; an overlay
 * flips it when the vault says so).
 */
import { applyTransform, crosswalkPicklist } from "../../transform/registry";
import type {
  CustomTransformFn,
  RowDiagnostic,
  SourceRow,
  TransformContext,
  TransformResult,
} from "../../types";
import { defineObject, type ObjectModuleInput } from "../types";

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

export const MEDICAL_INQUIRY_ACCOUNT_FIELD = "Account_vod__c";
export const MEDICAL_INQUIRY_CALL_FIELD = "Call2_vod__c";
/** Documented inquiry-text source (no `_vod`, §6.3.29). */
export const INQUIRY_TEXT_SOURCE = "Inquiry_Text__c";
/** `[UNVERIFIED-SOURCE]` rich-text alternative (§6.3.29 "confirm both names"). */
export const RICH_INQUIRY_TEXT_SOURCE = "Rich_Text_Inquiry__c";
export const INQUIRY_TEXT_TARGET = "inquiry_text__v";
export const COUNTRY_SOURCE = "Country_vod__c";

/** Open-item term (§6.2): inquiries neither closed nor fulfilled stay in scope. */
export const MEDICAL_INQUIRY_OPEN_PREDICATE =
  "(Status_vod__c != 'Closed' AND Fulfillment_Status_vod__c != 'Completed_vod')";

/** `Status_vod__c` → `medical_inquiry_status__v` (`[UNV]` values). */
export const MEDICAL_INQUIRY_STATUS: Record<string, string> = {
  New_vod: "new__v",
  Saved_vod: "saved__v",
  Submitted_vod: "submitted__v",
  Closed: "closed__v",
};

/** `Status_vod__c` → lifecycle state when the target is lifecycled (`[UNV]` `<status>_state__v` pattern). */
export const MEDICAL_INQUIRY_STATES: Record<string, string> = {
  New_vod: "new_state__v",
  Saved_vod: "saved_state__v",
  Submitted_vod: "submitted_state__v",
  Closed: "closed_state__v",
};

/** `Fulfillment_Status_vod__c` → `fulfillment_status__v` (`[UNV]` values). */
export const MEDICAL_INQUIRY_FULFILLMENT_STATUS: Record<string, string> = {
  New_vod: "new__v",
  Assigned_vod: "assigned__v",
  Completed_vod: "completed__v",
};

/** `Delivery_Method_vod__c` → `delivery_method__v` (`[DOC]` field; values by rename rule, customer values via overlays). */
export const MEDICAL_INQUIRY_DELIVERY_METHOD: Record<string, string> = {
  Email_vod: "email__v",
  Phone_vod: "phone__v",
  Mail_vod: "mail__v",
  Fax_vod: "fax__v",
  Urgent_Mail_vod: "urgent_mail__v",
};

/** Diagnostic codes (counted in the run report). */
export const MI_COUNTRY_UNNORMALISED_CODE = "MI_COUNTRY_UNNORMALISED";
export const MI_INQUIRY_TEXT_FROM_RICH_CODE = "MI_INQUIRY_TEXT_FROM_RICH";

// ---------------------------------------------------------------------------
// helpers (pure)
// ---------------------------------------------------------------------------

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

/** Alpha-3 codes and common aliases → ISO-2 (values seen in mixed `Country_vod__c` columns). */
export const COUNTRY_ALIASES: Record<string, string> = {
  USA: "US",
  "U.S.": "US",
  "U.S.A.": "US",
  "UNITED STATES OF AMERICA": "US",
  AMERICA: "US",
  UK: "GB",
  GBR: "GB",
  FX: "FR",
  DD: "DE",
  SU: "RU",
  ZR: "CD",
  YU: "RS",
  CS: "RS",
  "GREAT BRITAIN": "GB",
  ENGLAND: "GB",
  DEU: "DE",
  GER: "DE",
  DEUTSCHLAND: "DE",
  FRA: "FR",
  ITA: "IT",
  ESP: "ES",
  CAN: "CA",
  JPN: "JP",
  CHN: "CN",
  AUS: "AU",
  NLD: "NL",
  HOLLAND: "NL",
  "THE NETHERLANDS": "NL",
  BEL: "BE",
  CHE: "CH",
  AUT: "AT",
  SWE: "SE",
  NOR: "NO",
  DNK: "DK",
  FIN: "FI",
  IRL: "IE",
  PRT: "PT",
  POL: "PL",
  BRA: "BR",
  MEX: "MX",
  KOR: "KR",
  "SOUTH KOREA": "KR",
  "REPUBLIC OF KOREA": "KR",
  IND: "IN",
  RUS: "RU",
  TUR: "TR",
  ZAF: "ZA",
  ARG: "AR",
  NZL: "NZ",
  SGP: "SG",
  HKG: "HK",
  TWN: "TW",
  ARE: "AE",
  UAE: "AE",
  SAU: "SA",
  ISR: "IL",
  GRC: "GR",
  CZE: "CZ",
  "CZECH REPUBLIC": "CZ",
  HUN: "HU",
  ROU: "RO",
  ROM: "RO",
};

/**
 * Withdrawn ISO 3166-3 codes ICU still names (`DD` → "Germany", `FX` →
 * "France", `UK` → "United Kingdom", …): excluded from the name index so a
 * name resolves to its current code; the common ones are aliases above.
 */
export const WITHDRAWN_REGION_CODES: ReadonlySet<string> = new Set([
  "AN",
  "BU",
  "CS",
  "DD",
  "DY",
  "FX",
  "HV",
  "NH",
  "RH",
  "SU",
  "TP",
  "UK",
  "VD",
  "YD",
  "YU",
  "ZR",
]);

let displayNameIndex: Map<string, string> | undefined;

/** Lower-cased English region display name → ISO-2 (built once from ICU). */
function displayNames(): Map<string, string> {
  if (displayNameIndex) return displayNameIndex;
  const index = new Map<string, string>();
  try {
    const dn = new Intl.DisplayNames(["en"], { type: "region" });
    const A = "A".charCodeAt(0);
    for (let i = 0; i < 26; i++)
      for (let j = 0; j < 26; j++) {
        const code = String.fromCharCode(A + i) + String.fromCharCode(A + j);
        if (WITHDRAWN_REGION_CODES.has(code)) continue;
        let name: string | undefined;
        try {
          name = dn.of(code);
        } catch {
          name = undefined;
        }
        if (name && name !== code && name !== "Unknown Region") {
          const key = name.toLowerCase();
          if (!index.has(key)) index.set(key, code);
        }
      }
  } catch {
    // ICU without region names: aliases and alpha-2 codes still work
  }
  displayNameIndex = index;
  return index;
}

/**
 * Normalise a mixed code/name country value to ISO-2. Returns `undefined`
 * when nothing recognisable is found.
 */
export function normaliseCountryValue(raw: unknown): string | undefined {
  if (isEmpty(raw)) return undefined;
  const text = String(raw).trim().replace(/\s+/g, " ");
  if (!text) return undefined;
  const upper = text.toUpperCase();
  // aliases first: `UK`, `USA` and the withdrawn codes are not ISO alpha-2
  const alias = COUNTRY_ALIASES[upper];
  if (alias) return alias;
  if (/^[A-Z]{2}$/.test(upper)) return upper;
  const byName = displayNames().get(text.toLowerCase());
  if (byName) return byName;
  return undefined;
}

/**
 * `custom(normaliseCountry)`: ISO-2 first, then rendered per the target
 * type — object → `country(ref)`, picklist → `country(picklist)`, text →
 * the ISO-2 code. An unrecognised value is sent verbatim on a text target
 * with a non-fatal `MI_COUNTRY_UNNORMALISED` diagnostic, omitted otherwise.
 */
export const normaliseCountry: CustomTransformFn = (
  value,
  row,
  ctx,
): TransformResult | undefined => {
  if (isEmpty(value)) return undefined;
  const iso2 = normaliseCountryValue(value);
  const type = ctx.targetField?.type;
  const textTarget =
    type === undefined ||
    type === "string" ||
    type === "longtext" ||
    type === "unknown";
  if (iso2 === undefined) {
    const original = String(value).trim();
    const diagnostic: RowDiagnostic = {
      kind: "custom",
      field: ctx.field.target,
      code: MI_COUNTRY_UNNORMALISED_CODE,
      value: original.slice(0, 64),
      detail: "Country_vod__c not recognised as a code or English name",
    };
    if (!textTarget) return { omit: true, diagnostic };
    const r = applyTransform({ kind: "text" }, original, row, ctx);
    return "omit" in r ? { ...r, diagnostic } : { ...r, diagnostic };
  }
  if (textTarget) return { value: iso2 };
  if (type === "picklist") {
    const entry = ctx.country.countries.byIso2(iso2);
    if (entry?.picklistValue) return { value: entry.picklistValue };
    const r = crosswalkPicklist(ctx, `medical_inquiry.country`, iso2);
    return r.value !== undefined
      ? { value: r.value, diagnostic: r.diagnostic }
      : { omit: true, diagnostic: r.diagnostic };
  }
  return applyTransform({ kind: "country", mode: "ref" }, iso2, row, ctx);
};

/**
 * `custom(inquiryState)`: lifecycle state from `Status_vod__c` only when the
 * target object is lifecycled (`ctx.metadata.lifecycle`); otherwise nothing
 * is emitted (no `state__v` on an unlifecycled object).
 */
export const inquiryState: CustomTransformFn = (
  value,
  row,
  ctx,
): TransformResult | undefined => {
  if (!ctx.metadata.lifecycle) return undefined;
  if (isEmpty(value)) return undefined;
  return applyTransform(
    { kind: "state", mapKey: "medical_inquiry.state" },
    value,
    row,
    ctx,
  );
};

/** True when the row carries no usable documented inquiry text. */
export function documentedInquiryTextMissing(row: SourceRow): boolean {
  const v = row[INQUIRY_TEXT_SOURCE];
  return isEmpty(v) || String(v).trim() === "";
}

/**
 * `custom(inquiryText)`: on the `inquiry_text__v.rich` selector row, emits
 * the rich-text alternative into `inquiry_text__v` only when the documented
 * `Inquiry_Text__c` is absent or empty (HTML is stripped when the target is
 * not RichText). Counted `MI_INQUIRY_TEXT_FROM_RICH` (non-fatal).
 */
export const inquiryText: CustomTransformFn = (
  value,
  row,
  ctx,
): TransformResult | undefined => {
  if (isEmpty(value)) return undefined;
  if (!documentedInquiryTextMissing(row)) return undefined;
  const target = ctx.metadata.fields[INQUIRY_TEXT_TARGET] ?? ctx.targetField;
  const rctx: TransformContext = { ...ctx, targetField: target };
  const r = applyTransform({ kind: "richtext" }, value, row, rctx);
  if ("omit" in r) return r;
  return {
    ...r,
    targetField: INQUIRY_TEXT_TARGET,
    diagnostic: r.diagnostic ?? {
      kind: "custom",
      field: INQUIRY_TEXT_TARGET,
      code: MI_INQUIRY_TEXT_FROM_RICH_CODE,
      detail: `${INQUIRY_TEXT_TARGET} taken from ${RICH_INQUIRY_TEXT_SOURCE}`,
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

export const medical_inquiry = defineObject({
  key: "medical_inquiry",
  source: "Medical_Inquiry_vod__c",
  target: "medical_inquiry__v",
  targetEvidence: "DOC",
  scope: {
    kind: "dated",
    predicates: [{ field: "CreatedDate", type: "datetime" }],
    openPredicate: MEDICAL_INQUIRY_OPEN_PREDICATE,
  },
  countryOf: "account",
  dependsOn: ["account", "user", "product", "call2"],
  selfRefs: [
    {
      target: "call2__v",
      source: MEDICAL_INQUIRY_CALL_FIELD,
      objectKey: "call2",
    },
  ],
  states: { ...MEDICAL_INQUIRY_STATES },
  fields: [
    // --- §6.3.29 rows
    {
      source: MEDICAL_INQUIRY_ACCOUNT_FIELD,
      target: "account__v",
      transform: "ref(account)",
      required: "Y",
      evidence: "DOC",
      sourceType: "reference",
      notes:
        "master-detail or lookup (org-specific, §8 open item 34); country-of lookup",
    },
    {
      source: MEDICAL_INQUIRY_CALL_FIELD,
      target: "call2__v",
      transform: "ref(call2) secondPass",
      required: "n",
      evidence: "UNV",
      sourceType: "reference",
      notes:
        "cyclic with call2 — omitted in pass 1, patched after the calls (§6.1 step 15)",
    },
    unv("Assign_To_User_vod__c", "assign_to_user__v", "refUser", {
      sourceType: "reference",
      notes:
        "optional business user lookup — objects.medical_inquiry.unmappedUserPolicy (§3.5)",
    }),
    {
      source: INQUIRY_TEXT_SOURCE,
      target: INQUIRY_TEXT_TARGET,
      transform: "longtext",
      required: "y?",
      evidence: "UNV",
      unverifiedSource: true,
      sourceType: "textarea",
      notes:
        "documented name without _vod (§6.3.29) — confirm via describe; target name [UNV]",
    },
    {
      source: RICH_INQUIRY_TEXT_SOURCE,
      target: `${INQUIRY_TEXT_TARGET}.rich`,
      transform: "custom(inquiryText)",
      required: "n",
      evidence: "UNV",
      unverifiedSource: true,
      optionalSource: true,
      notes:
        "[UNVERIFIED-SOURCE] rich-text alternative; feeds inquiry_text__v when Inquiry_Text__c is empty (dotted target = base field for preflight)",
    },
    {
      source: "Product_vod__c",
      target: "product__v",
      transform: "ref(product)",
      required: "n",
      evidence: "DOC",
      sourceType: "reference",
      optionalSource: true,
      notes: "newer field — confirm via describe (§8 open item 32)",
    },
    // --- status: business picklist + lifecycle state when lifecycled
    unv(
      "Status_vod__c",
      "medical_inquiry_status__v",
      "picklist(medical_inquiry.status)",
      {
        required: "Y",
        sourceType: "picklist",
        notes:
          "{New_vod, Saved_vod, Submitted_vod, Closed} → new__v/saved__v/submitted__v/closed__v [UNV]; alternative target status__v when the platform status is repurposed (overlay)",
      },
    ),
    unv("Status_vod__c", "state__v", "custom(inquiryState)", {
      notes:
        "state(medical_inquiry.state) only when medical_inquiry__v is lifecycled (§6.3.29); migration mode",
    }),
    unv(
      "Fulfillment_Status_vod__c",
      "fulfillment_status__v",
      "picklist(medical_inquiry.fulfillmentStatus)",
      { sourceType: "picklist" },
    ),
    unv("Fulfillment_Created_vod__c", "fulfillment_created__v", "bool", {
      sourceType: "boolean",
    }),
    unv("Previously_Submitted_vod__c", "previously_submitted__v", "bool", {
      sourceType: "boolean",
    }),
    {
      source: "Delivery_Method_vod__c",
      target: "delivery_method__v",
      transform: "picklist(medical_inquiry.deliveryMethod)",
      required: "n",
      evidence: "DOC",
      countryConfigurable: true,
      sourceType: "picklist",
      notes:
        "{Email_vod, Phone_vod, Mail_vod, Fax_vod, Urgent_Mail_vod, +customer values via overlays}",
    },
    // --- contact / address (country-configurable)
    unv("Email_vod__c", "email__v", "text", { countryConfigurable: true }),
    unv("Phone_Number_vod__c", "phone_number__v", "text", {
      countryConfigurable: true,
    }),
    unv("Fax_Number_vod__c", "fax_number__v", "text", {
      countryConfigurable: true,
    }),
    unv("Address_Line_1_vod__c", "address_line_1__v", "text", {
      countryConfigurable: true,
    }),
    unv("Address_Line_2_vod__c", "address_line_2__v", "text", {
      countryConfigurable: true,
    }),
    unv("City_vod__c", "city__v", "text", { countryConfigurable: true }),
    unv(
      "State_vod__c",
      "state_province__v",
      "picklist(medical_inquiry.addressState)",
      {
        countryConfigurable: true,
        sourceType: "picklist",
        notes:
          "US state picklist; spec §6.3.29 writes state__v, which is the lifecycle field on a lifecycled target — state_province__v per the §6.0.2 exception, re-point per country",
      },
    ),
    unv("Zip_vod__c", "zip__v", "text", { countryConfigurable: true }),
    unv(COUNTRY_SOURCE, "country__v", "custom(normaliseCountry)", {
      countryConfigurable: true,
      notes:
        "mixed codes/names → ISO-2 first, then rendered per target type (reference / picklist / text)",
    }),
    // --- grouping / references
    unv("Group_Identifier_vod__c", "group_identifier__v", "copy", {
      sourceType: "string",
      notes: "EXTID 100; secondary match key (§3.3)",
    }),
    unv("Group_Count_vod__c", "group_count__v", "number", {
      sourceType: "double",
    }),
    unv("Entity_Reference_Id_vod__c", "entity_reference_id__v", "copy", {
      sourceType: "string",
    }),
    // --- signature / receipt
    {
      source: "Signature_vod__c",
      target: "signature__v",
      transform: "deferredBlob(signature)",
      required: "n",
      evidence: "UNV",
      blobName: "signature",
      optionalSource: true,
      notes: "blob pass (§8.6); policy objects.medical_inquiry.blobs.signature",
    },
    unv("Signature_Date_vod__c", "signature_date__v", "datetime", {
      sourceType: "datetime",
    }),
    unv("Disclaimer_vod__c", "disclaimer__v", "longtext", {
      sourceType: "textarea",
    }),
    unv("Request_Receipt_vod__c", "request_receipt__v", "bool", {
      sourceType: "boolean",
    }),
    unv("Receipt_Email_vod__c", "receipt_email__v", "text"),
    unv("Submitted_By_Mobile_vod__c", "submitted_by_mobile__v", "bool", {
      sourceType: "boolean",
    }),
    // --- owner (y? per §6.3.29; Block S default is n)
    {
      source: "OwnerId",
      target: "ownerid__v",
      transform: "refUser",
      required: "y?",
      evidence: "UNV",
      notes:
        "queue owners → §3.4; dropped by preflight when the target has no ownerid__v",
    },
    // --- skipped section markers
    {
      source: "zvod_Delivery_Method_vod__c",
      target: "zvod_delivery_method__v",
      transform: "skip",
      required: "-",
      notes: "zvod_* section marker — never loaded (§6.0.2)",
    },
    {
      source: "zvod_Disclaimer_vod__c",
      target: "zvod_disclaimer__v",
      transform: "skip",
      required: "-",
      notes: "zvod_* section marker — never loaded (§6.0.2)",
    },
  ],
  picklists: {
    "medical_inquiry.status": { ...MEDICAL_INQUIRY_STATUS },
    "medical_inquiry.fulfillmentStatus": {
      ...MEDICAL_INQUIRY_FULFILLMENT_STATUS,
    },
    "medical_inquiry.deliveryMethod": { ...MEDICAL_INQUIRY_DELIVERY_METHOD },
    // US state picklist and country picklist values: derivation rule + overlays
    "medical_inquiry.addressState": {},
    "medical_inquiry.country": {},
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
    {
      method: "natural_key",
      keys: [
        { target: "group_identifier__v", source: "Group_Identifier_vod__c" },
      ],
      requireUnique: true,
      evidence: "UNV",
      notes:
        "group_identifier__v (§3.3) — shared by grouped inquiries, so only a unique hit matches; reported as warning with counts",
    },
  ],
  blobs: { signature: "optional" },
  custom: { normaliseCountry, inquiryState, inquiryText },
  notes:
    "Medical inquiries (§6.3.29): 2y on CreatedDate or open; country of the account; call2__v patched in pass 2 (cycle with call2); state__v only when lifecycled; Country_vod__c normalised to ISO-2; signature blob; deletes ignored (§4.4).",
});
