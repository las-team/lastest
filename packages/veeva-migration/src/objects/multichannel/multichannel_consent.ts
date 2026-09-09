/**
 * `multichannel_consent` — `Multichannel_Consent_vod__c` → `multichannel_consent__v`
 * `[DOC]` (spec §6.3.42, §6.1 step 21, §6.2, §3.3, §3.5, §4.4, §8.6).
 *
 * **Never time-scoped** (`scope: full`; the DE/EU overlays additionally pin
 * `scope.historyMonths: null` and `privacy.consentFullHistory`). Country of
 * the account. Loaded **chronologically**: client-side external sort by
 * `(Capture_Datetime_vod__c, Id)` (`load.orderBy`, §2.2 step 9 → `vaultConcurrency = 1`)
 * so latest-wins semantics hold on the target. Deleted rows are ignored on
 * the target (§4.4, regulated evidence). `noTriggers = true`.
 *
 * Object types `Approved_Email_vod → approved_email__v` `[DOC]`, `CLM_vod →
 * clm__v`, `Engage_vod → engage__v`, `Sample_Consent_vod → sample_consent__v`
 * (`[UNV]`); each must correspond to a `consent_type__v` object type.
 *
 * **Config-object crosswalks (§6.3.42).** `consent_type__v`, `consent_line__v`,
 * `content_type__v` and `sample_consent_template__v` (→ `consent_template__v`)
 * reference configuration that pre-exists in Vault (§6.1) and is never loaded.
 * One crosswalk per config object under
 * `objects.multichannel_consent.configMaps.{consentType, consentLine, contentType, consentTemplate}`,
 * keyed by the **SFDC 18-char Id** of the config row (never by label), value =
 * Vault record id | `external_id:<value>` | `name:<value>`. Resolution order
 * per referenced config row: (1) explicit map entry; (2) automatic
 * `External_ID_vod__c = external_id__v` (relationship column, `[UNVERIFIED-SOURCE]`);
 * (3) automatic `Name = name__v` (per country and object type — preflight
 * resolves and validates it by VQL; `VT_CONSENT_LINE_TYPE_MISMATCH` when the
 * line does not belong to the resolved type); no hit → omitted with a
 * `VT_CONSENT_CONFIG_UNMATCHED` diagnostic (blocking at preflight, fatal here
 * only for the required `consent_type__v`). The "selector" rows
 * (`consent_type__v.external_id`, `consent_type__v.name`, …) exist so the
 * relationship columns are extracted and validated; they emit nothing.
 *
 * `opt_type__v` (`opt_in__v` / `opt_out__v` `[DOC]`, `opt_in_pending__v`
 * `[UNV]`) and `channel_value__v` are required by Vault `[DOC]`;
 * `optout_event_type__v` is required **when the row is an opt-out**
 * (`custom(optoutEventType)` wraps the picklist crosswalk and fails the row
 * when an opt-out has no event type).
 *
 * `Signature_vod__c` (131 072 chars) goes through the blob pass (§8.6, policy
 * key `signature`, `optional` by default; the US overlay sets `required`).
 * Consent texts are evidence: `default_consent_text__v` /
 * `disclaimer_text__v` carry `truncation: fail` so an oversized value is never
 * silently cut (route to an attachment via the overlay instead).
 */
import { readSource } from "../../transform/apply";
import { isSfdcId, to15, to18 } from "../../transform/ids";
import { applyTransform } from "../../transform/registry";
import type {
  CustomTransformFn,
  TransformResult,
  TransformSpec,
} from "../../types";
import { defineObject, type ObjectModuleInput } from "../types";

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

export const MULTICHANNEL_CONSENT_ACCOUNT_FIELD = "Account_vod__c";
export const MULTICHANNEL_CONSENT_CAPTURE_FIELD = "Capture_Datetime_vod__c";
export const MULTICHANNEL_CONSENT_OPT_TYPE_FIELD = "Opt_Type_vod__c";
export const MULTICHANNEL_CONSENT_OPT_OUT_VALUE = "Opt_Out_vod";

/** Client-side external sort keys (§6.1 step 21, §2.2 step 9). */
export const MULTICHANNEL_CONSENT_ORDER_BY: string[] = [
  MULTICHANNEL_CONSENT_CAPTURE_FIELD,
  "Id",
];

/** Blob policy key for `Signature_vod__c` (`objects.multichannel_consent.blobs.signature`). */
export const MULTICHANNEL_CONSENT_SIGNATURE_BLOB = "signature";

/** Diagnostic / finding codes. */
export const VT_CONSENT_CONFIG_UNMATCHED_CODE = "VT_CONSENT_CONFIG_UNMATCHED";
export const CONSENT_OPTOUT_EVENT_TYPE_MISSING_CODE =
  "CONSENT_OPTOUT_EVENT_TYPE_MISSING";

/** `RecordType.DeveloperName` → object type api name (§6.3.42). */
export const MULTICHANNEL_CONSENT_OBJECT_TYPES: Record<string, string> = {
  Approved_Email_vod: "approved_email__v", // [DOC]
  CLM_vod: "clm__v",
  Engage_vod: "engage__v",
  Sample_Consent_vod: "sample_consent__v", // [UNV]
};

/** `Opt_Type_vod__c` → `opt_type__v` (`opt_in__v`/`opt_out__v` `[DOC]`, `opt_in_pending__v` `[UNV]`). */
export const MULTICHANNEL_CONSENT_OPT_TYPE: Record<string, string> = {
  Opt_In_vod: "opt_in__v",
  Opt_Out_vod: "opt_out__v",
  Opt_In_Pending_vod: "opt_in_pending__v",
};

/** `Optout_Event_Type_vod__c` → `optout_event_type__v` (values by the rename rule). */
export const MULTICHANNEL_CONSENT_OPTOUT_EVENT_TYPE: Record<string, string> = {
  Consent_Capture_vod: "consent_capture__v",
  Unsubscribed_vod: "unsubscribed__v",
  Bounced_vod: "bounced__v",
  Marked_Spam_vod: "marked_spam__v",
};

export const MULTICHANNEL_CONSENT_OPT_TYPE_MAP_KEY =
  "multichannel_consent.optType";
export const MULTICHANNEL_CONSENT_OPTOUT_EVENT_TYPE_MAP_KEY =
  "multichannel_consent.optoutEventType";
export const MULTICHANNEL_CONSENT_ACTIVITY_TRACKING_MODE_MAP_KEY =
  "multichannel_consent.activityTrackingMode";

/** One §6.3.42 config-object reference (crosswalk name = key under `configMaps`). */
export interface ConsentConfigObject {
  /** Crosswalk key under `objects.multichannel_consent.configMaps`. */
  mapName: "consentType" | "consentLine" | "contentType" | "consentTemplate";
  /** Lookup column on the consent row. */
  source: string;
  /** Target reference field on `multichannel_consent__v`. */
  target: string;
  /** SFDC config object (extracted read-only, §6.1). */
  sfdcObject: string;
  /** Vault config object the target references (pre-exists, §6.1). */
  vaultObject: string;
}

export const CONSENT_TYPE_CONFIG: ConsentConfigObject = {
  mapName: "consentType",
  source: "Consent_Type_vod__c",
  target: "consent_type__v",
  sfdcObject: "Consent_Type_vod__c",
  vaultObject: "consent_type__v",
};
export const CONSENT_LINE_CONFIG: ConsentConfigObject = {
  mapName: "consentLine",
  source: "Consent_Line_vod__c",
  target: "consent_line__v",
  sfdcObject: "Consent_Line_vod__c",
  vaultObject: "consent_line__v",
};
export const CONTENT_TYPE_CONFIG: ConsentConfigObject = {
  mapName: "contentType",
  source: "Content_Type_vod__c",
  target: "content_type__v",
  sfdcObject: "Content_Type_vod__c",
  vaultObject: "content_type__v",
};
export const CONSENT_TEMPLATE_CONFIG: ConsentConfigObject = {
  mapName: "consentTemplate",
  source: "Sample_Consent_Template_vod__c",
  target: "sample_consent_template__v",
  sfdcObject: "Consent_Template_vod__c",
  vaultObject: "consent_template__v",
};

export const MULTICHANNEL_CONSENT_CONFIG_OBJECTS: readonly ConsentConfigObject[] =
  [
    CONSENT_TYPE_CONFIG,
    CONSENT_LINE_CONFIG,
    CONTENT_TYPE_CONFIG,
    CONSENT_TEMPLATE_CONFIG,
  ];

/** Names of the config crosswalks (`configObjects`, checked by preflight). */
export const MULTICHANNEL_CONSENT_CONFIG_MAP_NAMES: string[] =
  MULTICHANNEL_CONSENT_CONFIG_OBJECTS.map((c) => c.mapName);

/** Relationship column carrying the config row's `External_ID_vod__c` (`[UNVERIFIED-SOURCE]`). */
export function configExternalIdPath(source: string): string {
  return `${source.replace(/__c$/, "__r")}.External_ID_vod__c`;
}
/** Relationship column carrying the config row's `Name`. */
export function configNamePath(source: string): string {
  return `${source.replace(/__c$/, "__r")}.Name`;
}

// ---------------------------------------------------------------------------
// helpers (pure)
// ---------------------------------------------------------------------------

export function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

/**
 * `objects.multichannel_consent.configMaps.<mapName>` as a lookup with keys
 * normalised to 18 chars (an overlay may still write a 15-char id).
 */
export function configMapOf(
  options: Record<string, unknown>,
  mapName: string,
): Record<string, string> | undefined {
  const maps = options.configMaps;
  if (!maps || typeof maps !== "object") return undefined;
  const raw = (maps as Record<string, unknown>)[mapName];
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v !== "string" || !v) continue;
    out[isSfdcId(k) ? to18(k) : k] = v;
  }
  return out;
}

/**
 * Build the `custom(<mapName>)` transform of one config-object reference
 * (§6.3.42 resolution order). Only the base row (`target === cfg.target`)
 * emits; the selector rows (`<target>.external_id`, `<target>.name`) return
 * `undefined` so their columns are merely extracted.
 */
export function consentConfigRef(cfg: ConsentConfigObject): CustomTransformFn {
  const externalIdPath = configExternalIdPath(cfg.source);
  const namePath = configNamePath(cfg.source);
  return (value, row, ctx): TransformResult | undefined => {
    const target = ctx.field.target;
    if (target !== cfg.target) return undefined;
    if (isEmpty(value)) return undefined;
    const raw = String(value).trim();
    if (!isSfdcId(raw))
      return {
        omit: true,
        diagnostic: {
          kind: "invalid_value",
          field: target,
          code: "INVALID_ID",
          value: raw,
        },
      };
    const id = to18(raw);
    // (1) explicit map entry — keyed by SFDC id (18 or 15), never by label
    const map = configMapOf(ctx.mapping.options, cfg.mapName);
    const entry = map?.[id] ?? map?.[to15(id)];
    if (entry) {
      if (entry.startsWith("external_id:"))
        return {
          value: entry.slice("external_id:".length),
          targetField: `${target}.external_id__v`,
        };
      if (entry.startsWith("name:"))
        return {
          value: entry.slice("name:".length),
          targetField: `${target}.name__v`,
        };
      // Vault record id resolved at preflight — config crosswalk exception (§6.3.42), as country(ref)
      return { value: entry };
    }
    // (2) automatic: config row External_ID_vod__c = external_id__v
    const ext = readSource(row, externalIdPath);
    if (!isEmpty(ext))
      return {
        value: String(ext).trim(),
        targetField: `${target}.external_id__v`,
      };
    // (3) automatic: config row Name = name__v (per country / object type, validated at preflight)
    const name = readSource(row, namePath);
    if (!isEmpty(name))
      return { value: String(name).trim(), targetField: `${target}.name__v` };
    // no hit: blocking at preflight (VT_CONSENT_CONFIG_UNMATCHED); fatal here only when required
    const required =
      ctx.mapping.required[target] ?? ctx.targetField?.required ?? false;
    return {
      omit: true,
      diagnostic: {
        kind: "unresolved_fk",
        field: target,
        code: VT_CONSENT_CONFIG_UNMATCHED_CODE,
        value: id,
        fatal: required,
        detail: `${cfg.sfdcObject} row has no Vault match (configMaps.${cfg.mapName} / External_ID_vod__c / Name) — §6.3.42`,
      },
    };
  };
}

export const consentType = consentConfigRef(CONSENT_TYPE_CONFIG);
export const consentLine = consentConfigRef(CONSENT_LINE_CONFIG);
export const contentType = consentConfigRef(CONTENT_TYPE_CONFIG);
export const consentTemplate = consentConfigRef(CONSENT_TEMPLATE_CONFIG);

const OPTOUT_EVENT_TYPE_SPEC: TransformSpec = {
  kind: "picklist",
  mapKey: MULTICHANNEL_CONSENT_OPTOUT_EVENT_TYPE_MAP_KEY,
};

/**
 * `custom(optoutEventType)`: `Optout_Event_Type_vod__c → optout_event_type__v`
 * through the regular picklist crosswalk (`multichannel_consent.optoutEventType`),
 * **required when the row is an opt-out** (`Opt_Type_vod__c = Opt_Out_vod`,
 * §6.3.42 "Y (opt-out)"): an opt-out without an event type fails the row.
 */
export const optoutEventType: CustomTransformFn = (
  value,
  row,
  ctx,
): TransformResult | undefined => {
  const optOut =
    String(
      readSource(row, MULTICHANNEL_CONSENT_OPT_TYPE_FIELD) ?? "",
    ).trim() === MULTICHANNEL_CONSENT_OPT_OUT_VALUE;
  if (isEmpty(value)) {
    if (!optOut) return undefined;
    return {
      omit: true,
      diagnostic: {
        kind: "required_missing",
        field: ctx.field.target,
        code: CONSENT_OPTOUT_EVENT_TYPE_MISSING_CODE,
        fatal: true,
        detail:
          "optout_event_type__v is required by Vault when opt_type__v = opt_out__v (§6.3.42)",
      },
    };
  }
  const r = applyTransform(OPTOUT_EVENT_TYPE_SPEC, value, row, ctx);
  if ("omit" in r && optOut && r.diagnostic && !r.diagnostic.fatal)
    return {
      ...r,
      diagnostic: {
        ...r.diagnostic,
        fatal: true,
        detail:
          "optout_event_type__v is required by Vault when opt_type__v = opt_out__v (§6.3.42)",
      },
    };
  return r;
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

/** Base row + the two selector rows of one config-object reference (§6.3.42). */
function configRows(cfg: ConsentConfigObject, required: "Y" | "n"): RowInput[] {
  return [
    {
      source: cfg.source,
      target: cfg.target,
      transform: `custom(${cfg.mapName})`,
      required,
      evidence: "DOC",
      sourceType: "reference",
      countryConfigurable: true,
      notes: `${cfg.vaultObject} pre-exists (§6.1); objects.multichannel_consent.configMaps.${cfg.mapName} keyed by SFDC 18-char Id (value: Vault id | external_id:<v> | name:<v>), else ${cfg.sfdcObject}.External_ID_vod__c = external_id__v, then Name = name__v per country/object type; unmatched → blocking VT_CONSENT_CONFIG_UNMATCHED`,
    },
    {
      source: configExternalIdPath(cfg.source),
      target: `${cfg.target}.external_id`,
      transform: `custom(${cfg.mapName})`,
      required: "n",
      evidence: "DOC",
      unverifiedSource: true,
      optionalSource: true,
      notes: `selector row: ${cfg.sfdcObject}.External_ID_vod__c [UNVERIFIED-SOURCE] for the automatic match (2)`,
    },
    {
      source: configNamePath(cfg.source),
      target: `${cfg.target}.name`,
      transform: `custom(${cfg.mapName})`,
      required: "n",
      evidence: "DOC",
      optionalSource: true,
      notes: `selector row: ${cfg.sfdcObject}.Name for the automatic match (3)`,
    },
  ];
}

export const multichannel_consent = defineObject({
  key: "multichannel_consent",
  source: "Multichannel_Consent_vod__c",
  target: "multichannel_consent__v",
  targetEvidence: "DOC",
  // never time-scoped (§6.2): full history of opt-ins and opt-outs
  scope: { kind: "full" },
  countryOf: "account",
  dependsOn: ["account", "product", "sent_email"],
  orderBy: [...MULTICHANNEL_CONSENT_ORDER_BY],
  objectTypes: { ...MULTICHANNEL_CONSENT_OBJECT_TYPES },
  fields: [
    // --- account (§6.3.42 row 1)
    {
      source: MULTICHANNEL_CONSENT_ACCOUNT_FIELD,
      target: "account__v",
      transform: "ref(account)",
      required: "Y",
      evidence: "UNV",
      sourceType: "reference",
      notes: "master-detail; country-of lookup",
    },
    // --- config-object references (row 2): one crosswalk per config object
    ...configRows(CONSENT_TYPE_CONFIG, "Y"),
    ...configRows(CONSENT_LINE_CONFIG, "n"),
    ...configRows(CONTENT_TYPE_CONFIG, "n"),
    ...configRows(CONSENT_TEMPLATE_CONFIG, "n"),
    // --- opt type / opt-out event (rows 3–4)
    {
      source: MULTICHANNEL_CONSENT_OPT_TYPE_FIELD,
      target: "opt_type__v",
      transform: `picklist(${MULTICHANNEL_CONSENT_OPT_TYPE_MAP_KEY})`,
      required: "Y",
      evidence: "DOC",
      sourceType: "picklist",
      notes:
        "{Opt_In_Pending_vod, Opt_In_vod, Opt_Out_vod} → opt_in__v/opt_out__v [DOC], opt_in_pending__v [UNV]",
    },
    {
      source: "Optout_Event_Type_vod__c",
      target: "optout_event_type__v",
      transform: "custom(optoutEventType)",
      required: "n",
      evidence: "DOC",
      sourceType: "picklist",
      notes: `picklist(${MULTICHANNEL_CONSENT_OPTOUT_EVENT_TYPE_MAP_KEY}) {Consent_Capture_vod, Unsubscribed_vod, Bounced_vod, Marked_Spam_vod}; required when Opt_Type_vod__c = Opt_Out_vod (Y (opt-out))`,
    },
    // --- channel (row 5)
    {
      source: "Channel_Value_vod__c",
      target: "channel_value__v",
      transform: "text",
      required: "Y",
      evidence: "DOC",
      sourceType: "string",
      notes: "80 chars in SFDC; required by Vault [DOC]",
    },
    unv("Sub_Channel_Key_vod__c", "sub_channel_key__v", "text", {
      sourceType: "string",
    }),
    // --- dates (row 6)
    {
      source: MULTICHANNEL_CONSENT_CAPTURE_FIELD,
      target: "capture_datetime__v",
      transform: "datetime",
      required: "y?",
      evidence: "UNV",
      sourceType: "datetime",
      notes: "chronological load key (external sort with Id)",
    },
    unv(
      "Consent_Confirm_Datetime_vod__c",
      "consent_confirm_datetime__v",
      "datetime",
      { sourceType: "datetime" },
    ),
    unv("Signature_Datetime_vod__c", "signature_datetime__v", "datetime", {
      sourceType: "datetime",
    }),
    unv("Opt_Expiration_Date_vod__c", "opt_expiration_date__v", "date", {
      sourceType: "date",
    }),
    // --- product / email references (row 7)
    ref("Product_vod__c", "product__v", "product"),
    ref("Detail_Group_vod__c", "detail_group__v", "product"),
    ref("Sent_Email_vod__c", "sent_email__v", "sent_email"),
    // --- ids (row 8); external_id__v replaces the Block S row (same target, UNV for this object)
    unv("External_ID_vod__c", "external_id__v", "copy", {
      sourceType: "string",
      optionalSource: true,
      notes:
        "unique (120); secondary match key (§3.3); never overwrite an integration-owned value",
    }),
    unv("Related_Transaction_Id_vod__c", "related_transaction_id__v", "copy", {
      sourceType: "string",
    }),
    unv("Signature_ID_vod__c", "signature_id__v", "copy", {
      sourceType: "string",
    }),
    // --- signature / consent texts (row 9)
    {
      source: "Signature_vod__c",
      target: "signature__v",
      transform: `deferredBlob(${MULTICHANNEL_CONSENT_SIGNATURE_BLOB})`,
      required: "n",
      evidence: "UNV",
      blobName: MULTICHANNEL_CONSENT_SIGNATURE_BLOB,
      sourceType: "textarea",
      notes:
        "131072 chars; blob pass (§8.6) under objects.multichannel_consent.blobs.signature (optional; US overlay: required)",
    },
    unv("Default_Consent_Text_vod__c", "default_consent_text__v", "longtext", {
      sourceType: "textarea",
      truncation: "fail",
      notes:
        "consent text is evidence: truncation policy fail → route to attachment via overlay",
    }),
    unv("Disclaimer_Text_vod__c", "disclaimer_text__v", "longtext", {
      sourceType: "textarea",
      truncation: "fail",
      notes:
        "65536 chars; consent text is evidence: truncation policy fail → route to attachment via overlay",
    }),
    // --- activity tracking (row 10)
    {
      source: "Activity_Tracking_vod__c",
      target: "activity_tracking__v",
      transform: "longtext",
      required: "n",
      evidence: "DOC",
      sourceType: "textarea",
    },
    {
      source: "Activity_Tracking_Mode_vod__c",
      target: "activity_tracking_mode__v",
      transform: `picklist(${MULTICHANNEL_CONSENT_ACTIVITY_TRACKING_MODE_MAP_KEY})`,
      required: "n",
      evidence: "DOC",
      sourceType: "picklist",
      optionalSource: true,
      notes: "newer field (confirm via describe); values by the rename rule",
    },
    // --- sample consent (row 11)
    unv(
      "Sample_Consent_Template_Data_vod__c",
      "sample_consent_template_data__v",
      "longtext",
      { sourceType: "textarea" },
    ),
  ],
  picklists: {
    [MULTICHANNEL_CONSENT_OPT_TYPE_MAP_KEY]: {
      ...MULTICHANNEL_CONSENT_OPT_TYPE,
    },
    [MULTICHANNEL_CONSENT_OPTOUT_EVENT_TYPE_MAP_KEY]: {
      ...MULTICHANNEL_CONSENT_OPTOUT_EVENT_TYPE,
    },
    // derivation rule + overlays
    [MULTICHANNEL_CONSENT_ACTIVITY_TRACKING_MODE_MAP_KEY]: {},
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
      evidence: "UNV",
    },
    {
      method: "mobile_id",
      keys: [{ target: "mobile_id__v", source: "Mobile_ID_vod__c" }],
      evidence: "UNV",
    },
    {
      method: "natural_key",
      keys: [
        { target: "account__v", source: MULTICHANNEL_CONSENT_ACCOUNT_FIELD },
        { target: "consent_type__v", source: "Consent_Type_vod__c" },
        { target: "channel_value__v", source: "Channel_Value_vod__c" },
        {
          target: "capture_datetime__v",
          source: MULTICHANNEL_CONSENT_CAPTURE_FIELD,
          transform: { kind: "datetime" },
        },
      ],
      sameCountry: true,
      evidence: "UNV",
      notes: "reported as a warning with counts for review before init (§3.3)",
    },
  ],
  blobs: { [MULTICHANNEL_CONSENT_SIGNATURE_BLOB]: "optional" },
  configObjects: [...MULTICHANNEL_CONSENT_CONFIG_MAP_NAMES],
  custom: {
    consentType,
    consentLine,
    contentType,
    consentTemplate,
    optoutEventType,
  },
  optionDefaults: { configMaps: {} },
  notes:
    "Multichannel consent (§6.3.42): never time-scoped, country of the account, loaded chronologically by (Capture_Datetime_vod__c, Id) with vaultConcurrency = 1; consent_type__v/consent_line__v/content_type__v/sample_consent_template__v via objects.multichannel_consent.configMaps (config pre-exists, §6.1); optout_event_type__v required for opt-outs; signature via the blob pass; deletes ignored (§4.4).",
});
