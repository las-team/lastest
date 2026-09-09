/**
 * §7.1 layering and §2.3 materialisation.
 *
 *   defaults ← config (top level) ← config.regions[<R>] ← config.countries[<ISO>]
 *
 * `resolveCountry` produces one fully merged country-level config;
 * `materialise` applies it to an ObjectModule and yields the
 * `MaterialisedMapping` for the (object, country) unit, including
 * `mappingHash` and any findings raised while merging.
 */
import {
  formatCountryOf,
  isTerritoryCountryRule,
  parseCountryOf,
} from "../country-of";
import { hashObject } from "../hash";
import type { ObjectModule } from "../objects/types";
import { parseTransform, TransformSpecError } from "../transform/spec";
import {
  GLOBAL_COUNTRY,
  type CountryCode,
  type FieldMapping,
  type Finding,
  type LoadOptions,
  type MaterialisedMapping,
  type ObjectOptions,
  type Requirement,
  type ResolvedScope,
} from "../types";
import {
  COUNTRY_DEFAULTS,
  DEFAULT_LOCALES,
  type CountryLayer,
  type FieldOverride,
  type FieldsOverride,
  type MigrationConfig,
  type ObjectOverride,
} from "./schema";

// ---------------------------------------------------------------------------
// Deep merge
// ---------------------------------------------------------------------------

type Dict = Record<string, unknown>;

function isDict(v: unknown): v is Dict {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Keys whose object value replaces the lower layer wholesale (discriminated unions such as `target.auth`). */
const ATOMIC_KEYS = new Set(["auth"]);

function mergeInto(
  base: Dict,
  overlay: Dict | undefined,
  path: string[] = [],
): Dict {
  if (!overlay) return base;
  for (const [k, v] of Object.entries(overlay)) {
    if (v === undefined) continue;
    const cur = base[k];
    if (isDict(v) && isDict(cur) && !ATOMIC_KEYS.has(k)) {
      base[k] = mergeInto({ ...cur }, v, [...path, k]);
    } else if (isDict(v)) {
      base[k] = mergeInto({}, v, [...path, k]);
    } else {
      base[k] = Array.isArray(v) ? [...v] : v;
    }
  }
  return base;
}

// ---------------------------------------------------------------------------
// resolveCountry
// ---------------------------------------------------------------------------

export interface ResolvedCountryConfig {
  iso2: CountryCode;
  region?: string;
  target: MigrationConfig["target"];
  staging: { databaseUrl?: string; runDir?: string };
  dataResidency?: "eu" | "us" | "cn" | "jp";
  scope: {
    historyMonths: number;
    cutoffDate?: string;
    sampleRetentionMonths?: number;
    tovRetentionMonths?: number;
    samplesIncludeCalls: boolean;
    objects: Record<string, { historyMonths?: number | null }>;
  };
  reconcile: { sampleSize: number; tolerance: number };
  postLoad: {
    recalculateRollups: "auto" | "required" | "off";
    updateCorporateCurrency: boolean;
  };
  picklists: {
    derive: "strip_vod_lowercase_v" | "none";
    onUnmapped: "error" | "skip" | "createValue";
    leaveReactivated: boolean;
    /** mapKey (`account.specialty`) → source value → target | null. */
    maps: Record<string, Record<string, string | null>>;
  };
  objects: Record<string, ObjectOverride>;
  /**
   * `objects.<key>.fields` blocks in layer order (global, region, country).
   * Applied sequentially by `materialise` so a region `remove` beats a global
   * `add` and a country `add` beats both (§7.1).
   */
  fieldLayers: Record<string, FieldsOverride[]>;
  nameTemplates: {
    person: string;
    speaker: string;
    userTerritory: string;
    separator: string;
    [k: string]: string;
  };
  formats: {
    date?: string;
    datetime?: string;
    decimalSeparator?: string;
    thousandsSeparator?: string;
  };
  phone: { normalise: boolean; defaultRegion?: string };
  postalCode: { pattern?: string; onMismatch: "warn" | "fail" };
  defaultTimezone: string;
  privacy: {
    erasureListPath?: string;
    consentFullHistory: boolean;
    crossBorderTransfer: "allowed" | "forbidden";
  };
  locales: { language: Record<string, string>; locale: Record<string, string> };
}

function countryLayerOf(cfg: MigrationConfig): CountryLayer {
  const {
    target,
    staging,
    dataResidency,
    scope,
    reconcile,
    postLoad,
    picklists,
    objects,
    nameTemplates,
    formats,
    phone,
    postalCode,
    defaultTimezone,
    privacy,
  } = cfg;
  return {
    target,
    staging,
    dataResidency,
    scope,
    reconcile,
    postLoad,
    picklists,
    objects,
    nameTemplates,
    formats,
    phone,
    postalCode,
    defaultTimezone,
    privacy,
  };
}

function splitPicklists(p: Dict | undefined): {
  policy: Dict;
  maps: Record<string, Record<string, string | null>>;
} {
  const policy: Dict = {};
  const maps: Record<string, Record<string, string | null>> = {};
  for (const [k, v] of Object.entries(p ?? {})) {
    if (k === "derive" || k === "onUnmapped" || k === "leaveReactivated")
      policy[k] = v;
    else if (isDict(v)) maps[k] = v as Record<string, string | null>;
  }
  return { policy, maps };
}

/**
 * Merge defaults ← global ← region ← country for `iso2`. `GLOBAL` (or an
 * unknown country) resolves to defaults ← global only.
 */
export function resolveCountry(
  config: MigrationConfig,
  iso2: CountryCode,
): ResolvedCountryConfig {
  const country = iso2 === GLOBAL_COUNTRY ? undefined : config.countries[iso2];
  const regionName = country?.region;
  const region = regionName ? config.regions[regionName] : undefined;

  const layers: Array<CountryLayer | undefined> = [
    countryLayerOf(config),
    region,
    country,
  ];

  const merged: Dict = mergeInto(
    {
      scope: { ...COUNTRY_DEFAULTS.scope, objects: {} },
      reconcile: { ...COUNTRY_DEFAULTS.reconcile },
      postLoad: { ...COUNTRY_DEFAULTS.postLoad },
      nameTemplates: { ...COUNTRY_DEFAULTS.nameTemplates },
      formats: {},
      phone: { ...COUNTRY_DEFAULTS.phone },
      postalCode: { ...COUNTRY_DEFAULTS.postalCode },
      defaultTimezone: COUNTRY_DEFAULTS.defaultTimezone,
      privacy: { ...COUNTRY_DEFAULTS.privacy },
      objects: {},
      staging: {},
      target: {},
    },
    undefined,
  );
  const picklistPolicy: Dict = { ...COUNTRY_DEFAULTS.picklists };
  const picklistMaps: Record<string, Record<string, string | null>> = {};
  const fieldLayers: Record<string, FieldsOverride[]> = {};
  for (const layer of layers) {
    if (!layer) continue;
    const { picklists, ...rest } = layer;
    // `region` is not a layer key
    delete (rest as Dict).region;
    // `fields` blocks are kept per layer (ordered), not merged
    const objects: Dict = {};
    for (const [key, ov] of Object.entries(
      (rest.objects ?? {}) as Record<string, Dict>,
    )) {
      const { fields, ...other } = ov;
      objects[key] = other;
      if (fields) (fieldLayers[key] ??= []).push(fields as FieldsOverride);
    }
    mergeInto(merged, { ...(rest as Dict), objects });
    const { policy, maps } = splitPicklists(picklists as Dict | undefined);
    Object.assign(picklistPolicy, policy);
    for (const [mapKey, values] of Object.entries(maps))
      picklistMaps[mapKey] = { ...(picklistMaps[mapKey] ?? {}), ...values };
  }

  return {
    iso2,
    region: regionName,
    target: merged.target as MigrationConfig["target"],
    staging: merged.staging as ResolvedCountryConfig["staging"],
    dataResidency:
      merged.dataResidency as ResolvedCountryConfig["dataResidency"],
    scope: merged.scope as ResolvedCountryConfig["scope"],
    reconcile: merged.reconcile as ResolvedCountryConfig["reconcile"],
    postLoad: merged.postLoad as ResolvedCountryConfig["postLoad"],
    picklists: {
      ...(picklistPolicy as {
        derive: "strip_vod_lowercase_v" | "none";
        onUnmapped: "error" | "skip" | "createValue";
        leaveReactivated: boolean;
      }),
      maps: picklistMaps,
    },
    objects: merged.objects as Record<string, ObjectOverride>,
    fieldLayers,
    nameTemplates:
      merged.nameTemplates as ResolvedCountryConfig["nameTemplates"],
    formats: merged.formats as ResolvedCountryConfig["formats"],
    phone: merged.phone as ResolvedCountryConfig["phone"],
    postalCode: merged.postalCode as ResolvedCountryConfig["postalCode"],
    defaultTimezone: merged.defaultTimezone as string,
    privacy: merged.privacy as ResolvedCountryConfig["privacy"],
    locales: {
      language: { ...DEFAULT_LOCALES.language, ...config.locales.language },
      locale: { ...DEFAULT_LOCALES.locale, ...config.locales.locale },
    },
  };
}

// ---------------------------------------------------------------------------
// materialise
// ---------------------------------------------------------------------------

export interface MaterialiseOptions {
  /** Clock for `cutoffDate` (§1.1 #2). Default `new Date()`. */
  now?: Date;
}

export const OBJECT_OPTION_DEFAULTS: ObjectOptions = {
  enabled: true,
  optional: false,
  deletePolicy: "ignore",
  createPolicy: "create",
  inactivateBy: [],
  statusFromFlag: true,
  inactiveStatuses: [],
  preserveName: true,
  preserveAutoNumberName: false,
  loadUnlockFlag: false,
  allowTypeChange: true,
  dateRange: "omit",
  unmappedUserPolicy: "omit",
  externalIdOwnedBy: "migration",
  rewriteCompositeExternalId: true,
  customFields: { mode: "none", include: [], exclude: [] },
  blobs: {},
};

/** Objects whose lifecycle makes a type change unsafe by default (§2.5.6). */
const LIFECYCLED_NO_TYPE_CHANGE = new Set([
  "em_event",
  "call2",
  "sample_transaction",
  "order",
  "medical_inquiry",
]);
/** Objects where integrations own `external_id__v` by default (§3.2 step 4). */
const INTEGRATION_OWNED_EXTERNAL_ID = new Set([
  "account",
  "address",
  "product",
  "key_message",
  "clm_presentation",
  "clm_presentation_slide",
  "approved_document",
  "territory",
]);

/**
 * `cutoffDate = today − historyMonths` in UTC as `YYYY-MM-DD` (§1.1 #2). The
 * day is clamped to the target month's length (2026-03-31 − 1 month is
 * 2026-02-28, not a roll-forward to 03-03 that would drop rows).
 */
export function computeCutoffDate(now: Date, historyMonths: number): string {
  const total = now.getUTCFullYear() * 12 + now.getUTCMonth() - historyMonths;
  const year = Math.floor(total / 12);
  const month = total - year * 12;
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(now.getUTCDate(), daysInMonth);
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

function normaliseRequirement(
  r: FieldOverride["required"],
): Requirement | undefined {
  if (r === undefined) return undefined;
  if (r === true) return "Y";
  if (r === false) return "n";
  return r;
}

function overlayRow(o: FieldOverride, existing?: FieldMapping): FieldMapping {
  return {
    ...(existing ?? {}),
    source: o.source,
    target: o.target,
    transform: parseTransform(o.transform),
    required: normaliseRequirement(o.required) ?? existing?.required ?? "n",
    clearOnNull: o.clearOnNull ?? existing?.clearOnNull,
    truncation: o.truncation ?? existing?.truncation,
    evidence: (o.evidence as FieldMapping["evidence"]) ?? existing?.evidence,
    blobName: o.blobName ?? existing?.blobName,
    notes: o.notes ?? existing?.notes,
    countryConfigurable: true,
  };
}

/** Resolve the effective scope window for one object under a country config (§7.2). */
export function resolveScope(
  module: ObjectModule,
  cc: ResolvedCountryConfig,
  findings: Finding[],
  now: Date,
): ResolvedScope {
  const spec = module.scope;
  const key = module.key;
  if (spec.kind === "full") return { spec };
  const base = cc.scope.historyMonths;
  // `null` (= unscoped) must survive: `??` would swallow the documented
  // `scope.objects.<key>.historyMonths: null` form (§7.2.1).
  const fromScope = cc.scope.objects[key]?.historyMonths;
  const fromObject = cc.objects[key]?.scope?.historyMonths;
  const override = fromScope !== undefined ? fromScope : fromObject;
  if (override === null) return { spec, retentionFamily: spec.retentionFamily };

  let family = spec.retentionFamily;
  if (key === "call2" && cc.scope.samplesIncludeCalls) family = "samples";
  const familyRetention =
    family === "samples"
      ? cc.scope.sampleRetentionMonths
      : family === "tov"
        ? cc.scope.tovRetentionMonths
        : undefined;

  let effective = override ?? base;
  if (family === undefined) {
    if (override !== undefined && override < base)
      findings.push({
        severity: "warning",
        code: "SCOPE_NARROWED",
        objectKey: key,
        country: cc.iso2,
        detail: `historyMonths ${override} is narrower than the global ${base}`,
      });
  } else {
    // §7.2: a regulated family is `max(historyMonths, familyRetention)` per
    // object — never below the global window, even without a family knob.
    const floor = Math.max(base, familyRetention ?? 0);
    if (effective < floor) {
      if (override !== undefined) {
        if (familyRetention !== undefined && familyRetention > base)
          findings.push({
            severity: "info",
            code: "SCOPE_WIDENED",
            objectKey: key,
            country: cc.iso2,
            detail: `historyMonths ${override} widened to family retention ${familyRetention} (${family})`,
          });
        else
          findings.push({
            severity: "warning",
            code: "SCOPE_CLAMPED",
            objectKey: key,
            country: cc.iso2,
            detail: `historyMonths ${override} is narrower than the global ${base}; regulated family ${family} may only widen — clamped to ${base}`,
          });
      }
      effective = floor;
    }
  }
  let cutoffDate = cc.scope.cutoffDate;
  if (cutoffDate === undefined) cutoffDate = computeCutoffDate(now, effective);
  else if (familyRetention !== undefined) {
    // An explicit global cutoff is still only a floor for a regulated family.
    const familyCutoff = computeCutoffDate(now, familyRetention);
    if (familyCutoff < cutoffDate) {
      findings.push({
        severity: "info",
        code: "SCOPE_WIDENED",
        objectKey: key,
        country: cc.iso2,
        detail: `explicit cutoffDate ${cutoffDate} moved to ${familyCutoff} by family retention ${familyRetention} months (${family})`,
      });
      cutoffDate = familyCutoff;
    }
  }
  return {
    spec,
    historyMonths: effective,
    cutoffDate,
    retentionFamily: family,
  };
}

/**
 * Produce the per-(object, country) mapping (§7.1 merge rules):
 *  - rows merged by target: `override` replaces, `remove` deletes, `add` appends (replacing a same-target row);
 *  - `required: {field: bool}` overrides;
 *  - `enabledBy`/`disabledBy` rows resolved against the object options;
 *  - scope widening rule (`SCOPE_NARROWED` finding when narrowed);
 *  - picklist maps for this object's map keys, layered country ← region ← global ← module defaults;
 *  - `mappingHash` = sha256 of the canonical result (findings excluded).
 */
export function materialise(
  module: ObjectModule,
  cc: ResolvedCountryConfig,
  config: MigrationConfig,
  opts: MaterialiseOptions = {},
): MaterialisedMapping {
  const now = opts.now ?? new Date();
  const findings: Finding[] = [];
  const ov: ObjectOverride = cc.objects[module.key] ?? {};

  // --- options
  const options: ObjectOptions = {
    ...OBJECT_OPTION_DEFAULTS,
    enabled: module.enabledByDefault,
    deletePolicy: module.deletePolicy,
    createPolicy: module.createPolicy,
    inactivateBy: module.inactivate,
    allowTypeChange: !LIFECYCLED_NO_TYPE_CHANGE.has(module.key),
    externalIdOwnedBy: INTEGRATION_OWNED_EXTERNAL_ID.has(module.key)
      ? "integration"
      : "migration",
    blobs: { ...(module.blobs ?? {}) },
    ...(module.optionDefaults ?? {}),
  };
  const {
    fields: _fieldsOv,
    required: requiredOv,
    objectType: objectTypeOv,
    state: stateOv,
    scope: _scopeOv,
    load: loadOv,
    countryOf: countryOfOv,
    blobs: blobsOv,
    inactivateBy,
    ...flatOv
  } = ov;
  const fieldLayers: FieldsOverride[] =
    cc.fieldLayers[module.key] ?? (ov.fields ? [ov.fields] : []);
  for (const [k, v] of Object.entries(flatOv))
    if (v !== undefined) (options as Record<string, unknown>)[k] = v;
  // `objects.territory.countryOf` is the territory country *rule* (how
  // `country__v` is derived per row), not a §6.0.5 unit rule: keep it in the
  // options for the module, leave the unit global and say so.
  const territoryRule =
    module.key === "territory" && isTerritoryCountryRule(countryOfOv)
      ? countryOfOv
      : undefined;
  if (territoryRule !== undefined) {
    (options as Record<string, unknown>).countryOf = territoryRule;
    findings.push({
      severity: "info",
      code: "CONFIG_TERRITORY_COUNTRY_RULE",
      objectKey: module.key,
      country: cc.iso2,
      detail: `objects.territory.countryOf "${territoryRule}" is the territory country rule (field | prefixMap | fromUsers | const); the unit stays global`,
    });
  }
  if (inactivateBy)
    options.inactivateBy = inactivateBy as ObjectOptions["inactivateBy"];
  if (blobsOv) options.blobs = { ...options.blobs, ...blobsOv };
  if (ov.customFields)
    options.customFields = {
      mode: "none",
      include: [],
      exclude: [],
      ...ov.customFields,
    } as ObjectOptions["customFields"];
  // §6.0.4 describe-driven `__c` discovery is not expanded into mapping rows
  // yet; never let the flag pass silently. An explicit config request is
  // blocking (the operator expects those fields loaded), a module default
  // (`product_metrics`) is a warning.
  if (options.customFields.mode !== "none")
    findings.push({
      severity: ov.customFields ? "blocking" : "warning",
      code: "MAP_CUSTOM_FIELDS_UNSUPPORTED",
      objectKey: module.key,
      country: cc.iso2,
      detail: {
        mode: options.customFields.mode,
        include: options.customFields.include,
        exclude: options.customFields.exclude,
        note: ov.customFields
          ? "customFields is not expanded into mapping rows yet: map the fields with objects.<key>.fields.add or set customFields.mode: none"
          : "module default; set objects.<key>.customFields.mode: none to silence",
      },
    });

  // --- fields
  let fields: FieldMapping[] = module.fields.map((f) => ({ ...f }));
  const byTarget = () => new Map(fields.map((f, i) => [f.target, i] as const));
  const requiredFromFields: Record<string, boolean> = {};
  // A transform string the schema did not see (programmatic config) must
  // surface as a blocking finding, not an exception out of `plan`.
  const tryOverlayRow = (
    o: FieldOverride,
    existing?: FieldMapping,
  ): FieldMapping | undefined => {
    try {
      return overlayRow(o, existing);
    } catch (e) {
      if (!(e instanceof TransformSpecError)) throw e;
      findings.push({
        severity: "blocking",
        code: "MAP_TRANSFORM_INVALID",
        objectKey: module.key,
        country: cc.iso2,
        field: o.target,
        detail: e.message,
      });
      return undefined;
    }
  };
  for (const layer of fieldLayers) {
    for (const o of layer.override ?? []) {
      const idx = byTarget().get(o.target);
      if (idx === undefined) {
        findings.push({
          severity: "info",
          code: "MAP_OVERRIDE_TARGET_UNKNOWN",
          objectKey: module.key,
          country: cc.iso2,
          field: o.target,
          detail: "override target not in the base mapping; row added",
        });
        const row = tryOverlayRow(o);
        if (row) fields.push(row);
      } else {
        const row = tryOverlayRow(o, fields[idx]);
        if (row) fields[idx] = row;
      }
    }
    for (const target of layer.remove ?? [])
      fields = fields.filter((f) => f.target !== target);
    for (const o of layer.add ?? []) {
      const idx = byTarget().get(o.target);
      const row = tryOverlayRow(o, idx === undefined ? undefined : fields[idx]);
      if (!row) continue;
      if (idx === undefined) fields.push(row);
      else fields[idx] = row;
    }
    Object.assign(requiredFromFields, layer.required ?? {});
  }
  // flags
  fields = fields.filter((f) => {
    if (f.enabledBy && !(options as Record<string, unknown>)[f.enabledBy])
      return false;
    if (
      f.disabledBy &&
      (options as Record<string, unknown>)[f.disabledBy] === false
    )
      return false;
    return true;
  });
  // legacy id field override (§3.2 step 1)
  if (options.legacyIdField) {
    fields = fields.map((f) =>
      f.required === "K" && f.transform.kind === "legacyId"
        ? { ...f, target: options.legacyIdField as string }
        : f,
    );
  }
  const legacyIdField = fields.find(
    (f) => f.required === "K" && f.transform.kind === "legacyId",
  )?.target;

  // duplicates after merge
  const seen = new Map<string, number>();
  for (const f of fields) seen.set(f.target, (seen.get(f.target) ?? 0) + 1);
  for (const [t, n] of seen)
    if (n > 1)
      findings.push({
        severity: "blocking",
        code: "MAP_DUP_TARGET",
        objectKey: module.key,
        country: cc.iso2,
        field: t,
        detail: `target mapped ${n} times after overlays`,
      });

  // --- required
  const required: Record<string, boolean> = {
    ...requiredFromFields,
    ...(requiredOv ?? {}),
  };

  // --- picklists: module defaults ← layered config maps (prefix `${key}.` or referenced by a transform)
  const referenced = new Set<string>();
  for (const f of fields) {
    const t =
      f.transform.kind === "secondPass" ? f.transform.inner : f.transform;
    if (t.kind === "picklist" || t.kind === "multipicklist")
      referenced.add(t.mapKey);
  }
  const picklists: Record<string, Record<string, string | null>> = {};
  for (const [k, v] of Object.entries(module.picklists))
    picklists[k] = { ...v };
  for (const [mapKey, values] of Object.entries(cc.picklists.maps)) {
    if (mapKey.startsWith(`${module.key}.`) || referenced.has(mapKey))
      picklists[mapKey] = { ...(picklists[mapKey] ?? {}), ...values };
  }

  // --- countryOf
  let countryOf = module.countryOf;
  if (countryOfOv && territoryRule === undefined) {
    try {
      countryOf = parseCountryOf(countryOfOv);
    } catch (e) {
      findings.push({
        severity: "blocking",
        code: "MAP_COUNTRY_RULE_INVALID",
        objectKey: module.key,
        country: cc.iso2,
        detail: (e as Error).message,
      });
    }
  }
  if (!countryOf.length)
    findings.push({
      severity: "blocking",
      code: "MAP_COUNTRY_RULE_MISSING",
      objectKey: module.key,
      country: cc.iso2,
      detail: "no countryOf rule",
    });

  // --- scope
  const scope = resolveScope(module, cc, findings, now);
  if (scope.spec.kind === "dated" && scope.spec.predicates.length === 0)
    findings.push({
      severity: "blocking",
      code: "MAP_SCOPE_FIELD_MISSING",
      objectKey: module.key,
      country: cc.iso2,
      detail: "dated scope without predicate fields",
    });

  // --- load
  const load: LoadOptions = {
    ...module.load,
    ...(loadOv ?? {}),
  } as LoadOptions;
  if (loadOv?.partitionBy)
    load.partitionBy = {
      field: loadOv.partitionBy.field,
      order: loadOv.partitionBy.order ?? ["null", "notNull"],
    };
  if (load.strategy === undefined) load.strategy = config.load.strategy;
  if (load.migrationMode === undefined)
    load.migrationMode = cc.target.migrationMode ?? config.target.migrationMode;
  if (load.batchSize === undefined)
    load.batchSize = config.performance.vaultBatch;

  // `cutoffDate` is a run literal (§1.1 #2, persisted with the watermark and
  // detected via SCOPE_CUTOFF_CHANGED); hashing it would change `mapping_hash`
  // every calendar day and defeat the §8.2 hash skip / MAP_HASH_CHANGED.
  const { cutoffDate: _cutoffDate, ...scopeForHash } = scope;
  const hashable = {
    objectKey: module.key,
    country: cc.iso2,
    sourceObject: module.source,
    targetObject: module.target,
    legacyIdField,
    fields,
    required,
    picklists,
    objectTypes: { ...module.objectTypes, ...(objectTypeOv ?? {}) },
    states: { ...module.states, ...(stateOv ?? {}) },
    countryOf: countryOf.map(formatCountryOf),
    scope: scopeForHash,
    load,
    options,
    match: module.match,
    selfRefs: module.selfRefs,
    dependsOn: module.dependsOn,
    configObjects: module.configObjects,
  };
  const mappingHash = hashObject(hashable);
  return {
    ...hashable,
    scope,
    countryOf,
    findings,
    mappingHash,
  };
}

/** Build the layered picklist lookup a `CountryContext` exposes (§7.1 order is pre-merged). */
export function makePicklistLookup(
  maps: Record<string, Record<string, string | null>>,
) {
  return (mapKey: string, sourceValue: string): string | null | undefined => {
    const m = maps[mapKey];
    if (!m) return undefined;
    if (sourceValue in m) return m[sourceValue];
    return undefined;
  };
}
