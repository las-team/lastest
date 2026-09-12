/**
 * Shared domain types for @lastest/veeva-migration.
 *
 * Every module boundary in this package is expressed with the types in this
 * file (plus the per-area interface files `src/<area>/types.ts`). Section
 * references (§) point at docs/MIGRATION_SPEC.md.
 *
 * Rules for builders:
 *  - Never add a Vault id to a payload (§2.3): references are `DeferredFk` /
 *    `DeferredUser` / `DeferredComposite` and are resolved by the loader at
 *    send time.
 *  - `[UNVERIFIED]` API names are defaults carried in `evidence`; preflight
 *    (§5) validates them, code never assumes them.
 */

// ---------------------------------------------------------------------------
// Object keys, countries, run modes
// ---------------------------------------------------------------------------

/** The 46 object keys of v1 (§6.2), in §6.1 load order. */
export const OBJECT_KEYS = [
  "country",
  "user",
  "territory",
  "user_territory",
  "product",
  "product_group",
  "account",
  "address",
  "child_account",
  "affiliation",
  "account_territory",
  "tsf",
  "product_metrics",
  "key_message",
  "clm_presentation",
  "clm_presentation_slide",
  "approved_document",
  "sample_lot",
  "em_venue",
  "em_catalog",
  "em_speaker",
  "em_event",
  "em_attendee",
  "em_event_speaker",
  "em_event_team_member",
  "expense_header",
  "expense_line",
  "medical_event",
  "event_attendee",
  "account_plan",
  "medical_inquiry",
  "call2",
  "call2_detail",
  "call2_discussion",
  "call2_key_message",
  "call2_sample",
  "sample_transaction",
  "sample_inventory",
  "sample_inventory_item",
  "order",
  "order_line",
  "sent_email",
  "email_activity",
  "multichannel_consent",
  "multichannel_activity",
  "multichannel_activity_line",
] as const;

export type ObjectKey = (typeof OBJECT_KEYS)[number];

export function isObjectKey(value: unknown): value is ObjectKey {
  return (
    typeof value === "string" &&
    (OBJECT_KEYS as readonly string[]).includes(value)
  );
}

/** ISO-3166 alpha-2 (`US`, `DE`, …) or the pseudo-country `GLOBAL` (§0.2). */
export type CountryCode = string;
export const GLOBAL_COUNTRY = "GLOBAL";

/** CLI modes (§2.7, §8.10). */
export type RunMode =
  | "preflight"
  | "init"
  | "delta"
  | "final-delta"
  | "verify"
  | "retry-failed"
  | "blobs"
  | "report";

export const RUN_MODES: readonly RunMode[] = [
  "preflight",
  "init",
  "delta",
  "final-delta",
  "verify",
  "retry-failed",
  "blobs",
  "report",
];

/** Unit of work = (object key, country) (§0.2, §1.2). */
export interface Unit {
  objectKey: ObjectKey;
  country: CountryCode;
}

export function unitId(unit: Unit): string {
  return `${unit.objectKey}:${unit.country}`;
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

/** Evidence tags of §0.1 (`UNV` = `[UNVERIFIED]`). */
export type EvidenceTag =
  | "SRC"
  | "META"
  | "OBS"
  | "DOC"
  | "SEC"
  | "UNV"
  | "UNVERIFIED-SOURCE"
  | "GEN";

// ---------------------------------------------------------------------------
// Rows, payloads, diagnostics
// ---------------------------------------------------------------------------

/**
 * One extracted SFDC row. Keys are SFDC API names; relationship columns are
 * flattened with dots exactly as Bulk CSV headers spell them
 * (`Account_vod__r.Country_vod__r.Alpha_2_Code_vod__c`). Values are the raw
 * CSV/JSON values (strings for CSV pages; booleans/numbers for REST JSON).
 * `Id` is always present; `IsDeleted`/`SystemModstamp` are always selected
 * (§2.2 step 2).
 */
export interface SourceRow {
  Id: string;
  IsDeleted?: boolean | string;
  SystemModstamp?: string;
  [column: string]: unknown;
}

/** Deferred object reference (§2.3): resolved through the id map at send time. */
export interface DeferredFk {
  $fk: { object: ObjectKey; sfdcId: string };
}

/** Deferred user reference (§2.3): resolved through the user map at send time. */
export interface DeferredUser {
  $user: string;
}

/**
 * Deferred composite string (`compositeExternalId`, §3.2): the loader renders
 * `template` by substituting `{token}` with the resolved part.
 */
export interface DeferredComposite {
  $composite: {
    template: string;
    parts: Record<string, DeferredFk | DeferredUser | string>;
  };
}

export type DeferredValue = DeferredFk | DeferredUser | DeferredComposite;

export type PayloadScalar = string | number | boolean | null;
export type PayloadValue = PayloadScalar | DeferredValue;

/** Vault payload row keyed by target API names (lookup keys like `product__v.external_id__v` allowed). */
export type Payload = Record<string, PayloadValue>;

export function isDeferredFk(v: unknown): v is DeferredFk {
  return typeof v === "object" && v !== null && "$fk" in v;
}
export function isDeferredUser(v: unknown): v is DeferredUser {
  return typeof v === "object" && v !== null && "$user" in v;
}
export function isDeferredComposite(v: unknown): v is DeferredComposite {
  return typeof v === "object" && v !== null && "$composite" in v;
}
export function isDeferredValue(v: unknown): v is DeferredValue {
  return isDeferredFk(v) || isDeferredUser(v) || isDeferredComposite(v);
}

/** Per-row diagnostic kinds (§2.3, §3.4, §3.5, §5.1, §6.0.4). */
export type RowDiagnosticKind =
  | "skipped"
  | "truncated"
  | "unresolved_fk"
  | "unmapped_picklist"
  | "out_of_range"
  | "invalid_value"
  | "queue_owner_replaced"
  | "audit_user_fallback"
  | "contact_ref_dropped"
  | "out_of_scope_ref_dropped"
  | "required_missing"
  | "second_pass"
  | "deferred_blob"
  | "unmapped_user"
  | "country_unresolved"
  | "custom";

export interface RowDiagnostic {
  kind: RowDiagnosticKind;
  /** Target field (or source field when no target applies). */
  field?: string;
  /** Machine code, e.g. `CONTACT_REF_DROPPED`, `UNRESOLVED_FK`, `erased`. */
  code?: string;
  /** Offending value (ids/picklist names only — never free text at info). */
  value?: string;
  /** Referenced object for FK diagnostics. */
  objectKey?: ObjectKey;
  detail?: string;
  /** When true the row is failed/skipped rather than loaded (policy `fail`). */
  fatal?: boolean;
}

/** `row_results.state` (§2.4). */
export type RowState =
  | "extracted"
  | "transformed"
  | "skipped"
  | "pending_fk"
  | "loaded_created"
  | "loaded_updated"
  | "loaded_unchanged"
  | "failed"
  | "deleted"
  | "inactivated";

export const ROW_STATES: readonly RowState[] = [
  "extracted",
  "transformed",
  "skipped",
  "pending_fk",
  "loaded_created",
  "loaded_updated",
  "loaded_unchanged",
  "failed",
  "deleted",
  "inactivated",
];

/** Accepted `skipped` reasons without an exception file (§8.8). */
export type SkipReason =
  | "erased"
  | "rule"
  | "contact_ref"
  | "country_unresolved"
  | "out_of_scope_ref"
  | (string & {});

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

export type FindingSeverity = "blocking" | "warning" | "info";

/** Preflight / mapping / runtime finding (§5). `code` is a stable identifier. */
export interface Finding {
  severity: FindingSeverity;
  code: string;
  objectKey?: ObjectKey | string;
  country?: CountryCode;
  field?: string;
  detail: string | Record<string, unknown>;
  count?: number;
}

// ---------------------------------------------------------------------------
// Scope, countryOf, policies
// ---------------------------------------------------------------------------

/** Retention families a per-country knob may only widen (§7.2). */
export type RetentionFamily = "samples" | "tov";

export interface ScopePredicateField {
  field: string;
  type: "date" | "datetime";
}

/**
 * How an object is scoped (§1.1, §6.2).
 *  - `full`: every non-deleted row.
 *  - `dated`: `OR` of `predicates[].field >= cutoff` plus the optional
 *    `openPredicate` (SOQL fragment for always-in-scope items, §1.1 #4).
 *  - `via-parent`: scoped through the parent's date, expressed as a SOQL
 *    relationship path (`Call2_vod__r.Call_Date_vod__c`).
 */
export type ScopeSpec =
  | { kind: "full" }
  | {
      kind: "dated";
      predicates: ScopePredicateField[];
      openPredicate?: string;
      retentionFamily?: RetentionFamily;
    }
  | {
      kind: "via-parent";
      parentKey: ObjectKey;
      /** SOQL relationship path to the parent's scope date, e.g. `Call2_vod__r.Call_Date_vod__c`. */
      parentField: string;
      type?: "date" | "datetime";
      retentionFamily?: RetentionFamily;
    };

/**
 * Parsed `countryOf` rule (§6.0.5 grammar, closed):
 *   field:<path> | account[:<field>] | user[:<field>] | parent:<key>[:<field>] | global | const:<ISO>
 * A module's `countryOf` is an ordered fallback list.
 */
export type CountryOfSpec =
  | { kind: "field"; path: string }
  | { kind: "account"; field?: string }
  | { kind: "user"; field?: string }
  | { kind: "parent"; key: ObjectKey; field?: string }
  | { kind: "global" }
  | { kind: "const"; iso2: string };

export type DeletePolicy = "delete" | "inactivate" | "ignore";
export type CreatePolicy = "create" | "match-only";
export type UnmappedUserPolicy = "fail" | "migrationUser" | "skipRow" | "omit";
export type TruncationPolicy = "truncate" | "fail" | "omit";
export type SampleStrategy =
  | "noTriggersRecalc"
  | "noTriggersVerify"
  | "triggersOnTransactions"
  | "triggersOnCallSamples";
export type BlobPolicy = "required" | "optional" | "attachment" | "skip";

/** Load flags per object (§2.5.4, §2.2 step 9, §7.2). */
export interface LoadOptions {
  /** `X-VaultAPI-NoTriggers` (§2.5.4). */
  noTriggers: boolean;
  /** `X-VaultAPI-MigrationMode`; default from `target.migrationMode`. */
  migrationMode?: boolean;
  /** ≤ 500 (§2.5.4). */
  batchSize?: number;
  /** Two sequential extracts: `field = null` then `field != null` (§2.2 step 9). */
  partitionBy?: { field: string; order: ["null", "notNull"] };
  /** Client-side external sort keys (§2.2 step 9); forces `vaultConcurrency = 1`. */
  orderBy?: string[];
  /** Depth ordering by a self-parent field (§2.2 step 9). */
  depthOrderBy?: string;
  sampleStrategy?: SampleStrategy;
  fallbackStrategy?: SampleStrategy;
  sampleTriggerRejectFallback?: boolean;
  /** `vobjects` (default) or `loader` (§2.5.4). */
  strategy?: "vobjects" | "loader";
}

// ---------------------------------------------------------------------------
// Matching (§3.3)
// ---------------------------------------------------------------------------

/** `id_map.match_method` values (§2.4). */
export type MatchMethod =
  | "created"
  | "legacy_id"
  | "external_id"
  | "network_vid"
  | "mobile_id"
  | "username"
  | "federated_id"
  | "email"
  | "name_type"
  | "natural_key"
  | "manual"
  | "merged";

/** One (target field ← source field) pair used by a match rule. */
export interface MatchKey {
  /** Vault field (or relationship path) compared against. */
  target: string;
  /** SFDC column supplying the value; may be a computed alias (see `transform`). */
  source: string;
  /** Optional transform applied to the source value before comparison. */
  transform?: TransformSpec;
  caseInsensitive?: boolean;
}

/**
 * One precedence step of §3.3. The id map is always consulted first and is
 * not listed. `legacy_id` uses the resolved legacy-id field (§3.2) and needs
 * no keys. `natural_key` rules are reported as warnings with counts.
 */
export interface MatchRule {
  method: Exclude<MatchMethod, "created" | "manual" | "merged">;
  keys?: MatchKey[];
  /** Match only when exactly one active hit (users by email, §3.3). */
  requireUnique?: boolean;
  /** Restrict candidates to the same country / object type. */
  sameCountry?: boolean;
  sameObjectType?: boolean;
  evidence?: EvidenceTag;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Transforms (§6.0.3)
// ---------------------------------------------------------------------------

export type CountryMode = "ref" | "iso2" | "picklist" | "name";
export type LocaleKind = "language" | "locale";

/** Condition on a source flag for `statusFromFlag` (§6.0.4). */
export type FlagCondition =
  | { equals: string | boolean | number | null }
  | { in: Array<string | boolean | number> }
  | { notEquals: string | boolean | number | null };

/** One part of a `compositeExternalId` template token. */
export type CompositePart =
  | { ref: ObjectKey; source: string }
  | { user: string }
  | { field: string }
  | { const: string };

/**
 * Discriminated union covering every registry entry of §6.0.3. `secondPass`
 * and `deferredBlob` wrap an inner spec (the value transform that runs in the
 * later pass); `dateRange` is applied implicitly by `date`/`datetime`.
 */
export type TransformSpec =
  | { kind: "copy" }
  | { kind: "text"; max?: number }
  | { kind: "longtext"; max?: number }
  | { kind: "richtext" }
  | { kind: "bool" }
  | { kind: "number"; scale?: number }
  | { kind: "date" }
  | { kind: "datetime" }
  | { kind: "datetimeToDate" }
  | { kind: "picklist"; mapKey: string }
  | { kind: "multipicklist"; mapKey: string }
  | { kind: "objectType"; mapKey: string }
  | { kind: "state"; mapKey: string }
  | { kind: "ref"; objectKey: ObjectKey }
  | { kind: "refUser" }
  | { kind: "refLookup"; objectKey: ObjectKey; lookupField: string }
  | { kind: "legacyId" }
  | { kind: "country"; mode: CountryMode }
  | { kind: "territoryRef" }
  | { kind: "nameTemplate"; templateKey: string }
  | { kind: "currency" }
  | { kind: "userTimezone" }
  | { kind: "localeLookup"; localeKind: LocaleKind }
  | { kind: "statusFromFlag"; sourceFlag: string; inactiveWhen: FlagCondition }
  | { kind: "const"; value: PayloadScalar }
  | {
      kind: "compositeExternalId";
      template: string;
      parts: Record<string, CompositePart>;
    }
  | { kind: "secondPass"; inner: TransformSpec }
  | { kind: "deferredBlob"; inner?: TransformSpec; blobName?: string }
  | { kind: "skip" }
  | { kind: "custom"; fnName: string };

export type TransformKind = TransformSpec["kind"];

export const TRANSFORM_KINDS: readonly TransformKind[] = [
  "copy",
  "text",
  "longtext",
  "richtext",
  "bool",
  "number",
  "date",
  "datetime",
  "datetimeToDate",
  "picklist",
  "multipicklist",
  "objectType",
  "state",
  "ref",
  "refUser",
  "refLookup",
  "legacyId",
  "country",
  "territoryRef",
  "nameTemplate",
  "currency",
  "userTimezone",
  "localeLookup",
  "statusFromFlag",
  "const",
  "compositeExternalId",
  "secondPass",
  "deferredBlob",
  "skip",
  "custom",
];

/** `Req` column of §6.0.1. */
export type Requirement = "K" | "Y" | "y?" | "n" | "-";

/** SFDC describe field types (§2.1.3). */
export type SfdcFieldType =
  | "id"
  | "string"
  | "textarea"
  | "picklist"
  | "multipicklist"
  | "reference"
  | "boolean"
  | "int"
  | "double"
  | "currency"
  | "percent"
  | "date"
  | "datetime"
  | "email"
  | "phone"
  | "url"
  | "encryptedstring"
  | "base64"
  | "location"
  | "address"
  | "anyType"
  | "combobox"
  | "time";

/** One row of a §6.3 mapping table (plus Block S rows contributed by `blockS()`). */
export interface FieldMapping {
  /** SFDC column (API name or relationship path). Empty string for synthesised fields. */
  source: string;
  /** Vault target field API name (`object_type__v.api_name__v`, `state__v` … allowed). */
  target: string;
  transform: TransformSpec;
  required: Requirement;
  /** `CC` column: crosswalk/required-ness/format lives in the country overlay. */
  countryConfigurable?: boolean;
  /** Evidence for the **target** name (§0.1). */
  evidence?: EvidenceTag;
  /** Source name is `[UNVERIFIED-SOURCE]`: a describe miss is `info`, never blocking. */
  unverifiedSource?: boolean;
  /** Source field is org-optional ("if present" rows of Block S): a describe miss is `info`, row dropped. */
  optionalSource?: boolean;
  /** Declared SFDC type, checked by preflight (`SF_FIELD_TYPE_MISMATCH`). */
  sourceType?: SfdcFieldType;
  /** Send JSON `null` when the source is empty (default: key omitted, §2.5.4). */
  clearOnNull?: boolean;
  truncation?: TruncationPolicy;
  /** Row kept only when `objects.<key>.<flag>` is truthy (e.g. `loadUnlockFlag`). */
  enabledBy?: string;
  /** Row removed when `objects.<key>.<flag>` is explicitly `false` (e.g. `statusFromFlag`). */
  disabledBy?: string;
  /** Blob name for `deferredBlob` rows (`signature`, `emailBody`, …) — keys `objects.<key>.blobs`. */
  blobName?: string;
  notes?: string;
}

// ---------------------------------------------------------------------------
// SFDC describe (§2.1.3)
// ---------------------------------------------------------------------------

export interface SfdcPicklistValue {
  value: string;
  label?: string;
  active: boolean;
  defaultValue?: boolean;
  validFor?: string | null;
}

export interface SfdcFieldDescribe {
  name: string;
  label?: string;
  type: SfdcFieldType;
  length?: number;
  precision?: number;
  scale?: number;
  nillable: boolean;
  calculated: boolean;
  autoNumber: boolean;
  externalId: boolean;
  unique: boolean;
  idLookup?: boolean;
  nameField: boolean;
  custom: boolean;
  createable?: boolean;
  updateable?: boolean;
  filterable?: boolean;
  referenceTo: string[];
  relationshipName?: string | null;
  picklistValues: SfdcPicklistValue[];
  compoundFieldName?: string | null;
  extraTypeInfo?: string | null;
  cascadeDelete?: boolean;
}

export interface SfdcChildRelationship {
  childSObject: string;
  field: string;
  relationshipName?: string | null;
  cascadeDelete: boolean;
}

export interface SfdcRecordTypeInfo {
  recordTypeId: string;
  developerName: string;
  name: string;
  active: boolean;
  available: boolean;
  master: boolean;
}

export interface SfdcObjectDescribe {
  name: string;
  label?: string;
  keyPrefix?: string | null;
  custom?: boolean;
  queryable: boolean;
  retrieveable?: boolean;
  replicateable: boolean;
  fields: SfdcFieldDescribe[];
  childRelationships: SfdcChildRelationship[];
  recordTypeInfos: SfdcRecordTypeInfo[];
}

export interface SfdcGlobalDescribeEntry {
  name: string;
  label?: string;
  keyPrefix?: string | null;
  queryable: boolean;
  custom: boolean;
  replicateable: boolean;
}

/** `SELECT … FROM RecordType` row (§2.1.3). */
export interface SfdcRecordType {
  Id: string;
  SobjectType: string;
  DeveloperName: string;
  Name: string;
  IsActive: boolean;
  IsPersonType?: boolean;
}

// ---------------------------------------------------------------------------
// Vault metadata (§2.5.6)
// ---------------------------------------------------------------------------

/** Vault field types; casing of the last five is `[UNVERIFIED]` — compare case-insensitively (`normaliseVaultType`). */
export type VaultFieldType =
  | "ID"
  | "String"
  | "Number"
  | "Boolean"
  | "Date"
  | "DateTime"
  | "Picklist"
  | "Object"
  | "LongText"
  | "RichText"
  | "Currency"
  | "Formula"
  | "Lookup"
  | (string & {});

export interface VaultFieldMetadata {
  name: string;
  label?: string;
  type: VaultFieldType;
  required: boolean;
  unique?: boolean;
  editable?: boolean;
  status: string[];
  max_length?: number;
  max_value?: number;
  min_value?: number;
  scale?: number;
  multi_value?: boolean;
  /** Picklist name; may carry a `Picklist.` prefix `[UNVERIFIED]` — strip it. */
  picklist?: string;
  object?: { name: string; label?: string };
  relationship_type?: "reference" | "parent" | "child" | (string & {});
  relationship_outbound_name?: string;
  relationship_inbound_name?: string;
  lookup_relationship_name?: string;
  lookup_source_field?: string;
  system_managed_name?: boolean;
  sequential_naming?: boolean;
  value_format?: string;
  format_mask?: string;
  subtype?: string;
  no_copy?: boolean;
  encrypted?: boolean;
  checkbox?: boolean;
  created_by?: string;
  created_date?: string;
  modified_by?: string;
  modified_date?: string;
}

export interface VaultObjectTypeRef {
  name: string;
  label?: string;
  status?: string[];
  url?: string;
}

export interface VaultRelationship {
  relationship_name: string;
  relationship_type: string;
  field: string;
  object: { name: string };
}

export interface VaultObjectMetadata {
  name: string;
  label?: string;
  label_plural?: string;
  prefix?: string;
  status: string[];
  object_class?: string;
  system_managed?: boolean;
  allow_types?: boolean;
  default_obj_type?: string;
  object_types?: VaultObjectTypeRef[];
  available_lifecycles?: string[];
  auditable?: boolean;
  allow_attachments?: boolean;
  relationships?: VaultRelationship[];
  fields: VaultFieldMetadata[];
  /** Action urls (`urls{}`), scanned for `*rollup*` actions (§2.5.6). */
  urls?: Record<string, string>;
}

export interface VaultPicklistValue {
  name: string;
  label?: string;
  status?: "active" | "inactive" | (string & {});
}

/** `GET /configuration/Objecttype.{object}.{type}` (§2.5.6). */
export interface VaultObjectTypeConfig {
  name: string;
  object: string;
  active: boolean;
  type_fields: Array<{ name: string; required: boolean; source?: string }>;
}

export interface VaultLifecycle {
  name: string;
  label?: string;
  states: Array<{ name: string; label?: string; initial?: boolean }>;
}

/** Lower-cased canonical Vault field type. */
export type ResolvedFieldType =
  | "id"
  | "string"
  | "number"
  | "boolean"
  | "date"
  | "datetime"
  | "picklist"
  | "object"
  | "longtext"
  | "richtext"
  | "currency"
  | "formula"
  | "lookup"
  | "unknown";

export function normaliseVaultType(
  type: string | undefined,
): ResolvedFieldType {
  const t = (type ?? "").toLowerCase();
  switch (t) {
    case "id":
    case "string":
    case "number":
    case "boolean":
    case "date":
    case "datetime":
    case "picklist":
    case "object":
    case "longtext":
    case "richtext":
    case "currency":
    case "formula":
    case "lookup":
      return t;
    default:
      return "unknown";
  }
}

/** Target field as the transform sees it (§2.3). */
export interface ResolvedField {
  name: string;
  type: ResolvedFieldType;
  rawType: string;
  maxLength?: number;
  scale?: number;
  minValue?: number;
  maxValue?: number;
  multiValue: boolean;
  /** Picklist name (prefix stripped). */
  picklist?: string;
  /** Active picklist value names when known (§2.5.6 returns active only). */
  picklistValues?: string[];
  /** Referenced Vault object for `Object` fields. */
  referenceObject?: string;
  relationshipType?: string;
  /** Required on the base object (per-type requirement lives in `ResolvedMetadata.objectTypes`). */
  required: boolean;
  unique: boolean;
  editable: boolean;
  active: boolean;
  systemManagedName?: boolean;
}

/** Target metadata resolved by preflight for one (object, vault). */
export interface ResolvedMetadata {
  targetObject: string;
  /** Legacy-id field chosen per §3.2 (undefined when `LEGACY_ID_FIELD_MISSING`). */
  legacyIdField?: string;
  /** Stored value format for the legacy id (`{id18}` | `{id15}` | `SF:{orgId15}:{id18}`). */
  legacyIdFormat: string;
  fields: Record<string, ResolvedField>;
  allowTypes: boolean;
  /** Object type api name → fields required on that type (§2.5.6 `type_fields`). */
  objectTypes: Record<string, { active: boolean; requiredFields: string[] }>;
  lifecycle?: { name: string; states: string[] };
  allowAttachments?: boolean;
  systemManagedName?: boolean;
}

// ---------------------------------------------------------------------------
// Transform context
// ---------------------------------------------------------------------------

/** Read-only view of the id map used during transform (§2.3, §3.1). */
export interface IdResolver {
  /** Vault id for (object, SFDC id) or undefined when not (yet) mapped. */
  resolve(objectKey: ObjectKey, sfdcId: string): string | undefined;
  /** Numeric `user__sys` id for an SFDC user id (005…) or undefined (§3.4). */
  resolveUser(sfdcId: string): number | undefined;
  /** Territory Vault id by `name__v` (`territoryRef`, §6.0.3). Optional. */
  resolveTerritoryByName?(name: string): string | undefined;
}

/** One `country__v` crosswalk entry (§3.4). */
export interface CountryCrosswalkEntry {
  iso2: string;
  sfdcId?: string;
  vaultId?: string;
  name?: string;
  /** Address/state-style picklist value name for the country when one exists. */
  picklistValue?: string;
}

export interface NameTemplates {
  person: string;
  speaker: string;
  userTerritory: string;
  separator: string;
  [key: string]: string;
}

export interface CountryFormats {
  date?: string;
  datetime?: string;
  decimalSeparator?: string;
  thousandsSeparator?: string;
}

/**
 * Per-country context handed to every transform (§7). Built by
 * `config/resolve.ts` + preflight crosswalks.
 */
export interface CountryContext {
  iso2: CountryCode;
  region?: string;
  nameTemplates: NameTemplates;
  formats: CountryFormats;
  defaultTimezone: string;
  phone: { normalise: boolean; defaultRegion?: string };
  postalCode: { pattern?: string; onMismatch: "warn" | "fail" };
  /**
   * Picklist crosswalk lookup already layered country ← region ← `*` (§7.1).
   * Returns the target value name, `null` when the value is configured to be
   * skipped, or `undefined` when no entry exists (→ derivation rule).
   */
  picklist(mapKey: string, sourceValue: string): string | null | undefined;
  picklistPolicy: {
    derive: "strip_vod_lowercase_v" | "none";
    onUnmapped: "error" | "skip" | "createValue";
  };
  /** Country crosswalk (§3.4) by SFDC `Country_vod__c` id or ISO-2. */
  countries: {
    bySfdcId(id: string): CountryCrosswalkEntry | undefined;
    byIso2(iso2: string): CountryCrosswalkEntry | undefined;
  };
  /** `locales.language` / `locales.locale` crosswalk (§6.0.3 `localeLookup`). */
  locales: { language: Record<string, string>; locale: Record<string, string> };
  /** `CurrencyIsoCode` → accepted `local_currency__sys` value (probe 15); identity when unknown. */
  currency(iso: string): string | undefined;
  /** SFDC ids honoured under an erasure list (§7.2 `privacy.erasureListPath`). */
  erased?: ReadonlySet<string>;
}

/** Everything a transform function may read (§2.3). Pure: no I/O. */
export interface TransformContext {
  objectKey: ObjectKey;
  country: CountryContext;
  metadata: ResolvedMetadata;
  ids: IdResolver;
  /** The mapping row currently being applied. */
  field: FieldMapping;
  /** Target metadata for `field.target` when known. */
  targetField?: ResolvedField;
  /** Materialised crosswalks of the unit (object types, states, picklists). */
  mapping: Pick<
    MaterialisedMapping,
    "objectTypes" | "states" | "picklists" | "required" | "options"
  >;
  /** `target.migrationUserId` (numeric Vault user id) for audit fallback (§3.5). */
  migrationUserId?: number;
  /** 15-char org id for `SF:{orgId15}:{id18}` (§3.2 step 4). */
  orgId15?: string;
  runMode: RunMode;
  /** Object-module custom functions (`custom(fnName)`). */
  custom: Record<string, CustomTransformFn>;
}

export type CustomTransformFn = (
  value: unknown,
  row: SourceRow,
  ctx: TransformContext,
) => TransformResult | PayloadValue | undefined;

/** Result of one transform (§6.0.3). */
export type TransformResult =
  | {
      value: PayloadValue;
      /** Override of the output column (`object_type__v.api_name__v`, `{field}.{lookup}`, `local_currency__sys`…). */
      targetField?: string;
      diagnostic?: RowDiagnostic;
      /** Set by `ref`/`refUser` when the id map has no entry yet (§3.5). */
      unresolved?: { objectKey: ObjectKey | "user"; sfdcId: string };
    }
  | {
      omit: true;
      diagnostic?: RowDiagnostic;
      /** `secondPass` / `deferredBlob` markers carry the value for the later pass. */
      defer?: "secondPass" | "blob";
      deferredValue?: PayloadValue;
      targetField?: string;
      unresolved?: { objectKey: ObjectKey | "user"; sfdcId: string };
    };

// ---------------------------------------------------------------------------
// Materialised mapping (§2.3, §7.1)
// ---------------------------------------------------------------------------

/** Effective scope after overlays (§1.1, §7.2). */
export interface ResolvedScope {
  spec: ScopeSpec;
  /** Effective history window; undefined = unscoped (`full`). */
  historyMonths?: number;
  /** Explicit literal `YYYY-MM-DD` computed at run start (§1.1 #2). */
  cutoffDate?: string;
  retentionFamily?: RetentionFamily;
}

/** Object-level options after overlays (the `objects.<key>.*` flags of §7.2.1). */
export interface ObjectOptions {
  enabled: boolean;
  optional: boolean;
  deletePolicy: DeletePolicy;
  createPolicy: CreatePolicy;
  inactivateBy: Array<{ field: string; value: PayloadScalar }>;
  statusFromFlag: boolean;
  inactiveStatuses: string[];
  preserveName: boolean;
  preserveAutoNumberName: boolean;
  loadUnlockFlag: boolean;
  allowTypeChange: boolean;
  dateRange: "omit" | "fail";
  unmappedUserPolicy: UnmappedUserPolicy;
  legacyIdField?: string;
  externalIdOwnedBy: "integration" | "migration";
  rewriteCompositeExternalId: boolean;
  customFields: {
    mode: "none" | "listed" | "allMatching";
    include: string[];
    exclude: string[];
  };
  blobs: Record<string, BlobPolicy>;
  /** Object-specific flags (`loadCallType`, `loadDeviceFields`, `loadIpAddress`, `vidField`, …). */
  [flag: string]: unknown;
}

/** Per-(object, country) mapping after §7.1 layering; hashed into `mapping_hash`. */
export interface MaterialisedMapping {
  objectKey: ObjectKey;
  country: CountryCode;
  sourceObject: string;
  targetObject: string;
  /** Legacy-id field default (preflight may replace it per §3.2). */
  legacyIdField?: string;
  fields: FieldMapping[];
  /** target field → required override (§7.1); absent = mapping row `required`. */
  required: Record<string, boolean>;
  /** mapKey (`account.specialty`) → source value → target name | null(skip). */
  picklists: Record<string, Record<string, string | null>>;
  /** RecordType DeveloperName → object type api name. */
  objectTypes: Record<string, string>;
  /** Business status value → lifecycle state api name. */
  states: Record<string, string>;
  countryOf: CountryOfSpec[];
  scope: ResolvedScope;
  load: LoadOptions;
  options: ObjectOptions;
  match: MatchRule[];
  selfRefs: SelfRef[];
  dependsOn: ObjectKey[];
  /** Fields that depend on a config-object crosswalk (§6.3.42). */
  configObjects?: string[];
  /** Findings raised while materialising (SCOPE_NARROWED, MAP_DUP_TARGET, …). */
  findings: Finding[];
  /** sha256 of the canonical materialised mapping (everything above except `findings`). */
  mappingHash: string;
}

/** A target field patched in pass 2 (§6.1). `objectKey` defaults to the module itself. */
export interface SelfRef {
  target: string;
  source: string;
  objectKey?: ObjectKey;
}

// ---------------------------------------------------------------------------
// Store rows (§2.4)
// ---------------------------------------------------------------------------

export type WatermarkKind = "modstamp" | "deleted";

export interface Watermark {
  objectKey: ObjectKey;
  country: CountryCode;
  kind: WatermarkKind;
  /** ISO datetime. */
  value: string;
  /** `YYYY-MM-DD` cutoff in force when set (§4.1). */
  cutoffDate?: string;
  runId: string;
  updatedAt: string;
}

export interface IdMapRow {
  objectKey: ObjectKey;
  /** Always 18-char case-safe. */
  sfdcId: string;
  vaultDns: string;
  vaultObject: string;
  /** `V4U…` or the numeric string for `user__sys`. */
  vaultId: string;
  country: CountryCode;
  matchMethod: MatchMethod;
  mergedInto?: string | null;
  firstSeenRun: string;
  lastSeenRun: string;
  sourceHash?: string | null;
  verifiedHash?: string | null;
  verifiedAt?: string | null;
  deletedAt?: string | null;
  /** Object type api name stored for `changetype` routing (§2.5.6). */
  objectType?: string | null;
  /** Rows written by `--dry-run` (purged at the next real run, §8.9). */
  dryRun?: boolean;
}

export interface RowResult {
  runId: string;
  objectKey: ObjectKey;
  country: CountryCode;
  sfdcId: string;
  batchNo?: number | null;
  state: RowState;
  errorType?: string | null;
  errorMessage?: string | null;
  attempt: number;
  payloadHash?: string | null;
  vaultId?: string | null;
  updatedAt: string;
}

export interface PendingFk {
  runId: string;
  objectKey: ObjectKey;
  country: CountryCode;
  sfdcId: string;
  field: string;
  targetObjectKey: ObjectKey | "user";
  targetSfdcId: string;
  attempts: number;
  resolvedAt?: string | null;
}

export interface FkIndexRow {
  objectKey: ObjectKey;
  sfdcId: string;
  field: string;
  targetObjectKey: ObjectKey | "user";
  targetSfdcId: string;
  runId: string;
}

export interface ExtractCheckpoint {
  runId: string;
  objectKey: ObjectKey;
  country: CountryCode;
  jobId: string;
  locator?: string | null;
  pageNo: number;
  rows: number;
  file: string;
  completedAt?: string | null;
}

export type RunStatus =
  | "running"
  | "succeeded"
  | "failed"
  | "blocked"
  | "aborted";

export interface RunRecord {
  runId: string;
  mode: RunMode;
  wave?: string | null;
  countries: CountryCode[];
  startedAt: string;
  finishedAt?: string | null;
  status: RunStatus;
  toolVersion: string;
  configHash: string;
  /** Hash over all unit mapping hashes of the run. */
  mappingHash?: string | null;
  sourceOrgId?: string | null;
  sourceApiVersion?: string | null;
  targetVaultId?: string | null;
  targetVaultDns?: string | null;
  targetApiVersion?: string | null;
  sfdcNowAtStart?: string | null;
  freezeAt?: string | null;
  dryRun?: boolean;
}

export interface ReconciliationRow {
  runId: string;
  objectKey: ObjectKey;
  country: CountryCode;
  sfdcScopeCount?: number | null;
  extracted: number;
  /** Rows streamed with `IsDeleted = true` (§2.2 step 1). */
  extractedDeleted?: number;
  closure?: number;
  transformed: number;
  skipped: number;
  /** Breakdown by reason (§8.8). */
  skippedByReason?: Record<string, number>;
  pendingFk: number;
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
  failedByType?: Record<string, number>;
  deleted: number;
  deletedApplied?: number;
  deletedIgnored?: number;
  deletedPending?: number;
  vaultCount?: number | null;
  aggHashSrc?: string | null;
  aggHashTgt?: string | null;
  status: "pass" | "fail" | "pending";
}

export interface MappingSnapshot {
  mappingHash: string;
  objectKey: ObjectKey;
  country: CountryCode;
  materialised: MaterialisedMapping;
  createdAt: string;
}

export interface AuditLogEntry {
  id?: number;
  runId?: string | null;
  at: string;
  actor: string;
  event: string;
  detail?: Record<string, unknown>;
}

export interface ProbeResult {
  vaultDns: string;
  probe: string;
  result: Record<string, unknown>;
  checkedAt: string;
}

export interface StoredFinding extends Finding {
  runId: string;
  createdAt: string;
}

// re-export the object module contract so `import type { ObjectModule } from "../types"` works
export type {
  ObjectModule,
  ObjectModuleInput,
  BlockSOptions,
} from "./objects/types";
