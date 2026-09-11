/**
 * Veeva CRM (Salesforce) → Vault CRM mapping, as data.
 *
 * Veeva's stated rule is "data model carried over except for suffixes":
 * `Xxx_vod__c` → `xxx__v`, customer `Xxx__c` → `xxx__c`. The object table
 * below records which targets were confirmed from Vault CRM help excerpts
 * (`docs/research/03-vault-crm-api-and-migration.md` §5) and which merely
 * follow the rule (`assumed`).
 */

export type MappingConfidence = "confirmed" | "assumed" | "derived";

export interface ObjectMapping {
  /** Salesforce API name. */
  source: string;
  /** Vault CRM object name. */
  target: string;
  confidence: MappingConfidence;
  note?: string;
}

/** Salesforce object → Vault CRM object. Sorted by source name. */
export const OBJECT_MAPPINGS: readonly ObjectMapping[] = [
  { source: "Account", target: "account__v", confidence: "confirmed" },
  { source: "Address_vod__c", target: "address__v", confidence: "assumed" },
  {
    source: "Approved_Document_vod__c",
    target: "approved_document__v",
    confidence: "confirmed",
  },
  {
    source: "Approved_Email_Settings_vod__c",
    target: "approved_email_settings__v",
    confidence: "assumed",
    note: "settings object name follows the suffix rule",
  },
  {
    source: "CLM_Presentation_Slide_vod__c",
    target: "clm_presentation_slide__v",
    confidence: "confirmed",
  },
  {
    source: "CLM_Presentation_vod__c",
    target: "clm_presentation__v",
    confidence: "confirmed",
  },
  {
    source: "Call2_Detail_vod__c",
    target: "call2_detail__v",
    confidence: "assumed",
  },
  {
    source: "Call2_Discussion_vod__c",
    target: "call2_discussion__v",
    confidence: "confirmed",
  },
  {
    source: "Call2_Key_Message_vod__c",
    target: "call2_key_message__v",
    confidence: "assumed",
  },
  {
    source: "Call2_Sample_vod__c",
    target: "call2_sample__v",
    confidence: "assumed",
  },
  { source: "Call2_vod__c", target: "call2__v", confidence: "confirmed" },
  {
    source: "Child_Account_vod__c",
    target: "child_account__v",
    confidence: "assumed",
  },
  { source: "Contact", target: "contact__v", confidence: "assumed" },
  {
    source: "Cycle_Plan_vod__c",
    target: "cycle_plan__v",
    confidence: "assumed",
  },
  {
    source: "EM_Attendee_vod__c",
    target: "em_attendee__v",
    confidence: "assumed",
  },
  { source: "EM_Event_vod__c", target: "em_event__v", confidence: "assumed" },
  {
    source: "Email_Activity_vod__c",
    target: "email_activity__v",
    confidence: "assumed",
  },
  {
    source: "Key_Message_vod__c",
    target: "key_message__v",
    confidence: "assumed",
  },
  {
    source: "Medical_Inquiry_vod__c",
    target: "medical_inquiry__v",
    confidence: "assumed",
  },
  {
    source: "Medical_Insight_vod__c",
    target: "medical_insight__v",
    confidence: "assumed",
  },
  {
    source: "Message_vod__c",
    target: "message__v",
    confidence: "confirmed",
    note: "records are still read by the mobile app; the Message Catalog is the source of truth",
  },
  {
    source: "Multichannel_Activity_vod__c",
    target: "multichannel_activity__v",
    confidence: "assumed",
  },
  {
    source: "Multichannel_Settings_vod__c",
    target: "multichannel_settings__v",
    confidence: "assumed",
    note: "settings object name follows the suffix rule",
  },
  {
    source: "Network_Settings_vod__c",
    target: "network_settings__v",
    confidence: "assumed",
    note: "settings object name follows the suffix rule",
  },
  {
    source: "Order_Line_vod__c",
    target: "order_line__v",
    confidence: "assumed",
  },
  { source: "Order_vod__c", target: "order__v", confidence: "assumed" },
  {
    source: "Product_Metrics_vod__c",
    target: "product_metrics__v",
    confidence: "assumed",
  },
  { source: "Product_vod__c", target: "product__v", confidence: "confirmed" },
  {
    source: "Sample_Limit_vod__c",
    target: "sample_limit__v",
    confidence: "assumed",
  },
  {
    source: "Sample_Lot_vod__c",
    target: "sample_lot__v",
    confidence: "assumed",
  },
  {
    source: "Sample_Transaction_vod__c",
    target: "sample_transaction__v",
    confidence: "assumed",
  },
  {
    source: "Sent_Email_vod__c",
    target: "sent_email__v",
    confidence: "assumed",
  },
  { source: "TSF_vod__c", target: "tsf__v", confidence: "confirmed" },
  {
    source: "Time_Off_Territory_vod__c",
    target: "time_off_territory__v",
    confidence: "confirmed",
  },
  { source: "User", target: "user__v", confidence: "confirmed" },
  {
    source: "VMobile_Object_Configuration_vod__c",
    target: "vmobile_object_configuration__v",
    confidence: "confirmed",
  },
  {
    source: "Veeva_Settings_vod__c",
    target: "veeva_settings__v",
    confidence: "confirmed",
    note: "custom-setting rows become object records scoped by application profile",
  },
];

const OBJECT_MAP = new Map(OBJECT_MAPPINGS.map((m) => [m.source, m]));

/** Table entry for a Salesforce object, or `undefined` when only the suffix rule applies. */
export function lookupObjectMapping(
  apiName: string,
): ObjectMapping | undefined {
  return OBJECT_MAP.get(apiName);
}

/** Salesforce (standard) objects that have no Vault CRM equivalent at all. */
export const UNMAPPED_STANDARD_OBJECTS: ReadonlySet<string> = new Set([
  "Lead",
  "Opportunity",
  "Case",
  "Campaign",
  "Task",
  "Event",
  "Contract",
  "Asset",
  "Solution",
]);

/** Vault object types used for record-create / record-lookup API calls. */
export const VAULT_CRM_CONFIG_OBJECTS = {
  applicationProfile: "application_profile__v",
  veevaSettings: "veeva_settings__v",
  vmoc: "vmobile_object_configuration__v",
  message: "message__v",
} as const;

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/** `CamelCase`, `Foo_Bar`, `TSF`, `Call2Detail` → `camel_case`, `foo_bar`, `tsf`, `call2_detail`. */
export function toLowerSnake(raw: string): string {
  return raw
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Strips a `_vod__c` / `_vod` / `__c` / `__v` / `__r` suffix; reports which. */
export function splitSuffix(apiName: string): {
  base: string;
  managed: boolean;
  custom: boolean;
} {
  const m = /^(.*?)(_vod)?(__[cvr])?$/i.exec(apiName) ?? [apiName, apiName];
  const base = m[1] ?? apiName;
  const managed = !!m[2];
  const custom = !!m[3];
  return { base, managed, custom };
}

/**
 * Maps a Salesforce object API name to its Vault CRM object name: table
 * lookup first, then the suffix rule (`Xxx_vod__c` → `xxx__v`, `Xxx__c` →
 * `xxx__c`, standard `Xxx` → `xxx__v`).
 */
export function mapObjectName(apiName: string): string {
  return resolveObjectMapping(apiName).target;
}

export function resolveObjectMapping(apiName: string): ObjectMapping {
  const known = OBJECT_MAP.get(apiName);
  if (known) return known;
  const { base, managed, custom } = splitSuffix(apiName);
  const slug = toLowerSnake(base);
  if (custom && !managed)
    return {
      source: apiName,
      target: `${slug}__c`,
      confidence: "derived",
      note: "customer object: created by the plan",
    };
  return {
    source: apiName,
    target: `${slug}__v`,
    confidence: "assumed",
    note: managed
      ? "Veeva-managed object: name follows the suffix rule"
      : "standard Salesforce object: existence in Vault CRM not confirmed",
  };
}

/** True when the Salesforce object is expected to exist in Vault CRM (Veeva-owned). */
export function isVeevaOwnedObject(apiName: string): boolean {
  const m = OBJECT_MAP.get(apiName);
  if (m) return true;
  const { managed, custom } = splitSuffix(apiName);
  return managed || !custom;
}

/** Standard Salesforce fields whose Vault equivalents have special names. */
export const STANDARD_FIELD_MAPPINGS: Readonly<Record<string, string>> = {
  Id: "id",
  Name: "name__v",
  OwnerId: "owner__v",
  CreatedDate: "created_date__v",
  CreatedById: "created_by__v",
  LastModifiedDate: "modified_date__v",
  LastModifiedById: "modified_by__v",
  RecordTypeId: "object_type__v",
  IsDeleted: "deleted__v",
  CurrencyIsoCode: "currency__v",
};

/**
 * Field API name → Vault field name: `Foo_vod__c` → `foo__v`, custom
 * `Foo__c` → `foo__c`, standard `Name` → `name__v`, `Phone` → `phone__v`.
 * Relationship names (`Account_vod__r`) map like their `__c` twin.
 */
export function mapFieldName(apiName: string): string {
  const std = STANDARD_FIELD_MAPPINGS[apiName];
  if (std) return std;
  const { base, managed, custom } = splitSuffix(apiName);
  const slug = toLowerSnake(base);
  if (custom && !managed) return `${slug}__c`;
  return `${slug}__v`;
}

/** `Submitted_vod` → `submitted__v`; customer `Hospital Visit` → `hospital_visit__c`. */
export function mapPicklistValueName(value: string): string {
  const { base, managed } = splitSuffix(value);
  const slug = toLowerSnake(base) || "value";
  return managed ? `${slug}__v` : `${slug}__c`;
}

/** Record type developer name → Vault object type name (`Xxx_vod` → `xxx__v`). */
export function mapRecordTypeName(developerName: string): string {
  const { base, managed } = splitSuffix(developerName);
  const slug = toLowerSnake(base) || "type";
  return managed ? `${slug}__v` : `${slug}__c`;
}

/** Vault picklist name for a Salesforce picklist field (`Call_Type_vod__c` → `call_type__v`). */
export function mapPicklistName(object: string, field: string): string {
  const { managed, custom } = splitSuffix(field);
  if (managed || !custom) return mapFieldName(field);
  const obj = toLowerSnake(splitSuffix(object).base);
  const f = toLowerSnake(splitSuffix(field).base);
  return `${obj}_${f}__c`;
}

/** Layout `Call2_vod__c-Call Layout DE` → `{ object: "call2__v", name: "call_layout_de__c" }`. */
export function mapLayoutName(fullName: string): {
  object: string;
  name: string;
  label: string;
} {
  const idx = fullName.indexOf("-");
  const objectApi = idx >= 0 ? fullName.slice(0, idx) : fullName;
  const label = idx >= 0 ? fullName.slice(idx + 1) : fullName;
  const { managed } = splitSuffix(label);
  const slug = toLowerSnake(splitSuffix(label).base) || "layout";
  return {
    object: mapObjectName(objectApi),
    name: managed ? `${slug}__v` : `${slug}__c`,
    label,
  };
}

/** Salesforce tab name (`standard-Account`, `Call2_vod__c`) → Vault tab name. */
export function mapTabName(tab: string): string {
  const stripped = tab.replace(/^standard-/, "");
  const { custom } = splitSuffix(stripped);
  const base = mapObjectName(stripped).replace(/__[cv]$/, "");
  return custom && !splitSuffix(stripped).managed
    ? `${base}_tab__c`
    : `${base}_tab__v`;
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

export interface VaultProfileNames {
  /** `sp_<slug>__c` */
  securityProfile: string;
  /** `ps_<slug>__c` */
  permissionSet: string;
  /** `app_<slug>__c` */
  applicationProfile: string;
  label: string;
}

/** Salesforce profile name → security profile / permission set / application profile names. */
export function mapProfileName(profileName: string): VaultProfileNames {
  const slug = toLowerSnake(profileName) || "profile";
  return {
    securityProfile: `sp_${slug}__c`,
    permissionSet: `ps_${slug}__c`,
    applicationProfile: `app_${slug}__c`,
    label: profileName,
  };
}

/** Country × rep-category persona names (`sp_de_sales_rep__c`, …). */
export function mapPersonaName(
  country: string,
  category: string,
): VaultProfileNames {
  const slug = toLowerSnake(`${country}_${category}`);
  const label = `${country} ${category.replace(/_/g, " ")}`;
  return {
    securityProfile: `sp_${slug}__c`,
    permissionSet: `ps_${slug}__c`,
    applicationProfile: `app_${slug}__c`,
    label,
  };
}

// ---------------------------------------------------------------------------
// Field types
// ---------------------------------------------------------------------------

export type VaultFieldTypeName =
  | "String"
  | "LongText"
  | "Number"
  | "Date"
  | "DateTime"
  | "Boolean"
  | "Picklist"
  | "Object"
  | "Formula"
  | "Unsupported";

export interface VaultFieldType {
  type: VaultFieldTypeName;
  /** Multi-value picklist. */
  multiValue?: boolean;
  confidence: MappingConfidence;
  note?: string;
}

interface TypeRule {
  /** Salesforce describe type and/or Metadata API type, lower-cased. */
  sources: string[];
  target: VaultFieldType;
}

/** Salesforce field type → Vault field type (both describe and Metadata spellings). */
export const FIELD_TYPE_MAPPINGS: readonly TypeRule[] = [
  {
    sources: ["text", "string", "encryptedstring", "combobox"],
    target: { type: "String", confidence: "confirmed" },
  },
  {
    sources: ["textarea", "longtextarea", "html", "richtextarea"],
    target: { type: "LongText", confidence: "assumed" },
  },
  {
    sources: ["number", "int", "integer", "double", "long"],
    target: { type: "Number", confidence: "confirmed" },
  },
  {
    sources: ["currency"],
    target: {
      type: "Number",
      confidence: "assumed",
      note: "currency code is not carried; Vault has no Currency type",
    },
  },
  {
    sources: ["percent"],
    target: {
      type: "Number",
      confidence: "assumed",
      note: "percent stored as a plain number",
    },
  },
  { sources: ["date"], target: { type: "Date", confidence: "confirmed" } },
  {
    sources: ["datetime"],
    target: { type: "DateTime", confidence: "confirmed" },
  },
  {
    sources: ["checkbox", "boolean"],
    target: {
      type: "Boolean",
      confidence: "assumed",
      note: "Vault Yes/No field",
    },
  },
  {
    sources: ["picklist"],
    target: { type: "Picklist", confidence: "confirmed" },
  },
  {
    sources: ["multipicklist", "multiselectpicklist"],
    target: { type: "Picklist", multiValue: true, confidence: "confirmed" },
  },
  {
    sources: ["lookup", "masterdetail", "reference", "hierarchy"],
    target: { type: "Object", confidence: "confirmed" },
  },
  {
    sources: ["formula"],
    target: {
      type: "Formula",
      confidence: "assumed",
      note: "formula syntax differs; review the expression",
    },
  },
  {
    sources: ["email", "phone", "url"],
    target: {
      type: "String",
      confidence: "assumed",
      note: "no format validation in Vault",
    },
  },
  { sources: ["id"], target: { type: "Object", confidence: "assumed" } },
  {
    sources: [
      "time",
      "base64",
      "address",
      "location",
      "anytype",
      "complexvalue",
    ],
    target: { type: "Unsupported", confidence: "assumed" },
  },
];

const FIELD_TYPE_MAP = new Map<string, VaultFieldType>();
for (const rule of FIELD_TYPE_MAPPINGS)
  for (const s of rule.sources) FIELD_TYPE_MAP.set(s, rule.target);

/**
 * Salesforce field type → Vault field type. A field with a `formula` is a
 * formula whatever its describe type says (Salesforce reports the result type).
 */
export function mapFieldType(
  sfdcType: string,
  field?: { formula?: string; referenceTo?: string[] },
): VaultFieldType {
  if (field?.formula) return FIELD_TYPE_MAP.get("formula")!;
  const key = sfdcType.trim().toLowerCase();
  const hit = FIELD_TYPE_MAP.get(key);
  if (hit) return hit;
  return {
    type: "Unsupported",
    confidence: "assumed",
    note: `unknown Salesforce type "${sfdcType}"`,
  };
}
