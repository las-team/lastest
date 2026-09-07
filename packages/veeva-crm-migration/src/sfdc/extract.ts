/**
 * Salesforce → `OrgSnapshot` extractor.
 *
 * Call order (DESIGN.md §4.2): org + limits → global describe → object set →
 * per object (describe, describe/layouts) → validation rules → profiles /
 * permission sets (SOQL) + per-profile Tooling `Metadata` with fallbacks →
 * users aggregate → VMOCs → Veeva Settings → messages → automation → countries.
 *
 * Every stage is wrapped: a failure records an `ExtractionWarning` and the
 * extraction continues with what it has. Only an exhausted request budget
 * aborts the whole run.
 */
import {
  countriesFromProfileName,
  countriesFromWhereClause,
} from "../model/classify";
import type {
  ApplicationVisibility,
  AutomationItem,
  CountryCode,
  CountryRef,
  CountrySource,
  ExtractionWarning,
  FieldConfig,
  FieldPermission,
  LayoutAssignment,
  LayoutConfig,
  LayoutItem,
  LayoutSection,
  ObjectConfig,
  ObjectPermission,
  OrgSnapshot,
  PermissionSetConfig,
  PicklistValue,
  ProfileConfig,
  RecordTypeConfig,
  RecordTypeVisibility,
  SettingObjectMeta,
  TabVisibility,
  UserSummary,
  ValidationRuleConfig,
  VeevaMessage,
  VeevaSettingRecord,
  VmocConfig,
} from "../model/types";
import { GLOBAL_COUNTRY } from "../model/types";
import type {
  DescribeField,
  DescribeGlobal,
  DescribeGlobalSObject,
  DescribeLayout,
  DescribeLayoutSection,
  DescribeLayouts,
  DescribePicklistValue,
  DescribeSObject,
  LayoutMetadata,
  LimitsResponse,
  ProfileMetadata,
  SoqlRow,
} from "./api-types";
import { SfdcApiError, type SfdcClient } from "./client";
import { countryName, isCountryCode, normalizeCountry } from "./countries";
import {
  APEX_TRIGGER_QUERY,
  APP_ACCESS_QUERY,
  APP_MENU_ITEM_QUERY,
  CORE_OBJECTS,
  COUNTRY_OBJECT,
  CUSTOM_OBJECT_QUERY,
  FLOW_DEFINITION_QUERY,
  LAYOUT_QUERY,
  MESSAGE_FIELDS,
  MESSAGE_OBJECT,
  ORGANIZATION_QUERY,
  PERMISSION_SET_ASSIGNMENT_COUNT_QUERY,
  PERMISSION_SET_BY_PROFILE_QUERY,
  PERMISSION_SET_QUERY,
  RECORD_TYPE_QUERY,
  TAB_SETTINGS_QUERY,
  VMOC_KNOWN_FIELDS,
  VMOC_OBJECT,
  WORKFLOW_RULE_QUERY,
  chunkIds,
  countryObjectQuery,
  fieldPermissionsQuery,
  invalidFieldFromMessage,
  isSkippedObject,
  isVeevaManaged,
  isVeevaSettingObject,
  layoutMetadataQuery,
  messageQuery,
  objectPermissionsQuery,
  profileLayoutQuery,
  profileMetadataQuery,
  profileQuery,
  sameId,
  settingLevel,
  settingRecordsQuery,
  userSummaryQuery,
  validationRuleQuery,
  vmocQuery,
} from "./queries";

export interface ExtractOptions {
  /** Overrides the client's API version for this extraction. */
  apiVersion?: string;
  /** Explicit object list; default = Veeva core set ∩ org + every non-managed custom object. */
  objects?: string[];
  /** Adds every `*_vod__c` object to the default set. */
  includeManagedObjects?: boolean;
  /** Abort once this many org API calls were made. */
  maxRequests?: number;
  log?: (message: string) => void;
  now?: () => Date;
  /** `referenced` (default) = only languages used by active users + `en_US`; `all` = every message row. */
  messageFilter?: "all" | "referenced";
  /**
   * Layouts assigned to a profile but not visible to the running user are
   * fetched one by one via Tooling `Layout.Metadata`; this bounds the count
   * (default 300, `0` disables).
   */
  maxLayoutMetadataFetches?: number;
}

// ---------------------------------------------------------------------------
// SOQL row shapes (internal)
// ---------------------------------------------------------------------------

interface ProfileRow extends SoqlRow {
  Id: string;
  Name: string;
  UserLicenseId?: string | null;
  UserLicense?: { Name?: string | null } | null;
  UserType?: string | null;
  Description?: string | null;
}

interface PermissionSetRow extends SoqlRow {
  Id: string;
  Name: string;
  Label?: string | null;
  IsOwnedByProfile: boolean;
  ProfileId?: string | null;
  NamespacePrefix?: string | null;
  IsCustom?: boolean;
  Type?: string | null;
  Description?: string | null;
}

interface ObjectPermissionsRow extends SoqlRow {
  ParentId: string;
  SobjectType: string;
  PermissionsCreate: boolean;
  PermissionsRead: boolean;
  PermissionsEdit: boolean;
  PermissionsDelete: boolean;
  PermissionsViewAllRecords: boolean;
  PermissionsModifyAllRecords: boolean;
}

interface FieldPermissionsRow extends SoqlRow {
  ParentId: string;
  SobjectType: string;
  Field: string;
  PermissionsRead: boolean;
  PermissionsEdit: boolean;
}

interface RecordTypeRow extends SoqlRow {
  Id: string;
  Name: string;
  DeveloperName: string;
  SobjectType: string;
  IsActive: boolean;
  NamespacePrefix?: string | null;
  Description?: string | null;
}

interface CustomObjectRow extends SoqlRow {
  Id: string;
  DeveloperName: string;
  NamespacePrefix?: string | null;
}

interface LayoutRow extends SoqlRow {
  Id: string;
  Name: string;
  TableEnumOrId: string;
  LayoutType?: string | null;
  NamespacePrefix?: string | null;
  ManageableState?: string | null;
}

interface ProfileLayoutRow extends SoqlRow {
  Id: string;
  ProfileId: string;
  LayoutId: string;
  RecordTypeId: string | null;
  TableEnumOrId: string;
}

interface ValidationRuleRow extends SoqlRow {
  Id: string;
  ValidationName: string;
  Active: boolean;
  EntityDefinition?: { QualifiedApiName?: string | null } | null;
  ErrorMessage?: string | null;
  ErrorDisplayField?: string | null;
  NamespacePrefix?: string | null;
}

interface AggregateRow extends SoqlRow {
  n: number;
}

// ---------------------------------------------------------------------------
// Context: warnings, describe cache, resilient helpers
// ---------------------------------------------------------------------------

class ExtractContext {
  readonly warnings: ExtractionWarning[] = [];
  readonly sobjects = new Map<string, DescribeGlobalSObject>();
  private readonly describes = new Map<string, Promise<DescribeSObject>>();

  constructor(
    readonly client: SfdcClient,
    readonly log: (message: string) => void,
  ) {}

  warn(stage: string, message: string, detail?: unknown): void {
    this.warnings.push(
      detail === undefined ? { stage, message } : { stage, message, detail },
    );
    this.log(`warning [${stage}] ${message}`);
  }

  has(object: string): boolean {
    return this.sobjects.has(object);
  }

  /** Runs one stage; a failure becomes a warning and `fallback` is returned. */
  async stage<T>(name: string, fallback: T, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (isBudgetError(err)) throw err;
      this.warn(name, `failed: ${errorMessage(err)}`, errorDetail(err));
      return fallback;
    }
  }

  describe(object: string): Promise<DescribeSObject> {
    let p = this.describes.get(object);
    if (!p) {
      p = this.client.get<DescribeSObject>(
        `/sobjects/${encodeURIComponent(object)}/describe`,
      );
      this.describes.set(object, p);
      p.catch(() => this.describes.delete(object));
    }
    return p;
  }

  /**
   * Query that drops columns the org rejects (`INVALID_FIELD` /
   * `INVALID_TYPE` on a relationship) and retries, up to three times.
   */
  async queryDroppingInvalid<T>(
    stage: string,
    soql: string,
    tooling = false,
  ): Promise<T[]> {
    let current = soql;
    for (let i = 0; ; i++) {
      try {
        return tooling
          ? await this.client.toolingQuery<T>(current)
          : await this.client.query<T>(current);
      } catch (err) {
        if (
          i >= 3 ||
          !(err instanceof SfdcApiError) ||
          ![
            "INVALID_FIELD",
            "INVALID_TYPE",
            "INVALID_QUERY_FILTER_OPERATOR",
          ].includes(err.errorCode)
        )
          throw err;
        const column = invalidFieldFromMessage(err.message);
        const next = column ? dropSelectColumn(current, column) : null;
        if (!next || next === current) throw err;
        this.warn(stage, `column ${column} not available; retrying without it`);
        current = next;
      }
    }
  }
}

function isBudgetError(err: unknown): boolean {
  return (
    err instanceof SfdcApiError && err.errorCode === "REQUEST_BUDGET_EXCEEDED"
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function errorDetail(err: unknown): unknown {
  if (err instanceof SfdcApiError)
    return { status: err.status, errorCode: err.errorCode, path: err.path };
  return undefined;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Removes `column` (optionally aliased) from the SELECT list of a SOQL statement. */
export function dropSelectColumn(soql: string, column: string): string {
  const fromIdx = soql.search(/\sFROM\s/i);
  if (fromIdx < 0) return soql;
  const select = soql.slice(0, fromIdx);
  const rest = soql.slice(fromIdx);
  const parts = select
    .replace(/^\s*SELECT\s+/i, "")
    .split(",")
    .map((p) => p.trim())
    .filter((p) => {
      const name = p.split(/\s+/)[0] ?? "";
      return (
        name.toLowerCase() !== column.toLowerCase() &&
        !new RegExp(`^${escapeRegExp(column)}$`, "i").test(name)
      );
    });
  if (parts.length === 0) return soql;
  return `SELECT ${parts.join(", ")}${rest}`;
}

// ---------------------------------------------------------------------------
// Pure builders (exported for tests)
// ---------------------------------------------------------------------------

/** Decides which objects to extract from the global describe. */
export function decideObjectSet(
  sobjects: readonly DescribeGlobalSObject[],
  options: Pick<ExtractOptions, "objects" | "includeManagedObjects">,
  warn?: (message: string, detail?: unknown) => void,
): string[] {
  const byName = new Map(sobjects.map((s) => [s.name, s]));
  if (options.objects && options.objects.length > 0) {
    const missing = options.objects.filter((o) => !byName.has(o));
    if (missing.length > 0 && warn)
      warn(
        `requested objects not found in the org: ${missing.join(", ")}`,
        missing,
      );
    return options.objects.filter((o) => byName.has(o));
  }
  const set = new Set<string>();
  for (const name of CORE_OBJECTS) if (byName.has(name)) set.add(name);
  for (const s of sobjects) {
    if (isSkippedObject(s.name) || s.customSetting) continue;
    if (!s.custom) continue;
    if (isVeevaManaged(s.name)) {
      if (options.includeManagedObjects && s.layoutable) set.add(s.name);
    } else if (s.layoutable || s.queryable) {
      set.add(s.name);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

function picklist(
  values: readonly DescribePicklistValue[] | undefined,
): PicklistValue[] | undefined {
  if (!values || values.length === 0) return undefined;
  return values.map((v) => ({
    value: v.value,
    label: v.label ?? v.value,
    active: v.active,
    default: v.defaultValue,
  }));
}

export function buildFieldConfig(field: DescribeField): FieldConfig {
  const cfg: FieldConfig = {
    apiName: field.name,
    label: field.label,
    type: field.type,
    custom: field.custom,
    managed: isVeevaManaged(field.name),
    required:
      !field.nillable &&
      !field.defaultedOnCreate &&
      field.createable !== false &&
      field.type !== "boolean",
  };
  if (field.length) cfg.length = field.length;
  if (field.precision) cfg.precision = field.precision;
  if (field.scale) cfg.scale = field.scale;
  if (field.referenceTo && field.referenceTo.length > 0)
    cfg.referenceTo = field.referenceTo;
  const pv = picklist(field.picklistValues);
  if (pv) cfg.picklistValues = pv;
  if (field.controllerName) cfg.controllerName = field.controllerName;
  if (field.calculatedFormula) cfg.formula = field.calculatedFormula;
  if (field.inlineHelpText) cfg.helpText = field.inlineHelpText;
  return cfg;
}

interface DecodedLayout {
  sections: LayoutSection[];
  relatedLists: string[];
  buttons: string[];
  actions: string[];
}

function fieldsOfComponents(
  components: readonly {
    type: string;
    value?: string | null;
    components?: unknown[];
  }[],
): string[] {
  const out: string[] = [];
  for (const c of components) {
    if (c.type === "Field" && c.value) out.push(c.value);
    if (Array.isArray(c.components)) {
      out.push(
        ...fieldsOfComponents(
          c.components as { type: string; value?: string | null }[],
        ),
      );
    }
  }
  return out;
}

function sectionsFromDescribe(
  sections: readonly DescribeLayoutSection[],
): LayoutSection[] {
  return sections.map((s) => {
    const fields: string[] = [];
    const items: LayoutItem[] = [];
    for (const row of s.layoutRows ?? []) {
      for (const item of row.layoutItems ?? []) {
        for (const field of fieldsOfComponents(item.layoutComponents ?? [])) {
          fields.push(field);
          const editable = item.editableForNew || item.editableForUpdate;
          items.push({
            field,
            behavior: item.required
              ? "Required"
              : editable
                ? "Edit"
                : "Readonly",
          });
        }
      }
    }
    return { heading: s.heading ?? "", columns: s.columns ?? 1, fields, items };
  });
}

/** Decodes a `describe/layouts` layout entry (the running user's view). */
export function decodeDescribeLayout(layout: DescribeLayout): DecodedLayout {
  const source =
    layout.editLayoutSections && layout.editLayoutSections.length > 0
      ? layout.editLayoutSections
      : (layout.detailLayoutSections ?? []);
  const sections = sectionsFromDescribe(source);
  // detail-only fields (e.g. formulas) are missing from the edit sections;
  // merge them in as read-only so the docs list every field on the page.
  if (source === layout.editLayoutSections && layout.detailLayoutSections) {
    const seen = new Set(sections.flatMap((s) => s.fields));
    for (const s of sectionsFromDescribe(layout.detailLayoutSections)) {
      const extra = s.fields.filter((f) => !seen.has(f));
      if (extra.length === 0) continue;
      const target = sections.find((t) => t.heading === s.heading);
      if (target) {
        target.fields.push(...extra);
        target.items?.push(
          ...extra.map((field) => ({ field, behavior: "Readonly" as const })),
        );
      } else {
        sections.push({
          heading: s.heading,
          columns: s.columns,
          fields: extra,
          items: extra.map((field) => ({
            field,
            behavior: "Readonly" as const,
          })),
        });
      }
      for (const f of extra) seen.add(f);
    }
  }
  const relatedLists = (layout.relatedLists ?? [])
    .map((r) => r.name ?? r.sobject ?? r.label ?? "")
    .filter(Boolean);
  const buttons = (layout.buttonLayoutSection?.detailButtons ?? [])
    .map((b) => b.name)
    .filter(Boolean);
  const actions = (layout.quickActionList?.quickActionListItems ?? [])
    .map((a) => a.quickActionName ?? "")
    .filter(Boolean);
  return { sections, relatedLists, buttons, actions };
}

/** Decodes a Tooling `Layout.Metadata` blob (profile independent). */
export function decodeLayoutMetadata(meta: LayoutMetadata): DecodedLayout {
  const sections: LayoutSection[] = (meta.layoutSections ?? []).map((s) => {
    const fields: string[] = [];
    const items: LayoutItem[] = [];
    const columns = s.layoutColumns ?? [];
    for (const col of columns) {
      for (const item of col.layoutItems ?? []) {
        if (!item.field) continue;
        fields.push(item.field);
        const b = item.behavior;
        items.push({
          field: item.field,
          behavior: b === "Required" || b === "Readonly" ? b : "Edit",
        });
      }
    }
    return {
      heading: s.label ?? "",
      columns: Math.max(1, columns.length),
      fields,
      items,
    };
  });
  return {
    sections,
    relatedLists: (meta.relatedLists ?? [])
      .map((r) => r.relatedList ?? "")
      .filter(Boolean),
    buttons: [...(meta.customButtons ?? [])],
    actions: (meta.quickActionList?.quickActionListItems ?? [])
      .map((a) => a.quickActionName ?? "")
      .filter(Boolean),
  };
}

/** Splits a Metadata-API layout full name (`Call2_vod__c-Call Layout`) into object + name. */
export function splitLayoutFullName(fullName: string): {
  object: string;
  name: string;
} {
  const idx = fullName.indexOf("-");
  if (idx < 0) return { object: "", name: fullName };
  return { object: fullName.slice(0, idx), name: fullName.slice(idx + 1) };
}

/** Decodes the `Profile.Metadata` blob into the profile-level config lists. */
export function decodeProfileMetadata(
  meta: ProfileMetadata,
  objectsInScope?: ReadonlySet<string>,
): {
  layoutAssignments: LayoutAssignment[] | null;
  recordTypeVisibilities: RecordTypeVisibility[] | null;
  tabVisibilities: TabVisibility[] | null;
  applicationVisibilities: ApplicationVisibility[] | null;
  userPermissions: string[] | null;
} {
  const inScope = (object: string) =>
    !objectsInScope || objectsInScope.has(object);
  const layoutAssignments = Array.isArray(meta.layoutAssignments)
    ? meta.layoutAssignments
        .map((la) => {
          const { object } = splitLayoutFullName(la.layout);
          const rt = la.recordType
            ? (la.recordType.split(".")[1] ?? la.recordType)
            : null;
          return { object, recordType: rt, layout: la.layout };
        })
        .filter((la) => inScope(la.object))
    : null;
  const recordTypeVisibilities = Array.isArray(meta.recordTypeVisibilities)
    ? meta.recordTypeVisibilities
        .map((rv) => {
          const [object = "", recordType = ""] = rv.recordType.split(".");
          return {
            object,
            recordType,
            visible: rv.visible === true,
            default: rv.default === true,
          };
        })
        .filter((rv) => inScope(rv.object))
    : null;
  const tabVisibilities = Array.isArray(meta.tabVisibilities)
    ? meta.tabVisibilities.map((tv) => ({
        tab: tv.tab,
        visibility: normalizeTabVisibility(tv.visibility),
      }))
    : null;
  const applicationVisibilities = Array.isArray(meta.applicationVisibilities)
    ? meta.applicationVisibilities.map((av) => ({
        application: av.application,
        visible: av.visible === true,
        default: av.default === true,
      }))
    : null;
  const userPermissions = Array.isArray(meta.userPermissions)
    ? meta.userPermissions
        .filter((p) => p.enabled)
        .map((p) => `Permissions${p.name}`)
    : null;
  return {
    layoutAssignments,
    recordTypeVisibilities,
    tabVisibilities,
    applicationVisibilities,
    userPermissions,
  };
}

export function normalizeTabVisibility(
  raw: string | null | undefined,
): TabVisibility["visibility"] {
  switch ((raw ?? "").toLowerCase()) {
    case "defaulton":
    case "visible":
      return "DefaultOn";
    case "defaultoff":
    case "available":
      return "DefaultOff";
    default:
      return "Hidden";
  }
}

/** Resolves the country of a user-aggregate row to an ISO code or `GLOBAL`. */
export function resolveUserCountry(
  raw: unknown,
  unknown?: Set<string>,
): CountryCode {
  if (raw == null || raw === "") return GLOBAL_COUNTRY;
  const text = String(raw);
  const code = normalizeCountry(text);
  if (code) return code;
  unknown?.add(text);
  return GLOBAL_COUNTRY;
}

// ---------------------------------------------------------------------------
// The extraction
// ---------------------------------------------------------------------------

export async function extractOrgSnapshot(
  client: SfdcClient,
  options: ExtractOptions = {},
): Promise<OrgSnapshot> {
  const log = options.log ?? (() => {});
  const now = options.now ?? (() => new Date());
  if (options.maxRequests !== undefined)
    client.maxRequests = options.maxRequests;
  if (options.apiVersion) client.apiVersion = options.apiVersion;
  const ctx = new ExtractContext(client, log);
  const progress = (msg: string) =>
    log(
      `${msg} (api calls: ${client.requestCount}${client.apiUsage ? `, org usage ${client.apiUsage.used}/${client.apiUsage.max}` : ""})`,
    );

  // A1/A2 — org identity and limits ---------------------------------------
  const orgRow = await ctx.stage<SoqlRow | undefined>(
    "org",
    undefined,
    async () => {
      const rows = await client.query<SoqlRow>(ORGANIZATION_QUERY);
      return rows[0];
    },
  );
  const limits = await ctx.stage<LimitsResponse | undefined>(
    "limits",
    undefined,
    () => client.get<LimitsResponse>("/limits"),
  );

  // B1 — global describe (required) ----------------------------------------
  const global = await client.get<DescribeGlobal>("/sobjects");
  for (const s of global.sobjects ?? []) ctx.sobjects.set(s.name, s);
  const objectNames = decideObjectSet(global.sobjects ?? [], options, (m, d) =>
    ctx.warn("objects", m, d),
  );
  const objectsInScope = new Set(objectNames);
  progress(`object set: ${objectNames.length} objects`);

  // B2 / B4 / D1 — id maps ------------------------------------------------
  const customObjectIds = await ctx.stage(
    "custom_objects",
    new Map<string, string>(),
    async () => {
      const rows =
        await client.toolingQuery<CustomObjectRow>(CUSTOM_OBJECT_QUERY);
      const map = new Map<string, string>();
      for (const r of rows) {
        const name = `${r.NamespacePrefix ? `${r.NamespacePrefix}__` : ""}${r.DeveloperName}__c`;
        map.set(r.Id, name);
        map.set(r.Id.slice(0, 15), name);
      }
      return map;
    },
  );
  const tableEnumOrIdOf = (object: string): string => {
    for (const [id, name] of customObjectIds)
      if (name === object && id.length === 18) return id;
    return object;
  };
  const decodeTableEnumOrId = (value: string): string =>
    customObjectIds.get(value) ?? value;

  const recordTypeRows = await ctx.stage<RecordTypeRow[]>(
    "record_types",
    [],
    () => client.query<RecordTypeRow>(RECORD_TYPE_QUERY),
  );
  const recordTypeById = new Map<string, RecordTypeRow>();
  for (const rt of recordTypeRows) {
    recordTypeById.set(rt.Id, rt);
    recordTypeById.set(rt.Id.slice(0, 15), rt);
  }

  const layoutRows = await ctx.stage<LayoutRow[]>("layouts", [], () =>
    client.toolingQuery<LayoutRow>(LAYOUT_QUERY),
  );
  const layoutById = new Map<string, LayoutRow>();
  const layoutIdByFullName = new Map<string, string>();
  for (const l of layoutRows) {
    layoutById.set(l.Id, l);
    layoutById.set(l.Id.slice(0, 15), l);
    layoutIdByFullName.set(
      `${decodeTableEnumOrId(l.TableEnumOrId)}-${l.Name}`,
      l.Id,
    );
  }
  const layoutFullName = (layoutId: string, object: string): string => {
    const row =
      layoutById.get(layoutId) ?? layoutById.get(layoutId.slice(0, 15));
    return row ? `${object}-${row.Name}` : `${object}-${layoutId}`;
  };
  const layoutIsManaged = (layoutId: string, name: string): boolean => {
    const row =
      layoutById.get(layoutId) ?? layoutById.get(layoutId.slice(0, 15));
    if (row?.ManageableState === "installed" || row?.NamespacePrefix)
      return true;
    return /_vod$/i.test(row?.Name ?? name);
  };

  // B3 — per object -------------------------------------------------------
  const objects: ObjectConfig[] = [];
  const objectByName = new Map<string, ObjectConfig>();
  const describedFields = new Map<string, DescribeField[]>();
  const recordTypeDevNameById = new Map<
    string,
    { object: string; developerName: string }
  >();
  for (const name of objectNames) {
    const cfg = await ctx.stage<ObjectConfig | null>(
      `object:${name}`,
      null,
      async () => {
        const d = await ctx.describe(name);
        describedFields.set(name, d.fields ?? []);
        const recordTypes: RecordTypeConfig[] = (d.recordTypeInfos ?? [])
          .filter((rt) => !rt.master)
          .map((rt) => {
            const row = recordTypeById.get(rt.recordTypeId);
            const developerName =
              rt.developerName ?? row?.DeveloperName ?? rt.name;
            recordTypeDevNameById.set(rt.recordTypeId, {
              object: name,
              developerName,
            });
            recordTypeDevNameById.set(rt.recordTypeId.slice(0, 15), {
              object: name,
              developerName,
            });
            const cfgRt: RecordTypeConfig = {
              id: rt.recordTypeId,
              developerName,
              name: rt.name,
              active: rt.active,
              object: name,
            };
            if (row?.Description) cfgRt.description = row.Description;
            return cfgRt;
          });
        const config: ObjectConfig = {
          apiName: d.name,
          label: d.label,
          labelPlural: d.labelPlural,
          custom: d.custom,
          managed: isVeevaManaged(d.name),
          fields: (d.fields ?? []).map(buildFieldConfig),
          recordTypes,
          layouts: [],
          validationRules: [],
        };
        if (d.layoutable) {
          const layoutDescribe = await ctx.stage<DescribeLayouts | null>(
            `layouts:${name}`,
            null,
            () =>
              client.get<DescribeLayouts>(
                `/sobjects/${encodeURIComponent(name)}/describe/layouts`,
              ),
          );
          if (layoutDescribe) {
            const rtByLayout = new Map<string, string[]>();
            for (const m of layoutDescribe.recordTypeMappings ?? []) {
              if (m.master) continue;
              const dev =
                m.developerName ??
                recordTypeDevNameById.get(m.recordTypeId)?.developerName ??
                m.name;
              const list = rtByLayout.get(m.layoutId) ?? [];
              list.push(dev);
              rtByLayout.set(m.layoutId, list);
              const rtCfg = recordTypes.find((r) =>
                sameId(r.id, m.recordTypeId),
              );
              if (
                rtCfg &&
                m.picklistsForRecordType &&
                m.picklistsForRecordType.length > 0
              ) {
                rtCfg.picklistValues = Object.fromEntries(
                  m.picklistsForRecordType.map((p) => [
                    p.picklistName,
                    p.picklistValues.map((v) => v.value),
                  ]),
                );
              }
            }
            for (const l of layoutDescribe.layouts ?? []) {
              const decoded = decodeDescribeLayout(l);
              const layout: LayoutConfig = {
                fullName: layoutFullName(l.id, name),
                object: name,
                recordTypes: [...new Set(rtByLayout.get(l.id) ?? [])],
                sections: decoded.sections,
                relatedLists: decoded.relatedLists,
                managed: layoutIsManaged(l.id, ""),
              };
              if (decoded.actions.length > 0) layout.actions = decoded.actions;
              if (decoded.buttons.length > 0) layout.buttons = decoded.buttons;
              config.layouts.push(layout);
            }
          }
        }
        return config;
      },
    );
    if (cfg) {
      objects.push(cfg);
      objectByName.set(cfg.apiName, cfg);
    }
  }
  progress(`described ${objects.length} objects`);

  // E1 — validation rules ---------------------------------------------------
  await ctx.stage("validation_rules", undefined, async () => {
    for (const chunk of chunkIds(objects.map((o) => o.apiName))) {
      const rows = await client.toolingQuery<ValidationRuleRow>(
        validationRuleQuery(chunk),
      );
      for (const r of rows) {
        const object = r.EntityDefinition?.QualifiedApiName ?? "";
        const target = objectByName.get(object);
        if (!target) continue;
        const rule: ValidationRuleConfig = {
          object,
          name: r.ValidationName,
          active: r.Active === true,
        };
        if (r.ErrorMessage) rule.errorMessage = r.ErrorMessage;
        if (r.ErrorDisplayField) rule.errorDisplayField = r.ErrorDisplayField;
        target.validationRules.push(rule);
      }
    }
  });

  // C — profiles and permission sets -------------------------------------
  const permissionFields = await ctx.stage<string[]>(
    "profile_describe",
    [],
    async () => {
      const d = await ctx.describe("Profile");
      return d.fields
        .filter((f) => f.name.startsWith("Permissions"))
        .map((f) => f.name);
    },
  );
  const profileRows = await ctx.stage<ProfileRow[]>("profiles", [], () =>
    ctx.queryDroppingInvalid<ProfileRow>(
      "profiles",
      profileQuery(permissionFields),
    ),
  );
  const psRows = await ctx.stage<PermissionSetRow[]>(
    "permission_sets",
    [],
    () => client.query<PermissionSetRow>(PERMISSION_SET_QUERY),
  );
  const psIdByProfileId = new Map<string, string>();
  const profileIdByPsId = new Map<string, string>();
  for (const ps of psRows) {
    if (ps.IsOwnedByProfile && ps.ProfileId) {
      psIdByProfileId.set(ps.ProfileId, ps.Id);
      profileIdByPsId.set(ps.Id, ps.ProfileId);
    }
  }
  const profileById = new Map<string, ProfileRow>();
  for (const p of profileRows) {
    profileById.set(p.Id, p);
    profileById.set(p.Id.slice(0, 15), p);
  }
  const profileName = (id: string | null | undefined): string | null =>
    id
      ? (profileById.get(id)?.Name ??
        profileById.get(id.slice(0, 15))?.Name ??
        null)
      : null;

  const objectPermsByParent = new Map<string, ObjectPermission[]>();
  await ctx.stage("object_permissions", undefined, async () => {
    for (const chunk of chunkIds(objectNames)) {
      const rows = await client.query<ObjectPermissionsRow>(
        objectPermissionsQuery(chunk),
      );
      for (const r of rows) {
        const list = objectPermsByParent.get(r.ParentId) ?? [];
        list.push({
          object: r.SobjectType,
          create: r.PermissionsCreate === true,
          read: r.PermissionsRead === true,
          edit: r.PermissionsEdit === true,
          delete: r.PermissionsDelete === true,
          viewAll: r.PermissionsViewAllRecords === true,
          modifyAll: r.PermissionsModifyAllRecords === true,
        });
        objectPermsByParent.set(r.ParentId, list);
      }
    }
  });
  const fieldPermsByParent = new Map<string, FieldPermission[]>();
  await ctx.stage("field_permissions", undefined, async () => {
    for (const chunk of chunkIds(objectNames)) {
      const rows = await client.query<FieldPermissionsRow>(
        fieldPermissionsQuery(chunk),
      );
      for (const r of rows) {
        const list = fieldPermsByParent.get(r.ParentId) ?? [];
        const dot = r.Field.indexOf(".");
        list.push({
          object: r.SobjectType,
          field: dot >= 0 ? r.Field.slice(dot + 1) : r.Field,
          readable: r.PermissionsRead === true,
          editable: r.PermissionsEdit === true,
        });
        fieldPermsByParent.set(r.ParentId, list);
      }
    }
  });
  progress(
    `security matrix: ${profileRows.length} profiles, ${psRows.length} permission sets`,
  );

  // C9 — per-profile Tooling Metadata, with fallbacks ----------------------
  let profileMetadataAvailable = true;
  const metaByProfile = new Map<
    string,
    ReturnType<typeof decodeProfileMetadata>
  >();
  for (const p of profileRows) {
    if (!profileMetadataAvailable) break;
    try {
      const rows = await client.toolingQuery<{
        Id: string;
        Metadata?: ProfileMetadata | null;
      }>(profileMetadataQuery(p.Id));
      const meta = rows[0]?.Metadata;
      if (!meta || typeof meta !== "object") {
        profileMetadataAvailable = false;
        ctx.warn(
          "profile_metadata",
          `Tooling Profile.Metadata is empty for "${p.Name}"; using ProfileLayout / PermissionSetTabSetting / SetupEntityAccess fallbacks`,
        );
        break;
      }
      metaByProfile.set(p.Id, decodeProfileMetadata(meta, objectsInScope));
    } catch (err) {
      if (isBudgetError(err)) throw err;
      profileMetadataAvailable = false;
      ctx.warn(
        "profile_metadata",
        `Tooling Profile.Metadata not available (${errorMessage(err)}); using ProfileLayout / PermissionSetTabSetting / SetupEntityAccess fallbacks`,
        errorDetail(err),
      );
    }
  }

  const needLayoutFallback = profileRows.some(
    (p) => !metaByProfile.get(p.Id)?.layoutAssignments,
  );
  const needTabFallback = profileRows.some(
    (p) => !metaByProfile.get(p.Id)?.tabVisibilities,
  );
  const needAppFallback = profileRows.some(
    (p) => !metaByProfile.get(p.Id)?.applicationVisibilities,
  );
  const rtFallbackProfiles = profileRows.filter(
    (p) => !metaByProfile.get(p.Id)?.recordTypeVisibilities,
  );

  const layoutAssignmentsByProfile = new Map<string, LayoutAssignment[]>();
  const layoutRecordTypes = new Map<string, Set<string>>(); // layout full name → record types
  if (needLayoutFallback && profileRows.length > 0) {
    await ctx.stage("profile_layouts", undefined, async () => {
      const keys = objectNames.map(tableEnumOrIdOf);
      for (const chunk of chunkIds(keys)) {
        const rows = await client.toolingQuery<ProfileLayoutRow>(
          profileLayoutQuery(chunk),
        );
        for (const r of rows) {
          const object = decodeTableEnumOrId(r.TableEnumOrId);
          if (!objectsInScope.has(object)) continue;
          const layout = layoutFullName(r.LayoutId, object);
          const rt = r.RecordTypeId
            ? (recordTypeDevNameById.get(r.RecordTypeId)?.developerName ??
              recordTypeById.get(r.RecordTypeId)?.DeveloperName ??
              null)
            : null;
          const list = layoutAssignmentsByProfile.get(r.ProfileId) ?? [];
          list.push({ object, recordType: rt, layout });
          layoutAssignmentsByProfile.set(r.ProfileId, list);
        }
      }
    });
  }
  const tabsByPs = new Map<string, TabVisibility[]>();
  if (needTabFallback && profileRows.length > 0) {
    await ctx.stage("tab_settings", undefined, async () => {
      const rows = await client.query<{
        ParentId: string;
        Name: string;
        Visibility: string;
      }>(TAB_SETTINGS_QUERY);
      for (const r of rows) {
        const list = tabsByPs.get(r.ParentId) ?? [];
        list.push({
          tab: r.Name,
          visibility: normalizeTabVisibility(r.Visibility),
        });
        tabsByPs.set(r.ParentId, list);
      }
    });
  }
  const appsByPs = new Map<string, ApplicationVisibility[]>();
  if (needAppFallback && profileRows.length > 0) {
    await ctx.stage("app_access", undefined, async () => {
      const apps = await client.query<{
        ApplicationId: string;
        Name: string;
        Label?: string | null;
        NamespacePrefix?: string | null;
      }>(APP_MENU_ITEM_QUERY);
      const appName = new Map<string, string>();
      for (const a of apps) {
        const name = a.NamespacePrefix
          ? `${a.NamespacePrefix}__${a.Name}`
          : a.Name;
        appName.set(a.ApplicationId, name);
        appName.set(a.ApplicationId.slice(0, 15), name);
      }
      const rows = await client.query<{
        ParentId: string;
        SetupEntityId: string;
      }>(APP_ACCESS_QUERY);
      for (const r of rows) {
        const list = appsByPs.get(r.ParentId) ?? [];
        list.push({
          application: appName.get(r.SetupEntityId) ?? r.SetupEntityId,
          visible: true,
          default: false,
        });
        appsByPs.set(r.ParentId, list);
      }
    });
  }
  if (rtFallbackProfiles.length > 0) {
    ctx.warn(
      "record_type_visibility",
      `record-type visibility per profile could not be read from Profile.Metadata for ${rtFallbackProfiles.length} profile(s); using the running user's describe view as an approximation`,
      rtFallbackProfiles.map((p) => p.Name),
    );
  }
  const describeRecordTypeVisibilities: RecordTypeVisibility[] = [];
  if (rtFallbackProfiles.length > 0) {
    for (const name of objectNames) {
      const d = await ctx.describe(name).catch(() => null);
      for (const rt of d?.recordTypeInfos ?? []) {
        if (rt.master) continue;
        describeRecordTypeVisibilities.push({
          object: name,
          recordType: rt.developerName ?? rt.name,
          visible: rt.available,
          default: rt.defaultRecordTypeMapping,
        });
      }
    }
  }

  // C7 / C8 — assignments and users ---------------------------------------
  const psAssignedCount = new Map<string, number>();
  await ctx.stage("permission_set_assignments", undefined, async () => {
    const rows = await client.query<AggregateRow & { psId: string }>(
      PERMISSION_SET_ASSIGNMENT_COUNT_QUERY,
    );
    for (const r of rows) psAssignedCount.set(r.psId, Number(r.n) || 0);
  });
  const psNamesByProfile = new Map<string, Set<string>>();
  await ctx.stage("permission_sets_by_profile", undefined, async () => {
    const psName = new Map(psRows.map((ps) => [ps.Id, ps.Name]));
    const rows = await client.query<
      AggregateRow & { profileId: string; psId: string }
    >(PERMISSION_SET_BY_PROFILE_QUERY);
    for (const r of rows) {
      const set = psNamesByProfile.get(r.profileId) ?? new Set<string>();
      set.add(psName.get(r.psId) ?? r.psId);
      psNamesByProfile.set(r.profileId, set);
    }
  });

  const users: UserSummary[] = [];
  let countrySource: CountrySource = "user_country";
  await ctx.stage("users", undefined, async () => {
    const d = ctx.has("User") ? await ctx.describe("User") : null;
    const fieldNames = new Set((d?.fields ?? []).map((f) => f.name));
    const countryField = fieldNames.has("Country_Code_vod__c")
      ? "Country_Code_vod__c"
      : fieldNames.has("CountryCode")
        ? "CountryCode"
        : fieldNames.has("Country")
          ? "Country"
          : null;
    countrySource =
      countryField === "Country_Code_vod__c"
        ? "user_country_code_vod"
        : "user_country";
    if (!countryField)
      ctx.warn(
        "users",
        "User has no country field (Country_Code_vod__c / CountryCode / Country); every user counts as GLOBAL",
      );
    const rows = await ctx.queryDroppingInvalid<
      AggregateRow & {
        profileId: string;
        country?: unknown;
        userType?: unknown;
        language?: unknown;
      }
    >(
      "users",
      userSummaryQuery({
        countryField,
        userType: fieldNames.has("User_Type_vod__c"),
        language: fieldNames.has("LanguageLocaleKey") || !d,
      }),
    );
    const unknown = new Set<string>();
    for (const r of rows) {
      users.push({
        profileId: r.profileId,
        profileName: profileName(r.profileId) ?? r.profileId,
        country: resolveUserCountry(r.country, unknown),
        userType: r.userType == null ? null : String(r.userType),
        language: r.language == null ? null : String(r.language),
        activeUsers: Number(r.n) || 0,
      });
    }
    if (unknown.size > 0)
      ctx.warn(
        "users",
        `unrecognised country values counted as GLOBAL: ${[...unknown].join(", ")}`,
        [...unknown],
      );
  });
  progress(
    `users aggregated: ${users.length} profile × country × type × language buckets`,
  );

  // Assemble ProfileConfig / PermissionSetConfig ----------------------------
  const profiles: ProfileConfig[] = profileRows.map((p) => {
    const psId = psIdByProfileId.get(p.Id);
    const meta = metaByProfile.get(p.Id);
    const activeUsersByCountry: Record<CountryCode, number> = {};
    const repTypeCounts: Record<string, number> = {};
    for (const u of users) {
      if (!sameId(u.profileId, p.Id)) continue;
      activeUsersByCountry[u.country] =
        (activeUsersByCountry[u.country] ?? 0) + u.activeUsers;
      if (u.userType)
        repTypeCounts[u.userType] =
          (repTypeCounts[u.userType] ?? 0) + u.activeUsers;
    }
    const objectPermissions = psId ? (objectPermsByParent.get(psId) ?? []) : [];
    const fieldPermissions = psId
      ? [...(fieldPermsByParent.get(psId) ?? [])]
      : [];
    // non-permissionable fields are implicitly readable on readable objects
    const readable = new Set(
      objectPermissions.filter((o) => o.read).map((o) => o.object),
    );
    const explicit = new Set(
      fieldPermissions.map((f) => `${f.object}.${f.field}`),
    );
    for (const object of readable) {
      const cfg = objectByName.get(object);
      if (!cfg) continue;
      const d = describedFields.get(object);
      for (const f of d ?? []) {
        if (f.permissionable !== false || explicit.has(`${object}.${f.name}`))
          continue;
        fieldPermissions.push({
          object,
          field: f.name,
          readable: true,
          editable: f.updateable === true,
        });
      }
    }
    const userPermissions =
      meta?.userPermissions ??
      permissionFields.filter(
        (f) => (p as Record<string, unknown>)[f] === true,
      );
    const cfg: ProfileConfig = {
      id: p.Id,
      name: p.Name,
      userLicense: p.UserLicense?.Name ?? p.UserLicenseId ?? "",
      custom: !isStandardProfileName(p.Name),
      objectPermissions,
      fieldPermissions,
      recordTypeVisibilities:
        meta?.recordTypeVisibilities ??
        describeRecordTypeVisibilities.map((r) => ({ ...r })),
      tabVisibilities:
        meta?.tabVisibilities ?? (psId ? (tabsByPs.get(psId) ?? []) : []),
      applicationVisibilities:
        meta?.applicationVisibilities ??
        (psId ? (appsByPs.get(psId) ?? []) : []),
      layoutAssignments:
        meta?.layoutAssignments ?? layoutAssignmentsByProfile.get(p.Id) ?? [],
      activeUsersByCountry,
      permissionSetNames: [...(psNamesByProfile.get(p.Id) ?? [])].sort(),
      userPermissions,
    };
    if (p.Description) cfg.description = p.Description;
    if (psId) cfg.permissionSetId = psId;
    if (Object.keys(repTypeCounts).length > 0)
      cfg.repTypeCounts = repTypeCounts;
    return cfg;
  });
  for (const p of profiles) {
    for (const la of p.layoutAssignments) {
      if (!la.recordType) continue;
      const set = layoutRecordTypes.get(la.layout) ?? new Set<string>();
      set.add(la.recordType);
      layoutRecordTypes.set(la.layout, set);
    }
  }

  const permissionSets: PermissionSetConfig[] = psRows
    .filter((ps) => !ps.IsOwnedByProfile)
    .map((ps) => {
      const cfg: PermissionSetConfig = {
        id: ps.Id,
        name: ps.NamespacePrefix
          ? `${ps.NamespacePrefix}__${ps.Name}`
          : ps.Name,
        label: ps.Label ?? ps.Name,
        objectPermissions: objectPermsByParent.get(ps.Id) ?? [],
        fieldPermissions: fieldPermsByParent.get(ps.Id) ?? [],
        assignedUserCount: psAssignedCount.get(ps.Id) ?? 0,
      };
      if (ps.Description) cfg.description = ps.Description;
      return cfg;
    });

  // D3 — layouts assigned to profiles but not visible to the running user --
  await ctx.stage("layout_metadata", undefined, async () => {
    const known = new Set(
      objects.flatMap((o) => o.layouts.map((l) => l.fullName)),
    );
    const wanted = new Map<string, { object: string; fullName: string }>();
    for (const p of profiles) {
      for (const la of p.layoutAssignments) {
        if (known.has(la.layout) || wanted.has(la.layout)) continue;
        if (!objectByName.has(la.object)) continue;
        wanted.set(la.layout, { object: la.object, fullName: la.layout });
      }
    }
    if (wanted.size === 0) return;
    const limit = options.maxLayoutMetadataFetches ?? 300;
    let fetched = 0;
    for (const [fullName, { object }] of wanted) {
      const target = objectByName.get(object);
      if (!target) continue;
      const id = layoutIdByFullName.get(fullName);
      const layout: LayoutConfig = {
        fullName,
        object,
        recordTypes: [...(layoutRecordTypes.get(fullName) ?? [])],
        sections: [],
        relatedLists: [],
        managed: id ? layoutIsManaged(id, "") : /_vod$/i.test(fullName),
      };
      target.layouts.push(layout);
      if (!id || fetched >= limit) continue;
      fetched++;
      try {
        const rows = await client.toolingQuery<{
          Id: string;
          Metadata?: LayoutMetadata | null;
        }>(layoutMetadataQuery(id));
        const meta = rows[0]?.Metadata;
        if (!meta) continue;
        const decoded = decodeLayoutMetadata(meta);
        layout.sections = decoded.sections;
        layout.relatedLists = decoded.relatedLists;
        if (decoded.buttons.length > 0) layout.buttons = decoded.buttons;
        if (decoded.actions.length > 0) layout.actions = decoded.actions;
      } catch (err) {
        if (isBudgetError(err)) throw err;
        ctx.warn(
          "layout_metadata",
          `could not read layout "${fullName}": ${errorMessage(err)}`,
          errorDetail(err),
        );
      }
    }
    if (wanted.size > limit)
      ctx.warn(
        "layout_metadata",
        `${wanted.size - limit} profile-assigned layouts were not fetched (maxLayoutMetadataFetches = ${limit}); their sections are empty`,
      );
  });
  for (const o of objects) {
    for (const l of o.layouts) {
      const extra = layoutRecordTypes.get(l.fullName);
      if (extra) l.recordTypes = [...new Set([...l.recordTypes, ...extra])];
    }
  }

  // G1 — VMOCs -------------------------------------------------------------
  const vmocs: VmocConfig[] = [];
  await ctx.stage("vmocs", undefined, async () => {
    if (!ctx.has(VMOC_OBJECT)) {
      ctx.warn("vmocs", `${VMOC_OBJECT} does not exist in this org`);
      return;
    }
    const d = await ctx.describe(VMOC_OBJECT);
    const fields = d.fields.filter((f) => f.custom).map((f) => f.name);
    const rows = await client.query<SoqlRow>(vmocQuery(fields));
    const shortIds: string[] = [];
    for (const r of rows) {
      const profileId =
        (r.Profile_ID_vod__c as string | null | undefined) ?? null;
      const profileNameRaw =
        (r.Profile_Name_vod__c as string | null | undefined) ?? null;
      const resolvedName = profileName(profileId);
      if (profileId && profileId.length === 15)
        shortIds.push(String(r.Name ?? r.Id));
      const extra: Record<string, unknown> = {};
      for (const f of fields) {
        if (VMOC_KNOWN_FIELDS.includes(f)) continue;
        const v = r[f];
        if (v !== null && v !== undefined) extra[f] = v;
      }
      const vmoc: VmocConfig = {
        id: String(r.Id),
        name: String(r.Name ?? r.Id),
        objectApiName: String(r.Object_Name_vod__c ?? ""),
        profile: resolvedName ?? profileNameRaw ?? null,
        device: String(r.Device_vod__c ?? ""),
        active: r.Active_vod__c === true,
        whereClause:
          (r.Where_Clause_vod__c as string | null | undefined) ?? null,
        extra,
        profileId,
      };
      if ("Type_vod__c" in r && r.Type_vod__c != null)
        extra.Type_vod__c = r.Type_vod__c;
      if ("Enable_Enhanced_Sync_vod__c" in r)
        vmoc.enhancedSync = r.Enable_Enhanced_Sync_vod__c === true;
      if ("Meta_Data_Only_vod__c" in r)
        vmoc.metaDataOnly = r.Meta_Data_Only_vod__c === true;
      if (profileId && !resolvedName)
        ctx.warn(
          "vmocs",
          `VMOC "${vmoc.name}" references unknown profile id ${profileId}`,
        );
      vmocs.push(vmoc);
    }
    if (shortIds.length > 0)
      ctx.warn(
        "vmocs",
        `${shortIds.length} VMOC(s) carry a 15-character Profile_ID_vod__c (Veeva requires 18): ${shortIds.slice(0, 20).join(", ")}`,
        shortIds,
      );
  });
  progress(`vmocs: ${vmocs.length}`);

  // F — Veeva Settings -----------------------------------------------------
  const veevaSettings: VeevaSettingRecord[] = [];
  const settingObjects: SettingObjectMeta[] = [];
  const settingNames = [...ctx.sobjects.values()]
    .filter((s) => s.customSetting && isVeevaSettingObject(s.name))
    .map((s) => s.name)
    .sort();
  if (settingNames.length === 0)
    ctx.warn(
      "settings",
      "no *_Settings_vod__c custom settings found in the global describe",
    );
  for (const setting of settingNames) {
    await ctx.stage(`settings:${setting}`, undefined, async () => {
      const d = await ctx.describe(setting);
      const fields = d.fields.filter((f) => f.custom).map((f) => f.name);
      const hierarchy = d.fields.some((f) => f.name === "SetupOwnerId");
      settingObjects.push({
        apiName: setting,
        label: d.label,
        type: hierarchy ? "Hierarchy" : "List",
        fields,
      });
      const rows = await ctx.queryDroppingInvalid<SoqlRow>(
        `settings:${setting}`,
        settingRecordsQuery(setting, fields, hierarchy),
      );
      for (const r of rows) {
        const values: Record<string, unknown> = {};
        for (const f of fields) {
          const v = r[f];
          if (v !== null && v !== undefined) values[f] = v;
        }
        if (!hierarchy) {
          veevaSettings.push({
            settingObject: setting,
            level: "org",
            ownerName: (r.Name as string | undefined) ?? null,
            values,
          });
          continue;
        }
        const ownerId = (r.SetupOwnerId as string | null | undefined) ?? null;
        const level = settingLevel(ownerId);
        const owner = r.SetupOwner as
          | { Name?: string | null }
          | null
          | undefined;
        const ownerName =
          level === "org"
            ? null
            : level === "profile"
              ? (profileName(ownerId) ?? owner?.Name ?? ownerId)
              : (owner?.Name ?? ownerId);
        veevaSettings.push({
          settingObject: setting,
          level,
          ownerName,
          values,
        });
      }
    });
  }
  progress(
    `settings: ${veevaSettings.length} rows across ${settingObjects.length} objects`,
  );

  // G2 — Veeva Messages ----------------------------------------------------
  const messages: VeevaMessage[] = [];
  await ctx.stage("messages", undefined, async () => {
    if (!ctx.has(MESSAGE_OBJECT)) {
      ctx.warn("messages", `${MESSAGE_OBJECT} does not exist in this org`);
      return;
    }
    const d = await ctx.describe(MESSAGE_OBJECT);
    const present = new Set(d.fields.map((f) => f.name));
    const fields = MESSAGE_FIELDS.filter((f) => present.has(f));
    let languages: string[] | undefined;
    if ((options.messageFilter ?? "referenced") === "referenced") {
      const used = new Set<string>(["en_US"]);
      for (const u of users) if (u.language) used.add(u.language);
      languages = [...used].sort();
      if (users.length === 0)
        log("messages: no user aggregate available; restricting to en_US only");
    }
    const rows = await client.query<SoqlRow>(messageQuery(fields, languages));
    for (const r of rows) {
      const country =
        r.Country_vod__c == null
          ? null
          : normalizeCountry(String(r.Country_vod__c));
      messages.push({
        name: String(r.Name ?? ""),
        category: String(r.Category_vod__c ?? ""),
        language: String(r.Language_vod__c ?? ""),
        text: String(r.Text_vod__c ?? ""),
        country,
        active: present.has("Active_vod__c") ? r.Active_vod__c === true : true,
      });
    }
  });
  progress(`messages: ${messages.length}`);

  // E2 — automation inventory (names only) ---------------------------------
  const automation: AutomationItem[] = [];
  const countryLogic = /country|Country_Code_vod|'[A-Z]{2}'/;
  await ctx.stage("automation:apex_triggers", undefined, async () => {
    const rows = await ctx.queryDroppingInvalid<SoqlRow>(
      "automation:apex_triggers",
      APEX_TRIGGER_QUERY,
      true,
    );
    for (const r of rows) {
      const body = typeof r.Body === "string" ? r.Body : "";
      automation.push({
        kind: "apex_trigger",
        name: String(r.Name ?? ""),
        object: r.TableEnumOrId
          ? decodeTableEnumOrId(String(r.TableEnumOrId))
          : null,
        active: r.Status === "Active",
        managed: r.NamespacePrefix != null && r.NamespacePrefix !== "",
        countryLogic: body !== "(hidden)" && countryLogic.test(body),
      });
    }
  });
  await ctx.stage("automation:flows", undefined, async () => {
    const rows = await client.toolingQuery<SoqlRow>(FLOW_DEFINITION_QUERY);
    for (const r of rows) {
      automation.push({
        kind: "flow",
        name: String(r.DeveloperName ?? r.MasterLabel ?? ""),
        object: null,
        active: r.ActiveVersionId != null,
        managed: r.NamespacePrefix != null && r.NamespacePrefix !== "",
        countryLogic: false,
      });
    }
  });
  await ctx.stage("automation:workflow_rules", undefined, async () => {
    const rows = await client.toolingQuery<SoqlRow>(WORKFLOW_RULE_QUERY);
    for (const r of rows) {
      automation.push({
        kind: "workflow_rule",
        name: String(r.Name ?? ""),
        object: r.TableEnumOrId
          ? decodeTableEnumOrId(String(r.TableEnumOrId))
          : null,
        active: true,
        managed: r.NamespacePrefix != null && r.NamespacePrefix !== "",
        countryLogic: false,
      });
    }
  });

  // Countries ----------------------------------------------------------------
  const countries = new Map<CountryCode, CountryRef>();
  const addCountry = (
    code: CountryCode,
    source: CountrySource,
    extra?: Partial<CountryRef>,
  ) => {
    if (code === GLOBAL_COUNTRY || !isCountryCode(code)) return;
    const ref = countries.get(code) ?? {
      code,
      name: countryName(code),
      activeUsers: 0,
      sources: [],
    };
    if (extra?.id) ref.id = extra.id;
    if (extra?.name) ref.name = extra.name;
    if (!ref.sources!.includes(source)) ref.sources!.push(source);
    countries.set(code, ref);
  };
  for (const u of users) {
    addCountry(u.country, countrySource);
    const ref = countries.get(u.country);
    if (ref) ref.activeUsers += u.activeUsers;
  }
  if (ctx.has(COUNTRY_OBJECT)) {
    await ctx.stage("countries:object", undefined, async () => {
      const d = await ctx.describe(COUNTRY_OBJECT);
      const present = new Set(d.fields.map((f) => f.name));
      const codeField = [
        "Country_Code_vod__c",
        "Alpha_2_Code_vod__c",
        "Code_vod__c",
      ].find((f) => present.has(f));
      const rows = await client.query<SoqlRow>(
        countryObjectQuery(codeField ? [codeField] : []),
      );
      for (const r of rows) {
        const raw = codeField ? r[codeField] : r.Name;
        const code =
          normalizeCountry(raw == null ? null : String(raw)) ??
          normalizeCountry(String(r.Name ?? ""));
        if (code)
          addCountry(code, "country_object", {
            id: String(r.Id),
            name: String(r.Name ?? ""),
          });
      }
    });
  }
  for (const [object, field] of [
    ["Account", "Country_vod__c"],
    ["Address_vod__c", "Country_vod__c"],
  ] as const) {
    const f = objectByName.get(object)?.fields.find((x) => x.apiName === field);
    for (const v of f?.picklistValues ?? []) {
      const code = normalizeCountry(v.value) ?? normalizeCountry(v.label);
      if (code) addCountry(code, "picklist");
    }
  }
  for (const v of vmocs) {
    for (const code of countriesFromWhereClause(v.whereClause))
      addCountry(code, "vmoc");
  }
  const known = [...countries.keys()];
  for (const p of profiles) {
    for (const code of countriesFromProfileName(p.name, known))
      addCountry(code, "profile_name");
  }

  const dailyMax = limits?.DailyApiRequests?.Max;
  const dailyRemaining = limits?.DailyApiRequests?.Remaining;
  const snapshot: OrgSnapshot = {
    schemaVersion: 1,
    extractedAt: now().toISOString(),
    instanceUrl: client.instanceUrl,
    apiVersion: client.apiVersion,
    countries: [...countries.values()].sort((a, b) =>
      a.code.localeCompare(b.code),
    ),
    profiles,
    permissionSets,
    objects,
    vmocs,
    veevaSettings,
    messages,
    warnings: ctx.warnings,
    users,
    settingObjects,
    automation,
    extract: {
      objectsRequested: objectNames,
      profileMetadataAvailable,
      compositeAvailable: false,
    },
  };
  const orgId = (orgRow?.Id as string | undefined) ?? client.orgId;
  if (orgId) snapshot.orgId = orgId;
  if (typeof orgRow?.Name === "string") snapshot.orgName = orgRow.Name;
  if (typeof dailyMax === "number" && typeof dailyRemaining === "number") {
    snapshot.limits = {
      dailyApiRequestsMax: dailyMax,
      dailyApiRequestsRemaining: dailyRemaining,
      requestsUsed: client.requestCount,
    };
  }
  progress(`extraction finished with ${ctx.warnings.length} warnings`);
  return snapshot;
}

/** Salesforce standard profile names (not customer clones). */
export function isStandardProfileName(name: string): boolean {
  return [
    "System Administrator",
    "Standard User",
    "Read Only",
    "Solution Manager",
    "Marketing User",
    "Contract Manager",
    "Minimum Access - Salesforce",
    "Minimum Access - API Only Integrations",
    "Salesforce API Only System Integrations",
    "Chatter Free User",
    "Chatter External User",
    "Chatter Moderator User",
    "Analytics Cloud Integration User",
    "Analytics Cloud Security User",
    "Identity User",
    "External Identity User",
    "Customer Community User",
    "Customer Community Login User",
    "Customer Community Plus User",
    "Customer Community Plus Login User",
    "Partner Community User",
    "Partner Community Login User",
    "Force.com - App Subscription User",
    "Force.com - Free User",
    "Standard Platform User",
    "Cross Org Data Proxy User",
    "Guest License User",
    "Work.com Only User",
    "High Volume Customer Portal User",
    "Authenticated Website",
  ].includes(name);
}
