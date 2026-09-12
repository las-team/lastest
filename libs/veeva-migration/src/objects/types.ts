/**
 * The ObjectModule contract (§2.3, §6): one module per object key describing
 * source/target objects, scope, country derivation, dependencies, field
 * mappings, crosswalk defaults and load/match policies.
 *
 * Modules are declared with `defineObject(...)` which (a) fills defaults,
 * (b) prepends the Block S system/audit rows (§6.0.4) via `blockS()`, and
 * (c) normalises textual transforms/countryOf rules. `validateObjectModule`
 * is the offline lint (§5.3) run by tests and preflight.
 */
import { parseCountryOf } from "../country-of";
import { innerTransform, refTarget, toTransformSpec } from "../transform/spec";
import {
  OBJECT_KEYS,
  TRANSFORM_KINDS,
  isObjectKey,
  type BlobPolicy,
  type CountryOfSpec,
  type CreatePolicy,
  type CustomTransformFn,
  type DeletePolicy,
  type EvidenceTag,
  type FieldMapping,
  type FlagCondition,
  type LoadOptions,
  type MatchRule,
  type ObjectKey,
  type ObjectOptions,
  type PayloadScalar,
  type ScopeSpec,
  type SelfRef,
  type TransformSpec,
} from "../types";

// ---------------------------------------------------------------------------
// Block S (§6.0.4)
// ---------------------------------------------------------------------------

/**
 * Opt-outs / variants for the Block S rows. Everything defaults to "on" so a
 * module only lists what differs.
 */
export interface BlockSOptions {
  /**
   * `Name` handling: `text` (default, `text(128)` → `name__v`), `autoNumber`
   * (row gated by `objects.<key>.preserveAutoNumberName`), `none` (object has
   * no Name column, e.g. association objects), or a `nameTemplate` key.
   */
  name?: "text" | "autoNumber" | "none" | { nameTemplate: string };
  /** `OwnerId → ownerid__v` (default true; preflight drops it when the target lacks the field). */
  ownerId?: boolean;
  /** Audit rows created/modified by/date (default true). */
  audit?: boolean;
  /** `RecordType.DeveloperName → object_type__v.api_name__v` (default: true when the module has `objectTypes`). */
  objectType?: boolean;
  /** `CurrencyIsoCode → local_currency__sys` (default false; enable on objects with currency fields). */
  currency?: boolean;
  /** `Mobile_ID_vod__c → mobile_id__v` (default true). */
  mobileId?: boolean;
  /** `Last_Device_vod__c → last_device__v = data_load__v` (default true). */
  lastDevice?: boolean;
  /** `Mobile_Created/Last_Modified_Datetime_vod__c` (default true). */
  mobileDatetimes?: boolean;
  /** `Lock_vod__c`, `Override_Lock_vod__c` (default true). */
  locks?: boolean;
  /** `Unlock_vod__c → unlock__v` gated by `loadUnlockFlag` (default true). */
  unlock?: boolean;
  /** `External_ID_vod__c → external_id__v` copy (default true). */
  externalId?: boolean;
  /** Derive `status__v = inactive__v` from a source flag (§4.4 table); off when absent. */
  statusFromFlag?: { sourceFlag: string; inactiveWhen: FlagCondition };
  /** Default legacy-id target before preflight resolution (§3.2 step 2). */
  legacyIdField?: string;
}

const T = (spec: TransformSpec) => spec;

/** Build the Block S rows for one object (§6.0.4). Order is stable. */
export function blockS(
  key: ObjectKey,
  opts: BlockSOptions = {},
): FieldMapping[] {
  const rows: FieldMapping[] = [];
  rows.push({
    source: "Id",
    target: opts.legacyIdField ?? "legacy_crm_id__v",
    transform: T({ kind: "legacyId" }),
    required: "K",
    evidence: "UNV",
    notes: "idParam of the upsert; preflight replaces the target per §3.2",
  });
  const name = opts.name ?? "text";
  if (name === "text") {
    rows.push({
      source: "Name",
      target: "name__v",
      transform: T({ kind: "text", max: 128 }),
      required: "Y",
      evidence: "OBS",
      disabledBy: "preserveName",
    });
  } else if (name === "autoNumber") {
    rows.push({
      source: "Name",
      target: "name__v",
      transform: T({ kind: "text", max: 128 }),
      required: "n",
      evidence: "OBS",
      enabledBy: "preserveAutoNumberName",
      notes:
        "SFDC auto-number carried verbatim only with objects.<key>.preserveAutoNumberName",
    });
  } else if (typeof name === "object") {
    rows.push({
      source: "Name",
      target: "name__v",
      transform: T({ kind: "nameTemplate", templateKey: name.nameTemplate }),
      required: "Y",
      evidence: "OBS",
      countryConfigurable: true,
    });
  }
  if (opts.statusFromFlag) {
    rows.push({
      source: opts.statusFromFlag.sourceFlag,
      target: "status__v",
      transform: T({
        kind: "statusFromFlag",
        sourceFlag: opts.statusFromFlag.sourceFlag,
        inactiveWhen: opts.statusFromFlag.inactiveWhen,
      }),
      required: "n",
      evidence: "OBS",
      disabledBy: "statusFromFlag",
      notes:
        "migration mode; omitted (Vault defaults active__v) unless the flag holds",
    });
  }
  if (opts.audit !== false) {
    rows.push(
      {
        source: "CreatedDate",
        target: "created_date__v",
        transform: T({ kind: "datetime" }),
        required: "n",
        evidence: "OBS",
        notes: "migration mode only",
      },
      {
        source: "CreatedById",
        target: "created_by__v",
        transform: T({ kind: "refUser" }),
        required: "n",
        evidence: "OBS",
        notes: "migration mode only; fallback migrationUserId",
      },
      {
        source: "LastModifiedDate",
        target: "modified_date__v",
        transform: T({ kind: "datetime" }),
        required: "n",
        evidence: "OBS",
        notes: "migration mode only",
      },
      {
        source: "LastModifiedById",
        target: "modified_by__v",
        transform: T({ kind: "refUser" }),
        required: "n",
        evidence: "OBS",
        notes: "migration mode only",
      },
    );
  }
  if (opts.ownerId !== false) {
    rows.push({
      source: "OwnerId",
      target: "ownerid__v",
      transform: T({ kind: "refUser" }),
      required: "n",
      evidence: "UNV",
      optionalSource: false,
      notes:
        "dropped by preflight when the target object has no ownerid__v; queue owners → §3.4",
    });
  }
  if (opts.objectType) {
    rows.push({
      source: "RecordType.DeveloperName",
      target: "object_type__v.api_name__v",
      transform: T({ kind: "objectType", mapKey: `${key}.objectType` }),
      required: "Y",
      evidence: "OBS",
      countryConfigurable: true,
      optionalSource: true,
    });
  }
  if (opts.currency) {
    rows.push({
      source: "CurrencyIsoCode",
      target: "local_currency__sys",
      transform: T({ kind: "currency" }),
      required: "n",
      evidence: "UNV",
      optionalSource: true,
      notes: "multi-currency orgs only; value form probed (§5.3 #15)",
    });
  }
  if (opts.mobileId !== false) {
    rows.push({
      source: "Mobile_ID_vod__c",
      target: "mobile_id__v",
      transform: T({ kind: "copy" }),
      required: "n",
      evidence: "UNV",
      optionalSource: true,
      notes: "secondary match key",
    });
  }
  if (opts.lastDevice !== false) {
    rows.push({
      source: "Last_Device_vod__c",
      target: "last_device__v",
      transform: T({ kind: "const", value: "data_load__v" }),
      required: "n",
      evidence: "UNV",
      optionalSource: true,
    });
  }
  if (opts.mobileDatetimes !== false) {
    rows.push(
      {
        source: "Mobile_Created_Datetime_vod__c",
        target: "mobile_created_datetime__v",
        transform: T({ kind: "datetime" }),
        required: "n",
        evidence: "UNV",
        optionalSource: true,
      },
      {
        source: "Mobile_Last_Modified_Datetime_vod__c",
        target: "mobile_last_modified_datetime__v",
        transform: T({ kind: "datetime" }),
        required: "n",
        evidence: "UNV",
        optionalSource: true,
      },
    );
  }
  if (opts.locks !== false) {
    rows.push(
      {
        source: "Lock_vod__c",
        target: "lock__v",
        transform: T({ kind: "bool" }),
        required: "n",
        evidence: "UNV",
        optionalSource: true,
      },
      {
        source: "Override_Lock_vod__c",
        target: "override_lock__v",
        transform: T({ kind: "bool" }),
        required: "n",
        evidence: "UNV",
        optionalSource: true,
      },
    );
  }
  if (opts.unlock !== false) {
    rows.push({
      source: "Unlock_vod__c",
      target: "unlock__v",
      transform: T({ kind: "bool" }),
      required: "n",
      evidence: "OBS",
      optionalSource: true,
      enabledBy: "loadUnlockFlag",
      notes:
        "transient request flag in Veeva CRM — skipped unless objects.<key>.loadUnlockFlag",
    });
  }
  if (opts.externalId !== false) {
    rows.push({
      source: "External_ID_vod__c",
      target: "external_id__v",
      transform: T({ kind: "copy" }),
      required: "n",
      evidence: "OBS",
      optionalSource: true,
      notes:
        "never overwrite an integration-owned value; skipped when chosen as legacy-id field (§3.2)",
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// ObjectModule
// ---------------------------------------------------------------------------

/** Fully normalised module (what the rest of the tool consumes). */
export interface ObjectModule {
  key: ObjectKey;
  /** SFDC API name (`Call2_vod__c`). */
  source: string;
  /** Vault API name default (`call2__v`); preflight confirms it. */
  target: string;
  targetEvidence: EvidenceTag;
  enabledByDefault: boolean;
  scope: ScopeSpec;
  countryOf: CountryOfSpec[];
  dependsOn: ObjectKey[];
  /** Target fields patched in pass 2 (§6.1), excluded from the DAG. */
  selfRefs: SelfRef[];
  /** Parents-before-children partition (§2.2 step 9). */
  partitionBy?: { field: string; order: ["null", "notNull"] };
  /** Client-side external sort keys (§2.2 step 9). */
  orderBy?: string[];
  /** Self-parent field for depth ordering (§2.2 step 9). */
  depthOrderBy?: string;
  /** Complete mapping rows: Block S first, then object-specific rows. */
  fields: FieldMapping[];
  /** RecordType DeveloperName → object type api name (`[UNV]` unless noted). */
  objectTypes: Record<string, string>;
  /** Business status value → lifecycle state api name. */
  states: Record<string, string>;
  /** mapKey → source value → target name | null (skip). */
  picklists: Record<string, Record<string, string | null>>;
  deletePolicy: DeletePolicy;
  /** Field set written on inactivate (§4.4); `status__v = inactive__v` is implied and need not be listed. */
  inactivate: Array<{ field: string; value: PayloadScalar }>;
  createPolicy: CreatePolicy;
  load: LoadOptions;
  /** §3.3 precedence (id map is implicit first). */
  match: MatchRule[];
  /** Blob name → default policy (§8.6). */
  blobs?: Record<string, BlobPolicy>;
  /** Config-object crosswalk keys (§6.3.42 `configMaps.*`). */
  configObjects?: string[];
  /** Functions for `custom(fnName)`. */
  custom?: Record<string, CustomTransformFn>;
  /** Module-level defaults for object-specific flags (`loadCallType`, `vidField`, …) and policies. */
  optionDefaults?: Partial<ObjectOptions>;
  /** Block S options used (kept for reports/lints). */
  blockS: BlockSOptions;
  notes?: string;
}

/** Textual-friendly input for `defineObject`. */
export interface ObjectModuleInput {
  key: ObjectKey;
  source: string;
  target: string;
  targetEvidence?: EvidenceTag;
  enabledByDefault?: boolean;
  scope?: ScopeSpec;
  countryOf?: string | string[] | CountryOfSpec[];
  dependsOn?: ObjectKey[];
  selfRefs?: SelfRef[];
  partitionBy?: { field: string; order: ["null", "notNull"] };
  orderBy?: string[];
  depthOrderBy?: string;
  /** Object-specific rows only; Block S is contributed by `blockS`. A row with the same target as a Block S row replaces it. */
  fields?: Array<
    Omit<FieldMapping, "transform"> & { transform: TransformSpec | string }
  >;
  blockS?: BlockSOptions;
  objectTypes?: Record<string, string>;
  states?: Record<string, string>;
  picklists?: Record<string, Record<string, string | null>>;
  deletePolicy?: DeletePolicy;
  inactivate?: Array<{ field: string; value: PayloadScalar }>;
  createPolicy?: CreatePolicy;
  load?: Partial<LoadOptions>;
  match?: MatchRule[];
  blobs?: Record<string, BlobPolicy>;
  configObjects?: string[];
  custom?: Record<string, CustomTransformFn>;
  optionDefaults?: Partial<ObjectOptions>;
  notes?: string;
}

/**
 * Normalise a module: defaults, Block S rows, parsed transforms and countryOf.
 * Throws on malformed transform/countryOf text; structural lints live in
 * `validateObjectModule` so tests can list every issue at once.
 */
export function defineObject(input: ObjectModuleInput): ObjectModule {
  const blockOpts: BlockSOptions = {
    objectType: Boolean(
      input.objectTypes && Object.keys(input.objectTypes).length > 0,
    ),
    ...input.blockS,
  };
  const own: FieldMapping[] = (input.fields ?? []).map((f) => ({
    ...f,
    transform: toTransformSpec(f.transform),
  }));
  const ownTargets = new Set(own.map((f) => f.target));
  const base = blockS(input.key, blockOpts).filter(
    (f) => !ownTargets.has(f.target),
  );
  const load: LoadOptions = { noTriggers: true, ...input.load };
  if (input.partitionBy && !load.partitionBy)
    load.partitionBy = input.partitionBy;
  if (input.orderBy && !load.orderBy) load.orderBy = input.orderBy;
  if (input.depthOrderBy && !load.depthOrderBy)
    load.depthOrderBy = input.depthOrderBy;
  return {
    key: input.key,
    source: input.source,
    target: input.target,
    targetEvidence: input.targetEvidence ?? "UNV",
    enabledByDefault: input.enabledByDefault ?? true,
    scope: input.scope ?? { kind: "full" },
    countryOf: parseCountryOf(input.countryOf ?? "global"),
    dependsOn: [...(input.dependsOn ?? [])],
    selfRefs: [...(input.selfRefs ?? [])],
    partitionBy: input.partitionBy,
    orderBy: input.orderBy,
    depthOrderBy: input.depthOrderBy,
    fields: [...base, ...own],
    objectTypes: { ...(input.objectTypes ?? {}) },
    states: { ...(input.states ?? {}) },
    picklists: { ...(input.picklists ?? {}) },
    deletePolicy: input.deletePolicy ?? "ignore",
    inactivate: [...(input.inactivate ?? [])],
    createPolicy: input.createPolicy ?? "create",
    load,
    match: input.match ?? [{ method: "legacy_id" }],
    blobs: input.blobs,
    configObjects: input.configObjects,
    custom: input.custom,
    optionDefaults: input.optionDefaults,
    blockS: blockOpts,
    notes: input.notes,
  };
}

// ---------------------------------------------------------------------------
// Lint (§5.3 offline mapping lints, module-structural subset)
// ---------------------------------------------------------------------------

export interface ModuleLintIssue {
  severity: "blocking" | "warning";
  code: string;
  message: string;
  field?: string;
}

function walkTransform(
  spec: TransformSpec,
  visit: (s: TransformSpec) => void,
): void {
  visit(spec);
  if (spec.kind === "secondPass") walkTransform(spec.inner, visit);
  if (spec.kind === "deferredBlob" && spec.inner)
    walkTransform(spec.inner, visit);
}

/**
 * Structural lint of one module. Returns every issue (empty = valid).
 * `allKeys` defaults to the 46 v1 keys; pass the registry keys when modules
 * are added.
 */
export function validateObjectModule(
  module: ObjectModule,
  allKeys: readonly string[] = OBJECT_KEYS,
): ModuleLintIssue[] {
  const issues: ModuleLintIssue[] = [];
  const blocking = (code: string, message: string, field?: string) =>
    issues.push({ severity: "blocking", code, message, field });
  const warning = (code: string, message: string, field?: string) =>
    issues.push({ severity: "warning", code, message, field });

  if (!isObjectKey(module.key) && !allKeys.includes(module.key))
    blocking("MAP_KEY_UNKNOWN", `unknown object key "${module.key}"`);
  if (!module.source)
    blocking("MAP_SOURCE_MISSING", "source (SFDC API name) is required");
  if (!module.target)
    blocking("MAP_TARGET_MISSING", "target (Vault API name) is required");

  // dependsOn
  for (const dep of module.dependsOn) {
    if (dep === module.key)
      blocking("MAP_DEPENDS_SELF", `dependsOn lists itself`);
    else if (!allKeys.includes(dep))
      blocking("MAP_DEPENDS_UNKNOWN", `dependsOn unknown key "${dep}"`);
  }
  const depSet = new Set(module.dependsOn);

  // scope
  const s = module.scope;
  if (s.kind === "dated") {
    if (!s.predicates.length)
      blocking(
        "MAP_SCOPE_FIELD_MISSING",
        "dated scope needs at least one predicate field",
      );
    for (const p of s.predicates)
      if (!p.field || (p.type !== "date" && p.type !== "datetime"))
        blocking(
          "MAP_SCOPE_FIELD_MISSING",
          `bad scope predicate ${JSON.stringify(p)}`,
        );
  } else if (s.kind === "via-parent") {
    if (!allKeys.includes(s.parentKey))
      blocking(
        "MAP_SCOPE_PARENT_UNKNOWN",
        `via-parent parentKey "${s.parentKey}" unknown`,
      );
    else if (!depSet.has(s.parentKey))
      blocking(
        "MAP_SCOPE_PARENT_NOT_DEPENDENCY",
        `via-parent parentKey "${s.parentKey}" must be in dependsOn`,
      );
    if (!s.parentField)
      blocking("MAP_SCOPE_FIELD_MISSING", "via-parent needs parentField");
  } else if (s.kind !== "full") {
    blocking("MAP_SCOPE_INVALID", `unknown scope kind ${JSON.stringify(s)}`);
  }

  // countryOf
  if (!module.countryOf.length)
    blocking("MAP_COUNTRY_RULE_MISSING", "countryOf is empty");
  for (const c of module.countryOf) {
    if (c.kind === "parent" && !allKeys.includes(c.key))
      blocking("MAP_COUNTRY_RULE_INVALID", `parent:${c.key} unknown key`);
    else if (c.kind === "parent" && !depSet.has(c.key))
      blocking(
        "MAP_COUNTRY_RULE_INVALID",
        `parent:${c.key} must be in dependsOn`,
      );
  }

  // fields
  const targets = new Map<string, number>();
  let legacyRows = 0;
  for (const f of module.fields) {
    if (!f.target)
      blocking("MAP_TARGET_EMPTY", `field ${f.source} has no target`, f.source);
    targets.set(f.target, (targets.get(f.target) ?? 0) + 1);
    if (!["K", "Y", "y?", "n", "-"].includes(f.required))
      blocking(
        "MAP_REQUIRED_INVALID",
        `field ${f.target} has invalid required "${f.required}"`,
        f.target,
      );
    walkTransform(f.transform, (t) => {
      if (!TRANSFORM_KINDS.includes(t.kind))
        blocking(
          "MAP_TRANSFORM_INVALID",
          `field ${f.target}: unknown transform kind "${(t as { kind: string }).kind}"`,
          f.target,
        );
      if (
        (t.kind === "ref" || t.kind === "refLookup") &&
        !allKeys.includes(t.objectKey)
      )
        blocking(
          "MAP_TRANSFORM_INVALID",
          `field ${f.target}: ref to unknown key "${t.objectKey}"`,
          f.target,
        );
      if (
        (t.kind === "ref" || t.kind === "refLookup") &&
        t.objectKey !== module.key &&
        !depSet.has(t.objectKey)
      )
        warning(
          "MAP_FK_PARENT_NOT_DECLARED",
          `field ${f.target}: ref(${t.objectKey}) but "${t.objectKey}" is not in dependsOn`,
          f.target,
        );
      if (t.kind === "refLookup" && !t.lookupField)
        blocking(
          "MAP_TRANSFORM_INVALID",
          `field ${f.target}: refLookup needs lookupField`,
          f.target,
        );
      if (
        (t.kind === "picklist" ||
          t.kind === "multipicklist" ||
          t.kind === "objectType" ||
          t.kind === "state") &&
        !t.mapKey
      )
        blocking(
          "MAP_PICKLIST_KEY_UNKNOWN",
          `field ${f.target}: ${t.kind} needs a mapKey`,
          f.target,
        );
      if (t.kind === "custom") {
        if (!module.custom || typeof module.custom[t.fnName] !== "function")
          blocking(
            "MAP_CUSTOM_FN_MISSING",
            `field ${f.target}: custom(${t.fnName}) is not defined in module.custom`,
            f.target,
          );
      }
      if (t.kind === "compositeExternalId") {
        const tokens = [...t.template.matchAll(/\{([^}]+)\}/g)].map(
          (m) => m[1],
        );
        for (const tok of tokens)
          if (!(tok in t.parts))
            blocking(
              "MAP_TRANSFORM_INVALID",
              `field ${f.target}: compositeExternalId token {${tok}} has no part`,
              f.target,
            );
        for (const p of Object.values(t.parts))
          if ("ref" in p && !allKeys.includes(p.ref))
            blocking(
              "MAP_TRANSFORM_INVALID",
              `field ${f.target}: compositeExternalId ref to unknown key "${p.ref}"`,
              f.target,
            );
      }
      if (t.kind === "statusFromFlag" && !t.sourceFlag)
        blocking(
          "MAP_TRANSFORM_INVALID",
          `field ${f.target}: statusFromFlag needs sourceFlag`,
          f.target,
        );
    });
    if (f.required === "K" && innerTransform(f.transform).kind === "legacyId")
      legacyRows++;
    if (
      f.transform.kind === "deferredBlob" &&
      !(f.blobName ?? f.transform.blobName)
    )
      warning(
        "MAP_BLOB_UNNAMED",
        `field ${f.target}: deferredBlob without a blobName (policy key)`,
        f.target,
      );
  }
  for (const [target, n] of targets)
    if (n > 1)
      blocking(
        "MAP_DUP_TARGET",
        `target "${target}" is mapped ${n} times`,
        target,
      );
  if (legacyRows === 0)
    blocking("MAP_LEGACY_ID_MISSING", "no required('K') legacyId mapping");
  if (legacyRows > 1)
    blocking("MAP_LEGACY_ID_DUPLICATE", "more than one 'K' legacyId mapping");

  // selfRefs
  for (const sr of module.selfRefs) {
    const row = module.fields.find((f) => f.target === sr.target);
    if (!row) {
      blocking(
        "MAP_SELFREF_UNMAPPED",
        `selfRef target "${sr.target}" is not a mapped target`,
        sr.target,
      );
      continue;
    }
    const key = sr.objectKey ?? module.key;
    if (!allKeys.includes(key))
      blocking(
        "MAP_SELFREF_UNKNOWN",
        `selfRef "${sr.target}" references unknown key "${key}"`,
        sr.target,
      );
    else if (key !== module.key && !depSet.has(key))
      blocking(
        "MAP_SELFREF_NOT_DEPENDENCY",
        `selfRef "${sr.target}" references "${key}" which is not in dependsOn`,
        sr.target,
      );
    const target = refTarget(row.transform);
    if (target === undefined)
      warning(
        "MAP_SELFREF_NOT_REF",
        `selfRef "${sr.target}" is not a ref/refUser transform`,
        sr.target,
      );
  }
  // ref to own key must be a selfRef (else cycle)
  for (const f of module.fields) {
    const target = refTarget(f.transform);
    if (
      target === module.key &&
      !module.selfRefs.some((sr) => sr.target === f.target) &&
      !module.load.partitionBy &&
      !module.load.depthOrderBy
    )
      warning(
        "MAP_CYCLE_UNDECLARED",
        `field ${f.target} references the module itself but is neither a selfRef nor ordered by partitionBy/depthOrderBy`,
        f.target,
      );
  }

  // partition / order
  if (module.load.partitionBy && !module.load.partitionBy.field)
    blocking("MAP_PARTITION_INVALID", "partitionBy.field is empty");
  if (module.load.orderBy && module.load.orderBy.some((o) => !o))
    blocking("MAP_ORDER_INVALID", "orderBy contains an empty field");
  if (
    module.load.batchSize !== undefined &&
    (module.load.batchSize < 1 || module.load.batchSize > 500)
  )
    blocking("MAP_BATCH_INVALID", "batchSize must be 1..500");

  // deletePolicy / createPolicy
  if (!["delete", "inactivate", "ignore"].includes(module.deletePolicy))
    blocking(
      "MAP_DELETE_POLICY_INVALID",
      `deletePolicy "${module.deletePolicy}"`,
    );
  if (!["create", "match-only"].includes(module.createPolicy))
    blocking(
      "MAP_CREATE_POLICY_INVALID",
      `createPolicy "${module.createPolicy}"`,
    );
  if (!module.match.length)
    warning("MAP_MATCH_EMPTY", "no match rules (id map only)");

  return issues;
}

/** Throw when `validateObjectModule` reports a blocking issue. */
export function assertValidObjectModule(
  module: ObjectModule,
  allKeys?: readonly string[],
): void {
  const issues = validateObjectModule(module, allKeys).filter(
    (i) => i.severity === "blocking",
  );
  if (issues.length)
    throw new Error(
      `ObjectModule "${module.key}" invalid:\n` +
        issues.map((i) => `  ${i.code}: ${i.message}`).join("\n"),
    );
}
