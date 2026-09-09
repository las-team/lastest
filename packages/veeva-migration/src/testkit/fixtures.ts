/**
 * Fixture builders for hermetic tests: SFDC describes, Vault metadata,
 * resolved metadata, country/transform contexts and sample rows.
 */
import { makePicklistLookup } from "../config/resolve";
import {
  normaliseVaultType,
  type CountryContext,
  type CountryCrosswalkEntry,
  type IdResolver,
  type MaterialisedMapping,
  type ObjectKey,
  type ResolvedField,
  type ResolvedMetadata,
  type SfdcFieldDescribe,
  type SfdcFieldType,
  type SfdcObjectDescribe,
  type SfdcRecordTypeInfo,
  type SourceRow,
  type TransformContext,
  type VaultFieldMetadata,
  type VaultObjectMetadata,
} from "../types";
import { OBJECT_OPTION_DEFAULTS } from "../config/resolve";
import { to18 } from "../transform/ids";

/** Checksum-correct sample ids (never hand-write 18-char ids: suffixes are derived). */
export const IDS = {
  countryUS: to18("a0C00000000US01"),
  countryDE: to18("a0C00000000DE01"),
  call1: to18("a0K000000000001"),
  call2: to18("a0K000000000002"),
  call3: to18("a0K000000000003"),
  account1: "001000000000001AAA",
  account2: "001000000000002AAA",
  account3: "001000000000003AAA",
  account4: "001000000000004AAA",
};

// ---------------------------------------------------------------------------
// SFDC describe
// ---------------------------------------------------------------------------

export type FieldSpec = Partial<SfdcFieldDescribe> & {
  name: string;
  type: SfdcFieldType;
};

export function sfdcField(spec: FieldSpec): SfdcFieldDescribe {
  return {
    label: spec.name,
    length:
      spec.type === "string"
        ? 255
        : spec.type === "textarea"
          ? 32000
          : undefined,
    nillable: true,
    calculated: false,
    autoNumber: false,
    externalId: false,
    unique: false,
    nameField: false,
    custom: /__c$/.test(spec.name),
    createable: true,
    updateable: true,
    filterable: true,
    referenceTo: [],
    picklistValues: [],
    ...spec,
  };
}

/** Standard system columns present on (almost) every object (§2.2 step 2). */
export function systemFields(
  opts: {
    name?: boolean | "autoNumber";
    owner?: boolean;
    recordType?: boolean;
    currency?: boolean;
  } = {},
): SfdcFieldDescribe[] {
  const out: SfdcFieldDescribe[] = [
    sfdcField({ name: "Id", type: "id", nillable: false }),
    sfdcField({ name: "IsDeleted", type: "boolean", nillable: false }),
    sfdcField({ name: "SystemModstamp", type: "datetime", nillable: false }),
    sfdcField({ name: "CreatedDate", type: "datetime", nillable: false }),
    sfdcField({
      name: "CreatedById",
      type: "reference",
      referenceTo: ["User"],
      relationshipName: "CreatedBy",
      nillable: false,
    }),
    sfdcField({ name: "LastModifiedDate", type: "datetime", nillable: false }),
    sfdcField({
      name: "LastModifiedById",
      type: "reference",
      referenceTo: ["User"],
      relationshipName: "LastModifiedBy",
      nillable: false,
    }),
  ];
  if (opts.name !== false)
    out.push(
      sfdcField({
        name: "Name",
        type: "string",
        length: 80,
        nameField: true,
        autoNumber: opts.name === "autoNumber",
      }),
    );
  if (opts.owner !== false)
    out.push(
      sfdcField({
        name: "OwnerId",
        type: "reference",
        referenceTo: ["User", "Group"],
        relationshipName: "Owner",
        nillable: false,
      }),
    );
  if (opts.recordType)
    out.push(
      sfdcField({
        name: "RecordTypeId",
        type: "reference",
        referenceTo: ["RecordType"],
        relationshipName: "RecordType",
      }),
    );
  if (opts.currency)
    out.push(
      sfdcField({
        name: "CurrencyIsoCode",
        type: "picklist",
        picklistValues: [
          { value: "USD", active: true },
          { value: "EUR", active: true },
        ],
      }),
    );
  return out;
}

export interface BuildDescribeOptions {
  systemFields?: Parameters<typeof systemFields>[0] | false;
  recordTypes?: Array<Partial<SfdcRecordTypeInfo> & { developerName: string }>;
  replicateable?: boolean;
  queryable?: boolean;
  keyPrefix?: string;
  childRelationships?: SfdcObjectDescribe["childRelationships"];
}

/** Build an object describe; system fields are added unless `systemFields: false`. */
export function buildDescribe(
  objectName: string,
  fields: FieldSpec[],
  opts: BuildDescribeOptions = {},
): SfdcObjectDescribe {
  const sys =
    opts.systemFields === false ? [] : systemFields(opts.systemFields ?? {});
  const own = fields.map(sfdcField);
  const names = new Set(own.map((f) => f.name));
  return {
    name: objectName,
    label: objectName,
    keyPrefix: opts.keyPrefix ?? null,
    custom: /__c$/.test(objectName),
    queryable: opts.queryable ?? true,
    retrieveable: true,
    replicateable: opts.replicateable ?? true,
    fields: [...sys.filter((f) => !names.has(f.name)), ...own],
    childRelationships: opts.childRelationships ?? [],
    recordTypeInfos: (opts.recordTypes ?? []).map((rt, i) => ({
      recordTypeId:
        rt.recordTypeId ?? `012000000000${String(i + 1).padStart(3, "0")}AAA`,
      developerName: rt.developerName,
      name: rt.name ?? rt.developerName,
      active: rt.active ?? true,
      available: rt.available ?? true,
      master: rt.master ?? false,
    })),
  };
}

// ---------------------------------------------------------------------------
// Vault metadata
// ---------------------------------------------------------------------------

export type VaultFieldSpec = Partial<VaultFieldMetadata> & {
  name: string;
  type: string;
};

export function vaultField(spec: VaultFieldSpec): VaultFieldMetadata {
  const base: VaultFieldMetadata = {
    label: spec.name,
    required: false,
    unique: false,
    editable: true,
    status: ["active__v"],
    ...spec,
    type: spec.type,
  };
  if (base.type === "String" && base.max_length === undefined)
    base.max_length = 255;
  if (base.type === "LongText" && base.max_length === undefined)
    base.max_length = 32000;
  return base;
}

export interface BuildVaultMetadataOptions {
  /** Include the platform system fields (default true). */
  systemFields?: boolean;
  /** Legacy-id field to add (`legacy_crm_id__v` by default; `null` = none). */
  legacyIdField?: string | null;
  objectTypes?: string[];
  lifecycles?: string[];
  allowAttachments?: boolean;
  systemManagedName?: boolean;
}

/** Build `GET /metadata/vobjects/{object}` output with platform fields added unless disabled. */
export function buildVaultMetadata(
  objectName: string,
  fields: VaultFieldSpec[],
  opts: BuildVaultMetadataOptions = {},
): VaultObjectMetadata {
  const sys: VaultFieldMetadata[] =
    opts.systemFields === false
      ? []
      : [
          vaultField({ name: "id", type: "ID", editable: false }),
          vaultField({
            name: "name__v",
            type: "String",
            max_length: 128,
            required: true,
            system_managed_name: opts.systemManagedName ?? false,
          }),
          vaultField({
            name: "status__v",
            type: "Picklist",
            picklist: "status__v",
            required: true,
          }),
          vaultField({
            name: "created_by__v",
            type: "Object",
            object: { name: "user__sys" },
            relationship_type: "reference",
          }),
          vaultField({ name: "created_date__v", type: "DateTime" }),
          vaultField({
            name: "modified_by__v",
            type: "Object",
            object: { name: "user__sys" },
            relationship_type: "reference",
          }),
          vaultField({ name: "modified_date__v", type: "DateTime" }),
        ];
  const legacy =
    opts.legacyIdField === null
      ? []
      : [
          vaultField({
            name: opts.legacyIdField ?? "legacy_crm_id__v",
            type: "String",
            max_length: 18,
            unique: true,
          }),
        ];
  if (opts.objectTypes?.length && opts.systemFields !== false)
    sys.push(
      vaultField({
        name: "object_type__v",
        type: "Object",
        object: { name: "object_type__v" },
        required: true,
      }),
    );
  if (opts.lifecycles?.length && opts.systemFields !== false)
    sys.push(
      vaultField({ name: "state__v", type: "Picklist", required: false }),
    );
  const own = fields.map(vaultField);
  const names = new Set(own.map((f) => f.name));
  return {
    name: objectName,
    label: objectName,
    status: ["active__v"],
    allow_types: Boolean(opts.objectTypes?.length),
    object_types: (opts.objectTypes ?? []).map((name) => ({
      name,
      label: name,
      status: ["active__v"],
    })),
    available_lifecycles: opts.lifecycles ?? [],
    allow_attachments: opts.allowAttachments ?? false,
    fields: [
      ...sys.filter((f) => !names.has(f.name)),
      ...legacy.filter((f) => !names.has(f.name)),
      ...own,
    ],
    relationships: [],
  };
}

/** Convert raw Vault metadata into the `ResolvedMetadata` a transform sees. */
export function resolveMetadata(
  meta: VaultObjectMetadata,
  opts: {
    legacyIdField?: string;
    legacyIdFormat?: string;
    picklists?: Record<string, string[]>;
    objectTypes?: Record<
      string,
      { active?: boolean; requiredFields?: string[] }
    >;
    lifecycle?: { name: string; states: string[] };
  } = {},
): ResolvedMetadata {
  const fields: Record<string, ResolvedField> = {};
  for (const f of meta.fields) {
    const picklist = f.picklist?.replace(/^Picklist\./, "");
    fields[f.name] = {
      name: f.name,
      type: normaliseVaultType(f.type),
      rawType: f.type,
      maxLength: f.max_length,
      scale: f.scale,
      minValue: f.min_value,
      maxValue: f.max_value,
      multiValue: Boolean(f.multi_value),
      picklist,
      picklistValues: picklist ? opts.picklists?.[picklist] : undefined,
      referenceObject: f.object?.name,
      relationshipType: f.relationship_type,
      required: Boolean(f.required),
      unique: Boolean(f.unique),
      editable: f.editable !== false,
      active: (f.status ?? ["active__v"]).includes("active__v"),
      systemManagedName: f.system_managed_name,
    };
  }
  const legacy =
    opts.legacyIdField ??
    (fields.legacy_crm_id__v?.unique ? "legacy_crm_id__v" : undefined);
  const objectTypes: ResolvedMetadata["objectTypes"] = {};
  for (const t of meta.object_types ?? [])
    objectTypes[t.name] = { active: true, requiredFields: [] };
  for (const [name, t] of Object.entries(opts.objectTypes ?? {}))
    objectTypes[name] = {
      active: t.active ?? true,
      requiredFields: t.requiredFields ?? [],
    };
  return {
    targetObject: meta.name,
    legacyIdField: legacy,
    legacyIdFormat: opts.legacyIdFormat ?? "{id18}",
    fields,
    allowTypes: Boolean(meta.allow_types),
    objectTypes,
    lifecycle:
      opts.lifecycle ??
      (meta.available_lifecycles?.length
        ? { name: meta.available_lifecycles[0], states: [] }
        : undefined),
    allowAttachments: meta.allow_attachments,
    systemManagedName: fields.name__v?.systemManagedName,
  };
}

// ---------------------------------------------------------------------------
// Contexts
// ---------------------------------------------------------------------------

export interface CountryContextOptions {
  iso2?: string;
  region?: string;
  picklists?: Record<string, Record<string, string | null>>;
  countries?: CountryCrosswalkEntry[];
  nameTemplates?: Partial<CountryContext["nameTemplates"]>;
  picklistPolicy?: Partial<CountryContext["picklistPolicy"]>;
  locales?: Partial<CountryContext["locales"]>;
  currencies?: Record<string, string>;
  erased?: Iterable<string>;
  defaultTimezone?: string;
}

/** Minimal `CountryContext` for tests (defaults: US, derive picklists, error on unmapped). */
export function buildCountryContext(
  opts: CountryContextOptions = {},
): CountryContext {
  const countries = opts.countries ?? [
    {
      iso2: "US",
      sfdcId: IDS.countryUS,
      vaultId: "V0C000000000101",
      name: "United States",
      picklistValue: "united_states__v",
    },
    {
      iso2: "DE",
      sfdcId: IDS.countryDE,
      vaultId: "V0C000000000102",
      name: "Germany",
      picklistValue: "germany__v",
    },
  ];
  const lookup = makePicklistLookup(opts.picklists ?? {});
  return {
    iso2: opts.iso2 ?? "US",
    region: opts.region,
    nameTemplates: {
      person: "{FirstName} {LastName}",
      speaker: "{LastName}, {FirstName}",
      userTerritory: "{username}:{territory}",
      separator: " ",
      ...opts.nameTemplates,
    },
    formats: {},
    defaultTimezone: opts.defaultTimezone ?? "UTC",
    phone: { normalise: false },
    postalCode: { onMismatch: "warn" },
    picklist: lookup,
    picklistPolicy: {
      derive: "strip_vod_lowercase_v",
      onUnmapped: "error",
      ...opts.picklistPolicy,
    },
    countries: {
      bySfdcId: (id) => countries.find((c) => c.sfdcId === id),
      byIso2: (iso) => countries.find((c) => c.iso2 === iso),
    },
    locales: {
      language: { en_US: "English", de: "German" },
      locale: { en_US: "United States", de_DE: "Germany" },
      ...opts.locales,
    },
    currency: (iso) => (opts.currencies ? opts.currencies[iso] : iso),
    erased: opts.erased ? new Set(opts.erased) : undefined,
  };
}

/** In-memory `IdResolver` seeded from `{ objectKey: { sfdcId: vaultId } }` and `{ userSfdcId: numericId }`. */
export function buildIdResolver(
  map: Partial<Record<ObjectKey, Record<string, string>>> = {},
  users: Record<string, number> = {},
  territories: Record<string, string> = {},
): IdResolver {
  return {
    resolve: (key, id) => map[key]?.[id],
    resolveUser: (id) => users[id],
    resolveTerritoryByName: (name) => territories[name],
  };
}

export interface TransformContextOptions {
  objectKey?: ObjectKey;
  field?: Partial<TransformContext["field"]>;
  targetField?: Partial<ResolvedField> & { name?: string };
  metadata?: Partial<ResolvedMetadata>;
  country?: CountryContext;
  ids?: IdResolver;
  mapping?: Partial<TransformContext["mapping"]>;
  migrationUserId?: number;
  orgId15?: string;
  runMode?: TransformContext["runMode"];
  custom?: TransformContext["custom"];
}

/** Build a `TransformContext` for registry unit tests. */
export function buildTransformContext(
  opts: TransformContextOptions = {},
): TransformContext {
  const field: TransformContext["field"] = {
    source: "X",
    target: "x__v",
    transform: { kind: "copy" },
    required: "n",
    ...opts.field,
  };
  const targetField: ResolvedField | undefined = opts.targetField
    ? {
        name: opts.targetField.name ?? field.target,
        type: opts.targetField.type ?? "string",
        rawType: opts.targetField.rawType ?? "String",
        multiValue: opts.targetField.multiValue ?? false,
        required: opts.targetField.required ?? false,
        unique: opts.targetField.unique ?? false,
        editable: opts.targetField.editable ?? true,
        active: opts.targetField.active ?? true,
        ...opts.targetField,
      }
    : undefined;
  return {
    objectKey: opts.objectKey ?? "account",
    country: opts.country ?? buildCountryContext(),
    metadata: {
      targetObject: "account__v",
      legacyIdField: "legacy_crm_id__v",
      legacyIdFormat: "{id18}",
      fields: targetField ? { [targetField.name]: targetField } : {},
      allowTypes: false,
      objectTypes: {},
      ...opts.metadata,
    },
    ids: opts.ids ?? buildIdResolver(),
    field,
    targetField,
    mapping: {
      objectTypes: {},
      states: {},
      picklists: {},
      required: {},
      options: { ...OBJECT_OPTION_DEFAULTS },
      ...opts.mapping,
    },
    migrationUserId: opts.migrationUserId,
    orgId15: opts.orgId15,
    runMode: opts.runMode ?? "init",
    custom: opts.custom ?? {},
  };
}

/** Minimal `MaterialisedMapping` for apply tests (no hash is computed — pass one in for hash-sensitive tests). */
export function buildMaterialisedMapping(
  partial: Partial<MaterialisedMapping> & {
    objectKey: ObjectKey;
    fields: MaterialisedMapping["fields"];
  },
): MaterialisedMapping {
  return {
    country: "US",
    sourceObject: "Account",
    targetObject: "account__v",
    legacyIdField: "legacy_crm_id__v",
    required: {},
    picklists: {},
    objectTypes: {},
    states: {},
    countryOf: [{ kind: "global" }],
    scope: { spec: { kind: "full" } },
    load: { noTriggers: true },
    options: { ...OBJECT_OPTION_DEFAULTS },
    match: [{ method: "legacy_id" }],
    selfRefs: [],
    dependsOn: [],
    findings: [],
    mappingHash: "test-mapping-hash",
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// Sample rows
// ---------------------------------------------------------------------------

export const SAMPLE_USER_ID = "005000000000001AAA";
export const SAMPLE_USER_ID_2 = "005000000000002AAA";
export const SAMPLE_QUEUE_ID = "00G000000000001AAA";

/** Three accounts (US person, US business, DE person) + one soft-deleted row. */
export function sampleAccountRows(): SourceRow[] {
  return [
    {
      Id: "001000000000001AAA",
      IsDeleted: false,
      Name: "Jane Doe",
      FirstName: "Jane",
      LastName: "Doe",
      Salutation: "Dr.",
      IsPersonAccount: true,
      "RecordType.DeveloperName": "Professional_vod",
      Country_vod__c: IDS.countryUS,
      "Country_vod__r.Alpha_2_Code_vod__c": "US",
      Specialty_1_vod__c: "CD",
      Credentials_vod__c: "MD",
      OwnerId: SAMPLE_USER_ID,
      CreatedById: SAMPLE_USER_ID,
      LastModifiedById: SAMPLE_USER_ID,
      CreatedDate: "2021-05-04T10:11:12.000Z",
      LastModifiedDate: "2025-01-02T03:04:05.000Z",
      SystemModstamp: "2025-01-02T03:04:05.000Z",
      External_ID_vod__c: "NET-001",
      Mobile_ID_vod__c: "7d2c5f4e-0001",
    },
    {
      Id: "001000000000002AAA",
      IsDeleted: false,
      Name: "General Hospital",
      IsPersonAccount: false,
      "RecordType.DeveloperName": "Hospital_vod",
      Country_vod__c: IDS.countryUS,
      "Country_vod__r.Alpha_2_Code_vod__c": "US",
      Primary_Parent_vod__c: null,
      OwnerId: SAMPLE_QUEUE_ID,
      CreatedById: SAMPLE_USER_ID,
      LastModifiedById: SAMPLE_USER_ID_2,
      CreatedDate: "2019-02-03T00:00:00.000Z",
      LastModifiedDate: "2024-12-31T23:59:59.000Z",
      SystemModstamp: "2024-12-31T23:59:59.000Z",
    },
    {
      Id: "001000000000003AAA",
      IsDeleted: false,
      Name: "Max Mustermann",
      FirstName: "Max",
      LastName: "Mustermann",
      Salutation: "Dr. med.",
      IsPersonAccount: true,
      "RecordType.DeveloperName": "Professional_vod",
      Country_vod__c: IDS.countryDE,
      "Country_vod__r.Alpha_2_Code_vod__c": "DE",
      Primary_Parent_vod__c: "001000000000002AAA",
      OwnerId: SAMPLE_USER_ID_2,
      CreatedById: SAMPLE_USER_ID_2,
      LastModifiedById: SAMPLE_USER_ID_2,
      CreatedDate: "2022-07-08T09:10:11.000Z",
      LastModifiedDate: "2025-03-04T05:06:07.000Z",
      SystemModstamp: "2025-03-04T05:06:07.000Z",
    },
    {
      Id: "001000000000004AAA",
      IsDeleted: true,
      Name: "Deleted Duplicate",
      MasterRecordId: "001000000000001AAA",
      "RecordType.DeveloperName": "Professional_vod",
      Country_vod__c: IDS.countryUS,
      "Country_vod__r.Alpha_2_Code_vod__c": "US",
      OwnerId: SAMPLE_USER_ID,
      CreatedById: SAMPLE_USER_ID,
      LastModifiedById: SAMPLE_USER_ID,
      CreatedDate: "2020-01-01T00:00:00.000Z",
      LastModifiedDate: "2025-04-01T00:00:00.000Z",
      SystemModstamp: "2025-04-01T00:00:00.000Z",
    },
  ];
}

/** Two calls: a submitted 2025 parent call (US) and a planned 2019 attendee row (DE), plus an old out-of-scope call. */
export function sampleCall2Rows(): SourceRow[] {
  return [
    {
      Id: IDS.call1,
      IsDeleted: false,
      Name: "C-000001",
      "RecordType.DeveloperName": "CallReport_vod",
      Status_vod__c: "Submitted_vod",
      Call_Date_vod__c: "2025-03-04",
      Call_Datetime_vod__c: "2025-03-04T10:00:00.000Z",
      Account_vod__c: "001000000000001AAA",
      "Account_vod__r.Country_vod__r.Alpha_2_Code_vod__c": "US",
      User_vod__c: SAMPLE_USER_ID,
      OwnerId: SAMPLE_USER_ID,
      Parent_Call_vod__c: null,
      Territory_vod__c: "US-NE-01",
      Call_Type_vod__c: "Detail Only",
      Call_Channel_vod__c: "Face_to_face_vod",
      Detailed_Products_vod__c: "Cholecap;Restolar",
      Next_Call_Notes_vod__c: "Follow up on samples",
      Signature_vod__c: "iVBORw0KGgo=",
      Signature_Date_vod__c: "2025-03-04T10:30:00.000Z",
      Is_Parent_Call_vod__c: true,
      Unlock_vod__c: false,
      Mobile_ID_vod__c: "7d2c5f4e-call-0001",
      CreatedById: SAMPLE_USER_ID,
      LastModifiedById: SAMPLE_USER_ID,
      CreatedDate: "2025-03-04T10:31:00.000Z",
      LastModifiedDate: "2025-03-04T10:31:00.000Z",
      SystemModstamp: "2025-03-04T10:31:00.000Z",
    },
    {
      Id: IDS.call2,
      IsDeleted: false,
      Name: "C-000002",
      "RecordType.DeveloperName": "CallReport_vod",
      Status_vod__c: "Planned_vod",
      Call_Date_vod__c: "2019-06-01",
      Call_Datetime_vod__c: "2019-06-01T09:00:00.000Z",
      Account_vod__c: "001000000000003AAA",
      "Account_vod__r.Country_vod__r.Alpha_2_Code_vod__c": "DE",
      User_vod__c: SAMPLE_USER_ID_2,
      OwnerId: SAMPLE_USER_ID_2,
      Parent_Call_vod__c: IDS.call1,
      Attendee_Type_vod__c: "Person_Account_vod",
      Is_Parent_Call_vod__c: false,
      CreatedById: SAMPLE_USER_ID_2,
      LastModifiedById: SAMPLE_USER_ID_2,
      CreatedDate: "2019-06-01T09:05:00.000Z",
      LastModifiedDate: "2019-06-01T09:05:00.000Z",
      SystemModstamp: "2019-06-01T09:05:00.000Z",
    },
    {
      Id: IDS.call3,
      IsDeleted: false,
      Name: "C-000003",
      "RecordType.DeveloperName": "CallReport_vod",
      Status_vod__c: "Submitted_vod",
      Call_Date_vod__c: "2018-01-15",
      Call_Datetime_vod__c: "2018-01-15T14:00:00.000Z",
      Account_vod__c: "001000000000002AAA",
      "Account_vod__r.Country_vod__r.Alpha_2_Code_vod__c": "US",
      User_vod__c: SAMPLE_USER_ID,
      OwnerId: SAMPLE_USER_ID,
      Parent_Call_vod__c: null,
      Is_Parent_Call_vod__c: true,
      CreatedById: SAMPLE_USER_ID,
      LastModifiedById: SAMPLE_USER_ID,
      CreatedDate: "2018-01-15T14:05:00.000Z",
      LastModifiedDate: "2018-01-15T14:05:00.000Z",
      SystemModstamp: "2018-01-15T14:05:00.000Z",
    },
  ];
}

/** Describe fixtures matching the sample rows. */
export function sampleAccountDescribe(): SfdcObjectDescribe {
  return buildDescribe(
    "Account",
    [
      { name: "FirstName", type: "string", length: 40 },
      { name: "LastName", type: "string", length: 80 },
      {
        name: "Salutation",
        type: "picklist",
        picklistValues: [{ value: "Dr.", active: true }],
      },
      { name: "IsPersonAccount", type: "boolean" },
      {
        name: "Country_vod__c",
        type: "reference",
        referenceTo: ["Country_vod__c"],
        relationshipName: "Country_vod__r",
      },
      {
        name: "Specialty_1_vod__c",
        type: "picklist",
        picklistValues: [{ value: "CD", label: "Cardiology", active: true }],
      },
      {
        name: "Credentials_vod__c",
        type: "picklist",
        picklistValues: [{ value: "MD", active: true }],
      },
      {
        name: "Primary_Parent_vod__c",
        type: "reference",
        referenceTo: ["Account"],
        relationshipName: "Primary_Parent_vod__r",
      },
      {
        name: "External_ID_vod__c",
        type: "string",
        externalId: true,
        length: 120,
      },
      {
        name: "Mobile_ID_vod__c",
        type: "string",
        externalId: true,
        length: 100,
      },
      { name: "MasterRecordId", type: "reference", referenceTo: ["Account"] },
      { name: "Formatted_Name_vod__c", type: "string", calculated: true },
    ],
    {
      keyPrefix: "001",
      systemFields: { recordType: true, currency: true },
      recordTypes: [
        { developerName: "Professional_vod" },
        { developerName: "Hospital_vod" },
      ],
    },
  );
}

export function sampleCall2Describe(): SfdcObjectDescribe {
  return buildDescribe(
    "Call2_vod__c",
    [
      {
        name: "Status_vod__c",
        type: "picklist",
        picklistValues: [
          { value: "Planned_vod", active: true },
          { value: "Saved_vod", active: true },
          { value: "Submitted_vod", active: true },
        ],
      },
      { name: "Call_Date_vod__c", type: "date" },
      { name: "Call_Datetime_vod__c", type: "datetime" },
      {
        name: "Account_vod__c",
        type: "reference",
        referenceTo: ["Account"],
        relationshipName: "Account_vod__r",
      },
      {
        name: "User_vod__c",
        type: "reference",
        referenceTo: ["User"],
        relationshipName: "User_vod__r",
      },
      {
        name: "Parent_Call_vod__c",
        type: "reference",
        referenceTo: ["Call2_vod__c"],
        relationshipName: "Parent_Call_vod__r",
      },
      { name: "Territory_vod__c", type: "string", length: 100 },
      {
        name: "Call_Type_vod__c",
        type: "picklist",
        picklistValues: [{ value: "Detail Only", active: true }],
      },
      {
        name: "Call_Channel_vod__c",
        type: "picklist",
        picklistValues: [{ value: "Face_to_face_vod", active: true }],
      },
      {
        name: "Attendee_Type_vod__c",
        type: "picklist",
        picklistValues: [{ value: "Person_Account_vod", active: true }],
      },
      { name: "Detailed_Products_vod__c", type: "textarea" },
      { name: "Next_Call_Notes_vod__c", type: "textarea" },
      { name: "Signature_vod__c", type: "textarea", length: 131072 },
      { name: "Signature_Date_vod__c", type: "datetime" },
      { name: "Is_Parent_Call_vod__c", type: "boolean", calculated: true },
      { name: "Unlock_vod__c", type: "boolean" },
      { name: "Mobile_ID_vod__c", type: "string", externalId: true },
    ],
    {
      keyPrefix: "a0K",
      systemFields: { recordType: true },
      recordTypes: [{ developerName: "CallReport_vod" }],
    },
  );
}

/** Vault metadata fixtures matching the sample objects. */
export function sampleAccountVaultMetadata(): VaultObjectMetadata {
  return buildVaultMetadata(
    "account__v",
    [
      { name: "first_name__v", type: "String", max_length: 40 },
      { name: "last_name__v", type: "String", max_length: 80 },
      { name: "salutation__v", type: "Picklist", picklist: "salutation__v" },
      {
        name: "primary_country__v",
        type: "Object",
        object: { name: "country__v" },
      },
      { name: "specialty_1__v", type: "Picklist", picklist: "specialty__v" },
      { name: "credentials__v", type: "Picklist", picklist: "credentials__v" },
      {
        name: "primary_parent__v",
        type: "Object",
        object: { name: "account__v" },
      },
      { name: "external_id__v", type: "String", max_length: 120, unique: true },
      { name: "mobile_id__v", type: "String", max_length: 100 },
      { name: "ownerid__v", type: "Object", object: { name: "user__sys" } },
    ],
    { objectTypes: ["professional__v", "hospital__v"] },
  );
}

export function sampleCall2VaultMetadata(): VaultObjectMetadata {
  return buildVaultMetadata(
    "call2__v",
    [
      {
        name: "call2_status__v",
        type: "Picklist",
        picklist: "call2_status__v",
      },
      { name: "call_date__v", type: "Date", required: true },
      { name: "call_datetime__v", type: "DateTime" },
      { name: "account__v", type: "Object", object: { name: "account__v" } },
      { name: "user__v", type: "Object", object: { name: "user__sys" } },
      { name: "ownerid__v", type: "Object", object: { name: "user__sys" } },
      { name: "parent_call__v", type: "Object", object: { name: "call2__v" } },
      { name: "territory__v", type: "String", max_length: 100 },
      { name: "call_type__v", type: "Picklist", picklist: "call_type__v" },
      {
        name: "call_channel__v",
        type: "Picklist",
        picklist: "call_channel__v",
      },
      {
        name: "attendee_type__v",
        type: "Picklist",
        picklist: "attendee_type__v",
      },
      { name: "detailed_products__v", type: "LongText" },
      { name: "next_call_notes__v", type: "LongText" },
      { name: "signature__v", type: "LongText", max_length: 131072 },
      { name: "signature_date__v", type: "DateTime" },
      { name: "unlock__v", type: "Boolean" },
      { name: "mobile_id__v", type: "String", max_length: 100 },
    ],
    { objectTypes: ["call_report__v"], lifecycles: ["call2_lifecycle__v"] },
  );
}
