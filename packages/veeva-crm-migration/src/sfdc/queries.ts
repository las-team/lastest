/**
 * Every SOQL / Tooling query text used by the extractor lives here as a pure
 * builder, so the call plan can be reviewed (and unit-tested) without a
 * Salesforce org. Builders never select columns blindly: callers pass the
 * column lists they confirmed via `describe`.
 */

/** Default object set — the Veeva CRM core (DESIGN.md §4.2 B1 / research 02 §6.1). */
export const CORE_OBJECTS: readonly string[] = [
  "Account",
  "Contact",
  "User",
  "Address_vod__c",
  "Child_Account_vod__c",
  "TSF_vod__c",
  "Call2_vod__c",
  "Call2_Detail_vod__c",
  "Call2_Discussion_vod__c",
  "Call2_Key_Message_vod__c",
  "Call2_Sample_vod__c",
  "Product_vod__c",
  "Key_Message_vod__c",
  "Product_Metrics_vod__c",
  "Cycle_Plan_vod__c",
  "Time_Off_Territory_vod__c",
  "Medical_Inquiry_vod__c",
  "Medical_Insight_vod__c",
  "EM_Event_vod__c",
  "EM_Attendee_vod__c",
  "Sample_Transaction_vod__c",
  "Sample_Lot_vod__c",
  "Sample_Limit_vod__c",
  "Approved_Document_vod__c",
  "Sent_Email_vod__c",
  "CLM_Presentation_vod__c",
  "Order_vod__c",
  "Order_Line_vod__c",
  "Multichannel_Activity_vod__c",
  "Message_vod__c",
  "VMobile_Object_Configuration_vod__c",
];

export const VMOC_OBJECT = "VMobile_Object_Configuration_vod__c";
export const MESSAGE_OBJECT = "Message_vod__c";
export const COUNTRY_OBJECT = "Country_vod__c";

/** Object-name suffixes that never carry functional configuration. */
export const SKIPPED_OBJECT_SUFFIXES: readonly string[] = [
  "__Share",
  "__History",
  "__Feed",
  "__ChangeEvent",
  "__Tag",
  "__mdt",
  "__e",
  "__x",
  "__b",
  "__hd",
  "__kav",
  "__ka",
  "__DataCategorySelection",
];

/** Standard columns never exported as setting values / VMOC extras. */
export const SYSTEM_FIELDS: ReadonlySet<string> = new Set([
  "Id",
  "Name",
  "OwnerId",
  "IsDeleted",
  "CreatedDate",
  "CreatedById",
  "LastModifiedDate",
  "LastModifiedById",
  "SystemModstamp",
  "LastActivityDate",
  "LastViewedDate",
  "LastReferencedDate",
  "SetupOwnerId",
  "CurrencyIsoCode",
  "RecordTypeId",
]);

/** VMOC columns that map onto named `VmocConfig` properties (the rest go to `extra`). */
export const VMOC_KNOWN_FIELDS: readonly string[] = [
  "Object_Name_vod__c",
  "Profile_ID_vod__c",
  "Profile_Name_vod__c",
  "Device_vod__c",
  "Active_vod__c",
  "Where_Clause_vod__c",
  "Type_vod__c",
  "Enable_Enhanced_Sync_vod__c",
  "Meta_Data_Only_vod__c",
];

export const MESSAGE_FIELDS: readonly string[] = [
  "Name",
  "Category_vod__c",
  "Language_vod__c",
  "Text_vod__c",
  "Active_vod__c",
  "Country_vod__c",
];

/** `true` for names ending in the Veeva `_vod` suffix (objects, fields, record types). */
export function isVeevaManaged(apiName: string): boolean {
  return /_vod(__c|__r)?$/i.test(apiName) || /_vod__/i.test(apiName);
}

/** `true` for Veeva Settings custom settings (`*_Settings_vod__c`, `Veeva_Common_vod__c`). */
export function isVeevaSettingObject(apiName: string): boolean {
  return (
    /_Settings_vod__c$/i.test(apiName) || /^Veeva_Common_vod__c$/i.test(apiName)
  );
}

export function isSkippedObject(apiName: string): boolean {
  return SKIPPED_OBJECT_SUFFIXES.some((s) => apiName.endsWith(s));
}

/** Escapes a value for use inside single quotes in SOQL. */
export function soqlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export function soqlIn(values: readonly string[]): string {
  return `(${values.map((v) => `'${soqlString(v)}'`).join(", ")})`;
}

/** Splits ids/names into chunks that fit a SOQL `IN (…)` list (default ≤ 200). */
export function chunkIds<T>(ids: readonly T[], size = 200): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

// ---------------------------------------------------------------------------
// Org
// ---------------------------------------------------------------------------

export const ORGANIZATION_QUERY =
  "SELECT Id, Name, OrganizationType, IsSandbox FROM Organization";

// ---------------------------------------------------------------------------
// Profiles / permission sets (standard SOQL)
// ---------------------------------------------------------------------------

/** C1: `permissionFields` = every `PermissionsXxx` column from `describe Profile`. */
export function profileQuery(permissionFields: readonly string[]): string {
  const cols = [
    "Id",
    "Name",
    "UserLicenseId",
    "UserLicense.Name",
    "UserType",
    "Description",
    ...permissionFields,
  ];
  return `SELECT ${cols.join(", ")} FROM Profile`;
}

export const PERMISSION_SET_QUERY =
  "SELECT Id, Name, Label, IsOwnedByProfile, ProfileId, NamespacePrefix, IsCustom, Type, Description FROM PermissionSet";

/** C3: object CRUD for profiles and permission sets, restricted to the objects in scope. */
export function objectPermissionsQuery(
  objects: readonly string[],
  hasViewAllFields = false,
): string {
  const cols = [
    "ParentId",
    "SobjectType",
    "PermissionsCreate",
    "PermissionsRead",
    "PermissionsEdit",
    "PermissionsDelete",
    "PermissionsViewAllRecords",
    "PermissionsModifyAllRecords",
  ];
  if (hasViewAllFields) cols.push("PermissionsViewAllFields");
  return `SELECT ${cols.join(", ")} FROM ObjectPermissions WHERE SobjectType IN ${soqlIn(objects)}`;
}

/** C4: FLS rows for one chunk of objects (one cursor, paginated). */
export function fieldPermissionsQuery(objects: readonly string[]): string {
  return `SELECT ParentId, SobjectType, Field, PermissionsRead, PermissionsEdit FROM FieldPermissions WHERE SobjectType IN ${soqlIn(objects)}`;
}

export function fieldPermissionsCountQuery(objects: readonly string[]): string {
  return `SELECT COUNT() FROM FieldPermissions WHERE SobjectType IN ${soqlIn(objects)}`;
}

/** C5: tab visibility per profile-owned permission set. */
export const TAB_SETTINGS_QUERY =
  "SELECT ParentId, Name, Visibility FROM PermissionSetTabSetting WHERE Parent.IsOwnedByProfile = true";

/** C6: app (TabSet) access per profile-owned permission set. */
export const APP_ACCESS_QUERY =
  "SELECT ParentId, SetupEntityId FROM SetupEntityAccess WHERE SetupEntityType = 'TabSet' AND Parent.IsOwnedByProfile = true";

export const APP_MENU_ITEM_QUERY =
  "SELECT ApplicationId, Name, Label, NamespacePrefix FROM AppMenuItem WHERE Type = 'TabSet'";

/** C7a: active users per (non-profile) permission set. */
export const PERMISSION_SET_ASSIGNMENT_COUNT_QUERY =
  "SELECT PermissionSetId psId, COUNT(Id) n FROM PermissionSetAssignment WHERE Assignee.IsActive = true AND PermissionSet.IsOwnedByProfile = false GROUP BY PermissionSetId";

/** C7b: which permission sets are held by users of which profile. */
export const PERMISSION_SET_BY_PROFILE_QUERY =
  "SELECT Assignee.ProfileId profileId, PermissionSetId psId, COUNT(Id) n FROM PermissionSetAssignment WHERE Assignee.IsActive = true AND PermissionSet.IsOwnedByProfile = false GROUP BY Assignee.ProfileId, PermissionSetId";

// ---------------------------------------------------------------------------
// Users (aggregate only, never row-level)
// ---------------------------------------------------------------------------

export interface UserSummaryFields {
  /** Country column to group by (`Country_Code_vod__c`, `CountryCode`, `Country`) or `null` when none exists. */
  countryField: string | null;
  /** `true` when `User_Type_vod__c` exists. */
  userType: boolean;
  /** `true` when `LanguageLocaleKey` exists (it always does; kept for symmetry). */
  language: boolean;
}

/** C8: PII-free aggregate of active standard users per profile × country × rep type × language. */
export function userSummaryQuery(available: UserSummaryFields): string {
  const groupBy = ["ProfileId"];
  const select = ["ProfileId profileId"];
  if (available.countryField) {
    groupBy.push(available.countryField);
    select.push(`${available.countryField} country`);
  }
  if (available.userType) {
    groupBy.push("User_Type_vod__c");
    select.push("User_Type_vod__c userType");
  }
  if (available.language) {
    groupBy.push("LanguageLocaleKey");
    select.push("LanguageLocaleKey language");
  }
  select.push("COUNT(Id) n");
  return `SELECT ${select.join(", ")} FROM User WHERE IsActive = true AND UserType = 'Standard' GROUP BY ${groupBy.join(", ")}`;
}

// ---------------------------------------------------------------------------
// Record types / layouts / validation rules
// ---------------------------------------------------------------------------

/** B4: every record type in the org, one call. */
export const RECORD_TYPE_QUERY =
  "SELECT Id, Name, DeveloperName, SobjectType, IsActive, NamespacePrefix, Description FROM RecordType";

/** B2 (Tooling): custom-object id ↔ API name map, needed to decode `TableEnumOrId`. */
export const CUSTOM_OBJECT_QUERY =
  "SELECT Id, DeveloperName, NamespacePrefix FROM CustomObject";

/** D1 (Tooling): every page layout (id → name), one paginated call. */
export const LAYOUT_QUERY =
  "SELECT Id, Name, TableEnumOrId, LayoutType, NamespacePrefix, ManageableState FROM Layout";

/** D2 (Tooling): profile × record type → layout for the objects in scope (`tableEnumOrIds` = names for standard, `01I…` ids for custom objects). */
export function profileLayoutQuery(tableEnumOrIds: readonly string[]): string {
  return `SELECT Id, ProfileId, LayoutId, RecordTypeId, TableEnumOrId FROM ProfileLayout WHERE TableEnumOrId IN ${soqlIn(tableEnumOrIds)}`;
}

/** D3 (Tooling): one layout blob — `Metadata` is only allowed in single-record queries. */
export function layoutMetadataQuery(layoutId: string): string {
  return `SELECT Id, FullName, Metadata FROM Layout WHERE Id = '${soqlString(layoutId)}'`;
}

/** C9 (Tooling): one profile blob — `Metadata` is only allowed in single-record queries. */
export function profileMetadataQuery(profileId: string): string {
  return `SELECT Id, FullName, Metadata FROM Profile WHERE Id = '${soqlString(profileId)}'`;
}

/** E1 (Tooling): validation rules for a chunk of objects. */
export function validationRuleQuery(objects: readonly string[]): string {
  return `SELECT Id, ValidationName, Active, EntityDefinition.QualifiedApiName, ErrorMessage, ErrorDisplayField, NamespacePrefix FROM ValidationRule WHERE EntityDefinition.QualifiedApiName IN ${soqlIn(objects)}`;
}

// ---------------------------------------------------------------------------
// Automation inventory (names only)
// ---------------------------------------------------------------------------

export const APEX_TRIGGER_QUERY =
  "SELECT Id, Name, TableEnumOrId, Status, NamespacePrefix, Body FROM ApexTrigger";
export const FLOW_DEFINITION_QUERY =
  "SELECT Id, DeveloperName, MasterLabel, ActiveVersionId, NamespacePrefix FROM FlowDefinition";
export const WORKFLOW_RULE_QUERY =
  "SELECT Id, Name, TableEnumOrId, NamespacePrefix FROM WorkflowRule";

// ---------------------------------------------------------------------------
// Veeva layer
// ---------------------------------------------------------------------------

/** F2: every row of a custom setting; `fields` = the custom columns from describe. */
export function settingRecordsQuery(
  setting: string,
  fields: readonly string[],
  hierarchy: boolean,
): string {
  const cols = hierarchy
    ? ["Id", "SetupOwnerId", "SetupOwner.Type", "SetupOwner.Name"]
    : ["Id", "Name"];
  for (const f of fields) if (!cols.includes(f)) cols.push(f);
  return `SELECT ${cols.join(", ")} FROM ${setting}`;
}

/** G1: VMOCs; `fields` = the custom columns that exist (from describe). */
export function vmocQuery(fields: readonly string[]): string {
  const cols = ["Id", "Name"];
  for (const f of fields) if (!cols.includes(f)) cols.push(f);
  return `SELECT ${cols.join(", ")} FROM ${VMOC_OBJECT}`;
}

/** G2: Veeva Messages; `fields` = the existing subset of `MESSAGE_FIELDS`; `languages` restricts the rows. */
export function messageQuery(
  fields: readonly string[],
  languages?: readonly string[],
): string {
  const cols = ["Id"];
  for (const f of fields) if (!cols.includes(f)) cols.push(f);
  let soql = `SELECT ${cols.join(", ")} FROM ${MESSAGE_OBJECT}`;
  if (languages && languages.length > 0 && fields.includes("Language_vod__c"))
    soql += ` WHERE Language_vod__c IN ${soqlIn(languages)}`;
  return soql;
}

/** Country_vod__c object, when the org has one (usually a Vault-ism; opportunistic). */
export function countryObjectQuery(fields: readonly string[]): string {
  const cols = ["Id", "Name"];
  for (const f of fields) if (!cols.includes(f)) cols.push(f);
  return `SELECT ${cols.join(", ")} FROM ${COUNTRY_OBJECT}`;
}

// ---------------------------------------------------------------------------
// Helpers for the data the queries return
// ---------------------------------------------------------------------------

/** Hierarchy custom-setting level from the `SetupOwnerId` key prefix. */
export function settingLevel(
  setupOwnerId: string | null | undefined,
): "org" | "profile" | "user" {
  const prefix = (setupOwnerId ?? "").slice(0, 3);
  if (prefix === "00e") return "profile";
  if (prefix === "005") return "user";
  return "org";
}

/** Converts a 15-character Salesforce id to its 18-character form. */
export function to18(id: string): string {
  if (id.length !== 15) return id;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ012345";
  let suffix = "";
  for (let block = 0; block < 3; block++) {
    let bits = 0;
    for (let i = 0; i < 5; i++) {
      const ch = id.charAt(block * 5 + i);
      if (ch >= "A" && ch <= "Z") bits |= 1 << i;
    }
    suffix += alphabet.charAt(bits);
  }
  return id + suffix;
}

/** `true` when two Salesforce ids (15 or 18 chars) denote the same record. */
export function sameId(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) return false;
  return a.slice(0, 15) === b.slice(0, 15);
}

/** Parses the column name out of an `INVALID_FIELD` error message, when present. */
export function invalidFieldFromMessage(message: string): string | null {
  const m =
    message.match(/No such column '([^']+)'/i) ??
    message.match(/didn't understand relationship '([^']+)'/i) ??
    message.match(/Invalid field:? '?([\w.]+)'?/i);
  return m?.[1] ?? null;
}
