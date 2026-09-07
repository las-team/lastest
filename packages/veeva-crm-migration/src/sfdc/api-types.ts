/**
 * Raw Salesforce REST / Tooling API response shapes used by the extractor.
 * Only the keys the code reads are declared; everything else is passed
 * through untyped.
 */

export interface QueryResult<T> {
  totalSize: number;
  done: boolean;
  nextRecordsUrl?: string;
  records: T[];
}

export interface ApiVersionInfo {
  label: string;
  url: string;
  version: string;
}

export interface TokenResponse {
  access_token: string;
  instance_url: string;
  id?: string;
  token_type?: string;
  issued_at?: string;
  scope?: string;
}

export interface SfdcErrorBody {
  message?: string;
  errorCode?: string;
  error?: string;
  error_description?: string;
  fields?: string[];
}

export interface DescribeGlobalSObject {
  name: string;
  label: string;
  labelPlural?: string;
  custom: boolean;
  customSetting: boolean;
  layoutable: boolean;
  queryable: boolean;
  keyPrefix: string | null;
}

export interface DescribeGlobal {
  encoding?: string;
  maxBatchSize?: number;
  sobjects: DescribeGlobalSObject[];
}

export interface DescribePicklistValue {
  value: string;
  label: string | null;
  active: boolean;
  defaultValue: boolean;
  validFor?: string | null;
}

export interface DescribeField {
  name: string;
  label: string;
  type: string;
  custom: boolean;
  length?: number;
  precision?: number;
  scale?: number;
  nillable: boolean;
  createable?: boolean;
  updateable?: boolean;
  permissionable?: boolean;
  calculated?: boolean;
  calculatedFormula?: string | null;
  controllerName?: string | null;
  dependentPicklist?: boolean;
  inlineHelpText?: string | null;
  defaultedOnCreate?: boolean;
  referenceTo?: string[];
  picklistValues?: DescribePicklistValue[];
}

export interface DescribeRecordTypeInfo {
  recordTypeId: string;
  name: string;
  developerName?: string;
  active: boolean;
  available: boolean;
  master: boolean;
  defaultRecordTypeMapping: boolean;
}

export interface DescribeSObject {
  name: string;
  label: string;
  labelPlural: string;
  custom: boolean;
  customSetting: boolean;
  layoutable: boolean;
  queryable: boolean;
  keyPrefix: string | null;
  fields: DescribeField[];
  recordTypeInfos: DescribeRecordTypeInfo[];
}

export interface DescribeLayoutComponent {
  type: string;
  value?: string | null;
  components?: DescribeLayoutComponent[];
}

export interface DescribeLayoutItem {
  label?: string;
  required?: boolean;
  editableForNew?: boolean;
  editableForUpdate?: boolean;
  layoutComponents: DescribeLayoutComponent[];
}

export interface DescribeLayoutSection {
  heading: string;
  columns: number;
  useHeading?: boolean;
  layoutRows: { layoutItems: DescribeLayoutItem[] }[];
}

export interface DescribeLayout {
  id: string;
  detailLayoutSections?: DescribeLayoutSection[];
  editLayoutSections?: DescribeLayoutSection[];
  relatedLists?: { name?: string; sobject?: string; label?: string }[];
  buttonLayoutSection?: {
    detailButtons?: { name: string; label?: string; custom?: boolean }[];
  } | null;
  quickActionList?: {
    quickActionListItems?: { quickActionName?: string; label?: string }[];
  } | null;
}

export interface DescribeRecordTypeMapping {
  recordTypeId: string;
  name: string;
  developerName?: string;
  available: boolean;
  master: boolean;
  defaultRecordTypeMapping: boolean;
  layoutId: string;
  picklistsForRecordType?: {
    picklistName: string;
    picklistValues: DescribePicklistValue[];
  }[];
}

export interface DescribeLayouts {
  layouts: DescribeLayout[];
  recordTypeMappings: DescribeRecordTypeMapping[];
}

export interface LimitsResponse {
  DailyApiRequests?: { Max: number; Remaining: number };
  [key: string]: unknown;
}

/** `Profile.Metadata` as returned by a single-record Tooling query. */
export interface ProfileMetadata {
  layoutAssignments?: { layout: string; recordType?: string | null }[];
  recordTypeVisibilities?: {
    recordType: string;
    visible: boolean;
    default?: boolean;
    personAccountDefault?: boolean;
  }[];
  tabVisibilities?: { tab: string; visibility: string }[];
  applicationVisibilities?: {
    application: string;
    visible: boolean;
    default?: boolean;
  }[];
  userPermissions?: { name: string; enabled: boolean }[];
}

/** `Layout.Metadata` as returned by a single-record Tooling query. */
export interface LayoutMetadata {
  layoutSections?: {
    label?: string | null;
    style?: string;
    layoutColumns?: {
      layoutItems?: {
        field?: string | null;
        behavior?: string | null;
        emptySpace?: boolean;
      }[];
    }[];
  }[];
  relatedLists?: { relatedList?: string }[];
  customButtons?: string[];
  excludeButtons?: string[];
  quickActionList?: {
    quickActionListItems?: { quickActionName?: string }[];
  } | null;
}

/** Generic SOQL row: `attributes` plus arbitrary columns (nested for relationship fields). */
export type SoqlRow = { attributes?: { type: string; url?: string } } & Record<
  string,
  unknown
>;
