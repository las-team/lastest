/**
 * Shared data model for the Veeva CRM (Salesforce) → Vault CRM configuration
 * migration package.
 *
 * Three stages share these types:
 *   1. `sfdc/`  extracts an {@link OrgSnapshot} from a Veeva CRM org.
 *   2. `docs/`  renders per-country / per-rep-category documentation from a
 *               {@link ClassifiedSnapshot}.
 *   3. `vault/` turns the same snapshot into a {@link VaultPlan} (MDL + API
 *               calls + manual checklist) and optionally applies it.
 *
 * Everything here is plain JSON-serialisable data so a snapshot can be written
 * to disk after extraction and re-used for `document` / `plan` / `apply` runs
 * without touching Salesforce again.
 */

// ---------------------------------------------------------------------------
// Salesforce-side configuration ("what was found")
// ---------------------------------------------------------------------------

/** ISO-3166 alpha-2 country code, upper-case (e.g. `"DE"`). `"GLOBAL"` = not country specific. */
export type CountryCode = string;
export const GLOBAL_COUNTRY: CountryCode = "GLOBAL";

/**
 * Rep categories. Derived from Profile names (and, as a fallback, permission
 * sets / user roles) by `model/classify.ts`. `other` is the catch-all; `admin`
 * covers business/system admins and integration users.
 */
export type RepCategory =
  | "sales_rep"
  | "specialty_rep"
  | "kam"
  | "msl"
  | "manager"
  | "inside_sales"
  | "admin"
  | "other";

export const REP_CATEGORIES: readonly RepCategory[] = [
  "sales_rep",
  "specialty_rep",
  "kam",
  "msl",
  "manager",
  "inside_sales",
  "admin",
  "other",
];

export interface ObjectPermission {
  object: string;
  create: boolean;
  read: boolean;
  edit: boolean;
  delete: boolean;
  viewAll: boolean;
  modifyAll: boolean;
}

export interface FieldPermission {
  object: string;
  /** Field API name without the object prefix (e.g. `Call_Type_vod__c`). */
  field: string;
  readable: boolean;
  editable: boolean;
}

export interface RecordTypeVisibility {
  object: string;
  recordType: string;
  visible: boolean;
  default: boolean;
}

export interface TabVisibility {
  tab: string;
  visibility: "DefaultOn" | "DefaultOff" | "Hidden";
}

export interface ApplicationVisibility {
  application: string;
  visible: boolean;
  default: boolean;
}

/** Which page layout a profile sees for an object + record type. */
export interface LayoutAssignment {
  object: string;
  /** Record type developer name, or `null` for the master record type. */
  recordType: string | null;
  /** Layout full name, e.g. `Call2_vod__c-Call Layout DE`. */
  layout: string;
}

export interface ProfileConfig {
  id: string;
  name: string;
  userLicense: string;
  custom: boolean;
  description?: string;
  objectPermissions: ObjectPermission[];
  fieldPermissions: FieldPermission[];
  recordTypeVisibilities: RecordTypeVisibility[];
  tabVisibilities: TabVisibility[];
  applicationVisibilities: ApplicationVisibility[];
  layoutAssignments: LayoutAssignment[];
  /** Active users assigned to the profile, by country (PII-free aggregate). */
  activeUsersByCountry: Record<CountryCode, number>;
  /** Permission sets assigned to at least one user of this profile. */
  permissionSetNames: string[];
}

export interface PermissionSetConfig {
  id: string;
  name: string;
  label: string;
  description?: string;
  objectPermissions: ObjectPermission[];
  fieldPermissions: FieldPermission[];
  assignedUserCount: number;
}

export interface PicklistValue {
  value: string;
  label: string;
  active: boolean;
  default: boolean;
}

export interface FieldConfig {
  apiName: string;
  label: string;
  type: string;
  custom: boolean;
  /** `true` for fields in the `vod` (Veeva) managed-package namespace. */
  managed: boolean;
  required: boolean;
  length?: number;
  precision?: number;
  scale?: number;
  referenceTo?: string[];
  picklistValues?: PicklistValue[];
  /** Controlling field for dependent picklists. */
  controllerName?: string;
  formula?: string;
  helpText?: string;
  description?: string;
}

export interface RecordTypeConfig {
  id: string;
  developerName: string;
  name: string;
  active: boolean;
  description?: string;
}

/** A page-layout section with its fields, as returned by `describe/layouts`. */
export interface LayoutSection {
  heading: string;
  columns: number;
  /** Field API names in display order. */
  fields: string[];
}

export interface LayoutConfig {
  /** Full name, e.g. `Call2_vod__c-Call Layout DE`. */
  fullName: string;
  object: string;
  /** Record type developer names this layout is assigned to (any profile). */
  recordTypes: string[];
  sections: LayoutSection[];
  relatedLists: string[];
  /** Quick actions / Veeva buttons visible on the layout, when known. */
  actions?: string[];
}

export interface ValidationRuleConfig {
  object: string;
  name: string;
  active: boolean;
  errorConditionFormula?: string;
  errorMessage?: string;
  errorDisplayField?: string;
}

export interface ObjectConfig {
  apiName: string;
  label: string;
  labelPlural: string;
  custom: boolean;
  managed: boolean;
  fields: FieldConfig[];
  recordTypes: RecordTypeConfig[];
  layouts: LayoutConfig[];
  validationRules: ValidationRuleConfig[];
}

/** Veeva Mobile Object Configuration (`VMobile_Object_Configuration_vod__c`). */
export interface VmocConfig {
  id: string;
  name: string;
  objectApiName: string;
  /** Profile name the VMOC applies to, or `null` for all profiles. */
  profile: string | null;
  device: string;
  active: boolean;
  whereClause: string | null;
  /** Additional raw Veeva fields we keep for the docs (e.g. `Type_vod__c`, `Owner_Filter`). */
  extra: Record<string, unknown>;
}

/**
 * One record of a Veeva Settings custom setting (hierarchy custom settings such
 * as `Veeva_Settings_vod__c`, `Approved_Email_Settings_vod__c`, …).
 */
export interface VeevaSettingRecord {
  settingObject: string;
  /** Hierarchy level derived from `SetupOwnerId`. */
  level: "org" | "profile" | "user";
  /** Profile name / user name for that level, `null` for org defaults. */
  ownerName: string | null;
  /** Every non-system field → value. */
  values: Record<string, unknown>;
}

export interface VeevaMessage {
  name: string;
  category: string;
  language: string;
  text: string;
  /** Country code when the message is country-scoped, else `null`. */
  country: CountryCode | null;
  active: boolean;
}

export interface CountryRef {
  code: CountryCode;
  name: string;
  /** Salesforce record Id of `Country_vod__c` when it exists. */
  id?: string;
  /** Active users with that country. */
  activeUsers: number;
}

export interface ExtractionWarning {
  stage: string;
  message: string;
  detail?: unknown;
}

export interface OrgSnapshot {
  schemaVersion: 1;
  extractedAt: string;
  instanceUrl: string;
  apiVersion: string;
  orgId?: string;
  orgName?: string;
  countries: CountryRef[];
  profiles: ProfileConfig[];
  permissionSets: PermissionSetConfig[];
  objects: ObjectConfig[];
  vmocs: VmocConfig[];
  veevaSettings: VeevaSettingRecord[];
  messages: VeevaMessage[];
  warnings: ExtractionWarning[];
}

// ---------------------------------------------------------------------------
// Classification (country × rep category)
// ---------------------------------------------------------------------------

export interface ClassificationRule {
  /** Regex (case-insensitive) tested against the profile name. */
  pattern: string;
  category: RepCategory;
}

export interface ClassifiedProfile {
  profile: ProfileConfig;
  category: RepCategory;
  /** Countries the profile serves (from users, profile-name prefix, VMOC where clauses). */
  countries: CountryCode[];
  /** How the category / countries were decided; shown in the docs. */
  rationale: string[];
}

export interface CountryRepConfig {
  country: CountryCode;
  category: RepCategory;
  profiles: ClassifiedProfile[];
  /** Layouts, VMOCs, settings, messages filtered to this country × category. */
  layouts: LayoutConfig[];
  vmocs: VmocConfig[];
  settings: VeevaSettingRecord[];
  messages: VeevaMessage[];
}

export interface CountryConfig {
  country: CountryRef;
  repConfigs: CountryRepConfig[];
}

export interface ClassifiedSnapshot {
  snapshot: OrgSnapshot;
  profiles: ClassifiedProfile[];
  countries: CountryConfig[];
  /** Config that is not country specific (org-level settings, global messages, shared objects). */
  global: CountryRepConfig[];
}

// ---------------------------------------------------------------------------
// Vault CRM side ("how it will be set up")
// ---------------------------------------------------------------------------

export type PlanStepKind = "mdl" | "api" | "manual";

export interface VaultApiCall {
  method: "GET" | "POST" | "PUT" | "DELETE";
  /** Path relative to `/api/{version}`, e.g. `/objects/picklists/call_type__v`. */
  path: string;
  /** JSON body or form fields. */
  body?: Record<string, unknown>;
  contentType?: "application/json" | "application/x-www-form-urlencoded";
}

export interface PlanStep {
  id: string;
  kind: PlanStepKind;
  title: string;
  /** Country / rep category the step belongs to, for grouping in reports. */
  country: CountryCode;
  category: RepCategory | "all";
  /** Source component in Salesforce this step was derived from. */
  source: string;
  /** Target component in Vault CRM. */
  target: string;
  mdl?: string;
  api?: VaultApiCall;
  /** Human instructions for things that cannot be automated. */
  manual?: string;
  dependsOn: string[];
}

export interface VaultPlan {
  schemaVersion: 1;
  createdAt: string;
  vaultDns?: string;
  apiVersion: string;
  steps: PlanStep[];
  /** Salesforce components with no Vault CRM equivalent; listed in the docs. */
  unmapped: { source: string; reason: string }[];
}

export interface ApplyStepResult {
  stepId: string;
  status: "applied" | "skipped" | "failed" | "manual";
  message?: string;
  response?: unknown;
}

export interface ApplyReport {
  startedAt: string;
  finishedAt: string;
  dryRun: boolean;
  results: ApplyStepResult[];
  /** True when every automated step applied (manual steps do not count). */
  ok: boolean;
}
